//! Projects application service.

#![allow(missing_docs)]

use chrono::Utc;

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
        let now = Utc::now();
        Ok(Project {
            id: uuid::Uuid::new_v4().to_string(),
            name: new.name,
            description: new.description,
            color: new.color,
            parent_id: new.parent_id,
            status: ProjectStatus::Active,
            start_date: new.start_date,
            target_date: new.target_date,
            archived: false,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list(&self) -> Result<Vec<Project>, CoreError> {
        Ok(Vec::new())
    }

    pub fn get(&self, id: &str) -> Result<Project, CoreError> {
        let now = Utc::now();
        Ok(Project {
            id: id.to_string(),
            name: "Project".to_string(),
            description: None,
            color: None,
            parent_id: None,
            status: ProjectStatus::Active,
            start_date: None,
            target_date: None,
            archived: false,
            created_at: now,
            updated_at: now,
        })
    }
}
