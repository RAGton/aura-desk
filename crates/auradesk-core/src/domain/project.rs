//! Project entity and inputs.

#![allow(missing_docs)]

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Status of a project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Active,
    Archived,
    Completed,
    OnHold,
}

impl ProjectStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
            Self::Completed => "completed",
            Self::OnHold => "on_hold",
        }
    }
}

/// Strongly-typed Project entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    pub status: ProjectStatus,
    pub start_date: Option<NaiveDate>,
    pub target_date: Option<NaiveDate>,
    pub archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input to create a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewProject {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub target_date: Option<NaiveDate>,
}
