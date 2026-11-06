//! Reminders application service.

#![allow(missing_docs)]

use chrono::{DateTime, Utc};

use crate::domain::alert::Alert;
use crate::domain::reminder::{
    NewReminder, Reminder, ReminderSound, ReminderStatus, RepeatKind, UpdateReminder,
};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing reminders.
pub struct RemindersService<'a> {
    pub db: &'a Db,
}

impl<'a> RemindersService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn create(&self, new: NewReminder) -> Result<Reminder, CoreError> {
        let now = Utc::now();
        Ok(Reminder {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: new.task_id,
            title: new.title,
            body: new.body,
            fire_at: new.fire_at,
            repeat_kind: new.repeat_kind,
            sound: new.sound,
            status: ReminderStatus::Pending,
            snooze_count: 0,
            last_snoozed_at: None,
            resolved_at: None,
            exceptions_log: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn get(&self, id: &str) -> Result<Reminder, CoreError> {
        let now = Utc::now();
        Ok(Reminder {
            id: id.to_string(),
            task_id: None,
            title: "Reminder".into(),
            body: None,
            fire_at: now,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Default,
            status: ReminderStatus::Pending,
            snooze_count: 0,
            last_snoozed_at: None,
            resolved_at: None,
            exceptions_log: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list(&self, _include_resolved: bool) -> Result<Vec<Reminder>, CoreError> {
        Ok(Vec::new())
    }

    pub fn poll_and_fire_overdue(&self, _now: DateTime<Utc>) -> Result<Vec<Alert>, CoreError> {
        Ok(Vec::new())
    }

    pub fn update(&self, id: &str, patch: UpdateReminder) -> Result<Reminder, CoreError> {
        let mut r = self.get(id)?;
        if let Some(title) = patch.title {
            r.title = title;
        }
        if let Some(body) = patch.body {
            r.body = body;
        }
        if let Some(fire_at) = patch.fire_at {
            r.fire_at = fire_at;
        }
        if let Some(repeat_kind) = patch.repeat_kind {
            r.repeat_kind = repeat_kind;
        }
        if let Some(sound) = patch.sound {
            r.sound = sound;
        }
        if let Some(status) = patch.status {
            r.status = status;
        }
        r.updated_at = Utc::now();
        Ok(r)
    }

    pub fn delete(&self, _id: &str) -> Result<(), CoreError> {
        Ok(())
    }

    pub fn dismiss(&self, id: &str) -> Result<Reminder, CoreError> {
        let mut r = self.get(id)?;
        r.status = ReminderStatus::Dismissed;
        r.resolved_at = Some(Utc::now());
        r.updated_at = Utc::now();
        Ok(r)
    }

    pub fn snooze(&self, id: &str, minutes: i32) -> Result<Reminder, CoreError> {
        let mut r = self.get(id)?;
        r.status = ReminderStatus::Snoozed;
        r.snooze_count += 1;
        let now = Utc::now();
        r.last_snoozed_at = Some(now);
        r.fire_at = now + chrono::Duration::minutes(minutes as i64);
        r.updated_at = now;
        Ok(r)
    }
}
