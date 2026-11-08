//! Tauri runtime: window, tray, lifecycle, and IPC command wiring.
//!
//! Phase 0 T5: window + tray + close-to-tray (skeleton).
//! Phase 1: DB initialization in `setup`; tasks/projects IPC commands
//! exposed to the frontend.
//! Phase 2+: Pomodoro-aware RoutineRunner (see `routines.rs`) that
//! suppresses hydration/break alerts while a focus block runs.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

use auradesk_core::infrastructure::db::Db;

pub use crate::ipc;

/// Shared state held by Tauri. The `Db` is wrapped in `Arc` so it
/// can be cheaply cloned into each IPC command invocation.
///
/// `in_focus_session` is set to `true` while a Pomodoro *focus*
/// session is running. The `RoutineRunner` reads it to suppress
/// routine alerts (water/break) while the user is in deep work.
/// This is the integration glue between Pomodoro and the
/// reminder/alert pipeline: the focus block is sacred, routine
/// interruptions are not surfaced until the focus ends.
pub struct AppState {
    pub db: Arc<Db>,
    pub in_focus_session: Arc<AtomicBool>,
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
            let in_focus = Arc::new(AtomicBool::new(false));
            app.manage(AppState {
                db: Arc::clone(&db),
                in_focus_session: Arc::clone(&in_focus),
            });

            // Launch the routine runner as a background task. It
            // owns its own `Db` handle and a clone of the focus flag,
            // so it survives even if the IPC state moves. The task
            // ticks every 15s and is the single source of truth for
            // routine-driven alerts (water, break, daily planning).
            std::thread::spawn({
                let db = Arc::clone(&db);
                let in_focus = Arc::clone(&in_focus);
                move || {
                    crate::routines::run_loop(db, in_focus);
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
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
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
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: closing the window does NOT exit the process.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
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
            crate::ipc::settings_get_all,
            crate::ipc::settings_set,
            crate::ipc::dashboard_summary,
            crate::ipc::alerts_list_pending,
            crate::ipc::alerts_create,
            crate::ipc::alerts_resolve,
            crate::ipc::alerts_snooze,
            crate::ipc::alerts_dismiss,
            crate::ipc::alerts_except,
            crate::ipc::report_summary,
            crate::ipc::integration_state,
            crate::ipc::daily_plan_get,
            crate::ipc::daily_plan_set_state,
            crate::ipc::daily_plan_set_payload,
        ])
}

/// Convenience helper: get the shared `Db` out of the IPC state.
pub fn db_from(state: &State<'_, AppState>) -> Arc<Db> {
    Arc::clone(&state.db)
}
