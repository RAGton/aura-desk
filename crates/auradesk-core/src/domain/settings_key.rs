//! Settings keys: the canonical, exhaustive list of keys that may be
//! written to the `settings` table.
//!
//! Writes to `settings` are gated through this enum at the application
//! layer: any key not listed here returns `CoreError::Validation`.
//! This prevents typos like `pomodoro.focus_minn` from silently
//! creating new rows.

use serde::{Deserialize, Serialize};

/// All settings keys, matching the 17 defaults seeded by V001.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SettingsKey {
    /// Running app version (string, e.g. "0.1.0").
    AppVersion,
    /// UI theme preference ("light" | "dark" | "system").
    AppTheme,
    /// Active UI locale code (e.g. "pt-BR", "en").
    AppLocale,
    /// Dashboard auto-refresh interval in seconds.
    DashboardRefreshSec,
    /// Preferred external monitor name for full-screen dashboard.
    MonitorPreferred,
    /// What to do when `MonitorPreferred` is disconnected.
    MonitorFallbackStrategy,
    /// Whether reminder sound effects are enabled.
    RemindersSound,
    /// Until when reminders are snoozed (ISO-8601 string or null).
    RemindersPausedUntil,
    /// Focus phase duration in minutes.
    PomodoroFocusMin,
    /// Short break duration in minutes.
    PomodoroShortMin,
    /// Long break duration in minutes.
    PomodoroLongMin,
    /// Number of focus phases before a long break.
    PomodoroCyclesToLong,
    /// Local time of the daily planning routine (e.g. "07:50").
    RoutineDailyPlanningTime,
    /// Hydration reminder interval in minutes.
    RoutineWaterIntervalMin,
    /// Break reminder interval in minutes.
    RoutineBreakIntervalMin,
    /// Maximum number of alerts kept in the queue.
    AlertsMaxQueueSize,
    /// Time-to-live for pending IA proposals in hours.
    ProposalsTtlHours,
}

impl SettingsKey {
    /// String form stored in `settings.key`. Keep stable: changing the
    /// string is a migration.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AppVersion => "app.version",
            Self::AppTheme => "app.theme",
            Self::AppLocale => "app.locale",
            Self::DashboardRefreshSec => "dashboard.refresh_sec",
            Self::MonitorPreferred => "monitor.preferred",
            Self::MonitorFallbackStrategy => "monitor.fallback_strategy",
            Self::RemindersSound => "reminders.sound",
            Self::RemindersPausedUntil => "reminders.paused_until",
            Self::PomodoroFocusMin => "pomodoro.focus_min",
            Self::PomodoroShortMin => "pomodoro.short_min",
            Self::PomodoroLongMin => "pomodoro.long_min",
            Self::PomodoroCyclesToLong => "pomodoro.cycles_to_long",
            Self::RoutineDailyPlanningTime => "routine.daily_planning_time",
            Self::RoutineWaterIntervalMin => "routine.water_interval_min",
            Self::RoutineBreakIntervalMin => "routine.break_interval_min",
            Self::AlertsMaxQueueSize => "alerts.max_queue_size",
            Self::ProposalsTtlHours => "proposals.ttl_hours",
        }
    }

    /// Parse from the string form. Returns `None` for unknown keys.
    ///
    /// Not named `from_str` via `FromStr` because the public surface
    /// returns `Option<Self>` (not `Result<Self, _>`). The signature is
    /// preserved intentionally; `#[allow(clippy::should_implement_trait)]`
    /// documents the deliberate non-conformance.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "app.version" => Self::AppVersion,
            "app.theme" => Self::AppTheme,
            "app.locale" => Self::AppLocale,
            "dashboard.refresh_sec" => Self::DashboardRefreshSec,
            "monitor.preferred" => Self::MonitorPreferred,
            "monitor.fallback_strategy" => Self::MonitorFallbackStrategy,
            "reminders.sound" => Self::RemindersSound,
            "reminders.paused_until" => Self::RemindersPausedUntil,
            "pomodoro.focus_min" => Self::PomodoroFocusMin,
            "pomodoro.short_min" => Self::PomodoroShortMin,
            "pomodoro.long_min" => Self::PomodoroLongMin,
            "pomodoro.cycles_to_long" => Self::PomodoroCyclesToLong,
            "routine.daily_planning_time" => Self::RoutineDailyPlanningTime,
            "routine.water_interval_min" => Self::RoutineWaterIntervalMin,
            "routine.break_interval_min" => Self::RoutineBreakIntervalMin,
            "alerts.max_queue_size" => Self::AlertsMaxQueueSize,
            "proposals.ttl_hours" => Self::ProposalsTtlHours,
            _ => return None,
        })
    }

    /// All keys, in stable order. Used by `SettingsService::get_all` and
    /// by tooling that wants to enumerate the canonical set.
    pub const ALL: &'static [SettingsKey] = &[
        Self::AppVersion,
        Self::AppTheme,
        Self::AppLocale,
        Self::DashboardRefreshSec,
        Self::MonitorPreferred,
        Self::MonitorFallbackStrategy,
        Self::RemindersSound,
        Self::RemindersPausedUntil,
        Self::PomodoroFocusMin,
        Self::PomodoroShortMin,
        Self::PomodoroLongMin,
        Self::PomodoroCyclesToLong,
        Self::RoutineDailyPlanningTime,
        Self::RoutineWaterIntervalMin,
        Self::RoutineBreakIntervalMin,
        Self::AlertsMaxQueueSize,
        Self::ProposalsTtlHours,
    ];
}
