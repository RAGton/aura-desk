//! Projects application service backed by SQLite (`projects` table).

#![allow(missing_docs)]

use chrono::{NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};

use crate::domain::project::{NewProject, Project, ProjectStatus};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing projects.
pub struct ProjectsService<'a> {
    pub db: &'a Db,
}

impl<'a> ProjectsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn create(&self, new: NewProject) -> Result<Project, CoreError> {
        let name = new.name.trim().to_string();
        if name.is_empty() {
            return Err(CoreError::validation(
                "name",
                "project name cannot be blank",
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let start_str = new.start_date.map(|d| d.to_string());
        let target_str = new.target_date.map(|d| d.to_string());

        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO projects (id, name, description, color, parent_id, status, start_date, target_date, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?8)",
            params![
                id,
                name,
                new.description,
                new.color,
                new.parent_id,
                start_str,
                target_str,
                now_str,
            ],
        )
        .map_err(|e| CoreError::internal(format!("projects create: {e}")))?;
        drop(conn);

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> Result<Project, CoreError> {
        let conn = self.db.writer();
        let project = conn
            .query_row(
                "SELECT id, name, description, color, parent_id, status, start_date, target_date, created_at, updated_at \
                 FROM projects WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("projects get: {e}")))?;

        project.ok_or_else(|| CoreError::not_found("project", id))
    }

    pub fn list(&self) -> Result<Vec<Project>, CoreError> {
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, color, parent_id, status, start_date, target_date, created_at, updated_at \
                 FROM projects ORDER BY created_at ASC",
            )
            .map_err(|e| CoreError::internal(format!("projects list prepare: {e}")))?;
        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| CoreError::internal(format!("projects list query: {e}")))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("projects row: {e}")))?);
        }
        Ok(out)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let description: Option<String> = row.get(2)?;
        let color: Option<String> = row.get(3)?;
        let parent_id: Option<String> = row.get(4)?;
        let status_raw: String = row.get(5)?;
        let start_raw: Option<String> = row.get(6)?;
        let target_raw: Option<String> = row.get(7)?;
        let created_raw: String = row.get(8)?;
        let updated_raw: String = row.get(9)?;

        let status = match status_raw.as_str() {
            "archived" => ProjectStatus::Archived,
            "completed" => ProjectStatus::Completed,
            "paused" | "on_hold" => ProjectStatus::OnHold,
            _ => ProjectStatus::Active,
        };
        let start_date = start_raw
            .as_deref()
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        let target_date = target_raw
            .as_deref()
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        let created_at = crate::infrastructure::clock::parse_rfc3339_or_now(&created_raw);
        let updated_at = crate::infrastructure::clock::parse_rfc3339_or_now(&updated_raw);

        Ok(Project {
            id,
            name,
            description,
            color,
            parent_id,
            status,
            start_date,
            target_date,
            archived: matches!(status, ProjectStatus::Archived),
            created_at,
            updated_at,
        })
    }
}
