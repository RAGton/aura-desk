//! Daily metrics application service backed by SQLite (`metrics_daily`).

#![allow(missing_docs)]

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::infrastructure::db::Db;
use crate::CoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailyMetrics {
    pub date: String,
    pub focus_minutes: i64,
    pub break_minutes: i64,
    pub water_count: i64,
    pub tasks_done: i64,
    pub tasks_created: i64,
    pub active_minutes: i64,
    pub notes: Option<String>,
}

/// Service for reading and aggregating daily productivity metrics.
pub struct MetricsService<'a> {
    pub db: &'a Db,
}

impl<'a> MetricsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn get_or_default(&self, date: &str) -> Result<DailyMetrics, CoreError> {
        let conn = self.db.writer();
        let row = conn
            .query_row(
                "SELECT date, focus_minutes, break_minutes, water_count, tasks_done, tasks_created, active_minutes, notes \
                 FROM metrics_daily WHERE date = ?1",
                params![date],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("metrics get: {e}")))?;

        Ok(row.unwrap_or_else(|| DailyMetrics {
            date: date.to_string(),
            focus_minutes: 0,
            break_minutes: 0,
            water_count: 0,
            tasks_done: 0,
            tasks_created: 0,
            active_minutes: 0,
            notes: None,
        }))
    }

    pub fn record_focus(&self, date: &str, minutes: i64) -> Result<DailyMetrics, CoreError> {
        if minutes < 0 {
            return Err(CoreError::validation("minutes", "minutes must be >= 0"));
        }
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO metrics_daily (date, focus_minutes, active_minutes) VALUES (?1, ?2, ?2) \
             ON CONFLICT(date) DO UPDATE SET \
               focus_minutes = focus_minutes + excluded.focus_minutes, \
               active_minutes = active_minutes + excluded.active_minutes",
            params![date, minutes],
        )
        .map_err(|e| CoreError::internal(format!("metrics record_focus: {e}")))?;
        drop(conn);

        self.get_or_default(date)
    }

    pub fn record_break(&self, date: &str, minutes: i64) -> Result<DailyMetrics, CoreError> {
        if minutes < 0 {
            return Err(CoreError::validation("minutes", "minutes must be >= 0"));
        }
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO metrics_daily (date, break_minutes) VALUES (?1, ?2) \
             ON CONFLICT(date) DO UPDATE SET \
               break_minutes = break_minutes + excluded.break_minutes",
            params![date, minutes],
        )
        .map_err(|e| CoreError::internal(format!("metrics record_break: {e}")))?;
        drop(conn);

        self.get_or_default(date)
    }

    pub fn increment_water(&self, date: &str) -> Result<DailyMetrics, CoreError> {
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO metrics_daily (date, water_count) VALUES (?1, 1) \
             ON CONFLICT(date) DO UPDATE SET water_count = water_count + 1",
            params![date],
        )
        .map_err(|e| CoreError::internal(format!("metrics increment_water: {e}")))?;
        drop(conn);

        self.get_or_default(date)
    }

    pub fn list_recent(&self, limit: i64) -> Result<Vec<DailyMetrics>, CoreError> {
        let lim = limit.max(1);
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare(
                "SELECT date, focus_minutes, break_minutes, water_count, tasks_done, tasks_created, active_minutes, notes \
                 FROM metrics_daily ORDER BY date DESC LIMIT ?1",
            )
            .map_err(|e| CoreError::internal(format!("metrics list_recent prepare: {e}")))?;
        let rows = stmt
            .query_map(params![lim], Self::map_row)
            .map_err(|e| CoreError::internal(format!("metrics list_recent query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("metrics row: {e}")))?);
        }
        Ok(out)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DailyMetrics> {
        Ok(DailyMetrics {
            date: row.get(0)?,
            focus_minutes: row.get(1)?,
            break_minutes: row.get(2)?,
            water_count: row.get(3)?,
            tasks_done: row.get(4)?,
            tasks_created: row.get(5)?,
            active_minutes: row.get(6)?,
            notes: row.get(7)?,
        })
    }
}
