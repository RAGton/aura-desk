//! Alerts application service backed by SQLite (`alerts_pending` and `reminders`).

#![allow(missing_docs)]

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension};

use crate::domain::alert::{Alert, AlertResolution, AlertSeverity, NewAlert};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing user-facing alerts and coordinating reminder lifecycles.
pub struct AlertsService<'a> {
    pub db: &'a Db,
}

impl<'a> AlertsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn get(&self, id: &str) -> Result<Alert, CoreError> {
        let conn = self.db.writer();
        conn.query_row(
            "SELECT id, kind, title, body, severity, ref_id, options, resolution, resolved_at, created_at \
             FROM alerts_pending WHERE id = ?1",
            params![id],
            Self::map_row,
        )
        .map_err(|e| CoreError::not_found("alert", format!("{id}: {e}")))
    }

    pub fn create(&self, new: NewAlert) -> Result<Alert, CoreError> {
        if new.title.trim().is_empty() {
            return Err(CoreError::validation("title", "blank title"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let sev_str = match new.severity {
            AlertSeverity::Info | AlertSeverity::Low => "info",
            AlertSeverity::Urgent | AlertSeverity::Critical | AlertSeverity::High => "urgent",
            _ => "normal",
        };
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO alerts_pending (id, kind, ref_id, title, body, severity, options, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                new.kind,
                new.ref_id,
                new.title,
                new.body,
                sev_str,
                new.options,
                now,
            ],
        )
        .map_err(|e| CoreError::internal(format!("alerts create: {e}")))?;

        // Enforce bounded alert queue (`alerts.max_queue_size`, default 50):
        // auto-dismiss oldest non-urgent pending alerts when capacity is exceeded.
        let max_queue_size: i64 = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'alerts.max_queue_size'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.trim().parse::<i64>().ok())
            .filter(|&n| n > 0)
            .unwrap_or(50);

        let pending_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM alerts_pending WHERE resolved_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if pending_count > max_queue_size {
            let excess = pending_count - max_queue_size;
            let _ = conn.execute(
                "UPDATE alerts_pending SET resolution = 'dismissed', resolved_at = ?1 \
                 WHERE id IN ( \
                     SELECT id FROM alerts_pending \
                     WHERE resolved_at IS NULL AND severity != 'urgent' AND id != ?2 \
                     ORDER BY created_at ASC LIMIT ?3 \
                 )",
                params![now, id, excess],
            );
        }
        drop(conn);

        Ok(Alert {
            id,
            kind: new.kind,
            title: new.title,
            body: new.body,
            severity: new.severity,
            ref_id: new.ref_id,
            options: new.options,
            resolution: None,
            resolved_at: None,
            created_at: now,
        })
    }

    pub fn list_pending(&self) -> Result<Vec<Alert>, CoreError> {
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, title, body, severity, ref_id, options, resolution, resolved_at, created_at \
                 FROM alerts_pending WHERE resolved_at IS NULL \
                 ORDER BY CASE severity WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC, created_at ASC",
            )
            .map_err(|e| CoreError::internal(format!("alerts list_pending prepare: {e}")))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| CoreError::internal(format!("alerts list_pending query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("alerts list_pending row: {e}")))?);
        }
        Ok(out)
    }

    pub fn resolve(&self, id: &str) -> Result<Alert, CoreError> {
        let existing = self.get(id)?;
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "UPDATE alerts_pending SET resolution = 'resolved', resolved_at = ?2 WHERE id = ?1",
            params![id, now_str],
        )
        .map_err(|e| CoreError::internal(format!("alerts resolve: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                let rem_info: Option<(Option<String>, String)> = conn
                    .query_row(
                        "SELECT repeat_kind, fire_at FROM reminders WHERE id = ?1",
                        params![rem_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(|e| {
                        CoreError::internal(format!("alerts resolve reminder lookup: {e}"))
                    })?;

                if let Some((repeat_raw, fire_raw)) = rem_info {
                    let old_fire = DateTime::parse_from_rfc3339(&fire_raw)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or(now);

                    match repeat_raw.as_deref() {
                        Some("daily") => {
                            let next_fire = (old_fire + Duration::days(1)).to_rfc3339();
                            conn.execute(
                                "UPDATE reminders SET status = 'pending', fire_at = ?1, updated_at = ?2 WHERE id = ?3",
                                params![next_fire, now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("advance daily reminder: {e}")))?;
                        }
                        Some("weekly") => {
                            let next_fire = (old_fire + Duration::days(7)).to_rfc3339();
                            conn.execute(
                                "UPDATE reminders SET status = 'pending', fire_at = ?1, updated_at = ?2 WHERE id = ?3",
                                params![next_fire, now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("advance weekly reminder: {e}")))?;
                        }
                        Some("monthly") => {
                            let next_fire = (old_fire + Duration::days(30)).to_rfc3339();
                            conn.execute(
                                "UPDATE reminders SET status = 'pending', fire_at = ?1, updated_at = ?2 WHERE id = ?3",
                                params![next_fire, now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("advance monthly reminder: {e}")))?;
                        }
                        _ => {
                            conn.execute(
                                "UPDATE reminders SET status = 'resolved', resolved_at = ?1, updated_at = ?1 WHERE id = ?2",
                                params![now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("resolve single reminder: {e}")))?;
                        }
                    }
                }
            }
        }
        drop(conn);

        self.get(id)
    }

    pub fn snooze(&self, id: &str) -> Result<Alert, CoreError> {
        let existing = self.get(id)?;
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "UPDATE alerts_pending SET resolution = 'snoozed', resolved_at = ?2 WHERE id = ?1",
            params![id, now_str],
        )
        .map_err(|e| CoreError::internal(format!("alerts snooze: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                let next_fire = (now + Duration::minutes(5)).to_rfc3339();
                conn.execute(
                    "UPDATE reminders SET status = 'pending', snooze_count = snooze_count + 1, \
                     last_snoozed_at = ?1, fire_at = ?2, updated_at = ?1 WHERE id = ?3",
                    params![now_str, next_fire, rem_id],
                )
                .map_err(|e| CoreError::internal(format!("alerts snooze reminder: {e}")))?;
            }
        }
        drop(conn);

        self.get(id)
    }

    pub fn dismiss(&self, id: &str) -> Result<Alert, CoreError> {
        let existing = self.get(id)?;
        let now_str = Utc::now().to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "UPDATE alerts_pending SET resolution = 'dismissed', resolved_at = ?2 WHERE id = ?1",
            params![id, now_str],
        )
        .map_err(|e| CoreError::internal(format!("alerts dismiss: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                conn.execute(
                    "UPDATE reminders SET status = 'dismissed', resolved_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![now_str, rem_id],
                )
                .map_err(|e| CoreError::internal(format!("alerts dismiss reminder: {e}")))?;
            }
        }
        drop(conn);

        self.get(id)
    }

    pub fn except(&self, id: &str, note: &str) -> Result<Alert, CoreError> {
        if note.trim().is_empty() {
            return Err(CoreError::validation("note", "empty note"));
        }
        let existing = self.get(id)?;
        let now_str = Utc::now().to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "UPDATE alerts_pending SET resolution = 'excepted', resolved_at = ?2, body = ?3 WHERE id = ?1",
            params![id, now_str, note],
        )
        .map_err(|e| CoreError::internal(format!("alerts except: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                let current_log: Option<Option<String>> = conn
                    .query_row(
                        "SELECT exceptions_log FROM reminders WHERE id = ?1",
                        params![rem_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| CoreError::internal(format!("alerts except read log: {e}")))?;

                if let Some(log_opt) = current_log {
                    let mut entries: Vec<serde_json::Value> = log_opt
                        .as_deref()
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or_default();

                    entries.push(serde_json::json!({
                        "alert_id": id,
                        "action": "excepted",
                        "note": note,
                        "timestamp": now_str,
                    }));

                    let updated_log = serde_json::to_string(&entries).map_err(|e| {
                        CoreError::internal(format!("serialize exceptions_log: {e}"))
                    })?;

                    conn.execute(
                        "UPDATE reminders SET status = 'excepted', resolved_at = ?1, \
                         exceptions_log = ?2, updated_at = ?1 WHERE id = ?3",
                        params![now_str, updated_log, rem_id],
                    )
                    .map_err(|e| {
                        CoreError::internal(format!("alerts except update reminder: {e}"))
                    })?;
                }
            }
        }
        drop(conn);

        self.get(id)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Alert> {
        let id: String = row.get(0)?;
        let kind: String = row.get(1)?;
        let title: String = row.get(2)?;
        let body: Option<String> = row.get(3)?;
        let sev_raw: String = row.get(4)?;
        let ref_id: Option<String> = row.get(5)?;
        let options: Option<String> = row.get(6)?;
        let res_raw: Option<String> = row.get(7)?;
        let resolved_at: Option<String> = row.get(8)?;
        let created_at: String = row.get(9)?;

        let severity = match sev_raw.as_str() {
            "info" => AlertSeverity::Info,
            "urgent" => AlertSeverity::Urgent,
            _ => AlertSeverity::Normal,
        };
        let resolution = res_raw.as_deref().and_then(|r| match r {
            "resolved" => Some(AlertResolution::Resolved),
            "snoozed" => Some(AlertResolution::Snoozed),
            "dismissed" => Some(AlertResolution::Dismissed),
            "excepted" => Some(AlertResolution::Excepted),
            _ => None,
        });

        Ok(Alert {
            id,
            kind,
            title,
            body,
            severity,
            ref_id,
            options,
            resolution,
            resolved_at,
            created_at,
        })
    }
}
