//! External alert modal window (`alert-popup`) and optional fullscreen
//! PC-blocking overlay manager (`alert-lock-*`) for desktop sessions.
//!
//! Whenever at least one unresolved alert exists in `alerts_pending`,
//! AuraDesk opens a standalone external floating dialog window (`alert-popup`,
//! routed to `/alert-popup`) so notifications pop in front of every other
//! application even when the main window is minimized or closed to tray.
//!
//! When `reminders.block_screen` is also enabled, AuraDesk creates fullscreen
//! undecorated, always-on-top overlay backdrops (`alert-lock-*` -> `/alert-lock?backdrop=1`)
//! across every connected monitor and owns `alert-popup` onto the primary
//! backdrop window so the external modal stays strictly above the lock screen
//! until all pending alerts are resolved, snoozed, or dismissed.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use auradesk_core::application::alerts::AlertsService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::db::Db;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::runtime::AppState;

/// Prefix shared by every fullscreen alert backdrop window label.
pub const LOCK_WINDOW_PREFIX: &str = "alert-lock-";

/// Label for the standalone external modal window shown for pending alerts.
pub const POPUP_WINDOW_LABEL: &str = "alert-popup";

/// Synchronize external alert popup and desktop lock backdrop windows with DB state.
///
/// Safe to call from either IPC handlers or the background `routines` thread;
/// all window mutations are marshaled onto Tauri's main UI thread.
pub fn sync_blocking_windows(app: &AppHandle, db: &Arc<Db>) {
    let block_enabled = SettingsService::new(db)
        .get(SettingsKey::RemindersBlockScreen)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let pending = AlertsService::new(db).list_pending().unwrap_or_default();
    let has_alerts = !pending.is_empty();
    let should_lock = block_enabled && has_alerts;

    if let Some(state) = app.try_state::<AppState>() {
        state.alert_popup_active.store(has_alerts, Ordering::SeqCst);
        state
            .screen_lock_active
            .store(should_lock, Ordering::SeqCst);
    }

    let _ = app.emit("auradesk://alerts-updated", &pending);

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        apply_alert_windows_on_main_thread(&app_handle, has_alerts, should_lock);
    });
}

/// Emergency fail-safe: dismiss pending alerts best-effort, reset lock state
/// flags unconditionally, and tear down all lock backdrops and popup windows.
pub fn emergency_unlock_all(app: &AppHandle, db: &Db) -> usize {
    let mut dismissed = 0usize;
    let svc = AlertsService::new(db);
    if let Ok(pending) = svc.list_pending() {
        for alert in pending {
            if svc.dismiss(&alert.id).is_ok() {
                dismissed += 1;
            }
        }
    }

    if let Some(state) = app.try_state::<AppState>() {
        state.alert_popup_active.store(false, Ordering::SeqCst);
        state.screen_lock_active.store(false, Ordering::SeqCst);
        state.popup_locked_mode.store(false, Ordering::SeqCst);
    }

    let _ = app.emit(
        "auradesk://alerts-updated",
        Vec::<auradesk_core::domain::alert::Alert>::new(),
    );

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        destroy_lock_backdrops(&app_handle);
        if let Some(popup) = app_handle.get_webview_window(POPUP_WINDOW_LABEL) {
            let _ = popup.destroy();
        }
    });

    dismissed
}

fn apply_alert_windows_on_main_thread(app: &AppHandle, has_alerts: bool, should_lock: bool) {
    let recreated_primary_lock = if should_lock {
        sync_lock_backdrops(app)
    } else {
        destroy_lock_backdrops(app);
        false
    };

    sync_popup_window(app, has_alerts, should_lock, recreated_primary_lock);
}

fn destroy_lock_backdrops(app: &AppHandle) {
    let lock_labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with(LOCK_WINDOW_PREFIX))
        .cloned()
        .collect();
    for label in lock_labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.destroy();
        }
    }
}

fn sync_lock_backdrops(app: &AppHandle) -> bool {
    let monitors = app.available_monitors().unwrap_or_default();
    let count = monitors.len().max(1);
    let mut created_primary = false;

    // Tear down any stale extra monitor overlays if monitor count shrank.
    let stale_labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| {
            label
                .strip_prefix(LOCK_WINDOW_PREFIX)
                .and_then(|s| s.parse::<usize>().ok())
                .is_some_and(|i| i >= count)
        })
        .cloned()
        .collect();
    for label in stale_labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.destroy();
        }
    }

    for idx in 0..count {
        let label = format!("{LOCK_WINDOW_PREFIX}{idx}");
        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.show();
            let _ = existing.set_always_on_top(true);
            let _ = existing.set_fullscreen(true);
            continue;
        }

        let title = auradesk_core::i18n::t("tray.alert_title");
        let mut builder =
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
                .initialization_script("window.__AURADESK_WINDOW_MODE__ = 'alert-lock-backdrop';")
                .background_color(tauri::window::Color(4, 7, 17, 255))
                .title(&title)
                .decorations(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .closable(false)
                .minimizable(false)
                .maximizable(false)
                .resizable(false)
                .skip_taskbar(true)
                .focused(false);

        if let Some(mon) = monitors.get(idx) {
            let scale = mon.scale_factor().max(1.0);
            let pos = mon.position();
            let size = mon.size();
            builder = builder
                .position(pos.x as f64 / scale, pos.y as f64 / scale)
                .inner_size(size.width as f64 / scale, size.height as f64 / scale);
        }

        match builder.build() {
            Ok(win) => {
                let _ = win.set_fullscreen(true);
                let _ = win.set_always_on_top(true);
                if idx == 0 {
                    created_primary = true;
                }
            }
            Err(err) => {
                eprintln!("alert_lock: failed building backdrop window {label}: {err}");
            }
        }
    }

    created_primary
}

fn sync_popup_window(
    app: &AppHandle,
    has_alerts: bool,
    should_lock: bool,
    recreated_primary_lock: bool,
) {
    if !has_alerts {
        if let Some(popup) = app.get_webview_window(POPUP_WINDOW_LABEL) {
            let _ = popup.destroy();
        }
        if let Some(state) = app.try_state::<AppState>() {
            state.popup_locked_mode.store(false, Ordering::SeqCst);
        }
        return;
    }

    let prev_locked = app
        .try_state::<AppState>()
        .is_some_and(|s| s.popup_locked_mode.load(Ordering::SeqCst));
    let needs_rebuild = prev_locked != should_lock || (should_lock && recreated_primary_lock);

    if needs_rebuild {
        if let Some(popup) = app.get_webview_window(POPUP_WINDOW_LABEL) {
            let _ = popup.destroy();
        }
    }

    let title = auradesk_core::i18n::t("tray.alert_title");
    if let Some(existing) = app.get_webview_window(POPUP_WINDOW_LABEL) {
        let _ = existing.set_title(&title);
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_focus();
        return;
    }

    let height = if should_lock { 490.0 } else { 410.0 };
    let make_builder = || {
        WebviewWindowBuilder::new(
            app,
            POPUP_WINDOW_LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .initialization_script("window.__AURADESK_WINDOW_MODE__ = 'alert-popup';")
        .background_color(tauri::window::Color(4, 7, 17, 255))
        .title(&title)
        .decorations(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .closable(false)
        .minimizable(false)
        .maximizable(false)
        .resizable(false)
        .skip_taskbar(false)
        .inner_size(520.0, height)
        .center()
        .focused(true)
    };
    let mut builder = make_builder();

    if should_lock {
        if let Some(lock_0) = app.get_webview_window("alert-lock-0") {
            match builder.parent(&lock_0) {
                Ok(owned) => builder = owned,
                Err(err) => {
                    eprintln!("alert_lock: failed parenting alert-popup to lock window: {err}");
                    builder = make_builder();
                }
            }
        }
    }

    match builder.build() {
        Ok(win) => {
            let _ = win.set_always_on_top(true);
            let _ = win.set_focus();
            if let Some(state) = app.try_state::<AppState>() {
                state.popup_locked_mode.store(should_lock, Ordering::SeqCst);
            }
        }
        Err(err) => {
            eprintln!("alert_lock: failed building external alert popup: {err}");
        }
    }
}
