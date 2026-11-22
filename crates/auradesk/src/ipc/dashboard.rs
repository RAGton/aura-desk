//! Dashboard summary, daily plan, integration state, and time-spent report IPC commands.

use std::sync::atomic::Ordering;

use auradesk_core::application::{
    daily_plans::DailyPlansService, pomodoros::PomodorosService, reminders::RemindersService,
    settings::SettingsService, tasks::TasksService,
};
use auradesk_core::domain::daily_plan::{DailyPlan, PlanState};
use auradesk_core::domain::pomodoro::PomodoroSession;
use auradesk_core::domain::reminder::{Reminder, ReminderStatus};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::task::{TaskFilter, TaskPriority, TaskStatus};
use serde::Deserialize;
use tauri::State;

use crate::runtime::{db_from, AppState};

// ── Dashboard ─────────────────────────────────────────────────────────

/// Snapshot of every widget the Dashboard needs. One round-trip
/// keeps the UI from issuing 6+ commands on every refresh.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub next_task: Option<auradesk_core::domain::task::Task>,
    pub pending_count: i64,
    pub completed_today: i64,
    pub overdue_count: i64,
    pub running_pomodoro: Option<PomodoroSession>,
    pub pending_reminders: i64,
    pub recent_reminders: Vec<Reminder>,
    pub today_pomodoros: i64,
    pub today_focus_min: i64,
    pub water_interval_min: i64,
    pub break_interval_min: i64,
    pub daily_planning_time: String,
}

#[tauri::command]
pub fn dashboard_summary(state: State<'_, AppState>) -> Result<DashboardSummary, String> {
    let db = db_from(&state);
    let tasks_svc = TasksService::new(&db);
    let pomo_svc = PomodorosService::new(&db);
    let reminders_svc = RemindersService::new(&db);
    let settings_svc = SettingsService::new(&db);

    let all_tasks = tasks_svc
        .list(&TaskFilter::default())
        .map_err(|e| format!("list all tasks: {e}"))?;

    // Next task: highest-priority pending (todo or waiting),
    // tie-broken by earliest due_at (nulls last).
    let mut next_candidates: Vec<_> = all_tasks
        .iter()
        .filter(|t| matches!(t.status, TaskStatus::Todo | TaskStatus::Waiting))
        .cloned()
        .collect();
    next_candidates.sort_by(|a, b| {
        let pa = priority_rank(a.priority);
        let pb = priority_rank(b.priority);
        pa.cmp(&pb).then(earliest_due(a).cmp(&earliest_due(b)))
    });
    let next_task = next_candidates.into_iter().next();

    let pending_count = all_tasks
        .iter()
        .filter(|t| {
            matches!(
                t.status,
                TaskStatus::Todo | TaskStatus::Waiting | TaskStatus::Doing
            )
        })
        .count() as i64;

    let now_utc = chrono::Utc::now();
    let overdue_count = all_tasks
        .iter()
        .filter(|t| {
            !matches!(t.status, TaskStatus::Done | TaskStatus::Cancelled)
                && t.due_at.is_some_and(|d| d < now_utc)
        })
        .count() as i64;

    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let completed_today = all_tasks
        .iter()
        .filter(|t| matches!(t.status, TaskStatus::Done))
        .filter(|t| {
            t.completed_at.as_ref().is_some_and(|c| {
                c.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string()
                    == today_str
            })
        })
        .count() as i64;

    let running = pomo_svc
        .running_session()
        .map_err(|e| format!("running: {e}"))?;
    let all_pomos = pomo_svc.list(500).map_err(|e| format!("pomo list: {e}"))?;
    let completed_today_pomos: Vec<_> = all_pomos
        .iter()
        .filter(|s| {
            s.started_at
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
                == today_str
                && matches!(
                    s.status,
                    auradesk_core::domain::pomodoro::SessionStatus::Completed
                )
        })
        .collect();
    let today_pomodoros = completed_today_pomos.len() as i64;
    let today_focus_min = completed_today_pomos
        .iter()
        .filter(|s| matches!(s.kind, auradesk_core::domain::pomodoro::SessionKind::Focus))
        .filter_map(|s| s.actual_min)
        .sum::<i32>() as i64;

    let all_reminders = reminders_svc
        .list(true)
        .map_err(|e| format!("reminders all: {e}"))?;
    let pending_reminders = all_reminders
        .iter()
        .filter(|r| {
            matches!(
                r.status,
                ReminderStatus::Pending | ReminderStatus::Fired | ReminderStatus::Snoozed
            )
        })
        .count() as i64;
    let recent_reminders = all_reminders.into_iter().take(5).collect();

    // Read three settings; missing keys fall back to V001 spec defaults.
    let water_interval_min =
        read_int_setting(&settings_svc, SettingsKey::RoutineWaterIntervalMin).unwrap_or(60);
    let break_interval_min =
        read_int_setting(&settings_svc, SettingsKey::RoutineBreakIntervalMin).unwrap_or(90);
    let daily_planning_time =
        read_str_setting(&settings_svc, SettingsKey::RoutineDailyPlanningTime)
            .unwrap_or_else(|| "07:50".to_string());

    Ok(DashboardSummary {
        next_task,
        pending_count,
        completed_today,
        overdue_count,
        running_pomodoro: running,
        pending_reminders,
        recent_reminders,
        today_pomodoros,
        today_focus_min,
        water_interval_min,
        break_interval_min,
        daily_planning_time,
    })
}

fn priority_rank(p: TaskPriority) -> i32 {
    match p {
        TaskPriority::Urgent => 0,
        TaskPriority::High => 1,
        TaskPriority::Normal => 2,
        TaskPriority::Low => 3,
    }
}

fn earliest_due(t: &auradesk_core::domain::task::Task) -> String {
    // Sort by ISO-8601 of due_at (None sorts last as "z").
    t.due_at
        .as_ref()
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| "z".to_string())
}

fn read_int_setting(svc: &SettingsService, k: SettingsKey) -> Option<i64> {
    svc.get(k)
        .ok()
        .flatten()
        .and_then(|v| v.as_i64().or_else(|| v.as_u64().map(|n| n as i64)))
}

fn read_str_setting(svc: &SettingsService, k: SettingsKey) -> Option<String> {
    svc.get(k)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
}

/// Read-only snapshot of cross-feature integration state. The
/// Pomodoro page uses `inFocusSession` to render a "Foco ativo"
/// banner; the Dashboard uses it to grey out the water/break
/// widgets (so the user sees that routines are paused).
#[tauri::command]
pub fn integration_state(state: State<'_, AppState>) -> Result<IntegrationView, String> {
    let db = db_from(&state);
    let svc = PomodorosService::new(&db);
    let in_focus_db = svc
        .running_session()
        .map_err(|e| format!("running_session: {e}"))?
        .is_some();
    // The in-memory flag is the fast path; the DB is the slow
    // path. Both must agree in normal operation. We OR them so
    // either side can surface a focus session to the UI.
    let in_focus_mem = state.in_focus_session.load(Ordering::Relaxed);
    Ok(IntegrationView {
        in_focus_session: in_focus_mem || in_focus_db,
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationView {
    pub in_focus_session: bool,
}

// ── Daily plans ───────────────────────────────────────────────────────

/// Fetch today's daily plan, auto-creating it (`not_started`)
/// on first call. The dashboard "Hoje" widget calls this so the
/// user always sees a status row.
#[tauri::command]
pub fn daily_plan_get(state: State<'_, AppState>) -> Result<DailyPlan, String> {
    let db = db_from(&state);
    let svc = DailyPlansService::new(&db);
    svc.current_or_create()
        .map_err(|e| format!("daily_plan_get: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetPlanStateInput {
    pub id: String,
    pub state: PlanState,
}

#[tauri::command]
pub fn daily_plan_set_state(
    state: State<'_, AppState>,
    input: SetPlanStateInput,
) -> Result<DailyPlan, String> {
    let db = db_from(&state);
    let svc = DailyPlansService::new(&db);
    svc.set_state(&input.id, input.state)
        .map_err(|e| format!("daily_plan_set_state: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetPlanPayloadInput {
    pub id: String,
    pub payload: Option<String>,
}

#[tauri::command]
pub fn daily_plan_set_payload(
    state: State<'_, AppState>,
    input: SetPlanPayloadInput,
) -> Result<DailyPlan, String> {
    let db = db_from(&state);
    let svc = DailyPlansService::new(&db);
    svc.set_payload(&input.id, input.payload)
        .map_err(|e| format!("daily_plan_set_payload: {e}"))
}

// ── Report ────────────────────────────────────────────────────────────

/// Time-spent report: per-day breakdown of focus / break minutes
/// and task outcomes, plus totals for today / week / month.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    pub today: ReportDay,
    pub week: ReportPeriod,
    pub month: ReportPeriod,
    pub by_day: Vec<ReportDay>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDay {
    pub date: String, // YYYY-MM-DD
    pub focus_min: i64,
    pub break_min: i64,
    pub water_count: i64,
    pub pomodoros: i64,
    pub tasks_done: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPeriod {
    pub focus_min: i64,
    pub break_min: i64,
    pub water_count: i64,
    pub pomodoros: i64,
    pub tasks_done: i64,
    pub active_days: i64,
}

#[tauri::command]
pub fn report_summary(state: State<'_, AppState>) -> Result<ReportSummary, String> {
    let db = db_from(&state);
    let tasks_svc = TasksService::new(&db);
    let pomo_svc = PomodorosService::new(&db);

    let today_local = chrono::Local::now().date_naive();
    let today_str = today_local.format("%Y-%m-%d").to_string();
    let month_start = today_local - chrono::Duration::days(29);

    let all_pomos = pomo_svc.list(2000).map_err(|e| format!("pomo list: {e}"))?;
    let all_tasks = tasks_svc
        .list(&TaskFilter::default())
        .map_err(|e| format!("task list: {e}"))?;

    let mut days_30: Vec<ReportDay> = (0..30)
        .map(|i| {
            let d = month_start + chrono::Duration::days(i);
            ReportDay {
                date: d.format("%Y-%m-%d").to_string(),
                focus_min: 0,
                break_min: 0,
                water_count: 0,
                pomodoros: 0,
                tasks_done: 0,
            }
        })
        .collect();

    let mut pomo_break_by_day = [0_i64; 30];

    // Hydrate water & routine break counts recorded in `metrics_daily`.
    {
        let conn = db.reader();
        if let Ok(mut stmt) =
            conn.prepare("SELECT date, break_minutes, water_count FROM metrics_daily")
        {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            }) {
                for row in rows.flatten() {
                    if let Some(day) = days_30.iter_mut().find(|d| d.date == row.0) {
                        day.break_min += row.1;
                        day.water_count += row.2;
                    }
                }
            }
        };
    }

    for s in &all_pomos {
        let key = s
            .started_at
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string();
        if let Some(idx) = days_30.iter().position(|d| d.date == key) {
            let day = &mut days_30[idx];
            let is_focus = matches!(s.kind, auradesk_core::domain::pomodoro::SessionKind::Focus);
            let is_break = matches!(
                s.kind,
                auradesk_core::domain::pomodoro::SessionKind::ShortBreak
                    | auradesk_core::domain::pomodoro::SessionKind::LongBreak
            );
            if matches!(
                s.status,
                auradesk_core::domain::pomodoro::SessionStatus::Completed
            ) {
                if is_focus {
                    day.focus_min += s.actual_min.unwrap_or(0) as i64;
                    day.pomodoros += 1;
                } else if is_break {
                    pomo_break_by_day[idx] += s.actual_min.unwrap_or(0) as i64;
                }
            }
        }
    }
    for (day, pomo_brk) in days_30.iter_mut().zip(pomo_break_by_day) {
        day.break_min = day.break_min.max(pomo_brk);
    }
    for t in &all_tasks {
        if matches!(t.status, TaskStatus::Done) {
            if let Some(c) = &t.completed_at {
                let key = c
                    .with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string();
                if let Some(day) = days_30.iter_mut().find(|d| d.date == key) {
                    day.tasks_done += 1;
                }
            }
        }
    }

    let fold_period = |slice: &[ReportDay]| -> ReportPeriod {
        slice.iter().fold(
            ReportPeriod {
                focus_min: 0,
                break_min: 0,
                water_count: 0,
                pomodoros: 0,
                tasks_done: 0,
                active_days: 0,
            },
            |mut acc, d| {
                acc.focus_min += d.focus_min;
                acc.break_min += d.break_min;
                acc.water_count += d.water_count;
                acc.pomodoros += d.pomodoros;
                acc.tasks_done += d.tasks_done;
                if d.focus_min > 0 || d.pomodoros > 0 || d.tasks_done > 0 {
                    acc.active_days += 1;
                }
                acc
            },
        )
    };

    let today_report = days_30
        .iter()
        .find(|d| d.date == today_str)
        .cloned()
        .unwrap_or(ReportDay {
            date: today_str,
            focus_min: 0,
            break_min: 0,
            water_count: 0,
            pomodoros: 0,
            tasks_done: 0,
        });

    let week = fold_period(&days_30[days_30.len().saturating_sub(7)..]);
    let month = fold_period(&days_30);
    // Keep 14-day series in `by_day` newest-first for dashboard compatibility,
    // or oldest-to-newest chronological (last 14 days).
    let by_day = days_30[days_30.len().saturating_sub(14)..]
        .iter()
        .rev()
        .cloned()
        .collect();

    Ok(ReportSummary {
        today: today_report,
        week,
        month,
        by_day,
    })
}
