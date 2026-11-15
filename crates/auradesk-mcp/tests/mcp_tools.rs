//! Integration and conformance tests for `auradesk-mcp` (Issue #8).
//!
//! Run with: cargo test -p auradesk-mcp --test mcp_tools

use auradesk_core::application::alerts::AlertsService;
use auradesk_core::application::proposals::{ProposalStatus, ProposalsService};
use auradesk_core::application::reminders::RemindersService;
use auradesk_core::application::tasks::TasksService;
use auradesk_core::capabilities::capabilities;
use auradesk_core::domain::reminder::{NewReminder, ReminderSound, RepeatKind};
use auradesk_core::domain::task::{NewTask, TaskFilter, TaskPriority, TaskStatus};
use auradesk_core::infrastructure::clock::FixedClock;
use auradesk_core::infrastructure::db::Db;
use auradesk_core::infrastructure::scheduler::Scheduler;
use auradesk_core::CoreError;
use auradesk_mcp::server::{map_core_error_to_jsonrpc, AuraDeskService};
use chrono::{Duration, Utc};
use serde_json::{json, Value};

fn call_json(svc: &AuraDeskService, name: &str, args: Value) -> Result<Value, rmcp::ErrorData> {
    let map = args.as_object().cloned();
    let res = svc.call_tool_sync(name, map)?;
    let text = res
        .content
        .first()
        .and_then(|c| c.as_text())
        .map(|t| t.text.clone())
        .expect("tool result text content");
    Ok(serde_json::from_str(&text).expect("valid json in tool result"))
}

#[test]
fn tools_list_returns_19_tools_matching_capability_registry() {
    let tools = AuraDeskService::mcp_tools();
    assert_eq!(tools.len(), 19, "MCP tools/list must expose all 19 tools");

    let registry_names: Vec<&str> = capabilities().iter().map(|c| c.name).collect();
    let mcp_names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
    assert_eq!(
        mcp_names, registry_names,
        "MCP tools/list must match auradesk capability registry 1-to-1"
    );
}

#[test]
fn unknown_tool_returns_minus_32601_and_invalid_args_returns_minus_32602() {
    let svc = AuraDeskService::new();

    // Unknown tool -> -32601 Method not found
    let err_unknown = svc
        .call_tool_sync("nonexistent_tool", None)
        .expect_err("unknown tool must fail");
    assert_eq!(err_unknown.code.0, -32601);

    // Invalid args (missing required field, bad type, or extra property) -> -32602 Invalid params
    let invalid_cases: Vec<(&str, Value)> = vec![
        ("approve_proposal", json!({})),
        ("get_kanban_board", json!({"unexpected": true})),
        ("get_project", json!({})),
        ("get_proposal", json!({"id": ""})),
        ("get_task", json!({"id": 123})),
        ("get_today_plan", json!({"extra": 1})),
        ("list_pending_proposals", json!({"limit": 0})),
        ("list_projects", json!({"include_archived": "yes"})),
        ("list_reminders", json!({"status": ["invalid_status"]})),
        ("list_tasks", json!({"limit": 9999})),
        ("pomodoro_status", json!({"extra": "no"})),
        ("propose_bulk_plan", json!({"entries": []})),
        (
            "propose_create_reminder",
            json!({"title": "Remind", "fire_at": "not-a-date"}),
        ),
        ("propose_create_task", json!({"title": ""})),
        ("propose_delete_task", json!({})),
        (
            "propose_subtasks",
            json!({"parent_task_id": "p1", "subtasks": []}),
        ),
        (
            "propose_update_task",
            json!({"id": "t1", "priority": "super_high"}),
        ),
        ("reject_proposal", json!({})),
        ("today_overview", json!({"extra": 1})),
    ];

    assert_eq!(
        invalid_cases.len(),
        19,
        "all 19 tools covered for invalid args"
    );
    for (tool_name, bad_args) in invalid_cases {
        let err = call_json(&svc, tool_name, bad_args.clone()).expect_err(&format!(
            "{tool_name} should reject invalid args {bad_args}"
        ));
        assert_eq!(
            err.code.0, -32602,
            "{tool_name} invalid args must return -32602, got {}",
            err.code.0
        );
    }
}

#[test]
fn all_19_tools_succeed_on_valid_inputs_and_validate_output_schemas() {
    let svc = AuraDeskService::new();

    // Seed a project so get_project & list_projects return real data
    let proj = auradesk_core::application::projects::ProjectsService::new(svc.db())
        .create(auradesk_core::domain::project::NewProject {
            name: "Core Consolidation".into(),
            description: Some("Unified engine".into()),
            color: Some("#3B82F6".into()),
            parent_id: None,
            start_date: None,
            target_date: None,
        })
        .unwrap();

    // 1. list_projects & 2. get_project
    let projects = call_json(&svc, "list_projects", json!({"include_archived": false})).unwrap();
    assert_eq!(projects.as_array().unwrap().len(), 1);
    let got_proj = call_json(&svc, "get_project", json!({"id": proj.id})).unwrap();
    assert_eq!(got_proj["name"], "Core Consolidation");

    // 3. propose_create_task -> 4. list_pending_proposals -> 5. get_proposal -> 6. approve_proposal
    let prop_task = call_json(
        &svc,
        "propose_create_task",
        json!({
            "title": "Write MCP tests",
            "priority": "high",
            "project_id": proj.id,
            "estimate_min": 45,
            "tags": ["mcp", "test"]
        }),
    )
    .unwrap();
    let prop_task_id = prop_task["proposal_id"].as_str().unwrap().to_string();

    // Verify task was NOT created yet (propose != execute)
    let tasks_before = call_json(&svc, "list_tasks", json!({})).unwrap();
    assert!(tasks_before.as_array().unwrap().is_empty());

    let pending_list = call_json(&svc, "list_pending_proposals", json!({"limit": 10})).unwrap();
    assert_eq!(pending_list.as_array().unwrap().len(), 1);

    let fetched_prop = call_json(&svc, "get_proposal", json!({"id": prop_task_id})).unwrap();
    assert_eq!(fetched_prop["status"], "pending");

    let approved = call_json(
        &svc,
        "approve_proposal",
        json!({"id": prop_task_id, "note": "Looks great"}),
    )
    .unwrap();
    assert_eq!(approved["result_kind"], "task");
    let created_task_id = approved["result_ref_id"].as_str().unwrap().to_string();

    // 7. get_task & 8. list_tasks & 9. get_kanban_board
    let got_task = call_json(&svc, "get_task", json!({"id": created_task_id})).unwrap();
    assert_eq!(got_task["title"], "Write MCP tests");

    let tasks_after = call_json(&svc, "list_tasks", json!({"status": ["todo"]})).unwrap();
    assert_eq!(tasks_after.as_array().unwrap().len(), 1);

    let board = call_json(&svc, "get_kanban_board", json!({})).unwrap();
    assert_eq!(board["columns"].as_array().unwrap().len(), 4);

    // 10. propose_update_task + approve
    let prop_upd = call_json(
        &svc,
        "propose_update_task",
        json!({"id": created_task_id, "title": "Write 19 MCP tests"}),
    )
    .unwrap();
    call_json(
        &svc,
        "approve_proposal",
        json!({"id": prop_upd["proposal_id"]}),
    )
    .unwrap();
    let updated_task = call_json(&svc, "get_task", json!({"id": created_task_id})).unwrap();
    assert_eq!(updated_task["title"], "Write 19 MCP tests");

    // 11. propose_subtasks + approve
    let prop_sub = call_json(
        &svc,
        "propose_subtasks",
        json!({
            "parent_task_id": created_task_id,
            "subtasks": [
                {"title": "Subtask A", "estimate_min": 15, "priority": "normal"},
                {"title": "Subtask B", "estimate_min": 20, "priority": "high"}
            ]
        }),
    )
    .unwrap();
    let app_sub = call_json(
        &svc,
        "approve_proposal",
        json!({"id": prop_sub["proposal_id"]}),
    )
    .unwrap();
    assert_eq!(app_sub["result_kind"], "subtask_group");

    // 12. propose_create_reminder + approve -> 13. list_reminders
    let fire_at = (Utc::now() + Duration::hours(1)).to_rfc3339();
    let prop_rem = call_json(
        &svc,
        "propose_create_reminder",
        json!({
            "title": "Review PR",
            "fire_at": fire_at,
            "task_id": created_task_id,
            "sound": "normal",
            "repeat": {"kind": "daily"}
        }),
    )
    .unwrap();
    call_json(
        &svc,
        "approve_proposal",
        json!({"id": prop_rem["proposal_id"]}),
    )
    .unwrap();
    let reminders = call_json(&svc, "list_reminders", json!({"status": ["pending"]})).unwrap();
    assert_eq!(reminders.as_array().unwrap().len(), 1);

    // 14. propose_bulk_plan + approve -> 15. get_today_plan
    let plan_before = call_json(&svc, "get_today_plan", json!({})).unwrap();
    assert!(plan_before.is_null());

    let prop_plan = call_json(
        &svc,
        "propose_bulk_plan",
        json!({
            "entries": [{"kind": "existing", "task_id": created_task_id, "order": 0, "estimate_min": 45}],
            "notes": "Focus on MCP"
        }),
    )
    .unwrap();
    call_json(
        &svc,
        "approve_proposal",
        json!({"id": prop_plan["proposal_id"]}),
    )
    .unwrap();
    let plan_after = call_json(&svc, "get_today_plan", json!({})).unwrap();
    assert_eq!(plan_after["state"], "in_progress");

    // 16. pomodoro_status & 17. today_overview
    let pomo = call_json(&svc, "pomodoro_status", json!({})).unwrap();
    assert!(pomo.is_null());
    let overview = call_json(&svc, "today_overview", json!({})).unwrap();
    assert_eq!(overview["today_plan_state"], "in_progress");

    // 18. propose_delete_task -> 19. reject_proposal
    let prop_del = call_json(&svc, "propose_delete_task", json!({"id": created_task_id})).unwrap();
    let rejected = call_json(
        &svc,
        "reject_proposal",
        json!({"id": prop_del["proposal_id"], "note": "Keep this task"}),
    )
    .unwrap();
    assert_eq!(rejected["status"], "rejected");
    // Task still exists after rejection
    assert!(call_json(&svc, "get_task", json!({"id": created_task_id})).is_ok());
}

#[test]
fn propose_create_task_twice_creates_two_distinct_proposals_and_approving_one_leaves_other_pending()
{
    let svc = AuraDeskService::new();
    let input = json!({"title": "Identical Task", "priority": "normal"});

    let p1 = call_json(&svc, "propose_create_task", input.clone()).unwrap();
    let p2 = call_json(&svc, "propose_create_task", input).unwrap();

    let id1 = p1["proposal_id"].as_str().unwrap();
    let id2 = p2["proposal_id"].as_str().unwrap();
    assert_ne!(
        id1, id2,
        "two identical proposals must receive distinct proposal_ids"
    );

    // Approve p1
    call_json(&svc, "approve_proposal", json!({"id": id1})).unwrap();

    // p2 must remain pending and untouched
    let p2_state = call_json(&svc, "get_proposal", json!({"id": id2})).unwrap();
    assert_eq!(p2_state["status"], "pending");

    // Only 1 task was created
    let tasks = call_json(&svc, "list_tasks", json!({})).unwrap();
    assert_eq!(tasks.as_array().unwrap().len(), 1);
}

#[test]
fn approve_proposal_detects_payload_hash_or_schema_drift_and_marks_expired() {
    let svc = AuraDeskService::new();

    // Case 1: Tampered payload (payload_hash mismatch)
    let p1 = call_json(&svc, "propose_create_task", json!({"title": "Legit Task"})).unwrap();
    let id1 = p1["proposal_id"].as_str().unwrap();

    {
        let conn = svc.db().writer();
        conn.execute(
            "UPDATE ia_proposals SET payload = '{\"title\":\"Tampered\"}' WHERE id = ?1",
            rusqlite::params![id1],
        )
        .unwrap();
    }

    let err1 = call_json(&svc, "approve_proposal", json!({"id": id1}))
        .expect_err("tampered payload must fail validation");
    assert_eq!(err1.code.0, -32602);
    let p1_after = ProposalsService::new(svc.db()).get(id1).unwrap();
    assert_eq!(p1_after.status, ProposalStatus::Expired);

    // Case 2: Schema drift (payload matches its stored hash, but violates current schema)
    let p2 = call_json(
        &svc,
        "propose_create_task",
        json!({"title": "Soon invalid schema"}),
    )
    .unwrap();
    let id2 = p2["proposal_id"].as_str().unwrap();
    let drifted_payload = r#"{"title":""}"#; // violates minLength: 1
    let drifted_hash = auradesk_core::application::proposals::sha256_hex(drifted_payload);
    {
        let conn = svc.db().writer();
        conn.execute(
            "UPDATE ia_proposals SET payload = ?1, payload_hash = ?2 WHERE id = ?3",
            rusqlite::params![drifted_payload, drifted_hash, id2],
        )
        .unwrap();
    }

    let err2 = call_json(&svc, "approve_proposal", json!({"id": id2}))
        .expect_err("drifted schema payload must fail validation");
    assert_eq!(err2.code.0, -32602);
    let p2_after = ProposalsService::new(svc.db()).get(id2).unwrap();
    assert_eq!(p2_after.status, ProposalStatus::Expired);
}

#[test]
fn degraded_mode_core_flows_work_without_mcp_server() {
    // No AuraDeskService instantiated at all — pure core + scheduler flows
    let db = Db::open_in_memory().unwrap();
    let tasks_svc = TasksService::new(&db);
    let reminders_svc = RemindersService::new(&db);
    let alerts_svc = AlertsService::new(&db);

    let task = tasks_svc
        .create(NewTask {
            title: "Offline Task".into(),
            description: None,
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::High,
            status: TaskStatus::Todo,
            due_at: None,
            estimate_min: Some(25),
            tags: None,
        })
        .unwrap();
    assert_eq!(tasks_svc.list(&TaskFilter::default()).unwrap().len(), 1);

    let now = Utc::now();
    reminders_svc
        .create(NewReminder {
            title: "Offline Reminder".into(),
            body: None,
            fire_at: now - Duration::minutes(1),
            repeat_kind: RepeatKind::None,
            sound: ReminderSound::Normal,
            task_id: Some(task.id),
        })
        .unwrap();

    let clock = FixedClock::new(now);
    let tick = Scheduler::new(&db, &clock).tick().unwrap();
    assert_eq!(tick.fired_reminder_alerts.len(), 1);
    assert_eq!(alerts_svc.list_pending().unwrap().len(), 1);
}

#[test]
fn jsonrpc_error_mapping_covers_all_core_error_variants() {
    assert_eq!(
        map_core_error_to_jsonrpc(&CoreError::validation("f", "bad")).0,
        -32602
    );
    assert_eq!(
        map_core_error_to_jsonrpc(&CoreError::not_found("tool", "x")).0,
        -32601
    );
    assert_eq!(
        map_core_error_to_jsonrpc(&CoreError::not_found("task", "1")).0,
        -32004
    );
    assert_eq!(
        map_core_error_to_jsonrpc(&CoreError::conflict("proposal", "dup")).0,
        -32009
    );
    assert_eq!(
        map_core_error_to_jsonrpc(&CoreError::internal("boom")).0,
        -32603
    );
}

#[test]
fn open_persists_data_across_service_restarts() {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("auradesk-mcp-test-{}-{nanos}", std::process::id()));
    {
        let svc1 = AuraDeskService::open(&dir).unwrap();
        let proposal = call_json(
            &svc1,
            "propose_create_task",
            json!({
                "title": "Persisted across MCP restart",
                "priority": "high"
            }),
        )
        .unwrap();
        let proposal_id = proposal["proposal_id"].as_str().unwrap();
        call_json(&svc1, "approve_proposal", json!({ "id": proposal_id })).unwrap();
    }

    {
        let svc2 = AuraDeskService::open(&dir).unwrap();
        let list = call_json(&svc2, "list_tasks", json!({})).unwrap();
        let items = list.as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["title"], "Persisted across MCP restart");
    }

    let _ = std::fs::remove_dir_all(&dir);
}
