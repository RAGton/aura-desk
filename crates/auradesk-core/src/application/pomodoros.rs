//! Pomodoros application service.

#![allow(missing_docs)]

use crate::domain::pomodoro::{NewPomodoroSession, PomodoroSession, PomodoroStatus, SessionKind};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing pomodoro sessions.
pub struct PomodorosService<'a> {
    pub db: &'a Db,
}

impl<'a> PomodorosService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn list(&self, _limit: impl Into<i64>) -> Result<Vec<PomodoroSession>, CoreError> {
        Ok(Vec::new())
    }

    pub fn running_session(&self) -> Result<Option<PomodoroSession>, CoreError> {
        Ok(None)
    }

    pub fn interrupt_running(&self, actual_min: Option<i32>) -> Result<PomodoroSession, CoreError> {
        let now = chrono::Utc::now();
        Ok(PomodoroSession {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: None,
            kind: SessionKind::Focus,
            status: PomodoroStatus::Abandoned,
            planned_min: actual_min.unwrap_or(0),
            actual_min,
            interruptions: 1,
            started_at: now,
            ended_at: Some(now),
            note: None,
        })
    }

    pub fn start(&self, new: NewPomodoroSession) -> Result<PomodoroSession, CoreError> {
        let now = chrono::Utc::now();
        Ok(PomodoroSession {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: new.task_id,
            kind: new.kind,
            status: PomodoroStatus::Active,
            planned_min: new.planned_min,
            actual_min: None,
            interruptions: 0,
            started_at: now,
            ended_at: None,
            note: None,
        })
    }

    pub fn complete_running(&self, actual_min: i32) -> Result<PomodoroSession, CoreError> {
        let now = chrono::Utc::now();
        Ok(PomodoroSession {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: None,
            kind: SessionKind::Focus,
            status: PomodoroStatus::Completed,
            planned_min: actual_min,
            actual_min: Some(actual_min),
            interruptions: 0,
            started_at: now,
            ended_at: Some(now),
            note: None,
        })
    }
}
