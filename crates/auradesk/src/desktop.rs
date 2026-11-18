//! Desktop integration: multi-monitor discovery & fallback placement,
//! floating Compact Mode widget, OS login autostart, and Windows power/display
//! event notifications (Phase 3).

use std::sync::{Arc, Condvar, Mutex};

use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::desktop::{
    compute_compact_window_origin, resolve_target_monitor, MonitorFallbackStrategy, MonitorInfo,
    MonitorResolution,
};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::runtime::AppState;

/// Window label for the floating always-on-top compact mode widget.
pub const COMPACT_WINDOW_LABEL: &str = "compact";

/// Compact widget dimensions in logical DIPs.
pub const COMPACT_WIDTH: f64 = 304.0;
pub const COMPACT_HEIGHT: f64 = 104.0;

/// Snapshot of desktop-level capabilities & active state returned to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStateSnapshot {
    pub monitors: Vec<MonitorInfo>,
    pub compact_open: bool,
    pub autostart_enabled: bool,
    pub preferred_monitor: String,
    pub fallback_strategy: String,
}

/// Shared wake signal used to wake the background scheduler immediately after OS resume.
#[derive(Default)]
pub struct WakeSignal {
    inner: Mutex<bool>,
    cv: Condvar,
}

impl WakeSignal {
    pub fn new() -> Self {
        Self::default()
    }

    /// Notify the routines thread that an OS wake/resume occurred.
    pub fn trigger_resume(&self) {
        if let Ok(mut woken) = self.inner.lock() {
            *woken = true;
            self.cv.notify_all();
        }
    }

    /// Sleep for up to `timeout`, returning `true` if woken early by a resume signal.
    pub fn wait_timeout(&self, timeout: std::time::Duration) -> bool {
        let Ok(mut woken) = self.inner.lock() else {
            std::thread::sleep(timeout);
            return false;
        };
        if *woken {
            *woken = false;
            return true;
        }
        let (mut guard, _) = match self.cv.wait_timeout(woken, timeout) {
            Ok(pair) => pair,
            Err(poisoned) => poisoned.into_inner(),
        };
        let was_woken = *guard;
        *guard = false;
        was_woken
    }
}

/// Enumerate connected OS displays via Tauri.
pub fn list_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten();
    let primary_sig = primary.as_ref().map(|m| {
        (
            m.position().x,
            m.position().y,
            m.size().width,
            m.size().height,
        )
    });

    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(idx, m)| {
            let pos = m.position();
            let size = m.size();
            let name = m
                .name()
                .map(|n| n.trim())
                .filter(|n| !n.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("display-{}", idx + 1));
            let is_primary = primary_sig
                .is_some_and(|sig| sig == (pos.x, pos.y, size.width, size.height))
                || (primary_sig.is_none() && idx == 0);
            MonitorInfo {
                name,
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                scale_factor: m.scale_factor().max(1.0),
                is_primary,
            }
        })
        .collect()
}

/// Read current desktop state snapshot (monitors, compact window, autostart, prefs).
pub fn get_desktop_state(app: &AppHandle, db: &Db) -> DesktopStateSnapshot {
    let settings = SettingsService::new(db);
    let preferred_monitor = settings
        .get(SettingsKey::MonitorPreferred)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "primary".to_string());
    let fallback_strategy = settings
        .get(SettingsKey::MonitorFallbackStrategy)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "primary_then_hide".to_string());
    let autostart_enabled = get_autostart(db);
    let compact_open = app.get_webview_window(COMPACT_WINDOW_LABEL).is_some();
    DesktopStateSnapshot {
        monitors: list_monitors(app),
        compact_open,
        autostart_enabled,
        preferred_monitor,
        fallback_strategy,
    }
}

/// Position or hide the main dashboard window according to `monitor.preferred`
/// and `monitor.fallback_strategy`.
pub fn apply_monitor_preference(app: &AppHandle, db: &Db, reveal_if_placed: bool) -> String {
    let settings = SettingsService::new(db);
    let preferred = settings
        .get(SettingsKey::MonitorPreferred)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "primary".to_string());
    let strategy_raw = settings
        .get(SettingsKey::MonitorFallbackStrategy)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string));
    let strategy = MonitorFallbackStrategy::parse(strategy_raw.as_deref());

    let monitors = list_monitors(app);
    let resolution = resolve_target_monitor(&monitors, Some(&preferred), strategy);

    let outcome_label = match &resolution {
        MonitorResolution::PlaceOn(mon) => format!("placed:{}", mon.name),
        MonitorResolution::HideWindow => "hidden".to_string(),
    };

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(main_win) = app_handle.get_webview_window("main") else {
            return;
        };
        match resolution {
            MonitorResolution::PlaceOn(mon) => {
                let win_w = main_win
                    .outer_size()
                    .map(|s| s.width as f64 / mon.scale_factor.max(1.0))
                    .unwrap_or(1200.0);
                let win_h = main_win
                    .outer_size()
                    .map(|s| s.height as f64 / mon.scale_factor.max(1.0))
                    .unwrap_or(800.0);
                let x = mon.logical_x() + ((mon.logical_width() - win_w) / 2.0).max(0.0);
                let y = mon.logical_y() + ((mon.logical_height() - win_h) / 2.0).max(0.0);
                let _ = main_win.set_position(LogicalPosition::new(x, y));
                if reveal_if_placed {
                    let _ = main_win.unminimize();
                    let _ = main_win.show();
                    let _ = main_win.set_focus();
                }
            }
            MonitorResolution::HideWindow => {
                let _ = main_win.hide();
            }
        }
    });

    outcome_label
}

/// Show and focus the main application window.
pub fn show_main_window(app: &AppHandle) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_handle.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    });
}

/// Toggle (or explicitly set) the always-on-top floating Compact Mode window.
pub fn toggle_compact_window(
    app: &AppHandle,
    db: &Db,
    enabled: Option<bool>,
) -> Result<bool, String> {
    let currently_open = app.get_webview_window(COMPACT_WINDOW_LABEL).is_some();
    let target_open = enabled.unwrap_or(!currently_open);

    let _ = SettingsService::new(db).set(
        SettingsKey::DesktopCompactMode,
        serde_json::Value::Bool(target_open),
    );
    if let Some(state) = app.try_state::<AppState>() {
        state
            .compact_open
            .store(target_open, std::sync::atomic::Ordering::SeqCst);
    }

    let monitors = list_monitors(app);
    let primary = monitors
        .iter()
        .find(|m| m.is_primary)
        .or_else(|| monitors.first())
        .cloned();
    let title = auradesk_core::i18n::t("tray.compact_title");

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if !target_open {
            if let Some(win) = app_handle.get_webview_window(COMPACT_WINDOW_LABEL) {
                let _ = win.destroy();
            }
            return;
        }

        if let Some(existing) = app_handle.get_webview_window(COMPACT_WINDOW_LABEL) {
            let _ = existing.unminimize();
            let _ = existing.show();
            let _ = existing.set_always_on_top(true);
            let _ = existing.set_focus();
            return;
        }

        let mut builder = WebviewWindowBuilder::new(
            &app_handle,
            COMPACT_WINDOW_LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .initialization_script("window.__AURADESK_WINDOW_MODE__ = 'compact';")
        .background_color(tauri::window::Color(4, 7, 17, 255))
        .title(&title)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .inner_size(COMPACT_WIDTH, COMPACT_HEIGHT);

        if let Some(mon) = primary {
            let (x, y) = compute_compact_window_origin(&mon, COMPACT_WIDTH, 16.0);
            builder = builder.position(x, y);
        }

        if let Ok(win) = builder.build() {
            let _ = win.set_always_on_top(true);
        }
    });

    let _ = app.emit("auradesk://compact-changed", target_open);
    Ok(target_open)
}

/// Read the persisted autostart preference (best-effort reconciled with OS config).
pub fn get_autostart(db: &Db) -> bool {
    SettingsService::new(db)
        .get(SettingsKey::AppAutostart)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Enable or disable OS login autostart and persist `app.autostart`.
pub fn set_autostart(db: &Db, enabled: bool) -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|e| format!("resolve executable path: {e}"))?;
    apply_os_autostart(&exe, enabled)?;
    SettingsService::new(db)
        .set(SettingsKey::AppAutostart, serde_json::Value::Bool(enabled))
        .map_err(|e| format!("persist app.autostart: {e}"))?;
    Ok(enabled)
}

fn apply_os_autostart(exe: &std::path::Path, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        if enabled {
            let value = format!("\"{}\" --tray", exe.display());
            let out = std::process::Command::new("reg")
                .args([
                    "add", run_key, "/v", "AuraDesk", "/t", "REG_SZ", "/d", &value, "/f",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("reg add autostart: {e}"))?;
            if !out.status.success() {
                return Err(format!(
                    "reg add autostart failed: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
        } else {
            let _ = std::process::Command::new("reg")
                .args(["delete", run_key, "/v", "AuraDesk", "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let autostart_dir = linux_autostart_dir()?;
        let desktop_file = autostart_dir.join("auradesk.desktop");
        if enabled {
            std::fs::create_dir_all(&autostart_dir)
                .map_err(|e| format!("create autostart dir: {e}"))?;
            let content = auradesk_core::domain::desktop::format_linux_autostart_desktop_entry(
                &exe.display().to_string(),
            );
            std::fs::write(&desktop_file, content)
                .map_err(|e| format!("write autostart entry: {e}"))?;
        } else if desktop_file.exists() {
            std::fs::remove_file(&desktop_file)
                .map_err(|e| format!("remove autostart entry: {e}"))?;
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .ok_or_else(|| "missing HOME env var".to_string())?;
        let agents_dir = home.join("Library").join("LaunchAgents");
        let plist_path = agents_dir.join("com.ragton.auradesk.plist");
        if enabled {
            std::fs::create_dir_all(&agents_dir)
                .map_err(|e| format!("create LaunchAgents dir: {e}"))?;
            let plist = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
                 <plist version=\"1.0\"><dict>\n\
                 <key>Label</key><string>com.ragton.auradesk</string>\n\
                 <key>ProgramArguments</key><array><string>{}</string><string>--tray</string></array>\n\
                 <key>RunAtLoad</key><true/>\n\
                 </dict></plist>\n",
                exe.display()
            );
            std::fs::write(&plist_path, plist).map_err(|e| format!("write LaunchAgent: {e}"))?;
        } else if plist_path.exists() {
            std::fs::remove_file(&plist_path).map_err(|e| format!("remove LaunchAgent: {e}"))?;
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = (exe, enabled);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn linux_autostart_dir() -> Result<std::path::PathBuf, String> {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|s| !s.is_empty()) {
        return Ok(std::path::PathBuf::from(xdg).join("autostart"));
    }
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "missing HOME env var".to_string())?;
    Ok(home.join(".config").join("autostart"))
}

/// Spawn OS-level display hot-plug and suspend/resume watchers.
pub fn spawn_os_event_watcher(app: AppHandle, db: Arc<Db>, wake_signal: Arc<WakeSignal>) {
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            windows_os_event_loop(app, db, wake_signal);
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, db, wake_signal);
    }
}

#[cfg(target_os = "windows")]
fn windows_os_event_loop(app: AppHandle, db: Arc<Db>, wake_signal: Arc<WakeSignal>) {
    use std::ffi::c_void;
    use std::ptr::null;

    const WM_DISPLAYCHANGE: u32 = 0x007E;
    const WM_POWERBROADCAST: u32 = 0x0218;
    const PBT_APMSUSPEND: usize = 0x0004;
    const PBT_APMRESUMESUSPEND: usize = 0x0007;
    const PBT_APMRESUMEAUTOMATIC: usize = 0x0012;
    const HWND_MESSAGE: isize = -3;

    type Hwnd = isize;
    type Hinstance = isize;
    type Hicon = isize;
    type Hcursor = isize;
    type Hbrush = isize;
    type Hmenu = isize;
    type Atom = u16;
    type Lresult = isize;

    #[repr(C)]
    struct WndClassW {
        style: u32,
        lpfn_wnd_proc: unsafe extern "system" fn(Hwnd, u32, usize, isize) -> Lresult,
        cb_cls_extra: i32,
        cb_wnd_extra: i32,
        h_instance: Hinstance,
        h_icon: Hicon,
        h_cursor: Hcursor,
        hbr_background: Hbrush,
        lpsz_menu_name: *const u16,
        lpsz_class_name: *const u16,
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: Hwnd,
        message: u32,
        w_param: usize,
        l_param: isize,
        time: u32,
        pt: Point,
    }

    struct WatcherCtx {
        app: AppHandle,
        db: Arc<Db>,
        wake_signal: Arc<WakeSignal>,
    }

    const GWLP_USERDATA: i32 = -21;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(lp_module_name: *const u16) -> Hinstance;
    }

    #[link(name = "user32")]
    extern "system" {
        fn RegisterClassW(lp_wnd_class: *const WndClassW) -> Atom;
        fn CreateWindowExW(
            dw_ex_style: u32,
            lp_class_name: *const u16,
            lp_window_name: *const u16,
            dw_style: u32,
            x: i32,
            y: i32,
            n_width: i32,
            n_height: i32,
            h_wnd_parent: Hwnd,
            h_menu: Hmenu,
            h_instance: Hinstance,
            lp_param: *const c_void,
        ) -> Hwnd;
        fn DefWindowProcW(hwnd: Hwnd, msg: u32, w_param: usize, l_param: isize) -> Lresult;
        fn GetMessageW(
            lp_msg: *mut Msg,
            h_wnd: Hwnd,
            w_msg_filter_min: u32,
            w_msg_filter_max: u32,
        ) -> i32;
        fn TranslateMessage(lp_msg: *const Msg) -> i32;
        fn DispatchMessageW(lp_msg: *const Msg) -> Lresult;
        fn SetWindowLongPtrW(hwnd: Hwnd, n_index: i32, dw_new_long: isize) -> isize;
        fn GetWindowLongPtrW(hwnd: Hwnd, n_index: i32) -> isize;
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: Hwnd,
        msg: u32,
        w_param: usize,
        l_param: isize,
    ) -> Lresult {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const WatcherCtx;
        if !ptr.is_null() {
            let ctx = &*ptr;
            if msg == WM_POWERBROADCAST
                && (w_param == PBT_APMRESUMEAUTOMATIC || w_param == PBT_APMRESUMESUSPEND)
            {
                ctx.wake_signal.trigger_resume();
                let _ = ctx.app.emit("auradesk://system-resumed", ());
            } else if msg == WM_POWERBROADCAST && w_param == PBT_APMSUSPEND {
                let _ = ctx.app.emit("auradesk://system-suspended", ());
            } else if msg == WM_DISPLAYCHANGE {
                let _ = apply_monitor_preference(&ctx.app, &ctx.db, false);
                crate::alert_lock::sync_blocking_windows(&ctx.app, &ctx.db);
                let _ = ctx
                    .app
                    .emit("auradesk://monitors-changed", list_monitors(&ctx.app));
            }
        }
        DefWindowProcW(hwnd, msg, w_param, l_param)
    }

    let class_name: Vec<u16> = "AuraDeskOsEventWatcher\0".encode_utf16().collect();
    let window_name: Vec<u16> = "AuraDeskOsEventWatcherWindow\0".encode_utf16().collect();

    // SAFETY: Standard Win32 message-only window (`HWND_MESSAGE`) owning a leaked
    // WatcherCtx pointer for the lifetime of the background process thread.
    unsafe {
        let h_instance = GetModuleHandleW(null());
        let wc = WndClassW {
            style: 0,
            lpfn_wnd_proc: wnd_proc,
            cb_cls_extra: 0,
            cb_wnd_extra: 0,
            h_instance,
            h_icon: 0,
            h_cursor: 0,
            hbr_background: 0,
            lpsz_menu_name: null(),
            lpsz_class_name: class_name.as_ptr(),
        };
        let _ = RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            window_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            0,
            h_instance,
            null(),
        );
        if hwnd == 0 {
            return;
        }
        let ctx = Box::into_raw(Box::new(WatcherCtx {
            app,
            db,
            wake_signal,
        }));
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, ctx as isize);

        let mut msg = Msg {
            hwnd: 0,
            message: 0,
            w_param: 0,
            l_param: 0,
            time: 0,
            pt: Point { x: 0, y: 0 },
        };
        while GetMessageW(&mut msg, hwnd, 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_signal_wakes_early_when_triggered() {
        let sig = Arc::new(WakeSignal::new());
        let sig_clone = Arc::clone(&sig);
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(20));
            sig_clone.trigger_resume();
        });
        let woken = sig.wait_timeout(std::time::Duration::from_secs(2));
        handle.join().unwrap();
        assert!(woken);
    }

    #[test]
    fn wake_signal_times_out_cleanly_when_not_triggered() {
        let sig = WakeSignal::new();
        let woken = sig.wait_timeout(std::time::Duration::from_millis(15));
        assert!(!woken);
    }
}
