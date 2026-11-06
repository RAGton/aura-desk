//! GitHub Issues como fonte de cards do Kanban (ADR-0013).
//!
//! Módulo puro: define o contrato de fetch e os tipos de domínio.
//! Nenhuma dependência de `std::process`, HTTP ou Tauri — o core
//! conhece apenas a *porta* `IssueFetcher` (ADR-002).

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Provider de issues. Preparado para multi-provider futuro.
pub const SOURCE_GITHUB: &str = "github";

/// Estado de uma issue no provider de origem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueState {
    Open,
    Closed,
}

impl IssueState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
        }
    }

    /// Parse do formato string. `None` para valores desconhecidos.
    pub fn from_db(s: &str) -> Option<Self> {
        Some(match s {
            "open" => Self::Open,
            "closed" => Self::Closed,
            _ => return None,
        })
    }
}

/// Uma issue crua, exatamente como o provider a reportou.
/// Sem `task_id`: o vínculo é resolvido pelo serviço de sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssue {
    /// Número da issue no repo (ex.: `123`).
    pub number: i64,
    /// Repo canônico `"owner/repo"`.
    pub repo: String,
    /// URL web da issue.
    pub url: String,
    /// Título da issue.
    pub title: String,
    /// Corpo da issue (markdown), opcional.
    pub body: Option<String>,
    /// Labels, sem prefixo.
    pub labels: Vec<String>,
    /// Estado no GitHub.
    pub state: IssueState,
    /// `updated_at` do GitHub (RFC-3339), opcional.
    pub updated_at: Option<String>,
}

impl GithubIssue {
    /// Chave de idempotência canônica. Formato: `"owner/repo#123"`.
    pub fn external_id(&self) -> String {
        format!("{}#{}", self.repo, self.number)
    }
}

/// Filtro de quais issues buscar.
#[derive(Debug, Clone, Default)]
pub struct IssueQuery {
    /// Repo `"owner/repo"`. Obrigatório em tempo de execução.
    pub repo: String,
    /// Se `Some`, só traz issues com esta label.
    pub label: Option<String>,
    /// Se `Some(true)`, traz também issues fechadas.
    pub include_closed: bool,
    /// Teto de issues retornadas.
    pub limit: Option<u32>,
}

/// Porta de fetch de issues. Implementada por cada shell.
///
/// O core depende **apenas** desta trait — nunca de `std::process`, HTTP,
/// Tauri ou do binário `gh` (ADR-002 / spec §9 "nothing OS-specific").
pub trait IssueFetcher: Send + Sync {
    /// Lista issues do repo conforme o filtro. Erros vêm como
    /// `CoreError::Validation` (config inválida) ou `CoreError::Internal`
    /// (falha do provider).
    fn fetch_issues(&self, query: &IssueQuery) -> Result<Vec<GithubIssue>, crate::CoreError>;

    /// Verifica se o provider está disponível e autenticado.
    /// `Ok(None)` = provider OK mas sem info de conta.
    fn auth_status(&self) -> Result<Option<String>, crate::CoreError>;
}

/// Vínculo persistido entre uma issue e um card do Kanban.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssueLink {
    pub id: String,
    pub source: String,
    pub external_id: String,
    pub repo: String,
    pub issue_number: i64,
    pub issue_url: String,
    pub title: String,
    pub labels: Option<Vec<String>>,
    /// Estado no GitHub (truth do provider).
    pub source_status: IssueState,
    /// `task_id` do card vinculado; `None` se ainda não importado.
    pub task_id: Option<String>,
    /// `true` se o usuário editou o título do card (sync não reescreve).
    pub title_locked: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Resultado de um sync.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncSummary {
    /// Cards novos criados.
    pub created: u32,
    /// Cards existentes atualizados (metadados).
    pub updated: u32,
    /// Issues ignoradas (ex.: já vinculadas e sem mudanças / filtered out).
    pub skipped: u32,
    /// Issues conhecidas após o sync.
    pub issues: Vec<GithubIssueLink>,
}

/// Status de disponibilidade/autenticação do provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAuthStatus {
    /// `true` se o binário `gh` foi encontrado no PATH.
    pub available: bool,
    /// `true` se `gh auth status` reporta sessão válida.
    pub authenticated: bool,
    /// Conta logada (ex.: `"RAGton"`), se conhecida.
    pub account: Option<String>,
    /// Mensagem traduzível para erro (key i18n), se houver.
    pub message: Option<String>,
}
