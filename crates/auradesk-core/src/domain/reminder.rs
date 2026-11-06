//! Reminder entity, status, sound and inputs.

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Status of a reminder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReminderStatus {
    Pending,
    Fired,
    Resolved,
    Snoozed,
    Dismissed,
    Excepted,
}

impl ReminderStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Fired => "fired",
            Self::Resolved => "resolved",
            Self::Snoozed => "snoozed",
            Self::Dismissed => "dismissed",
            Self::Excepted => "excepted",
        }
    }
}

/// Sound played when a reminder fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReminderSound {
    Default,
    Chime,
    Normal,
    Urgent,
    None,
}

impl ReminderSound {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Chime => "chime",
            Self::Normal => "normal",
            Self::Urgent => "urgent",
            Self::None => "none",
        }
    }
}

/// Recurrence pattern for reminders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatKind {
    None,
    Daily,
    Weekly,
    Monthly,
}

impl RepeatKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }
}

/// Strongly-typed Reminder entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub fire_at: DateTime<Utc>,
    pub repeat_kind: RepeatKind,
    pub sound: ReminderSound,
    pub status: ReminderStatus,
    pub snooze_count: i32,
    pub last_snoozed_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub exceptions_log: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input to create a reminder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewReminder {
    pub title: String,
    pub body: Option<String>,
    pub fire_at: DateTime<Utc>,
    pub repeat_kind: RepeatKind,
    pub sound: ReminderSound,
    pub task_id: Option<String>,
}

/// Input to update an existing reminder.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateReminder {
    pub title: Option<String>,
    pub body: Option<Option<String>>,
    pub fire_at: Option<DateTime<Utc>>,
    pub repeat_kind: Option<RepeatKind>,
    pub sound: Option<ReminderSound>,
    pub status: Option<ReminderStatus>,
}
