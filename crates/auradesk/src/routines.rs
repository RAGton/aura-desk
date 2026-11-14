//! Background routines runner.
//!
//! Owns the single background loop that turns time into action: it
//! ticks the core `Scheduler`, which fires overdue reminders and
//! periodic routines (water, break) as `alerts_pending` rows. The
//! frontend reads those rows through `alerts_list_pending` and shows
//! them in the reminder modal.
//!
//! The loop is intentionally dumb: all the decision logic (which
//! routine is due, whether a focus block suppresses it) lives in
//! `auradesk_core::infrastructure::scheduler`, so it stays testable
//! without a running app.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use auradesk_core::infrastructure::clock::SystemClock;
use auradesk_core::infrastructure::db::Db;
use auradesk_core::infrastructure::scheduler::Scheduler;

/// How often the loop evaluates reminders and routines.
const TICK_INTERVAL: Duration = Duration::from_secs(15);

/// Run the background routine loop until the process exits.
///
/// The loop ticks the `Scheduler` every [`TICK_INTERVAL`]. Each tick
/// creates the alerts that are due, and the core handles the
/// Pomodoro focus suppression: while a focus session is running the
/// scheduler defers `water` and `break` routines instead of
/// interrupting deep work.
///
/// `in_focus` mirrors the shell's in-memory focus flag. The scheduler
/// reads the authoritative state from the database; the flag is used
/// here only to keep the two views consistent when a focus session
/// starts or stops between two ticks.
pub fn run_loop(db: Arc<Db>, in_focus: Arc<AtomicBool>) {
    let clock = SystemClock;

    loop {
        let scheduler = Scheduler::new(&db, &clock);
        match scheduler.tick() {
            Ok(outcome) => {
                if !outcome.fired_reminder_alerts.is_empty()
                    || !outcome.fired_routine_alerts.is_empty()
                {
                    eprintln!(
                        "routines: fired {} reminder(s), {} routine alert(s), {} suppressed",
                        outcome.fired_reminder_alerts.len(),
                        outcome.fired_routine_alerts.len(),
                        outcome.suppressed_routines,
                    );
                }
                // Keep the shell flag in sync with what the scheduler
                // observed. The scheduler reads the database, so it is
                // the source of truth; the flag mirrors it for the UI.
                in_focus.store(outcome.in_focus_session, Ordering::Relaxed);
            }
            Err(err) => {
                // A transient SQLite error must not kill the loop.
                eprintln!("routines: scheduler tick failed: {err}");
            }
        }

        std::thread::sleep(TICK_INTERVAL);
    }
}
