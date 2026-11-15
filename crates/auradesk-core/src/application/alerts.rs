//! Alerts application service backed by SQLite (`alerts_pending` and `reminders`).

#![allow(missing_docs)]

use chrono::{DateTime, Duration, Local, Utc};
use rusqlite::{params, OptionalExtension};

use crate::domain::alert::{Alert, AlertResolution, AlertSeverity, NewAlert};
use crate::infrastructure::clock::{Clock, SystemClock};
use crate::infrastructure::db::Db;
use crate::CoreError;

static SYSTEM_CLOCK: SystemClock = SystemClock;

/// Service for managing user-facing alerts and coordinating reminder lifecycles.
pub struct AlertsService<'a> {
    pub db: &'a Db,
    pub clock: &'a dyn Clock,
}

impl<'a> AlertsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self {
            db,
            clock: &SYSTEM_CLOCK,
        }
    }

    pub fn with_clock(db: &'a Db, clock: &'a dyn Clock) -> Self {
        Self { db, clock }
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
        self.create_with_parent(new, None)
    }

    pub fn create_with_parent(
        &self,
        new: NewAlert,
        parent_alert_id: Option<&str>,
    ) -> Result<Alert, CoreError> {
        if new.title.trim().is_empty() {
            return Err(CoreError::validation("title", "blank title"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = self.clock.now().to_rfc3339();
        let sev_str = match new.severity {
            AlertSeverity::Info | AlertSeverity::Low => "info",
            AlertSeverity::Urgent | AlertSeverity::Critical | AlertSeverity::High => "urgent",
            _ => "normal",
        };
        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("alerts create tx: {e}")))?;
        tx.execute(
            "INSERT INTO alerts_pending (id, kind, ref_id, title, body, severity, options, parent_alert_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                new.kind,
                new.ref_id,
                new.title,
                new.body,
                sev_str,
                new.options,
                parent_alert_id,
                now,
            ],
        )
        .map_err(|e| CoreError::internal(format!("alerts create: {e}")))?;

        // Enforce bounded alert queue (`alerts.max_queue_size`, default 50):
        // auto-dismiss oldest non-urgent pending alerts when capacity is exceeded.
        let max_queue_size: i64 = tx
            .query_row(
                "SELECT value FROM settings WHERE key = 'alerts.max_queue_size'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.trim().trim_matches('"').parse::<i64>().ok())
            .filter(|&n| n > 0)
            .unwrap_or(50);

        let pending_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM alerts_pending WHERE resolved_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if pending_count > max_queue_size {
            let excess = pending_count - max_queue_size;
            tx.execute(
                "UPDATE alerts_pending SET resolution = 'dismissed', resolved_at = ?1 \
                 WHERE id IN ( \
                     SELECT id FROM alerts_pending \
                     WHERE resolved_at IS NULL AND severity != 'urgent' AND id != ?2 \
                     ORDER BY created_at ASC LIMIT ?3 \
                 )",
                params![now, id, excess],
            )
            .map_err(|e| CoreError::internal(format!("alerts queue trim: {e}")))?;
        }
        tx.commit()
            .map_err(|e| CoreError::internal(format!("alerts create commit: {e}")))?;
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
        let now = self.clock.now();
        let now_str = now.to_rfc3339();

        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("alerts resolve tx: {e}")))?;
        tx.execute(
            "UPDATE alerts_pending SET resolution = 'resolved', resolved_at = ?2 WHERE id = ?1",
            params![id, now_str],
        )
        .map_err(|e| CoreError::internal(format!("alerts resolve: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                let rem_info: Option<(Option<String>, String)> = tx
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
                            tx.execute(
                                "UPDATE reminders SET status = 'pending', fire_at = ?1, updated_at = ?2 WHERE id = ?3",
                                params![next_fire, now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("advance daily reminder: {e}")))?;
                        }
                        Some("weekly") => {
                            let next_fire = (old_fire + Duration::days(7)).to_rfc3339();
                            tx.execute(
                                "UPDATE reminders SET status = 'pending', fire_at = ?1, updated_at = ?2 WHERE id = ?3",
                                params![next_fire, now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("advance weekly reminder: {e}")))?;
                        }
                        Some("monthly") => {
                            let next_fire = (old_fire + Duration::days(30)).to_rfc3339();
                            tx.execute(
                                "UPDATE reminders SET status = 'pending', fire_at = ?1, updated_at = ?2 WHERE id = ?3",
                                params![next_fire, now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("advance monthly reminder: {e}")))?;
                        }
                        _ => {
                            tx.execute(
                                "UPDATE reminders SET status = 'resolved', resolved_at = ?1, updated_at = ?1 WHERE id = ?2",
                                params![now_str, rem_id],
                            )
                            .map_err(|e| CoreError::internal(format!("resolve single reminder: {e}")))?;
                        }
                    }
                }
            }
        } else if existing.kind == "routine" {
            if let Some(ref routine_id) = existing.ref_id {
                let kind_raw: Option<String> = tx
                    .query_row(
                        "SELECT kind FROM routines WHERE id = ?1",
                        params![routine_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| CoreError::internal(format!("alerts resolve routine: {e}")))?;

                let date = now.with_timezone(&Local).format("%Y-%m-%d").to_string();
                match kind_raw.as_deref() {
                    Some("water") => {
                        tx.execute(
                            "INSERT INTO metrics_daily (date, water_count) VALUES (?1, 1) \
                             ON CONFLICT(date) DO UPDATE SET water_count = water_count + 1",
                            params![date],
                        )
                        .map_err(|e| {
                            CoreError::internal(format!("metrics water increment: {e}"))
                        })?;
                    }
                    Some("break") => {
                        tx.execute(
                            "INSERT INTO metrics_daily (date, break_minutes) VALUES (?1, 5) \
                             ON CONFLICT(date) DO UPDATE SET break_minutes = break_minutes + 5",
                            params![date],
                        )
                        .map_err(|e| {
                            CoreError::internal(format!("metrics break increment: {e}"))
                        })?;
                    }
                    _ => {}
                }
            }
        }

        let notif_id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO notifications (id, alert_id, kind, ref_id, title, body, delivered_at, read_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                notif_id,
                id,
                existing.kind,
                existing.ref_id,
                existing.title,
                existing.body,
                now_str,
            ],
        )
        .map_err(|e| CoreError::internal(format!("alerts resolve notification: {e}")))?;

        tx.commit()
            .map_err(|e| CoreError::internal(format!("alerts resolve commit: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn snooze(&self, id: &str) -> Result<Alert, CoreError> {
        let existing = self.get(id)?;
        let now = self.clock.now();
        let now_str = now.to_rfc3339();
        let next_fire = (now + Duration::minutes(10)).to_rfc3339();

        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("alerts snooze tx: {e}")))?;
        tx.execute(
            "UPDATE alerts_pending SET resolution = 'snoozed', resolved_at = ?2 WHERE id = ?1",
            params![id, now_str],
        )
        .map_err(|e| CoreError::internal(format!("alerts snooze: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                tx.execute(
                    "UPDATE reminders SET status = 'pending', snooze_count = snooze_count + 1, \
                     last_snoozed_at = ?1, fire_at = ?2, updated_at = ?1 WHERE id = ?3",
                    params![now_str, next_fire, rem_id],
                )
                .map_err(|e| CoreError::internal(format!("alerts snooze reminder: {e}")))?;
            }
        } else if existing.kind == "routine" {
            if let Some(ref routine_id) = existing.ref_id {
                let meta_raw: Option<Option<String>> = tx
                    .query_row(
                        "SELECT metadata FROM routines WHERE id = ?1",
                        params![routine_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| {
                        CoreError::internal(format!("alerts snooze routine lookup: {e}"))
                    })?;

                if let Some(opt_meta) = meta_raw {
                    let mut obj = opt_meta
                        .as_deref()
                        .and_then(|s| {
                            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(s)
                                .ok()
                        })
                        .unwrap_or_default();
                    obj.insert("snooze_until".into(), serde_json::Value::String(next_fire));
                    obj.insert(
                        "snooze_alert_id".into(),
                        serde_json::Value::String(id.to_string()),
                    );
                    let serialized = serde_json::Value::Object(obj).to_string();
                    tx.execute(
                        "UPDATE routines SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
                        params![serialized, now_str, routine_id],
                    )
                    .map_err(|e| {
                        CoreError::internal(format!("alerts snooze routine update: {e}"))
                    })?;
                }
            }
        } else {
            let snoozed_rem_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO reminders (id, task_id, title, body, fire_at, repeat_kind, sound, status, snooze_count, last_snoozed_at, created_at, updated_at) \
                 VALUES (?1, NULL, ?2, ?3, ?4, 'none', 'normal', 'pending', 1, ?5, ?5, ?5)",
                params![snoozed_rem_id, existing.title, existing.body, next_fire, now_str],
            )
            .map_err(|e| CoreError::internal(format!("alerts snooze standalone reminder: {e}")))?;
        }

        tx.commit()
            .map_err(|e| CoreError::internal(format!("alerts snooze commit: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn dismiss(&self, id: &str) -> Result<Alert, CoreError> {
        let existing = self.get(id)?;
        let now_str = self.clock.now().to_rfc3339();

        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("alerts dismiss tx: {e}")))?;
        tx.execute(
            "UPDATE alerts_pending SET resolution = 'dismissed', resolved_at = ?2 WHERE id = ?1",
            params![id, now_str],
        )
        .map_err(|e| CoreError::internal(format!("alerts dismiss: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                tx.execute(
                    "UPDATE reminders SET status = 'dismissed', resolved_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![now_str, rem_id],
                )
                .map_err(|e| CoreError::internal(format!("alerts dismiss reminder: {e}")))?;
            }
        }
        tx.commit()
            .map_err(|e| CoreError::internal(format!("alerts dismiss commit: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn except(&self, id: &str, note: &str) -> Result<Alert, CoreError> {
        if note.trim().is_empty() {
            return Err(CoreError::validation("note", "empty note"));
        }
        let existing = self.get(id)?;
        let now_str = self.clock.now().to_rfc3339();

        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("alerts except tx: {e}")))?;
        tx.execute(
            "UPDATE alerts_pending SET resolution = 'excepted', resolved_at = ?2, body = ?3 WHERE id = ?1",
            params![id, now_str, note],
        )
        .map_err(|e| CoreError::internal(format!("alerts except: {e}")))?;

        if existing.kind == "reminder" {
            if let Some(ref rem_id) = existing.ref_id {
                let current_log: Option<Option<String>> = tx
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

                    tx.execute(
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
        tx.commit()
            .map_err(|e| CoreError::internal(format!("alerts except commit: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn close_open_for_ref(
        &self,
        ref_id: &str,
        resolution: AlertResolution,
    ) -> Result<usize, CoreError> {
        let now_str = self.clock.now().to_rfc3339();
        let conn = self.db.writer();
        let affected = conn
            .execute(
                "UPDATE alerts_pending SET resolution = ?1, resolved_at = ?2 \
                 WHERE ref_id = ?3 AND resolution IS NULL",
                params![resolution.as_str(), now_str, ref_id],
            )
            .map_err(|e| CoreError::internal(format!("alerts close_open_for_ref: {e}")))?;
        Ok(affected)
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
