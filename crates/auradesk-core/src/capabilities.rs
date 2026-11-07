//! Capability registry: single source of truth for the 19 tools exposed to
//! Tauri IPC and the MCP dispatcher (spec §8.2 & §8.5).

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::application::daily_plans::DailyPlansService;
use crate::application::kanban::KanbanService;
use crate::application::metrics::MetricsService;
use crate::application::pomodoros::PomodorosService;
use crate::application::projects::ProjectsService;
use crate::application::proposals::{sha256_hex, ProposalStatus, ProposalsService};
use crate::application::reminders::RemindersService;
use crate::application::tasks::TasksService;
use crate::domain::daily_plan::PlanState;
use crate::domain::reminder::{NewReminder, ReminderSound, RepeatKind};
use crate::domain::task::{NewTask, TaskFilter, TaskPriority, TaskStatus, UpdateTask};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Where a capability is callable from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityKind {
    /// Callable from the Tauri desktop UI only.
    Tauri,
    /// Callable via MCP (Hermes) only. Used for `propose_*` tools.
    Mcp,
    /// Callable from either surface.
    Both,
}

/// One tool exposed by the application. Listed by `capabilities()` and
/// consumed by both the Tauri IPC dispatcher and the MCP server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capability {
    /// Stable identifier used as the tool name in IPC and MCP calls.
    pub name: &'static str,
    /// Short human-readable summary shown to clients.
    pub description: &'static str,
    /// Whether this capability is reachable from the Tauri UI, MCP, or both.
    pub kind: CapabilityKind,
    /// JSON Schema (Draft 2020-12) describing the accepted input object.
    pub input_schema: Value,
    /// JSON Schema (Draft 2020-12) describing the returned output object.
    pub output_schema: Value,
}

/// Implemented by every capability.
pub trait CapabilityHandler: Send + Sync {
    /// Execute the capability with the given input and return the output.
    fn invoke(&self, input: Value) -> Result<Value, CoreError>;
}

fn task_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "id":             { "type": "string" },
            "project_id":     { "type": ["string", "null"] },
            "parent_task_id": { "type": ["string", "null"] },
            "recurrence_id":  { "type": ["string", "null"] },
            "title":          { "type": "string" },
            "description":    { "type": ["string", "null"] },
            "priority":       { "type": "string", "enum": ["low", "normal", "high", "urgent"] },
            "status":         { "type": "string", "enum": ["todo", "doing", "waiting", "done", "cancelled"] },
            "kanban_order":   { "type": "integer" },
            "due_at":         { "type": ["string", "null"], "format": "date-time" },
            "started_at":     { "type": ["string", "null"], "format": "date-time" },
            "completed_at":   { "type": ["string", "null"], "format": "date-time" },
            "estimate_min":   { "type": ["integer", "null"] },
            "actual_min":     { "type": ["integer", "null"] },
            "tags":           { "type": ["array", "null"], "items": { "type": "string" } },
            "created_at":     { "type": "string", "format": "date-time" },
            "updated_at":     { "type": "string", "format": "date-time" }
        },
        "required": ["id", "title", "status", "priority", "created_at", "updated_at"]
    })
}

fn project_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "id":          { "type": "string" },
            "name":        { "type": "string" },
            "description": { "type": ["string", "null"] },
            "color":       { "type": ["string", "null"] },
            "parent_id":   { "type": ["string", "null"] },
            "status":      { "type": "string", "enum": ["active", "paused", "completed", "archived"] },
            "start_date":  { "type": ["string", "null"], "format": "date" },
            "target_date": { "type": ["string", "null"], "format": "date" },
            "created_at":  { "type": "string", "format": "date-time" },
            "updated_at":  { "type": "string", "format": "date-time" }
        },
        "required": ["id", "name", "status", "created_at", "updated_at"]
    })
}

fn reminder_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "id":              { "type": "string" },
            "task_id":         { "type": ["string", "null"] },
            "title":           { "type": "string" },
            "body":            { "type": ["string", "null"] },
            "fire_at":         { "type": "string", "format": "date-time" },
            "repeat_kind":     { "enum": ["none", "daily", "weekly", "monthly", "cron", null] },
            "sound":           { "enum": ["default", "chime", "info", "normal", "urgent", "none", null] },
            "status":          { "type": "string", "enum": ["pending", "fired", "resolved", "dismissed", "snoozed", "excepted"] },
            "snooze_count":    { "type": "integer" },
            "last_snoozed_at": { "type": ["string", "null"], "format": "date-time" },
            "resolved_at":     { "type": ["string", "null"], "format": "date-time" },
            "created_at":      { "type": "string", "format": "date-time" },
            "updated_at":      { "type": "string", "format": "date-time" }
        },
        "required": ["id", "title", "fire_at", "status", "created_at", "updated_at"]
    })
}

fn proposal_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "id":            { "type": "string" },
            "source":        { "type": "string", "enum": ["mcp", "ui"] },
            "kind":          { "type": "string", "enum": ["create_task", "update_task", "delete_task", "create_reminder", "propose_subtasks", "bulk_plan"] },
            "payload":       { "type": "object", "additionalProperties": true },
            "summary":       { "type": "string" },
            "status":        { "type": "string", "enum": ["pending", "approved", "rejected", "modified", "expired"] },
            "created_at":    { "type": "string", "format": "date-time" },
            "expires_at":    { "type": "string", "format": "date-time" },
            "decided_at":    { "type": ["string", "null"], "format": "date-time" },
            "decision_note": { "type": ["string", "null"] },
            "result_ref_id": { "type": ["string", "null"] },
            "decided_by":    { "enum": ["user", "auto", null] }
        },
        "required": ["id", "kind", "payload", "summary", "status", "created_at", "expires_at"]
    })
}

fn proposal_summary_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "proposal_id": { "type": "string" },
            "summary":     { "type": "string" },
            "kind":        { "type": "string", "enum": ["create_task", "update_task", "delete_task", "create_reminder", "propose_subtasks", "bulk_plan"] },
            "preview":     { "type": "object", "additionalProperties": true }
        },
        "required": ["proposal_id", "summary", "kind"]
    })
}

fn build_capabilities() -> Vec<Capability> {
    let task = task_schema();
    let project = project_schema();
    let reminder = reminder_schema();
    let proposal = proposal_schema();
    let proposal_summary = proposal_summary_schema();

    // Must be strictly in alphabetical order by `name`.
    vec![
        // 1. approve_proposal
        Capability {
            name: "approve_proposal",
            description: "Approve a pending proposal. Re-validates the payload against the current schema and the stored payload_hash.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id":            { "type": "string", "minLength": 1 },
                    "modifications": { "type": "object", "additionalProperties": true },
                    "note":          { "type": "string" }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "proposal":      proposal,
                    "result_ref_id": { "type": ["string", "null"] },
                    "result_kind":   { "type": "string", "enum": ["task", "reminder", "subtask_group", "plan", "none"] }
                },
                "required": ["proposal", "result_kind"]
            }),
        },
        // 2. get_kanban_board
        Capability {
            name: "get_kanban_board",
            description: "Return all kanban columns (todo, doing, waiting, done) with their ordered tasks.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "columns": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "column": { "type": "string", "enum": ["todo", "doing", "waiting", "done"] },
                                "tasks":  { "type": "array", "items": task }
                            },
                            "required": ["column", "tasks"]
                        }
                    },
                    "updated_at": { "type": "string", "format": "date-time" }
                },
                "required": ["columns", "updated_at"]
            }),
        },
        // 3. get_project
        Capability {
            name: "get_project",
            description: "Fetch one project by id.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id": { "type": "string", "minLength": 1 }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: project.clone(),
        },
        // 4. get_proposal
        Capability {
            name: "get_proposal",
            description: "Fetch one proposal by id.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id": { "type": "string", "minLength": 1 }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: proposal_schema(),
        },
        // 5. get_task
        Capability {
            name: "get_task",
            description: "Fetch one task by id.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id": { "type": "string", "minLength": 1 }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: task.clone(),
        },
        // 6. get_today_plan
        Capability {
            name: "get_today_plan",
            description: "Fetch today's daily plan. Returns null if no plan exists yet.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "oneOf": [
                    { "type": "null" },
                    {
                        "type": "object",
                        "properties": {
                            "id":           { "type": "string" },
                            "plan_date":    { "type": "string", "format": "date" },
                            "state":        { "type": "string", "enum": ["not_started", "in_progress", "completed", "skipped"] },
                            "started_at":   { "type": ["string", "null"], "format": "date-time" },
                            "completed_at": { "type": ["string", "null"], "format": "date-time" },
                            "payload":      { "type": ["object", "null"], "additionalProperties": true }
                        },
                        "required": ["id", "plan_date", "state"]
                    }
                ]
            }),
        },
        // 7. list_pending_proposals
        Capability {
            name: "list_pending_proposals",
            description: "List IA proposals still awaiting user decision.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": 50 }
                },
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "array",
                "items": proposal_schema()
            }),
        },
        // 8. list_projects
        Capability {
            name: "list_projects",
            description: "List all projects (optionally including archived).",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "include_archived": { "type": "boolean", "default": false }
                },
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "array",
                "items": project
            }),
        },
        // 9. list_reminders
        Capability {
            name: "list_reminders",
            description: "List reminders, optionally filtered.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "status": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["pending", "fired", "resolved", "dismissed", "snoozed", "excepted"] }
                    },
                    "task_id":     { "type": "string" },
                    "fire_before": { "type": "string", "format": "date-time" },
                    "limit":       { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 }
                },
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "array",
                "items": reminder
            }),
        },
        // 10. list_tasks
        Capability {
            name: "list_tasks",
            description: "List tasks, optionally filtered.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "status": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["todo", "doing", "waiting", "done", "cancelled"] }
                    },
                    "project_id":   { "type": "string" },
                    "overdue_only": { "type": "boolean" },
                    "due_before":   { "type": "string", "format": "date-time" },
                    "tags":         { "type": "array", "items": { "type": "string" } },
                    "limit":        { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 },
                    "offset":       { "type": "integer", "minimum": 0, "default": 0 }
                },
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "array",
                "items": task_schema()
            }),
        },
        // 11. pomodoro_status
        Capability {
            name: "pomodoro_status",
            description: "Return the currently running pomodoro session, or null if idle.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "oneOf": [
                    { "type": "null" },
                    {
                        "type": "object",
                        "properties": {
                            "id":          { "type": "string" },
                            "task_id":     { "type": ["string", "null"] },
                            "kind":        { "type": "string", "enum": ["focus", "short_break", "long_break"] },
                            "planned_min": { "type": "integer" },
                            "started_at":  { "type": "string", "format": "date-time" },
                            "cycle_index": { "type": ["integer", "null"] },
                            "cycle_count": { "type": ["integer", "null"] }
                        },
                        "required": ["id", "kind", "planned_min", "started_at"]
                    }
                ]
            }),
        },
        // 12. propose_bulk_plan
        Capability {
            name: "propose_bulk_plan",
            description: "Propose the day's plan as a set of tasks (some may be existing, some new).",
            kind: CapabilityKind::Mcp,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "entries": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 30,
                        "items": {
                            "type": "object",
                            "properties": {
                                "kind":         { "type": "string", "enum": ["existing", "new"] },
                                "task_id":      { "type": "string" },
                                "new_task":     { "type": "object" },
                                "order":        { "type": "integer", "minimum": 0 },
                                "estimate_min": { "type": "integer", "minimum": 1, "maximum": 10000 }
                            },
                            "required": ["kind", "order"],
                            "additionalProperties": false
                        }
                    },
                    "notes": { "type": "string" }
                },
                "required": ["entries"],
                "additionalProperties": false
            }),
            output_schema: proposal_summary.clone(),
        },
        // 13. propose_create_reminder
        Capability {
            name: "propose_create_reminder",
            description: "Propose a new reminder. Optionally link to an existing task.",
            kind: CapabilityKind::Mcp,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "title":          { "type": "string", "minLength": 1, "maxLength": 500 },
                    "body":           { "type": "string" },
                    "fire_at":        { "type": "string", "format": "date-time" },
                    "task_id":        { "type": "string" },
                    "monitor_target": { "type": "string", "enum": ["primary", "secondary", "preferred"] },
                    "sound":          { "type": "string", "enum": ["info", "normal", "urgent", "none"] },
                    "repeat": {
                        "type": "object",
                        "properties": {
                            "kind":  { "type": "string", "enum": ["none", "daily", "weekly", "monthly", "cron"] },
                            "value": { "type": "string" }
                        },
                        "required": ["kind"],
                        "additionalProperties": false
                    }
                },
                "required": ["title", "fire_at"],
                "additionalProperties": false
            }),
            output_schema: proposal_summary.clone(),
        },
        // 14. propose_create_task
        Capability {
            name: "propose_create_task",
            description: "Propose creating a new task. Does NOT create the task; the user must approve.",
            kind: CapabilityKind::Mcp,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "title":          { "type": "string", "minLength": 1, "maxLength": 500 },
                    "description":    { "type": "string", "maxLength": 5000 },
                    "project_id":     { "type": "string" },
                    "parent_task_id": { "type": "string" },
                    "priority":       { "type": "string", "enum": ["low", "normal", "high", "urgent"] },
                    "due_at":         { "type": "string", "format": "date-time" },
                    "estimate_min":   { "type": "integer", "minimum": 1, "maximum": 10000 },
                    "tags":           { "type": "array", "items": { "type": "string", "minLength": 1 }, "maxItems": 20 }
                },
                "required": ["title"],
                "additionalProperties": false
            }),
            output_schema: proposal_summary.clone(),
        },
        // 15. propose_delete_task
        Capability {
            name: "propose_delete_task",
            description: "Propose deleting a task.",
            kind: CapabilityKind::Mcp,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id": { "type": "string", "minLength": 1 }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: proposal_summary.clone(),
        },
        // 16. propose_subtasks
        Capability {
            name: "propose_subtasks",
            description: "Propose splitting a task into N subtasks.",
            kind: CapabilityKind::Mcp,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "parent_task_id": { "type": "string", "minLength": 1 },
                    "subtasks": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 20,
                        "items": {
                            "type": "object",
                            "properties": {
                                "title":        { "type": "string", "minLength": 1, "maxLength": 500 },
                                "estimate_min": { "type": "integer", "minimum": 1, "maximum": 10000 },
                                "priority":     { "type": "string", "enum": ["low", "normal", "high", "urgent"] }
                            },
                            "required": ["title"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["parent_task_id", "subtasks"],
                "additionalProperties": false
            }),
            output_schema: proposal_summary.clone(),
        },
        // 17. propose_update_task
        Capability {
            name: "propose_update_task",
            description: "Propose updating an existing task (any subset of fields).",
            kind: CapabilityKind::Mcp,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id":           { "type": "string", "minLength": 1 },
                    "title":        { "type": "string", "minLength": 1, "maxLength": 500 },
                    "description":  { "type": ["string", "null"], "maxLength": 5000 },
                    "project_id":   { "type": ["string", "null"] },
                    "priority":     { "type": "string", "enum": ["low", "normal", "high", "urgent"] },
                    "due_at":       { "type": ["string", "null"], "format": "date-time" },
                    "estimate_min": { "type": ["integer", "null"], "minimum": 1, "maximum": 10000 },
                    "tags":         { "type": ["array", "null"], "items": { "type": "string", "minLength": 1 } }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: proposal_summary,
        },
        // 18. reject_proposal
        Capability {
            name: "reject_proposal",
            description: "Reject a pending proposal. Does not affect the destination table.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "id":   { "type": "string", "minLength": 1 },
                    "note": { "type": "string" }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            output_schema: proposal_schema(),
        },
        // 19. today_overview
        Capability {
            name: "today_overview",
            description: "Lightweight daily context for the IA.",
            kind: CapabilityKind::Both,
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            output_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "date":                 { "type": "string", "format": "date" },
                    "overdue_tasks":        { "type": "array", "items": task_schema() },
                    "due_today":            { "type": "array", "items": task_schema() },
                    "in_progress":          { "type": "array", "items": task_schema() },
                    "pomodoro_active":      { "type": ["object", "null"] },
                    "today_plan_state":     { "type": "string", "enum": ["none", "not_started", "in_progress", "completed", "skipped"] },
                    "recent_notifications": { "type": "array", "items": { "type": "object" } },
                    "metrics_today": {
                        "type": "object",
                        "properties": {
                            "focus_minutes": { "type": "integer" },
                            "break_minutes": { "type": "integer" },
                            "water_count":   { "type": "integer" },
                            "tasks_done":    { "type": "integer" },
                            "tasks_created": { "type": "integer" }
                        },
                        "required": ["focus_minutes", "break_minutes", "water_count", "tasks_done", "tasks_created"]
                    }
                },
                "required": ["date", "due_today", "in_progress", "today_plan_state", "metrics_today"]
            }),
        },
    ]
}

lazy_static::lazy_static! {
    static ref CAPABILITIES: Vec<Capability> = build_capabilities();
}

/// Returns the static slice of all 19 capabilities in alphabetical order.
pub fn capabilities() -> &'static [Capability] {
    &CAPABILITIES
}

/// Look up a capability definition by exact tool name in `O(log N)` via binary search
/// over the alphabetically sorted `CAPABILITIES` table.
pub fn find_capability(name: &str) -> Option<&'static Capability> {
    CAPABILITIES
        .binary_search_by_key(&name, |c| c.name)
        .ok()
        .map(|idx| &CAPABILITIES[idx])
}

/// Validate a JSON value against a Draft 2020-12 JSON Schema subset used by AuraDesk.
pub fn validate_against_schema(schema: &Value, value: &Value) -> Result<(), CoreError> {
    validate_node(schema, value, "$")
}

fn validate_node(schema: &Value, value: &Value, path: &str) -> Result<(), CoreError> {
    let Some(schema_obj) = schema.as_object() else {
        return Ok(());
    };

    if let Some(one_of) = schema_obj.get("oneOf").and_then(|v| v.as_array()) {
        let mut matched = false;
        for branch in one_of {
            if validate_node(branch, value, path).is_ok() {
                matched = true;
                break;
            }
        }
        if !matched {
            return Err(CoreError::validation(
                path,
                "value did not match any branch in oneOf",
            ));
        }
        return Ok(());
    }

    if let Some(enum_vals) = schema_obj.get("enum").and_then(|v| v.as_array()) {
        if !enum_vals.iter().any(|ev| ev == value) {
            return Err(CoreError::validation(
                path,
                format!("value {value} not in allowed enum {enum_vals:?}"),
            ));
        }
    }

    if let Some(type_spec) = schema_obj.get("type") {
        let allowed_types: Vec<&str> = match type_spec {
            Value::String(s) => vec![s.as_str()],
            Value::Array(arr) => arr.iter().filter_map(|x| x.as_str()).collect(),
            _ => Vec::new(),
        };
        if !allowed_types.is_empty() && !matches_any_json_type(value, &allowed_types) {
            return Err(CoreError::validation(
                path,
                format!("expected type {allowed_types:?}, got {value}"),
            ));
        }
    }

    match value {
        Value::String(s) => {
            let char_count = s.chars().count();
            if let Some(min_len) = schema_obj.get("minLength").and_then(|v| v.as_u64()) {
                if (char_count as u64) < min_len {
                    return Err(CoreError::validation(
                        path,
                        format!("string shorter than minLength {min_len}"),
                    ));
                }
            }
            if let Some(max_len) = schema_obj.get("maxLength").and_then(|v| v.as_u64()) {
                if (char_count as u64) > max_len {
                    return Err(CoreError::validation(
                        path,
                        format!("string longer than maxLength {max_len}"),
                    ));
                }
            }
            if let Some(fmt) = schema_obj.get("format").and_then(|v| v.as_str()) {
                match fmt {
                    "date-time" if DateTime::parse_from_rfc3339(s).is_err() => {
                        return Err(CoreError::validation(
                            path,
                            format!("invalid date-time RFC3339 string: {s}"),
                        ));
                    }
                    "date" if chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_err() => {
                        return Err(CoreError::validation(
                            path,
                            format!("invalid YYYY-MM-DD date string: {s}"),
                        ));
                    }
                    _ => {}
                }
            }
        }
        Value::Number(n) => {
            if let Some(val_i) = n.as_i64() {
                if let Some(min) = schema_obj.get("minimum").and_then(|v| v.as_i64()) {
                    if val_i < min {
                        return Err(CoreError::validation(
                            path,
                            format!("value {val_i} < minimum {min}"),
                        ));
                    }
                }
                if let Some(max) = schema_obj.get("maximum").and_then(|v| v.as_i64()) {
                    if val_i > max {
                        return Err(CoreError::validation(
                            path,
                            format!("value {val_i} > maximum {max}"),
                        ));
                    }
                }
            }
        }
        Value::Array(arr) => {
            if let Some(min_items) = schema_obj.get("minItems").and_then(|v| v.as_u64()) {
                if (arr.len() as u64) < min_items {
                    return Err(CoreError::validation(
                        path,
                        format!("array length {} < minItems {min_items}", arr.len()),
                    ));
                }
            }
            if let Some(max_items) = schema_obj.get("maxItems").and_then(|v| v.as_u64()) {
                if (arr.len() as u64) > max_items {
                    return Err(CoreError::validation(
                        path,
                        format!("array length {} > maxItems {max_items}", arr.len()),
                    ));
                }
            }
            if let Some(item_schema) = schema_obj.get("items") {
                for (idx, item) in arr.iter().enumerate() {
                    validate_node(item_schema, item, &format!("{path}[{idx}]"))?;
                }
            }
        }
        Value::Object(map) => {
            if let Some(req) = schema_obj.get("required").and_then(|v| v.as_array()) {
                for r in req.iter().filter_map(|x| x.as_str()) {
                    if !map.contains_key(r) {
                        return Err(CoreError::validation(
                            format!("{path}.{r}"),
                            format!("missing required field '{r}'"),
                        ));
                    }
                }
            }
            let props = schema_obj.get("properties").and_then(|v| v.as_object());
            let disallow_additional = schema_obj
                .get("additionalProperties")
                .and_then(|v| v.as_bool())
                == Some(false);

            for (k, v) in map {
                if let Some(p_map) = props {
                    if let Some(prop_schema) = p_map.get(k) {
                        validate_node(prop_schema, v, &format!("{path}.{k}"))?;
                        continue;
                    }
                }
                if disallow_additional {
                    return Err(CoreError::validation(
                        format!("{path}.{k}"),
                        format!("unknown additional property '{k}'"),
                    ));
                }
            }
        }
        _ => {}
    }

    Ok(())
}

fn matches_any_json_type(val: &Value, allowed: &[&str]) -> bool {
    allowed.iter().any(|t| match *t {
        "null" => val.is_null(),
        "boolean" => val.is_boolean(),
        "integer" => val.is_i64() || val.is_u64(),
        "number" => val.is_number(),
        "string" => val.is_string(),
        "array" => val.is_array(),
        "object" => val.is_object(),
        _ => false,
    })
}

/// Dispatch a capability by name against the given `Db`, validating both input and output schemas.
pub fn dispatch_capability(db: &Db, name: &str, input: Value) -> Result<Value, CoreError> {
    let cap = find_capability(name).ok_or_else(|| CoreError::not_found("tool", name))?;
    let normalized_input = if input.is_null() { json!({}) } else { input };

    validate_against_schema(&cap.input_schema, &normalized_input)?;

    let out = match name {
        "get_task" => {
            let id = req_str(&normalized_input, "id")?;
            let task = TasksService::new(db).get(id)?;
            serde_json::to_value(task).map_err(|e| CoreError::internal(e.to_string()))?
        }
        "list_tasks" => {
            let project_id = normalized_input
                .get("project_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let status_filter: Option<std::collections::HashSet<&str>> = normalized_input
                .get("status")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str()).collect());
            let overdue_only = normalized_input
                .get("overdue_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let due_before = normalized_input
                .get("due_before")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            let tags_filter: Option<Vec<&str>> = normalized_input
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str()).collect());
            let limit = normalized_input
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(100) as usize;
            let offset = normalized_input
                .get("offset")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            let now = Utc::now();
            let all = TasksService::new(db).list(&TaskFilter {
                project_id,
                ..Default::default()
            })?;

            let filtered: Vec<_> = all
                .into_iter()
                .filter(|t| {
                    if let Some(ref statuses) = status_filter {
                        if !statuses.contains(t.status.as_str()) {
                            return false;
                        }
                    }
                    if overdue_only {
                        let pending = !matches!(t.status, TaskStatus::Done | TaskStatus::Cancelled);
                        if !pending || t.due_at.is_none_or(|d| d >= now) {
                            return false;
                        }
                    }
                    if let Some(before) = due_before {
                        if t.due_at.is_none_or(|d| d >= before) {
                            return false;
                        }
                    }
                    if let Some(ref want_tags) = tags_filter {
                        let have: std::collections::HashSet<&str> = t
                            .tags
                            .as_deref()
                            .unwrap_or(&[])
                            .iter()
                            .map(|s| s.as_str())
                            .collect();
                        if !want_tags.iter().all(|wt| have.contains(wt)) {
                            return false;
                        }
                    }
                    true
                })
                .skip(offset)
                .take(limit)
                .collect();

            serde_json::to_value(filtered).map_err(|e| CoreError::internal(e.to_string()))?
        }
        "list_projects" => {
            let include_archived = normalized_input
                .get("include_archived")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let projects = ProjectsService::new(db).list()?;
            let filtered: Vec<_> = projects
                .into_iter()
                .filter(|p| include_archived || p.status.as_str() != "archived")
                .collect();
            serde_json::to_value(filtered).map_err(|e| CoreError::internal(e.to_string()))?
        }
        "get_project" => {
            let id = req_str(&normalized_input, "id")?;
            let project = ProjectsService::new(db).get(id)?;
            serde_json::to_value(project).map_err(|e| CoreError::internal(e.to_string()))?
        }
        "list_reminders" => {
            let status_filter: Option<std::collections::HashSet<&str>> = normalized_input
                .get("status")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str()).collect());
            let task_id_filter = normalized_input.get("task_id").and_then(|v| v.as_str());
            let fire_before = normalized_input
                .get("fire_before")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            let limit = normalized_input
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(100) as usize;

            let all = RemindersService::new(db).list(true)?;
            let filtered: Vec<_> = all
                .into_iter()
                .filter(|r| {
                    if let Some(ref statuses) = status_filter {
                        if !statuses.contains(r.status.as_str()) {
                            return false;
                        }
                    }
                    if let Some(tid) = task_id_filter {
                        if r.task_id.as_deref() != Some(tid) {
                            return false;
                        }
                    }
                    if let Some(before) = fire_before {
                        if r.fire_at >= before {
                            return false;
                        }
                    }
                    true
                })
                .take(limit)
                .collect();

            serde_json::to_value(filtered).map_err(|e| CoreError::internal(e.to_string()))?
        }
        "get_kanban_board" => {
            let board = KanbanService::new(db).board(None)?;
            let cols: Vec<Value> = board
                .columns
                .into_iter()
                .filter(|c| c.status != TaskStatus::Cancelled)
                .map(|c| {
                    json!({
                        "column": c.status.as_str(),
                        "tasks": c.tasks,
                    })
                })
                .collect();
            json!({
                "columns": cols,
                "updated_at": Utc::now().to_rfc3339(),
            })
        }
        "today_overview" => {
            let now = Utc::now();
            let today_date = now.date_naive();
            let today_str = today_date.format("%Y-%m-%d").to_string();
            let all_tasks = TasksService::new(db).list(&TaskFilter::default())?;

            // Single-pass O(N) classification with zero per-task date string formatting.
            let mut overdue_tasks = Vec::new();
            let mut due_today = Vec::new();
            let mut in_progress = Vec::new();

            for task in all_tasks {
                let is_open = !matches!(task.status, TaskStatus::Done | TaskStatus::Cancelled);
                let is_overdue = is_open && task.due_at.is_some_and(|d| d < now);
                let is_due_today =
                    is_open && task.due_at.is_some_and(|d| d.date_naive() == today_date);
                let is_doing = task.status == TaskStatus::Doing;

                match (is_overdue, is_due_today, is_doing) {
                    (false, false, false) => {}
                    (true, false, false) => overdue_tasks.push(task),
                    (false, true, false) => due_today.push(task),
                    (false, false, true) => in_progress.push(task),
                    _ => {
                        if is_overdue {
                            overdue_tasks.push(task.clone());
                        }
                        if is_due_today {
                            due_today.push(task.clone());
                        }
                        if is_doing {
                            in_progress.push(task);
                        }
                    }
                }
            }

            let running = PomodorosService::new(db).running_session()?;
            let pomodoro_active = running.map(|s| {
                json!({
                    "id": s.id,
                    "task_id": s.task_id,
                    "kind": s.kind.as_str(),
                    "planned_min": s.planned_min,
                    "started_at": s.started_at.to_rfc3339(),
                })
            });

            let today_plan = DailyPlansService::new(db).get_by_date(&today_str)?;
            let today_plan_state = today_plan
                .map(|p| p.state.as_str().to_string())
                .unwrap_or_else(|| "none".to_string());

            let metrics = MetricsService::new(db).get_or_default(&today_str)?;

            json!({
                "date": today_str,
                "overdue_tasks": overdue_tasks,
                "due_today": due_today,
                "in_progress": in_progress,
                "pomodoro_active": pomodoro_active,
                "today_plan_state": today_plan_state,
                "recent_notifications": [],
                "metrics_today": {
                    "focus_minutes": metrics.focus_minutes,
                    "break_minutes": metrics.break_minutes,
                    "water_count": metrics.water_count,
                    "tasks_done": metrics.tasks_done,
                    "tasks_created": metrics.tasks_created,
                }
            })
        }
        "get_today_plan" => {
            let today_str = Utc::now().format("%Y-%m-%d").to_string();
            let plan = DailyPlansService::new(db).get_by_date(&today_str)?;
            match plan {
                None => Value::Null,
                Some(p) => {
                    let payload_val = p
                        .payload
                        .as_deref()
                        .and_then(|s| serde_json::from_str::<Value>(s).ok());
                    json!({
                        "id": p.id,
                        "plan_date": p.plan_date,
                        "state": p.state.as_str(),
                        "started_at": p.started_at.map(|d| d.to_rfc3339()),
                        "completed_at": p.completed_at.map(|d| d.to_rfc3339()),
                        "payload": payload_val,
                    })
                }
            }
        }
        "list_pending_proposals" => {
            let limit = normalized_input
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(50);
            let props = ProposalsService::new(db).list_pending_limit(limit)?;
            let arr: Vec<Value> = props.into_iter().map(|p| p.to_schema_json()).collect();
            Value::Array(arr)
        }
        "get_proposal" => {
            let id = req_str(&normalized_input, "id")?;
            let prop = ProposalsService::new(db).get(id)?;
            prop.to_schema_json()
        }
        "pomodoro_status" => {
            let running = PomodorosService::new(db).running_session()?;
            match running {
                None => Value::Null,
                Some(s) => json!({
                    "id": s.id,
                    "task_id": s.task_id,
                    "kind": s.kind.as_str(),
                    "planned_min": s.planned_min,
                    "started_at": s.started_at.to_rfc3339(),
                    "cycle_index": null,
                    "cycle_count": null,
                }),
            }
        }
        "propose_create_task" => {
            let title = req_str(&normalized_input, "title")?;
            let summary = format!("Create task: {title}");
            create_mcp_proposal(db, name, "create_task", &normalized_input, &summary)?
        }
        "propose_update_task" => {
            let id = req_str(&normalized_input, "id")?;
            let summary = format!("Update task: {id}");
            create_mcp_proposal(db, name, "update_task", &normalized_input, &summary)?
        }
        "propose_delete_task" => {
            let id = req_str(&normalized_input, "id")?;
            let summary = format!("Delete task: {id}");
            create_mcp_proposal(db, name, "delete_task", &normalized_input, &summary)?
        }
        "propose_create_reminder" => {
            let title = req_str(&normalized_input, "title")?;
            let summary = format!("Create reminder: {title}");
            create_mcp_proposal(db, name, "create_reminder", &normalized_input, &summary)?
        }
        "propose_subtasks" => {
            let parent_id = req_str(&normalized_input, "parent_task_id")?;
            let count = normalized_input
                .get("subtasks")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let summary = format!("Create {count} subtasks for {parent_id}");
            create_mcp_proposal(db, name, "propose_subtasks", &normalized_input, &summary)?
        }
        "propose_bulk_plan" => {
            let count = normalized_input
                .get("entries")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let summary = format!("Propose daily plan ({count} entries)");
            create_mcp_proposal(db, name, "bulk_plan", &normalized_input, &summary)?
        }
        "approve_proposal" => execute_approve_proposal(db, &normalized_input)?,
        "reject_proposal" => execute_reject_proposal(db, &normalized_input)?,
        _ => return Err(CoreError::not_found("tool", name)),
    };

    validate_against_schema(&cap.output_schema, &out)?;
    Ok(out)
}

fn req_str<'a>(obj: &'a Value, field: &'static str) -> Result<&'a str, CoreError> {
    obj.get(field)
        .and_then(|v| v.as_str())
        .ok_or_else(|| CoreError::validation(field, format!("missing string '{field}'")))
}

fn create_mcp_proposal(
    db: &Db,
    tool_name: &str,
    kind: &str,
    payload: &Value,
    summary: &str,
) -> Result<Value, CoreError> {
    let svc = ProposalsService::new(db);
    let prop = svc.create_proposal("mcp", kind, payload, summary)?;
    let args_str = serde_json::to_string(payload).unwrap_or_else(|_| "{}".into());
    svc.log_command("mcp", tool_name, &args_str, "ok", None, Some(&prop.id))?;

    Ok(json!({
        "proposal_id": prop.id,
        "summary": prop.summary,
        "kind": prop.kind,
        "preview": payload,
    }))
}

fn propose_tool_for_kind(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "create_task" => "propose_create_task",
        "update_task" => "propose_update_task",
        "delete_task" => "propose_delete_task",
        "create_reminder" => "propose_create_reminder",
        "propose_subtasks" => "propose_subtasks",
        "bulk_plan" => "propose_bulk_plan",
        _ => return None,
    })
}

fn verify_proposal_integrity(
    svc: &ProposalsService<'_>,
    prop_id: &str,
    modifications: Option<&Value>,
) -> Result<(crate::application::proposals::Proposal, Value), CoreError> {
    let prop = svc.get(prop_id)?;
    if prop.status != ProposalStatus::Pending {
        return Err(CoreError::conflict("proposal", "proposal is not pending"));
    }

    if Utc::now() > prop.expires_at {
        let _ = svc.mark_expired(prop_id, "ttl expired");
        return Err(CoreError::validation(
            "expires_at",
            "proposal has expired and was marked expired",
        ));
    }

    let computed_hash = sha256_hex(&prop.payload);
    if computed_hash != prop.payload_hash {
        let _ = svc.mark_expired(prop_id, "hash/schema mismatch");
        return Err(CoreError::validation(
            "payload_hash",
            "proposal payload_hash mismatch; marked expired",
        ));
    }

    let mut payload_val: Value = serde_json::from_str(&prop.payload).map_err(|_| {
        let _ = svc.mark_expired(prop_id, "hash/schema mismatch");
        CoreError::validation("payload", "invalid JSON in proposal payload")
    })?;

    if let Some(Value::Object(mods)) = modifications {
        if let Some(obj) = payload_val.as_object_mut() {
            for (k, v) in mods {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    let tool_name = propose_tool_for_kind(&prop.kind).ok_or_else(|| {
        let _ = svc.mark_expired(prop_id, "hash/schema mismatch");
        CoreError::validation("kind", "unknown proposal kind")
    })?;
    let cap = find_capability(tool_name).ok_or_else(|| {
        let _ = svc.mark_expired(prop_id, "hash/schema mismatch");
        CoreError::validation("kind", "missing capability for proposal kind")
    })?;

    if let Err(e) = validate_against_schema(&cap.input_schema, &payload_val) {
        let _ = svc.mark_expired(prop_id, "hash/schema mismatch");
        return Err(CoreError::validation(
            "payload",
            format!("proposal failed schema re-validation ({e}); marked expired"),
        ));
    }

    Ok((prop, payload_val))
}

fn execute_approve_proposal(db: &Db, input: &Value) -> Result<Value, CoreError> {
    let id = req_str(input, "id")?;
    let note = input.get("note").and_then(|v| v.as_str());
    let modifications = input.get("modifications");

    let svc = ProposalsService::new(db);
    let (prop, effective_payload) = verify_proposal_integrity(&svc, id, modifications)?;

    let (result_ref_id, result_kind) = match prop.kind.as_str() {
        "create_task" => {
            let title = req_str(&effective_payload, "title")?.to_string();
            let description = effective_payload
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let project_id = effective_payload
                .get("project_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let parent_task_id = effective_payload
                .get("parent_task_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let priority = effective_payload
                .get("priority")
                .and_then(|v| v.as_str())
                .map(parse_priority)
                .unwrap_or(TaskPriority::Normal);
            let due_at = effective_payload
                .get("due_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            let estimate_min = effective_payload
                .get("estimate_min")
                .and_then(|v| v.as_i64())
                .map(|n| n as i32);
            let tags = effective_payload
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                });

            let created = TasksService::new(db).create(NewTask {
                title,
                description,
                project_id,
                parent_task_id,
                priority,
                status: TaskStatus::Todo,
                due_at,
                estimate_min,
                tags,
            })?;
            (Some(created.id), "task")
        }
        "update_task" => {
            let task_id = req_str(&effective_payload, "id")?;
            let mut patch = UpdateTask::default();
            if let Some(t) = effective_payload.get("title").and_then(|v| v.as_str()) {
                patch.title = Some(t.to_string());
            }
            if let Some(d) = effective_payload.get("description") {
                patch.description = Some(d.as_str().map(|s| s.to_string()));
            }
            if let Some(p) = effective_payload.get("project_id") {
                patch.project_id = Some(p.as_str().map(|s| s.to_string()));
            }
            if let Some(pr) = effective_payload.get("priority").and_then(|v| v.as_str()) {
                patch.priority = Some(parse_priority(pr));
            }
            if let Some(da) = effective_payload.get("due_at") {
                patch.due_at = Some(
                    da.as_str()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.with_timezone(&Utc)),
                );
            }
            if let Some(em) = effective_payload.get("estimate_min") {
                patch.estimate_min = Some(em.as_i64().map(|n| n as i32));
            }
            if let Some(tg) = effective_payload.get("tags") {
                patch.tags = Some(tg.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                }));
            }
            let updated = TasksService::new(db).update(task_id, patch)?;
            (Some(updated.id), "task")
        }
        "delete_task" => {
            let task_id = req_str(&effective_payload, "id")?;
            TasksService::new(db).delete(task_id)?;
            (Some(task_id.to_string()), "task")
        }
        "create_reminder" => {
            let title = req_str(&effective_payload, "title")?.to_string();
            let fire_str = req_str(&effective_payload, "fire_at")?;
            let fire_at = DateTime::parse_from_rfc3339(fire_str)
                .map(|dt| dt.with_timezone(&Utc))
                .map_err(|_| CoreError::validation("fire_at", "invalid RFC3339 timestamp"))?;
            let body = effective_payload
                .get("body")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let task_id = effective_payload
                .get("task_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let sound = effective_payload
                .get("sound")
                .and_then(|v| v.as_str())
                .map(|s| match s {
                    "info" | "chime" => ReminderSound::Chime,
                    "urgent" => ReminderSound::Urgent,
                    "none" => ReminderSound::None,
                    _ => ReminderSound::Normal,
                })
                .unwrap_or(ReminderSound::Normal);
            let repeat_kind = effective_payload
                .get("repeat")
                .and_then(|r| r.get("kind"))
                .and_then(|v| v.as_str())
                .map(|k| match k {
                    "daily" => RepeatKind::Daily,
                    "weekly" => RepeatKind::Weekly,
                    "monthly" => RepeatKind::Monthly,
                    _ => RepeatKind::None,
                })
                .unwrap_or(RepeatKind::None);

            let created = RemindersService::new(db).create(NewReminder {
                title,
                body,
                fire_at,
                repeat_kind,
                sound,
                task_id,
            })?;
            (Some(created.id), "reminder")
        }
        "propose_subtasks" => {
            let parent_id = req_str(&effective_payload, "parent_task_id")?.to_string();
            let subtasks = effective_payload
                .get("subtasks")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let tasks_svc = TasksService::new(db);
            for sub in subtasks {
                let title = req_str(&sub, "title")?.to_string();
                let estimate_min = sub
                    .get("estimate_min")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32);
                let priority = sub
                    .get("priority")
                    .and_then(|v| v.as_str())
                    .map(parse_priority)
                    .unwrap_or(TaskPriority::Normal);
                tasks_svc.create(NewTask {
                    title,
                    description: None,
                    project_id: None,
                    parent_task_id: Some(parent_id.clone()),
                    priority,
                    status: TaskStatus::Todo,
                    due_at: None,
                    estimate_min,
                    tags: None,
                })?;
            }
            (Some(parent_id), "subtask_group")
        }
        "bulk_plan" => {
            let dp_svc = DailyPlansService::new(db);
            let plan = dp_svc.current_or_create()?;
            let payload_str = serde_json::to_string(&effective_payload)
                .map_err(|e| CoreError::internal(e.to_string()))?;
            let updated_plan = dp_svc.set_payload(&plan.id, Some(payload_str))?;
            let _ = dp_svc.set_state(&updated_plan.id, PlanState::InProgress)?;
            (Some(updated_plan.id), "plan")
        }
        _ => (None, "none"),
    };

    let updated_payload_pair = if modifications.is_some() {
        let s = serde_json::to_string(&effective_payload)
            .map_err(|e| CoreError::internal(e.to_string()))?;
        let h = sha256_hex(&s);
        Some((s, h))
    } else {
        None
    };

    let approved = svc.finalize_approved(
        id,
        note,
        result_ref_id.as_deref(),
        updated_payload_pair
            .as_ref()
            .map(|(s, h)| (s.as_str(), h.as_str())),
    )?;

    let args_str = serde_json::to_string(input).unwrap_or_else(|_| "{}".into());
    svc.log_command("mcp", "approve_proposal", &args_str, "ok", None, Some(id))?;

    Ok(json!({
        "proposal": approved.to_schema_json(),
        "result_ref_id": result_ref_id,
        "result_kind": result_kind,
    }))
}

fn execute_reject_proposal(db: &Db, input: &Value) -> Result<Value, CoreError> {
    let id = req_str(input, "id")?;
    let note = input.get("note").and_then(|v| v.as_str());
    let svc = ProposalsService::new(db);
    let _ = verify_proposal_integrity(&svc, id, None)?;
    let rejected = svc.reject(id, note)?;
    let args_str = serde_json::to_string(input).unwrap_or_else(|_| "{}".into());
    svc.log_command("mcp", "reject_proposal", &args_str, "ok", None, Some(id))?;
    Ok(rejected.to_schema_json())
}

fn parse_priority(s: &str) -> TaskPriority {
    match s {
        "low" => TaskPriority::Low,
        "high" => TaskPriority::High,
        "urgent" => TaskPriority::Urgent,
        _ => TaskPriority::Normal,
    }
}
