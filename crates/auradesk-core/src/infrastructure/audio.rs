//! Audio port and settings-aware dispatcher for reminder and alert sounds.

#![allow(missing_docs)]

use std::sync::Mutex;

use crate::application::settings::SettingsService;
use crate::domain::reminder::ReminderSound;
use crate::domain::settings_key::SettingsKey;
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Port for playing alert/reminder audio cues.
pub trait AudioPort: Send + Sync {
    fn play(&self, sound: ReminderSound) -> Result<(), CoreError>;
}

/// No-op audio implementation for headless environments and tests.
#[derive(Debug, Default)]
pub struct NoopAudio {
    played: Mutex<Vec<ReminderSound>>,
}

impl NoopAudio {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn played_sounds(&self) -> Vec<ReminderSound> {
        self.played.lock().map(|g| g.clone()).unwrap_or_default()
    }
}

impl AudioPort for NoopAudio {
    fn play(&self, sound: ReminderSound) -> Result<(), CoreError> {
        if !matches!(sound, ReminderSound::None) {
            if let Ok(mut guard) = self.played.lock() {
                guard.push(sound);
            }
        }
        Ok(())
    }
}

/// Dispatches sound cues while respecting the `reminders.sound` user setting.
pub struct SoundDispatcher<'a> {
    pub db: &'a Db,
    pub audio: &'a dyn AudioPort,
}

impl<'a> SoundDispatcher<'a> {
    pub fn new(db: &'a Db, audio: &'a dyn AudioPort) -> Self {
        Self { db, audio }
    }

    pub fn dispatch(&self, sound: ReminderSound) -> Result<bool, CoreError> {
        if matches!(sound, ReminderSound::None) {
            return Ok(false);
        }
        let sound_enabled = SettingsService::new(self.db)
            .get(SettingsKey::RemindersSound)
            .ok()
            .flatten()
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if !sound_enabled {
            return Ok(false);
        }

        self.audio.play(sound)?;
        Ok(true)
    }
}
