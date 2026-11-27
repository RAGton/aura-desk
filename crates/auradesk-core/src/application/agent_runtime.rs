//! Agent Runtime application orchestrator, execution loop and persistence (Issue #22).
//!
//! Independent of Tauri and UI frameworks: runs headless across desktop shell,
//! background automations, CLI, and MCP server.

#![allow(missing_docs)]

use chrono::Utc;
use rusqlite::params;
use serde_json::{json, Value};

use crate::application::agents::AgentPlanStep;
use crate::application::capability_registry::CapabilityRegistry;
use crate::application::context_engine::ContextEngineService;
use crate::application::memories::LocalMemoryService;
use crate::application::settings::SettingsService;
use crate::capabilities::{dispatch_capability, find_capability};
use crate::domain::agent_runtime::{
    AgentEventType, AgentExecutionEvent, AgentExecutionStatus, AgentExecutionSummary,
    AgentLoopConfig, CancellationHandle, ExecutionPlan, PlanStep, PlanStepStatus,
};
use crate::domain::settings_key::SettingsKey;
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Trait abstracting tool dispatch for the agent loop.
/// Enables mock testing without I/O or full registry integration in production.
pub trait AgentToolExecutor {
    fn execute(&mut self, tool_name: &str, args: Value) -> Result<Value, CoreError>;
}

/// Simple closure-based or map-based mock executor for testing.
pub struct MockToolExecutor<F>
where
    F: FnMut(&str, Value) -> Result<Value, CoreError>,
{
    handler: F,
}

impl<F> MockToolExecutor<F>
where
    F: FnMut(&str, Value) -> Result<Value, CoreError>,
{
    pub fn new(handler: F) -> Self {
        Self { handler }
    }
}

impl<F> AgentToolExecutor for MockToolExecutor<F>
where
    F: FnMut(&str, Value) -> Result<Value, CoreError>,
{
    fn execute(&mut self, tool_name: &str, args: Value) -> Result<Value, CoreError> {
        (self.handler)(tool_name, args)
    }
}

/// Production tool executor backed by the Unified `CapabilityRegistry` (Issue #25).
pub struct RegistryToolExecutor<'a> {
    registry: &'a mut CapabilityRegistry,
    db: Option<&'a Db>,
}

impl<'a> RegistryToolExecutor<'a> {
    pub fn new(registry: &'a mut CapabilityRegistry) -> Self {
        Self { registry, db: None }
    }

    pub fn with_db(registry: &'a mut CapabilityRegistry, db: &'a Db) -> Self {
        Self {
            registry,
            db: Some(db),
        }
    }
}

fn map_tool_to_native_capability(tool_name: &str) -> &str {
    match tool_name {
        "tasks.list" => "list_tasks",
        "tasks.today_overview" => "today_overview",
        "kanban.board" => "get_kanban_board",
        "pomodoro.status" => "pomodoro_status",
        "reminders.list" => "list_reminders",
        "projects.list" => "list_projects",
        "plan.today" => "get_today_plan",
        "proposals.list_pending" => "list_pending_proposals",
        other => other,
    }
}

impl<'a> AgentToolExecutor for RegistryToolExecutor<'a> {
    fn execute(&mut self, tool_name: &str, args: Value) -> Result<Value, CoreError> {
        let db_opt = self.db;
        let res = self.registry.execute_isolated(tool_name, args, |input| {
            let Some(db) = db_opt else {
                return Ok(json!({ "dispatched": tool_name }));
            };

            let mapped = map_tool_to_native_capability(tool_name);
            if find_capability(mapped).is_some() {
                return dispatch_capability(db, mapped, input);
            }

            match tool_name {
                "memory.hindsight_recall" | "hindsight_recall" => {
                    let query = input
                        .get("query")
                        .or_else(|| input.get("goal"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let limit = input.get("limit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
                    let items = LocalMemoryService::new(db).recall(None, query, limit)?;
                    Ok(json!({
                        "source": "local_memories",
                        "count": items.len(),
                        "items": items
                    }))
                }
                "context.compress_session" | "context_compress_session" => {
                    let session_id = input.get("sessionId").and_then(|v| v.as_str());
                    let inspection = ContextEngineService::new(db).inspect_session(session_id)?;
                    Ok(serde_json::to_value(&inspection)
                        .map_err(|e| CoreError::internal(format!("serialize context: {e}")))?)
                }
                "research.knowledge_query" | "lightrag_query" => {
                    let folders = SettingsService::new(db)
                        .get(SettingsKey::RaglightFolders)
                        .ok()
                        .flatten()
                        .and_then(|v| v.as_str().map(str::to_string))
                        .unwrap_or_default();
                    let query = input
                        .get("query")
                        .or_else(|| input.get("goal"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let local_hits = LocalMemoryService::new(db).recall(None, query, 5)?;
                    Ok(json!({
                        "source": "offline_index_context",
                        "configuredFolders": folders,
                        "localMemories": local_hits
                    }))
                }
                _ => Err(CoreError::validation(
                    "capability",
                    format!("tool '{tool_name}' requires an active external runtime or desktop bridge"),
                )),
            }
        });

        if res.success {
            Ok(res.output)
        } else {
            Err(CoreError::internal(
                res.error.unwrap_or_else(|| "tool execution failed".into()),
            ))
        }
    }
}

/// Stateful agent loop coordinating planning, tool invocation, error recovery,
/// event emission, and cancellation.
pub struct AgentLoop {
    pub run_id: String,
    pub session_id: Option<String>,
    pub agent_role: String,
    pub plan: ExecutionPlan,
    pub status: AgentExecutionStatus,
    pub config: AgentLoopConfig,
    pub events: Vec<AgentExecutionEvent>,
    pub tool_calls: Vec<Value>,
    cancellation: CancellationHandle,
}

impl AgentLoop {
    /// Create an agent loop with a prepared execution plan.
    pub fn new(
        run_id: impl Into<String>,
        session_id: Option<String>,
        agent_role: impl Into<String>,
        plan: ExecutionPlan,
        config: AgentLoopConfig,
    ) -> Self {
        let id_str = run_id.into();
        let role_str = agent_role.into();
        let mut events = Vec::new();

        events.push(AgentExecutionEvent::new(
            &id_str,
            AgentEventType::RunStarted,
            None,
            json!({ "goal": plan.goal, "role": role_str, "stepCount": plan.steps.len() }),
        ));

        Self {
            run_id: id_str,
            session_id,
            agent_role: role_str,
            plan,
            status: AgentExecutionStatus::Planned,
            config,
            events,
            tool_calls: Vec::new(),
            cancellation: CancellationHandle::new(),
        }
    }

    /// Retrieve a cancellation handle to stop the execution loop from another thread.
    pub fn cancel_handle(&self) -> CancellationHandle {
        self.cancellation.clone()
    }

    /// Check if cancellation was requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    /// Signal cancellation directly.
    pub fn cancel(&mut self) {
        self.cancellation.cancel();
        self.status = AgentExecutionStatus::Cancelled;
        self.events.push(AgentExecutionEvent::new(
            &self.run_id,
            AgentEventType::Cancelled,
            None,
            json!({ "reason": "user_cancelled" }),
        ));
    }

    /// Pause execution cleanly for later resumption.
    pub fn pause(&mut self) {
        if self.status == AgentExecutionStatus::Running
            || self.status == AgentExecutionStatus::Planned
        {
            self.status = AgentExecutionStatus::Paused;
        }
    }

    /// Resume a paused or approval-gated run.
    pub fn resume(&mut self) {
        if self.status == AgentExecutionStatus::Paused
            || self.status == AgentExecutionStatus::AwaitingApproval
        {
            self.status = AgentExecutionStatus::Running;
            self.events.push(AgentExecutionEvent::new(
                &self.run_id,
                AgentEventType::Resumed,
                None,
                json!({}),
            ));
        }
    }

    /// Approve any gated steps waiting on user confirmation so resumption can proceed.
    pub fn approve_pending_steps(&mut self) {
        for step in &mut self.plan.steps {
            if step.status == PlanStepStatus::AwaitingApproval
                || (step.status == PlanStepStatus::Pending && step.requires_approval)
            {
                step.requires_approval = false;
                step.status = PlanStepStatus::Pending;
            }
        }
    }

    /// Execute a single step iteration of the agent loop.
    ///
    /// Returns `Ok(true)` if more work remains, or `Ok(false)` if the loop completed,
    /// paused, awaited approval, or was cancelled.
    pub fn step<E: AgentToolExecutor>(&mut self, executor: &mut E) -> Result<bool, CoreError> {
        // 1. Check cancellation token
        if self.is_cancelled() {
            self.status = AgentExecutionStatus::Cancelled;
            self.events.push(AgentExecutionEvent::new(
                &self.run_id,
                AgentEventType::Cancelled,
                None,
                json!({ "reason": "token_cancelled" }),
            ));
            return Ok(false);
        }

        self.status = AgentExecutionStatus::Running;

        // 2. Discover runnable steps whose dependencies have all completed
        let runnable_step_ids = self.plan.find_runnable_steps();

        // If no steps can run right now:
        if runnable_step_ids.is_empty() {
            if self.plan.is_all_terminal() {
                if self.plan.is_successful() {
                    self.status = AgentExecutionStatus::Completed;
                    self.events.push(AgentExecutionEvent::new(
                        &self.run_id,
                        AgentEventType::RunCompleted,
                        None,
                        json!({ "completedSteps": self.plan.steps.len() }),
                    ));
                } else {
                    self.status = AgentExecutionStatus::Failed;
                    self.events.push(AgentExecutionEvent::new(
                        &self.run_id,
                        AgentEventType::RunFailed,
                        None,
                        json!({ "reason": "one_or_more_steps_failed" }),
                    ));
                }
                return Ok(false);
            }

            // Steps remain but none are runnable -> dependency deadlock
            self.status = AgentExecutionStatus::Failed;
            self.events.push(AgentExecutionEvent::new(
                &self.run_id,
                AgentEventType::RunFailed,
                None,
                json!({ "reason": "dependency_deadlock_unreachable_prerequisites" }),
            ));
            return Ok(false);
        }

        // 3. Execute runnable steps
        for step_id in runnable_step_ids {
            // Check cancellation between steps
            if self.is_cancelled() {
                self.status = AgentExecutionStatus::Cancelled;
                return Ok(false);
            }

            let step = match self.plan.get_step_mut(&step_id) {
                Some(s) => s,
                None => continue,
            };

            // Gate step if it requires user approval
            if step.requires_approval {
                step.status = PlanStepStatus::AwaitingApproval;
                self.status = AgentExecutionStatus::AwaitingApproval;
                self.events.push(AgentExecutionEvent::new(
                    &self.run_id,
                    AgentEventType::AwaitingApproval,
                    Some(step_id.clone()),
                    json!({
                        "stepTitle": step.title,
                        "tool": step.tool_name,
                        "args": step.tool_args
                    }),
                ));
                return Ok(false);
            }

            step.mark_running();
            self.events.push(AgentExecutionEvent::new(
                &self.run_id,
                AgentEventType::StepStarted,
                Some(step_id.clone()),
                json!({ "title": step.title, "order": step.order }),
            ));

            if let Some(tool) = &step.tool_name {
                let tool_str = tool.clone();
                let args_val = step.tool_args.clone();

                self.events.push(AgentExecutionEvent::new(
                    &self.run_id,
                    AgentEventType::ToolInvoked,
                    Some(step_id.clone()),
                    json!({ "tool": tool_str, "args": args_val }),
                ));

                let outcome = executor.execute(&tool_str, args_val.clone());

                self.tool_calls.push(json!({
                    "stepId": step_id,
                    "tool": tool_str,
                    "args": args_val,
                    "success": outcome.is_ok(),
                    "timestamp": Utc::now().to_rfc3339()
                }));

                match outcome {
                    Ok(val) => {
                        self.events.push(AgentExecutionEvent::new(
                            &self.run_id,
                            AgentEventType::ToolResult,
                            Some(step_id.clone()),
                            json!({ "tool": tool_str, "success": true, "output": val }),
                        ));

                        if let Some(s) = self.plan.get_step_mut(&step_id) {
                            s.mark_completed(val);
                            self.events.push(AgentExecutionEvent::new(
                                &self.run_id,
                                AgentEventType::StepCompleted,
                                Some(step_id.clone()),
                                json!({ "stepId": step_id }),
                            ));
                        }
                    }
                    Err(e) => {
                        let err_msg = e.to_string();
                        self.events.push(AgentExecutionEvent::new(
                            &self.run_id,
                            AgentEventType::ToolResult,
                            Some(step_id.clone()),
                            json!({ "tool": tool_str, "success": false, "error": err_msg }),
                        ));

                        if let Some(s) = self.plan.get_step_mut(&step_id) {
                            if self.config.auto_retry_errors
                                && s.retry_count < self.config.max_retries_per_step
                            {
                                s.retry_count += 1;
                                s.status = PlanStepStatus::Pending; // Retry on next loop iteration
                            } else {
                                s.mark_failed(err_msg.clone());
                                self.events.push(AgentExecutionEvent::new(
                                    &self.run_id,
                                    AgentEventType::StepFailed,
                                    Some(step_id.clone()),
                                    json!({ "stepId": step_id, "error": err_msg }),
                                ));
                            }
                        }
                    }
                }
            } else {
                // Synthesis or internal reasoning step without external tool
                if let Some(s) = self.plan.get_step_mut(&step_id) {
                    s.mark_completed(json!({ "synthesized": true }));
                    self.events.push(AgentExecutionEvent::new(
                        &self.run_id,
                        AgentEventType::StepCompleted,
                        Some(step_id.clone()),
                        json!({ "stepId": step_id, "mode": "reasoning" }),
                    ));
                }
            }
        }

        // Check if all terminal after this step
        if self.plan.is_all_terminal() {
            if self.plan.is_successful() {
                self.status = AgentExecutionStatus::Completed;
                self.events.push(AgentExecutionEvent::new(
                    &self.run_id,
                    AgentEventType::RunCompleted,
                    None,
                    json!({ "completedSteps": self.plan.steps.len() }),
                ));
            } else {
                self.status = AgentExecutionStatus::Failed;
                self.events.push(AgentExecutionEvent::new(
                    &self.run_id,
                    AgentEventType::RunFailed,
                    None,
                    json!({ "reason": "step_failure" }),
                ));
            }
            return Ok(false);
        }

        Ok(true)
    }

    /// Run loop continuously until completion, pause, approval gate, or cancellation.
    pub fn run<E: AgentToolExecutor>(
        &mut self,
        executor: &mut E,
    ) -> Result<AgentExecutionSummary, CoreError> {
        let mut iteration = 0;

        while iteration < self.config.max_iterations {
            iteration += 1;

            let more_work = self.step(executor)?;
            if !more_work {
                break;
            }
        }

        if iteration >= self.config.max_iterations && !self.plan.is_all_terminal() {
            self.status = AgentExecutionStatus::Failed;
            self.events.push(AgentExecutionEvent::new(
                &self.run_id,
                AgentEventType::RunFailed,
                None,
                json!({ "reason": "max_iterations_exceeded", "limit": self.config.max_iterations }),
            ));
        }

        let completed_count = self
            .plan
            .steps
            .iter()
            .filter(|s| s.status == PlanStepStatus::Completed)
            .count();

        Ok(AgentExecutionSummary {
            run_id: self.run_id.clone(),
            status: self.status,
            goal: self.plan.goal.clone(),
            completed_steps: completed_count,
            total_steps: self.plan.steps.len(),
            final_result: self
                .plan
                .steps
                .last()
                .and_then(|s| s.output.clone()),
            error: self
                .plan
                .steps
                .iter()
                .find_map(|s| s.error.clone()),
            events_count: self.events.len(),
        })
    }

    /// Persist execution state, plan DAG, status, and tool calls into SQLite (`agent_runs`).
    pub fn persist_to_db(&self, db: &Db) -> Result<(), CoreError> {
        let conn = db.writer();
        let plan_json = serde_json::to_string(&self.plan)
            .map_err(|e| CoreError::internal(format!("serialize plan: {e}")))?;
        let tool_calls_json = serde_json::to_string(&self.tool_calls)
            .map_err(|e| CoreError::internal(format!("serialize tool_calls: {e}")))?;
        let summary = format!(
            "goal: {} | steps: {}/{} | status: {}",
            self.plan.goal,
            self.plan
                .steps
                .iter()
                .filter(|s| s.status == PlanStepStatus::Completed)
                .count(),
            self.plan.steps.len(),
            self.status.as_str()
        );
        let now_iso = Utc::now().to_rfc3339();

        let db_status = match self.status {
            AgentExecutionStatus::Planned => "planned",
            AgentExecutionStatus::Running => "running",
            AgentExecutionStatus::Paused => "blocked",
            AgentExecutionStatus::AwaitingApproval => "awaiting_approval",
            AgentExecutionStatus::Completed => "completed",
            AgentExecutionStatus::Failed => "failed",
            AgentExecutionStatus::Cancelled => "failed",
        };

        conn.execute(
            "INSERT INTO agent_runs (id, session_id, agent_role, goal, plan_json, status, result_summary, tool_calls_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET
               plan_json = excluded.plan_json,
               status = excluded.status,
               result_summary = excluded.result_summary,
               tool_calls_json = excluded.tool_calls_json,
               updated_at = excluded.updated_at",
            params![
                self.run_id,
                self.session_id,
                self.agent_role,
                self.plan.goal,
                plan_json,
                db_status,
                summary,
                tool_calls_json,
                now_iso
            ],
        )
        .map_err(|e| CoreError::internal(format!("persist agent_run: {e}")))?;

        Ok(())
    }

    /// Restore an `AgentLoop` from an existing run in SQLite (`agent_runs`).
    pub fn restore_from_db(db: &Db, run_id: &str) -> Result<Self, CoreError> {
        let conn = db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, agent_role, goal, plan_json, status, tool_calls_json
                 FROM agent_runs
                 WHERE id = ?1",
            )
            .map_err(|e| CoreError::internal(format!("restore_from_db prepare: {e}")))?;

        let row = stmt
            .query_row(params![run_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(|e| CoreError::not_found("agent_run", format!("{run_id}: {e}")))?;

        let (id, session_id, agent_role, goal, plan_raw, status_raw, tool_calls_raw) = row;

        let plan: ExecutionPlan = serde_json::from_str::<ExecutionPlan>(&plan_raw).unwrap_or_else(|_| {
            if let Ok(legacy_steps) = serde_json::from_str::<Vec<AgentPlanStep>>(&plan_raw) {
                let mut built = ExecutionPlan::new(&id, &goal);
                let mut prev_id: Option<String> = None;
                for s in legacy_steps {
                    let sid = format!("step-{}", s.step);
                    let mut step = PlanStep::new(
                        sid.clone(),
                        s.step,
                        s.action,
                        s.agent_role,
                        Some(s.tool_name),
                        json!({ "goal": goal, "sessionId": session_id }),
                    );
                    step.requires_approval = s.requires_approval;
                    if let Some(prev) = prev_id {
                        step.dependencies.push(prev);
                    }
                    prev_id = Some(sid);
                    built.add_step(step);
                }
                built
            } else {
                ExecutionPlan::new(&id, &goal)
            }
        });

        let tool_calls: Vec<Value> =
            serde_json::from_str(&tool_calls_raw).unwrap_or_default();

        let status = match status_raw.as_str() {
            "planned" => AgentExecutionStatus::Planned,
            "running" => AgentExecutionStatus::Running,
            "paused" | "blocked" => AgentExecutionStatus::Paused,
            "awaiting_approval" => AgentExecutionStatus::AwaitingApproval,
            "completed" => AgentExecutionStatus::Completed,
            "cancelled" => AgentExecutionStatus::Cancelled,
            _ => AgentExecutionStatus::Failed,
        };

        Ok(Self {
            run_id: id,
            session_id,
            agent_role,
            plan,
            status,
            config: AgentLoopConfig::default(),
            events: Vec::new(),
            tool_calls,
            cancellation: CancellationHandle::new(),
        })
    }
}
