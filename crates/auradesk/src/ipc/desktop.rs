//! Desktop integration, auto-updater, and diagnostic logs IPC commands.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::runtime::{db_from, AppState};

// ── Desktop Integration (Phase 3) ─────────────────────────────────────

#[tauri::command]
pub fn desktop_list_monitors(app: AppHandle) -> Vec<auradesk_core::domain::desktop::MonitorInfo> {
    crate::desktop::list_monitors(&app)
}

#[tauri::command]
pub async fn desktop_apply_monitor_preference(
    app: AppHandle,
    state: State<'_, AppState>,
    reveal: Option<bool>,
) -> Result<String, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::desktop::apply_monitor_preference(&app, &db, reveal.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("desktop_apply_monitor_preference join: {e}"))
}

#[tauri::command]
pub async fn desktop_toggle_compact(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: Option<bool>,
) -> Result<bool, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::desktop::toggle_compact_window(&app, &db, enabled)
    })
    .await
    .map_err(|e| format!("desktop_toggle_compact join: {e}"))?
}

#[tauri::command]
pub async fn desktop_show_main(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::desktop::show_main_window(&app);
    })
    .await
    .map_err(|e| format!("desktop_show_main join: {e}"))
}

#[tauri::command]
pub fn desktop_set_tray_live_voice(app: AppHandle, active: bool) -> Result<(), String> {
    if let Some(tray_live) = app.try_state::<crate::runtime::TrayLiveMenu>() {
        if let Ok(guard) = tray_live.0.lock() {
            if let Some(item) = guard.as_ref() {
                let key = if active { "tray.live_off" } else { "tray.live_on" };
                let _ = item.set_text(auradesk_core::i18n::t(key));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_get_state(
    app: AppHandle,
    state: State<'_, AppState>,
) -> crate::desktop::DesktopStateSnapshot {
    let db = db_from(&state);
    crate::desktop::get_desktop_state(&app, &db)
}

#[tauri::command]
pub fn desktop_set_autostart(state: State<'_, AppState>, enabled: bool) -> Result<bool, String> {
    let db = db_from(&state);
    crate::desktop::set_autostart(&db, enabled)
}

#[tauri::command]
pub fn desktop_get_idle_state(state: State<'_, AppState>) -> crate::idle::IdleStateSnapshot {
    let db = db_from(&state);
    crate::idle::current_idle_snapshot(&db)
}

#[tauri::command]
pub async fn desktop_pick_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(crate::desktop::pick_folder)
        .await
        .map_err(|e| format!("desktop_pick_folder join: {e}"))
}

// ── Auto-Updater & Crash Diagnostics ──────────────────────────────────

#[tauri::command]
pub fn updater_get_state(state: State<'_, AppState>) -> crate::updater::UpdateStateSnapshot {
    let db = db_from(&state);
    state.updater.snapshot(&db)
}

#[tauri::command]
pub async fn updater_check_now(
    app: AppHandle,
    state: State<'_, AppState>,
    auto_install: Option<bool>,
) -> Result<crate::updater::UpdateStateSnapshot, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let updater = Arc::clone(&state.updater);
    tauri::async_runtime::spawn_blocking(move || {
        let should_install =
            auto_install.unwrap_or_else(|| crate::updater::read_auto_update_setting(&db));
        crate::updater::check_and_maybe_install(&app, &db, &data_dir, &updater, should_install)
    })
    .await
    .map_err(|e| format!("updater_check_now join: {e}"))?
}

#[tauri::command]
pub async fn updater_install_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::updater::UpdateStateSnapshot, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let updater = Arc::clone(&state.updater);
    tauri::async_runtime::spawn_blocking(move || {
        crate::updater::install_update_now(&app, &db, &data_dir, &updater)
    })
    .await
    .map_err(|e| format!("updater_install_now join: {e}"))?
}

#[tauri::command]
pub async fn app_open_logs_dir() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(crate::logging::open_logs_directory)
        .await
        .map_err(|e| format!("app_open_logs_dir join: {e}"))?
}

#[tauri::command]
pub fn app_get_logs_tail(limit: Option<usize>) -> Vec<String> {
    crate::logging::read_recent_logs(limit.unwrap_or(100))
}
