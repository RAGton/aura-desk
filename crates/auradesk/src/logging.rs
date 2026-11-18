//! Persistent runtime logging & panic crash diagnostics (`<data_dir>/logs/`).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Utc;

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

/// Resolve the application data directory before Tauri's `setup` runs so panic hooks
/// and early WebView2 failures are always captured on disk.
pub fn resolve_early_data_dir() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("AURADESK_DATA_DIR") {
        if !custom.is_empty() {
            return Some(PathBuf::from(custom));
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join("com.ragton.auradesk"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join(concat!("Application", " ", "Support"))
                .join("com.ragton.auradesk")
        })
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|s| !s.is_empty()) {
            return Some(PathBuf::from(xdg).join("com.ragton.auradesk"));
        }
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join(".local")
                .join("share")
                .join("com.ragton.auradesk")
        })
    }
}

/// Initialize the file logger and install a process-wide panic hook writing to
/// `<log_dir>/auradesk.log` and `<log_dir>/auradesk-crash.log`.
pub fn init(data_dir: &Path) -> PathBuf {
    let logs_dir = data_dir.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    let _ = LOG_DIR.set(logs_dir.clone());
    install_panic_hook_once();
    log_info(format!(
        "auradesk v{} starting (os={}, arch={})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    logs_dir
}

pub fn logs_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

fn install_panic_hook_once() {
    static HOOK_SET: OnceLock<()> = OnceLock::new();
    HOOK_SET.get_or_init(|| {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let thread = std::thread::current();
            let thread_name = thread.name().unwrap_or("unnamed");
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "unknown".to_string());
            let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "non-string panic payload".to_string()
            };
            let bt = std::backtrace::Backtrace::force_capture();
            let report = format!(
                "=== PANIC at {} [thread={thread_name}] ===\nlocation: {location}\nmessage: {payload}\nbacktrace:\n{bt}\n",
                Utc::now().to_rfc3339()
            );
            append_file("auradesk.log", &report);
            append_file("auradesk-crash.log", &report);
            prev(info);
        }));
    });
}

pub fn log_info(msg: impl AsRef<str>) {
    write_line("INFO", msg.as_ref());
}

pub fn log_warn(msg: impl AsRef<str>) {
    write_line("WARN", msg.as_ref());
}

pub fn log_error(msg: impl AsRef<str>) {
    write_line("ERROR", msg.as_ref());
}

fn write_line(level: &str, msg: &str) {
    let line = format!("{} [{}] {}\n", Utc::now().to_rfc3339(), level, msg);
    append_file("auradesk.log", &line);
}

fn append_file(file_name: &str, text: &str) {
    let Some(dir) = LOG_DIR.get() else {
        return;
    };
    let Ok(_guard) = LOG_LOCK.lock() else {
        return;
    };
    let _ = fs::create_dir_all(dir);
    let path = dir.join(file_name);
    if file_name == "auradesk.log" {
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_LOG_BYTES {
                let backup = dir.join("auradesk.log.1");
                let _ = fs::remove_file(&backup);
                let _ = fs::rename(&path, &backup);
            }
        }
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(text.as_bytes());
    }
}

/// Read up to the last `max_lines` from `auradesk.log` (or empty if missing).
pub fn read_recent_logs(max_lines: usize) -> Vec<String> {
    let Some(dir) = LOG_DIR.get() else {
        return Vec::new();
    };
    let path = dir.join("auradesk.log");
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let lines: Vec<String> = raw.lines().map(str::to_string).collect();
    let keep = max_lines.clamp(1, 500);
    if lines.len() <= keep {
        lines
    } else {
        lines[lines.len() - keep..].to_vec()
    }
}

/// Open the log directory in the OS file explorer.
pub fn open_logs_directory() -> Result<String, String> {
    let Some(dir) = LOG_DIR.get() else {
        return Err("logs directory unavailable".to_string());
    };
    let _ = fs::create_dir_all(dir);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("open logs explorer: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("open logs Finder: {e}"))?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("open logs xdg-open: {e}"))?;
    }
    Ok(dir.display().to_string())
}

/// Show a user-visible fatal error dialog on Windows when GUI startup fails before WebView renders.
pub fn report_fatal_startup(err: &str) {
    log_error(format!("fatal startup failure: {err}"));
    append_file(
        "auradesk-crash.log",
        &format!("=== crash {} ===\n{err}\n\n", Utc::now().to_rfc3339()),
    );

    #[cfg(target_os = "windows")]
    {
        let log_hint = LOG_DIR
            .get()
            .map(|d| d.join("auradesk-crash.log").display().to_string())
            .unwrap_or_else(|| "auradesk-crash.log".into());
        let title_str = format!("{}\0", auradesk_core::i18n::t("crash.title"));
        let msg_str = format!(
            "{}\0",
            auradesk_core::i18n::t_with(
                "crash.startup_failed",
                &[("error", err), ("path", &log_hint)],
            )
        );
        let title: Vec<u16> = title_str.encode_utf16().collect();
        let msg: Vec<u16> = msg_str.encode_utf16().collect();
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, kind: u32) -> i32;
        }
        const MB_OK: u32 = 0x0000_0000;
        const MB_ICONERROR: u32 = 0x0000_0010;
        // SAFETY: Null-terminated UTF-16 buffers outlive synchronous MessageBoxW call.
        unsafe {
            let _ = MessageBoxW(0, msg.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_data_dir_respecting_override() {
        let prev = std::env::var_os("AURADESK_DATA_DIR");
        let tmp = std::env::temp_dir().join("auradesk-log-dir-test");
        std::env::set_var("AURADESK_DATA_DIR", &tmp);
        assert_eq!(resolve_early_data_dir(), Some(tmp.clone()));
        match prev {
            Some(v) => std::env::set_var("AURADESK_DATA_DIR", v),
            None => std::env::remove_var("AURADESK_DATA_DIR"),
        }
    }
}
