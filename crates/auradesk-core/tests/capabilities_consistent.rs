//! Consistency and schema invariants for the 19-tool capability registry (Issue #8).
//!
//! Run with: cargo test -p auradesk-core --test capabilities_consistent

use auradesk_core::capabilities::{capabilities, find_capability, CapabilityKind};

#[test]
fn registry_has_all_19_spec_tools() {
    let caps = capabilities();
    assert_eq!(
        caps.len(),
        19,
        "spec §8.2 requires exactly 19 capabilities; got {}",
        caps.len()
    );

    let expected = [
        "approve_proposal",
        "get_kanban_board",
        "get_project",
        "get_proposal",
        "get_task",
        "get_today_plan",
        "list_pending_proposals",
        "list_projects",
        "list_reminders",
        "list_tasks",
        "pomodoro_status",
        "propose_bulk_plan",
        "propose_create_reminder",
        "propose_create_task",
        "propose_delete_task",
        "propose_subtasks",
        "propose_update_task",
        "reject_proposal",
        "today_overview",
    ];
    let actual: Vec<&str> = caps.iter().map(|c| c.name).collect();
    assert_eq!(actual, expected);
}

#[test]
fn registry_names_are_alphabetically_sorted() {
    let caps = capabilities();
    let names: Vec<&str> = caps.iter().map(|c| c.name).collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    assert_eq!(
        names, sorted,
        "capability names must be alphabetical; got {:?}",
        names
    );
}

#[test]
fn propose_tools_are_mcp_only_and_read_approve_are_both() {
    for c in capabilities() {
        if c.name.starts_with("propose_") {
            assert_eq!(
                c.kind,
                CapabilityKind::Mcp,
                "{} must be CapabilityKind::Mcp",
                c.name
            );
        } else {
            assert_eq!(
                c.kind,
                CapabilityKind::Both,
                "{} must be CapabilityKind::Both",
                c.name
            );
        }
        assert!(find_capability(c.name).is_some());
        assert_eq!(
            c.input_schema.get("$schema").and_then(|v| v.as_str()),
            Some("https://json-schema.org/draft/2020-12/schema"),
            "{} input_schema must declare Draft 2020-12",
            c.name
        );
        assert_eq!(
            c.output_schema.get("$schema").and_then(|v| v.as_str()),
            Some("https://json-schema.org/draft/2020-12/schema"),
            "{} output_schema must declare Draft 2020-12",
            c.name
        );
    }
}
