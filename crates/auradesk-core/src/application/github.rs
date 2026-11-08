//! Serviço de sync GitHub → Kanban (ADR-0013).
//!
//! Toda a lógica de idempotência, mapeamento e não-clobber mora aqui.
//! O serviço recebe um `&dyn IssueFetcher` (porta) — assim o core é
//! testável com um fake, sem rede e sem `gh`.

#![allow(missing_docs)]

use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::application::settings::SettingsService;
use crate::application::tasks::TasksService;
use crate::domain::github::{
    GithubIssue, GithubIssueLink, GithubSyncSummary, IssueFetcher, IssueQuery, IssueState,
    SOURCE_GITHUB,
};
use crate::domain::settings_key::SettingsKey;
use crate::domain::task::{NewTask, TaskPriority, TaskStatus, UpdateTask};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Projeção de tag importada. Labels do GitHub viram `"gh:<label>"`.
pub const GH_TAG_PREFIX: &str = "gh:";

/// Serviço de vínculo issue ↔ task.
pub struct GithubSyncService<'a> {
    pub db: &'a Db,
    pub fetcher: &'a dyn IssueFetcher,
}

impl<'a> GithubSyncService<'a> {
    /// Constrói o serviço com a porta de fetch.
    pub fn new(db: &'a Db, fetcher: &'a dyn IssueFetcher) -> Self {
        Self { db, fetcher }
    }

    /// Importa issues do repo configurado e cria/atualiza cards.
    ///
    /// Idempotente: rodar N vezes com as mesmas issues produz os mesmos
    /// cards. Nunca sobrescreve `tasks.status` (decisão do usuário).
    pub fn sync(
        &self,
        project_id: Option<&str>,
        label_filter: Option<&str>,
    ) -> Result<GithubSyncSummary, CoreError> {
        let settings = SettingsService::new(self.db);
        let repo = settings
            .get(SettingsKey::GithubRepo)
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| CoreError::validation("github.repo", "github.repo not configured"))?;

        let target_project = match project_id {
            Some(p) => Some(p.to_string()),
            None => settings
                .get(SettingsKey::GithubProjectId)
                .ok()
                .flatten()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .filter(|s| !s.trim().is_empty()),
        };

        let query = IssueQuery {
            repo,
            label: label_filter.map(|s| s.to_string()),
            include_closed: false,
            limit: Some(200),
        };

        let issues = self.fetcher.fetch_issues(&query)?;
        let mut summary = GithubSyncSummary::default();

        for issue in issues {
            match self.upsert_issue(&issue, target_project.as_deref())? {
                UpsertOutcome::Created(link) => {
                    summary.created += 1;
                    summary.issues.push(link);
                }
                UpsertOutcome::Updated(link) => {
                    summary.updated += 1;
                    summary.issues.push(link);
                }
                UpsertOutcome::Skipped(link) => {
                    summary.skipped += 1;
                    summary.issues.push(link);
                }
            }
        }

        Ok(summary)
    }

    /// Insere ou atualiza o vínculo de uma issue. Retorna o outcome.
    fn upsert_issue(
        &self,
        issue: &GithubIssue,
        project_id: Option<&str>,
    ) -> Result<UpsertOutcome, CoreError> {
        let external_id = issue.external_id();
        let existing: Option<(String, Option<String>, bool)> = {
            let conn = self.db.writer();
            conn.query_row(
                "SELECT id, task_id, title_locked FROM github_issues \
                 WHERE source = ?1 AND external_id = ?2",
                params![SOURCE_GITHUB, external_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("github_issues lookup: {e}")))?
        };

        let labels_json = serde_json::to_string(&issue.labels)
            .map_err(|e| CoreError::internal(format!("serialize labels: {e}")))?;
        let now = chrono::Utc::now().to_rfc3339();

        match existing {
            Some((link_id, task_id, title_locked)) => {
                {
                    let conn = self.db.writer();
                    conn.execute(
                        "UPDATE github_issues SET \
                         title = ?1, body = ?2, labels = ?3, source_status = ?4, \
                         source_updated_at = ?5, updated_at = ?6 \
                         WHERE id = ?7",
                        params![
                            issue.title,
                            issue.body,
                            labels_json,
                            issue.state.as_str(),
                            issue.updated_at,
                            now,
                            link_id,
                        ],
                    )
                    .map_err(|e| CoreError::internal(format!("github_issues update: {e}")))?;
                }

                if let Some(task_id) = task_id {
                    self.update_task_metadata(&task_id, issue, title_locked)?;
                }

                let link = self.get_link(&link_id)?.ok_or_else(|| {
                    CoreError::internal("github_issues row vanished after update")
                })?;
                Ok(UpsertOutcome::Updated(link))
            }
            None => {
                let link_id = Uuid::new_v4().to_string();
                let task = TasksService::new(self.db).create(NewTask {
                    title: issue.title.clone(),
                    description: issue.body.clone(),
                    priority: TaskPriority::Normal,
                    status: TaskStatus::Todo,
                    project_id: project_id.map(|p| p.to_string()),
                    parent_task_id: None,
                    due_at: None,
                    estimate_min: None,
                    tags: if issue.labels.is_empty() {
                        None
                    } else {
                        Some(
                            issue
                                .labels
                                .iter()
                                .map(|l| format!("{GH_TAG_PREFIX}{l}"))
                                .collect(),
                        )
                    },
                })?;

                {
                    let conn = self.db.writer();
                    conn.execute(
                        "INSERT INTO github_issues \
                         (id, source, external_id, repo, issue_number, issue_url, title, body, \
                          labels, source_status, source_updated_at, task_id, title_locked, \
                          created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?13)",
                        params![
                            link_id,
                            SOURCE_GITHUB,
                            external_id,
                            issue.repo,
                            issue.number,
                            issue.url,
                            issue.title,
                            issue.body,
                            labels_json,
                            issue.state.as_str(),
                            issue.updated_at,
                            task.id,
                            now,
                        ],
                    )
                    .map_err(|e| CoreError::internal(format!("github_issues insert: {e}")))?;
                }

                let link = self.get_link(&link_id)?.ok_or_else(|| {
                    CoreError::internal("github_issues row vanished after insert")
                })?;
                Ok(UpsertOutcome::Created(link))
            }
        }
    }

    /// Atualiza título/descrição/tags do card SEM tocar em status,
    /// priority, project_id, kanban_order, due_at ou estimate_min.
    fn update_task_metadata(
        &self,
        task_id: &str,
        issue: &GithubIssue,
        title_locked: bool,
    ) -> Result<(), CoreError> {
        let tasks = TasksService::new(self.db);
        let task = tasks.get(task_id)?;

        let new_title = if title_locked {
            task.title.clone()
        } else {
            issue.title.clone()
        };

        let new_description = if title_locked {
            task.description.clone()
        } else {
            issue.body.clone()
        };

        let mut merged: Vec<String> = task.tags.clone().unwrap_or_default();
        let mut seen: std::collections::HashSet<String> = merged.iter().cloned().collect();
        for label in &issue.labels {
            let tagged = format!("{GH_TAG_PREFIX}{label}");
            if seen.insert(tagged.clone()) {
                merged.push(tagged);
            }
        }
        let new_tags = if merged.is_empty() {
            None
        } else {
            Some(merged)
        };

        if new_title == task.title && new_description == task.description && new_tags == task.tags {
            return Ok(());
        }

        let patch = UpdateTask {
            title: Some(new_title),
            description: Some(new_description),
            tags: Some(new_tags),
            ..Default::default()
        };
        tasks.update(task_id, patch)?;
        Ok(())
    }

    /// Lê um vínculo por id.
    pub fn get_link(&self, id: &str) -> Result<Option<GithubIssueLink>, CoreError> {
        let conn = self.db.writer();
        let link = conn
            .query_row(
                "SELECT id, source, external_id, repo, issue_number, issue_url, title, \
                 labels, source_status, task_id, title_locked, created_at, updated_at \
                 FROM github_issues WHERE id = ?1",
                params![id],
                map_link_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("github_issues get: {e}")))?;
        Ok(link)
    }

    /// Lista vínculos, opcionalmente filtrados por project do card.
    pub fn list_links(&self, project_id: Option<&str>) -> Result<Vec<GithubIssueLink>, CoreError> {
        let conn = self.db.writer();
        let mut out = Vec::new();
        match project_id {
            Some(p) => {
                let mut stmt = conn
                    .prepare(
                        "SELECT g.id, g.source, g.external_id, g.repo, g.issue_number, g.issue_url, g.title, \
                         g.labels, g.source_status, g.task_id, g.title_locked, g.created_at, g.updated_at \
                         FROM github_issues g \
                         JOIN tasks t ON t.id = g.task_id \
                         WHERE g.task_id IS NOT NULL AND t.project_id = ?1 \
                         ORDER BY g.issue_number ASC",
                    )
                    .map_err(|e| CoreError::internal(format!("prepare list_links: {e}")))?;
                let rows = stmt
                    .query_map(params![p], map_link_row)
                    .map_err(|e| CoreError::internal(format!("list_links: {e}")))?;
                for r in rows {
                    out.push(r.map_err(|e| CoreError::internal(format!("row: {e}")))?);
                }
            }
            None => {
                let mut stmt = conn
                    .prepare(
                        "SELECT g.id, g.source, g.external_id, g.repo, g.issue_number, g.issue_url, g.title, \
                         g.labels, g.source_status, g.task_id, g.title_locked, g.created_at, g.updated_at \
                         FROM github_issues g \
                         WHERE g.task_id IS NOT NULL \
                         ORDER BY g.issue_number ASC",
                    )
                    .map_err(|e| CoreError::internal(format!("prepare list_links: {e}")))?;
                let rows = stmt
                    .query_map([], map_link_row)
                    .map_err(|e| CoreError::internal(format!("list_links: {e}")))?;
                for r in rows {
                    out.push(r.map_err(|e| CoreError::internal(format!("row: {e}")))?);
                }
            }
        }
        Ok(out)
    }

    /// Vincula manualmente uma issue a um card existente.
    pub fn link_task(
        &self,
        task_id: &str,
        repo: &str,
        number: i64,
    ) -> Result<GithubIssueLink, CoreError> {
        TasksService::new(self.db).get(task_id)?;

        let external_id = format!("{repo}#{number}");
        let link_id = {
            let conn = self.db.writer();
            let existing: Option<String> = conn
                .query_row(
                    "SELECT id FROM github_issues WHERE source = ?1 AND external_id = ?2",
                    params![SOURCE_GITHUB, external_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| CoreError::internal(format!("link lookup: {e}")))?;

            match existing {
                Some(id) => id,
                None => {
                    let id = Uuid::new_v4().to_string();
                    let now = chrono::Utc::now().to_rfc3339();
                    conn.execute(
                        "INSERT INTO github_issues \
                         (id, source, external_id, repo, issue_number, issue_url, title, \
                          labels, source_status, task_id, title_locked, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 'open', ?8, 0, ?9, ?9)",
                        params![
                            id,
                            SOURCE_GITHUB,
                            external_id,
                            repo,
                            number,
                            format!("https://github.com/{repo}/issues/{number}"),
                            format!("{} #{number}", crate::i18n::t("github.issue_label")),
                            task_id,
                            now,
                        ],
                    )
                    .map_err(|e| CoreError::internal(format!("link insert: {e}")))?;
                    id
                }
            }
        };

        {
            let conn = self.db.writer();
            conn.execute(
                "UPDATE github_issues SET task_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![task_id, chrono::Utc::now().to_rfc3339(), link_id],
            )
            .map_err(|e| CoreError::internal(format!("link update: {e}")))?;
        }

        self.get_link(&link_id)?
            .ok_or_else(|| CoreError::internal("link vanished"))
    }

    /// Remove o vínculo (o card permanece).
    pub fn unlink_task(&self, task_id: &str) -> Result<(), CoreError> {
        let conn = self.db.writer();
        conn.execute(
            "UPDATE github_issues SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2",
            params![chrono::Utc::now().to_rfc3339(), task_id],
        )
        .map_err(|e| CoreError::internal(format!("unlink: {e}")))?;
        Ok(())
    }

    /// Marca o card como "editado pelo usuário" (bloqueia re-sync de título/descrição).
    pub fn lock_title(&self, task_id: &str) -> Result<(), CoreError> {
        let conn = self.db.writer();
        conn.execute(
            "UPDATE github_issues SET title_locked = 1, updated_at = ?1 WHERE task_id = ?2",
            params![chrono::Utc::now().to_rfc3339(), task_id],
        )
        .map_err(|e| CoreError::internal(format!("lock_title: {e}")))?;
        Ok(())
    }
}

/// Helper to list all github issue links from the db (used by DataIoService export).
pub fn list_all_links(db: &Db) -> Result<Vec<GithubIssueLink>, CoreError> {
    let conn = db.writer();
    let mut stmt = conn
        .prepare(
            "SELECT id, source, external_id, repo, issue_number, issue_url, title, \
             labels, source_status, task_id, title_locked, created_at, updated_at \
             FROM github_issues ORDER BY issue_number ASC",
        )
        .map_err(|e| CoreError::internal(format!("list_all_links prepare: {e}")))?;

    let rows = stmt
        .query_map([], map_link_row)
        .map_err(|e| CoreError::internal(format!("list_all_links query: {e}")))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| CoreError::internal(format!("list_all_links row: {e}")))?);
    }
    Ok(out)
}

fn map_link_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<GithubIssueLink> {
    let labels_str: Option<String> = r.get(7)?;
    let labels = labels_str.and_then(|s| serde_json::from_str(&s).ok());
    let status_s: String = r.get(8)?;
    Ok(GithubIssueLink {
        id: r.get(0)?,
        source: r.get(1)?,
        external_id: r.get(2)?,
        repo: r.get(3)?,
        issue_number: r.get(4)?,
        issue_url: r.get(5)?,
        title: r.get(6)?,
        labels,
        source_status: IssueState::from_db(&status_s).unwrap_or(IssueState::Open),
        task_id: r.get(9)?,
        title_locked: r.get::<_, i64>(10)? != 0,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

#[derive(Debug, Clone)]
enum UpsertOutcome {
    Created(GithubIssueLink),
    Updated(GithubIssueLink),
    #[allow(dead_code)]
    Skipped(GithubIssueLink),
}
