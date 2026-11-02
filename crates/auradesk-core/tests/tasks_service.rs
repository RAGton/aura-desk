//! Integration tests for `TasksService`. Uses an in-memory SQLite
//! database (no tempfiles, no disk I/O) and runs the V001 migration
//! from `auradesk_core::infrastructure::migrate`.
//!
//! Run with: cargo test -p auradesk-core --test tasks_service

use auradesk_core::application::tasks::TasksService;
use auradesk_core::domain::task::{NewTask, TaskPriority, TaskStatus, UpdateTask};
use auradesk_core::infrastructure::db::Db;

fn fresh_db() -> Db {
    Db::open_in_memory().expect("open in-memory db")
}

fn basic_task(title: &str) -> NewTask {
    NewTask {
        title: title.to_string(),
        description: None,
        priority: TaskPriority::Normal,
        status: TaskStatus::Todo,
        project_id: None,
        parent_task_id: None,
        due_at: None,
        estimate_min: None,
        tags: None,
    }
}

#[test]
fn create_then_get_roundtrip() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let created = svc.create(basic_task("Buy milk")).expect("create");
    assert_eq!(created.title, "Buy milk");
    assert_eq!(created.priority, TaskPriority::Normal);
    assert_eq!(created.status, TaskStatus::Todo);
    assert_eq!(created.kanban_order, 0);

    let fetched = svc.get(&created.id).expect("get");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.title, "Buy milk");
}

#[test]
fn empty_title_is_rejected() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let err = svc
        .create(basic_task("   "))
        .expect_err("blank title must fail");
    assert!(matches!(err, auradesk_core::CoreError::Validation { .. }));
}

#[test]
fn title_too_long_is_rejected() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let long = "x".repeat(501);
    let err = svc
        .create(basic_task(&long))
        .expect_err("long title must fail");
    assert!(matches!(err, auradesk_core::CoreError::Validation { .. }));
}

#[test]
fn list_returns_empty_by_default() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let v = svc.list(&Default::default()).expect("list");
    assert!(v.is_empty());
}

#[test]
fn list_orders_by_kanban_then_created() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let a = svc.create(basic_task("a")).expect("a");
    let b = svc.create(basic_task("b")).expect("b");
    let c = svc.create(basic_task("c")).expect("c");
    let list = svc.list(&Default::default()).expect("list");
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].id, a.id);
    assert_eq!(list[1].id, b.id);
    assert_eq!(list[2].id, c.id);
    // kanban_order is per-column (status); the order within a column
    // matches creation order, so a, b, c land at orders 0, 1, 2.
    assert!(list[0].kanban_order < list[1].kanban_order);
    assert!(list[1].kanban_order < list[2].kanban_order);
}

#[test]
fn list_filter_by_status_isolates_columns() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let todo = svc.create(basic_task("todo")).expect("todo");
    let mut doing = basic_task("doing");
    doing.status = TaskStatus::Doing;
    let _doing = svc.create(doing).expect("doing");
    let only_todo = svc
        .list(&auradesk_core::domain::task::TaskFilter {
            status: Some(TaskStatus::Todo),
            ..Default::default()
        })
        .expect("filter");
    assert_eq!(only_todo.len(), 1);
    assert_eq!(only_todo[0].id, todo.id);
    let only_doing = svc
        .list(&auradesk_core::domain::task::TaskFilter {
            status: Some(TaskStatus::Doing),
            ..Default::default()
        })
        .expect("filter");
    assert_eq!(only_doing.len(), 1);
    assert_eq!(only_doing[0].status, TaskStatus::Doing);
}

#[test]
fn update_changes_fields_and_preserves_others() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let t = svc.create(basic_task("orig")).expect("create");
    let mut p = basic_task("ignore");
    p.priority = TaskPriority::High;
    let _ignored = svc.create(p).expect("ignored");
    let patch = UpdateTask {
        title: Some("renamed".to_string()),
        priority: Some(TaskPriority::Urgent),
        ..Default::default()
    };
    let updated = svc.update(&t.id, patch).expect("update");
    assert_eq!(updated.title, "renamed");
    assert_eq!(updated.priority, TaskPriority::Urgent);
    // The other task was not affected.
    let other = svc.get(&_ignored.id).expect("get");
    assert_eq!(other.title, "ignore");
    assert_eq!(other.priority, TaskPriority::High);
}

#[test]
fn update_can_clear_optional_field() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let mut t = basic_task("with desc");
    t.description = Some("important".to_string());
    let created = svc.create(t).expect("create");
    assert!(created.description.is_some());

    let patch = UpdateTask {
        description: Some(None),
        ..Default::default()
    };
    let updated = svc.update(&created.id, patch).expect("update");
    assert!(updated.description.is_none());
}

#[test]
fn update_missing_id_returns_not_found() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let patch = UpdateTask {
        title: Some("anything".to_string()),
        ..Default::default()
    };
    let err = svc
        .update("00000000-0000-0000-0000-000000000000", patch)
        .expect_err("missing id must fail");
    assert!(matches!(err, auradesk_core::CoreError::NotFound { .. }));
}

#[test]
fn delete_removes_row() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let t = svc.create(basic_task("to delete")).expect("create");
    svc.delete(&t.id).expect("delete");
    let err = svc.get(&t.id).expect_err("must be gone");
    assert!(matches!(err, auradesk_core::CoreError::NotFound { .. }));
    assert!(svc.list(&Default::default()).expect("list").is_empty());
}

#[test]
fn delete_missing_id_returns_not_found() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let err = svc
        .delete("00000000-0000-0000-0000-000000000000")
        .expect_err("missing id must fail");
    assert!(matches!(err, auradesk_core::CoreError::NotFound { .. }));
}

#[test]
fn set_status_updates_status_and_completed_at() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let t = svc.create(basic_task("flow")).expect("create");
    assert!(t.completed_at.is_none());
    let done = svc.set_status(&t.id, TaskStatus::Done, 0).expect("done");
    assert_eq!(done.status, TaskStatus::Done);
    assert!(done.completed_at.is_some());
    // Move back to Todo: completed_at should clear.
    let back = svc.set_status(&t.id, TaskStatus::Todo, 0).expect("back");
    assert_eq!(back.status, TaskStatus::Todo);
    assert!(back.completed_at.is_none());
}

#[test]
fn kanban_order_appends_to_column() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let a = svc.create(basic_task("a-todo")).expect("a");
    let _b = svc.create(basic_task("b-todo")).expect("b");
    let mut doing = basic_task("c-doing");
    doing.status = TaskStatus::Doing;
    let _c = svc.create(doing).expect("c");
    // The two Todo tasks occupy orders 0 and 1; the Doing task
    // occupies order 0 of its own column.
    assert_eq!(a.kanban_order, 0);
    assert_eq!(_b.kanban_order, 1);
    assert_eq!(_c.kanban_order, 0);
}

#[test]
fn tags_roundtrip_as_json() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let mut t = basic_task("tagged");
    t.tags = Some(vec!["alpha".to_string(), "beta".to_string()]);
    let created = svc.create(t).expect("create");
    let fetched = svc.get(&created.id).expect("get");
    assert_eq!(
        fetched.tags,
        Some(vec!["alpha".to_string(), "beta".to_string()])
    );
}

#[test]
fn empty_tag_is_rejected() {
    let db = fresh_db();
    let svc = TasksService::new(&db);
    let mut t = basic_task("bad tag");
    t.tags = Some(vec!["".to_string()]);
    let err = svc.create(t).expect_err("empty tag must fail");
    assert!(matches!(err, auradesk_core::CoreError::Validation { .. }));
}
