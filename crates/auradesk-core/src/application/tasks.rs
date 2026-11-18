//! Tasks application service backed by SQLite (`tasks` and `task_recurrences`).

#![allow(missing_docs)]

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

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
        validate_title(&new.title)?;
        if let Some(ref tags) = new.tags {
            validate_tags(tags)?;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let status_str = new.status.as_str();
        let priority_str = new.priority.as_str();
        let due_str = new.due_at.map(|d| d.to_rfc3339());
        let completed_str = if matches!(new.status, TaskStatus::Done) {
            Some(now_str.clone())
        } else {
            None
        };
        let tags_json = match &new.tags {
            Some(v) => Some(
                serde_json::to_string(v)
                    .map_err(|e| CoreError::internal(format!("serialize tags: {e}")))?,
            ),
            None => None,
        };

        let conn = self.db.writer();
        let kanban_order: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(kanban_order) + 1, 0) FROM tasks WHERE status = ?1",
                params![status_str],
                |row| row.get(0),
            )
            .map_err(|e| CoreError::internal(format!("tasks max kanban_order: {e}")))?;

        conn.execute(
            "INSERT INTO tasks (id, project_id, parent_task_id, recurrence_id, title, description, \
             priority, status, kanban_order, due_at, started_at, completed_at, estimate_min, actual_min, \
             tags, created_at, updated_at) \
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, NULL, ?12, ?13, ?13)",
            params![
                id,
                new.project_id,
                new.parent_task_id,
                new.title,
                new.description,
                priority_str,
                status_str,
                kanban_order,
                due_str,
                completed_str,
                new.estimate_min,
                tags_json,
                now_str,
            ],
        )
        .map_err(|e| CoreError::internal(format!("tasks create: {e}")))?;
        drop(conn);

        self.get(&id)
    }

    fn get_on_conn(conn: &Connection, id: &str) -> Result<Task, CoreError> {
        let task = conn
            .query_row(
                "SELECT id, project_id, parent_task_id, recurrence_id, title, description, \
                 priority, status, kanban_order, due_at, started_at, completed_at, \
                 estimate_min, actual_min, tags, created_at, updated_at \
                 FROM tasks WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("tasks get: {e}")))?;

        task.ok_or_else(|| CoreError::not_found("task", id))
    }

    pub fn get(&self, id: &str) -> Result<Task, CoreError> {
        let conn = self.db.reader();
        Self::get_on_conn(&conn, id)
    }

    pub fn list(&self, filter: &TaskFilter) -> Result<Vec<Task>, CoreError> {
        let conn = self.db.reader();
        let mut sql = String::from(
            "SELECT id, project_id, parent_task_id, recurrence_id, title, description, \
             priority, status, kanban_order, due_at, started_at, completed_at, \
             estimate_min, actual_min, tags, created_at, updated_at \
             FROM tasks",
        );
        let mut conditions: Vec<&'static str> = Vec::new();
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(status) = filter.status {
            conditions.push("status = ?");
            params_vec.push(rusqlite::types::Value::from(status.as_str().to_string()));
        }
        if let Some(ref pid) = filter.project_id {
            conditions.push("project_id = ?");
            params_vec.push(rusqlite::types::Value::from(pid.clone()));
        }
        if filter.top_level_only {
            conditions.push("parent_task_id IS NULL");
        }
        if filter.overdue {
            conditions.push(
                "status NOT IN ('done', 'cancelled') \
                 AND due_at IS NOT NULL \
                 AND julianday(due_at) < julianday(?)",
            );
            params_vec.push(rusqlite::types::Value::from(Utc::now().to_rfc3339()));
        }

        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }
        sql.push_str(" ORDER BY kanban_order ASC, created_at ASC");

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| CoreError::internal(format!("tasks list prepare: {e}")))?;

        let rows = stmt
            .query_map(params_from_iter(params_vec), Self::map_row)
            .map_err(|e| CoreError::internal(format!("tasks list query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("tasks list row: {e}")))?);
        }
        Ok(out)
    }

    pub fn update(&self, id: &str, patch: UpdateTask) -> Result<Task, CoreError> {
        let mut t = self.get(id)?;

        if let Some(title) = patch.title {
            validate_title(&title)?;
            t.title = title;
        }
        if let Some(description) = patch.description {
            t.description = description;
        }
        if let Some(priority) = patch.priority {
            t.priority = priority;
        }
        if let Some(status) = patch.status {
            t.status = status;
        }
        if let Some(project_id) = patch.project_id {
            t.project_id = project_id;
        }
        if let Some(due_at) = patch.due_at {
            t.due_at = due_at;
        }
        if let Some(started_at) = patch.started_at {
            t.started_at = started_at;
        }
        if let Some(completed_at) = patch.completed_at {
            t.completed_at = completed_at;
        }
        if let Some(estimate_min) = patch.estimate_min {
            t.estimate_min = estimate_min;
        }
        if let Some(kanban_order) = patch.kanban_order {
            t.kanban_order = kanban_order;
        }
        if let Some(tags_opt) = patch.tags {
            if let Some(ref tags) = tags_opt {
                validate_tags(tags)?;
            }
            t.tags = tags_opt;
        }

        let now_str = Utc::now().to_rfc3339();
        let tags_json = match &t.tags {
            Some(v) => Some(
                serde_json::to_string(v)
                    .map_err(|e| CoreError::internal(format!("serialize tags: {e}")))?,
            ),
            None => None,
        };

        let conn = self.db.writer();
        conn.execute(
            "UPDATE tasks SET project_id = ?1, title = ?2, description = ?3, priority = ?4, \
             status = ?5, kanban_order = ?6, due_at = ?7, started_at = ?8, completed_at = ?9, \
             estimate_min = ?10, tags = ?11, updated_at = ?12 WHERE id = ?13",
            params![
                t.project_id,
                t.title,
                t.description,
                t.priority.as_str(),
                t.status.as_str(),
                t.kanban_order,
                t.due_at.map(|d| d.to_rfc3339()),
                t.started_at.map(|d| d.to_rfc3339()),
                t.completed_at.map(|d| d.to_rfc3339()),
                t.estimate_min,
                tags_json,
                now_str,
                id,
            ],
        )
        .map_err(|e| CoreError::internal(format!("tasks update: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn delete(&self, id: &str) -> Result<(), CoreError> {
        let conn = self.db.writer();
        let affected = conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![id])
            .map_err(|e| CoreError::internal(format!("tasks delete: {e}")))?;
        if affected == 0 {
            return Err(CoreError::not_found("task", id));
        }
        Ok(())
    }

    fn apply_status_on_conn(
        conn: &Connection,
        id: &str,
        status: TaskStatus,
        kanban_order: i32,
        now_str: &str,
    ) -> Result<Task, CoreError> {
        let existing = Self::get_on_conn(conn, id)?;

        let completed_at_str = if matches!(status, TaskStatus::Done) {
            Some(now_str.to_string())
        } else {
            None
        };

        let started_at_str = if matches!(status, TaskStatus::Doing) && existing.started_at.is_none()
        {
            Some(now_str.to_string())
        } else {
            existing.started_at.map(|d| d.to_rfc3339())
        };

        conn.execute(
            "UPDATE tasks SET status = ?1, kanban_order = ?2, completed_at = ?3, \
             started_at = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                status.as_str(),
                kanban_order,
                completed_at_str,
                started_at_str,
                now_str,
                id,
            ],
        )
        .map_err(|e| CoreError::internal(format!("tasks set_status: {e}")))?;

        // Check recurrence spawning if transitioning to Done
        if matches!(status, TaskStatus::Done) && !matches!(existing.status, TaskStatus::Done) {
            if let Some(ref rec_id) = existing.recurrence_id {
                let rrule_opt: Option<String> = conn
                    .query_row(
                        "SELECT rrule FROM task_recurrences WHERE id = ?1",
                        params![rec_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| CoreError::internal(format!("task_recurrences lookup: {e}")))?;

                if let Some(rrule) = rrule_opt {
                    let next_due = existing.due_at.map(|d| advance_by_rrule(d, &rrule));
                    let next_id = uuid::Uuid::new_v4().to_string();
                    let next_order: i32 = conn
                        .query_row(
                            "SELECT COALESCE(MAX(kanban_order) + 1, 0) FROM tasks WHERE status = 'todo'",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap_or(0);
                    let tags_json = match &existing.tags {
                        Some(v) => serde_json::to_string(v).ok(),
                        None => None,
                    };

                    conn.execute(
                        "INSERT INTO tasks (id, project_id, parent_task_id, recurrence_id, title, \
                         description, priority, status, kanban_order, due_at, estimate_min, tags, \
                         created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'todo', ?8, ?9, ?10, ?11, ?12, ?12)",
                        params![
                            next_id,
                            existing.project_id,
                            existing.parent_task_id,
                            rec_id,
                            existing.title,
                            existing.description,
                            existing.priority.as_str(),
                            next_order,
                            next_due.map(|d| d.to_rfc3339()),
                            existing.estimate_min,
                            tags_json,
                            now_str,
                        ],
                    )
                    .map_err(|e| CoreError::internal(format!("spawn recurring task: {e}")))?;
                }
            }
        }

        Self::get_on_conn(conn, id)
    }

    pub fn set_status(
        &self,
        id: &str,
        status: TaskStatus,
        kanban_order: i32,
    ) -> Result<Task, CoreError> {
        let now_str = Utc::now().to_rfc3339();
        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("tasks set_status tx: {e}")))?;
        let updated = Self::apply_status_on_conn(&tx, id, status, kanban_order, &now_str)?;
        tx.commit()
            .map_err(|e| CoreError::internal(format!("tasks set_status commit: {e}")))?;
        Ok(updated)
    }

    /// Atomically reorder and/or transition status for multiple Kanban cards
    /// within a single SQLite transaction.
    pub fn reorder_batch(
        &self,
        items: &[(String, TaskStatus, i32)],
    ) -> Result<Vec<Task>, CoreError> {
        if items.is_empty() {
            return Ok(Vec::new());
        }
        let now_str = Utc::now().to_rfc3339();
        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("tasks reorder_batch tx: {e}")))?;
        let mut updated = Vec::with_capacity(items.len());
        for (id, status, kanban_order) in items {
            updated.push(Self::apply_status_on_conn(
                &tx,
                id,
                *status,
                *kanban_order,
                &now_str,
            )?);
        }
        tx.commit()
            .map_err(|e| CoreError::internal(format!("tasks reorder_batch commit: {e}")))?;
        Ok(updated)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
        let id: String = row.get(0)?;
        let project_id: Option<String> = row.get(1)?;
        let parent_task_id: Option<String> = row.get(2)?;
        let recurrence_id: Option<String> = row.get(3)?;
        let title: String = row.get(4)?;
        let description: Option<String> = row.get(5)?;
        let priority_raw: String = row.get(6)?;
        let status_raw: String = row.get(7)?;
        let kanban_order: i32 = row.get(8)?;
        let due_raw: Option<String> = row.get(9)?;
        let started_raw: Option<String> = row.get(10)?;
        let completed_raw: Option<String> = row.get(11)?;
        let estimate_min: Option<i32> = row.get(12)?;
        let actual_min: Option<i32> = row.get(13)?;
        let tags_raw: Option<String> = row.get(14)?;
        let created_raw: String = row.get(15)?;
        let updated_raw: String = row.get(16)?;

        let priority = match priority_raw.as_str() {
            "low" => TaskPriority::Low,
            "high" => TaskPriority::High,
            "urgent" => TaskPriority::Urgent,
            _ => TaskPriority::Normal,
        };
        let status = match status_raw.as_str() {
            "doing" => TaskStatus::Doing,
            "waiting" => TaskStatus::Waiting,
            "done" => TaskStatus::Done,
            "cancelled" => TaskStatus::Cancelled,
            _ => TaskStatus::Todo,
        };
        let tags: Option<Vec<String>> = tags_raw
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());

        Ok(Task {
            id,
            project_id,
            parent_task_id,
            recurrence_id,
            title,
            description,
            priority,
            status,
            kanban_order,
            due_at: due_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            started_at: started_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            completed_at: completed_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            estimate_min,
            actual_min,
            tags,
            created_at: crate::infrastructure::clock::parse_rfc3339_or_now(&created_raw),
            updated_at: crate::infrastructure::clock::parse_rfc3339_or_now(&updated_raw),
        })
    }
}

fn validate_title(title: &str) -> Result<(), CoreError> {
    if title.trim().is_empty() {
        return Err(CoreError::validation("title", "blank title"));
    }
    if title.len() > 500 {
        return Err(CoreError::validation("title", "title too long"));
    }
    Ok(())
}

fn validate_tags(tags: &[String]) -> Result<(), CoreError> {
    for tag in tags {
        if tag.trim().is_empty() {
            return Err(CoreError::validation("tags", "empty tag"));
        }
    }
    Ok(())
}

fn advance_by_rrule(dt: DateTime<Utc>, rrule: &str) -> DateTime<Utc> {
    let upper = rrule.to_uppercase();
    if upper.contains("FREQ=WEEKLY") {
        dt + Duration::days(7)
    } else if upper.contains("FREQ=MONTHLY") {
        dt.checked_add_months(chrono::Months::new(1))
            .unwrap_or_else(|| dt + Duration::days(30))
    } else {
        dt + Duration::days(1)
    }
}
