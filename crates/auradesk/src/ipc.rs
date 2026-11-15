//! Tauri IPC commands.
//!
//! Exposes domain services (tasks, projects, pomodoro, reminders,
//! settings, daily plans, alerts, metrics, reports) to the frontend.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use auradesk_core::application::{
    alerts::AlertsService,
    daily_plans::DailyPlansService,
    data_io::{DataIoService, ImportSummary},
    github::GithubSyncService,
    pomodoros::PomodorosService,
    projects::ProjectsService,
    proposals::ProposalsService,
    reminders::RemindersService,
    routines::RoutinesService,
    settings::SettingsService,
    tasks::TasksService,
};
use auradesk_core::domain::alert::{Alert, AlertResolution, AlertSeverity, NewAlert};
use auradesk_core::domain::daily_plan::{DailyPlan, PlanState};
use auradesk_core::domain::github::{
    GithubAuthStatus, GithubIssueLink, GithubSyncSummary, IssueFetcher,
};
use auradesk_core::domain::pomodoro::{NewPomodoroSession, PomodoroSession, SessionKind};
use auradesk_core::domain::project::NewProject;
use auradesk_core::domain::reminder::{
    NewReminder, Reminder, ReminderSound, ReminderStatus, RepeatKind, UpdateReminder,
};
use auradesk_core::domain::routine::Routine;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::task::{
    NewTask, Task, TaskFilter, TaskPriority, TaskStatus, UpdateTask,
};
use auradesk_core::infrastructure::audio::SoundDispatcher;
use auradesk_core::infrastructure::clock::SystemClock;
use auradesk_core::CoreError;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::github::GhCliIssueFetcher;
use crate::runtime::{db_from, AppState};

/// Round-trip a static string. Used by the frontend to confirm
/// the IPC channel is alive at app start.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

/// Settings ping: same as `ping` but reaches through the
/// service layer (proves the `SettingsService` and the `Db`
/// round-trip work end-to-end). Useful in dev for quick smoke.
#[tauri::command]
pub fn settings_ping(state: State<'_, AppState>) -> Result<usize, String> {
    let db = db_from(&state);
    let svc = SettingsService::new(&db);
    svc.get_all()
        .map(|v| v.len())
        .map_err(|e| format!("settings_ping: {e}"))
}

/// Wrapper used by the frontend to filter tasks. The frontend
/// doesn't import the Rust `TaskFilter` directly; it sends a
/// flattened JSON shape (Tauri deserializes it here).
#[derive(Debug, Deserialize)]
pub struct TaskFilterInput {
    pub status: Option<TaskStatus>,
    pub project_id: Option<String>,
    pub overdue: Option<bool>,
    pub top_level_only: Option<bool>,
}

impl From<TaskFilterInput> for TaskFilter {
    fn from(v: TaskFilterInput) -> Self {
        TaskFilter {
            status: v.status,
            project_id: v.project_id,
            overdue: v.overdue.unwrap_or(false),
            top_level_only: v.top_level_only.unwrap_or(false),
        }
    }
}

#[tauri::command]
pub fn tasks_list(
    state: State<'_, AppState>,
    filter: Option<TaskFilterInput>,
) -> Result<Vec<Task>, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let f = filter.map(TaskFilter::from).unwrap_or_default();
    svc.list(&f).map_err(|e| format!("tasks_list: {e}"))
}

#[tauri::command]
pub fn tasks_get(state: State<'_, AppState>, id: String) -> Result<Task, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    svc.get(&id).map_err(|e| format!("tasks_get: {e}"))
}

/// Frontend-friendly `NewTask`. Mirrors the domain type but with
/// JSON-friendly types (strings for enums, optionals as nullable).
#[derive(Debug, Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    pub description: Option<String>,
    pub priority: TaskPriority,
    pub status: TaskStatus,
    pub project_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub due_at: Option<String>,
    pub estimate_min: Option<i32>,
    pub tags: Option<Vec<String>>,
}

impl TryFrom<NewTaskInput> for NewTask {
    type Error = CoreError;
    fn try_from(v: NewTaskInput) -> Result<Self, Self::Error> {
        let due_at = match v.due_at {
            Some(s) => Some(parse_rfc3339(&s)?),
            None => None,
        };
        Ok(NewTask {
            title: v.title,
            description: v.description,
            priority: v.priority,
            status: v.status,
            project_id: v.project_id,
            parent_task_id: v.parent_task_id,
            due_at,
            estimate_min: v.estimate_min,
            tags: v.tags,
        })
    }
}

#[tauri::command]
pub fn tasks_create(state: State<'_, AppState>, input: NewTaskInput) -> Result<Task, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let new: NewTask = input
        .try_into()
        .map_err(|e: CoreError| format!("invalid input: {e}"))?;
    svc.create(new).map_err(|e| format!("tasks_create: {e}"))
}

/// Sentinel that maps to the domain `Clear<T>`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ClearInput<T> {
    /// Marker field. We don't carry a value because the receiver
    /// ignores it; the sentinel itself is the signal.
    #[serde(default)]
    pub clear: std::marker::PhantomData<T>,
}

/// Like `UpdateTask` but the nullable fields are `Clear<T> | T | null`.
/// Tauri deserializes this from a flat JSON object the frontend
/// builds without naming Rust types.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub title: Option<String>,
    /// `null` to clear, `Some(s)` to set, field absent to leave alone.
    pub description: Option<Option<String>>,
    pub priority: Option<TaskPriority>,
    pub status: Option<TaskStatus>,
    pub project_id: Option<Option<String>>,
    pub due_at: Option<Option<String>>,
    pub started_at: Option<Option<String>>,
    pub completed_at: Option<Option<String>>,
    pub estimate_min: Option<Option<i32>>,
    pub kanban_order: Option<i32>,
    pub tags: Option<Option<Vec<String>>>,
}

impl TryFrom<UpdateTaskInput> for UpdateTask {
    type Error = CoreError;
    fn try_from(v: UpdateTaskInput) -> Result<Self, Self::Error> {
        // The IPC wire format is already Option<Option<T>> for
        // nullable fields, so the translation is direct: keep the
        // double-Option shape so the service can distinguish
        // "leave alone" (field absent) from "clear" (null) from
        // "set to value" (string/number/etc).
        Ok(UpdateTask {
            title: v.title,
            description: v.description,
            priority: v.priority,
            status: v.status,
            project_id: v.project_id,
            due_at: match v.due_at {
                Some(None) => Some(None),
                Some(Some(s)) => Some(Some(parse_rfc3339(&s)?)),
                None => None,
            },
            started_at: match v.started_at {
                Some(None) => Some(None),
                Some(Some(s)) => Some(Some(parse_rfc3339(&s)?)),
                None => None,
            },
            completed_at: match v.completed_at {
                Some(None) => Some(None),
                Some(Some(s)) => Some(Some(parse_rfc3339(&s)?)),
                None => None,
            },
            estimate_min: v.estimate_min,
            kanban_order: v.kanban_order,
            tags: v.tags,
        })
    }
}

#[tauri::command]
pub fn tasks_update(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateTaskInput,
) -> Result<Task, String> {
    let locks_github_title = patch.title.is_some() || patch.description.is_some();
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let p: UpdateTask = patch
        .try_into()
        .map_err(|e: CoreError| format!("invalid patch: {e}"))?;
    let updated = svc
        .update(&id, p)
        .map_err(|e| format!("tasks_update: {e}"))?;
    if locks_github_title {
        let gh = GithubSyncService::new(&db, state.github_fetcher.as_ref());
        let _ = gh.lock_title(&id);
    }
    Ok(updated)
}

#[tauri::command]
pub fn tasks_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    svc.delete(&id).map_err(|e| format!("tasks_delete: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetStatusInput {
    pub id: String,
    pub status: TaskStatus,
    pub kanban_order: i32,
}

#[tauri::command]
pub fn tasks_set_status(state: State<'_, AppState>, input: SetStatusInput) -> Result<Task, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    svc.set_status(&input.id, input.status, input.kanban_order)
        .map_err(|e| format!("tasks_set_status: {e}"))
}

#[tauri::command]
pub fn projects_list(
    state: State<'_, AppState>,
) -> Result<Vec<auradesk_core::domain::project::Project>, String> {
    let db = db_from(&state);
    let svc = ProjectsService::new(&db);
    svc.list().map_err(|e| format!("projects_list: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct NewProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    /// ISO 8601 date (`YYYY-MM-DD`).
    pub start_date: Option<String>,
    pub target_date: Option<String>,
}

impl TryFrom<NewProjectInput> for NewProject {
    type Error = CoreError;
    fn try_from(v: NewProjectInput) -> Result<Self, Self::Error> {
        let parse = |s: &str| -> Result<chrono::NaiveDate, CoreError> {
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|e| CoreError::validation("date", format!("invalid date {s}: {e}")))
        };
        Ok(NewProject {
            name: v.name,
            description: v.description,
            color: v.color,
            parent_id: v.parent_id,
            start_date: v.start_date.as_deref().map(parse).transpose()?,
            target_date: v.target_date.as_deref().map(parse).transpose()?,
        })
    }
}

#[tauri::command]
pub fn projects_create(
    state: State<'_, AppState>,
    input: NewProjectInput,
) -> Result<auradesk_core::domain::project::Project, String> {
    let db = db_from(&state);
    let svc = ProjectsService::new(&db);
    let new: NewProject = input
        .try_into()
        .map_err(|e: CoreError| format!("invalid input: {e}"))?;
    svc.create(new).map_err(|e| format!("projects_create: {e}"))
}

fn parse_rfc3339(s: &str) -> Result<chrono::DateTime<chrono::Utc>, CoreError> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&chrono::Utc))
        .map_err(|e| CoreError::validation("date", format!("invalid RFC3339 {s}: {e}")))
}

// ── Pomodoro ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StartPomodoroInput {
    pub kind: SessionKind,
    pub planned_min: i32,
    pub task_id: Option<String>,
}

impl From<StartPomodoroInput> for NewPomodoroSession {
    fn from(v: StartPomodoroInput) -> Self {
        NewPomodoroSession {
            kind: v.kind,
            planned_min: v.planned_min,
            task_id: v.task_id,
        }
    }
}

#[tauri::command]
pub fn pomodoro_start(
    state: State<'_, AppState>,
    input: StartPomodoroInput,
) -> Result<PomodoroSession, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    let session = svc
        .start(input.into())
        .map_err(|e| format!("pomodoro_start: {e}"))?;
    // Mark focus so the RoutineRunner pauses water/break alerts
    // for the duration of this block.
    if matches!(
        session.kind,
        auradesk_core::domain::pomodoro::SessionKind::Focus
    ) {
        state.in_focus_session.store(true, Ordering::Relaxed);
    }
    Ok(session)
}

#[tauri::command]
pub fn pomodoro_complete(
    app: AppHandle,
    state: State<'_, AppState>,
    actual_min: i32,
) -> Result<PomodoroSession, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    let session = svc
        .complete_running(actual_min)
        .map_err(|e| format!("pomodoro_complete: {e}"))?;
    clear_focus_and_celebrate(&app, &state, &session, actual_min, /*aborted=*/ false);
    Ok(session)
}

#[tauri::command]
pub fn pomodoro_abandon(
    app: AppHandle,
    state: State<'_, AppState>,
    actual_min: Option<i32>,
) -> Result<PomodoroSession, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    let session = svc
        .interrupt_running(actual_min)
        .map_err(|e| format!("pomodoro_abandon: {e}"))?;
    clear_focus_and_celebrate(
        &app,
        &state,
        &session,
        actual_min.unwrap_or(0),
        /*aborted=*/ true,
    );
    Ok(session)
}

/// Shared tail of `pomodoro_complete` and `pomodoro_abandon`:
/// clear the focus flag and, when the session that ended was a
/// focus block, queue a "session ended" alert so the user gets
/// explicit feedback and the next break reminder is one click
/// away.
fn clear_focus_and_celebrate(
    app: &AppHandle,
    state: &State<'_, AppState>,
    session: &PomodoroSession,
    actual_min: i32,
    aborted: bool,
) {
    if matches!(
        session.kind,
        auradesk_core::domain::pomodoro::SessionKind::Focus
    ) {
        state.in_focus_session.store(false, Ordering::Relaxed);
        // Re-queue a "focus done" alert so the user explicitly
        // acknowledges the transition into the break.
        let title = if aborted {
            auradesk_core::i18n::t("alerts.focus_interrupted")
        } else {
            format!(
                "{} · {} min",
                auradesk_core::i18n::t("alerts.focus_completed"),
                actual_min.max(1)
            )
        };
        let body = if aborted {
            auradesk_core::i18n::t("alerts.focus_interrupted_body")
        } else {
            auradesk_core::i18n::t("alerts.focus_completed_body")
        };
        let db = db_from(state);
        let alerts = AlertsService::new(&db);
        let _ = alerts.create(auradesk_core::domain::alert::NewAlert {
            kind: "pomodoro".to_string(),
            title,
            body: Some(body.to_string()),
            severity: if aborted {
                auradesk_core::domain::alert::AlertSeverity::Info
            } else {
                auradesk_core::domain::alert::AlertSeverity::Normal
            },
            ref_id: Some(session.id.clone()),
            options: None,
        });
        crate::alert_lock::sync_blocking_windows(app, &db);
    }
}

#[tauri::command]
pub fn pomodoro_active(state: State<'_, AppState>) -> Result<Option<PomodoroSession>, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    svc.running_session()
        .map_err(|e| format!("pomodoro_active: {e}"))
}

#[tauri::command]
pub fn pomodoro_list(
    state: State<'_, AppState>,
    limit: Option<i32>,
) -> Result<Vec<PomodoroSession>, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    svc.list(limit.unwrap_or(50))
        .map_err(|e| format!("pomodoro_list: {e}"))
}

// ── Reminders ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct NewReminderInput {
    pub title: String,
    pub body: Option<String>,
    pub fire_at: String, // RFC3339
    pub repeat_kind: RepeatKind,
    pub sound: ReminderSound,
    pub task_id: Option<String>,
}

impl TryFrom<NewReminderInput> for NewReminder {
    type Error = CoreError;
    fn try_from(v: NewReminderInput) -> Result<Self, Self::Error> {
        Ok(NewReminder {
            title: v.title,
            body: v.body,
            fire_at: parse_rfc3339(&v.fire_at)?,
            repeat_kind: v.repeat_kind,
            sound: v.sound,
            task_id: v.task_id,
        })
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct UpdateReminderInput {
    pub title: Option<String>,
    pub body: Option<Option<String>>,
    pub fire_at: Option<String>,
    pub repeat_kind: Option<RepeatKind>,
    pub sound: Option<ReminderSound>,
    pub status: Option<ReminderStatus>,
}

impl TryFrom<UpdateReminderInput> for UpdateReminder {
    type Error = CoreError;
    fn try_from(v: UpdateReminderInput) -> Result<Self, Self::Error> {
        Ok(UpdateReminder {
            title: v.title,
            body: v.body,
            fire_at: match v.fire_at {
                Some(s) => Some(parse_rfc3339(&s)?),
                None => None,
            },
            repeat_kind: v.repeat_kind,
            sound: v.sound,
            status: v.status,
        })
    }
}

#[tauri::command]
pub fn reminders_list(
    state: State<'_, AppState>,
    include_done: Option<bool>,
) -> Result<Vec<Reminder>, String> {
    let db = db_from(&state);
    let svc = RemindersService::new(&db);
    svc.list(include_done.unwrap_or(false))
        .map_err(|e| format!("reminders_list: {e}"))
}

#[tauri::command]
pub fn reminders_create(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NewReminderInput,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    let svc = RemindersService::new(&db);
    let new: NewReminder = input
        .try_into()
        .map_err(|e: CoreError| format!("invalid input: {e}"))?;
    let created = svc
        .create(new)
        .map_err(|e| format!("reminders_create: {e}"))?;

    // If the reminder is due immediately (e.g. "Disparar Agora"), promote it
    // to a pending alert right away instead of waiting for the 15s loop tick.
    let now = chrono::Utc::now();
    if created.fire_at <= now {
        let fired = RemindersService::with_clock(&db, &SystemClock)
            .poll_and_fire_overdue(now)
            .unwrap_or_default();
        if !fired.is_empty() {
            let _ = SoundDispatcher::new(&db, &crate::audio::DesktopAudio::new())
                .dispatch(created.sound);
            crate::alert_lock::sync_blocking_windows(&app, &db);
        }
    }

    Ok(created)
}

#[tauri::command]
pub fn reminders_update(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateReminderInput,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    let svc = RemindersService::new(&db);
    let p: UpdateReminder = patch
        .try_into()
        .map_err(|e: CoreError| format!("invalid patch: {e}"))?;
    svc.update(&id, p)
        .map_err(|e| format!("reminders_update: {e}"))
}

#[tauri::command]
pub fn reminders_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = db_from(&state);
    let svc = RemindersService::new(&db);
    svc.delete(&id)
        .map_err(|e| format!("reminders_delete: {e}"))
}

#[tauri::command]
pub fn reminders_dismiss(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    let svc = RemindersService::new(&db);
    let res = svc
        .dismiss(&id)
        .map_err(|e| format!("reminders_dismiss: {e}"))?;
    let _ = AlertsService::new(&db).close_open_for_ref(&id, AlertResolution::Dismissed);
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(res)
}

#[derive(Debug, Deserialize)]
pub struct SnoozeInput {
    pub id: String,
    pub minutes: i32,
}

#[tauri::command]
pub fn reminders_snooze(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SnoozeInput,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    let svc = RemindersService::new(&db);
    let res = svc
        .snooze(&input.id, input.minutes)
        .map_err(|e| format!("reminders_snooze: {e}"))?;
    let _ = AlertsService::new(&db).close_open_for_ref(&input.id, AlertResolution::Snoozed);
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(res)
}

// ── Settings (extended surface) ───────────────────────────────────────

/// Read a single setting by string key.
#[tauri::command]
pub fn settings_get(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let parsed =
        SettingsKey::from_str(&key).ok_or_else(|| format!("settings_get: unknown key {key}"))?;
    let db = db_from(&state);
    let svc = SettingsService::new(&db);
    svc.get(parsed).map_err(|e| format!("settings_get: {e}"))
}

/// Bulk read all settings as `(key, json_value)` pairs. The
/// frontend uses this to render the Settings page.
#[tauri::command]
pub fn settings_get_all(
    state: State<'_, AppState>,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    let db = db_from(&state);
    let svc = SettingsService::new(&db);
    svc.get_all()
        .map(|v| {
            v.into_iter()
                .map(|(k, val)| (k.as_str().to_string(), val))
                .collect()
        })
        .map_err(|e| format!("settings_get_all: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetSettingInput {
    pub key: String,
    pub value: serde_json::Value,
}

/// Write a single setting by string key. The SettingsKey parser
/// rejects unknown keys (so a typo from the UI is reported as
/// `Validation` rather than silently inserting a row).
#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SetSettingInput,
) -> Result<(), String> {
    let key = SettingsKey::from_str(&input.key)
        .ok_or_else(|| format!("settings_set: unknown key {}", input.key))?;
    let db = db_from(&state);
    let svc = SettingsService::new(&db);
    svc.set(key, input.value.clone())
        .map_err(|e| format!("settings_set: {e}"))?;
    if key == SettingsKey::AppLocale {
        if let Some(locale_str) = input.value.as_str() {
            auradesk_core::i18n::set_locale(locale_str);
        }
    } else if key == SettingsKey::RemindersBlockScreen {
        crate::alert_lock::sync_blocking_windows(&app, &db);
    }
    Ok(())
}

// ── Dashboard ─────────────────────────────────────────────────────────

/// Snapshot of every widget the Dashboard needs. One round-trip
/// keeps the UI from issuing 6+ commands on every refresh.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub next_task: Option<auradesk_core::domain::task::Task>,
    pub pending_count: i64,
    pub completed_today: i64,
    pub overdue_count: i64,
    pub running_pomodoro: Option<PomodoroSession>,
    pub pending_reminders: i64,
    pub recent_reminders: Vec<Reminder>,
    pub today_pomodoros: i64,
    pub today_focus_min: i64,
    pub water_interval_min: i64,
    pub break_interval_min: i64,
    pub daily_planning_time: String,
}

#[tauri::command]
pub fn dashboard_summary(state: State<'_, AppState>) -> Result<DashboardSummary, String> {
    let db = db_from(&state);
    let tasks_svc = TasksService::new(&db);
    let pomo_svc = PomodorosService::new(&db);
    let reminders_svc = RemindersService::new(&db);
    let settings_svc = SettingsService::new(&db);

    let all_tasks = tasks_svc
        .list(&TaskFilter::default())
        .map_err(|e| format!("list all tasks: {e}"))?;

    // Next task: highest-priority pending (todo or waiting),
    // tie-broken by earliest due_at (nulls last).
    let mut next_candidates: Vec<_> = all_tasks
        .iter()
        .filter(|t| matches!(t.status, TaskStatus::Todo | TaskStatus::Waiting))
        .cloned()
        .collect();
    next_candidates.sort_by(|a, b| {
        let pa = priority_rank(a.priority);
        let pb = priority_rank(b.priority);
        pa.cmp(&pb).then(earliest_due(a).cmp(&earliest_due(b)))
    });
    let next_task = next_candidates.into_iter().next();

    let pending_count = all_tasks
        .iter()
        .filter(|t| {
            matches!(
                t.status,
                TaskStatus::Todo | TaskStatus::Waiting | TaskStatus::Doing
            )
        })
        .count() as i64;

    let now_utc = chrono::Utc::now();
    let overdue_count = all_tasks
        .iter()
        .filter(|t| {
            !matches!(t.status, TaskStatus::Done | TaskStatus::Cancelled)
                && t.due_at.is_some_and(|d| d < now_utc)
        })
        .count() as i64;

    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let completed_today = all_tasks
        .iter()
        .filter(|t| matches!(t.status, TaskStatus::Done))
        .filter(|t| {
            t.completed_at.as_ref().is_some_and(|c| {
                c.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string()
                    == today_str
            })
        })
        .count() as i64;

    let running = pomo_svc
        .running_session()
        .map_err(|e| format!("running: {e}"))?;
    let all_pomos = pomo_svc.list(500).map_err(|e| format!("pomo list: {e}"))?;
    let completed_today_pomos: Vec<_> = all_pomos
        .iter()
        .filter(|s| {
            s.started_at
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
                == today_str
                && matches!(
                    s.status,
                    auradesk_core::domain::pomodoro::SessionStatus::Completed
                )
        })
        .collect();
    let today_pomodoros = completed_today_pomos.len() as i64;
    let today_focus_min = completed_today_pomos
        .iter()
        .filter(|s| matches!(s.kind, auradesk_core::domain::pomodoro::SessionKind::Focus))
        .filter_map(|s| s.actual_min)
        .sum::<i32>() as i64;

    let all_reminders = reminders_svc
        .list(true)
        .map_err(|e| format!("reminders all: {e}"))?;
    let pending_reminders = all_reminders
        .iter()
        .filter(|r| {
            matches!(
                r.status,
                ReminderStatus::Pending | ReminderStatus::Fired | ReminderStatus::Snoozed
            )
        })
        .count() as i64;
    let recent_reminders = all_reminders.into_iter().take(5).collect();

    // Read three settings; missing keys fall back to V001 spec defaults.
    let water_interval_min =
        read_int_setting(&settings_svc, SettingsKey::RoutineWaterIntervalMin).unwrap_or(60);
    let break_interval_min =
        read_int_setting(&settings_svc, SettingsKey::RoutineBreakIntervalMin).unwrap_or(90);
    let daily_planning_time =
        read_str_setting(&settings_svc, SettingsKey::RoutineDailyPlanningTime)
            .unwrap_or_else(|| "07:50".to_string());

    Ok(DashboardSummary {
        next_task,
        pending_count,
        completed_today,
        overdue_count,
        running_pomodoro: running,
        pending_reminders,
        recent_reminders,
        today_pomodoros,
        today_focus_min,
        water_interval_min,
        break_interval_min,
        daily_planning_time,
    })
}

fn priority_rank(p: TaskPriority) -> i32 {
    match p {
        TaskPriority::Urgent => 0,
        TaskPriority::High => 1,
        TaskPriority::Normal => 2,
        TaskPriority::Low => 3,
    }
}

fn earliest_due(t: &auradesk_core::domain::task::Task) -> String {
    // Sort by ISO-8601 of due_at (None sorts last as "z").
    t.due_at
        .as_ref()
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| "z".to_string())
}

fn read_int_setting(svc: &SettingsService, k: SettingsKey) -> Option<i64> {
    svc.get(k)
        .ok()
        .flatten()
        .and_then(|v| v.as_i64().or_else(|| v.as_u64().map(|n| n as i64)))
}

fn read_str_setting(svc: &SettingsService, k: SettingsKey) -> Option<String> {
    svc.get(k)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

/// Read-only snapshot of cross-feature integration state. The
/// Pomodoro page uses `inFocusSession` to render a "Foco ativo"
/// banner; the Dashboard uses it to grey out the water/break
/// widgets (so the user sees that routines are paused).
#[tauri::command]
pub fn integration_state(state: State<'_, AppState>) -> Result<IntegrationView, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    let in_focus_db = svc
        .running_session()
        .map_err(|e| format!("running_session: {e}"))?
        .is_some();
    // The in-memory flag is the fast path; the DB is the slow
    // path. Both must agree in normal operation. We OR them so
    // either side can surface a focus session to the UI.
    let in_focus_mem = state.in_focus_session.load(Ordering::Relaxed);
    Ok(IntegrationView {
        in_focus_session: in_focus_mem || in_focus_db,
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationView {
    pub in_focus_session: bool,
}

// ── Daily plans ───────────────────────────────────────────────────────

/// Fetch today's daily plan, auto-creating it (`not_started`)
/// on first call. The dashboard "Hoje" widget calls this so the
/// user always sees a status row.
#[tauri::command]
pub fn daily_plan_get(state: State<'_, AppState>) -> Result<DailyPlan, String> {
    let db = db_from(&state);
    let svc = DailyPlansService::new(&db);
    svc.current_or_create()
        .map_err(|e| format!("daily_plan_get: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetPlanStateInput {
    pub id: String,
    pub state: PlanState,
}

#[tauri::command]
pub fn daily_plan_set_state(
    state: State<'_, AppState>,
    input: SetPlanStateInput,
) -> Result<DailyPlan, String> {
    let db = db_from(&state);
    let svc = DailyPlansService::new(&db);
    svc.set_state(&input.id, input.state)
        .map_err(|e| format!("daily_plan_set_state: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetPlanPayloadInput {
    pub id: String,
    pub payload: Option<String>,
}

#[tauri::command]
pub fn daily_plan_set_payload(
    state: State<'_, AppState>,
    input: SetPlanPayloadInput,
) -> Result<DailyPlan, String> {
    let db = db_from(&state);
    let svc = DailyPlansService::new(&db);
    svc.set_payload(&input.id, input.payload)
        .map_err(|e| format!("daily_plan_set_payload: {e}"))
}

// ── Alerts ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn alerts_list_pending(state: State<'_, AppState>) -> Result<Vec<Alert>, String> {
    let db = db_from(&state);
    let svc = AlertsService::new(&db);
    svc.list_pending()
        .map_err(|e| format!("alerts_list_pending: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct NewAlertInput {
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub severity: AlertSeverity,
    pub ref_id: Option<String>,
    pub options: Option<String>,
}

#[tauri::command]
pub fn alerts_create(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NewAlertInput,
) -> Result<Alert, String> {
    let db = db_from(&state);
    let svc = AlertsService::new(&db);
    let created = svc
        .create(NewAlert {
            kind: input.kind,
            title: input.title,
            body: input.body,
            severity: input.severity,
            ref_id: input.ref_id,
            options: input.options,
        })
        .map_err(|e| format!("alerts_create: {e}"))?;
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(created)
}

#[tauri::command]
pub fn alerts_resolve(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    let svc = AlertsService::new(&db);
    let res = svc
        .resolve(&id)
        .map_err(|e| format!("alerts_resolve: {e}"))?;
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(res)
}

#[tauri::command]
pub fn alerts_snooze(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    let svc = AlertsService::new(&db);
    let res = svc.snooze(&id).map_err(|e| format!("alerts_snooze: {e}"))?;
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(res)
}

#[tauri::command]
pub fn alerts_dismiss(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    let svc = AlertsService::new(&db);
    let res = svc
        .dismiss(&id)
        .map_err(|e| format!("alerts_dismiss: {e}"))?;
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(res)
}

#[tauri::command]
pub fn alerts_except(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    note: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    let svc = AlertsService::new(&db);
    let res = svc
        .except(&id, &note)
        .map_err(|e| format!("alerts_except: {e}"))?;
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(res)
}

#[tauri::command]
pub fn alerts_sync_desktop_lock(app: AppHandle, state: State<'_, AppState>) {
    let db = db_from(&state);
    crate::alert_lock::sync_blocking_windows(&app, &db);
}

#[tauri::command]
pub fn alerts_trigger_test_block(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    body: Option<String>,
) -> Result<Alert, String> {
    let db = db_from(&state);
    SettingsService::new(&db)
        .set(
            SettingsKey::RemindersBlockScreen,
            serde_json::Value::Bool(true),
        )
        .map_err(|e| format!("enable block_screen: {e}"))?;
    let alert = AlertsService::new(&db)
        .create(NewAlert {
            kind: "reminder".to_string(),
            title,
            body,
            severity: AlertSeverity::Urgent,
            ref_id: None,
            options: None,
        })
        .map_err(|e| format!("alerts_trigger_test_block: {e}"))?;
    let _ = SoundDispatcher::new(&db, &crate::audio::DesktopAudio::new())
        .dispatch(ReminderSound::Urgent);
    crate::alert_lock::sync_blocking_windows(&app, &db);
    Ok(alert)
}

// ── Report ────────────────────────────────────────────────────────────

/// Time-spent report: per-day breakdown of focus / break minutes
/// and task outcomes, plus totals for today / week / month.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    pub today: ReportDay,
    pub week: ReportPeriod,
    pub month: ReportPeriod,
    pub by_day: Vec<ReportDay>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDay {
    pub date: String, // YYYY-MM-DD
    pub focus_min: i64,
    pub break_min: i64,
    pub water_count: i64,
    pub pomodoros: i64,
    pub tasks_done: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPeriod {
    pub focus_min: i64,
    pub break_min: i64,
    pub water_count: i64,
    pub pomodoros: i64,
    pub tasks_done: i64,
    pub active_days: i64,
}

#[tauri::command]
pub fn report_summary(state: State<'_, AppState>) -> Result<ReportSummary, String> {
    let db = db_from(&state);
    let tasks_svc = TasksService::new(&db);
    let pomo_svc = PomodorosService::new(&db);

    let today_local = chrono::Local::now().date_naive();
    let today_str = today_local.format("%Y-%m-%d").to_string();
    let month_start = today_local - chrono::Duration::days(29);

    let all_pomos = pomo_svc.list(2000).map_err(|e| format!("pomo list: {e}"))?;
    let all_tasks = tasks_svc
        .list(&TaskFilter::default())
        .map_err(|e| format!("task list: {e}"))?;

    let mut days_30: Vec<ReportDay> = (0..30)
        .map(|i| {
            let d = month_start + chrono::Duration::days(i);
            ReportDay {
                date: d.format("%Y-%m-%d").to_string(),
                focus_min: 0,
                break_min: 0,
                water_count: 0,
                pomodoros: 0,
                tasks_done: 0,
            }
        })
        .collect();

    let mut pomo_break_by_day = [0_i64; 30];

    // Hydrate water & routine break counts recorded in `metrics_daily`.
    {
        let conn = db.writer();
        if let Ok(mut stmt) =
            conn.prepare("SELECT date, break_minutes, water_count FROM metrics_daily")
        {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            }) {
                for row in rows.flatten() {
                    if let Some(day) = days_30.iter_mut().find(|d| d.date == row.0) {
                        day.break_min += row.1;
                        day.water_count += row.2;
                    }
                }
            }
        };
    }

    for s in &all_pomos {
        let key = s
            .started_at
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string();
        if let Some(idx) = days_30.iter().position(|d| d.date == key) {
            let day = &mut days_30[idx];
            let is_focus = matches!(s.kind, auradesk_core::domain::pomodoro::SessionKind::Focus);
            let is_break = matches!(
                s.kind,
                auradesk_core::domain::pomodoro::SessionKind::ShortBreak
                    | auradesk_core::domain::pomodoro::SessionKind::LongBreak
            );
            if matches!(
                s.status,
                auradesk_core::domain::pomodoro::SessionStatus::Completed
            ) {
                if is_focus {
                    day.focus_min += s.actual_min.unwrap_or(0) as i64;
                    day.pomodoros += 1;
                } else if is_break {
                    pomo_break_by_day[idx] += s.actual_min.unwrap_or(0) as i64;
                }
            }
        }
    }
    for (day, pomo_brk) in days_30.iter_mut().zip(pomo_break_by_day) {
        day.break_min = day.break_min.max(pomo_brk);
    }
    for t in &all_tasks {
        if matches!(t.status, TaskStatus::Done) {
            if let Some(c) = &t.completed_at {
                let key = c
                    .with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string();
                if let Some(day) = days_30.iter_mut().find(|d| d.date == key) {
                    day.tasks_done += 1;
                }
            }
        }
    }

    let fold_period = |slice: &[ReportDay]| -> ReportPeriod {
        slice.iter().fold(
            ReportPeriod {
                focus_min: 0,
                break_min: 0,
                water_count: 0,
                pomodoros: 0,
                tasks_done: 0,
                active_days: 0,
            },
            |mut acc, d| {
                acc.focus_min += d.focus_min;
                acc.break_min += d.break_min;
                acc.water_count += d.water_count;
                acc.pomodoros += d.pomodoros;
                acc.tasks_done += d.tasks_done;
                if d.focus_min > 0 || d.pomodoros > 0 || d.tasks_done > 0 {
                    acc.active_days += 1;
                }
                acc
            },
        )
    };

    let today_report = days_30
        .iter()
        .find(|d| d.date == today_str)
        .cloned()
        .unwrap_or(ReportDay {
            date: today_str,
            focus_min: 0,
            break_min: 0,
            water_count: 0,
            pomodoros: 0,
            tasks_done: 0,
        });

    let week = fold_period(&days_30[days_30.len().saturating_sub(7)..]);
    let month = fold_period(&days_30);
    // Keep 14-day series in `by_day` newest-first for dashboard compatibility,
    // or oldest-to-newest chronological (last 14 days).
    let by_day = days_30[days_30.len().saturating_sub(14)..]
        .iter()
        .rev()
        .cloned()
        .collect();

    Ok(ReportSummary {
        today: today_report,
        week,
        month,
        by_day,
    })
}

// ── GitHub Issues → Kanban (ADR-0013) ─────────────────────────────────

#[tauri::command]
pub fn github_sync_issues(
    state: State<'_, AppState>,
    project_id: Option<String>,
    label_filter: Option<String>,
) -> Result<GithubSyncSummary, String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.sync(project_id.as_deref(), label_filter.as_deref())
        .map_err(|e| format!("github_sync_issues: {e}"))
}

#[tauri::command]
pub fn github_issues_list(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<GithubIssueLink>, String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.list_links(project_id.as_deref())
        .map_err(|e| format!("github_issues_list: {e}"))
}

#[tauri::command]
pub fn github_link_task(
    state: State<'_, AppState>,
    task_id: String,
    repo: String,
    number: i64,
) -> Result<GithubIssueLink, String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.link_task(&task_id, &repo, number)
        .map_err(|e| format!("github_link_task: {e}"))
}

#[tauri::command]
pub fn github_unlink_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.unlink_task(&task_id)
        .map_err(|e| format!("github_unlink_task: {e}"))
}

#[tauri::command]
pub fn github_check_auth() -> GithubAuthStatus {
    let fetcher = GhCliIssueFetcher::new();
    match fetcher.auth_status() {
        Ok(Some(account)) => GithubAuthStatus {
            available: true,
            authenticated: true,
            account: Some(account),
            message: None,
        },
        Ok(None) => GithubAuthStatus {
            available: true,
            authenticated: false,
            account: None,
            message: Some("github.authRequired".to_string()),
        },
        Err(_) => GithubAuthStatus {
            available: false,
            authenticated: false,
            account: None,
            message: Some("github.cliMissing".to_string()),
        },
    }
}

// ── Backup .zip Export / Import (Issue #10) ───────────────────────────

#[tauri::command]
pub fn data_export_zip(state: State<'_, AppState>) -> Result<String, String> {
    let db = db_from(&state);
    DataIoService::new(&db)
        .export_zip_base64()
        .map_err(|e| format!("data_export_zip: {e}"))
}

#[tauri::command]
pub fn data_import_zip(
    state: State<'_, AppState>,
    zip_base64: String,
) -> Result<ImportSummary, String> {
    let db = db_from(&state);
    DataIoService::new(&db)
        .import_zip_base64(&zip_base64)
        .map_err(|e| format!("data_import_zip: {e}"))
}

// ── Routines & IA Proposals (ADR-0011) ────────────────────────────────

#[tauri::command]
pub fn routines_list(state: State<'_, AppState>) -> Result<Vec<Routine>, String> {
    let db = db_from(&state);
    RoutinesService::new(&db)
        .list(false)
        .map_err(|e| format!("routines_list: {e}"))
}

#[tauri::command]
pub fn routines_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Routine, String> {
    let db = db_from(&state);
    RoutinesService::new(&db)
        .set_enabled(&id, enabled)
        .map_err(|e| format!("routines_set_enabled: {e}"))
}

#[tauri::command]
pub fn proposals_list_pending(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = db_from(&state);
    let list = ProposalsService::new(&db)
        .list_pending()
        .map_err(|e| format!("proposals_list_pending: {e}"))?;
    Ok(list.into_iter().map(|p| p.to_schema_json()).collect())
}

#[tauri::command]
pub fn proposals_approve(
    state: State<'_, AppState>,
    id: String,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    let mut payload = serde_json::json!({ "id": id });
    if let Some(n) = note {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("note".to_string(), serde_json::Value::String(n));
        }
    }
    auradesk_core::capabilities::dispatch_capability(&db, "approve_proposal", payload)
        .map_err(|e| format!("proposals_approve: {e}"))
}

#[tauri::command]
pub fn proposals_reject(
    state: State<'_, AppState>,
    id: String,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    ProposalsService::new(&db)
        .reject(&id, note.as_deref())
        .map(|p| p.to_schema_json())
        .map_err(|e| format!("proposals_reject: {e}"))
}

/// Suppress unused warning for the helper that the macro
/// `#[tauri::command]` expansion pulls in.
#[allow(dead_code)]
fn _suppress(_state: Arc<AppState>) {}
