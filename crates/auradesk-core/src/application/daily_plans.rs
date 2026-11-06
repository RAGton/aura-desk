//! Daily plans application service.

#![allow(missing_docs)]

use crate::domain::daily_plan::DailyPlan;
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
}
