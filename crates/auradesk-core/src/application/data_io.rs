//! Data export / import — owner sovereignty for the user's data.
//!
//! `DataIoService::export` writes a snapshot of all user-owned tables
//! (projects, tasks, pomodoro_sessions, reminders, daily_plans, settings)
//! into a strongly-typed `DataBundle` or JSON string.
//!
//! `DataIoService::import` validates the entire bundle before committing,
//! and executes all upserts within a single SQLite transaction. If any validation
//! or database constraint fails, the transaction is rolled back, guaranteeing
//! that the database is never left in a partially modified state.

#![allow(missing_docs)]

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::application::daily_plans::DailyPlansService;
use crate::application::github::list_all_links;
use crate::application::pomodoros::PomodorosService;
use crate::application::projects::ProjectsService;
use crate::application::reminders::RemindersService;
use crate::application::settings::SettingsService;
use crate::application::tasks::TasksService;
use crate::domain::daily_plan::DailyPlan;
use crate::domain::github::GithubIssueLink;
use crate::domain::pomodoro::PomodoroSession;
use crate::domain::project::Project;
use crate::domain::reminder::Reminder;
use crate::domain::task::{Task, TaskFilter};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Current bundle version.
///
/// v2 adds `github_issues` (the issue↔task link rows). A v1 bundle is
/// still accepted on import — it simply carries no links.
pub const SCHEMA_VERSION: u32 = 2;

/// Oldest bundle version this build can import.
pub const MIN_SUPPORTED_SCHEMA_VERSION: u32 = 1;

/// A single raw key-value setting record from the database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingItem {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

/// A complete, versioned backup bundle containing all user-owned data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataBundle {
    pub version: u32,
    pub exported_at: String,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub pomodoros: Vec<PomodoroSession>,
    pub reminders: Vec<Reminder>,
    pub daily_plans: Vec<DailyPlan>,
    pub settings: Vec<SettingItem>,
    /// Issue↔task links (ADR-0013). Empty for a v1 bundle.
    #[serde(default)]
    pub github_issues: Vec<GithubIssueLink>,
}

/// Summary of items imported in a successful import transaction.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportSummary {
    pub projects: usize,
    pub tasks: usize,
    pub pomodoros: usize,
    pub reminders: usize,
    pub daily_plans: usize,
    pub settings: usize,
    /// Issue↔task links imported.
    pub github_issues: usize,
}

pub struct DataIoService<'a> {
    db: &'a Db,
}

impl<'a> DataIoService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Export all user-owned data into a strongly-typed `DataBundle`.
    pub fn export(&self) -> Result<DataBundle, CoreError> {
        let projects = ProjectsService::new(self.db).list()?;
        let tasks = TasksService::new(self.db).list(&TaskFilter::default())?;
        let pomodoros = PomodorosService::new(self.db).list(100_000)?;
        let reminders = RemindersService::new(self.db).list(true)?;
        let daily_plans = DailyPlansService::new(self.db).list()?;

        let raw_settings = SettingsService::new(self.db).list_raw()?;
        let settings = raw_settings
            .into_iter()
            .map(|(key, value, updated_at)| SettingItem {
                key,
                value,
                updated_at,
            })
            .collect();

        Ok(DataBundle {
            version: SCHEMA_VERSION,
            exported_at: chrono::Utc::now().to_rfc3339(),
            projects,
            tasks,
            pomodoros,
            reminders,
            daily_plans,
            settings,
            github_issues: list_all_links(self.db)?,
        })
    }

    /// Export all user-owned data as a formatted JSON string.
    pub fn export_json(&self) -> Result<String, CoreError> {
        let bundle = self.export()?;
        serde_json::to_string_pretty(&bundle)
            .map_err(|e| CoreError::internal(format!("export json serialization: {e}")))
    }

    /// Validate and import a `DataBundle` within an atomic transaction.
    ///
    /// If any record is invalid or fails database constraints (such as foreign
    /// key violations), the entire transaction rolls back, leaving the database
    /// untouched.
    pub fn import(&self, bundle: DataBundle) -> Result<ImportSummary, CoreError> {
        if !(MIN_SUPPORTED_SCHEMA_VERSION..=SCHEMA_VERSION).contains(&bundle.version) {
            return Err(CoreError::validation(
                "version",
                format!(
                    "unsupported bundle version {} (expected {}..={})",
                    bundle.version, MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION
                ),
            ));
        }

        // ── Pre-flight validation ──────────────────────────────────────────
        for p in &bundle.projects {
            if p.id.trim().is_empty() {
                return Err(CoreError::validation(
                    "project.id",
                    "project id cannot be empty",
                ));
            }
            if p.name.trim().is_empty() {
                return Err(CoreError::validation(
                    "project.name",
                    "project name cannot be empty",
                ));
            }
            if let Some(c) = &p.color {
                if !validate_hex_color(c) {
                    return Err(CoreError::validation(
                        "project.color",
                        format!("invalid color: {c}"),
                    ));
                }
            }
        }

        for t in &bundle.tasks {
            if t.id.trim().is_empty() {
                return Err(CoreError::validation("task.id", "task id cannot be empty"));
            }
            if t.title.trim().is_empty() {
                return Err(CoreError::validation(
                    "task.title",
                    "task title cannot be empty",
                ));
            }
            if let Some(tags) = &t.tags {
                for tag in tags {
                    if tag.is_empty() || tag.chars().count() > 64 {
                        return Err(CoreError::validation("task.tags", "invalid tag format"));
                    }
                }
            }
        }

        for p in &bundle.pomodoros {
            if p.id.trim().is_empty() {
                return Err(CoreError::validation(
                    "pomodoro.id",
                    "pomodoro id cannot be empty",
                ));
            }
            if p.planned_min <= 0 {
                return Err(CoreError::validation(
                    "pomodoro.planned_min",
                    "planned_min must be positive",
                ));
            }
            if let Some(act) = p.actual_min {
                if act < 0 {
                    return Err(CoreError::validation(
                        "pomodoro.actual_min",
                        "actual_min cannot be negative",
                    ));
                }
            }
            if p.interruptions < 0 {
                return Err(CoreError::validation(
                    "pomodoro.interruptions",
                    "interruptions cannot be negative",
                ));
            }
        }

        for r in &bundle.reminders {
            if r.id.trim().is_empty() {
                return Err(CoreError::validation(
                    "reminder.id",
                    "reminder id cannot be empty",
                ));
            }
            if r.title.trim().is_empty() {
                return Err(CoreError::validation(
                    "reminder.title",
                    "reminder title cannot be empty",
                ));
            }
            if r.snooze_count < 0 {
                return Err(CoreError::validation(
                    "reminder.snooze_count",
                    "snooze_count cannot be negative",
                ));
            }
            if let Some(log) = &r.exceptions_log {
                if serde_json::from_str::<serde_json::Value>(log).is_err() {
                    return Err(CoreError::validation(
                        "reminder.exceptions_log",
                        "exceptions_log must be valid JSON",
                    ));
                }
            }
        }

        for d in &bundle.daily_plans {
            if d.id.trim().is_empty() {
                return Err(CoreError::validation(
                    "daily_plan.id",
                    "daily plan id cannot be empty",
                ));
            }
            if d.plan_date.len() != 10 {
                return Err(CoreError::validation(
                    "daily_plan.plan_date",
                    format!("invalid plan_date format: {}", d.plan_date),
                ));
            }
        }

        for s in &bundle.settings {
            if s.key.trim().is_empty() {
                return Err(CoreError::validation(
                    "setting.key",
                    "setting key cannot be empty",
                ));
            }
        }

        for g in &bundle.github_issues {
            if g.id.trim().is_empty() {
                return Err(CoreError::validation(
                    "github_issue.id",
                    "github issue id cannot be empty",
                ));
            }
            if g.external_id.trim().is_empty() {
                return Err(CoreError::validation(
                    "github_issue.external_id",
                    "github issue external id cannot be empty",
                ));
            }
            if g.issue_number <= 0 {
                return Err(CoreError::validation(
                    "github_issue.issue_number",
                    "github issue number must be positive",
                ));
            }
        }

        // ── Transactional execution ────────────────────────────────────────
        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("begin import tx: {e}")))?;

        let mut summary = ImportSummary::default();

        // 1. Projects (must precede tasks due to foreign keys)
        for p in &bundle.projects {
            let start = p.start_date.map(|d| d.to_string());
            let target = p.target_date.map(|d| d.to_string());
            let created = p.created_at.to_rfc3339();
            let updated = p.updated_at.to_rfc3339();

            tx.execute(
                "INSERT INTO projects \
                 (id, name, description, color, parent_id, status, start_date, target_date, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
                 ON CONFLICT(id) DO UPDATE SET \
                   name = excluded.name, \
                   description = excluded.description, \
                   color = excluded.color, \
                   parent_id = excluded.parent_id, \
                   status = excluded.status, \
                   start_date = excluded.start_date, \
                   target_date = excluded.target_date, \
                   created_at = excluded.created_at, \
                   updated_at = excluded.updated_at",
                params![
                    p.id, p.name, p.description, p.color, p.parent_id,
                    p.status.as_str(), start, target, created, updated,
                ],
            )
            .map_err(|e| CoreError::internal(format!("import project {}: {e}", p.id)))?;
            summary.projects += 1;
        }

        // 2. Tasks (must precede pomodoros and reminders due to foreign keys)
        for t in &bundle.tasks {
            let tags = t
                .tags
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".into()));
            let due = t.due_at.map(|d| d.to_rfc3339());
            let started = t.started_at.map(|d| d.to_rfc3339());
            let completed = t.completed_at.map(|d| d.to_rfc3339());
            let created = t.created_at.to_rfc3339();
            let updated = t.updated_at.to_rfc3339();

            tx.execute(
                "INSERT INTO tasks \
                 (id, project_id, parent_task_id, recurrence_id, title, description, priority, \
                  status, kanban_order, due_at, started_at, completed_at, estimate_min, actual_min, \
                  tags, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17) \
                 ON CONFLICT(id) DO UPDATE SET \
                   project_id = excluded.project_id, \
                   parent_task_id = excluded.parent_task_id, \
                   recurrence_id = excluded.recurrence_id, \
                   title = excluded.title, \
                   description = excluded.description, \
                   priority = excluded.priority, \
                   status = excluded.status, \
                   kanban_order = excluded.kanban_order, \
                   due_at = excluded.due_at, \
                   started_at = excluded.started_at, \
                   completed_at = excluded.completed_at, \
                   estimate_min = excluded.estimate_min, \
                   actual_min = excluded.actual_min, \
                   tags = excluded.tags, \
                   created_at = excluded.created_at, \
                   updated_at = excluded.updated_at",
                params![
                    t.id, t.project_id, t.parent_task_id, t.recurrence_id, t.title, t.description,
                    t.priority.as_str(), t.status.as_str(), t.kanban_order, due, started, completed,
                    t.estimate_min, t.actual_min, tags, created, updated,
                ],
            )
            .map_err(|e| CoreError::internal(format!("import task {}: {e}", t.id)))?;
            summary.tasks += 1;
        }

        // 3. Pomodoro sessions
        for p in &bundle.pomodoros {
            let started = p.started_at.to_rfc3339();
            let ended = p.ended_at.map(|d| d.to_rfc3339());

            tx.execute(
                "INSERT INTO pomodoro_sessions \
                 (id, task_id, kind, started_at, ended_at, planned_min, actual_min, status, interruptions) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
                 ON CONFLICT(id) DO UPDATE SET \
                   task_id = excluded.task_id, \
                   kind = excluded.kind, \
                   started_at = excluded.started_at, \
                   ended_at = excluded.ended_at, \
                   planned_min = excluded.planned_min, \
                   actual_min = excluded.actual_min, \
                   status = excluded.status, \
                   interruptions = excluded.interruptions",
                params![
                    p.id, p.task_id, p.kind.as_str(), started, ended,
                    p.planned_min, p.actual_min, p.status.as_str(), p.interruptions,
                ],
            )
            .map_err(|e| CoreError::internal(format!("import pomodoro {}: {e}", p.id)))?;
            summary.pomodoros += 1;
        }

        // 4. Reminders
        for r in &bundle.reminders {
            let fire = r.fire_at.to_rfc3339();
            let last_snooze = r.last_snoozed_at.map(|d| d.to_rfc3339());
            let resolved = r.resolved_at.map(|d| d.to_rfc3339());
            let created = r.created_at.to_rfc3339();
            let updated = r.updated_at.to_rfc3339();

            tx.execute(
                "INSERT INTO reminders \
                 (id, task_id, title, body, fire_at, repeat_kind, sound, status, snooze_count, \
                  last_snoozed_at, resolved_at, exceptions_log, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
                 ON CONFLICT(id) DO UPDATE SET \
                   task_id = excluded.task_id, \
                   title = excluded.title, \
                   body = excluded.body, \
                   fire_at = excluded.fire_at, \
                   repeat_kind = excluded.repeat_kind, \
                   sound = excluded.sound, \
                   status = excluded.status, \
                   snooze_count = excluded.snooze_count, \
                   last_snoozed_at = excluded.last_snoozed_at, \
                   resolved_at = excluded.resolved_at, \
                   exceptions_log = excluded.exceptions_log, \
                   created_at = excluded.created_at, \
                   updated_at = excluded.updated_at",
                params![
                    r.id,
                    r.task_id,
                    r.title,
                    r.body,
                    fire,
                    r.repeat_kind.as_str(),
                    r.sound.as_str(),
                    r.status.as_str(),
                    r.snooze_count,
                    last_snooze,
                    resolved,
                    r.exceptions_log,
                    created,
                    updated,
                ],
            )
            .map_err(|e| CoreError::internal(format!("import reminder {}: {e}", r.id)))?;
            summary.reminders += 1;
        }

        // 5. Daily plans
        for d in &bundle.daily_plans {
            let started = d.started_at.map(|d| d.to_rfc3339());
            let completed = d.completed_at.map(|d| d.to_rfc3339());
            let created = d.created_at.to_rfc3339();
            let updated = d.updated_at.to_rfc3339();

            tx.execute(
                "INSERT INTO daily_plans \
                 (id, plan_date, state, started_at, completed_at, payload, rollover_from, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
                 ON CONFLICT(id) DO UPDATE SET \
                   plan_date = excluded.plan_date, \
                   state = excluded.state, \
                   started_at = excluded.started_at, \
                   completed_at = excluded.completed_at, \
                   payload = excluded.payload, \
                   rollover_from = excluded.rollover_from, \
                   created_at = excluded.created_at, \
                   updated_at = excluded.updated_at",
                params![
                    d.id, d.plan_date, d.state.as_str(), started, completed,
                    d.payload, d.rollover_from, created, updated,
                ],
            )
            .map_err(|e| CoreError::internal(format!("import daily_plan {}: {e}", d.id)))?;
            summary.daily_plans += 1;
        }

        // 6. Settings
        for s in &bundle.settings {
            tx.execute(
                "INSERT INTO settings (key, value, updated_at) \
                 VALUES (?1, ?2, ?3) \
                 ON CONFLICT(key) DO UPDATE SET \
                   value = excluded.value, \
                   updated_at = excluded.updated_at",
                params![s.key, s.value, s.updated_at],
            )
            .map_err(|e| CoreError::internal(format!("import setting {}: {e}", s.key)))?;
            summary.settings += 1;
        }

        // 7. GitHub issue links (must follow tasks — FK on task_id).
        for g in &bundle.github_issues {
            let labels_json = g
                .labels
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".into()));
            tx.execute(
                "INSERT INTO github_issues \
                 (id, source, external_id, repo, issue_number, issue_url, title, body, \
                  labels, source_status, source_updated_at, task_id, title_locked, \
                  created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, NULL, ?10, ?11, ?12, ?12) \
                 ON CONFLICT(id) DO UPDATE SET \
                   source = excluded.source, \
                   external_id = excluded.external_id, \
                   repo = excluded.repo, \
                   issue_number = excluded.issue_number, \
                   issue_url = excluded.issue_url, \
                   title = excluded.title, \
                   labels = excluded.labels, \
                   source_status = excluded.source_status, \
                   task_id = excluded.task_id, \
                   title_locked = excluded.title_locked, \
                   updated_at = excluded.updated_at",
                params![
                    g.id,
                    g.source,
                    g.external_id,
                    g.repo,
                    g.issue_number,
                    g.issue_url,
                    g.title,
                    labels_json,
                    g.source_status.as_str(),
                    g.task_id,
                    if g.title_locked { 1i64 } else { 0i64 },
                    g.created_at,
                ],
            )
            .map_err(|e| CoreError::internal(format!("import github_issue {}: {e}", g.id)))?;
            summary.github_issues += 1;
        }

        tx.commit()
            .map_err(|e| CoreError::internal(format!("commit import transaction: {e}")))?;

        Ok(summary)
    }

    /// Parse a JSON string and import the bundle transactionally.
    pub fn import_json(&self, json_str: &str) -> Result<ImportSummary, CoreError> {
        let bundle: DataBundle = serde_json::from_str(json_str)
            .map_err(|e| CoreError::validation("json", format!("invalid json bundle: {e}")))?;
        self.import(bundle)
    }
}

fn validate_hex_color(s: &str) -> bool {
    if s.len() != 7 || !s.starts_with('#') {
        return false;
    }
    s[1..].chars().all(|c| c.is_ascii_hexdigit())
}
