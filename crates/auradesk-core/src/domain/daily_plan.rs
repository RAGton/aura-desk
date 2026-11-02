//! Daily plan domain. One row per local date (UNIQUE on `plan_date`).
//! A plan tracks the user's intent for the day: started/completed/
//! skipped, with an optional JSON payload (proposed tasks, free-form
//! notes) that the spec reserves for Phase 4 (daily_planning routine).
//!
//! The schema is `daily_plans(id, plan_date, state, started_at,
//! completed_at, payload, rollover_from, created_at, updated_at)`.
#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanState {
    NotStarted,
    InProgress,
    Completed,
    Skipped,
}

impl PlanState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_db(s: &str) -> Option<Self> {
        Some(match s {
            "not_started" => Self::NotStarted,
            "in_progress" => Self::InProgress,
            "completed" => Self::Completed,
            "skipped" => Self::Skipped,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailyPlan {
    pub id: String,
    pub plan_date: String, // YYYY-MM-DD local
    pub state: PlanState,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub payload: Option<String>, // JSON
    pub rollover_from: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
