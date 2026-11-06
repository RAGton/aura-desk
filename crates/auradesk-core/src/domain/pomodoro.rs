//! Pomodoro session entity and inputs.

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Kind of pomodoro session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Focus,
    ShortBreak,
    LongBreak,
}

impl SessionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::ShortBreak => "short_break",
            Self::LongBreak => "long_break",
        }
    }
}

/// Status of a pomodoro session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PomodoroStatus {
    Active,
    Completed,
    Abandoned,
}

impl PomodoroStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Abandoned => "abandoned",
        }
    }
}

/// Strongly-typed PomodoroSession entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PomodoroSession {
    pub id: String,
    pub task_id: Option<String>,
    pub kind: SessionKind,
    pub status: PomodoroStatus,
    pub planned_min: i32,
    pub actual_min: Option<i32>,
    pub interruptions: i32,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

/// Input to create / start a pomodoro session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewPomodoroSession {
    pub kind: SessionKind,
    pub planned_min: i32,
    pub task_id: Option<String>,
}
