//! Scheduler engine: coordinates reminders, routines, audio cues, and deep-work Pomodoro focus suppression.

#![allow(missing_docs)]

use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone, Utc};

use crate::application::alerts::AlertsService;
use crate::application::daily_plans::DailyPlansService;
use crate::application::pomodoros::PomodorosService;
use crate::application::reminders::RemindersService;
use crate::application::routines::RoutinesService;
use crate::application::settings::SettingsService;
use crate::domain::alert::{Alert, AlertSeverity, NewAlert};
use crate::domain::daily_plan::PlanState;
use crate::domain::pomodoro::SessionKind;
use crate::domain::reminder::ReminderSound;
use crate::domain::routine::{Routine, RoutineKind};
use crate::domain::settings_key::SettingsKey;
use crate::infrastructure::audio::{AudioPort, SoundDispatcher};
use crate::infrastructure::clock::{parse_rfc3339, Clock};
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

/// Deterministic scheduler evaluator that marries Reminders, Routines, Audio, and Pomodoro Focus.
pub struct Scheduler<'a> {
    pub db: &'a Db,
    pub clock: &'a dyn Clock,
    pub audio: Option<&'a dyn AudioPort>,
    pub user_idle: bool,
}

impl<'a> Scheduler<'a> {
    pub fn new(db: &'a Db, clock: &'a dyn Clock) -> Self {
        Self {
            db,
            clock,
            audio: None,
            user_idle: false,
        }
    }

    pub fn with_audio(mut self, audio: &'a dyn AudioPort) -> Self {
        self.audio = Some(audio);
        self
    }

    pub fn with_user_idle(mut self, user_idle: bool) -> Self {
        self.user_idle = user_idle;
        self
    }

    /// Evaluates overdue reminders and periodic routines at `clock.now()`.
    ///
    /// When a Pomodoro `Focus` session is active (`in_focus_session == true`),
    /// non-urgent routine alerts (`water`, `break`, `daily_planning`) are
    /// suppressed so deep work is never interrupted.
    pub fn tick(&self) -> Result<SchedulerTickOutcome, CoreError> {
        let now = self.clock.now();
        let settings = SettingsService::new(self.db);
        if let Ok(Some(paused_val)) = settings.get(SettingsKey::RemindersPausedUntil) {
            if let Some(paused_str) = paused_val.as_str() {
                if let Some(paused_until) = parse_rfc3339(paused_str) {
                    if paused_until > now {
                        return Ok(SchedulerTickOutcome::default());
                    }
                }
            }
        }

        let running = PomodorosService::with_clock(self.db, self.clock).running_session()?;
        let in_focus_session = running
            .as_ref()
            .is_some_and(|s| matches!(s.kind, SessionKind::Focus));

        let fired_reminder_alerts =
            RemindersService::with_clock(self.db, self.clock).poll_and_fire_overdue(now)?;

        if !fired_reminder_alerts.is_empty() {
            if let Some(audio) = self.audio {
                let sound = if fired_reminder_alerts
                    .iter()
                    .any(|a| matches!(a.severity, AlertSeverity::Urgent | AlertSeverity::Critical))
                {
                    ReminderSound::Urgent
                } else {
                    ReminderSound::Normal
                };
                let _ = SoundDispatcher::new(self.db, audio).dispatch(sound);
            }
        }

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
        let daily_planning_time = settings
            .get(SettingsKey::RoutineDailyPlanningTime)
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "07:50".to_string());

        let routines_svc = RoutinesService::new(self.db);
        let enabled_routines = routines_svc.list(true)?;
        let alerts_svc = AlertsService::with_clock(self.db, self.clock);
        let pending_alerts = alerts_svc.list_pending()?;

        let suppress_routines_on_idle = self.user_idle
            && settings
                .get(SettingsKey::DesktopIdleSuppressRoutines)
                .ok()
                .flatten()
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

        let mut fired_routine_alerts = Vec::new();
        let mut suppressed_routines = 0;

        for routine in enabled_routines {
            let already_open = pending_alerts
                .iter()
                .any(|a| a.kind == "routine" && a.ref_id.as_deref() == Some(routine.id.as_str()));
            if already_open {
                continue;
            }

            let (is_due, parent_alert_id) = evaluate_routine_due(
                self.db,
                now,
                &routine,
                water_interval_min,
                break_interval_min,
                &daily_planning_time,
            )?;

            if is_due {
                if in_focus_session || suppress_routines_on_idle {
                    suppressed_routines += 1;
                } else {
                    let alert = alerts_svc.create_with_parent(
                        NewAlert {
                            kind: "routine".to_string(),
                            ref_id: Some(routine.id.clone()),
                            title: routine.title.clone(),
                            body: routine.body.clone(),
                            severity: AlertSeverity::Info,
                            options: None,
                        },
                        parent_alert_id.as_deref(),
                    )?;
                    routines_svc.record_fired(&routine.id, now)?;
                    fired_routine_alerts.push(alert);
                }
            }
        }

        if !fired_routine_alerts.is_empty() {
            if let Some(audio) = self.audio {
                let _ = SoundDispatcher::new(self.db, audio).dispatch(ReminderSound::Chime);
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

fn evaluate_routine_due(
    db: &Db,
    now: DateTime<Utc>,
    routine: &Routine,
    water_interval_min: i64,
    break_interval_min: i64,
    daily_planning_time: &str,
) -> Result<(bool, Option<String>), CoreError> {
    if let Some((snooze_until, parent_id)) = parse_snooze_metadata(routine.metadata.as_deref()) {
        return Ok((now >= snooze_until, parent_id));
    }

    match routine.kind {
        RoutineKind::Water => {
            let reference = routine.last_fired_at.unwrap_or(routine.created_at);
            Ok((
                now - reference >= Duration::minutes(water_interval_min),
                None,
            ))
        }
        RoutineKind::Break => {
            let reference = routine.last_fired_at.unwrap_or(routine.created_at);
            Ok((
                now - reference >= Duration::minutes(break_interval_min),
                None,
            ))
        }
        RoutineKind::DailyPlanning => {
            let target_time = NaiveTime::parse_from_str(daily_planning_time.trim(), "%H:%M")
                .unwrap_or_else(|_| NaiveTime::from_hms_opt(7, 50, 0).unwrap());
            let local_now = now.with_timezone(&Local);
            let today_str = local_now.format("%Y-%m-%d").to_string();

            if let Some(plan) = DailyPlansService::new(db).get_by_date(&today_str)? {
                if matches!(plan.state, PlanState::Completed | PlanState::Skipped) {
                    return Ok((false, None));
                }
            }

            let reference = routine.last_fired_at.unwrap_or(routine.created_at);
            let scheduled_local = Local
                .from_local_datetime(&local_now.date_naive().and_time(target_time))
                .single();

            let is_due = match scheduled_local {
                Some(scheduled) => {
                    let scheduled_utc = scheduled.with_timezone(&Utc);
                    reference < scheduled_utc && now >= scheduled_utc
                }
                None => false,
            };
            Ok((is_due, None))
        }
        RoutineKind::Custom => Ok((false, None)),
    }
}

fn parse_snooze_metadata(metadata: Option<&str>) -> Option<(DateTime<Utc>, Option<String>)> {
    let raw = metadata?;
    let val: serde_json::Value = serde_json::from_str(raw).ok()?;
    let until = val.get("snooze_until")?.as_str().and_then(parse_rfc3339)?;
    let parent = val
        .get("snooze_alert_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some((until, parent))
}
