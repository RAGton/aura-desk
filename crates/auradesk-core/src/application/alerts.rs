//! Alerts application service.

#![allow(missing_docs)]

use crate::domain::alert::{Alert, AlertResolution, AlertSeverity, NewAlert};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing user-facing alerts.
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
            "SELECT id, kind, title, body, severity, ref_id, options, resolution, resolved_at, created_at FROM alerts_pending WHERE id = ?1",
            rusqlite::params![id],
            |row| {
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
            },
        )
        .map_err(|e| CoreError::not_found("alert", format!("{id}: {e}")))
    }

    pub fn create(&self, new: NewAlert) -> Result<Alert, CoreError> {
        if new.title.trim().is_empty() {
            return Err(CoreError::validation("title", "blank title"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let sev_str = match new.severity {
            AlertSeverity::Info | AlertSeverity::Low => "info",
            AlertSeverity::Normal => "normal",
            _ => "urgent",
        };
        {
            let conn = self.db.writer();
            conn.execute(
                "INSERT INTO alerts_pending (id, kind, ref_id, title, body, severity, options, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![id, new.kind, new.ref_id, new.title, new.body, sev_str, new.options, now],
            ).map_err(|e| CoreError::internal(format!("insert alert: {e}")))?;
        }

        self.get(&id)
    }

    pub fn list_pending(&self) -> Result<Vec<Alert>, CoreError> {
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare("SELECT id, kind, title, body, severity, ref_id, options, resolution, resolved_at, created_at FROM alerts_pending WHERE resolved_at IS NULL ORDER BY created_at ASC")
            .map_err(|e| CoreError::internal(format!("prepare list_pending: {e}")))?;
        let rows = stmt
            .query_map([], |row| {
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
            })
            .map_err(|e| CoreError::internal(format!("query list_pending: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("row list_pending: {e}")))?);
        }
        Ok(out)
    }

    pub fn resolve(&self, id: &str) -> Result<Alert, CoreError> {
        {
            let conn = self.db.writer();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE alerts_pending SET resolution = 'resolved', resolved_at = ?1 WHERE id = ?2",
                rusqlite::params![now, id],
            )
            .map_err(|e| CoreError::internal(format!("resolve alert: {e}")))?;
        }
        self.get(id)
    }

    pub fn snooze(&self, id: &str) -> Result<Alert, CoreError> {
        {
            let conn = self.db.writer();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE alerts_pending SET resolution = 'snoozed', resolved_at = ?1 WHERE id = ?2",
                rusqlite::params![now, id],
            )
            .map_err(|e| CoreError::internal(format!("snooze alert: {e}")))?;
        }
        self.get(id)
    }

    pub fn dismiss(&self, id: &str) -> Result<Alert, CoreError> {
        {
            let conn = self.db.writer();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE alerts_pending SET resolution = 'dismissed', resolved_at = ?1 WHERE id = ?2",
                rusqlite::params![now, id],
            )
            .map_err(|e| CoreError::internal(format!("dismiss alert: {e}")))?;
        }
        self.get(id)
    }

    pub fn except(&self, id: &str, note: &str) -> Result<Alert, CoreError> {
        if note.trim().is_empty() {
            return Err(CoreError::validation("note", "empty note"));
        }
        {
            let conn = self.db.writer();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE alerts_pending SET resolution = 'excepted', resolved_at = ?1, body = ?2 WHERE id = ?3",
                rusqlite::params![now, note, id],
            )
            .map_err(|e| CoreError::internal(format!("except alert: {e}")))?;
        }
        self.get(id)
    }
}
