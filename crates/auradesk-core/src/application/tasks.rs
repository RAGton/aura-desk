//! Tasks application service.

#![allow(missing_docs)]

use chrono::Utc;

use crate::domain::task::{NewTask, Task, TaskFilter, TaskPriority, TaskStatus, UpdateTask};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing tasks.
pub struct TasksService<'a> {
    pub db: &'a Db,
}

impl<'a> TasksService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn create(&self, new: NewTask) -> Result<Task, CoreError> {
        if new.title.trim().is_empty() {
            return Err(CoreError::validation("title", "blank title"));
        }
        if new.title.len() > 500 {
            return Err(CoreError::validation("title", "title too long"));
        }
        let now = Utc::now();
        Ok(Task {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: new.project_id,
            parent_task_id: new.parent_task_id,
            recurrence_id: None,
            title: new.title,
            description: new.description,
            priority: new.priority,
            status: new.status,
            kanban_order: 0,
            due_at: new.due_at,
            started_at: None,
            completed_at: None,
            estimate_min: new.estimate_min,
            actual_min: None,
            tags: new.tags,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn get(&self, id: &str) -> Result<Task, CoreError> {
        let now = Utc::now();
        Ok(Task {
            id: id.to_string(),
            project_id: None,
            parent_task_id: None,
            recurrence_id: None,
            title: "Task".to_string(),
            description: None,
            priority: TaskPriority::Normal,
            status: TaskStatus::Todo,
            kanban_order: 0,
            due_at: None,
            started_at: None,
            completed_at: None,
            estimate_min: None,
            actual_min: None,
            tags: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list(&self, _filter: &TaskFilter) -> Result<Vec<Task>, CoreError> {
        Ok(Vec::new())
    }

    pub fn update(&self, id: &str, patch: UpdateTask) -> Result<Task, CoreError> {
        let mut t = self.get(id)?;
        if let Some(title) = patch.title {
            t.title = title;
        }
        if let Some(priority) = patch.priority {
            t.priority = priority;
        }
        if let Some(status) = patch.status {
            t.status = status;
        }
        Ok(t)
    }

    pub fn delete(&self, _id: &str) -> Result<(), CoreError> {
        Ok(())
    }

    pub fn set_status(
        &self,
        id: &str,
        status: TaskStatus,
        kanban_order: i32,
    ) -> Result<Task, CoreError> {
        let mut t = self.get(id)?;
        t.status = status;
        t.kanban_order = kanban_order;
        Ok(t)
    }
}
