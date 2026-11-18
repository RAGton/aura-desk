//! Routines application service backed by SQLite (`routines`).

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};

use crate::domain::routine::{Routine, RoutineKind};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing scheduled routines (`water`, `break`, `daily_planning`, `custom`).
pub struct RoutinesService<'a> {
    pub db: &'a Db,
}

impl<'a> RoutinesService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn list(&self, only_enabled: bool) -> Result<Vec<Routine>, CoreError> {
        let conn = self.db.reader();
        let sql = if only_enabled {
            "SELECT id, kind, title, body, cron_expr, start_date, end_date, enabled, metadata, last_fired_at, created_at, updated_at \
             FROM routines WHERE enabled = 1 ORDER BY kind ASC, title ASC"
        } else {
            "SELECT id, kind, title, body, cron_expr, start_date, end_date, enabled, metadata, last_fired_at, created_at, updated_at \
             FROM routines ORDER BY kind ASC, title ASC"
        };

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| CoreError::internal(format!("routines list prepare: {e}")))?;
        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| CoreError::internal(format!("routines list query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("routines row: {e}")))?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Routine, CoreError> {
        let conn = self.db.reader();
        let routine = conn
            .query_row(
                "SELECT id, kind, title, body, cron_expr, start_date, end_date, enabled, metadata, last_fired_at, created_at, updated_at \
                 FROM routines WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("routines get: {e}")))?;

        routine.ok_or_else(|| CoreError::not_found("routine", id))
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<Routine, CoreError> {
        let _ = self.get(id)?;
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE routines SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1i64 } else { 0i64 }, now_str, id],
        )
        .map_err(|e| CoreError::internal(format!("routines set_enabled: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn record_fired(&self, id: &str, fired_at: DateTime<Utc>) -> Result<Routine, CoreError> {
        let existing = self.get(id)?;
        let fired_str = fired_at.to_rfc3339();
        let cleaned_meta = existing.metadata.as_deref().and_then(|s| {
            let mut obj =
                serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(s).ok()?;
            obj.remove("snooze_until");
            obj.remove("snooze_alert_id");
            if obj.is_empty() {
                None
            } else {
                Some(serde_json::Value::Object(obj).to_string())
            }
        });
        let conn = self.db.writer();
        conn.execute(
            "UPDATE routines SET last_fired_at = ?1, metadata = ?2, updated_at = ?1 WHERE id = ?3",
            params![fired_str, cleaned_meta, id],
        )
        .map_err(|e| CoreError::internal(format!("routines record_fired: {e}")))?;
        drop(conn);

        self.get(id)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Routine> {
        let id: String = row.get(0)?;
        let kind_raw: String = row.get(1)?;
        let title: String = row.get(2)?;
        let body: Option<String> = row.get(3)?;
        let cron_expr: Option<String> = row.get(4)?;
        let start_date: Option<String> = row.get(5)?;
        let end_date: Option<String> = row.get(6)?;
        let enabled_int: i64 = row.get(7)?;
        let metadata: Option<String> = row.get(8)?;
        let last_fired_raw: Option<String> = row.get(9)?;
        let created_raw: String = row.get(10)?;
        let updated_raw: String = row.get(11)?;

        Ok(Routine {
            id,
            kind: RoutineKind::from_db(&kind_raw).unwrap_or(RoutineKind::Custom),
            title,
            body,
            cron_expr,
            start_date,
            end_date,
            enabled: enabled_int != 0,
            metadata,
            last_fired_at: last_fired_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            created_at: crate::infrastructure::clock::parse_rfc3339_or_now(&created_raw),
            updated_at: crate::infrastructure::clock::parse_rfc3339_or_now(&updated_raw),
        })
    }
}
