//! Scheduler engine: coordinates reminders, routines, and deep-work Pomodoro focus suppression.

#![allow(missing_docs)]

use chrono::Duration;

use crate::application::alerts::AlertsService;
use crate::application::pomodoros::PomodorosService;
use crate::application::reminders::RemindersService;
use crate::application::routines::RoutinesService;
use crate::application::settings::SettingsService;
use crate::domain::alert::{Alert, AlertSeverity, NewAlert};
use crate::domain::pomodoro::SessionKind;
use crate::domain::routine::RoutineKind;
use crate::domain::settings_key::SettingsKey;
use crate::infrastructure::clock::Clock;
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Summary of a single scheduler tick.
#[derive(Debug, Default, Clone)]
pub struct SchedulerTickOutcome {
    pub fired_reminder_alerts: Vec<Alert>,
    pub fired_routine_alerts: Vec<Alert>,
    pub suppressed_routines: usize,
    pub in_focus_session: bool,
}

/// Deterministic scheduler evaluator that marries Reminders, Routines, and Pomodoro Focus.
pub struct Scheduler<'a> {
    pub db: &'a Db,
    pub clock: &'a dyn Clock,
}

impl<'a> Scheduler<'a> {
    pub fn new(db: &'a Db, clock: &'a dyn Clock) -> Self {
        Self { db, clock }
    }

    /// Evaluates overdue reminders and periodic routines at `clock.now()`.
    ///
    /// When a Pomodoro `Focus` session is active (`in_focus_session == true`),
    /// non-urgent routine alerts (`water`, `break`) are suppressed so deep work
    /// is never interrupted.
    pub fn tick(&self) -> Result<SchedulerTickOutcome, CoreError> {
        let now = self.clock.now();
        let running = PomodorosService::new(self.db).running_session()?;
        let in_focus_session = running
            .as_ref()
            .is_some_and(|s| matches!(s.kind, SessionKind::Focus));

        let fired_reminder_alerts = RemindersService::new(self.db).poll_and_fire_overdue(now)?;

        let settings = SettingsService::new(self.db);
        let water_interval_min = settings
            .get(SettingsKey::RoutineWaterIntervalMin)
            .ok()
            .flatten()
            .and_then(|v| v.as_i64())
            .unwrap_or(60)
            .max(1);
        let break_interval_min = settings
            .get(SettingsKey::RoutineBreakIntervalMin)
            .ok()
            .flatten()
            .and_then(|v| v.as_i64())
            .unwrap_or(90)
            .max(1);

        let routines_svc = RoutinesService::new(self.db);
        let enabled_routines = routines_svc.list(true)?;

        let mut fired_routine_alerts = Vec::new();
        let mut suppressed_routines = 0;

        for routine in enabled_routines {
            let interval_min = match routine.kind {
                RoutineKind::Water => Some(water_interval_min),
                RoutineKind::Break => Some(break_interval_min),
                _ => None,
            };

            if let Some(interval) = interval_min {
                let reference_time = routine.last_fired_at.unwrap_or(routine.created_at);
                if now - reference_time >= Duration::minutes(interval) {
                    if in_focus_session {
                        suppressed_routines += 1;
                    } else {
                        let alert = AlertsService::new(self.db).create(NewAlert {
                            kind: "routine".to_string(),
                            ref_id: Some(routine.id.clone()),
                            title: routine.title.clone(),
                            body: routine.body.clone(),
                            severity: AlertSeverity::Info,
                            options: None,
                        })?;
                        routines_svc.record_fired(&routine.id, now)?;
                        fired_routine_alerts.push(alert);
                    }
                }
            }
        }

        Ok(SchedulerTickOutcome {
            fired_reminder_alerts,
            fired_routine_alerts,
            suppressed_routines,
            in_focus_session,
        })
    }
}
