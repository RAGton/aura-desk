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
    Emitter, Manager, State,
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
    pub data_dir: std::path::PathBuf,
    pub in_focus_session: Arc<AtomicBool>,
    pub screen_lock_active: Arc<AtomicBool>,
    pub alert_popup_active: Arc<AtomicBool>,
    pub popup_locked_mode: Arc<AtomicBool>,
    pub compact_open: Arc<AtomicBool>,
    pub github_fetcher: Arc<GhCliIssueFetcher>,
    pub updater: Arc<crate::updater::UpdaterManager>,
    pub raglight: Arc<crate::raglight::RaglightManager>,
    #[allow(dead_code)]
    pub instance_lock: Option<std::fs::File>,
}

#[cfg(windows)]
fn try_acquire_instance_lock(data_dir: &std::path::Path) -> Option<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    let lock_path = data_dir.join("auradesk.instance.lock");
    std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .share_mode(0)
        .open(lock_path)
        .ok()
}

#[cfg(not(windows))]
fn try_acquire_instance_lock(data_dir: &std::path::Path) -> Option<std::fs::File> {
    let lock_path = data_dir.join("auradesk.instance.lock");
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(lock_path)
        .ok()
}

pub fn build() -> tauri::Builder<tauri::Wry> {
    #[cfg(windows)]
    if let Some(custom_data) = std::env::var_os("AURADESK_DATA_DIR") {
        if !custom_data.is_empty() && std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            let wv = std::path::PathBuf::from(custom_data).join("webview2");
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", wv);
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            // Open the database. The path is resolved relative to the
            // app's data directory (e.g. `~/.local/share/com.ragton.auradesk/`
            // on Linux, `%APPDATA%` on Windows). In dev mode (when the
            // Tauri config is built without bundled resources), the
            // data dir still works — Tauri's `path::app_data_dir()`
            // honours the identifier in tauri.conf.json.
            let data_dir = match std::env::var_os("AURADESK_DATA_DIR") {
                Some(custom) if !custom.is_empty() => std::path::PathBuf::from(custom),
                _ => app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("resolve app data dir: {e}"))?,
            };
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("create app data dir {data_dir:?}: {e}"))?;
            crate::logging::init(&data_dir);

            let show_flag = data_dir.join("auradesk.show");
            let instance_lock = try_acquire_instance_lock(&data_dir);
            if instance_lock.is_none() {
                crate::logging::log_info(
                    "secondary instance detected; signaling existing instance to show",
                );
                let _ = std::fs::write(&show_flag, b"show");
                std::process::exit(0);
            }
            let _ = std::fs::remove_file(&show_flag);

            // `Db::open` joins `auradesk.db` itself; pass the data dir, not a file path.
            let db = Arc::new(Db::open(&data_dir).map_err(|e| {
                crate::logging::log_error(format!("open db {data_dir:?}: {e}"));
                format!("open db {data_dir:?}: {e}")
            })?);

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
            let initial_compact = SettingsService::new(&db)
                .get(SettingsKey::DesktopCompactMode)
                .ok()
                .flatten()
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let compact_open = Arc::new(AtomicBool::new(initial_compact));
            let github_fetcher = Arc::new(GhCliIssueFetcher::new());
            let updater_mgr = Arc::new(crate::updater::UpdaterManager::new(
                crate::updater::read_auto_update_setting(&db),
            ));
            app.manage(AppState {
                db: Arc::clone(&db),
                data_dir: data_dir.clone(),
                in_focus_session: Arc::clone(&in_focus),
                screen_lock_active,
                alert_popup_active,
                popup_locked_mode,
                compact_open,
                github_fetcher: Arc::clone(&github_fetcher),
                updater: Arc::clone(&updater_mgr),
                raglight: Arc::new(crate::raglight::RaglightManager::new()),
                instance_lock,
            });

            // Bring the local voice stack up in the background so the
            // assistant can talk as soon as the app opens. The containers
            // are rootless (this process runs as the desktop user), which
            // is why the app — and not a systemd unit — owns them.
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    crate::voice::autostart_voice_services(&app_handle);
                });
            }

            let start_in_tray = std::env::args().any(|a| a == "--tray");
            if start_in_tray {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            } else {
                let _ = crate::desktop::apply_monitor_preference(app.handle(), &db, false);
            }
            if initial_compact {
                let _ = crate::desktop::toggle_compact_window(app.handle(), &db, Some(true));
            }

            // Watch for secondary-instance launch signals to bring the existing window forward.
            std::thread::spawn({
                let app_handle = app.handle().clone();
                let show_flag = show_flag.clone();
                move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    if show_flag.exists() {
                        let _ = std::fs::remove_file(&show_flag);
                        let handle = app_handle.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            if let Some(win) = handle.get_webview_window("main") {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            if let Some(popup) = handle.get_webview_window(POPUP_WINDOW_LABEL) {
                                let _ = popup.unminimize();
                                let _ = popup.show();
                                let _ = popup.set_always_on_top(true);
                                let _ = popup.set_focus();
                            }
                        });
                    }
                }
            });

            // Sync fullscreen alert overlays at startup in case pending alerts
            // survived an OS reboot or app restart with `reminders.block_screen` enabled.
            crate::alert_lock::sync_blocking_windows(app.handle(), &db);

            let wake_signal = Arc::new(crate::desktop::WakeSignal::new());
            crate::desktop::spawn_os_event_watcher(
                app.handle().clone(),
                Arc::clone(&db),
                Arc::clone(&wake_signal),
            );

            // Launch the routine runner as a background task.
            std::thread::spawn({
                let app_handle = app.handle().clone();
                let db = Arc::clone(&db);
                let in_focus = Arc::clone(&in_focus);
                let github_fetcher = Arc::clone(&github_fetcher);
                let wake_signal = Arc::clone(&wake_signal);
                move || {
                    crate::routines::run_loop(
                        app_handle,
                        db,
                        in_focus,
                        github_fetcher,
                        wake_signal,
                    );
                }
            });

            // Background GitHub Releases auto-update checker & installer.
            crate::updater::spawn_auto_update_loop(
                app.handle().clone(),
                Arc::clone(&db),
                data_dir.clone(),
                Arc::clone(&updater_mgr),
            );

            // Tray menu items (spec §10 Phase 3)
            let show = MenuItem::with_id(
                app,
                "show",
                auradesk_core::i18n::t("tray.show"),
                true,
                None::<&str>,
            )?;
            let compact = MenuItem::with_id(
                app,
                "compact",
                auradesk_core::i18n::t("tray.compact"),
                true,
                None::<&str>,
            )?;
            let proposals = MenuItem::with_id(
                app,
                "proposals",
                auradesk_core::i18n::t("tray.proposals"),
                true,
                None::<&str>,
            )?;
            let check_updates = MenuItem::with_id(
                app,
                "check_updates",
                auradesk_core::i18n::t("tray.check_updates"),
                true,
                None::<&str>,
            )?;
            let pause_all = MenuItem::with_id(
                app,
                "pause_all",
                auradesk_core::i18n::t("tray.pause_all"),
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                auradesk_core::i18n::t("tray.quit"),
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &compact,
                    &proposals,
                    &check_updates,
                    &pause_all,
                    &quit,
                ],
            )?;

            // System tray
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        crate::desktop::show_main_window(app);
                    }
                    "compact" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            let _ = crate::desktop::toggle_compact_window(app, &state.db, None);
                        }
                    }
                    "proposals" => {
                        crate::desktop::show_main_window(app);
                        let _ = app.emit("auradesk://navigate", "hermes");
                    }
                    "check_updates" => {
                        let handle = app.clone();
                        std::thread::spawn(move || {
                            if let Some(state) = handle.try_state::<AppState>() {
                                let auto = crate::updater::read_auto_update_setting(&state.db);
                                let _ = crate::updater::check_and_maybe_install(
                                    &handle,
                                    &state.db,
                                    &state.data_dir,
                                    &state.updater,
                                    auto,
                                );
                            }
                        });
                        crate::desktop::show_main_window(app);
                    }
                    "pause_all" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            let until =
                                (chrono::Utc::now() + chrono::Duration::minutes(60)).to_rfc3339();
                            let _ = SettingsService::new(&state.db).set(
                                SettingsKey::RemindersPausedUntil,
                                serde_json::Value::String(until),
                            );
                            let _ = app.emit("auradesk://settings-updated", ());
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
                    } else if label == crate::desktop::COMPACT_WINDOW_LABEL {
                        let app = window.app_handle();
                        if let Some(state) = app.try_state::<AppState>() {
                            state.compact_open.store(false, Ordering::SeqCst);
                            let _ = SettingsService::new(&state.db).set(
                                SettingsKey::DesktopCompactMode,
                                serde_json::Value::Bool(false),
                            );
                        }
                        let _ = app.emit("auradesk://compact-changed", false);
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
            crate::ipc::tasks::tasks_list,
            crate::ipc::tasks::tasks_get,
            crate::ipc::tasks::tasks_create,
            crate::ipc::tasks::tasks_update,
            crate::ipc::tasks::tasks_delete,
            crate::ipc::tasks::tasks_set_status,
            crate::ipc::tasks::tasks_reorder,
            crate::ipc::tasks::projects_list,
            crate::ipc::tasks::projects_create,
            crate::ipc::time::pomodoro_start,
            crate::ipc::time::pomodoro_complete,
            crate::ipc::time::pomodoro_abandon,
            crate::ipc::time::pomodoro_active,
            crate::ipc::time::pomodoro_list,
            crate::ipc::time::reminders_list,
            crate::ipc::time::reminders_create,
            crate::ipc::time::reminders_update,
            crate::ipc::time::reminders_delete,
            crate::ipc::time::reminders_dismiss,
            crate::ipc::time::reminders_snooze,
            crate::ipc::time::settings_get,
            crate::ipc::time::settings_get_all,
            crate::ipc::time::settings_set,
            crate::ipc::dashboard::dashboard_summary,
            crate::ipc::alerts::alerts_list_pending,
            crate::ipc::alerts::alerts_create,
            crate::ipc::alerts::alerts_resolve,
            crate::ipc::alerts::alerts_snooze,
            crate::ipc::alerts::alerts_dismiss,
            crate::ipc::alerts::alerts_except,
            crate::ipc::alerts::alerts_sync_desktop_lock,
            crate::ipc::alerts::alerts_trigger_test_block,
            crate::ipc::alerts::alerts_emergency_unlock,
            crate::ipc::dashboard::report_summary,
            crate::ipc::dashboard::integration_state,
            crate::ipc::dashboard::daily_plan_get,
            crate::ipc::dashboard::daily_plan_set_state,
            crate::ipc::dashboard::daily_plan_set_payload,
            crate::ipc::integrations::github_sync_issues,
            crate::ipc::integrations::github_issues_list,
            crate::ipc::integrations::github_link_task,
            crate::ipc::integrations::github_unlink_task,
            crate::ipc::integrations::github_check_auth,
            crate::ipc::integrations::data_export_zip,
            crate::ipc::integrations::data_import_zip,
            crate::ipc::integrations::routines_list,
            crate::ipc::integrations::routines_set_enabled,
            crate::ipc::integrations::proposals_list_pending,
            crate::ipc::integrations::proposals_list_recent,
            crate::ipc::integrations::proposals_approve,
            crate::ipc::integrations::proposals_reject,
            crate::ipc::integrations::ia_commands_list,
            crate::ipc::integrations::hermes_status,
            crate::ipc::integrations::ai_provider_status,
            crate::ipc::integrations::ai_chat_history,
            crate::ipc::integrations::ai_chat_clear,
            crate::ipc::integrations::hermes_chat_send,
            crate::ipc::integrations::hermes_chat_cancel,
            crate::ipc::integrations::audio_capture_save,
            crate::ipc::voice::voice_service_status,
            crate::ipc::voice::voice_service_start,
            crate::ipc::voice::voice_service_stop,
            crate::ipc::integrations::raglight_status,
            crate::ipc::integrations::raglight_provision,
            crate::ipc::integrations::raglight_start,
            crate::ipc::integrations::raglight_stop,
            crate::ipc::integrations::raglight_ingest,
            crate::ipc::integrations::raglight_query,
            crate::ipc::integrations::hindsight_status,
            crate::ipc::integrations::hindsight_run_maintenance,
            crate::ipc::integrations::hindsight_recall,
            crate::ipc::aura::hindsight_banks_list,
            crate::ipc::aura::hindsight_bank_create,
            crate::ipc::aura::hindsight_bank_update,
            crate::ipc::aura::hindsight_bank_delete,
            crate::ipc::aura::hindsight_bank_stats,
            crate::ipc::aura::hindsight_memories_list,
            crate::ipc::aura::hindsight_memory_retain,
            crate::ipc::aura::hindsight_memory_get,
            crate::ipc::aura::hindsight_memory_history,
            crate::ipc::aura::hindsight_documents_list,
            crate::ipc::aura::hindsight_document_get,
            crate::ipc::aura::hindsight_entities_list,
            crate::ipc::aura::hindsight_entity_get,
            crate::ipc::aura::hindsight_graph,
            crate::ipc::aura::hindsight_mental_models,
            crate::ipc::aura::hindsight_mental_model_create,
            crate::ipc::aura::hindsight_mental_model_refresh,
            crate::ipc::aura::hindsight_mental_model_delete,
            crate::ipc::aura::hindsight_directives_list,
            crate::ipc::aura::hindsight_directive_create,
            crate::ipc::aura::hindsight_directive_delete,
            crate::ipc::aura::hindsight_operations_list,
            crate::ipc::aura::hindsight_bank_consolidate,
            crate::ipc::aura::hindsight_global_search,
            crate::ipc::aura::hindsight_galaxy_snapshot,
            crate::ipc::aura::knowledge_overview,
            crate::ipc::aura::knowledge_documents_list,
            crate::ipc::aura::knowledge_document_get,
            crate::ipc::aura::knowledge_graph,
            crate::ipc::aura::knowledge_search,
            crate::ipc::aura::chat_sessions_list,
            crate::ipc::aura::chat_sessions_create,
            crate::ipc::aura::chat_sessions_get,
            crate::ipc::aura::chat_sessions_rename,
            crate::ipc::aura::chat_sessions_set_status,
            crate::ipc::aura::chat_sessions_delete,
            crate::ipc::aura::context_engine_inspect,
            crate::ipc::aura::context_engine_compress,
            crate::ipc::aura::agents_overview,
            crate::ipc::aura::agents_set_tool_policy,
            crate::ipc::aura::agents_plan_preview,
            crate::ipc::aura::agents_bots_list,
            crate::ipc::aura::agents_bots_upsert,
            crate::ipc::aura::agents_bots_delete,
            crate::ipc::aura::agents_skills_list,
            crate::ipc::aura::agents_skills_install,
            crate::ipc::aura::agents_skills_import_local,
            crate::ipc::aura::agents_skills_toggle,
            crate::ipc::aura::agents_skills_delete,
            crate::ipc::aura::agents_mcp_plugins_list,
            crate::ipc::aura::agents_mcp_plugins_upsert,
            crate::ipc::aura::agents_mcp_plugins_test,
            crate::ipc::aura::agents_mcp_plugins_delete,
            crate::ipc::desktop::desktop_list_monitors,
            crate::ipc::desktop::desktop_apply_monitor_preference,
            crate::ipc::desktop::desktop_toggle_compact,
            crate::ipc::desktop::desktop_show_main,
            crate::ipc::desktop::desktop_get_state,
            crate::ipc::desktop::desktop_set_autostart,
            crate::ipc::desktop::desktop_get_idle_state,
            crate::ipc::desktop::desktop_pick_folder,
            crate::ipc::desktop::updater_get_state,
            crate::ipc::desktop::updater_check_now,
            crate::ipc::desktop::updater_install_now,
            crate::ipc::desktop::app_open_logs_dir,
            crate::ipc::desktop::app_get_logs_tail,
        ])
}

/// Convenience helper: get the shared `Db` out of the IPC state.
pub fn db_from(state: &State<'_, AppState>) -> Arc<Db> {
    Arc::clone(&state.db)
}
