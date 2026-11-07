//! Pomodoros application service backed by SQLite (`pomodoro_sessions` and `tasks`).

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};

use crate::domain::pomodoro::{NewPomodoroSession, PomodoroSession, PomodoroStatus, SessionKind};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing pomodoro sessions and syncing focus time to tasks.
pub struct PomodorosService<'a> {
    pub db: &'a Db,
}

impl<'a> PomodorosService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn list(&self, limit: impl Into<i64>) -> Result<Vec<PomodoroSession>, CoreError> {
        let lim = limit.into().max(1);
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, kind, status, planned_min, actual_min, interruptions, started_at, ended_at \
                 FROM pomodoro_sessions ORDER BY started_at DESC LIMIT ?1",
            )
            .map_err(|e| CoreError::internal(format!("pomodoros list prepare: {e}")))?;

        let rows = stmt
            .query_map(params![lim], Self::map_row)
            .map_err(|e| CoreError::internal(format!("pomodoros list query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("pomodoros row: {e}")))?);
        }
        Ok(out)
    }

    pub fn running_session(&self) -> Result<Option<PomodoroSession>, CoreError> {
        let conn = self.db.writer();
        conn.query_row(
            "SELECT id, task_id, kind, status, planned_min, actual_min, interruptions, started_at, ended_at \
             FROM pomodoro_sessions WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
            [],
            Self::map_row,
        )
        .optional()
        .map_err(|e| CoreError::internal(format!("pomodoros running_session: {e}")))
    }

    pub fn start(&self, new: NewPomodoroSession) -> Result<PomodoroSession, CoreError> {
        if new.planned_min <= 0 {
            return Err(CoreError::validation(
                "planned_min",
                "planned_min must be > 0",
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO pomodoro_sessions (id, task_id, kind, planned_min, actual_min, started_at, ended_at, status, interruptions) \
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, NULL, 'running', 0)",
            params![id, new.task_id, new.kind.as_str(), new.planned_min, now_str],
        )
        .map_err(|e| CoreError::internal(format!("pomodoros start: {e}")))?;
        drop(conn);

        self.get(&id)
    }

    pub fn complete_running(&self, actual_min: i32) -> Result<PomodoroSession, CoreError> {
        if actual_min <= 0 {
            return Err(CoreError::validation(
                "actual_min",
                "actual_min must be > 0",
            ));
        }

        let running = self.running_session()?.ok_or_else(|| {
            CoreError::conflict(
                "pomodoro_session",
                "no running pomodoro session to complete",
            )
        })?;

        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();

        let updated = conn
            .execute(
                "UPDATE pomodoro_sessions SET status = 'completed', actual_min = ?1, ended_at = ?2 \
                 WHERE id = ?3 AND status = 'running'",
                params![actual_min, now_str, running.id],
            )
            .map_err(|e| CoreError::internal(format!("pomodoros complete_running: {e}")))?;

        if updated == 0 {
            return Err(CoreError::conflict(
                "pomodoro_session",
                "pomodoro session already completed",
            ));
        }

        // Sync focus time to the linked Kanban task (`tasks.actual_min`)
        if matches!(running.kind, SessionKind::Focus) {
            if let Some(ref task_id) = running.task_id {
                conn.execute(
                    "UPDATE tasks SET actual_min = COALESCE(actual_min, 0) + ?1, updated_at = ?2 \
                     WHERE id = ?3",
                    params![actual_min, now_str, task_id],
                )
                .map_err(|e| CoreError::internal(format!("pomodoros sync task actual_min: {e}")))?;
            }
        }
        drop(conn);

        self.get(&running.id)
    }

    pub fn interrupt_running(&self, actual_min: Option<i32>) -> Result<PomodoroSession, CoreError> {
        let running = self.running_session()?.ok_or_else(|| {
            CoreError::conflict(
                "pomodoro_session",
                "no running pomodoro session to interrupt",
            )
        })?;

        let now_str = Utc::now().to_rfc3339();
        let clean_actual = actual_min.filter(|&m| m > 0);

        let conn = self.db.writer();
        conn.execute(
            "UPDATE pomodoro_sessions SET status = 'interrupted', actual_min = ?1, ended_at = ?2, \
             interruptions = interruptions + 1 WHERE id = ?3",
            params![clean_actual, now_str, running.id],
        )
        .map_err(|e| CoreError::internal(format!("pomodoros interrupt_running: {e}")))?;
        drop(conn);

        self.get(&running.id)
    }

    pub fn get(&self, id: &str) -> Result<PomodoroSession, CoreError> {
        let conn = self.db.writer();
        let session = conn
            .query_row(
                "SELECT id, task_id, kind, status, planned_min, actual_min, interruptions, started_at, ended_at \
                 FROM pomodoro_sessions WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("pomodoros get: {e}")))?;

        session.ok_or_else(|| CoreError::not_found("pomodoro_session", id))
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PomodoroSession> {
        let id: String = row.get(0)?;
        let task_id: Option<String> = row.get(1)?;
        let kind_raw: String = row.get(2)?;
        let status_raw: String = row.get(3)?;
        let planned_min: i32 = row.get(4)?;
        let actual_min: Option<i32> = row.get(5)?;
        let interruptions: i32 = row.get(6)?;
        let started_raw: String = row.get(7)?;
        let ended_raw: Option<String> = row.get(8)?;

        let kind = match kind_raw.as_str() {
            "short_break" => SessionKind::ShortBreak,
            "long_break" => SessionKind::LongBreak,
            _ => SessionKind::Focus,
        };
        let status = match status_raw.as_str() {
            "completed" => PomodoroStatus::Completed,
            "interrupted" | "abandoned" => PomodoroStatus::Abandoned,
            _ => PomodoroStatus::Active,
        };
        let started_at = DateTime::parse_from_rfc3339(&started_raw)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        let ended_at = ended_raw.as_deref().and_then(|s| {
            DateTime::parse_from_rfc3339(s)
                .map(|dt| dt.with_timezone(&Utc))
                .ok()
        });

        Ok(PomodoroSession {
            id,
            task_id,
            kind,
            status,
            planned_min,
            actual_min,
            interruptions,
            started_at,
            ended_at,
            note: None,
        })
    }
}
