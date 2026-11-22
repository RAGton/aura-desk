//! OS-level user inactivity (idle) detection for Pomodoro auto-pause and routine suppression.

use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::db::Db;
use serde::Serialize;

/// Snapshot of current desktop user inactivity state emitted to the UI over `auradesk://idle-state`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleStateSnapshot {
    pub idle_secs: u64,
    pub threshold_secs: u64,
    pub is_idle: bool,
    pub auto_pause_pomodoro: bool,
    pub suppress_routines: bool,
    pub supported: bool,
}

/// Pure evaluator turning raw OS idle seconds and user settings into an [`IdleStateSnapshot`].
pub fn evaluate_idle_snapshot(
    os_idle_secs: Option<u64>,
    threshold_min: u64,
    auto_pause_pomodoro: bool,
    suppress_routines: bool,
) -> IdleStateSnapshot {
    let clamped_min = threshold_min.max(1);
    let threshold_secs = clamped_min.saturating_mul(60);
    match os_idle_secs {
        Some(idle_secs) => IdleStateSnapshot {
            idle_secs,
            threshold_secs,
            is_idle: idle_secs >= threshold_secs,
            auto_pause_pomodoro,
            suppress_routines,
            supported: true,
        },
        None => IdleStateSnapshot {
            idle_secs: 0,
            threshold_secs,
            is_idle: false,
            auto_pause_pomodoro,
            suppress_routines,
            supported: false,
        },
    }
}

/// Read idle settings from SQLite and evaluate the current OS idle state.
pub fn current_idle_snapshot(db: &Db) -> IdleStateSnapshot {
    let settings = SettingsService::new(db);
    let threshold_min = settings
        .get(SettingsKey::DesktopIdleThresholdMin)
        .ok()
        .flatten()
        .and_then(|v| v.as_u64())
        .unwrap_or(5);
    let auto_pause_pomodoro = settings
        .get(SettingsKey::DesktopIdleAutoPausePomodoro)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let suppress_routines = settings
        .get(SettingsKey::DesktopIdleSuppressRoutines)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    evaluate_idle_snapshot(
        query_os_idle_secs(),
        threshold_min,
        auto_pause_pomodoro,
        suppress_routines,
    )
}

/// Query OS user inactivity time in seconds. Returns `None` if unavailable in the current session.
pub fn query_os_idle_secs() -> Option<u64> {
    #[cfg(target_os = "windows")]
    {
        query_windows_idle_secs()
    }

    #[cfg(target_os = "linux")]
    {
        query_linux_idle_secs()
    }

    #[cfg(target_os = "macos")]
    {
        query_macos_idle_secs()
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn query_windows_idle_secs() -> Option<u64> {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }

    let mut info = LastInputInfo {
        cb_size: std::mem::size_of::<LastInputInfo>() as u32,
        dw_time: 0,
    };
    // SAFETY: `info` is properly initialized with its exact struct size.
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok == 0 {
        return None;
    }
    // SAFETY: `GetTickCount` takes no pointers and always returns system uptime ms.
    let now_ms = unsafe { GetTickCount() };
    let elapsed_ms = now_ms.wrapping_sub(info.dw_time);
    Some(u64::from(elapsed_ms) / 1000)
}

#[cfg(target_os = "linux")]
fn query_linux_idle_secs() -> Option<u64> {
    use std::process::Command;

    // 1. X11 fast path (`xprintidle` returns milliseconds).
    if let Ok(out) = Command::new("xprintidle").output() {
        if out.status.success() {
            if let Ok(ms) = String::from_utf8_lossy(&out.stdout).trim().parse::<u64>() {
                return Some(ms / 1000);
            }
        }
    }

    // 2. Wayland / KDE / GNOME D-Bus ScreenSaver interface (returns milliseconds).
    if let Ok(out) = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.ScreenSaver",
            "--object-path",
            "/org/freedesktop/ScreenSaver",
            "--method",
            "org.freedesktop.ScreenSaver.GetSessionIdleTime",
        ])
        .output()
    {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Some(ms) = parse_gdbus_u64(&stdout) {
                return Some(ms / 1000);
            }
        }
    }

    // 3. GNOME Mutter IdleMonitor fallback (returns milliseconds).
    if let Ok(out) = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.gnome.Mutter.IdleMonitor",
            "--object-path",
            "/org/gnome/Mutter/IdleMonitor/Core",
            "--method",
            "org.gnome.Mutter.IdleMonitor.GetIdletime",
        ])
        .output()
    {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Some(ms) = parse_gdbus_u64(&stdout) {
                return Some(ms / 1000);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn query_macos_idle_secs() -> Option<u64> {
    use std::process::Command;
    let out = Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if line.contains("HIDIdleTime") {
            let ns = line.split('=').nth(1)?.trim().parse::<u64>().ok()?;
            return Some(ns / 1_000_000_000);
        }
    }
    None
}

#[cfg(any(target_os = "linux", test))]
fn parse_gdbus_u64(output: &str) -> Option<u64> {
    // Examples: "(uint32 12500,)" or "(uint64 42000,)" or "(12500,)"
    output
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .next_back()
        .and_then(|digits| digits.parse::<u64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_idle_threshold_and_unsupported_fallback() {
        let active = evaluate_idle_snapshot(Some(120), 5, true, true);
        assert!(active.supported);
        assert!(!active.is_idle);
        assert_eq!(active.threshold_secs, 300);

        let idle = evaluate_idle_snapshot(Some(300), 5, true, true);
        assert!(idle.supported);
        assert!(idle.is_idle);

        let unsupported = evaluate_idle_snapshot(None, 5, true, true);
        assert!(!unsupported.supported);
        assert!(!unsupported.is_idle);
    }

    #[test]
    fn parses_gdbus_idle_time_outputs() {
        assert_eq!(parse_gdbus_u64("(uint32 12500,)\n"), Some(12500));
        assert_eq!(parse_gdbus_u64("(uint64 420000,)"), Some(420000));
        assert_eq!(parse_gdbus_u64("no digits here"), None);
    }
}
