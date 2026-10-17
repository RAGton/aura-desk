//! Settings service: read/write `settings` table via the SettingsKey
//! enum. Phase 0 T8: enum + service skeleton. Repository patterns
//! (one per aggregate) are added in T1+.

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::domain::settings_key::SettingsKey;
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Read/write the `settings` table.
pub struct SettingsService<'a> {
    db: &'a Db,
}

impl<'a> SettingsService<'a> {
    /// Build a settings service bound to the given database.
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Read one setting. Returns `None` if the key is not in the table
    /// (which would indicate a missing seed or a manual row deletion).
    pub fn get(&self, key: SettingsKey) -> Result<Option<Value>, CoreError> {
        let conn = self.db.writer();
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("settings get: {e}")))?;
        match raw {
            Some(s) => {
                let value: Value = serde_json::from_str(&s)
                    .map_err(|e| CoreError::internal(format!("settings parse: {e}")))?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    /// Read all known settings. Useful for the UI's settings page.
    pub fn get_all(&self) -> Result<Vec<(SettingsKey, Value)>, CoreError> {
        let mut out = Vec::with_capacity(SettingsKey::ALL.len());
        for &key in SettingsKey::ALL {
            if let Some(v) = self.get(key)? {
                out.push((key, v));
            }
        }
        Ok(out)
    }

    /// Write one setting. UPSERT semantics. The type of `value` is
    /// validated against the key (e.g., boolean for RemindersSound,
    /// positive integer for PomodoroFocusMin).
    pub fn set(&self, key: SettingsKey, value: Value) -> Result<(), CoreError> {
        validate(key, &value)?;
        let raw = serde_json::to_string(&value)
            .map_err(|e| CoreError::internal(format!("settings serialize: {e}")))?;
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now')) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![key.as_str(), raw],
        )
        .map_err(|e| CoreError::internal(format!("settings set: {e}")))?;
        Ok(())
    }
}

/// Validate the JSON value against the key's expected type.
fn validate(key: SettingsKey, value: &Value) -> Result<(), CoreError> {
    let ok = match key {
        SettingsKey::AppVersion
        | SettingsKey::AppTheme
        | SettingsKey::AppLocale
        | SettingsKey::MonitorPreferred
        | SettingsKey::MonitorFallbackStrategy
        | SettingsKey::RoutineDailyPlanningTime => value.is_string(),
        SettingsKey::DashboardRefreshSec
        | SettingsKey::PomodoroFocusMin
        | SettingsKey::PomodoroShortMin
        | SettingsKey::PomodoroLongMin
        | SettingsKey::PomodoroCyclesToLong
        | SettingsKey::RoutineWaterIntervalMin
        | SettingsKey::RoutineBreakIntervalMin
        | SettingsKey::AlertsMaxQueueSize
        | SettingsKey::ProposalsTtlHours => {
            value.is_number() && value.as_u64().is_some_and(|n| n > 0)
        }
        SettingsKey::RemindersSound => value.is_boolean(),
        SettingsKey::RemindersPausedUntil => value.is_null() || value.is_string(),
    };
    if ok {
        Ok(())
    } else {
        Err(CoreError::validation(
            key.as_str(),
            format!("value does not match expected type: {value}"),
        ))
    }
}
