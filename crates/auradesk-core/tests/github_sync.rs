//! Testes do sync GitHub → Kanban (ADR-0013).
//! Roda com um `FakeIssueFetcher` in-memory: sem rede, sem `gh`, sem Tauri.
//!
//! Run with: cargo test -p auradesk-core --test github_sync

use std::sync::Mutex;

use auradesk_core::application::github::GithubSyncService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::application::tasks::TasksService;
use auradesk_core::domain::github::{GithubIssue, IssueFetcher, IssueQuery, IssueState};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::task::{TaskFilter, TaskStatus};
use auradesk_core::infrastructure::db::Db;
use auradesk_core::CoreError;

/// Fetcher fake: devolve issues fixas, sem tocar a rede.
struct FakeIssueFetcher {
    issues: Mutex<Vec<GithubIssue>>,
    calls: Mutex<Vec<IssueQuery>>,
}

impl FakeIssueFetcher {
    fn new(issues: Vec<GithubIssue>) -> Self {
        Self {
            issues: Mutex::new(issues),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn set(&self, issues: Vec<GithubIssue>) {
        *self.issues.lock().unwrap() = issues;
    }

    fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }

    fn last_query(&self) -> Option<IssueQuery> {
        self.calls.lock().unwrap().last().cloned()
    }
}

impl IssueFetcher for FakeIssueFetcher {
    fn fetch_issues(&self, query: &IssueQuery) -> Result<Vec<GithubIssue>, CoreError> {
        self.calls.lock().unwrap().push(IssueQuery {
            repo: query.repo.clone(),
            label: query.label.clone(),
            include_closed: query.include_closed,
            limit: query.limit,
        });
        Ok(self.issues.lock().unwrap().clone())
    }

    fn auth_status(&self) -> Result<Option<String>, CoreError> {
        Ok(Some("RAGton".to_string()))
    }
}

fn issue(number: i64, title: &str, state: IssueState) -> GithubIssue {
    GithubIssue {
        number,
        repo: "RAGton/aura-desk".to_string(),
        url: format!("https://github.com/RAGton/aura-desk/issues/{number}"),
        title: title.to_string(),
        body: Some(format!("body of #{number}")),
        labels: vec!["bug".to_string()],
        state,
        updated_at: Some("2026-10-20T12:00:00Z".to_string()),
    }
}

fn fresh_db() -> Db {
    let db = Db::open_in_memory().expect("open in-memory db");
    let settings = SettingsService::new(&db);
    settings
        .set(
            SettingsKey::GithubRepo,
            serde_json::json!("RAGton/aura-desk"),
        )
        .expect("set github.repo");
    db
}

fn count_tasks(db: &Db) -> usize {
    TasksService::new(db)
        .list(&TaskFilter::default())
        .expect("list tasks")
        .len()
}

#[test]
fn sync_creates_one_card_per_issue() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![
        issue(1, "First", IssueState::Open),
        issue(2, "Second", IssueState::Open),
    ]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    assert_eq!(summary.created, 2);
    assert_eq!(summary.updated, 0);
    assert_eq!(summary.issues.len(), 2);
    assert_eq!(count_tasks(&db), 2);
}

#[test]
fn sync_is_idempotent_second_run_updates_nothing_new() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "First", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let first = svc.sync(None, None).expect("sync 1");
    assert_eq!(first.created, 1);

    let second = svc.sync(None, None).expect("sync 2");
    assert_eq!(second.created, 0, "second sync must not create new cards");
    assert_eq!(second.updated, 1);
    assert_eq!(
        count_tasks(&db),
        1,
        "only one card must exist after two syncs"
    );
}

#[test]
fn sync_does_not_clobber_manual_status() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "First", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");

    // User drags the card to "doing".
    TasksService::new(&db)
        .set_status(&task_id, TaskStatus::Doing, 0)
        .expect("set status");

    // Re-sync.
    svc.sync(None, None).expect("sync 2");

    let task = TasksService::new(&db).get(&task_id).expect("get task");
    assert_eq!(
        task.status,
        TaskStatus::Doing,
        "sync must never overwrite the user's manual status"
    );
}

#[test]
fn sync_does_not_clobber_manual_title_when_locked() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "Original title", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");

    // User edits the card title -> locks it.
    let patch = auradesk_core::domain::task::UpdateTask {
        title: Some("Meu título".to_string()),
        ..Default::default()
    };
    TasksService::new(&db)
        .update(&task_id, patch)
        .expect("update task");
    svc.lock_title(&task_id).expect("lock");

    // The issue is renamed on GitHub.
    fetcher.set(vec![issue(1, "Renamed upstream", IssueState::Open)]);
    svc.sync(None, None).expect("sync 2");

    let task = TasksService::new(&db).get(&task_id).expect("get task");
    assert_eq!(
        task.title, "Meu título",
        "locked card title must survive the re-sync"
    );

    // But the upstream title IS refreshed in the link row.
    let links = svc.list_links(None).expect("list links");
    assert_eq!(links[0].title, "Renamed upstream");
    assert!(links[0].title_locked);
}

#[test]
fn sync_unlocks_when_user_edits_and_then_sync_does_not_clobber_description() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");
    svc.lock_title(&task_id).expect("lock");

    fetcher.set(vec![issue(1, "T", IssueState::Open)]);
    svc.sync(None, None).expect("sync 2");

    let task = TasksService::new(&db).get(&task_id).expect("get task");
    assert_eq!(
        task.description,
        Some("body of #1".to_string()),
        "locked description must survive"
    );
}

#[test]
fn sync_unions_tags_never_removes_manual_tags() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");

    // User adds a manual tag. `UpdateTask.tags` is a double-Option:
    // Some(Some(v)) = set, Some(None) = clear, None = leave alone.
    let patch = auradesk_core::domain::task::UpdateTask {
        tags: Some(Some(vec!["manual".to_string()])),
        ..Default::default()
    };
    TasksService::new(&db)
        .update(&task_id, patch)
        .expect("update task");

    svc.sync(None, None).expect("sync 2");

    let task = TasksService::new(&db).get(&task_id).expect("get task");
    let tags = task.tags.expect("tags");
    assert!(tags.contains(&"manual".to_string()), "manual tag kept");
    assert!(tags.contains(&"gh:bug".to_string()), "github label present");
    assert_eq!(tags.len(), 2);
}

#[test]
fn sync_labels_are_prefixed_with_gh() {
    let db = fresh_db();
    let mut iss = issue(1, "T", IssueState::Open);
    iss.labels = vec!["bug".to_string(), "enhancement".to_string()];
    let fetcher = FakeIssueFetcher::new(vec![iss]);
    let svc = GithubSyncService::new(&db, &fetcher);

    svc.sync(None, None).expect("sync");
    let links = svc.list_links(None).expect("list links");
    let task_id = links[0].task_id.clone().expect("task id");
    let task = TasksService::new(&db).get(&task_id).expect("get task");
    let tags = task.tags.expect("tags");
    assert!(tags.contains(&"gh:bug".to_string()));
    assert!(tags.contains(&"gh:enhancement".to_string()));
}

#[test]
fn closed_issue_does_not_move_the_card_to_done() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");

    // Issue closed upstream.
    fetcher.set(vec![issue(1, "T", IssueState::Closed)]);
    svc.sync(None, None).expect("sync 2");

    let task = TasksService::new(&db).get(&task_id).expect("get task");
    assert_eq!(
        task.status,
        TaskStatus::Todo,
        "a closed issue must NOT move the card to done"
    );

    // But the provider state IS recorded.
    let links = svc.list_links(None).expect("list links");
    assert_eq!(links[0].source_status, IssueState::Closed);
}

#[test]
fn link_task_creates_vinculo_and_unlink_removes_it() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let task = TasksService::new(&db)
        .create(auradesk_core::domain::task::NewTask {
            title: "Manual card".to_string(),
            description: None,
            priority: auradesk_core::domain::task::TaskPriority::Normal,
            status: TaskStatus::Todo,
            project_id: None,
            parent_task_id: None,
            due_at: None,
            estimate_min: None,
            tags: None,
        })
        .expect("create task");

    let link = svc
        .link_task(&task.id, "RAGton/aura-desk", 42)
        .expect("link task");
    assert_eq!(link.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(link.external_id, "RAGton/aura-desk#42");

    svc.unlink_task(&task.id).expect("unlink");
    let links = svc.list_links(None).expect("list links");
    assert!(links.is_empty(), "unlinked rows are not listed");
}

#[test]
fn unlink_keeps_the_card() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");

    svc.unlink_task(&task_id).expect("unlink");

    assert_eq!(count_tasks(&db), 1, "the card must survive the unlink");
    let conn = db.writer();
    let row: Option<String> = conn
        .query_row(
            "SELECT task_id FROM github_issues WHERE external_id = ?1",
            ["RAGton/aura-desk#1"],
            |r| r.get(0),
        )
        .ok();
    assert_eq!(row, None, "the link row survives with task_id = NULL");
}

#[test]
fn deleting_the_task_sets_task_id_to_null() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let summary = svc.sync(None, None).expect("sync");
    let task_id = summary.issues[0].task_id.clone().expect("task id");

    TasksService::new(&db)
        .delete(&task_id)
        .expect("delete task");

    let conn = db.writer();
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT task_id FROM github_issues WHERE external_id = ?1",
            ["RAGton/aura-desk#1"],
            |r| r.get(0),
        )
        .ok();
    assert_eq!(
        row,
        Some(None),
        "ON DELETE SET NULL: the link survives with task_id = NULL"
    );
}

#[test]
fn missing_github_repo_setting_is_a_validation_error() {
    let db = Db::open_in_memory().expect("open in-memory db");
    // Deliberately NOT setting github.repo.
    let fetcher = FakeIssueFetcher::new(vec![]);
    let svc = GithubSyncService::new(&db, &fetcher);

    let err = svc
        .sync(None, None)
        .expect_err("must fail without github.repo");
    assert!(
        matches!(err, CoreError::Validation { .. }),
        "expected Validation, got {err:?}"
    );
}

#[test]
fn fetcher_is_called_with_the_configured_repo() {
    let db = fresh_db();
    let fetcher = FakeIssueFetcher::new(vec![]);
    let svc = GithubSyncService::new(&db, &fetcher);

    svc.sync(None, None).expect("sync");
    assert_eq!(fetcher.call_count(), 1);
    let q = fetcher.last_query().expect("query");
    assert_eq!(q.repo, "RAGton/aura-desk");
    assert!(!q.include_closed, "MVP imports open issues only");
}

#[test]
fn sync_uses_the_given_project_id() {
    let db = fresh_db();
    // The card's project_id has a FK to projects(id), so the project
    // must exist before the import.
    let project = auradesk_core::application::projects::ProjectsService::new(&db)
        .create(auradesk_core::domain::project::NewProject {
            name: "AuraDesk".to_string(),
            description: None,
            color: None,
            parent_id: None,
            start_date: None,
            target_date: None,
        })
        .expect("create project");

    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    svc.sync(Some(&project.id), None).expect("sync");

    // The card landed in that project.
    let links = svc.list_links(Some(&project.id)).expect("list");
    assert_eq!(links.len(), 1, "card must be in the requested project");

    let task_id = links[0].task_id.clone().expect("task id");
    let task = TasksService::new(&db).get(&task_id).expect("get task");
    assert_eq!(task.project_id.as_deref(), Some(project.id.as_str()));
}

#[test]
fn sync_falls_back_to_the_configured_github_project_id() {
    let db = fresh_db();
    let project = auradesk_core::application::projects::ProjectsService::new(&db)
        .create(auradesk_core::domain::project::NewProject {
            name: "Importados".to_string(),
            description: None,
            color: None,
            parent_id: None,
            start_date: None,
            target_date: None,
        })
        .expect("create project");

    SettingsService::new(&db)
        .set(
            SettingsKey::GithubProjectId,
            serde_json::json!(project.id.clone()),
        )
        .expect("set github.project_id");

    let fetcher = FakeIssueFetcher::new(vec![issue(1, "T", IssueState::Open)]);
    let svc = GithubSyncService::new(&db, &fetcher);

    // project_id = None -> uses the setting.
    svc.sync(None, None).expect("sync");

    let links = svc.list_links(Some(&project.id)).expect("list");
    assert_eq!(links.len(), 1);
}

#[test]
fn external_id_is_canonical_owner_repo_number() {
    let iss = issue(7, "T", IssueState::Open);
    assert_eq!(iss.external_id(), "RAGton/aura-desk#7");
}
