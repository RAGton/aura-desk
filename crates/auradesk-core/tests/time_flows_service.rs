// Integration tests for Stage 2: Time Flows (reminders, alerts, recurrence,
// exceptions, and pomodoro actual_min task sync).

use chrono::{Duration, TimeZone, Utc};
use std::sync::Arc;

use auradesk_core::application::alerts::AlertsService;
use auradesk_core::application::daily_plans::DailyPlansService;
use auradesk_core::application::data_io::DataIoService;
use auradesk_core::application::pomodoros::PomodorosService;
use auradesk_core::application::reminders::RemindersService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::application::tasks::TasksService;
use auradesk_core::domain::alert::{AlertResolution, AlertSeverity};
use auradesk_core::domain::pomodoro::{NewPomodoroSession, SessionKind};
use auradesk_core::domain::reminder::{NewReminder, ReminderSound, ReminderStatus, RepeatKind};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::task::{NewTask, TaskFilter, TaskPriority, TaskStatus};
use auradesk_core::infrastructure::db::Db;

#[test]
fn test_overdue_reminders_fire_into_alerts_pending_and_notifications() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);
    let alerts_svc = AlertsService::new(&db);

    let past_time = Utc::now() - Duration::minutes(10);
    let r1 = reminders_svc
        .create(NewReminder {
            title: "Overdue Reminder".into(),
            body: Some("Drink hot tea".into()),
            fire_at: past_time,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Urgent,
            task_id: None,
        })
        .unwrap();

    let now = Utc::now();
    let fired = reminders_svc.poll_and_fire_overdue(now).unwrap();
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].kind, "reminder");
    assert_eq!(fired[0].ref_id, Some(r1.id.clone()));
    assert_eq!(fired[0].severity, AlertSeverity::Urgent);

    // Verify reminder is now Fired
    let updated_r1 = reminders_svc.get(&r1.id).unwrap();
    assert_eq!(updated_r1.status, ReminderStatus::Fired);

    // Verify alert appears in alerts_pending
    let pending_alerts = alerts_svc.list_pending().unwrap();
    assert_eq!(pending_alerts.len(), 1);
    assert_eq!(pending_alerts[0].id, fired[0].id);

    // Verify notification was logged
    let conn = db.writer();
    let notif_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notifications WHERE alert_id = ?1 AND ref_id = ?2",
            rusqlite::params![fired[0].id, r1.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(notif_count, 1);
}

#[test]
fn test_no_duplicate_fire_on_consecutive_ticks_or_restart() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);

    let past_time = Utc::now() - Duration::minutes(5);
    let _r = reminders_svc
        .create(NewReminder {
            title: "Standup Reminder".into(),
            body: None,
            fire_at: past_time,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let now = Utc::now();
    let fired1 = reminders_svc.poll_and_fire_overdue(now).unwrap();
    assert_eq!(fired1.len(), 1);

    // Second consecutive tick must NOT duplicate fire
    let fired2 = reminders_svc.poll_and_fire_overdue(now).unwrap();
    assert_eq!(fired2.len(), 0);

    // Simulated app restart (new RemindersService instance on the same Db)
    let restarted_svc = RemindersService::new(&db);
    let fired3 = restarted_svc
        .poll_and_fire_overdue(now + Duration::minutes(1))
        .unwrap();
    assert_eq!(fired3.len(), 0);

    // Exactly one alert exists in alerts_pending
    let alerts_svc = AlertsService::new(&db);
    let pending_alerts = alerts_svc.list_pending().unwrap();
    assert_eq!(pending_alerts.len(), 1);
}

#[test]
fn test_future_reminders_do_not_fire() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);

    let future_time = Utc::now() + Duration::hours(1);
    let _r = reminders_svc
        .create(NewReminder {
            title: "Future Reminder".into(),
            body: None,
            fire_at: future_time,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let now = Utc::now();
    let fired = reminders_svc.poll_and_fire_overdue(now).unwrap();
    assert_eq!(fired.len(), 0);

    let alerts_svc = AlertsService::new(&db);
    assert_eq!(alerts_svc.list_pending().unwrap().len(), 0);
}

#[test]
fn test_snooze_alert_and_refire_with_parent_alert_id() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);
    let alerts_svc = AlertsService::new(&db);

    let now1 = Utc::now() - Duration::minutes(1);
    let r = reminders_svc
        .create(NewReminder {
            title: "Snooze Test".into(),
            body: None,
            fire_at: now1,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    // 1. Fire the reminder
    let fired = reminders_svc.poll_and_fire_overdue(now1).unwrap();
    assert_eq!(fired.len(), 1);
    let first_alert_id = fired[0].id.clone();

    // 2. Snooze the alert
    let snoozed_alert = alerts_svc.snooze(&first_alert_id).unwrap();
    assert_eq!(snoozed_alert.resolution, Some(AlertResolution::Snoozed));

    // Reminder is returned to 'pending' with snooze_count = 1
    let rem_after_snooze = reminders_svc.get(&r.id).unwrap();
    assert_eq!(rem_after_snooze.status, ReminderStatus::Pending);
    assert_eq!(rem_after_snooze.snooze_count, 1);
    assert!(rem_after_snooze.fire_at > now1);

    // 3. Before 10 minutes elapse, nothing fires
    let now2 = Utc::now() + Duration::minutes(9);
    let fired2 = reminders_svc.poll_and_fire_overdue(now2).unwrap();
    assert_eq!(fired2.len(), 0);

    // 4. After 10 minutes elapse, it fires again, linked via parent_alert_id!
    let now3 = Utc::now() + Duration::minutes(11);
    let fired3 = reminders_svc.poll_and_fire_overdue(now3).unwrap();
    assert_eq!(fired3.len(), 1);
    let second_alert_id = fired3[0].id.clone();

    // Check parent_alert_id in the DB
    let conn = db.writer();
    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_alert_id FROM alerts_pending WHERE id = ?1",
            rusqlite::params![second_alert_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(parent_id, Some(first_alert_id));
}

#[test]
fn test_recurrence_daily_weekly_monthly_on_resolve() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);
    let alerts_svc = AlertsService::new(&db);

    let base_time = Utc.with_ymd_and_hms(2026, 10, 18, 9, 0, 0).unwrap();

    // Daily recurring reminder
    let daily_rem = reminders_svc
        .create(NewReminder {
            title: "Daily Plan".into(),
            body: None,
            fire_at: base_time,
            repeat_kind: RepeatKind::Daily,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let now = base_time + Duration::minutes(5);
    let fired = reminders_svc.poll_and_fire_overdue(now).unwrap();
    assert_eq!(fired.len(), 1);
    let alert_id = fired[0].id.clone();

    // User resolves the alert
    let resolved_alert = alerts_svc.resolve(&alert_id).unwrap();
    assert_eq!(resolved_alert.resolution, Some(AlertResolution::Resolved));

    // Daily reminder must advance fire_at by 1 day and return to 'pending'
    let updated_daily = reminders_svc.get(&daily_rem.id).unwrap();
    assert_eq!(updated_daily.status, ReminderStatus::Pending);
    assert_eq!(
        updated_daily.fire_at,
        Utc.with_ymd_and_hms(2026, 10, 19, 9, 0, 0).unwrap()
    );

    // Single-shot reminder does NOT advance
    let single_rem = reminders_svc
        .create(NewReminder {
            title: "One-off Task".into(),
            body: None,
            fire_at: base_time,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let fired_single = reminders_svc.poll_and_fire_overdue(now).unwrap();
    assert_eq!(fired_single.len(), 1);
    alerts_svc.resolve(&fired_single[0].id).unwrap();

    let updated_single = reminders_svc.get(&single_rem.id).unwrap();
    assert_eq!(updated_single.status, ReminderStatus::Resolved);
    assert_eq!(updated_single.fire_at, base_time);
}

#[test]
fn test_alert_exception_persists_justification_in_exceptions_log() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);
    let alerts_svc = AlertsService::new(&db);

    let base_time = Utc.with_ymd_and_hms(2026, 10, 18, 14, 0, 0).unwrap();
    let rem = reminders_svc
        .create(NewReminder {
            title: "Post-lunch Walk".into(),
            body: None,
            fire_at: base_time,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let fired = reminders_svc
        .poll_and_fire_overdue(base_time + Duration::minutes(1))
        .unwrap();
    let alert_id = &fired[0].id;

    // 1. Empty note must be rejected with Validation error
    let err = alerts_svc.except(alert_id, "   ").unwrap_err();
    assert!(format!("{err:?}").contains("Validation"));

    // 2. Non-empty note succeeds
    let excepted_alert = alerts_svc
        .except(alert_id, "Rainstorm outside; skipped walk today")
        .unwrap();
    assert_eq!(excepted_alert.resolution, Some(AlertResolution::Excepted));

    // 3. Exception is mirrored in reminders.exceptions_log
    let updated_rem = reminders_svc.get(&rem.id).unwrap();
    assert_eq!(updated_rem.status, ReminderStatus::Excepted);
    assert!(updated_rem.exceptions_log.is_some());

    let log_str = updated_rem.exceptions_log.unwrap();
    let log_json: serde_json::Value = serde_json::from_str(&log_str).unwrap();
    let entries = log_json.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["note"], "Rainstorm outside; skipped walk today");
    assert_eq!(entries[0]["action"], "excepted");
    assert_eq!(entries[0]["alert_id"], *alert_id);
}

#[test]
fn test_pomodoro_actual_min_updates_linked_task_without_double_counting() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let tasks_svc = TasksService::new(&db);
    let pomos_svc = PomodorosService::new(&db);

    // Create a task
    let task = tasks_svc
        .create(NewTask {
            title: "Implement backend feature".into(),
            description: None,
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::High,
            status: TaskStatus::Doing,
            due_at: None,
            estimate_min: Some(60),
            tags: None,
        })
        .unwrap();
    assert_eq!(task.actual_min, None);

    // 1. Start a focus session linked to the task
    pomos_svc
        .start(NewPomodoroSession {
            kind: SessionKind::Focus,
            planned_min: 25,
            task_id: Some(task.id.clone()),
        })
        .unwrap();

    // 2. Complete the running session with 25 actual minutes
    let completed = pomos_svc.complete_running(25).unwrap();
    assert_eq!(completed.actual_min, Some(25));

    // Task actual_min is now 25
    let updated_task = tasks_svc.get(&task.id).unwrap();
    assert_eq!(updated_task.actual_min, Some(25));

    // 3. Attempting to complete again fails (no running session) -> NO double counting!
    let second_attempt = pomos_svc.complete_running(25);
    assert!(second_attempt.is_err());
    let task_unchanged = tasks_svc.get(&task.id).unwrap();
    assert_eq!(task_unchanged.actual_min, Some(25));

    // 4. Start a second focus session and complete with 15 minutes
    pomos_svc
        .start(NewPomodoroSession {
            kind: SessionKind::Focus,
            planned_min: 25,
            task_id: Some(task.id.clone()),
        })
        .unwrap();
    pomos_svc.complete_running(15).unwrap();

    // Task actual_min is now 25 + 15 = 40
    let updated_task2 = tasks_svc.get(&task.id).unwrap();
    assert_eq!(updated_task2.actual_min, Some(40));

    // 5. Short break session linked to task does NOT increment actual_min
    pomos_svc
        .start(NewPomodoroSession {
            kind: SessionKind::ShortBreak,
            planned_min: 5,
            task_id: Some(task.id.clone()),
        })
        .unwrap();
    pomos_svc.complete_running(5).unwrap();

    let task_after_break = tasks_svc.get(&task.id).unwrap();
    assert_eq!(task_after_break.actual_min, Some(40));
}

#[test]
fn test_task_recurrence_on_complete() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let tasks_svc = TasksService::new(&db);

    let due_base = Utc.with_ymd_and_hms(2026, 10, 18, 12, 0, 0).unwrap();
    let task = tasks_svc
        .create(NewTask {
            title: "Daily Status Report".into(),
            description: None,
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::Normal,
            status: TaskStatus::Doing,
            due_at: Some(due_base),
            estimate_min: None,
            tags: None,
        })
        .unwrap();
    let task_id = task.id;

    let conn = db.writer();
    let recurrence_id = uuid::Uuid::new_v4().to_string();
    let now_str = Utc::now().to_rfc3339();

    // 2. Insert task recurrence rule (references task_id)
    conn.execute(
        "INSERT INTO task_recurrences (id, task_id, rrule, dtstart, lookahead_days) \
         VALUES (?1, ?2, 'FREQ=DAILY', ?3, 7)",
        rusqlite::params![recurrence_id, task_id, now_str],
    )
    .unwrap();

    // 3. Link recurrence_id on the task
    conn.execute(
        "UPDATE tasks SET recurrence_id = ?1 WHERE id = ?2",
        rusqlite::params![recurrence_id, task_id],
    )
    .unwrap();
    drop(conn);

    // Complete the task
    let done_task = tasks_svc.set_status(&task_id, TaskStatus::Done, 0).unwrap();
    assert_eq!(done_task.status, TaskStatus::Done);
    assert!(done_task.completed_at.is_some());

    // Verify next task was spawned
    let all_tasks = tasks_svc.list(&TaskFilter::default()).unwrap();
    let new_task = all_tasks.iter().find(|t| t.id != task_id).unwrap();
    assert_eq!(new_task.status, TaskStatus::Todo);
    assert_eq!(new_task.title, "Daily Status Report");
    assert_eq!(new_task.recurrence_id, Some(recurrence_id));
    assert_eq!(
        new_task.due_at,
        Some(Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap())
    );
}

#[test]
fn test_concurrent_overdue_polling_no_duplicate_alerts() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);

    let past_time = Utc::now() - Duration::minutes(15);
    let _r = reminders_svc
        .create(NewReminder {
            title: "Concurrent Target".into(),
            body: None,
            fire_at: past_time,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let now = Utc::now();
    let db1 = Arc::clone(&db);
    let db2 = Arc::clone(&db);

    let handle1 = std::thread::spawn(move || {
        let svc = RemindersService::new(&db1);
        svc.poll_and_fire_overdue(now)
    });
    let handle2 = std::thread::spawn(move || {
        let svc = RemindersService::new(&db2);
        svc.poll_and_fire_overdue(now)
    });

    let res1 = handle1.join().unwrap().unwrap();
    let res2 = handle2.join().unwrap().unwrap();

    // Exactly one thread should have fired the reminder
    assert_eq!(res1.len() + res2.len(), 1);

    // Exactly one alert in pending
    let alerts_svc = AlertsService::new(&db);
    assert_eq!(alerts_svc.list_pending().unwrap().len(), 1);
}

#[test]
fn test_scheduler_suppresses_routines_during_focus_and_fires_after_break() {
    use auradesk_core::infrastructure::clock::FixedClock;
    use auradesk_core::infrastructure::scheduler::Scheduler;

    let db = Db::open_in_memory().unwrap();
    let clock = FixedClock::new(Utc::now() + Duration::hours(2));
    let pomos_svc = PomodorosService::new(&db);

    // Start a Focus Pomodoro session
    pomos_svc
        .start(NewPomodoroSession {
            kind: SessionKind::Focus,
            planned_min: 25,
            task_id: None,
        })
        .unwrap();

    // Tick while in focus: water & break routines are overdue (+2h), but suppressed!
    let scheduler = Scheduler::new(&db, &clock);
    let outcome_focus = scheduler.tick().unwrap();
    assert!(outcome_focus.in_focus_session);
    assert_eq!(outcome_focus.fired_routine_alerts.len(), 0);
    assert!(outcome_focus.suppressed_routines >= 2);

    // Complete Focus session -> next tick fires the routines!
    pomos_svc.complete_running(25).unwrap();
    let outcome_free = scheduler.tick().unwrap();
    assert!(!outcome_free.in_focus_session);
    assert_eq!(outcome_free.suppressed_routines, 0);
    let non_planning_routines: Vec<_> = outcome_free
        .fired_routine_alerts
        .iter()
        .filter(|a| a.title != "Planejamento diário")
        .collect();
    assert_eq!(non_planning_routines.len(), 2);
}

#[test]
fn test_daily_plans_unique_per_date_and_state_transitions() {
    use auradesk_core::application::daily_plans::DailyPlansService;
    use auradesk_core::domain::daily_plan::PlanState;

    let db = Db::open_in_memory().unwrap();
    let svc = DailyPlansService::new(&db);

    let plan = svc
        .create_for_date(
            "2026-11-06",
            Some(r#"{"top3":["Issue 3","Issue 5","Issue 9"]}"#.into()),
        )
        .unwrap();
    assert_eq!(plan.state, PlanState::NotStarted);

    // Duplicate date returns Conflict
    let dup = svc.create_for_date("2026-11-06", None);
    assert!(matches!(
        dup,
        Err(auradesk_core::CoreError::Conflict { .. })
    ));

    // State transitions persist started_at and completed_at
    let in_prog = svc.set_state(&plan.id, PlanState::InProgress).unwrap();
    assert_eq!(in_prog.state, PlanState::InProgress);
    assert!(in_prog.started_at.is_some());

    let done = svc.set_state(&plan.id, PlanState::Completed).unwrap();
    assert_eq!(done.state, PlanState::Completed);
    assert!(done.completed_at.is_some());
}

#[test]
fn test_fixed_clock_reminder_fires_within_five_seconds_window() {
    use auradesk_core::infrastructure::clock::FixedClock;
    use auradesk_core::infrastructure::scheduler::Scheduler;

    let db = Db::open_in_memory().unwrap();
    let t0 = Utc.with_ymd_and_hms(2026, 11, 14, 15, 0, 0).unwrap();
    let fire_at = t0 + Duration::minutes(10);
    let clock = FixedClock::new(t0);
    let reminders_svc = RemindersService::with_clock(&db, &clock);

    reminders_svc
        .create(NewReminder {
            title: "Precision Check".into(),
            body: None,
            fire_at,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    clock.set(fire_at - Duration::seconds(1));
    assert!(Scheduler::new(&db, &clock)
        .tick()
        .unwrap()
        .fired_reminder_alerts
        .is_empty());

    clock.set(fire_at + Duration::seconds(4));
    let fired = Scheduler::new(&db, &clock)
        .tick()
        .unwrap()
        .fired_reminder_alerts;
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].title, "Precision Check");
}

#[test]
fn test_suspend_resume_30min_replays_overdue_alerts_without_duplicating() {
    use auradesk_core::infrastructure::clock::FixedClock;
    use auradesk_core::infrastructure::scheduler::Scheduler;

    let db = Db::open_in_memory().unwrap();
    let base = Utc::now();
    let clock = FixedClock::new(base);
    let reminders_svc = RemindersService::with_clock(&db, &clock);

    // Scheduled 15 min after `base`, missed while machine was suspended for 30 min.
    reminders_svc
        .create(NewReminder {
            title: "While Suspended".into(),
            body: Some("Missed during sleep".into()),
            fire_at: base + Duration::minutes(15),
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Urgent,
            task_id: None,
        })
        .unwrap();

    clock.advance(Duration::minutes(30));
    let scheduler = Scheduler::new(&db, &clock);
    let first = scheduler.tick().unwrap();
    assert_eq!(first.fired_reminder_alerts.len(), 1);
    assert_eq!(first.fired_reminder_alerts[0].title, "While Suspended");

    // Subsequent tick must not duplicate the replayed reminder.
    let second = scheduler.tick().unwrap();
    assert_eq!(second.fired_reminder_alerts.len(), 0);
}

#[test]
fn test_scheduler_audio_respects_mute_setting() {
    use auradesk_core::application::settings::SettingsService;
    use auradesk_core::domain::settings_key::SettingsKey;
    use auradesk_core::infrastructure::audio::NoopAudio;
    use auradesk_core::infrastructure::clock::FixedClock;
    use auradesk_core::infrastructure::scheduler::Scheduler;

    let db = Db::open_in_memory().unwrap();
    let t0 = Utc.with_ymd_and_hms(2026, 11, 14, 16, 0, 0).unwrap();
    let clock = FixedClock::new(t0);
    let audio = NoopAudio::new();
    let rem_svc = RemindersService::with_clock(&db, &clock);

    rem_svc
        .create(NewReminder {
            title: "Sound On".into(),
            body: None,
            fire_at: t0,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    Scheduler::new(&db, &clock)
        .with_audio(&audio)
        .tick()
        .unwrap();
    assert_eq!(audio.played_sounds().len(), 1);

    SettingsService::new(&db)
        .set(SettingsKey::RemindersSound, serde_json::Value::Bool(false))
        .unwrap();
    rem_svc
        .create(NewReminder {
            title: "Muted Alert".into(),
            body: None,
            fire_at: t0,
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Urgent,
            task_id: None,
        })
        .unwrap();

    Scheduler::new(&db, &clock)
        .with_audio(&audio)
        .tick()
        .unwrap();
    // Still 1 sound played total because mute prevented dispatching the second alert.
    assert_eq!(audio.played_sounds().len(), 1);
}

#[test]
fn test_resolve_atomic_transaction_and_rollback_on_notification_failure() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let reminders_svc = RemindersService::new(&db);
    let alerts_svc = AlertsService::new(&db);

    let r = reminders_svc
        .create(NewReminder {
            title: "Atomic Resolve Target".into(),
            body: None,
            fire_at: Utc::now() - Duration::minutes(1),
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    let fired = reminders_svc.poll_and_fire_overdue(Utc::now()).unwrap();
    let alert_id = &fired[0].id;

    // Install a failing trigger on notifications AFTER reminders was already modified in tx.
    {
        let conn = db.writer();
        conn.execute_batch(
            "CREATE TRIGGER abort_notif_on_resolve BEFORE INSERT ON notifications \
             WHEN NEW.read_at IS NOT NULL \
             BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;",
        )
        .unwrap();
    }

    let err = alerts_svc.resolve(alert_id);
    assert!(err.is_err());

    // Both alerts_pending AND reminders must remain rolled back cleanly.
    let alert_after_rollback = alerts_svc.get(alert_id).unwrap();
    assert_eq!(alert_after_rollback.resolution, None);
    let rem_after_rollback = reminders_svc.get(&r.id).unwrap();
    assert_eq!(rem_after_rollback.status, ReminderStatus::Fired);

    // Drop failing trigger and prove normal resolve writes all 3 atomically.
    {
        let conn = db.writer();
        conn.execute_batch("DROP TRIGGER abort_notif_on_resolve;")
            .unwrap();
    }
    alerts_svc.resolve(alert_id).unwrap();
    assert_eq!(
        alerts_svc.get(alert_id).unwrap().resolution,
        Some(AlertResolution::Resolved)
    );
    assert_eq!(
        reminders_svc.get(&r.id).unwrap().status,
        ReminderStatus::Resolved
    );
    let conn = db.writer();
    let read_notifs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notifications WHERE alert_id = ?1 AND read_at IS NOT NULL",
            rusqlite::params![alert_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(read_notifs, 1);
}

#[test]
fn test_routine_snooze_10m_refires_with_parent_alert_id_and_no_duplicates() {
    use auradesk_core::infrastructure::clock::FixedClock;
    use auradesk_core::infrastructure::scheduler::Scheduler;

    let db = Db::open_in_memory().unwrap();
    let clock = FixedClock::new(Utc::now() + Duration::hours(2));
    let alerts_svc = AlertsService::with_clock(&db, &clock);

    let tick1 = Scheduler::new(&db, &clock).tick().unwrap();
    let water_alert = tick1
        .fired_routine_alerts
        .into_iter()
        .find(|a| a.title == "Hidratação")
        .unwrap();

    // Ticking again while water alert is still pending must not duplicate.
    let tick_dup = Scheduler::new(&db, &clock).tick().unwrap();
    assert!(!tick_dup
        .fired_routine_alerts
        .iter()
        .any(|a| a.title == "Hidratação"));

    alerts_svc.snooze(&water_alert.id).unwrap();

    // After 9 minutes, snoozed routine has not fired yet.
    clock.advance(Duration::minutes(9));
    let tick_before = Scheduler::new(&db, &clock).tick().unwrap();
    assert!(!tick_before
        .fired_routine_alerts
        .iter()
        .any(|a| a.title == "Hidratação"));

    // After 10+ minutes, snoozed routine re-fires linked to the snoozed alert.
    clock.advance(Duration::minutes(2));
    let tick_after = Scheduler::new(&db, &clock).tick().unwrap();
    let refired = tick_after
        .fired_routine_alerts
        .iter()
        .find(|a| a.title == "Hidratação")
        .unwrap();

    let conn = db.writer();
    let parent: Option<String> = conn
        .query_row(
            "SELECT parent_alert_id FROM alerts_pending WHERE id = ?1",
            rusqlite::params![refired.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(parent, Some(water_alert.id));
}

#[test]
fn test_pomodoro_start_rejects_concurrent_running_session() {
    let db = Db::open_in_memory().unwrap();
    let pomos = PomodorosService::new(&db);
    pomos
        .start(NewPomodoroSession {
            kind: SessionKind::Focus,
            planned_min: 25,
            task_id: None,
        })
        .unwrap();
    let second = pomos.start(NewPomodoroSession {
        kind: SessionKind::ShortBreak,
        planned_min: 5,
        task_id: None,
    });
    assert!(matches!(
        second,
        Err(auradesk_core::CoreError::Conflict { .. })
    ));
}

#[test]
fn test_data_io_zip_export_and_import_roundtrip() {
    use auradesk_core::application::data_io::DataIoService;
    use auradesk_core::application::settings::SettingsService;
    use auradesk_core::domain::settings_key::SettingsKey;

    let src = Db::open_in_memory().unwrap();
    let tasks = TasksService::new(&src);
    let created = tasks
        .create(NewTask {
            title: "Zip Exported Task".into(),
            description: Some("Should survive zip restore".into()),
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::Urgent,
            status: TaskStatus::Doing,
            due_at: None,
            estimate_min: Some(45),
            tags: Some(vec!["backup".into()]),
        })
        .unwrap();
    SettingsService::new(&src)
        .set(
            SettingsKey::RemindersBlockScreen,
            serde_json::Value::Bool(true),
        )
        .unwrap();

    let zip_bytes = DataIoService::new(&src).export_zip_bytes().unwrap();

    // Verify the zip archive contains all 3 required artifacts.
    {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&zip_bytes)).unwrap();
        assert!(archive.by_name("auradesk.db").is_ok());
        assert!(archive.by_name("settings.json").is_ok());
        assert!(archive.by_name("audit-log.json").is_ok());
    }

    let dst = Db::open_in_memory().unwrap();
    let summary = DataIoService::new(&dst)
        .import_zip_bytes(&zip_bytes)
        .unwrap();
    assert_eq!(summary.tasks, 1);

    let restored_task = TasksService::new(&dst).get(&created.id).unwrap();
    assert_eq!(restored_task.title, "Zip Exported Task");
    assert_eq!(
        SettingsService::new(&dst)
            .get(SettingsKey::RemindersBlockScreen)
            .unwrap(),
        Some(serde_json::Value::Bool(true))
    );
}

#[test]
fn test_daily_plan_plain_text_payload_normalizes_to_canonical_json() {
    use auradesk_core::application::daily_plans::DailyPlansService;

    let db = Db::open_in_memory().unwrap();
    let svc = DailyPlansService::new(&db);
    let plan = svc.current_or_create().unwrap();

    // Plain text notes normalize into canonical {"notes": "..."} JSON.
    let saved_plain = svc
        .set_payload(&plan.id, Some("Three priorities today".into()))
        .unwrap();
    let parsed: serde_json::Value =
        serde_json::from_str(saved_plain.payload.as_deref().unwrap()).unwrap();
    assert_eq!(parsed["notes"], "Three priorities today");

    // Pre-structured JSON objects pass through intact.
    let structured = r#"{"notes":"Ship Phase 1","focusBlocks":2}"#.to_string();
    let saved_json = svc.set_payload(&plan.id, Some(structured.clone())).unwrap();
    assert_eq!(saved_json.payload, Some(structured));

    // Whitespace-only payloads clear back to None.
    let cleared = svc.set_payload(&plan.id, Some("   \n\t ".into())).unwrap();
    assert_eq!(cleared.payload, None);
}

#[test]
fn test_data_io_imports_browser_bundle_json_only_zip_archive() {
    use auradesk_core::application::data_io::DataIoService;
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipArchive, ZipWriter};

    let src = Db::open_in_memory().unwrap();
    let created = TasksService::new(&src)
        .create(NewTask {
            title: "Browser-created ZIP Task".into(),
            description: None,
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::High,
            status: TaskStatus::Todo,
            due_at: None,
            estimate_min: None,
            tags: None,
        })
        .unwrap();

    let full_zip = DataIoService::new(&src).export_zip_bytes().unwrap();
    let mut reader = ZipArchive::new(std::io::Cursor::new(&full_zip)).unwrap();
    let mut bundle_json = String::new();
    reader
        .by_name("bundle.json")
        .unwrap()
        .read_to_string(&mut bundle_json)
        .unwrap();

    // Repackage using Stored bundle.json only (no auradesk.db), matching browser exports.
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("bundle.json", opts).unwrap();
        writer.write_all(bundle_json.as_bytes()).unwrap();
        writer.finish().unwrap();
    }
    let browser_zip = cursor.into_inner();

    let dst = Db::open_in_memory().unwrap();
    let summary = DataIoService::new(&dst)
        .import_zip_bytes(&browser_zip)
        .unwrap();
    assert_eq!(summary.tasks, 1);

    let restored = TasksService::new(&dst).get(&created.id).unwrap();
    assert_eq!(restored.title, "Browser-created ZIP Task");
}

#[test]
fn test_reminders_poll_precheck_skips_future_and_fires_only_due() {
    let db = Db::open_in_memory().unwrap();
    let reminders = RemindersService::new(&db);

    let now = Utc.with_ymd_and_hms(2026, 11, 15, 12, 0, 0).unwrap();
    let future_rem = reminders
        .create(NewReminder {
            title: "Future reminder".into(),
            body: None,
            fire_at: now + Duration::hours(2),
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: None,
        })
        .unwrap();

    // Pre-check returns empty when only future reminders exist.
    let first_poll = reminders.poll_and_fire_overdue(now).unwrap();
    assert!(first_poll.is_empty());
    assert_eq!(
        reminders.get(&future_rem.id).unwrap().status,
        ReminderStatus::Pending
    );

    // Advance past due time: pre-check passes and fires exactly this reminder.
    let due_poll = reminders
        .poll_and_fire_overdue(now + Duration::hours(3))
        .unwrap();
    assert_eq!(due_poll.len(), 1);
    assert_eq!(due_poll[0].ref_id.as_deref(), Some(future_rem.id.as_str()));
    assert_eq!(
        reminders.get(&future_rem.id).unwrap().status,
        ReminderStatus::Fired
    );
}

#[test]
fn test_db_wal_reader_pool_enforces_query_only_and_concurrent_reads() {
    let db_dir = std::env::temp_dir().join(format!("auradesk-wal-pool-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&db_dir).expect("create temp db directory");

    {
        let db = Db::open(&db_dir).expect("open file-backed WAL db");
        let task = TasksService::new(&db)
            .create(NewTask {
                title: "WAL reader task".into(),
                description: None,
                project_id: None,
                parent_task_id: None,
                priority: TaskPriority::Normal,
                status: TaskStatus::Todo,
                due_at: None,
                estimate_min: None,
                tags: None,
            })
            .expect("create task on writer");

        // Readers can read committed WAL data without acquiring the writer mutex.
        let r1 = db.reader();
        let title: String = r1
            .query_row(
                "SELECT title FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| row.get(0),
            )
            .expect("reader sees task");
        assert_eq!(title, "WAL reader task");

        // Readers must reject writes via SQLite PRAGMA query_only = ON.
        let write_attempt = r1.execute(
            "UPDATE tasks SET title = 'mutated' WHERE id = ?1",
            rusqlite::params![task.id],
        );
        assert!(write_attempt.is_err());
    }

    let _ = std::fs::remove_dir_all(&db_dir);
}

#[test]
fn monthly_reminder_recurrence_preserves_calendar_day_and_clamps_short_months() {
    // Non-leap year: Jan 31 -> Feb 28
    {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let reminders_svc = RemindersService::new(&db);
        let alerts_svc = AlertsService::new(&db);
        let jan31_non_leap = Utc.with_ymd_and_hms(2026, 1, 31, 10, 0, 0).unwrap();
        let r_non_leap = reminders_svc
            .create(NewReminder {
                title: "Fatura Jan31".into(),
                body: None,
                fire_at: jan31_non_leap,
                repeat_kind: RepeatKind::Monthly,
                sound: ReminderSound::Normal,
                task_id: None,
            })
            .unwrap();
        let fired = reminders_svc
            .poll_and_fire_overdue(jan31_non_leap + Duration::minutes(1))
            .unwrap();
        assert_eq!(fired.len(), 1);
        alerts_svc.resolve(&fired[0].id).unwrap();
        assert_eq!(
            reminders_svc.get(&r_non_leap.id).unwrap().fire_at,
            Utc.with_ymd_and_hms(2026, 2, 28, 10, 0, 0).unwrap()
        );
    }

    // Leap year: Jan 31 -> Feb 29
    {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let reminders_svc = RemindersService::new(&db);
        let alerts_svc = AlertsService::new(&db);
        let jan31_leap = Utc.with_ymd_and_hms(2028, 1, 31, 10, 0, 0).unwrap();
        let r_leap = reminders_svc
            .create(NewReminder {
                title: "Fatura Bissexta".into(),
                body: None,
                fire_at: jan31_leap,
                repeat_kind: RepeatKind::Monthly,
                sound: ReminderSound::Normal,
                task_id: None,
            })
            .unwrap();
        let fired_leap = reminders_svc
            .poll_and_fire_overdue(jan31_leap + Duration::minutes(1))
            .unwrap();
        assert_eq!(fired_leap.len(), 1);
        alerts_svc.resolve(&fired_leap[0].id).unwrap();
        assert_eq!(
            reminders_svc.get(&r_leap.id).unwrap().fire_at,
            Utc.with_ymd_and_hms(2028, 2, 29, 10, 0, 0).unwrap()
        );
    }

    // 31-day to 30-day month: Mar 31 -> Apr 30
    {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let reminders_svc = RemindersService::new(&db);
        let alerts_svc = AlertsService::new(&db);
        let mar31 = Utc.with_ymd_and_hms(2026, 3, 31, 9, 15, 0).unwrap();
        let r_mar = reminders_svc
            .create(NewReminder {
                title: "Fechamento Mar31".into(),
                body: None,
                fire_at: mar31,
                repeat_kind: RepeatKind::Monthly,
                sound: ReminderSound::Normal,
                task_id: None,
            })
            .unwrap();
        let fired_mar = reminders_svc
            .poll_and_fire_overdue(mar31 + Duration::minutes(1))
            .unwrap();
        assert_eq!(fired_mar.len(), 1);
        alerts_svc.resolve(&fired_mar[0].id).unwrap();
        assert_eq!(
            reminders_svc.get(&r_mar.id).unwrap().fire_at,
            Utc.with_ymd_and_hms(2026, 4, 30, 9, 15, 0).unwrap()
        );
    }
}

#[test]
fn large_backup_zip_roundtrip_interoperability() {
    let db1 = Arc::new(Db::open_in_memory().unwrap());
    let tasks_svc = TasksService::new(&db1);
    let pomos_svc = PomodorosService::new(&db1);
    let reminders_svc = RemindersService::new(&db1);
    let plans_svc = DailyPlansService::new(&db1);

    for i in 0..250 {
        tasks_svc
            .create(NewTask {
                title: format!("Large backup task #{i}"),
                description: Some(format!(
                    "Multi-paragraph payload for regression item {i}: {}",
                    "a".repeat(200)
                )),
                project_id: None,
                parent_task_id: None,
                priority: TaskPriority::Normal,
                status: if i % 4 == 0 {
                    TaskStatus::Done
                } else {
                    TaskStatus::Todo
                },
                due_at: None,
                estimate_min: Some(30),
                tags: Some(vec!["backup".into(), format!("grp-{}", i % 8)]),
            })
            .unwrap();
    }
    for _ in 0..80 {
        pomos_svc
            .start(NewPomodoroSession {
                kind: SessionKind::Focus,
                planned_min: 25,
                task_id: None,
            })
            .unwrap();
        pomos_svc.complete_running(25).unwrap();
    }
    for i in 0..60 {
        reminders_svc
            .create(NewReminder {
                title: format!("Reminder #{i}"),
                body: Some(format!("Details for reminder {i}")),
                fire_at: Utc.with_ymd_and_hms(2027, 5, 1, 10, 0, 0).unwrap() + Duration::hours(i),
                repeat_kind: RepeatKind::Monthly,
                sound: ReminderSound::Normal,
                task_id: None,
            })
            .unwrap();
    }
    let plan = plans_svc.current_or_create().unwrap();
    plans_svc
        .set_payload(
            &plan.id,
            Some(r#"{"notes":"Plano salvo para teste de backup grande"}"#.to_string()),
        )
        .unwrap();

    let zip_b64 = DataIoService::new(&db1).export_zip_base64().unwrap();
    assert!(
        zip_b64.len() > 20_000,
        "expected compressed ZIP base64 payload"
    );

    let db2 = Arc::new(Db::open_in_memory().unwrap());
    let summary = DataIoService::new(&db2)
        .import_zip_base64(&zip_b64)
        .unwrap();
    assert_eq!(summary.tasks, 250);
    assert_eq!(summary.pomodoros, 80);
    assert_eq!(summary.reminders, 60);

    let imported_tasks = TasksService::new(&db2)
        .list(&TaskFilter::default())
        .unwrap();
    assert_eq!(imported_tasks.len(), 250);
}

#[test]
fn wal_reader_pool_concurrent_reads_and_writes() {
    let db_dir = std::env::temp_dir().join(format!("auradesk-wal-stress-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&db_dir).expect("create temp db directory");

    {
        let db = Arc::new(Db::open(&db_dir).expect("open file-backed WAL db"));
        let tasks_svc = TasksService::new(&db);
        let initial_a = tasks_svc
            .create(NewTask {
                title: "Seed A".into(),
                description: None,
                project_id: None,
                parent_task_id: None,
                priority: TaskPriority::Normal,
                status: TaskStatus::Todo,
                due_at: None,
                estimate_min: None,
                tags: None,
            })
            .unwrap();
        let initial_b = tasks_svc
            .create(NewTask {
                title: "Seed B".into(),
                description: None,
                project_id: None,
                parent_task_id: None,
                priority: TaskPriority::Normal,
                status: TaskStatus::Todo,
                due_at: None,
                estimate_min: None,
                tags: None,
            })
            .unwrap();

        std::thread::scope(|s| {
            // 1 concurrent writer thread performing inserts, settings updates, and batch reorder
            let writer_db = Arc::clone(&db);
            let id_a = initial_a.id.clone();
            let id_b = initial_b.id.clone();
            let writer = s.spawn(move || {
                let ts = TasksService::new(&writer_db);
                let ss = SettingsService::new(&writer_db);
                for idx in 0..30 {
                    ts.create(NewTask {
                        title: format!("Concurrent W-{idx}"),
                        description: None,
                        project_id: None,
                        parent_task_id: None,
                        priority: TaskPriority::Normal,
                        status: TaskStatus::Todo,
                        due_at: None,
                        estimate_min: None,
                        tags: None,
                    })
                    .unwrap();
                    ts.reorder_batch(&[
                        (id_a.clone(), TaskStatus::Todo, idx % 2),
                        (id_b.clone(), TaskStatus::Doing, (idx + 1) % 2),
                    ])
                    .unwrap();
                    ss.set(
                        SettingsKey::PomodoroFocusMin,
                        serde_json::json!(25 + (idx % 5)),
                    )
                    .unwrap();
                }
            });

            // 4 concurrent reader threads hitting the WAL reader pool continuously
            let mut readers = Vec::new();
            for _ in 0..4 {
                let rdb = Arc::clone(&db);
                readers.push(s.spawn(move || {
                    let ts = TasksService::new(&rdb);
                    let ss = SettingsService::new(&rdb);
                    for _ in 0..40 {
                        let list = ts.list(&TaskFilter::default()).unwrap();
                        assert!(list.len() >= 2);
                        let all_settings = ss.get_all().unwrap();
                        assert!(!all_settings.is_empty());
                    }
                }));
            }

            writer.join().expect("writer finished cleanly");
            for r in readers {
                r.join().expect("reader finished cleanly");
            }
        });

        let final_tasks = TasksService::new(&db).list(&TaskFilter::default()).unwrap();
        assert_eq!(final_tasks.len(), 32);
    }

    let _ = std::fs::remove_dir_all(&db_dir);
}

#[test]
fn test_proposals_history_commands_modifications_and_voice_capture() {
    use auradesk_core::application::data_io::save_voice_capture_base64;
    use auradesk_core::application::proposals::ProposalsService;
    use auradesk_core::capabilities::dispatch_capability;
    use base64::Engine;

    let db = Db::open_in_memory().unwrap();
    let created = dispatch_capability(
        &db,
        "propose_create_task",
        serde_json::json!({
            "title": "Draft title",
            "priority": "normal"
        }),
    )
    .unwrap();
    let prop_id = created["proposal_id"].as_str().unwrap().to_string();

    let approved = dispatch_capability(
        &db,
        "approve_proposal",
        serde_json::json!({
            "id": prop_id,
            "note": "Adjusted priority and title",
            "modifications": {
                "title": "Finalized Sprint Title",
                "priority": "urgent"
            }
        }),
    )
    .unwrap();
    assert_eq!(approved["result_kind"], "task");
    let task_id = approved["result_ref_id"].as_str().unwrap();
    let task = TasksService::new(&db).get(task_id).unwrap();
    assert_eq!(task.title, "Finalized Sprint Title");
    assert_eq!(task.priority, TaskPriority::Urgent);

    let svc = ProposalsService::new(&db);
    let recent = svc.list_recent(20).unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(
        recent[0].decision_note.as_deref(),
        Some("Adjusted priority and title")
    );

    let commands = svc.list_commands(20).unwrap();
    assert!(commands
        .iter()
        .any(|c| c.tool_name == "propose_create_task"));
    assert!(commands.iter().any(|c| c.tool_name == "approve_proposal"));

    let captures_dir = std::env::temp_dir().join(format!("auradesk-wav-{}", uuid::Uuid::new_v4()));
    let wav_b64 = base64::engine::general_purpose::STANDARD.encode(b"RIFF\x00\x00\x00\x00WAVEfmt ");
    let (saved_path, bytes) =
        save_voice_capture_base64(&captures_dir, &wav_b64, Some("../bad/name!")).unwrap();
    assert!(bytes > 0);
    assert!(std::path::Path::new(&saved_path).exists());
    assert!(saved_path.ends_with(".wav"));
    assert!(save_voice_capture_base64(&captures_dir, "", None).is_err());

    let _ = std::fs::remove_dir_all(&captures_dir);
}
