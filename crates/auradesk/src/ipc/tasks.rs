//! Tasks and projects IPC commands.

use auradesk_core::application::{
    github::GithubSyncService, projects::ProjectsService, tasks::TasksService,
};
use auradesk_core::domain::project::NewProject;
use auradesk_core::domain::task::{
    NewTask, Task, TaskFilter, TaskPriority, TaskStatus, UpdateTask,
};
use auradesk_core::CoreError;
use serde::Deserialize;
use tauri::State;

use crate::ipc::parse_rfc3339;
use crate::runtime::{db_from, AppState};

/// Wrapper used by the frontend to filter tasks. The frontend
/// doesn't import the Rust `TaskFilter` directly; it sends a
/// flattened JSON shape (Tauri deserializes it here).
#[derive(Debug, Deserialize)]
pub struct TaskFilterInput {
    pub status: Option<TaskStatus>,
    pub project_id: Option<String>,
    pub overdue: Option<bool>,
    pub top_level_only: Option<bool>,
}

impl From<TaskFilterInput> for TaskFilter {
    fn from(v: TaskFilterInput) -> Self {
        TaskFilter {
            status: v.status,
            project_id: v.project_id,
            overdue: v.overdue.unwrap_or(false),
            top_level_only: v.top_level_only.unwrap_or(false),
        }
    }
}

#[tauri::command]
pub fn tasks_list(
    state: State<'_, AppState>,
    filter: Option<TaskFilterInput>,
) -> Result<Vec<Task>, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let f = filter.map(TaskFilter::from).unwrap_or_default();
    svc.list(&f).map_err(|e| format!("tasks_list: {e}"))
}

#[tauri::command]
pub fn tasks_get(state: State<'_, AppState>, id: String) -> Result<Task, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    svc.get(&id).map_err(|e| format!("tasks_get: {e}"))
}

fn default_new_task_priority() -> TaskPriority {
    TaskPriority::Normal
}

fn default_new_task_status() -> TaskStatus {
    TaskStatus::Todo
}

/// Frontend-friendly `NewTask`. Mirrors the domain type but with
/// JSON-friendly types (strings for enums, optionals as nullable).
#[derive(Debug, Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    pub description: Option<String>,
    #[serde(default = "default_new_task_priority")]
    pub priority: TaskPriority,
    #[serde(default = "default_new_task_status")]
    pub status: TaskStatus,
    pub project_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub due_at: Option<String>,
    pub estimate_min: Option<i32>,
    pub tags: Option<Vec<String>>,
}

impl TryFrom<NewTaskInput> for NewTask {
    type Error = CoreError;
    fn try_from(v: NewTaskInput) -> Result<Self, Self::Error> {
        let due_at = match v.due_at {
            Some(s) => Some(parse_rfc3339(&s)?),
            None => None,
        };
        Ok(NewTask {
            title: v.title,
            description: v.description,
            priority: v.priority,
            status: v.status,
            project_id: v.project_id,
            parent_task_id: v.parent_task_id,
            due_at,
            estimate_min: v.estimate_min,
            tags: v.tags,
        })
    }
}

#[tauri::command]
pub fn tasks_create(state: State<'_, AppState>, input: NewTaskInput) -> Result<Task, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let new: NewTask = input
        .try_into()
        .map_err(|e: CoreError| format!("invalid input: {e}"))?;
    svc.create(new).map_err(|e| format!("tasks_create: {e}"))
}

/// Sentinel that maps to the domain `Clear<T>`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ClearInput<T> {
    /// Marker field. We don't carry a value because the receiver
    /// ignores it; the sentinel itself is the signal.
    #[serde(default)]
    pub clear: std::marker::PhantomData<T>,
}

/// Like `UpdateTask` but the nullable fields are `Clear<T> | T | null`.
/// Tauri deserializes this from a flat JSON object the frontend
/// builds without naming Rust types.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub title: Option<String>,
    /// `null` to clear, `Some(s)` to set, field absent to leave alone.
    pub description: Option<Option<String>>,
    pub priority: Option<TaskPriority>,
    pub status: Option<TaskStatus>,
    pub project_id: Option<Option<String>>,
    pub due_at: Option<Option<String>>,
    pub started_at: Option<Option<String>>,
    pub completed_at: Option<Option<String>>,
    pub estimate_min: Option<Option<i32>>,
    pub kanban_order: Option<i32>,
    pub tags: Option<Option<Vec<String>>>,
}

impl TryFrom<UpdateTaskInput> for UpdateTask {
    type Error = CoreError;
    fn try_from(v: UpdateTaskInput) -> Result<Self, Self::Error> {
        // The IPC wire format is already Option<Option<T>> for
        // nullable fields, so the translation is direct: keep the
        // double-Option shape so the service can distinguish
        // "leave alone" (field absent) from "clear" (null) from
        // "set to value" (string/number/etc).
        Ok(UpdateTask {
            title: v.title,
            description: v.description,
            priority: v.priority,
            status: v.status,
            project_id: v.project_id,
            due_at: match v.due_at {
                Some(None) => Some(None),
                Some(Some(s)) => Some(Some(parse_rfc3339(&s)?)),
                None => None,
            },
            started_at: match v.started_at {
                Some(None) => Some(None),
                Some(Some(s)) => Some(Some(parse_rfc3339(&s)?)),
                None => None,
            },
            completed_at: match v.completed_at {
                Some(None) => Some(None),
                Some(Some(s)) => Some(Some(parse_rfc3339(&s)?)),
                None => None,
            },
            estimate_min: v.estimate_min,
            kanban_order: v.kanban_order,
            tags: v.tags,
        })
    }
}

#[tauri::command]
pub fn tasks_update(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateTaskInput,
) -> Result<Task, String> {
    let locks_github_title = patch.title.is_some() || patch.description.is_some();
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let p: UpdateTask = patch
        .try_into()
        .map_err(|e: CoreError| format!("invalid patch: {e}"))?;
    let updated = svc
        .update(&id, p)
        .map_err(|e| format!("tasks_update: {e}"))?;
    if locks_github_title {
        let gh = GithubSyncService::new(&db, state.github_fetcher.as_ref());
        let _ = gh.lock_title(&id);
    }
    Ok(updated)
}

#[tauri::command]
pub fn tasks_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    svc.delete(&id).map_err(|e| format!("tasks_delete: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetStatusInput {
    pub id: String,
    pub status: TaskStatus,
    pub kanban_order: i32,
}

#[tauri::command]
pub fn tasks_set_status(state: State<'_, AppState>, input: SetStatusInput) -> Result<Task, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let task = svc
        .set_status(&input.id, input.status, input.kanban_order)
        .map_err(|e| format!("tasks_set_status: {e}"))?;
    if input.status == TaskStatus::Done {
        let db_clone = std::sync::Arc::clone(&db);
        let title = task.title.clone();
        std::thread::spawn(move || {
            crate::hindsight::retain_task_completed(&db_clone, &title);
        });
    }
    Ok(task)
}

#[derive(Debug, Deserialize)]
pub struct TaskReorderItem {
    pub id: String,
    pub status: TaskStatus,
    pub kanban_order: i32,
}

#[tauri::command]
pub fn tasks_reorder(
    state: State<'_, AppState>,
    items: Vec<TaskReorderItem>,
) -> Result<Vec<Task>, String> {
    let db = db_from(&state);
    let svc = TasksService::new(&db);
    let batch: Vec<(String, TaskStatus, i32)> = items
        .into_iter()
        .map(|item| (item.id, item.status, item.kanban_order))
        .collect();
    svc.reorder_batch(&batch)
        .map_err(|e| format!("tasks_reorder: {e}"))
}

#[tauri::command]
pub fn projects_list(
    state: State<'_, AppState>,
) -> Result<Vec<auradesk_core::domain::project::Project>, String> {
    let db = db_from(&state);
    let svc = ProjectsService::new(&db);
    svc.list().map_err(|e| format!("projects_list: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct NewProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<String>,
    /// ISO 8601 date (`YYYY-MM-DD`).
    pub start_date: Option<String>,
    pub target_date: Option<String>,
}

impl TryFrom<NewProjectInput> for NewProject {
    type Error = CoreError;
    fn try_from(v: NewProjectInput) -> Result<Self, Self::Error> {
        let parse = |s: &str| -> Result<chrono::NaiveDate, CoreError> {
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|e| CoreError::validation("date", format!("invalid date {s}: {e}")))
        };
        Ok(NewProject {
            name: v.name,
            description: v.description,
            color: v.color,
            parent_id: v.parent_id,
            start_date: v.start_date.as_deref().map(parse).transpose()?,
            target_date: v.target_date.as_deref().map(parse).transpose()?,
        })
    }
}

#[tauri::command]
pub fn projects_create(
    state: State<'_, AppState>,
    input: NewProjectInput,
) -> Result<auradesk_core::domain::project::Project, String> {
    let db = db_from(&state);
    let svc = ProjectsService::new(&db);
    let new: NewProject = input
        .try_into()
        .map_err(|e: CoreError| format!("invalid input: {e}"))?;
    svc.create(new).map_err(|e| format!("projects_create: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_task_input_deserializes_without_optional_status_or_priority() {
        let json = r#"{"title":"smoke task"}"#;
        let parsed: NewTaskInput =
            serde_json::from_str(json).expect("NewTaskInput should default status & priority");
        assert_eq!(parsed.priority, TaskPriority::Normal);
        assert_eq!(parsed.status, TaskStatus::Todo);
    }
}
