//! Alert entity, severity, resolution and inputs.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Severity of an alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertSeverity {
    Info,
    Low,
    Normal,
    High,
    Warning,
    Urgent,
    Critical,
}

impl AlertSeverity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Warning => "warning",
            Self::Urgent => "urgent",
            Self::Critical => "critical",
        }
    }
}

/// Resolution state of an alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertResolution {
    Resolved,
    Snoozed,
    Dismissed,
    Excepted,
}

impl AlertResolution {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Resolved => "resolved",
            Self::Snoozed => "snoozed",
            Self::Dismissed => "dismissed",
            Self::Excepted => "excepted",
        }
    }
}

/// Strongly-typed Alert entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub severity: AlertSeverity,
    pub ref_id: Option<String>,
    pub options: Option<String>,
    pub resolution: Option<AlertResolution>,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

/// Input to create an alert.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewAlert {
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub severity: AlertSeverity,
    pub ref_id: Option<String>,
    pub options: Option<String>,
}
