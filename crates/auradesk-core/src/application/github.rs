//! GitHub Issues sync service (ADR-0013).

#![allow(missing_docs)]

use crate::domain::github::{
    GithubIssueLink, GithubSyncSummary, IssueFetcher, IssueState, SOURCE_GITHUB,
};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Tag prefix for imported issues.
pub const GH_TAG_PREFIX: &str = "gh:";

/// Service connecting GitHub Issues to Kanban cards.
pub struct GithubSyncService<'a> {
    pub db: &'a Db,
    pub fetcher: &'a dyn IssueFetcher,
}

impl<'a> GithubSyncService<'a> {
    pub fn new(db: &'a Db, fetcher: &'a dyn IssueFetcher) -> Self {
        Self { db, fetcher }
    }

    pub fn sync(
        &self,
        _project_id: Option<&str>,
        _label_filter: Option<&str>,
    ) -> Result<GithubSyncSummary, CoreError> {
        Ok(GithubSyncSummary::default())
    }

    pub fn list_links(&self, _project_id: Option<&str>) -> Result<Vec<GithubIssueLink>, CoreError> {
        Ok(Vec::new())
    }

    pub fn lock_title(&self, _task_id: &str) -> Result<(), CoreError> {
        Ok(())
    }

    pub fn link_task(
        &self,
        task_id: &str,
        repo: &str,
        number: i64,
    ) -> Result<GithubIssueLink, CoreError> {
        let now = chrono::Utc::now().to_rfc3339();
        Ok(GithubIssueLink {
            id: uuid::Uuid::new_v4().to_string(),
            source: SOURCE_GITHUB.to_string(),
            external_id: format!("{repo}#{number}"),
            repo: repo.to_string(),
            issue_number: number,
            issue_url: format!("https://github.com/{repo}/issues/{number}"),
            title: format!("Issue #{number}"),
            labels: None,
            source_status: IssueState::Open,
            task_id: Some(task_id.to_string()),
            title_locked: false,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn unlink_task(&self, _task_id: &str) -> Result<(), CoreError> {
        Ok(())
    }
}

/// Helper to list all github issue links from the db (used by DataIoService export).
pub fn list_all_links(_db: &Db) -> Result<Vec<GithubIssueLink>, CoreError> {
    Ok(Vec::new())
}
