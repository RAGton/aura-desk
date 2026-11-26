//! Agent Runtime domain models and execution primitives (Issue #22).
//!
//! Provides the core abstractions for autonomous agent execution:
//! serializable plans, dependency-tracked steps, stateful loops,
//! cancellation tokens, structured events, and evaluation metrics.

#![allow(missing_docs)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Status of an individual step in an execution plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepStatus {
    /// Step waiting for prerequisites or scheduled turn.
    Pending,
    /// Currently in execution.
    Running,
    /// Successfully finished with output.
    Completed,
    /// Failed execution with an error.
    Failed,
    /// Blocked by missing dependency, permission, or rejected proposal.
    Blocked,
    /// Awaiting interactive user approval (*Propose -> Approve*).
    AwaitingApproval,
    /// Skipped due to plan optimization or failed prerequisite.
    Skipped,
}

impl PlanStepStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Blocked | Self::Skipped
        )
    }

    pub fn is_successful(&self) -> bool {
        matches!(self, Self::Completed | Self::Skipped)
    }
}

/// An individual, executable step inside an `ExecutionPlan`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    /// Unique identifier for the step (e.g., "step-1", "step-2").
    pub id: String,
    /// Step sequence index (1-based).
    pub order: usize,
    /// Human-readable explanation of what this step achieves.
    pub title: String,
    /// Agent role assigned to execute this step (e.g. "orchestrator", "coder", "researcher").
    pub agent_role: String,
    /// Tool name to invoke, if this step calls a tool.
    pub tool_name: Option<String>,
    /// Tool input arguments object.
    pub tool_args: Value,
    /// List of step IDs that must be completed before this step can run.
    pub dependencies: Vec<String>,
    /// Current execution status.
    pub status: PlanStepStatus,
    /// Result payload produced by the step.
    pub output: Option<Value>,
    /// Error message if step failed.
    pub error: Option<String>,
    /// Retry attempt counter.
    pub retry_count: usize,
    /// Whether this step requires explicit user approval before execution.
    pub requires_approval: bool,
    /// ISO timestamp when execution started.
    pub started_at: Option<String>,
    /// ISO timestamp when execution completed or failed.
    pub completed_at: Option<String>,
}

impl PlanStep {
    /// Create a new pending step.
    pub fn new(
        id: impl Into<String>,
        order: usize,
        title: impl Into<String>,
        agent_role: impl Into<String>,
        tool_name: Option<String>,
        tool_args: Value,
    ) -> Self {
        Self {
            id: id.into(),
            order,
            title: title.into(),
            agent_role: agent_role.into(),
            tool_name,
            tool_args,
            dependencies: Vec::new(),
            status: PlanStepStatus::Pending,
            output: None,
            error: None,
            retry_count: 0,
            requires_approval: false,
            started_at: None,
            completed_at: None,
        }
    }

    /// Mark step as running.
    pub fn mark_running(&mut self) {
        self.status = PlanStepStatus::Running;
        self.started_at = Some(Utc::now().to_rfc3339());
    }

    /// Mark step as successfully completed.
    pub fn mark_completed(&mut self, output: Value) {
        self.status = PlanStepStatus::Completed;
        self.output = Some(output);
        self.error = None;
        self.completed_at = Some(Utc::now().to_rfc3339());
    }

    /// Mark step as failed.
    pub fn mark_failed(&mut self, err: impl Into<String>) {
        self.status = PlanStepStatus::Failed;
        self.error = Some(err.into());
        self.completed_at = Some(Utc::now().to_rfc3339());
    }
}

/// A complete, serializable execution plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    /// Unique plan ID.
    pub id: String,
    /// High-level goal provided by user.
    pub goal: String,
    /// Context summary summarizing intent and constraints.
    pub context_summary: String,
    /// Ordered steps forming the plan DAG.
    pub steps: Vec<PlanStep>,
    /// Created timestamp in ISO 8601.
    pub created_at: String,
    /// Updated timestamp in ISO 8601.
    pub updated_at: String,
}

impl ExecutionPlan {
    /// Create a new plan with a given goal.
    pub fn new(id: impl Into<String>, goal: impl Into<String>) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: id.into(),
            goal: goal.into(),
            context_summary: String::new(),
            steps: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        }
    }

    /// Add a step to the plan.
    pub fn add_step(&mut self, step: PlanStep) {
        self.steps.push(step);
        self.updated_at = Utc::now().to_rfc3339();
    }

    /// Check if all steps in the plan are in a terminal state.
    pub fn is_all_terminal(&self) -> bool {
        self.steps.iter().all(|s| s.status.is_terminal())
    }

    /// Check if all steps completed successfully.
    pub fn is_successful(&self) -> bool {
        !self.steps.is_empty() && self.steps.iter().all(|s| s.status.is_successful())
    }

    /// Retrieve step by id.
    pub fn get_step(&self, id: &str) -> Option<&PlanStep> {
        self.steps.iter().find(|s| s.id == id)
    }

    /// Retrieve mutable step by id.
    pub fn get_step_mut(&mut self, id: &str) -> Option<&mut PlanStep> {
        self.steps.iter_mut().find(|s| s.id == id)
    }

    /// Find all steps that are currently runnable (Pending, with all dependencies Completed).
    pub fn find_runnable_steps(&self) -> Vec<String> {
        let mut runnable = Vec::new();
        for step in &self.steps {
            if step.status != PlanStepStatus::Pending {
                continue;
            }

            let deps_satisfied = step.dependencies.iter().all(|dep_id| {
                self.steps
                    .iter()
                    .any(|s| s.id == *dep_id && s.status == PlanStepStatus::Completed)
            });

            if deps_satisfied {
                runnable.push(step.id.clone());
            }
        }
        runnable
    }
}

/// Overall execution status of an agent run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionStatus {
    /// Initial plan formulated.
    Planned,
    /// Loop is actively executing steps.
    Running,
    /// Paused for later resumption.
    Paused,
    /// Blocked awaiting interactive user approval.
    AwaitingApproval,
    /// Successfully finished all steps.
    Completed,
    /// Finished with unrecoverable failure.
    Failed,
    /// Stopped mid-flight via cancellation token.
    Cancelled,
}

impl AgentExecutionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Structured event types emitted during agent execution (telemetry for Control Center).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventType {
    RunStarted,
    PlanCreated,
    StepStarted,
    ToolInvoked,
    ToolResult,
    StepCompleted,
    StepFailed,
    AwaitingApproval,
    Resumed,
    Cancelled,
    RunCompleted,
    RunFailed,
}

/// Structured telemetry event emitted by the `AgentLoop`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionEvent {
    pub id: String,
    pub run_id: String,
    pub event_type: AgentEventType,
    pub step_id: Option<String>,
    pub payload: Value,
    pub timestamp: String,
}

impl AgentExecutionEvent {
    pub fn new(
        run_id: impl Into<String>,
        event_type: AgentEventType,
        step_id: Option<String>,
        payload: Value,
    ) -> Self {
        Self {
            id: format!("evt-{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)),
            run_id: run_id.into(),
            event_type,
            step_id,
            payload,
            timestamp: Utc::now().to_rfc3339(),
        }
    }
}

/// Runtime configuration for the `AgentLoop`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoopConfig {
    /// Maximum iterations permitted before halting loop. Default: 10.
    pub max_iterations: usize,
    /// Timeout per step in milliseconds. Default: 30_000 (30s).
    pub timeout_per_step_ms: u64,
    /// Automatically retry recoverable tool errors. Default: true.
    pub auto_retry_errors: bool,
    /// Maximum retries per step. Default: 2.
    pub max_retries_per_step: usize,
    /// Enforce proposal gating for mutation tools. Default: true.
    pub require_approval_for_mutations: bool,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 10,
            timeout_per_step_ms: 30_000,
            auto_retry_errors: true,
            max_retries_per_step: 2,
            require_approval_for_mutations: true,
        }
    }
}

/// Thread-safe cancellation token used to stop an executing agent loop immediately.
#[derive(Debug, Clone, Default)]
pub struct CancellationHandle {
    cancelled: Arc<AtomicBool>,
}

impl CancellationHandle {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Signal cancellation to the running agent loop.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    /// Check whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// Access the underlying atomic bool.
    pub fn token(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}

/// High-level summary returned upon completion of an agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionSummary {
    pub run_id: String,
    pub status: AgentExecutionStatus,
    pub goal: String,
    pub completed_steps: usize,
    pub total_steps: usize,
    pub final_result: Option<Value>,
    pub error: Option<String>,
    pub events_count: usize,
}
