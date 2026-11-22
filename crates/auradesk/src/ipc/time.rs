//! Pomodoro, reminders, and settings IPC commands.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use auradesk_core::application::{
    alerts::AlertsService, pomodoros::PomodorosService, reminders::RemindersService,
    settings::SettingsService,
};
use auradesk_core::domain::alert::AlertResolution;
use auradesk_core::domain::pomodoro::{NewPomodoroSession, PomodoroSession, SessionKind};
use auradesk_core::domain::reminder::{
    NewReminder, Reminder, ReminderSound, ReminderStatus, RepeatKind, UpdateReminder,
};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::audio::SoundDispatcher;
use auradesk_core::infrastructure::clock::SystemClock;
use auradesk_core::infrastructure::db::Db;
use auradesk_core::CoreError;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::ipc::parse_rfc3339;
use crate::runtime::{db_from, AppState};

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
pub async fn pomodoro_complete(
    app: AppHandle,
    state: State<'_, AppState>,
    actual_min: i32,
) -> Result<PomodoroSession, String> {
    let db = db_from(&state);
    let in_focus = Arc::clone(&state.in_focus_session);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = PomodorosService::new(&db);
        let session = svc
            .complete_running(actual_min)
            .map_err(|e| format!("pomodoro_complete: {e}"))?;
        clear_focus_and_celebrate(&app, &db, &in_focus, &session, actual_min, false);
        Ok(session)
    })
    .await
    .map_err(|e| format!("pomodoro_complete join: {e}"))?
}

#[tauri::command]
pub async fn pomodoro_abandon(
    app: AppHandle,
    state: State<'_, AppState>,
    actual_min: Option<i32>,
) -> Result<PomodoroSession, String> {
    let db = db_from(&state);
    let in_focus = Arc::clone(&state.in_focus_session);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = PomodorosService::new(&db);
        let session = svc
            .interrupt_running(actual_min)
            .map_err(|e| format!("pomodoro_abandon: {e}"))?;
        clear_focus_and_celebrate(
            &app,
            &db,
            &in_focus,
            &session,
            actual_min.unwrap_or(0),
            true,
        );
        Ok(session)
    })
    .await
    .map_err(|e| format!("pomodoro_abandon join: {e}"))?
}

/// Shared tail of `pomodoro_complete` and `pomodoro_abandon`:
/// clear the focus flag and, when the session that ended was a
/// focus block, queue a "session ended" alert so the user gets
/// explicit feedback and the next break reminder is one click
/// away.
fn clear_focus_and_celebrate(
    app: &AppHandle,
    db: &Arc<Db>,
    in_focus: &AtomicBool,
    session: &PomodoroSession,
    actual_min: i32,
    aborted: bool,
) {
    if matches!(
        session.kind,
        auradesk_core::domain::pomodoro::SessionKind::Focus
    ) {
        in_focus.store(false, Ordering::Relaxed);
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
        let alerts = AlertsService::new(db);
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
        crate::alert_lock::sync_blocking_windows(app, db);
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
pub async fn reminders_create(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NewReminderInput,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = RemindersService::new(&db);
        let new: NewReminder = input
            .try_into()
            .map_err(|e: CoreError| format!("invalid input: {e}"))?;
        let created = svc
            .create(new)
            .map_err(|e| format!("reminders_create: {e}"))?;

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
    })
    .await
    .map_err(|e| format!("reminders_create join: {e}"))?
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
pub async fn reminders_dismiss(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = RemindersService::new(&db);
        let res = svc
            .dismiss(&id)
            .map_err(|e| format!("reminders_dismiss: {e}"))?;
        let _ = AlertsService::new(&db).close_open_for_ref(&id, AlertResolution::Dismissed);
        crate::alert_lock::sync_blocking_windows(&app, &db);
        Ok(res)
    })
    .await
    .map_err(|e| format!("reminders_dismiss join: {e}"))?
}

#[derive(Debug, Deserialize)]
pub struct SnoozeInput {
    pub id: String,
    pub minutes: i32,
}

#[tauri::command]
pub async fn reminders_snooze(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SnoozeInput,
) -> Result<Reminder, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = RemindersService::new(&db);
        let res = svc
            .snooze(&input.id, input.minutes)
            .map_err(|e| format!("reminders_snooze: {e}"))?;
        let _ = AlertsService::new(&db).close_open_for_ref(&input.id, AlertResolution::Snoozed);
        crate::alert_lock::sync_blocking_windows(&app, &db);
        Ok(res)
    })
    .await
    .map_err(|e| format!("reminders_snooze join: {e}"))?
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
pub async fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SetSettingInput,
) -> Result<(), String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let key = SettingsKey::from_str(&input.key)
            .ok_or_else(|| format!("settings_set: unknown key {}", input.key))?;
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
    })
    .await
    .map_err(|e| format!("settings_set join: {e}"))?
}
