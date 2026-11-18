//! Background routines runner.
//!
//! Owns the single background loop that turns time into action: it
//! ticks the core `Scheduler`, which fires overdue reminders and
//! periodic routines (water, break) as `alerts_pending` rows. It also
//! executes periodic background GitHub issue sync when `github.auto_sync`
//! is enabled and `github.repo` is configured.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use auradesk_core::application::github::GithubSyncService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::github::{GithubSyncSummary, IssueFetcher};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::clock::SystemClock;
use auradesk_core::infrastructure::db::Db;
use auradesk_core::infrastructure::scheduler::Scheduler;
use tauri::{AppHandle, Emitter};

use crate::audio::DesktopAudio;
use crate::github::GhCliIssueFetcher;

/// How often the loop evaluates reminders and routines.
const TICK_INTERVAL: Duration = Duration::from_secs(15);

/// How many 15s ticks elapse between automatic GitHub sync attempts (~5 minutes).
const GITHUB_SYNC_INTERVAL_TICKS: u64 = 20;

/// Execute GitHub issue sync only when `github.auto_sync` is `true` and
/// `github.repo` is configured. Transient CLI/network failures are logged and skipped.
pub fn maybe_sync_github_issues(db: &Db, fetcher: &dyn IssueFetcher) -> Option<GithubSyncSummary> {
    let settings = SettingsService::new(db);
    let auto_sync = settings
        .get(SettingsKey::GithubAutoSync)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !auto_sync {
        return None;
    }

    let repo = settings
        .get(SettingsKey::GithubRepo)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.trim().is_empty())?;

    let label_filter = settings
        .get(SettingsKey::GithubFilterLabels)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.trim().is_empty());

    match GithubSyncService::new(db, fetcher).sync(None, label_filter.as_deref()) {
        Ok(summary) => Some(summary),
        Err(err) => {
            eprintln!("routines: github auto-sync failed for {repo}: {err}");
            None
        }
    }
}

/// Run the background routine loop until the process exits.
///
/// The loop ticks the `Scheduler` every [`TICK_INTERVAL`]. Each tick
/// creates the alerts that are due, plays native audio cues when enabled,
/// updates any fullscreen desktop blocking modal overlays if
/// `reminders.block_screen` is turned on, and keeps `in_focus` synchronized
/// with PostgreSQL/SQLite state. Every [`GITHUB_SYNC_INTERVAL_TICKS`] ticks,
/// it triggers `github.auto_sync` when enabled.
pub fn run_loop(
    app: AppHandle,
    db: Arc<Db>,
    in_focus: Arc<AtomicBool>,
    github_fetcher: Arc<GhCliIssueFetcher>,
) {
    let clock = SystemClock;
    let audio = DesktopAudio::new();
    let mut tick_count: u64 = 0;

    loop {
        let scheduler = Scheduler::new(&db, &clock).with_audio(&audio);
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
                    crate::alert_lock::sync_blocking_windows(&app, &db);
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

        if tick_count.is_multiple_of(GITHUB_SYNC_INTERVAL_TICKS) {
            if let Some(summary) = maybe_sync_github_issues(&db, github_fetcher.as_ref()) {
                if summary.created > 0 || summary.updated > 0 {
                    eprintln!(
                        "routines: github auto-sync imported {} created, {} updated",
                        summary.created, summary.updated
                    );
                    let _ = app.emit("auradesk://tasks-updated", ());
                }
            }
        }
        tick_count = tick_count.wrapping_add(1);

        std::thread::sleep(TICK_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use auradesk_core::domain::github::{GithubIssue, IssueQuery, IssueState};
    use auradesk_core::CoreError;
    use std::sync::atomic::AtomicUsize;

    struct CountingFetcher {
        calls: AtomicUsize,
    }

    impl IssueFetcher for CountingFetcher {
        fn fetch_issues(&self, _query: &IssueQuery) -> Result<Vec<GithubIssue>, CoreError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![GithubIssue {
                repo: "owner/repo".into(),
                number: 7,
                title: "auto-synced-issue".into(),
                body: None,
                labels: vec!["bug".into()],
                state: IssueState::Open,
                url: "https://github.com/owner/repo/issues/7".into(),
                updated_at: Some("2026-11-17T10:00:00Z".into()),
            }])
        }

        fn auth_status(&self) -> Result<Option<String>, CoreError> {
            Ok(Some("tester".into()))
        }
    }

    #[test]
    fn github_auto_sync_runs_only_when_enabled_with_repo() {
        let db = Db::open_in_memory().unwrap();
        let settings = SettingsService::new(&db);
        let fetcher = CountingFetcher {
            calls: AtomicUsize::new(0),
        };

        // Disabled by default -> no fetch
        assert!(maybe_sync_github_issues(&db, &fetcher).is_none());
        assert_eq!(fetcher.calls.load(Ordering::SeqCst), 0);

        // Enabled without repo -> still skipped
        settings
            .set(SettingsKey::GithubAutoSync, serde_json::json!(true))
            .unwrap();
        assert!(maybe_sync_github_issues(&db, &fetcher).is_none());
        assert_eq!(fetcher.calls.load(Ordering::SeqCst), 0);

        // Enabled with repo -> imports issue cleanly
        settings
            .set(SettingsKey::GithubRepo, serde_json::json!("owner/repo"))
            .unwrap();
        let summary = maybe_sync_github_issues(&db, &fetcher).expect("sync summary");
        assert_eq!(fetcher.calls.load(Ordering::SeqCst), 1);
        assert_eq!(summary.created, 1);
    }
}
