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
//!
//! # Secrets never leave the app in a backup
//!
//! Credential settings (`ai.api_key`, `raglight.api_key` — see
//! [`SettingsKey::SENSITIVE`]) are **redacted** in every export path:
//!
//! * `DataBundle.settings` (and therefore `bundle.json` / `export_json`);
//! * the `settings.json` entry of the `.zip` backup;
//! * the `auradesk.db` entry of the `.zip` backup — the embedded SQLite
//!   snapshot is post-processed before being written into the archive,
//!   because the `settings` table inside it would otherwise carry the
//!   cleartext key.
//!
//! The redaction placeholder ([`REDACTED_SETTING_VALUE`]) is written in
//! place of the credential. On import, a sensitive setting whose value is
//! the placeholder is **skipped**: the credential already stored in the
//! local database is preserved and never overwritten by a masked value.
//! Importing a redacted backup therefore always succeeds and never
//! silently clears the user's configuration — the user only has to
//! re-enter the API key when restoring onto a machine that never had one.

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
use crate::domain::settings_key::SettingsKey;
use crate::domain::task::{Task, TaskFilter};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Placeholder written in place of a credential in an export.
///
/// It is deliberately distinctive so a masked value can never be
/// confused with a real API key, and it round-trips through the import
/// path: a sensitive setting carrying this exact value is ignored.
pub const REDACTED_SETTING_VALUE: &str = "__AURADESK_REDACTED__";

/// Current bundle version.
///
/// v2 adds `github_issues` (the issue↔task link rows). A v1 bundle is
/// still accepted on import — it simply carries no links.
pub const SCHEMA_VERSION: u32 = 2;

/// Oldest bundle version this build can import.
pub const MIN_SUPPORTED_SCHEMA_VERSION: u32 = 1;

/// Whether `key` names a credential setting.
///
/// The lookup goes through [`SettingsKey`] so the set of secrets is
/// declared in exactly one place (`SettingsKey::SENSITIVE`).
fn is_sensitive_key(key: &str) -> bool {
    SettingsKey::from_str(key).is_some_and(|k| k.is_sensitive())
}

/// The JSON-encoded placeholder stored in the `settings` table for a
/// redacted credential.
fn redacted_setting_value() -> String {
    serde_json::to_string(REDACTED_SETTING_VALUE)
        .unwrap_or_else(|_| format!("\"{REDACTED_SETTING_VALUE}\""))
}

/// Whether a stored setting value is the redaction placeholder.
///
/// The stored value is a JSON string; both the JSON-encoded form and the
/// bare form are accepted so a hand-edited backup is still recognized.
fn is_redacted_value(stored: &str) -> bool {
    let trimmed = stored.trim();
    if trimmed == REDACTED_SETTING_VALUE {
        return true;
    }
    serde_json::from_str::<String>(trimmed)
        .map(|v| v == REDACTED_SETTING_VALUE)
        .unwrap_or(false)
}

/// Replace the value of every credential setting with the redaction
/// placeholder.
///
/// The `settings` table stores JSON-encoded values, so the placeholder is
/// stored JSON-encoded too.
fn redact_sensitive_settings(rows: Vec<(String, String, String)>) -> Vec<(String, String, String)> {
    rows.into_iter()
        .map(|(key, value, updated_at)| {
            if is_sensitive_key(&key) {
                (key, redacted_setting_value(), updated_at)
            } else {
                (key, value, updated_at)
            }
        })
        .collect()
}

/// Redact credentials inside an embedded SQLite backup.
///
/// The `.zip` backup carries a full `auradesk.db` snapshot, and that
/// snapshot's `settings` table holds the cleartext API key. Redacting
/// only the sibling `settings.json` would leave the secret in the
/// archive, so the database file itself is sanitized before it is
/// written into the ZIP.
///
/// The snapshot is round-tripped through a temporary file: it is opened
/// with a plain SQLite connection (not [`Db::open`], which would run
/// migrations against the snapshot), the credential rows are updated, and
/// the file is read back.
///
/// The operation only replaces the `settings` rows of the copy — every
/// other table is preserved byte-for-byte as SQLite stores it.
fn sanitize_db_bytes(db_bytes: Vec<u8>) -> Result<Vec<u8>, CoreError> {
    use rusqlite::Connection;

    if db_bytes.is_empty() {
        return Ok(db_bytes);
    }

    let tmp_dir = std::env::temp_dir().join(format!("auradesk-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| CoreError::internal(format!("create export temp dir: {e}")))?;
    let tmp_db_path = tmp_dir.join("auradesk.db");

    let result = (|| -> Result<Vec<u8>, CoreError> {
        std::fs::write(&tmp_db_path, &db_bytes)
            .map_err(|e| CoreError::internal(format!("write export temp db: {e}")))?;

        {
            let conn = Connection::open(&tmp_db_path)
                .map_err(|e| CoreError::internal(format!("open export temp db: {e}")))?;
            // The snapshot may be a WAL database; make sure the redacted
            // rows land in the main database file and not in a sidecar
            // WAL that would not be embedded in the ZIP.
            conn.pragma_update(None, "journal_mode", "DELETE")
                .map_err(|e| CoreError::internal(format!("export temp db journal_mode: {e}")))?;

            let placeholder = redacted_setting_value();
            for key in SettingsKey::SENSITIVE {
                conn.execute(
                    "UPDATE settings SET value = ?1 WHERE key = ?2",
                    params![placeholder, key.as_str()],
                )
                .map_err(|e| {
                    CoreError::internal(format!("redact setting {}: {e}", key.as_str()))
                })?;
            }

            conn.execute_batch("VACUUM")
                .map_err(|e| CoreError::internal(format!("export temp db vacuum: {e}")))?;
        }

        std::fs::read(&tmp_db_path)
            .map_err(|e| CoreError::internal(format!("read export temp db: {e}")))
    })();

    let _ = std::fs::remove_dir_all(&tmp_dir);
    result
}

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
    ///
    /// Credential settings are replaced with
    /// [`REDACTED_SETTING_VALUE`] — the cleartext API key never reaches
    /// the returned bundle.
    pub fn export(&self) -> Result<DataBundle, CoreError> {
        let projects = ProjectsService::new(self.db).list()?;
        let tasks = TasksService::new(self.db).list(&TaskFilter::default())?;
        let pomodoros = PomodorosService::new(self.db).list(100_000)?;
        let reminders = RemindersService::new(self.db).list(true)?;
        let daily_plans = DailyPlansService::new(self.db).list()?;

        let raw_settings = redact_sensitive_settings(SettingsService::new(self.db).list_raw()?);
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
        //
        // A credential whose value is the redaction placeholder is skipped:
        // the local value is preserved instead of being overwritten by a
        // masked one. This keeps "restore a backup exported from another
        // machine" working without wiping the API key the user already
        // configured locally.
        for s in &bundle.settings {
            if is_sensitive_key(&s.key) && is_redacted_value(&s.value) {
                continue;
            }
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

    /// Build the formatted JSON audit log (`notifications`, `ia_commands`, `ia_proposals`).
    pub fn export_audit_log_json(&self) -> Result<String, CoreError> {
        let conn = self.db.writer();
        let mut notifications = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT id, alert_id, proposal_id, kind, ref_id, title, body, delivered_at, read_at \
                     FROM notifications ORDER BY delivered_at DESC",
                )
                .map_err(|e| CoreError::internal(format!("audit notifications prepare: {e}")))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "alert_id": r.get::<_, Option<String>>(1)?,
                        "proposal_id": r.get::<_, Option<String>>(2)?,
                        "kind": r.get::<_, String>(3)?,
                        "ref_id": r.get::<_, Option<String>>(4)?,
                        "title": r.get::<_, String>(5)?,
                        "body": r.get::<_, Option<String>>(6)?,
                        "delivered_at": r.get::<_, String>(7)?,
                        "read_at": r.get::<_, Option<String>>(8)?,
                    }))
                })
                .map_err(|e| CoreError::internal(format!("audit notifications query: {e}")))?;
            for row in rows {
                notifications.push(
                    row.map_err(|e| CoreError::internal(format!("audit notifications row: {e}")))?,
                );
            }
        }

        let mut ia_commands = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT id, source, tool_name, args_json, result_status, result_message, proposal_id, invoked_at \
                     FROM ia_commands ORDER BY invoked_at DESC",
                )
                .map_err(|e| CoreError::internal(format!("audit ia_commands prepare: {e}")))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "source": r.get::<_, String>(1)?,
                        "tool_name": r.get::<_, String>(2)?,
                        "args_json": r.get::<_, String>(3)?,
                        "result_status": r.get::<_, String>(4)?,
                        "result_message": r.get::<_, Option<String>>(5)?,
                        "proposal_id": r.get::<_, Option<String>>(6)?,
                        "invoked_at": r.get::<_, String>(7)?,
                    }))
                })
                .map_err(|e| CoreError::internal(format!("audit ia_commands query: {e}")))?;
            for row in rows {
                ia_commands.push(
                    row.map_err(|e| CoreError::internal(format!("audit ia_commands row: {e}")))?,
                );
            }
        }

        let mut ia_proposals = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT id, source, kind, summary, status, created_at, expires_at, decided_at, decision_note, result_ref_id, decided_by \
                     FROM ia_proposals ORDER BY created_at DESC",
                )
                .map_err(|e| CoreError::internal(format!("audit ia_proposals prepare: {e}")))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "source": r.get::<_, String>(1)?,
                        "kind": r.get::<_, String>(2)?,
                        "summary": r.get::<_, String>(3)?,
                        "status": r.get::<_, String>(4)?,
                        "created_at": r.get::<_, String>(5)?,
                        "expires_at": r.get::<_, String>(6)?,
                        "decided_at": r.get::<_, Option<String>>(7)?,
                        "decision_note": r.get::<_, Option<String>>(8)?,
                        "result_ref_id": r.get::<_, Option<String>>(9)?,
                        "decided_by": r.get::<_, Option<String>>(10)?,
                    }))
                })
                .map_err(|e| CoreError::internal(format!("audit ia_proposals query: {e}")))?;
            for row in rows {
                ia_proposals.push(
                    row.map_err(|e| CoreError::internal(format!("audit ia_proposals row: {e}")))?,
                );
            }
        }
        drop(conn);

        serde_json::to_string_pretty(&serde_json::json!({
            "schema_version": SCHEMA_VERSION,
            "exported_at": chrono::Utc::now().to_rfc3339(),
            "notifications": notifications,
            "ia_commands": ia_commands,
            "ia_proposals": ia_proposals,
        }))
        .map_err(|e| CoreError::internal(format!("audit_log json serialization: {e}")))
    }

    /// Export a `.zip` archive containing `auradesk.db`, `settings.json`, and `audit-log.json`.
    ///
    /// Credentials are redacted from both the `settings.json` entry and the
    /// embedded `auradesk.db` snapshot (see
    /// [`REDACTED_SETTING_VALUE`]).
    pub fn export_zip_bytes(&self) -> Result<Vec<u8>, CoreError> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        use zip::{CompressionMethod, ZipWriter};

        let db_bytes = sanitize_db_bytes(self.db.backup_to_bytes()?)?;
        let settings: Vec<SettingItem> =
            redact_sensitive_settings(SettingsService::new(self.db).list_raw()?)
                .into_iter()
                .map(|(key, value, updated_at)| SettingItem {
                    key,
                    value,
                    updated_at,
                })
                .collect();
        let settings_json = serde_json::to_string_pretty(&settings)
            .map_err(|e| CoreError::internal(format!("export settings.json: {e}")))?;
        let audit_json = self.export_audit_log_json()?;

        let buf = std::io::Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        writer
            .start_file("auradesk.db", opts)
            .map_err(|e| CoreError::internal(format!("zip start auradesk.db: {e}")))?;
        writer
            .write_all(&db_bytes)
            .map_err(|e| CoreError::internal(format!("zip write auradesk.db: {e}")))?;

        writer
            .start_file("settings.json", opts)
            .map_err(|e| CoreError::internal(format!("zip start settings.json: {e}")))?;
        writer
            .write_all(settings_json.as_bytes())
            .map_err(|e| CoreError::internal(format!("zip write settings.json: {e}")))?;

        writer
            .start_file("audit-log.json", opts)
            .map_err(|e| CoreError::internal(format!("zip start audit-log.json: {e}")))?;
        writer
            .write_all(audit_json.as_bytes())
            .map_err(|e| CoreError::internal(format!("zip write audit-log.json: {e}")))?;

        let bundle_json = self.export_json()?;
        let stored_opts =
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer
            .start_file("bundle.json", stored_opts)
            .map_err(|e| CoreError::internal(format!("zip start bundle.json: {e}")))?;
        writer
            .write_all(bundle_json.as_bytes())
            .map_err(|e| CoreError::internal(format!("zip write bundle.json: {e}")))?;

        let cursor = writer
            .finish()
            .map_err(|e| CoreError::internal(format!("zip finish: {e}")))?;
        Ok(cursor.into_inner())
    }

    /// Export the `.zip` backup encoded as standard base64 (for IPC transport).
    pub fn export_zip_base64(&self) -> Result<String, CoreError> {
        use base64::Engine;
        let bytes = self.export_zip_bytes()?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    /// Validate and restore data transactionally from a `.zip` archive created by [`Self::export_zip_bytes`].
    pub fn import_zip_bytes(&self, zip_bytes: &[u8]) -> Result<ImportSummary, CoreError> {
        use std::io::Read;

        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
            .map_err(|e| CoreError::validation("zip", format!("invalid zip archive: {e}")))?;

        let mut db_bytes = Vec::new();
        let has_sqlite = match archive.by_name("auradesk.db") {
            Ok(mut db_entry) => {
                db_entry
                    .read_to_end(&mut db_bytes)
                    .map_err(|e| CoreError::validation("zip", format!("read auradesk.db: {e}")))?;
                true
            }
            Err(_) => false,
        };

        if !has_sqlite {
            let mut bundle_raw = String::new();
            let mut bundle_entry = archive.by_name("bundle.json").map_err(|_| {
                CoreError::validation(
                    "zip",
                    "zip archive missing auradesk.db or bundle.json entry",
                )
            })?;
            bundle_entry
                .read_to_string(&mut bundle_raw)
                .map_err(|e| CoreError::validation("zip", format!("read bundle.json: {e}")))?;
            let bundle: DataBundle = serde_json::from_str(&bundle_raw)
                .map_err(|e| CoreError::validation("zip", format!("invalid bundle.json: {e}")))?;
            return self.import(bundle);
        }

        const SQLITE_MAGIC: [u8; 16] = [
            b'S', b'Q', b'L', b'i', b't', b'e', b' ', b'f', b'o', b'r', b'm', b'a', b't', b' ',
            b'3', 0,
        ];
        if !db_bytes.starts_with(&SQLITE_MAGIC) {
            return Err(CoreError::validation(
                "zip",
                "auradesk.db is not a valid SQLite 3 database",
            ));
        }

        let settings_override: Option<Vec<SettingItem>> = match archive.by_name("settings.json") {
            Ok(mut entry) => {
                let mut raw = String::new();
                entry.read_to_string(&mut raw).map_err(|e| {
                    CoreError::validation("zip", format!("read settings.json: {e}"))
                })?;
                let parsed: Vec<SettingItem> = serde_json::from_str(&raw).map_err(|e| {
                    CoreError::validation("zip", format!("invalid settings.json: {e}"))
                })?;
                Some(parsed)
            }
            Err(_) => None,
        };

        let tmp_dir =
            std::env::temp_dir().join(format!("auradesk-restore-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp_dir)
            .map_err(|e| CoreError::internal(format!("create temp restore dir: {e}")))?;
        let tmp_db_path = tmp_dir.join("auradesk.db");
        if let Err(e) = std::fs::write(&tmp_db_path, &db_bytes) {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(CoreError::internal(format!("write temp db: {e}")));
        }

        let res = (|| {
            let src_db = Db::open(&tmp_dir)?;
            let mut bundle = DataIoService::new(&src_db).export()?;
            if let Some(items) = settings_override {
                bundle.settings = items;
            }
            self.import(bundle)
        })();

        let _ = std::fs::remove_dir_all(&tmp_dir);
        res
    }

    /// Decode base64 `.zip` bytes and restore transactionally.
    pub fn import_zip_base64(&self, b64: &str) -> Result<ImportSummary, CoreError> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| {
                CoreError::validation("zip", format!("invalid base64 zip payload: {e}"))
            })?;
        self.import_zip_bytes(&bytes)
    }
}

/// Decode a base64 WAV audio capture and save it safely inside `captures_dir`.
pub fn save_voice_capture_base64(
    captures_dir: &std::path::Path,
    wav_base64: &str,
    filename_hint: Option<&str>,
) -> Result<(String, usize), CoreError> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_base64.trim())
        .map_err(|e| {
            CoreError::validation("audio", format!("invalid base64 audio payload: {e}"))
        })?;
    if bytes.is_empty() {
        return Err(CoreError::validation("audio", "empty audio payload"));
    }
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(CoreError::validation(
            "audio",
            "audio capture exceeds 25 MB limit",
        ));
    }

    std::fs::create_dir_all(captures_dir)
        .map_err(|e| CoreError::internal(format!("create voice captures dir: {e}")))?;

    let raw_hint = filename_hint.unwrap_or("voice-note");
    let sanitized: String = raw_hint
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let stem = sanitized.trim_matches('-');
    let stem = if stem.is_empty() { "voice-note" } else { stem };
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let unique = &uuid::Uuid::new_v4().to_string()[..8];
    let file_name = format!("{stem}-{stamp}-{unique}.wav");
    let dest = captures_dir.join(&file_name);

    std::fs::write(&dest, &bytes)
        .map_err(|e| CoreError::internal(format!("write voice capture: {e}")))?;
    Ok((dest.display().to_string(), bytes.len()))
}

fn validate_hex_color(s: &str) -> bool {
    if s.len() != 7 || !s.starts_with('#') {
        return false;
    }
    s[1..].chars().all(|c| c.is_ascii_hexdigit())
}
