//! Daily plans application service.

#![allow(missing_docs)]

use chrono::Utc;

use crate::domain::daily_plan::{DailyPlan, PlanState};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing daily plans.
pub struct DailyPlansService<'a> {
    pub db: &'a Db,
}

impl<'a> DailyPlansService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn list(&self) -> Result<Vec<DailyPlan>, CoreError> {
        Ok(Vec::new())
    }

    pub fn current_or_create(&self) -> Result<DailyPlan, CoreError> {
        let now = Utc::now();
        let today = now.format("%Y-%m-%d").to_string();
        Ok(DailyPlan {
            id: uuid::Uuid::new_v4().to_string(),
            plan_date: today,
            state: PlanState::NotStarted,
            started_at: None,
            completed_at: None,
            payload: None,
            rollover_from: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn set_state(&self, id: &str, state: PlanState) -> Result<DailyPlan, CoreError> {
        let now = Utc::now();
        let today = now.format("%Y-%m-%d").to_string();
        Ok(DailyPlan {
            id: id.to_string(),
            plan_date: today,
            state,
            started_at: if matches!(state, PlanState::InProgress) {
                Some(now)
            } else {
                None
            },
            completed_at: if matches!(state, PlanState::Completed) {
                Some(now)
            } else {
                None
            },
            payload: None,
            rollover_from: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn set_payload(&self, id: &str, payload: Option<String>) -> Result<DailyPlan, CoreError> {
        let now = Utc::now();
        let today = now.format("%Y-%m-%d").to_string();
        Ok(DailyPlan {
            id: id.to_string(),
            plan_date: today,
            state: PlanState::InProgress,
            started_at: Some(now),
            completed_at: None,
            payload,
            rollover_from: None,
            created_at: now,
            updated_at: now,
        })
    }
}
