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
        let conn = self.db.reader();
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

    /// Read all raw rows from the settings table (used by data export).
    pub fn list_raw(&self) -> Result<Vec<(String, String, String)>, CoreError> {
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare("SELECT key, value, updated_at FROM settings")
            .map_err(|e| CoreError::internal(format!("settings list_raw: {e}")))?;
        let rows = stmt
            .query_map([], |row| {
                let key: String = row.get(0)?;
                let val_str: String = row.get(1)?;
                let updated_at: String = row.get(2)?;
                Ok((key, val_str, updated_at))
            })
            .map_err(|e| CoreError::internal(format!("settings list_raw query: {e}")))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("settings list_raw row: {e}")))?);
        }
        Ok(out)
    }

    /// Write one setting. Validates value type; rejects unknown keys.
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
        | SettingsKey::RoutineDailyPlanningTime
        | SettingsKey::GithubRepo
        | SettingsKey::AiProvider
        | SettingsKey::AiBaseUrl
        | SettingsKey::AiModel
        | SettingsKey::AiApiKey
        | SettingsKey::AiSystemPrompt
        | SettingsKey::RaglightMode
        | SettingsKey::RaglightBaseUrl
        | SettingsKey::RaglightApiKey
        | SettingsKey::RaglightProvider
        | SettingsKey::RaglightEmbeddingModel
        | SettingsKey::RaglightLlmModel
        | SettingsKey::RaglightVectorStore
        | SettingsKey::RaglightFolders
        | SettingsKey::HindsightBaseUrl
        | SettingsKey::HindsightDefaultBank
        | SettingsKey::HindsightLastMaintenanceDate => value.is_string(),
        SettingsKey::DashboardRefreshSec
        | SettingsKey::PomodoroFocusMin
        | SettingsKey::PomodoroShortMin
        | SettingsKey::PomodoroLongMin
        | SettingsKey::PomodoroCyclesToLong
        | SettingsKey::RoutineWaterIntervalMin
        | SettingsKey::RoutineBreakIntervalMin
        | SettingsKey::AlertsMaxQueueSize
        | SettingsKey::ProposalsTtlHours
        | SettingsKey::DesktopIdleThresholdMin => {
            value.is_number() && value.as_u64().is_some_and(|n| n > 0)
        }
        SettingsKey::AppAutostart
        | SettingsKey::DesktopCompactMode
        | SettingsKey::RemindersSound
        | SettingsKey::RemindersBlockScreen
        | SettingsKey::GithubAutoSync
        | SettingsKey::UpdatesAutoUpdate
        | SettingsKey::DesktopIdleAutoPausePomodoro
        | SettingsKey::DesktopIdleSuppressRoutines
        | SettingsKey::RaglightEnabled
        | SettingsKey::HindsightEnabled
        | SettingsKey::HindsightAutoCreateBanks
        | SettingsKey::HindsightDailyMaintenance => value.is_boolean(),
        SettingsKey::RemindersPausedUntil | SettingsKey::GithubProjectId => {
            value.is_null() || value.is_string()
        }
        SettingsKey::GithubFilterLabels => value.is_null() || value.is_string() || value.is_array(),
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
