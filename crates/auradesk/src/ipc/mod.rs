//! Tauri IPC commands, split by domain.
//!
//! Exposes domain services (tasks, projects, pomodoro, reminders,
//! settings, daily plans, alerts, metrics, reports, integrations,
//! desktop, updater, and logs) to the frontend.

pub mod alerts;
pub mod dashboard;
pub mod desktop;
pub mod integrations;
pub mod tasks;
pub mod time;

pub use alerts::*;
pub use dashboard::*;
pub use desktop::*;
pub use integrations::*;
pub use tasks::*;
pub use time::*;

use auradesk_core::application::settings::SettingsService;
use auradesk_core::CoreError;
use tauri::State;

use crate::runtime::{db_from, AppState};

/// Round-trip a static string. Used by the frontend to confirm
/// the IPC channel is alive at app start.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

/// Settings ping: same as `ping` but reaches through the
/// service layer (proves the `SettingsService` and the `Db`
/// round-trip work end-to-end). Useful in dev for quick smoke.
#[tauri::command]
pub fn settings_ping(state: State<'_, AppState>) -> Result<usize, String> {
    let db = db_from(&state);
    let svc = SettingsService::new(&db);
    svc.get_all()
        .map(|v| v.len())
        .map_err(|e| format!("settings_ping: {e}"))
}

pub(crate) fn parse_rfc3339(s: &str) -> Result<chrono::DateTime<chrono::Utc>, CoreError> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&chrono::Utc))
        .map_err(|e| CoreError::validation("date", format!("invalid RFC3339 {s}: {e}")))
}
