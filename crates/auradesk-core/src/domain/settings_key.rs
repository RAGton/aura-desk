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
    AppVersion,
    AppTheme,
    AppLocale,
    DashboardRefreshSec,
    MonitorPreferred,
    MonitorFallbackStrategy,
    RemindersSound,
    RemindersPausedUntil,
    PomodoroFocusMin,
    PomodoroShortMin,
    PomodoroLongMin,
    PomodoroCyclesToLong,
    RoutineDailyPlanningTime,
    RoutineWaterIntervalMin,
    RoutineBreakIntervalMin,
    AlertsMaxQueueSize,
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
