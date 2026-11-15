//! Full-screen PC-blocking alert overlay manager for desktop sessions.
//!
//! When `reminders.block_screen` is enabled and there is at least one unresolved
//! alert in `alerts_pending`, this module creates/focuses undecorated,
//! always-on-top, fullscreen Tauri overlay windows (`alert-lock-*`) on every
//! connected monitor pointing to `/alert-lock`. They cannot be closed cleanly
//! via `Alt+F4` or window close events until all pending alerts are resolved,
//! snoozed, or dismissed (or `reminders.block_screen` is turned off).

use std::sync::atomic::Ordering;
use std::sync::Arc;

use auradesk_core::application::alerts::AlertsService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::db::Db;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::runtime::AppState;

/// Prefix shared by every fullscreen alert overlay window label.
pub const LOCK_WINDOW_PREFIX: &str = "alert-lock-";

/// Synchronize desktop blocking overlay windows with the current DB state.
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
    let should_lock = block_enabled && !pending.is_empty();

    if let Some(state) = app.try_state::<AppState>() {
        state
            .screen_lock_active
            .store(should_lock, Ordering::SeqCst);
    }

    let _ = app.emit("auradesk://alerts-updated", &pending);

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        apply_lock_windows_on_main_thread(&app_handle, should_lock);
    });
}

fn apply_lock_windows_on_main_thread(app: &AppHandle, should_lock: bool) {
    if !should_lock {
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
        return;
    }

    let monitors = app.available_monitors().unwrap_or_default();
    let count = monitors.len().max(1);

    // Tear down any stale extra monitor overlays if monitor count shrank.
    for (label, win) in app.webview_windows() {
        if let Some(suffix) = label.strip_prefix(LOCK_WINDOW_PREFIX) {
            if suffix.parse::<usize>().ok().is_some_and(|i| i >= count) {
                let _ = win.destroy();
            }
        }
    }

    for idx in 0..count {
        let label = format!("{LOCK_WINDOW_PREFIX}{idx}");
        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.show();
            let _ = existing.set_always_on_top(true);
            let _ = existing.set_fullscreen(true);
            if idx == 0 {
                let _ = existing.set_focus();
            }
            continue;
        }

        let mut builder =
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App("alert-lock".into()))
                .title("AuraDesk")
                .decorations(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .closable(false)
                .minimizable(false)
                .maximizable(false)
                .resizable(false)
                .skip_taskbar(true)
                .focused(idx == 0);

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
                    let _ = win.set_focus();
                }
            }
            Err(err) => {
                eprintln!("alert_lock: failed building overlay window {label}: {err}");
            }
        }
    }
}
