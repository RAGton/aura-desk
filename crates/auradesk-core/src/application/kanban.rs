//! Kanban board view and card movement service wrapping `TasksService`.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

use crate::application::tasks::TasksService;
use crate::domain::task::{Task, TaskFilter, TaskStatus};
use crate::infrastructure::db::Db;
use crate::CoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KanbanColumn {
    pub status: TaskStatus,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KanbanBoard {
    pub columns: Vec<KanbanColumn>,
}

/// Service providing a Kanban board projection over `tasks`.
pub struct KanbanService<'a> {
    pub db: &'a Db,
}

impl<'a> KanbanService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn board(&self, project_id: Option<String>) -> Result<KanbanBoard, CoreError> {
        let tasks_svc = TasksService::new(self.db);
        let all = tasks_svc.list(&TaskFilter {
            project_id,
            ..Default::default()
        })?;

        let statuses = [
            TaskStatus::Todo,
            TaskStatus::Doing,
            TaskStatus::Waiting,
            TaskStatus::Done,
            TaskStatus::Cancelled,
        ];

        let columns = statuses
            .into_iter()
            .map(|status| {
                let mut col_tasks: Vec<Task> =
                    all.iter().filter(|t| t.status == status).cloned().collect();
                col_tasks.sort_by_key(|t| (t.kanban_order, t.created_at));
                KanbanColumn {
                    status,
                    tasks: col_tasks,
                }
            })
            .collect();

        Ok(KanbanBoard { columns })
    }

    pub fn move_card(
        &self,
        task_id: &str,
        status: TaskStatus,
        kanban_order: i32,
    ) -> Result<Task, CoreError> {
        TasksService::new(self.db).set_status(task_id, status, kanban_order)
    }
}
