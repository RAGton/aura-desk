//! Acceptance tests for the autonomous Agent Runtime (Issue #22).
//!
//! Run with: cargo test -p auradesk-core --test agent_runtime

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use auradesk_core::application::agent_runtime::{AgentLoop, MockToolExecutor};
use auradesk_core::domain::agent_runtime::{
    AgentEventType, AgentExecutionStatus, AgentLoopConfig, ExecutionPlan, PlanStep, PlanStepStatus,
};
use auradesk_core::infrastructure::db::Db;
use auradesk_core::CoreError;
use serde_json::json;

#[test]
fn happy_path_executes_multi_step_plan_to_completion() {
    let mut plan = ExecutionPlan::new("plan-1", "Construir e validar novo módulo");

    let step1 = PlanStep::new(
        "step-1",
        1,
        "Consultar tarefas abertas",
        "orchestrator",
        Some("list_tasks".to_string()),
        json!({}),
    );
    plan.add_step(step1);

    let mut step2 = PlanStep::new(
        "step-2",
        2,
        "Criar nova tarefa no projeto",
        "orchestrator",
        Some("propose_create_task".to_string()),
        json!({ "title": "Implementar módulo" }),
    );
    step2.dependencies.push("step-1".to_string());
    plan.add_step(step2);

    let mut step3 = PlanStep::new(
        "step-3",
        3,
        "Sintetizar resultado final para o usuário",
        "orchestrator",
        None, // reasoning step
        json!({}),
    );
    step3.dependencies.push("step-2".to_string());
    plan.add_step(step3);

    let mut agent = AgentLoop::new("run-1", None, "orchestrator", plan, AgentLoopConfig::default());

    let mut executor = MockToolExecutor::new(|tool, _args| match tool {
        "list_tasks" => Ok(json!({ "tasks": [] })),
        "propose_create_task" => Ok(json!({ "taskId": "t-101", "created": true })),
        _ => Err(CoreError::internal("unexpected tool")),
    });

    let summary = agent.run(&mut executor).unwrap();

    assert_eq!(summary.status, AgentExecutionStatus::Completed);
    assert_eq!(summary.completed_steps, 3);
    assert_eq!(summary.total_steps, 3);
    assert!(agent.plan.is_successful());

    // Verify events sequence
    let event_types: Vec<AgentEventType> = agent.events.iter().map(|e| e.event_type.clone()).collect();
    assert!(event_types.contains(&AgentEventType::RunStarted));
    assert!(event_types.contains(&AgentEventType::StepStarted));
    assert!(event_types.contains(&AgentEventType::ToolInvoked));
    assert!(event_types.contains(&AgentEventType::ToolResult));
    assert!(event_types.contains(&AgentEventType::StepCompleted));
    assert!(event_types.contains(&AgentEventType::RunCompleted));
}

#[test]
fn tool_error_recovers_via_retry_before_succeeding() {
    let mut plan = ExecutionPlan::new("plan-2", "Testar resiliência com retry");
    let step = PlanStep::new(
        "step-retry",
        1,
        "Chamada com falha transitória",
        "orchestrator",
        Some("flaky_api".to_string()),
        json!({}),
    );
    plan.add_step(step);

    let mut config = AgentLoopConfig::default();
    config.max_retries_per_step = 2;
    config.auto_retry_errors = true;

    let mut agent = AgentLoop::new("run-2", None, "orchestrator", plan, config);

    let call_count = Arc::new(AtomicUsize::new(0));
    let call_count_clone = Arc::clone(&call_count);

    let mut executor = MockToolExecutor::new(move |_tool, _args| {
        let count = call_count_clone.fetch_add(1, Ordering::SeqCst);
        if count == 0 {
            // First call fails
            Err(CoreError::internal("timeout de rede temporário"))
        } else {
            // Retry succeeds
            Ok(json!({ "recovered": true }))
        }
    });

    let summary = agent.run(&mut executor).unwrap();
    assert_eq!(summary.status, AgentExecutionStatus::Completed);
    assert_eq!(summary.completed_steps, 1);
    assert_eq!(call_count.load(Ordering::SeqCst), 2);
}

#[test]
fn cancellation_handle_halts_loop_gracefully() {
    let mut plan = ExecutionPlan::new("plan-3", "Execução longa a ser cancelada");
    for i in 1..=5 {
        let mut s = PlanStep::new(
            format!("step-{i}"),
            i,
            format!("Passo {i}"),
            "orchestrator",
            Some("noop".to_string()),
            json!({}),
        );
        if i > 1 {
            s.dependencies.push(format!("step-{}", i - 1));
        }
        plan.add_step(s);
    }

    let mut agent = AgentLoop::new("run-3", None, "orchestrator", plan, AgentLoopConfig::default());
    let cancel = agent.cancel_handle();

    let mut executor = MockToolExecutor::new(|_tool, _args| Ok(json!({ "ok": true })));

    // Run first step
    let more = agent.step(&mut executor).unwrap();
    assert!(more);
    assert_eq!(agent.status, AgentExecutionStatus::Running);

    // Trigger external cancellation
    cancel.cancel();

    // Next step must detect cancellation and exit
    let more = agent.step(&mut executor).unwrap();
    assert!(!more, "must stop when cancelled");
    assert_eq!(agent.status, AgentExecutionStatus::Cancelled);

    let last_event = agent.events.last().unwrap();
    assert_eq!(last_event.event_type, AgentEventType::Cancelled);
}

#[test]
fn approval_gating_pauses_execution_and_resumes_cleanly() {
    let mut plan = ExecutionPlan::new("plan-4", "Deleção segura com aprovação");
    let mut step = PlanStep::new(
        "step-del",
        1,
        "Excluir recurso crítico",
        "orchestrator",
        Some("delete_resource".to_string()),
        json!({ "id": "res-99" }),
    );
    step.requires_approval = true;
    plan.add_step(step);

    let mut agent = AgentLoop::new("run-4", None, "orchestrator", plan, AgentLoopConfig::default());
    let mut executor = MockToolExecutor::new(|_tool, _args| Ok(json!({ "deleted": true })));

    // First step attempts to execute, but gates on approval
    let more = agent.step(&mut executor).unwrap();
    assert!(!more);
    assert_eq!(agent.status, AgentExecutionStatus::AwaitingApproval);

    let gated_step = agent.plan.get_step("step-del").unwrap();
    assert_eq!(gated_step.status, PlanStepStatus::AwaitingApproval);

    // User approves in UI: remove approval gate and resume
    agent.plan.get_step_mut("step-del").unwrap().requires_approval = false;
    agent.plan.get_step_mut("step-del").unwrap().status = PlanStepStatus::Pending;
    agent.resume();
    assert_eq!(agent.status, AgentExecutionStatus::Running);

    // Next step completes
    let more = agent.step(&mut executor).unwrap();
    assert!(!more);
    assert_eq!(agent.status, AgentExecutionStatus::Completed);
}

#[test]
fn persists_and_restores_from_sqlite_database() {
    let db = Db::open_in_memory().unwrap();

    let mut plan = ExecutionPlan::new("plan-db", "Tarefa persistida");
    plan.add_step(PlanStep::new(
        "s1",
        1,
        "Passo um",
        "orchestrator",
        Some("noop".to_string()),
        json!({}),
    ));
    let mut s2 = PlanStep::new(
        "s2",
        2,
        "Passo dois",
        "orchestrator",
        Some("noop".to_string()),
        json!({}),
    );
    s2.dependencies.push("s1".to_string());
    plan.add_step(s2);

    let mut agent = AgentLoop::new("run-persisted-1", Some("sess-1".into()), "orchestrator", plan, AgentLoopConfig::default());
    let mut executor = MockToolExecutor::new(|_tool, _args| Ok(json!({ "step": "done" })));

    // Execute first step
    let more = agent.step(&mut executor).unwrap();
    assert!(more);
    agent.pause();

    // Persist to DB
    agent.persist_to_db(&db).unwrap();

    // Restore from DB as a fresh instance
    let mut restored = AgentLoop::restore_from_db(&db, "run-persisted-1").unwrap();

    assert_eq!(restored.run_id, "run-persisted-1");
    assert_eq!(restored.session_id, Some("sess-1".into()));
    assert_eq!(restored.status, AgentExecutionStatus::Paused);
    assert_eq!(restored.plan.steps.len(), 2);
    assert_eq!(restored.plan.steps[0].status, PlanStepStatus::Completed);
    assert_eq!(restored.plan.steps[1].status, PlanStepStatus::Pending);

    // Resume restored agent and finish step 2
    restored.resume();
    let summary = restored.run(&mut executor).unwrap();
    assert_eq!(summary.status, AgentExecutionStatus::Completed);
    assert_eq!(summary.completed_steps, 2);
}

#[test]
fn agent_loop_integrates_with_unified_capability_registry() {
    let db = Db::open_in_memory().unwrap();
    let mut reg_service = auradesk_core::application::capability_registry::CapabilityRegistryService::load_unified(&db).unwrap();

    let mut plan = ExecutionPlan::new("plan-reg", "Teste integrado com CapabilityRegistry");
    plan.add_step(PlanStep::new(
        "s1",
        1,
        "Listar tarefas",
        "orchestrator",
        Some("list_tasks".to_string()),
        json!({}),
    ));

    let mut agent = AgentLoop::new("run-reg-1", None, "orchestrator", plan, AgentLoopConfig::default());
    let mut executor = auradesk_core::application::agent_runtime::RegistryToolExecutor::new(reg_service.registry_mut());

    let summary = agent.run(&mut executor).unwrap();
    assert_eq!(summary.status, AgentExecutionStatus::Completed);
    assert_eq!(summary.completed_steps, 1);
}
