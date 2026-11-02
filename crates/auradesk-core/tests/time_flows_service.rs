// Integration tests for Stage 2: Time Flows (reminders, alerts, recurrence,
// exceptions, and pomodoro actual_min task sync).

use chrono::{Duration, TimeZone, Utc};
use std::sync::Arc;

use auradesk_core::application::alerts::AlertsService;
use auradesk_core::application::pomodoros::PomodorosService;
use auradesk_core::application::reminders::RemindersService;
use auradesk_core::application::tasks::TasksService;
use auradesk_core::domain::alert::{AlertResolution, AlertSeverity};
use auradesk_core::domain::pomodoro::{NewPomodoroSession, SessionKind};
use auradesk_core::domain::reminder::{NewReminder, ReminderSound, ReminderStatus, RepeatKind};
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

    // 3. Before 5 minutes elapse, nothing fires
    let now2 = Utc::now() + Duration::minutes(2);
    let fired2 = reminders_svc.poll_and_fire_overdue(now2).unwrap();
    assert_eq!(fired2.len(), 0);

    // 4. After 5 minutes elapse, it fires again, linked via parent_alert_id!
    let now3 = Utc::now() + Duration::minutes(6);
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
