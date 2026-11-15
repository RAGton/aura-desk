//! Tauri runtime: window, tray, lifecycle, and IPC command wiring.
//!
//! Phase 0 T5: window + tray + close-to-tray (skeleton).
//! Phase 1: DB initialization in `setup`; tasks/projects IPC commands
//! exposed to the frontend.
//! Phase 2+: Pomodoro-aware RoutineRunner (see `routines.rs`) that
//! suppresses hydration/break alerts while a focus block runs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use auradesk_core::application::pomodoros::PomodorosService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::pomodoro::SessionKind;
use auradesk_core::domain::settings_key::SettingsKey;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

use auradesk_core::infrastructure::db::Db;

use crate::alert_lock::{LOCK_WINDOW_PREFIX, POPUP_WINDOW_LABEL};
use crate::github::GhCliIssueFetcher;

pub use crate::ipc;

/// Shared state held by Tauri. The `Db` is wrapped in `Arc` so it
/// can be cheaply cloned into each IPC command invocation.
///
/// `in_focus_session` is set to `true` while a Pomodoro *focus*
/// session is running. The `RoutineRunner` reads it to suppress
/// routine alerts (water/break) while the user is in deep work.
/// `screen_lock_active` tracks whether fullscreen blocking alert
/// overlays are currently enforced.
/// `alert_popup_active` tracks whether at least one pending alert keeps
/// the standalone external modal window open.
/// `popup_locked_mode` remembers whether the currently open `alert-popup`
/// window was built in PC-lock owned mode.
pub struct AppState {
    pub db: Arc<Db>,
    pub in_focus_session: Arc<AtomicBool>,
    pub screen_lock_active: Arc<AtomicBool>,
    pub alert_popup_active: Arc<AtomicBool>,
    pub popup_locked_mode: Arc<AtomicBool>,
    pub github_fetcher: Arc<GhCliIssueFetcher>,
}

pub fn build() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .setup(|app| {
            // Open the database. The path is resolved relative to the
            // app's data directory (e.g. `~/.local/share/com.ragton.auradesk/`
            // on Linux, `%APPDATA%` on Windows). In dev mode (when the
            // Tauri config is built without bundled resources), the
            // data dir still works — Tauri's `path::app_data_dir()`
            // honours the identifier in tauri.conf.json.
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("create app data dir {data_dir:?}: {e}"))?;
            // `Db::open` joins `auradesk.db` itself; pass the data dir, not a file path.
            let db =
                Arc::new(Db::open(&data_dir).map_err(|e| format!("open db {data_dir:?}: {e}"))?);

            if let Ok(Some(locale_val)) = SettingsService::new(&db).get(SettingsKey::AppLocale) {
                if let Some(locale_str) = locale_val.as_str() {
                    auradesk_core::i18n::set_locale(locale_str);
                }
            }

            let initial_in_focus = PomodorosService::new(&db)
                .running_session()
                .ok()
                .flatten()
                .is_some_and(|s| matches!(s.kind, SessionKind::Focus));
            let in_focus = Arc::new(AtomicBool::new(initial_in_focus));
            let screen_lock_active = Arc::new(AtomicBool::new(false));
            let alert_popup_active = Arc::new(AtomicBool::new(false));
            let popup_locked_mode = Arc::new(AtomicBool::new(false));
            let github_fetcher = Arc::new(GhCliIssueFetcher::new());
            app.manage(AppState {
                db: Arc::clone(&db),
                in_focus_session: Arc::clone(&in_focus),
                screen_lock_active,
                alert_popup_active,
                popup_locked_mode,
                github_fetcher,
            });

            // Sync fullscreen alert overlays at startup in case pending alerts
            // survived an OS reboot or app restart with `reminders.block_screen` enabled.
            crate::alert_lock::sync_blocking_windows(app.handle(), &db);

            // Launch the routine runner as a background task.
            std::thread::spawn({
                let app_handle = app.handle().clone();
                let db = Arc::clone(&db);
                let in_focus = Arc::clone(&in_focus);
                move || {
                    crate::routines::run_loop(app_handle, db, in_focus);
                }
            });

            // Quit menu item
            let quit = MenuItem::with_id(
                app,
                "quit",
                auradesk_core::i18n::t("tray.quit"),
                true,
                None::<&str>,
            )?;
            let show = MenuItem::with_id(
                app,
                "show",
                auradesk_core::i18n::t("tray.show"),
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // System tray
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if label == "main" {
                        // Close-to-tray: closing the main window does NOT exit the process.
                        let _ = window.hide();
                        api.prevent_close();
                    } else if label == POPUP_WINDOW_LABEL {
                        if let Some(state) = window.app_handle().try_state::<AppState>() {
                            if state.alert_popup_active.load(Ordering::SeqCst) {
                                api.prevent_close();
                                let _ = window.set_always_on_top(true);
                                let _ = window.set_focus();
                            }
                        }
                    } else if label.starts_with(LOCK_WINDOW_PREFIX) {
                        let app = window.app_handle();
                        if let Some(state) = app.try_state::<AppState>() {
                            if state.screen_lock_active.load(Ordering::SeqCst) {
                                api.prevent_close();
                                if let Some(popup) = app.get_webview_window(POPUP_WINDOW_LABEL) {
                                    let _ = popup.set_always_on_top(true);
                                    let _ = popup.set_focus();
                                } else {
                                    let _ = window.set_always_on_top(true);
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                }
                tauri::WindowEvent::Focused(true) if label.starts_with(LOCK_WINDOW_PREFIX) => {
                    let app = window.app_handle();
                    if let Some(state) = app.try_state::<AppState>() {
                        if state.screen_lock_active.load(Ordering::SeqCst) {
                            if let Some(popup) = app.get_webview_window(POPUP_WINDOW_LABEL) {
                                let _ = popup.set_always_on_top(true);
                                let _ = popup.set_focus();
                            }
                        }
                    }
                }
                tauri::WindowEvent::Focused(false)
                    if label == POPUP_WINDOW_LABEL || label.starts_with(LOCK_WINDOW_PREFIX) =>
                {
                    let app = window.app_handle();
                    if let Some(state) = app.try_state::<AppState>() {
                        if state.screen_lock_active.load(Ordering::SeqCst) {
                            let any_auradesk_focused = app
                                .webview_windows()
                                .values()
                                .any(|w| w.is_focused().unwrap_or(false));
                            if !any_auradesk_focused {
                                if let Some(popup) = app.get_webview_window(POPUP_WINDOW_LABEL) {
                                    let _ = popup.set_always_on_top(true);
                                    let _ = popup.set_focus();
                                } else {
                                    let _ = window.set_always_on_top(true);
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::ping,
            crate::ipc::settings_ping,
            crate::ipc::tasks_list,
            crate::ipc::tasks_get,
            crate::ipc::tasks_create,
            crate::ipc::tasks_update,
            crate::ipc::tasks_delete,
            crate::ipc::tasks_set_status,
            crate::ipc::projects_list,
            crate::ipc::projects_create,
            crate::ipc::pomodoro_start,
            crate::ipc::pomodoro_complete,
            crate::ipc::pomodoro_abandon,
            crate::ipc::pomodoro_active,
            crate::ipc::pomodoro_list,
            crate::ipc::reminders_list,
            crate::ipc::reminders_create,
            crate::ipc::reminders_update,
            crate::ipc::reminders_delete,
            crate::ipc::reminders_dismiss,
            crate::ipc::reminders_snooze,
            crate::ipc::settings_get,
            crate::ipc::settings_get_all,
            crate::ipc::settings_set,
            crate::ipc::dashboard_summary,
            crate::ipc::alerts_list_pending,
            crate::ipc::alerts_create,
            crate::ipc::alerts_resolve,
            crate::ipc::alerts_snooze,
            crate::ipc::alerts_dismiss,
            crate::ipc::alerts_except,
            crate::ipc::alerts_sync_desktop_lock,
            crate::ipc::alerts_trigger_test_block,
            crate::ipc::report_summary,
            crate::ipc::integration_state,
            crate::ipc::daily_plan_get,
            crate::ipc::daily_plan_set_state,
            crate::ipc::daily_plan_set_payload,
            crate::ipc::github_sync_issues,
            crate::ipc::github_issues_list,
            crate::ipc::github_link_task,
            crate::ipc::github_unlink_task,
            crate::ipc::github_check_auth,
            crate::ipc::data_export_zip,
            crate::ipc::data_import_zip,
            crate::ipc::routines_list,
            crate::ipc::routines_set_enabled,
            crate::ipc::proposals_list_pending,
            crate::ipc::proposals_approve,
            crate::ipc::proposals_reject,
        ])
}

/// Convenience helper: get the shared `Db` out of the IPC state.
pub fn db_from(state: &State<'_, AppState>) -> Arc<Db> {
    Arc::clone(&state.db)
}
