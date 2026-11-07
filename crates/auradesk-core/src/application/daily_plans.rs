//! Daily plans application service backed by SQLite (`daily_plans`).

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};

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
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare(
                "SELECT id, plan_date, state, started_at, completed_at, payload, rollover_from, created_at, updated_at \
                 FROM daily_plans ORDER BY plan_date DESC",
            )
            .map_err(|e| CoreError::internal(format!("daily_plans list prepare: {e}")))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| CoreError::internal(format!("daily_plans list query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("daily_plans row: {e}")))?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<DailyPlan, CoreError> {
        let conn = self.db.writer();
        let plan = conn
            .query_row(
                "SELECT id, plan_date, state, started_at, completed_at, payload, rollover_from, created_at, updated_at \
                 FROM daily_plans WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("daily_plans get: {e}")))?;

        plan.ok_or_else(|| CoreError::not_found("daily_plan", id))
    }

    pub fn get_by_date(&self, plan_date: &str) -> Result<Option<DailyPlan>, CoreError> {
        let conn = self.db.writer();
        conn.query_row(
            "SELECT id, plan_date, state, started_at, completed_at, payload, rollover_from, created_at, updated_at \
             FROM daily_plans WHERE plan_date = ?1",
            params![plan_date],
            Self::map_row,
        )
        .optional()
        .map_err(|e| CoreError::internal(format!("daily_plans get_by_date: {e}")))
    }

    pub fn create_for_date(
        &self,
        plan_date: &str,
        payload: Option<String>,
    ) -> Result<DailyPlan, CoreError> {
        if plan_date.len() != 10 {
            return Err(CoreError::validation(
                "plan_date",
                "plan_date must be YYYY-MM-DD",
            ));
        }
        if let Some(ref p) = payload {
            if serde_json::from_str::<serde_json::Value>(p).is_err() {
                return Err(CoreError::validation(
                    "payload",
                    "payload must be valid JSON",
                ));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        let res = conn.execute(
            "INSERT INTO daily_plans (id, plan_date, state, started_at, completed_at, payload, rollover_from, created_at, updated_at) \
             VALUES (?1, ?2, 'not_started', NULL, NULL, ?3, NULL, ?4, ?4)",
            params![id, plan_date, payload, now_str],
        );

        match res {
            Ok(_) => {
                drop(conn);
                self.get(&id)
            }
            Err(rusqlite::Error::SqliteFailure(err, _))
                if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
            {
                Err(CoreError::conflict(
                    "daily_plan",
                    format!("daily plan already exists for {plan_date}"),
                ))
            }
            Err(e) => Err(CoreError::internal(format!("daily_plans create: {e}"))),
        }
    }

    pub fn current_or_create(&self) -> Result<DailyPlan, CoreError> {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        if let Some(existing) = self.get_by_date(&today)? {
            return Ok(existing);
        }
        self.create_for_date(&today, None)
    }

    pub fn set_state(&self, id: &str, state: PlanState) -> Result<DailyPlan, CoreError> {
        let existing = self.get(id)?;
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        let started_at = match state {
            PlanState::InProgress => Some(existing.started_at.unwrap_or(now).to_rfc3339()),
            _ => existing.started_at.map(|d| d.to_rfc3339()),
        };
        let completed_at = match state {
            PlanState::Completed => Some(now_str.clone()),
            _ => existing.completed_at.map(|d| d.to_rfc3339()),
        };

        let conn = self.db.writer();
        conn.execute(
            "UPDATE daily_plans SET state = ?1, started_at = ?2, completed_at = ?3, updated_at = ?4 WHERE id = ?5",
            params![state.as_str(), started_at, completed_at, now_str, id],
        )
        .map_err(|e| CoreError::internal(format!("daily_plans set_state: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn set_payload(&self, id: &str, payload: Option<String>) -> Result<DailyPlan, CoreError> {
        let _ = self.get(id)?;
        if let Some(ref p) = payload {
            if serde_json::from_str::<serde_json::Value>(p).is_err() {
                return Err(CoreError::validation(
                    "payload",
                    "payload must be valid JSON",
                ));
            }
        }
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE daily_plans SET payload = ?1, updated_at = ?2 WHERE id = ?3",
            params![payload, now_str, id],
        )
        .map_err(|e| CoreError::internal(format!("daily_plans set_payload: {e}")))?;
        drop(conn);

        self.get(id)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DailyPlan> {
        let id: String = row.get(0)?;
        let plan_date: String = row.get(1)?;
        let state_raw: String = row.get(2)?;
        let started_raw: Option<String> = row.get(3)?;
        let completed_raw: Option<String> = row.get(4)?;
        let payload: Option<String> = row.get(5)?;
        let rollover_from: Option<String> = row.get(6)?;
        let created_raw: String = row.get(7)?;
        let updated_raw: String = row.get(8)?;

        Ok(DailyPlan {
            id,
            plan_date,
            state: PlanState::from_db(&state_raw).unwrap_or(PlanState::NotStarted),
            started_at: parse_opt_dt(started_raw.as_deref()),
            completed_at: parse_opt_dt(completed_raw.as_deref()),
            payload,
            rollover_from,
            created_at: parse_dt(&created_raw),
            updated_at: parse_dt(&updated_raw),
        })
    }
}

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn parse_opt_dt(s: Option<&str>) -> Option<DateTime<Utc>> {
    s.and_then(|v| {
        DateTime::parse_from_rfc3339(v)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    })
}
