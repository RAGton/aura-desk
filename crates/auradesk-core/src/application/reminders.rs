//! Reminders application service backed by SQLite (`reminders`, `alerts_pending`, `notifications`).

#![allow(missing_docs)]

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension};

use crate::domain::alert::{Alert, AlertSeverity};
use crate::domain::reminder::{
    NewReminder, Reminder, ReminderSound, ReminderStatus, RepeatKind, UpdateReminder,
};
use crate::infrastructure::clock::{Clock, SystemClock};
use crate::infrastructure::db::Db;
use crate::CoreError;

static SYSTEM_CLOCK: SystemClock = SystemClock;

/// Service for managing reminders and firing overdue reminders into the alert queue.
pub struct RemindersService<'a> {
    pub db: &'a Db,
    pub clock: &'a dyn Clock,
}

impl<'a> RemindersService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self {
            db,
            clock: &SYSTEM_CLOCK,
        }
    }

    pub fn with_clock(db: &'a Db, clock: &'a dyn Clock) -> Self {
        Self { db, clock }
    }

    pub fn create(&self, new: NewReminder) -> Result<Reminder, CoreError> {
        if new.title.trim().is_empty() {
            return Err(CoreError::validation("title", "blank title"));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = self.clock.now();
        let now_str = now.to_rfc3339();
        let fire_str = new.fire_at.to_rfc3339();
        let repeat_str = new.repeat_kind.as_str();
        let sound_db = sound_to_db(new.sound);

        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO reminders (id, task_id, title, body, fire_at, repeat_kind, sound, \
             status, snooze_count, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?8)",
            params![
                id,
                new.task_id,
                new.title,
                new.body,
                fire_str,
                repeat_str,
                sound_db,
                now_str,
            ],
        )
        .map_err(|e| CoreError::internal(format!("reminders create: {e}")))?;
        drop(conn);

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> Result<Reminder, CoreError> {
        let conn = self.db.writer();
        let rem = conn
            .query_row(
                "SELECT id, task_id, title, body, fire_at, repeat_kind, sound, status, \
                 snooze_count, last_snoozed_at, resolved_at, exceptions_log, created_at, updated_at \
                 FROM reminders WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("reminders get: {e}")))?;

        rem.ok_or_else(|| CoreError::not_found("reminder", id))
    }

    pub fn list(&self, include_resolved: bool) -> Result<Vec<Reminder>, CoreError> {
        let conn = self.db.writer();
        let sql = if include_resolved {
            "SELECT id, task_id, title, body, fire_at, repeat_kind, sound, status, \
             snooze_count, last_snoozed_at, resolved_at, exceptions_log, created_at, updated_at \
             FROM reminders ORDER BY fire_at ASC"
        } else {
            "SELECT id, task_id, title, body, fire_at, repeat_kind, sound, status, \
             snooze_count, last_snoozed_at, resolved_at, exceptions_log, created_at, updated_at \
             FROM reminders WHERE status IN ('pending', 'fired', 'snoozed') ORDER BY fire_at ASC"
        };

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| CoreError::internal(format!("reminders list prepare: {e}")))?;
        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| CoreError::internal(format!("reminders list query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("reminders row: {e}")))?);
        }
        Ok(out)
    }

    /// Atomically polls all pending reminders due at or before `now`,
    /// creates `alerts_pending` + `notifications` records, and transitions
    /// each fired reminder to `status = 'fired'`.
    pub fn poll_and_fire_overdue(&self, now: DateTime<Utc>) -> Result<Vec<Alert>, CoreError> {
        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("poll_overdue tx: {e}")))?;
        let mut due_reminders = Vec::new();
        {
            let mut stmt = tx
                .prepare(
                    "SELECT id, task_id, title, body, fire_at, repeat_kind, sound, status, \
                     snooze_count, last_snoozed_at, resolved_at, exceptions_log, created_at, updated_at \
                     FROM reminders WHERE status = 'pending' \
                     AND NOT EXISTS ( \
                         SELECT 1 FROM alerts_pending ap \
                         WHERE ap.kind = 'reminder' AND ap.ref_id = reminders.id AND ap.resolved_at IS NULL \
                     ) \
                     ORDER BY fire_at ASC",
                )
                .map_err(|e| CoreError::internal(format!("poll_overdue prepare: {e}")))?;

            let rows = stmt
                .query_map([], Self::map_row)
                .map_err(|e| CoreError::internal(format!("poll_overdue query: {e}")))?;

            for r in rows {
                let rem = r.map_err(|e| CoreError::internal(format!("poll_overdue row: {e}")))?;
                if rem.fire_at <= now {
                    due_reminders.push(rem);
                }
            }
        }

        let now_str = now.to_rfc3339();
        let mut fired_alerts = Vec::new();

        for rem in due_reminders {
            // Check if there was a previous snoozed alert for this reminder
            let parent_alert_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM alerts_pending \
                     WHERE kind = 'reminder' AND ref_id = ?1 AND resolution = 'snoozed' \
                     ORDER BY resolved_at DESC LIMIT 1",
                    params![rem.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| CoreError::internal(format!("lookup parent_alert_id: {e}")))?;

            let severity = match rem.sound {
                ReminderSound::Urgent => AlertSeverity::Urgent,
                ReminderSound::None | ReminderSound::Chime => AlertSeverity::Info,
                ReminderSound::Normal | ReminderSound::Default => AlertSeverity::Normal,
            };
            let sev_db = match severity {
                AlertSeverity::Info | AlertSeverity::Low => "info",
                AlertSeverity::Urgent | AlertSeverity::Critical | AlertSeverity::High => "urgent",
                _ => "normal",
            };

            let alert_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO alerts_pending \
                 (id, kind, ref_id, title, body, severity, options, parent_alert_id, created_at) \
                 VALUES (?1, 'reminder', ?2, ?3, ?4, ?5, NULL, ?6, ?7)",
                params![
                    alert_id,
                    rem.id,
                    rem.title,
                    rem.body,
                    sev_db,
                    parent_alert_id,
                    now_str,
                ],
            )
            .map_err(|e| CoreError::internal(format!("insert alert from reminder: {e}")))?;

            let notif_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO notifications (id, alert_id, kind, ref_id, title, body, delivered_at) \
                 VALUES (?1, ?2, 'reminder', ?3, ?4, ?5, ?6)",
                params![
                    notif_id,
                    alert_id,
                    rem.id,
                    rem.title,
                    rem.body,
                    now_str,
                ],
            )
            .map_err(|e| CoreError::internal(format!("insert notification: {e}")))?;

            tx.execute(
                "UPDATE reminders SET status = 'fired', updated_at = ?1 WHERE id = ?2",
                params![now_str, rem.id],
            )
            .map_err(|e| CoreError::internal(format!("mark reminder fired: {e}")))?;

            fired_alerts.push(Alert {
                id: alert_id,
                kind: "reminder".to_string(),
                title: rem.title,
                body: rem.body,
                severity,
                ref_id: Some(rem.id),
                options: None,
                resolution: None,
                resolved_at: None,
                created_at: now_str.clone(),
            });
        }

        tx.commit()
            .map_err(|e| CoreError::internal(format!("poll_overdue commit: {e}")))?;
        Ok(fired_alerts)
    }

    pub fn update(&self, id: &str, patch: UpdateReminder) -> Result<Reminder, CoreError> {
        let mut r = self.get(id)?;
        if let Some(title) = patch.title {
            if title.trim().is_empty() {
                return Err(CoreError::validation("title", "blank title"));
            }
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
        let now_str = self.clock.now().to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "UPDATE reminders SET title = ?1, body = ?2, fire_at = ?3, repeat_kind = ?4, \
             sound = ?5, status = ?6, updated_at = ?7 WHERE id = ?8",
            params![
                r.title,
                r.body,
                r.fire_at.to_rfc3339(),
                r.repeat_kind.as_str(),
                sound_to_db(r.sound),
                r.status.as_str(),
                now_str,
                id,
            ],
        )
        .map_err(|e| CoreError::internal(format!("reminders update: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn delete(&self, id: &str) -> Result<(), CoreError> {
        let conn = self.db.writer();
        let affected = conn
            .execute("DELETE FROM reminders WHERE id = ?1", params![id])
            .map_err(|e| CoreError::internal(format!("reminders delete: {e}")))?;
        if affected == 0 {
            return Err(CoreError::not_found("reminder", id));
        }
        Ok(())
    }

    pub fn dismiss(&self, id: &str) -> Result<Reminder, CoreError> {
        let _existing = self.get(id)?;
        let now_str = self.clock.now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE reminders SET status = 'dismissed', resolved_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now_str, id],
        )
        .map_err(|e| CoreError::internal(format!("reminders dismiss: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn snooze(&self, id: &str, minutes: i32) -> Result<Reminder, CoreError> {
        let _existing = self.get(id)?;
        let now = self.clock.now();
        let now_str = now.to_rfc3339();
        let fire_at_str = (now + Duration::minutes(minutes as i64)).to_rfc3339();

        let conn = self.db.writer();
        conn.execute(
            "UPDATE reminders SET status = 'pending', snooze_count = snooze_count + 1, \
             last_snoozed_at = ?1, fire_at = ?2, updated_at = ?1 WHERE id = ?3",
            params![now_str, fire_at_str, id],
        )
        .map_err(|e| CoreError::internal(format!("reminders snooze: {e}")))?;
        drop(conn);

        self.get(id)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reminder> {
        let id: String = row.get(0)?;
        let task_id: Option<String> = row.get(1)?;
        let title: String = row.get(2)?;
        let body: Option<String> = row.get(3)?;
        let fire_raw: String = row.get(4)?;
        let repeat_raw: Option<String> = row.get(5)?;
        let sound_raw: Option<String> = row.get(6)?;
        let status_raw: String = row.get(7)?;
        let snooze_count: i32 = row.get(8)?;
        let last_snoozed_raw: Option<String> = row.get(9)?;
        let resolved_raw: Option<String> = row.get(10)?;
        let exceptions_log: Option<String> = row.get(11)?;
        let created_raw: String = row.get(12)?;
        let updated_raw: String = row.get(13)?;

        let repeat_kind = match repeat_raw.as_deref() {
            Some("daily") => RepeatKind::Daily,
            Some("weekly") => RepeatKind::Weekly,
            Some("monthly") => RepeatKind::Monthly,
            _ => RepeatKind::None,
        };
        let sound = match sound_raw.as_deref() {
            Some("urgent") => ReminderSound::Urgent,
            Some("info") => ReminderSound::Chime,
            Some("none") => ReminderSound::None,
            _ => ReminderSound::Normal,
        };
        let status = match status_raw.as_str() {
            "fired" => ReminderStatus::Fired,
            "resolved" => ReminderStatus::Resolved,
            "snoozed" => ReminderStatus::Snoozed,
            "dismissed" => ReminderStatus::Dismissed,
            "excepted" => ReminderStatus::Excepted,
            _ => ReminderStatus::Pending,
        };

        Ok(Reminder {
            id,
            task_id,
            title,
            body,
            fire_at: crate::infrastructure::clock::parse_rfc3339_or_now(&fire_raw),
            repeat_kind,
            sound,
            status,
            snooze_count,
            last_snoozed_at: last_snoozed_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            resolved_at: resolved_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            exceptions_log,
            created_at: crate::infrastructure::clock::parse_rfc3339_or_now(&created_raw),
            updated_at: crate::infrastructure::clock::parse_rfc3339_or_now(&updated_raw),
        })
    }
}

fn sound_to_db(sound: ReminderSound) -> &'static str {
    match sound {
        ReminderSound::Urgent => "urgent",
        ReminderSound::Chime => "info",
        ReminderSound::None => "none",
        ReminderSound::Normal | ReminderSound::Default => "normal",
    }
}
