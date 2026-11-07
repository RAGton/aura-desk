//! Routine domain entities (`routines` table).

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineKind {
    Water,
    Break,
    DailyPlanning,
    Custom,
}

impl RoutineKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Water => "water",
            Self::Break => "break",
            Self::DailyPlanning => "daily_planning",
            Self::Custom => "custom",
        }
    }

    pub fn from_db(s: &str) -> Option<Self> {
        Some(match s {
            "water" => Self::Water,
            "break" => Self::Break,
            "daily_planning" => Self::DailyPlanning,
            "custom" => Self::Custom,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Routine {
    pub id: String,
    pub kind: RoutineKind,
    pub title: String,
    pub body: Option<String>,
    pub cron_expr: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub enabled: bool,
    pub metadata: Option<String>,
    pub last_fired_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
