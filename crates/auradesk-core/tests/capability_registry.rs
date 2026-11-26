//! Acceptance tests for the Unified Capability Registry (Issue #25).
//!
//! Run with: cargo test -p auradesk-core --test capability_registry

use auradesk_core::application::agents::{AgentSkillRecord, McpPluginRecord};
use auradesk_core::application::capability_registry::{CapabilityRegistry, CapabilityRegistryService};
use auradesk_core::domain::capability_registry::ToolSelectionCriteria;
use auradesk_core::infrastructure::db::Db;
use auradesk_core::CoreError;
use serde_json::json;

#[test]
fn registry_populates_from_all_sources_and_reaches_full_catalog() {
    let mut reg = CapabilityRegistry::new();
    assert_eq!(reg.len(), 0);

    // 1. Native tools
    reg.register_builtin_tools();
    assert_eq!(reg.len(), 19, "should ingest all 19 native tools");

    // 2. Memory tools
    reg.register_memory_tools();
    assert_eq!(reg.len(), 21, "should have native + 2 memory tools");
    assert!(reg.find("lightrag_knowledge_search").is_some());
    assert!(reg.find("hindsight_memory_recall").is_some());

    // 3. MCP Plugins
    let mcp_plugins = vec![McpPluginRecord {
        id: "plugin-github".to_string(),
        slug: "github".to_string(),
        name: "GitHub Official MCP".to_string(),
        transport: "stdio".to_string(),
        command_or_url: "npx @modelcontextprotocol/server-github".to_string(),
        args: vec![],
        env_vars: vec![],
        enabled: true,
        last_health_status: "healthy".to_string(),
        last_health_checked_at: None,
        discovered_tools: vec![
            "github_create_issue".to_string(),
            "github_search_repos".to_string(),
        ],
        created_at: "2026-11-26T00:00:00Z".to_string(),
        updated_at: "2026-11-26T00:00:00Z".to_string(),
    }];
    reg.register_mcp_plugins(&mcp_plugins);
    assert_eq!(reg.len(), 23);
    assert!(reg.find("github_create_issue").is_some());

    // 4. Skills (e.g. Caveman)
    let skills = vec![AgentSkillRecord {
        id: "skill-caveman".to_string(),
        slug: "caveman".to_string(),
        name: "Caveman".to_string(),
        description: "Terse caveman communication mode".to_string(),
        version: "1.0.0".to_string(),
        source_kind: "antigravity_import".to_string(),
        source_uri: "local://caveman/SKILL.md".to_string(),
        install_path: "/tmp/caveman".to_string(),
        skill_markdown: "---\nname: caveman\n---\nRules".to_string(),
        enabled: true,
        installed_at: "2026-11-26T00:00:00Z".to_string(),
        updated_at: "2026-11-26T00:00:00Z".to_string(),
    }];
    reg.register_skills(&skills);
    assert_eq!(reg.len(), 24);
    assert!(reg.find("run_skill_caveman").is_some());
}

#[test]
fn contextual_selection_prunes_catalog_by_intent() {
    let mut reg = CapabilityRegistry::new();
    reg.register_builtin_tools();
    reg.register_memory_tools();

    // Intent: Tasks & Planning
    let criteria_tasks = ToolSelectionCriteria {
        intent: "preciso criar uma tarefa e ver o quadro kanban".to_string(),
        max_tools: 4,
        max_schema_tokens: 2000,
        required_tools: vec![],
        allowed_sources: None,
    };
    let selected_tasks = reg.select_for_intent(&criteria_tasks);
    assert!(!selected_tasks.is_empty());
    assert!(selected_tasks.len() <= 4);

    let names: Vec<&str> = selected_tasks.iter().map(|s| s.capability.name.as_str()).collect();
    assert!(
        names.iter().any(|n| n.contains("task") || n.contains("kanban")),
        "expected task or kanban tools to be contextually selected, got: {:?}",
        names
    );

    // Intent: Memory & Recall
    let criteria_memory = ToolSelectionCriteria {
        intent: "o que foi que decidimos na conversa anterior sobre o banco de memória?".to_string(),
        max_tools: 3,
        max_schema_tokens: 2000,
        required_tools: vec![],
        allowed_sources: None,
    };
    let selected_memory = reg.select_for_intent(&criteria_memory);
    assert!(!selected_memory.is_empty());
    assert!(selected_memory.iter().any(|s| s.capability.name == "hindsight_memory_recall"));

    // Intent: Search code/project
    let criteria_code = ToolSelectionCriteria {
        intent: "buscar no código do projeto e nas pastas locais indexadas".to_string(),
        max_tools: 3,
        max_schema_tokens: 2000,
        required_tools: vec![],
        allowed_sources: None,
    };
    let selected_code = reg.select_for_intent(&criteria_code);
    assert!(selected_code.iter().any(|s| s.capability.name == "lightrag_knowledge_search"));
}

#[test]
fn contextual_selection_honors_required_tools_and_caps() {
    let mut reg = CapabilityRegistry::new();
    reg.register_builtin_tools();
    reg.register_memory_tools();

    let criteria = ToolSelectionCriteria {
        intent: "criar tarefa rápida".to_string(),
        max_tools: 3,
        max_schema_tokens: 2000,
        required_tools: vec!["pomodoro_status".to_string()],
        allowed_sources: None,
    };

    let selected = reg.select_for_intent(&criteria);
    assert!(selected.len() <= 3);
    assert!(
        selected.iter().any(|s| s.capability.name == "pomodoro_status" && s.is_required),
        "required tool must be present in selected set"
    );
}

#[test]
fn isolated_execution_catches_errors_and_tracks_metrics_without_crashing() {
    let mut reg = CapabilityRegistry::new();
    reg.register_builtin_tools();

    // 1. Successful execution
    let res_ok = reg.execute_isolated("list_tasks", json!({}), |_| {
        Ok(json!({ "tasks": [] }))
    });
    assert!(res_ok.success);
    assert!(res_ok.error.is_none());

    let tool_after_ok = reg.find("list_tasks").unwrap();
    assert_eq!(tool_after_ok.metrics.call_count, 1);
    assert_eq!(tool_after_ok.metrics.success_count, 1);
    assert_eq!(tool_after_ok.metrics.failure_count, 0);

    // 2. Failing execution - must not panic, must record failure in metrics
    let res_err = reg.execute_isolated("list_tasks", json!({}), |_| {
        Err(CoreError::internal("timeout or simulated service crash"))
    });
    assert!(!res_err.success);
    assert!(res_err.error.is_some());
    assert!(res_err.error.unwrap().contains("simulated service crash"));

    let tool_after_err = reg.find("list_tasks").unwrap();
    assert_eq!(tool_after_err.metrics.call_count, 2);
    assert_eq!(tool_after_err.metrics.success_count, 1);
    assert_eq!(tool_after_err.metrics.failure_count, 1);
    assert!(tool_after_err.metrics.last_error.is_some());
}

#[test]
fn exports_openai_tools_format() {
    let mut reg = CapabilityRegistry::new();
    reg.register_builtin_tools();

    let selected = reg.select_for_intent(&ToolSelectionCriteria {
        intent: "ver quadro kanban".to_string(),
        max_tools: 2,
        ..Default::default()
    });

    let tools_json = reg.export_openai_tools(&selected);
    assert!(!tools_json.is_empty());
    for t in &tools_json {
        assert_eq!(t["type"], "function");
        assert!(t["function"]["name"].is_string());
        assert!(t["function"]["description"].is_string());
        assert!(t["function"]["parameters"].is_object());
    }
}

#[test]
fn service_loads_from_database() {
    let db = Db::open_in_memory().unwrap();
    let service = CapabilityRegistryService::load_unified(&db).unwrap();

    assert!(service.registry().len() >= 21);
    let selected = service.select_tools("organizar tarefas do dia", 4);
    assert!(!selected.is_empty());
    assert!(selected.len() <= 4);
}
