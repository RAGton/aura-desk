//! Persistent alerts and fullscreen blocking modal IPC commands.

use auradesk_core::application::{alerts::AlertsService, settings::SettingsService};
use auradesk_core::domain::alert::{Alert, AlertSeverity, NewAlert};
use auradesk_core::domain::reminder::ReminderSound;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::audio::SoundDispatcher;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::runtime::{db_from, AppState};

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
pub async fn alerts_create(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NewAlertInput,
) -> Result<Alert, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| format!("alerts_create join: {e}"))?
}

#[tauri::command]
pub async fn alerts_resolve(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = AlertsService::new(&db);
        let res = svc
            .resolve(&id)
            .map_err(|e| format!("alerts_resolve: {e}"))?;
        crate::alert_lock::sync_blocking_windows(&app, &db);
        Ok(res)
    })
    .await
    .map_err(|e| format!("alerts_resolve join: {e}"))?
}

#[tauri::command]
pub async fn alerts_snooze(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = AlertsService::new(&db);
        let res = svc.snooze(&id).map_err(|e| format!("alerts_snooze: {e}"))?;
        crate::alert_lock::sync_blocking_windows(&app, &db);
        Ok(res)
    })
    .await
    .map_err(|e| format!("alerts_snooze join: {e}"))?
}

#[tauri::command]
pub async fn alerts_dismiss(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = AlertsService::new(&db);
        let res = svc
            .dismiss(&id)
            .map_err(|e| format!("alerts_dismiss: {e}"))?;
        crate::alert_lock::sync_blocking_windows(&app, &db);
        Ok(res)
    })
    .await
    .map_err(|e| format!("alerts_dismiss join: {e}"))?
}

#[tauri::command]
pub async fn alerts_except(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    note: String,
) -> Result<Alert, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let svc = AlertsService::new(&db);
        let res = svc
            .except(&id, &note)
            .map_err(|e| format!("alerts_except: {e}"))?;
        crate::alert_lock::sync_blocking_windows(&app, &db);
        Ok(res)
    })
    .await
    .map_err(|e| format!("alerts_except join: {e}"))?
}

#[tauri::command]
pub async fn alerts_sync_desktop_lock(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::alert_lock::sync_blocking_windows(&app, &db);
    })
    .await
    .map_err(|e| format!("alerts_sync_desktop_lock join: {e}"))
}

#[tauri::command]
pub async fn alerts_trigger_test_block(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    body: Option<String>,
) -> Result<Alert, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| format!("alerts_trigger_test_block join: {e}"))?
}

#[tauri::command]
pub async fn alerts_emergency_unlock(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || crate::alert_lock::emergency_unlock_all(&app, &db))
        .await
        .map_err(|e| format!("alerts_emergency_unlock join: {e}"))
}
