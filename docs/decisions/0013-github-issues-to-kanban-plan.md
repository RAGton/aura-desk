# Plano de implementação — GitHub Issues → cards no Kanban

Complemento do [<u>ADR-0013</u>](http://0013-github-issues-to-kanban.md). Destinado ao FORGE-IMPLEMENTER. Repo: /data/projects/AuraDesk.

## 1. Migration V002 — DDL completo

Arquivo: crates/auradesk-core/migrations/V002\_\_github_issues.sql

-- V002\_\_github_issues.sql

-- GitHub Issues → Kanban cards (ADR-0013).

-- Tabela separada (não colunas em \`tasks\`): o vínculo é 1:1 opcional,

-- many-to-one no futuro, e carrega metadados do GitHub que não pertencem

-- ao domínio de Task.

CREATE TABLE github_issues (

id TEXT PRIMARY KEY,

-- Chave de idempotência. \`source\` é o provider ("github"), \`external_id\`

-- é o identificador canônico do provider ("owner/repo#number").

source TEXT NOT NULL CHECK (source IN ('github')),

external_id TEXT NOT NULL,

-- Repo GitHub de origem, guardado por linha para suportar multi-repo

-- futuro sem migração.

repo TEXT NOT NULL CHECK (length(trim(repo)) \> 0),

issue_number INTEGER NOT NULL CHECK (issue_number \> 0),

issue_url TEXT NOT NULL CHECK (length(trim(issue_url)) \> 0),

title TEXT NOT NULL CHECK (length(trim(title)) \> 0),

body TEXT,

-- Labels do GitHub como JSON array de strings (sem prefixo \`gh:\`;

-- o prefixo é aplicado na projeção para \`tasks.tags\`).

labels TEXT,

-- Estado no GitHub: 'open' \| 'closed'. É o truth do PROVIDER,

-- independente de \`tasks.status\`, que é o truth do USUÁRIO.

source_status TEXT NOT NULL DEFAULT 'open'

CHECK (source_status IN ('open','closed')),

-- Snapshot do \`updated_at\` do GitHub no momento do import.

source_updated_at TEXT,

-- Card do Kanban correspondente. NULL = issue conhecida, ainda não

-- importada como card (ex.: issue fechada no GitHub nunca foi aberta).

task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,

-- 1 = o usuário editou título/descrição do card; o sync NÃO reescreve.

title_locked INTEGER NOT NULL DEFAULT 0 CHECK (title_locked IN (0,1)),

created_at TEXT NOT NULL DEFAULT (datetime('now')),

updated_at TEXT NOT NULL DEFAULT (datetime('now')),

UNIQUE (source, external_id),

CHECK (labels IS NULL OR json_valid(labels))

);

-- Idempotência: UNIQUE(source, external_id) já cria o índice; este é o

-- índice explícito de busca por task_id.

CREATE INDEX idx_github_issues_task ON github_issues(task_id);

CREATE INDEX idx_github_issues_repo ON github_issues(repo);

CREATE INDEX idx_github_issues_state ON github_issues(source_status);

CREATE INDEX idx_github_issues_unlinked ON github_issues(task_id)

WHERE task_id IS NULL;

**Por que tabela separada e não colunas em tasks:**

- tasks é o domínio central; GitHub é um provider opcional. Poluir tasks com github_issue_number, github_repo, github_labels, github_source_status cria colunas NULL em 100% das tasks locais.

- tasks já tem 18 colunas; o CHECK de tags já impõe json_valid.

- Um futuro provider (Jira, Linear) reutiliza a mesma forma: source + external_id + payload.

- ON DELETE SET NULL no task_id: deletar o card desvincula a issue, sem perder o histórico de que ela existiu (a issue volta a ser "unlinked" e pode ser re-importada).

**Registro da migration:** crates/auradesk-core/src/infrastructure/migrate.rs hoje tem const V001 + apply_if_missing(conn, "V001\_\_init", V001). Adicionar:

const V002: &str = include_str!("../../migrations/V002\_\_github_issues.sql");

// ...

apply_if_missing(conn, "V002\_\_github_issues", V002)?;

**Cuidado com a ordem:** github_issues.task_id referencia tasks(id), e tasks já existe quando V002 roda. OK.

## 2. Tipos e traits novos (Rust compilável)

### 2.1 crates/auradesk-core/src/domain/github.rs (NOVO)

//! GitHub Issues como fonte de cards do Kanban (ADR-0013).

//!

//! Módulo puro: define o contrato de fetch e os tipos de domínio.

//! Nenhuma dependência de \`std::process\`, HTTP ou Tauri — o core

//! conhece apenas a \*porta\* \`IssueFetcher\` (ADR-002).

use serde::{Deserialize, Serialize};

/// Provider de issues. Preparado para multi-provider futuro.

pub const SOURCE_GITHUB: &str = "github";

/// Estado de uma issue no provider de origem.

\#\[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)\]

\#\[serde(rename_all = "lowercase")\]

pub enum IssueState {

Open,

Closed,

}

impl IssueState {

pub fn as_str(&self) -\> &'static str {

match self {

Self::Open =\> "open",

Self::Closed =\> "closed",

}

}

/// Parse do formato string. \`None\` para valores desconhecidos.

pub fn from_db(s: &str) -\> Option\<Self\> {

Some(match s {

"open" =\> Self::Open,

"closed" =\> Self::Closed,

\_ =\> return None,

})

}

}

/// Uma issue crua, exatamente como o provider a reportou.

/// Sem \`task_id\`: o vínculo é resolvido pelo serviço de sync.

\#\[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)\]

\#\[serde(rename_all = "camelCase")\]

pub struct GithubIssue {

/// Número da issue no repo (ex.: \`123\`).

pub number: i64,

/// Repo canônico \`"owner/repo"\`.

pub repo: String,

/// URL web da issue.

pub url: String,

/// Título da issue.

pub title: String,

/// Corpo da issue (markdown), opcional.

pub body: Option\<String\>,

/// Labels, sem prefixo.

pub labels: Vec\<String\>,

/// Estado no GitHub.

pub state: IssueState,

/// \`updated_at\` do GitHub (RFC-3339), opcional.

pub updated_at: Option\<String\>,

}

impl GithubIssue {

/// Chave de idempotência canônica. Formato: \`"owner/repo#123"\`.

pub fn external_id(&self) -\> String {

format!("{}#{}", self.repo, self.number)

}

}

/// Filtro de quais issues buscar.

\#\[derive(Debug, Clone, Default)\]

pub struct IssueQuery {

/// Repo \`"owner/repo"\`. Obrigatório em tempo de execução.

pub repo: String,

/// Se \`Some\`, só traz issues com esta label.

pub label: Option\<String\>,

/// Se \`Some(true)\`, traz também issues fechadas.

pub include_closed: bool,

/// Teto de issues retornadas.

pub limit: Option\<u32\>,

}

/// Porta de fetch de issues. Implementada por cada shell.

///

/// O core depende \*\*apenas\*\* desta trait — nunca de \`std::process\`, HTTP,

/// Tauri ou do binário \`gh\` (ADR-002 / spec §9 "nothing OS-specific").

pub trait IssueFetcher: Send + Sync {

/// Lista issues do repo conforme o filtro. Erros vêm como

/// \`CoreError::Validation\` (config inválida) ou \`CoreError::Internal\`

/// (falha do provider).

fn fetch_issues(&self, query: &IssueQuery) -\> Result\<Vec\<GithubIssue\>, crate::CoreError\>;

/// Verifica se o provider está disponível e autenticado.

/// \`Ok(None)\` = provider OK mas sem info de conta.

fn auth_status(&self) -\> Result\<Option\<String\>, crate::CoreError\>;

}

/// Vínculo persistido entre uma issue e um card do Kanban.

\#\[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)\]

\#\[serde(rename_all = "camelCase")\]

pub struct GithubIssueLink {

pub id: String,

pub source: String,

pub external_id: String,

pub repo: String,

pub issue_number: i64,

pub issue_url: String,

pub title: String,

pub labels: Option\<Vec\<String\>\>,

/// Estado no GitHub (truth do provider).

pub source_status: IssueState,

/// \`task_id\` do card vinculado; \`None\` se ainda não importado.

pub task_id: Option\<String\>,

/// \`true\` se o usuário editou o título do card (sync não reescreve).

pub title_locked: bool,

pub created_at: String,

pub updated_at: String,

}

/// Resultado de um sync.

\#\[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)\]

\#\[serde(rename_all = "camelCase")\]

pub struct GithubSyncSummary {

/// Cards novos criados.

pub created: u32,

/// Cards existentes atualizados (metadados).

pub updated: u32,

/// Issues ignoradas (ex.: já vinculadas e sem mudanças / filtered out).

pub skipped: u32,

/// Issues conhecidas após o sync.

pub issues: Vec\<GithubIssueLink\>,

}

/// Status de disponibilidade/autenticação do provider.

\#\[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)\]

\#\[serde(rename_all = "camelCase")\]

pub struct GithubAuthStatus {

/// \`true\` se o binário \`gh\` foi encontrado no PATH.

pub available: bool,

/// \`true\` se \`gh auth status\` reporta sessão válida.

pub authenticated: bool,

/// Conta logada (ex.: \`"RAGton"\`), se conhecida.

pub account: Option\<String\>,

/// Mensagem traduzível para erro (key i18n), se houver.

pub message: Option\<String\>,

}

### 2.2 crates/auradesk-core/src/application/github.rs (NOVO)

//! Serviço de sync GitHub → Kanban (ADR-0013).

//!

//! Toda a lógica de idempotência, mapeamento e não-clobber mora aqui.

//! O serviço recebe um \`&dyn IssueFetcher\` (porta) — assim o core é

//! testável com um fake, sem rede e sem \`gh\`.

use rusqlite::params;

use uuid::Uuid;

use crate::application::settings::SettingsService;

use crate::application::tasks::TasksService;

use crate::domain::github::{

GithubIssue, GithubIssueLink, GithubSyncSummary, IssueFetcher, IssueQuery, IssueState,

SOURCE_GITHUB,

};

use crate::domain::task::{NewTask, TaskPriority, TaskStatus};

use crate::domain::settings_key::SettingsKey;

use crate::infrastructure::db::Db;

use crate::CoreError;

/// Projeção de tag importada. Labels do GitHub viram \`"gh:\<label\>"\`.

pub const GH_TAG_PREFIX: &str = "gh:";

/// Serviço de vínculo issue ↔ task.

pub struct GithubSyncService\<'a\> {

db: &'a Db,

fetcher: &'a dyn IssueFetcher,

}

impl\<'a\> GithubSyncService\<'a\> {

/// Constrói o serviço com a porta de fetch.

pub fn new(db: &'a Db, fetcher: &'a dyn IssueFetcher) -\> Self {

Self { db, fetcher }

}

/// Importa issues do repo configurado e cria/atualiza cards.

///

/// Idempotente: rodar N vezes com as mesmas issues produz os mesmos

/// cards. Nunca sobrescreve \`tasks.status\` (decisão do usuário).

pub fn sync(

&self,

project_id: Option\<&str\>,

label_filter: Option\<&str\>,

) -\> Result\<GithubSyncSummary, CoreError\> {

let settings = SettingsService::new(self.db);

let repo = settings

.get(SettingsKey::GithubRepo)

.ok()

.flatten()

.and_then(\|v\| v.as_str().map(\|s\| s.to_string()))

.ok_or_else(\|\| CoreError::validation("github.repo", "github.repo not configured"))?;

let target_project = match project_id {

Some(p) =\> Some(p.to_string()),

None =\> settings

.get(SettingsKey::GithubProjectId)

.ok()

.flatten()

.and_then(\|v\| v.as_str().map(\|s\| s.to_string())),

};

let query = IssueQuery {

repo: repo.clone(),

label: label_filter.map(\|s\| s.to_string()),

include_closed: false,

limit: Some(200),

};

let issues = self.fetcher.fetch_issues(&query)?;

let mut summary = GithubSyncSummary::default();

for issue in issues {

match self.upsert_issue(&issue, target_project.as_deref())? {

UpsertOutcome::Created(link) =\> {

summary.created += 1;

summary.issues.push(link);

}

UpsertOutcome::Updated(link) =\> {

summary.updated += 1;

summary.issues.push(link);

}

UpsertOutcome::Skipped(link) =\> {

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

project_id: Option\<&str\>,

) -\> Result\<UpsertOutcome, CoreError\> {

let external_id = issue.external_id();

let conn = self.db.writer();

let existing: Option\<(String, Option\<String\>, bool)\> = conn

.query_row(

"SELECT id, task_id, title_locked FROM github_issues \\

WHERE source = ?1 AND external_id = ?2",

params\![SOURCE_GITHUB, external_id\],

\|r\| Ok((r.get(0)?, r.get(1)?, r.get::\<\_, i64\>(2)? != 0)),

)

.optional()

.map_err(\|e\| CoreError::internal(format!("github_issues lookup: {e}")))?;

let labels_json = serde_json::to_string(&issue.labels)

.map_err(\|e\| CoreError::internal(format!("serialize labels: {e}")))?;

let now = chrono::Utc::now().to_rfc3339();

match existing {

// ── Já existe ────────────────────────────────────────────

Some((link_id, task_id, title_locked)) =\> {

// Atualiza o truth do provider (source_status) e os

// metadados, SEM tocar em tasks.status.

conn.execute(

"UPDATE github_issues SET \\

title = ?1, body = ?2, labels = ?3, source_status = ?4, \\

source_updated_at = ?5, updated_at = ?6 \\

WHERE id = ?7",

params\![

issue.title,

issue.body,

labels_json,

issue.state.as_str(),

issue.updated_at,

now,

link_id,

\],

)

.map_err(\|e\| CoreError::internal(format!("github_issues update: {e}")))?;

if let Some(task_id) = task_id {

self.update_task_metadata(&task_id, issue, title_locked)?;

}

let link = self.get_link(&link_id)?.ok_or_else(\|\| {

CoreError::internal("github_issues row vanished after update")

})?;

Ok(UpsertOutcome::Updated(link))

}

// ── Nova ─────────────────────────────────────────────────

None =\> {

let link_id = Uuid::new_v4().to_string();

// Cria o card na coluna 'todo'.

let task = TasksService::new(self.db).create(NewTask {

title: issue.title.clone(),

description: issue.body.clone(),

priority: TaskPriority::Normal,

status: TaskStatus::Todo,

project_id: project_id.map(\|p\| p.to_string()),

parent_task_id: None,

due_at: None,

estimate_min: None,

// Labels → tags com prefixo \`gh:\`.

tags: Some(

issue

.labels

.iter()

.map(\|l\| format!("{GH_TAG_PREFIX}{l}"))

.collect(),

),

})?;

conn.execute(

"INSERT INTO github_issues \\

(id, source, external_id, repo, issue_number, issue_url, title, body, \\

labels, source_status, source_updated_at, task_id, title_locked, \\

created_at, updated_at) \\

VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?13)",

params\![

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

\],

)

.map_err(\|e\| CoreError::internal(format!("github_issues insert: {e}")))?;

let link = self.get_link(&link_id)?.ok_or_else(\|\| {

CoreError::internal("github_issues row vanished after insert")

})?;

Ok(UpsertOutcome::Created(link))

}

}

}

/// Atualiza título/descrição/tags do card SEM tocar em status,

/// priority, project_id, kanban_order, due_at ou estimate_min.

///

/// \`title_locked\` = true → não reescreve título/descrição.

/// Tags: união (union), nunca remove.

fn update_task_metadata(

&self,

task_id: &str,

issue: &GithubIssue,

title_locked: bool,

) -\> Result\<(), CoreError\> {

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

// União de tags: preserva as tags manuais do usuário.

let mut merged: Vec\<String\> = task.tags.clone().unwrap_or_default();

for label in &issue.labels {

let tagged = format!("{GH_TAG_PREFIX}{label}");

if !merged.contains(&tagged) {

merged.push(tagged);

}

}

let new_tags = if merged.is_empty() { None } else { Some(merged) };

if new_title == task.title

&& new_description == task.description

&& new_tags == task.tags

{

return Ok(());

}

let mut patch = crate::domain::task::UpdateTask::default();

patch.title = Some(new_title);

patch.description = Some(new_description);

patch.tags = Some(new_tags);

tasks.update(task_id, patch)?;

Ok(())

}

/// Lê um vínculo por id.

pub fn get_link(&self, id: &str) -\> Result\<Option\<GithubIssueLink\>, CoreError\> {

let conn = self.db.writer();

let link = conn

.query_row(

"SELECT id, source, external_id, repo, issue_number, issue_url, title, \\

labels, source_status, task_id, title_locked, created_at, updated_at \\

FROM github_issues WHERE id = ?1",

params\![id\],

\|r\| {

let labels_str: Option\<String\> = r.get(7)?;

let labels = labels_str.and_then(\|s\| serde_json::from_str(&s).ok());

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

title_locked: r.get::\<\_, i64\>(10)? != 0,

created_at: r.get(11)?,

updated_at: r.get(12)?,

})

},

)

.optional()

.map_err(\|e\| CoreError::internal(format!("github_issues get: {e}")))?;

Ok(link)

}

/// Lista vínculos, opcionalmente filtrados por project do card.

pub fn list_links(&self, project_id: Option\<&str\>) -\> Result\<Vec\<GithubIssueLink\>, CoreError\> {

let conn = self.db.writer();

let sql = match project_id {

Some(\_) =\> {

"SELECT g.id FROM github_issues g \\

JOIN tasks t ON t.id = g.task_id \\

WHERE g.task_id IS NOT NULL AND t.project_id = ?1 \\

ORDER BY g.issue_number ASC"

}

None =\> {

"SELECT g.id FROM github_issues g \\

WHERE g.task_id IS NOT NULL \\

ORDER BY g.issue_number ASC"

}

};

let ids: Vec\<String\> = {

let mut stmt = conn

.prepare(sql)

.map_err(\|e\| CoreError::internal(format!("prepare list_links: {e}")))?;

let rows = match project_id {

Some(p) =\> stmt

.query_map(params\![p\], \|r\| r.get::\<\_, String\>(0))

.map_err(\|e\| CoreError::internal(format!("list_links: {e}")))?,

None =\> stmt

.query_map(\[\], \|r\| r.get::\<\_, String\>(0))

.map_err(\|e\| CoreError::internal(format!("list_links: {e}")))?,

};

let mut v = Vec::new();

for r in rows {

v.push(r.map_err(\|e\| CoreError::internal(format!("row: {e}")))?);

}

v

};

drop(conn);

let mut out = Vec::with_capacity(ids.len());

for id in ids {

if let Some(link) = self.get_link(&id)? {

out.push(link);

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

) -\> Result\<GithubIssueLink, CoreError\> {

// Valida que o task existe.

TasksService::new(self.db).get(task_id)?;

let conn = self.db.writer();

let external_id = format!("{repo}#{number}");

let existing: Option\<String\> = conn

.query_row(

"SELECT id FROM github_issues WHERE source = ?1 AND external_id = ?2",

params\![SOURCE_GITHUB, external_id\],

\|r\| r.get(0),

)

.optional()

.map_err(\|e\| CoreError::internal(format!("link lookup: {e}")))?;

let link_id = match existing {

Some(id) =\> id,

None =\> {

let id = Uuid::new_v4().to_string();

let now = chrono::Utc::now().to_rfc3339();

conn.execute(

"INSERT INTO github_issues \\

(id, source, external_id, repo, issue_number, issue_url, title, \\

labels, source_status, task_id, title_locked, created_at, updated_at) \\

VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 'open', ?8, 0, ?9, ?9)",

params\![

id,

SOURCE_GITHUB,

external_id,

repo,

number,

format!("https://github.com/{repo}/issues/{number}"),

format!("Issue \#{number}"),

task_id,

now,

\],

)

.map_err(\|e\| CoreError::internal(format!("link insert: {e}")))?;

id

}

};

drop(conn);

// Garante que o task aponte para o link (e vice-versa).

let conn = self.db.writer();

conn.execute(

"UPDATE github_issues SET task_id = ?1, updated_at = ?2 WHERE id = ?3",

params\![task_id, chrono::Utc::now().to_rfc3339(), link_id\],

)

.map_err(\|e\| CoreError::internal(format!("link update: {e}")))?;

drop(conn);

self.get_link(&link_id)?

.ok_or_else(\|\| CoreError::internal("link vanished"))

}

/// Remove o vínculo (o card permanece).

pub fn unlink_task(&self, task_id: &str) -\> Result\<(), CoreError\> {

let conn = self.db.writer();

conn.execute(

"UPDATE github_issues SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2",

params\![chrono::Utc::now().to_rfc3339(), task_id\],

)

.map_err(\|e\| CoreError::internal(format!("unlink: {e}")))?;

Ok(())

}

/// Marca o card como "editado pelo usuário" (bloqueia re-sync de

/// título/descrição). Chamado pelo \`tasks_update\` quando o título ou

/// a descrição mudam.

pub fn lock_title(&self, task_id: &str) -\> Result\<(), CoreError\> {

let conn = self.db.writer();

conn.execute(

"UPDATE github_issues SET title_locked = 1, updated_at = ?1 WHERE task_id = ?2",

params\![chrono::Utc::now().to_rfc3339(), task_id\],

)

.map_err(\|e\| CoreError::internal(format!("lock_title: {e}")))?;

Ok(())

}

}

/// Resultado interno de um upsert.

\#\[derive(Debug, Clone)\]

enum UpsertOutcome {

Created(GithubIssueLink),

Updated(GithubIssueLink),

Skipped(GithubIssueLink),

}

> **Correção obrigatória:** upsert_issue e update_task_metadata ambos acessam self.db.writer() (um MutexGuard). TasksService::create / update também pegam o guard → **deadlock** (Mutex não é reentrante).
>
> **Correção:** em upsert_issue, pegue o guard **após** as chamadas a TasksService, ou use drop(conn) antes de chamar o service. O mesmo vale em link_task (já feito: drop(conn) antes do segundo bloco). O implementador DEVE revisar os pontos de lock — este é o bug mais provável da implementação.

### 2.3 crates/auradesk-core/src/domain/settings_key.rs (EDITAR)

Adicionar 4 variantes + as_str + from_str + ALL:

/// Repositório GitHub de origem ("owner/repo").

GithubRepo,

/// Project do Kanban onde as issues importadas caem (null = sem projeto).

GithubProjectId,

/// Labels cujos issues devem ser importados (null = todas).

GithubAutoImportLabels,

/// Labels aplicadas a todo card importado (null = nenhuma).

GithubDefaultLabels,

Strings exatas (canônicas, não mudam):

| **Variante**           | **as_str()**                |
|:-----------------------|:----------------------------|
| GithubRepo             | "github.repo"               |
| GithubProjectId        | "github.project_id"         |
| GithubAutoImportLabels | "github.auto_import_labels" |
| GithubDefaultLabels    | "github.default_labels"     |

Validação em application/settings.rs::validate:

- GithubRepo → value.is_string()

- GithubProjectId → value.is_null() \|\| value.is_string()

- GithubAutoImportLabels / GithubDefaultLabels → value.is_null() \|\| value.is_array()

### 2.4 crates/auradesk-core/src/lib.rs (EDITAR)

pub mod domain; // já existe — domain/mod.rs precisa declarar \`pub mod github;\`

pub mod application; // já existe — application/mod.rs precisa declarar \`pub mod github;\`

Verificar crates/auradesk-core/src/domain/mod.rs e crates/auradesk-core/src/application/mod.rs e adicionar os pub mod github;.

### 2.5 crates/auradesk/src/github.rs (NOVO — shell Tauri)

//! Implementação da porta \`IssueFetcher\` sobre o \`gh\` CLI (ADR-0013).

//!

//! Este é o ÚNICO lugar do AuraDesk que fala com o GitHub.

//! O token nunca é lido, copiado ou persistido: o \`gh\` gerencia a

//! credencial no keyring do sistema operacional.

use std::process::Command;

use auradesk_core::domain::github::{

GithubAuthStatus, GithubIssue, IssueFetcher, IssueQuery, IssueState,

};

use auradesk_core::CoreError;

/// Fetcher sobre o \`gh\` CLI.

pub struct GhCliIssueFetcher;

impl GhCliIssueFetcher {

/// Cria o fetcher.

pub fn new() -\> Self {

Self

}

/// Executa \`gh\` e devolve (exit_code, stdout, stderr).

fn run(&self, args: &\[&str\]) -\> Result\<(i32, String, String), CoreError\> {

let output = Command::new("gh")

.args(args)

.output()

.map_err(\|e\| {

if e.kind() == std::io::ErrorKind::NotFound {

CoreError::validation(

"gh",

"GitHub CLI (gh) not found in PATH",

)

} else {

CoreError::internal(format!("spawn gh: {e}"))

}

})?;

Ok((

output.status.code().unwrap_or(-1),

String::from_utf8_lossy(&output.stdout).to_string(),

String::from_utf8_lossy(&output.stderr).to_string(),

))

}

}

impl Default for GhCliIssueFetcher {

fn default() -\> Self {

Self::new()

}

}

impl IssueFetcher for GhCliIssueFetcher {

fn fetch_issues(&self, query: &IssueQuery) -\> Result\<Vec\<GithubIssue\>, CoreError\> {

let state = if query.include_closed { "all" } else { "open" };

let limit = query.limit.unwrap_or(100).to_string();

let mut args: Vec\<String\> = vec\![

"issue".into(),

"list".into(),

"--repo".into(),

query.repo.clone(),

"--state".into(),

state.into(),

"--limit".into(),

limit,

"--json".into(),

"number,title,body,labels,state,url,updatedAt".into(),

\];

if let Some(label) = &query.label {

args.push("--label".into());

args.push(label.clone());

}

let arg_refs: Vec\<&str\> = args.iter().map(\|s\| s.as_str()).collect();

let (code, stdout, stderr) = self.run(&arg_refs)?;

if code != 0 {

return Err(map_gh_error(&stderr, code));

}

let raw: serde_json::Value = serde_json::from_str(&stdout)

.map_err(\|e\| CoreError::internal(format!("parse gh json: {e}")))?;

let arr = raw

.as_array()

.ok_or_else(\|\| CoreError::internal("gh json is not an array"))?;

let mut out = Vec::with_capacity(arr.len());

for item in arr {

let number = item

.get("number")

.and_then(\|v\| v.as_i64())

.ok_or_else(\|\| CoreError::internal("gh issue missing number"))?;

let title = item

.get("title")

.and_then(\|v\| v.as_str())

.unwrap_or("")

.to_string();

let body = item

.get("body")

.and_then(\|v\| v.as_str())

.map(\|s\| s.to_string());

let url = item

.get("url")

.and_then(\|v\| v.as_str())

.unwrap_or("")

.to_string();

let state = match item.get("state").and_then(\|v\| v.as_str()) {

Some("closed") =\> IssueState::Closed,

\_ =\> IssueState::Open,

};

let updated_at = item

.get("updatedAt")

.and_then(\|v\| v.as_str())

.map(\|s\| s.to_string());

let labels = item

.get("labels")

.and_then(\|v\| v.as_array())

.map(\|arr\| {

arr.iter()

.filter_map(\|l\| {

// \`gh\` retorna labels como array de strings

// OU array de objetos {name}; aceita ambos.

l.get("name")

.and_then(\|n\| n.as_str())

.or_else(\|\| l.as_str())

.map(\|s\| s.to_string())

})

.collect()

})

.unwrap_or_default();

out.push(GithubIssue {

number,

repo: query.repo.clone(),

url,

title,

body,

labels,

state,

updated_at,

});

}

Ok(out)

}

fn auth_status(&self) -\> Result\<Option\<String\>, CoreError\> {

let (code, stdout, stderr) = self.run(&\["auth", "status", "--hostname", "github.com"\])?;

if code != 0 {

return Ok(None);

}

// \`gh auth status\` imprime "✓ Logged in to github.com account RAGton".

let account = stdout

.lines()

.find_map(\|l\| {

l.split("account ")

.nth(1)

.map(\|a\| a.trim().trim_end_matches('(').trim().to_string())

})

.or_else(\|\| {

stderr

.lines()

.find_map(\|l\| l.split("account ").nth(1).map(\|a\| a.trim().to_string()))

});

Ok(account)

}

}

/// Mapeia a stderr do \`gh\` para um \`CoreError\` com campo estável.

fn map_gh_error(stderr: &str, code: i32) -\> CoreError {

let lower = stderr.to_lowercase();

let field = if lower.contains("not logged") \|\| lower.contains("authentication") {

"github.auth"

} else if lower.contains("rate limit") {

"github.rate_limit"

} else if lower.contains("could not resolve") \|\| lower.contains("not found") {

"github.repo"

} else {

"github.unavailable"

};

CoreError::validation(field, format!("gh failed (exit {code}): {stderr}"))

}

> Nota: crates/auradesk/Cargo.toml precisa de serde_json — **já tem** (serde_json = "1"). Nenhuma dep nova.

### 2.6 crates/auradesk/src/runtime.rs (EDITAR)

Adicionar ao AppState:

pub github_fetcher: Arc\<GhCliIssueFetcher\>,

e em setup(): github_fetcher: Arc::new(GhCliIssueFetcher::new()),.

Comandos IPC (adicionar em pub mod ipc e no invoke_handler!):

/// Importa issues do GitHub como cards no Kanban.

\#\[tauri::command\]

pub fn github_sync_issues(

state: State\<'\_, AppState\>,

project_id: Option\<String\>,

label_filter: Option\<String\>,

) -\> Result\<GithubSyncSummary, String\> {

let db = db_from(&state);

let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());

svc.sync(project_id.as_deref(), label_filter.as_deref())

.map_err(\|e\| format!("github_sync_issues: {e}"))

}

/// Lista os vínculos issue↔task.

\#\[tauri::command\]

pub fn github_issues_list(

state: State\<'\_, AppState\>,

project_id: Option\<String\>,

) -\> Result\<Vec\<GithubIssueLink\>, String\> {

let db = db_from(&state);

let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());

svc.list_links(project_id.as_deref())

.map_err(\|e\| format!("github_issues_list: {e}"))

}

/// Vincula uma issue a um card existente.

\#\[tauri::command\]

pub fn github_link_task(

state: State\<'\_, AppState\>,

task_id: String,

repo: String,

number: i64,

) -\> Result\<GithubIssueLink, String\> {

let db = db_from(&state);

let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());

svc.link_task(&task_id, &repo, number)

.map_err(\|e\| format!("github_link_task: {e}"))

}

/// Remove o vínculo issue↔task.

\#\[tauri::command\]

pub fn github_unlink_task(

state: State\<'\_, AppState\>,

task_id: String,

) -\> Result\<(), String\> {

let db = db_from(&state);

let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());

svc.unlink_task(&task_id)

.map_err(\|e\| format!("github_unlink_task: {e}"))

}

/// Verifica disponibilidade e autenticação do GitHub CLI.

\#\[tauri::command\]

pub fn github_check_auth() -\> GithubAuthStatus {

let fetcher = GhCliIssueFetcher::new();

match fetcher.auth_status() {

Ok(Some(account)) =\> GithubAuthStatus {

available: true,

authenticated: true,

account: Some(account),

message: None,

},

Ok(None) =\> GithubAuthStatus {

available: true,

authenticated: false,

account: None,

message: Some("github.authRequired".to_string()),

},

Err(\_) =\> GithubAuthStatus {

available: false,

authenticated: false,

account: None,

message: Some("github.cliMissing".to_string()),

},

}

}

Registrar no invoke_handler!: ipc::github_sync_issues, ipc::github_issues_list, ipc::github_link_task, ipc::github_unlink_task, ipc::github_check_auth.

**Hook de title_locked:** em ipc::tasks_update, se o patch altera title ou description, chamar GithubSyncService::lock_title(&id). Implementação sugerida (dentro de tasks_update, após svc.update):

let updated = svc.update(&input.id, p).map_err(...)?;

if patch.title.is_some() \|\| patch.description.is_some() {

let gh = GithubSyncService::new(&db, state.github_fetcher.as_ref());

let \_ = gh.lock_title(&input.id);

}

Ok(updated)

### 2.7 crates/auradesk-core/src/data_io — bump de versão

crates/auradesk-core/src/application/data_io.rs:

- SCHEMA_VERSION: u32 = 1 → 2

- DataBundle ganha github_issues: Vec\<GithubIssueLink\>

- ImportSummary ganha github_issues: usize

- export() inclui GithubSyncService::new(db, fetcher) — **problema**: o export não deve depender de um fetcher. Solução: criar um serviço de *leitura-only* sem fetcher, ou ler a tabela direto. **Recomendação: ler a tabela direto** com um helper fn list_all_links_raw(db) -\> Vec\<GithubIssueLink\> em application/github.rs, e o GithubSyncService delega a ele. import() faz o upsert das linhas em github_issues **depois** das tasks (FK task_id → tasks.id).

- **Back-compat:** import() aceita version == 1 (bundle v1 sem github_issues) e version == 2. Usar \#\[serde(default)\] no campo github_issues e validar version == 1 \|\| version == 2.

### 2.8 Frontend — apps/web/src/lib/ipc.ts (EDITAR)

// --- GitHub Issues → Kanban ------------------------------------------------

export type GithubIssueState = "open" \| "closed";

export interface GithubIssueLink {

id: string;

source: string;

external_id: string;

repo: string;

issue_number: number;

issue_url: string;

title: string;

labels: string\[\] \| null;

source_status: GithubIssueState;

task_id: string \| null;

title_locked: boolean;

created_at: string;

updated_at: string;

}

export interface GithubSyncSummary {

created: number;

updated: number;

skipped: number;

issues: GithubIssueLink\[\];

}

export interface GithubAuthStatus {

available: boolean;

authenticated: boolean;

account: string \| null;

message: string \| null;

}

export const githubApi = {

syncIssues: (projectId?: string \| null, labelFilter?: string \| null) =\>

ipc\<GithubSyncSummary\>("github_sync_issues", { projectId, labelFilter }),

listIssues: (projectId?: string \| null) =\>

ipc\<GithubIssueLink\[\]\>("github_issues_list", { projectId }),

linkTask: (taskId: string, repo: string, number: number) =\>

ipc\<GithubIssueLink\>("github_link_task", { taskId, repo, number }),

unlinkTask: (taskId: string) =\> ipc\<void\>("github_unlink_task", { taskId }),

checkAuth: () =\> ipc\<GithubAuthStatus\>("github_check_auth"),

};

### 2.9 Frontend — apps/web/src/components/TaskCard.tsx (EDITAR)

Props novas: github?: GithubIssueLink.

Render (dentro do bloco de chips, antes das tags):

{github ? (

\<a

href={github.issue_url}

target="\_blank"

rel="noopener noreferrer"

onClick={(e) =\> e.stopPropagation()}

className={cn(

"rounded px-1.5 py-0.5 font-medium tabular-nums",

github.source_status === "closed"

? "bg-slate-700/60 text-slate-400"

: "bg-violet-500/15 text-violet-300"

)}

title={t(

github.source_status === "closed"

? "kanban.github.issueClosed"

: "kanban.github.issueOpen"

)}

\>

\#{github.issue_number}

\</a\>

) : null}

### 2.10 Frontend — apps/web/src/components/KanbanBoard.tsx (EDITAR)

- Receber githubLinks: GithubIssueLink\[\] e onSyncGitHub / syncing.

- Indexar por task_id em useMemo.

- Passar github={githubByTaskId.get(task.id)} ao TaskCard.

- Botão no header (ao lado do PriorityFilter):

\<button

type="button"

onClick={() =\> void onSyncGitHub()}

disabled={syncing}

className="rounded-md bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-50 transition-colors"

\>

{syncing ? t("kanban.github.syncing") : t("kanban.github.importButton")}

\</button\>

### 2.11 Frontend — apps/web/src/pages/KanbanPage.tsx (EDITAR)

- const \[githubLinks, setGithubLinks\] = useState\<GithubIssueLink\[\]\>(\[\])

- const \[syncing, setSyncing\] = useState(false)

- useEffect para carregar githubApi.listIssues() no mount.

- handleSyncGitHub: chama githubApi.syncIssues(), atualiza githubLinks com summary.issues, chama onMutated() (recarrega tasks), e mostra toast com t("kanban.github.syncDone", { created, updated }).

- Error path: toast.error(t("kanban.github.syncError") + ": " + msg).

### 2.12 i18n — apps/web/locales/pt-BR.json e apps/web/locales/en.json

Adicionar sob kanban:

**pt-BR.json**

"github": {

"importButton": "Importar issues",

"syncing": "Importando...",

"syncDone": "Issues importadas: {{created}} novas, {{updated}} atualizadas",

"syncError": "Falha ao importar issues do GitHub",

"issueOpen": "Issue aberta no GitHub",

"issueClosed": "Issue fechada no GitHub",

"cliMissing": "GitHub CLI não encontrado. Instale o gh para importar issues.",

"authRequired": "GitHub CLI não autenticado. Rode gh auth login.",

"repoMissing": "Repositório não encontrado ou sem permissão de leitura."

}

**en.json**

"github": {

"importButton": "Import issues",

"syncing": "Importing...",

"syncDone": "Issues imported: {{created}} new, {{updated}} updated",

"syncError": "Failed to import issues from GitHub",

"issueOpen": "Issue open on GitHub",

"issueClosed": "Issue closed on GitHub",

"cliMissing": "GitHub CLI not found. Install gh to import issues.",

"authRequired": "GitHub CLI not authenticated. Run gh auth login.",

"repoMissing": "Repository not found or no read permission."

}

> **Caminho real dos locales:** apps/web/locales/pt-BR.json e apps/web/locales/en.json (NÃO apps/web/src/locales/). O import em apps/web/src/lib/i18n.ts é "../../locales/pt-BR.json" relativo a apps/web/src/lib/ → apps/web/locales/.

### 2.13 docs/decisions/0013-github-issues-to-kanban.md (NOVO)

O ADR já escrito por este parecer. **Ajustar** o link interno quebrado (0003-github-issues-to-kanban.md → 0013-github-issues-to-kanban.md) e remover o caractere CJK acidental do comentário da migration (§1).

## 3. Lista de arquivos

### Criar

| **Caminho** | **Conteúdo** |
|:---|:---|
| crates/auradesk-core/migrations/V002\_\_github_issues.sql | DDL (§1) |
| crates/auradesk-core/src/domain/github.rs | tipos + IssueFetcher (§2.1) |
| crates/auradesk-core/src/application/github.rs | GithubSyncService (§2.2) |
| crates/auradesk/src/github.rs | GhCliIssueFetcher (§2.5) |
| crates/auradesk-core/tests/github_sync.rs | testes (§4) |
| docs/decisions/0013-github-issues-to-kanban.md | ADR (§2.13) |

### Editar

| **Caminho** | **Mudança** |
|:---|:---|
| crates/auradesk-core/src/infrastructure/migrate.rs | registrar V002 |
| crates/auradesk-core/src/domain/mod.rs | pub mod github; |
| crates/auradesk-core/src/application/mod.rs | pub mod github; |
| crates/auradesk-core/src/domain/settings_key.rs | 4 keys (§2.3) |
| crates/auradesk-core/src/application/settings.rs | validate() p/ as 4 keys |
| crates/auradesk-core/src/application/data_io.rs | v1→v2 + github_issues (§2.7) |
| crates/auradesk/src/lib.rs | pub mod github; |
| crates/auradesk/src/runtime.rs | AppState, 5 comandos (§2.6) |
| apps/web/src/lib/ipc.ts | githubApi (§2.8) |
| apps/web/src/components/TaskCard.tsx | badge \#123 (§2.9) |
| apps/web/src/components/KanbanBoard.tsx | botão + wiring (§2.10) |
| apps/web/src/pages/KanbanPage.tsx | estado + handler (§2.11) |
| apps/web/locales/pt-BR.json | bloco kanban.github (§2.12) |
| apps/web/locales/en.json | bloco kanban.github (§2.12) |

### NÃO tocar

| **Caminho** | **Motivo** |
|:---|:---|
| crates/auradesk-core/src/capabilities.rs | registry vazio por design; teste registry_is_empty_in_phase_0 falha se populado. Fora do MVP. |
| crates/auradesk-mcp/\*\* | MCP shell não expõe a feature no MVP. |
| crates/auradesk-core/Cargo.toml | **nenhuma dep nova**. |
| crates/auradesk/Cargo.toml | **nenhuma dep nova** (serde_json já presente). |
| docs/licensing/dependency-license-audit.md | **nenhuma dep nova** → sem mudança. |

## 4. Plano de testes

### 4.1 Core — com FakeIssueFetcher (sem rede, sem gh)

Novo arquivo: crates/auradesk-core/tests/github_sync.rs

//! Testes do sync GitHub → Kanban (ADR-0013).

//! Roda com um \`FakeIssueFetcher\` in-memory: sem rede, sem \`gh\`, sem Tauri.

//!

//! Run with: cargo test -p auradesk-core --test github_sync

use auradesk_core::application::github::GithubSyncService;

use auradesk_core::application::settings::SettingsService;

use auradesk_core::application::tasks::TasksService;

use auradesk_core::domain::github::{

GithubIssue, IssueFetcher, IssueQuery, IssueState,

};

use auradesk_core::domain::settings_key::SettingsKey;

use auradesk_core::domain::task::TaskFilter;

use auradesk_core::infrastructure::db::Db;

use auradesk_core::CoreError;

use std::sync::Mutex;

/// Fetcher fake: devolve issues fixas, sem tocar a rede.

struct FakeIssueFetcher {

issues: Mutex\<Vec\<GithubIssue\>\>,

calls: Mutex\<Vec\<IssueQuery\>\>,

}

impl FakeIssueFetcher {

fn new(issues: Vec\<GithubIssue\>) -\> Self {

Self {

issues: Mutex::new(issues),

calls: Mutex::new(Vec::new()),

}

}

fn set(&self, issues: Vec\<GithubIssue\>) {

\*self.issues.lock().unwrap() = issues;

}

fn call_count(&self) -\> usize {

self.calls.lock().unwrap().len()

}

}

impl IssueFetcher for FakeIssueFetcher {

fn fetch_issues(&self, query: &IssueQuery) -\> Result\<Vec\<GithubIssue\>, CoreError\> {

self.calls.lock().unwrap().push(IssueQuery {

repo: query.repo.clone(),

label: query.label.clone(),

include_closed: query.include_closed,

limit: query.limit,

});

Ok(self.issues.lock().unwrap().clone())

}

fn auth_status(&self) -\> Result\<Option\<String\>, CoreError\> {

Ok(Some("RAGton".to_string()))

}

}

fn issue(number: i64, title: &str, state: IssueState) -\> GithubIssue {

GithubIssue {

number,

repo: "RAGton/aura-desk".to_string(),

url: format!("https://github.com/RAGton/aura-desk/issues/{number}"),

title: title.to_string(),

body: Some(format!("body of \#{number}")),

labels: vec\!["bug".to_string()\],

state,

updated_at: Some("2026-10-20T12:00:00Z".to_string()),

}

}

fn fresh_db() -\> Db {

let db = Db::open_in_memory().expect("open in-memory db");

let settings = SettingsService::new(&db);

settings

.set(SettingsKey::GithubRepo, serde_json::json!("RAGton/aura-desk"))

.expect("set github.repo");

db

}

\#\[test\]

fn sync_creates_one_card_per_issue() { /\* 2 issues → created == 2 \*/ }

\#\[test\]

fn sync_is_idempotent_second_run_updates_nothing_new() {

// 1º sync: created == 1. 2º sync: created == 0, updated == 1.

// tasks na DB continua == 1.

}

\#\[test\]

fn sync_does_not_clobber_manual_status() {

// sync → card em 'todo'.

// tasks_set_status(id, Doing).

// sync de novo → status continua 'doing'.

}

\#\[test\]

fn sync_does_not_clobber_manual_title_when_locked() {

// sync → título original.

// tasks_update(title = "meu título") → lock_title.

// sync com issue renomeada → título do card continua "meu título".

// github_issues.title reflects o valor do GitHub.

}

\#\[test\]

fn sync_unions_tags_never_removes_manual_tags() {

// card com tag "manual" + sync com label "bug".

// tags == \["manual", "gh:bug"\].

}

\#\[test\]

fn sync_labels_are_prefixed_with_gh() {

// issue com label "bug" → tag "gh:bug".

}

\#\[test\]

fn closed_issue_does_not_move_the_card_to_done() {

// sync com issue open → card todo.

// issue vira closed → sync → source_status == "closed",

// mas tasks.status continua "todo".

}

\#\[test\]

fn link_task_creates_vínculo_and_unlink_removes_it() { /\* ... \*/ }

\#\[test\]

fn unlink_keeps_the_card() {

// unlink → task continua existindo; github_issues.task_id é NULL.

}

\#\[test\]

fn deleting_the_task_sets_task_id_to_null() {

// ON DELETE SET NULL: vínculo sobrevive, task_id NULL.

}

\#\[test\]

fn missing_github_repo_setting_is_a_validation_error() {

// db sem github.repo → sync → CoreError::Validation.

}

\#\[test\]

fn fetcher_is_called_with_the_configured_repo() {

// assert fetcher.call_count() == 1 e a query.repo == "RAGton/aura-desk".

}

### 4.2 Shell — teste de integração com gh real

**Condicional**: \#\[ignore\] por padrão, roda só com gh autenticado.

// crates/auradesk/tests/github_cli.rs

\#\[test\]

\#\[ignore = "requires gh CLI authenticated"\]

fn gh_cli_lists_issues_of_configured_repo() { /\* ... \*/ }

### 4.3 Comandos de validação

cd /data/projects/AuraDesk

\# 1. Compila o core (isolado, sem Tauri — prova que ADR-002 foi respeitado).

cargo build -p auradesk-core --offline

\# 2. Prova de que o core NÃO importa nada OS-specific.

\# Deve retornar vazio. Se retornar algo, ADR-002 foi violado.

cargo tree -p auradesk-core --offline --prefix none \| grep -Ei 'tauri\|reqwest\|ureq\|hyper\|tokio' \\

&& echo "FALHA: dep OS-specific no core" \|\| echo "OK: core limpo"

\# 3. Testes do core.

cargo test -p auradesk-core --offline --test github_sync

\# 4. Suite completa do core (ATENÇÃO: há 1 falha pré-existente — ver §5).

cargo test -p auradesk-core --offline

\# 5. Compila o shell Tauri.

cargo build -p auradesk --offline

\# 6. Clippy (o repo já tem \`#\[allow(clippy::should_implement_trait)\]\` — não

\# introduza novos lints).

cargo clippy -p auradesk-core -p auradesk --offline -- -D warnings

\# 7. Typecheck do frontend.

cd apps/web && npx tsc --noEmit

\# 8. Strings hard-coded (i18n) — o repo tem esse gate.

cd /data/projects/AuraDesk && cargo run --bin check-strings --offline

\# 9. Verifica que o SQL da migration é válido (aplica em DB in-memory).

cargo test -p auradesk-core --offline --test github_sync \# cobre via Db::open_in_memory

\# 10. Confirma que o registry de capabilities continua vazio (não foi tocado).

cargo test -p auradesk-core --offline --test capabilities_consistent

\# 11. Smoke manual do gh (o repo está vazio hoje — deve retornar \[\]).

gh issue list --repo RAGton/aura-desk --state open --json number,title,labels,state,url

## 5. Riscos e pendências

### 5.1 Baseline do repositório (ATENÇÃO — falha pré-existente)

cargo test -p auradesk-core **já falha** em HEAD (commit 380eb1b, sem relação com esta feature):

---- test_recurrence_daily_weekly_monthly_on_resolve stdout ----

thread '...' panicked at crates/auradesk-core/tests/time_flows_service.rs:214:5:

assertion \`left == right\` failed

left: 2026-10-25T09:00:00Z

right: 2026-10-19T09:00:00Z

O teste espera fire_at == 2026-10-19, mas o código avança a partir de base_time e o cálculo lands em 2026-10-25. **Não é regressão desta feature.** O implementador deve:

1.  Rodar cargo test -p auradesk-core **antes** de começar, e registrar o baseline.

2.  Não tentar consertar isso (fora de escopo) — mas **reportar** se a falha mudar de assinatura.

Alternativa: se o dono quiser, abrir uma task separada para o bug de recorrência de reminder.

### 5.2 Riscos

| **\#** | **Risco** | **Mitigação** |
|:---|:---|:---|
| R1 | **Deadlock** no MutexGuard do Db (TasksService + GithubSyncService pegam o guard) | §2.2 nota de correção: drop(conn) antes de chamar TasksService. Revisar TODOS os pontos de lock. |
| R2 | gh ausente no PATH do usuário final | github_check_auth + mensagem i18n github.cliMissing com link de instalação |
| R3 | gh não autenticado | github.authRequired → instrução gh auth login |
| R4 | Rate limit do GitHub | github.rate_limit mapeado no map_gh_error; sem retry loop no MVP |
| R5 | Import acidental de centenas de issues | --limit 200 no fetch + filtro de label opcional + confirmação no botão quando created \> 0 |
| R6 | Loss de dados no export/import sem github_issues | §2.7 — bump para v2 com back-compat de leitura da v1 |
| R7 | check-strings acusando strings hard-coded no Rust/TSX novo | Usar t("kanban.github.\*") em TODO string de UI; nada de literal em runtime.rs |
| R8 | Regressão no data_io (bundle v1 importado em DB v2) | Teste dedicado: importar bundle v1 e v2 |
| R9 | GitHub issue com 0 labels / body null | labels vira \[\], body vira None — coberto por Option no schema |

### 5.3 Perguntas em aberto (bloqueantes para o implementador? NÃO — assumidas)

| **\#** | **Pergunta** | **Assunção adotada** |
|:---|:---|:---|
| Q1 | O import deve cair num project específico ou no "Sem projeto"? | github.project_id (nullable). Se null → card sem project. |
| Q2 | Issue fechada deve ser importada? | Não. O fetch usa --state open por padrão. include_closed existe na porta mas não é exposto no IPC do MVP. |
| Q3 | Milestone → project? | Fora do MVP. |
| Q4 | github.repo default = "RAGton/aura-desk"? | Sim — hardcoded como default do usuário, e **seed** em V002? NÃO: não semear em migration (o repo do usuário é específico do dono, não do software). O default fica só na UI/sugestão. **github.repo NÃO é seeded no V002.** Se o settings não tiver a key, sync retorna CoreError::Validation("github.repo") e a UI pede para configurar. |
| Q5 | Onde o usuário configura github.repo? | SettingsPage.tsx (seção nova "GitHub"). **Opcional** no MVP — o botão de importar pode falhar com mensagem clara e o usuário edita via settings_set (que já existe e aceita key nova). |

## 6. Ordem de execução sugerida

1.  V002 + migrate.rs + domain/github.rs + application/github.rs + settings_key.rs + settings.rs → cargo build -p auradesk-core

2.  tests/github_sync.rs com FakeIssueFetcher → cargo test -p auradesk-core --test github_sync

3.  crates/auradesk/src/github.rs + runtime.rs → cargo build -p auradesk

4.  data_io.rs v2 + teste de back-compat

5.  Frontend: ipc.ts → TaskCard.tsx → KanbanBoard.tsx → KanbanPage.tsx

6.  i18n (pt-BR.json + en.json) → npx tsc --noEmit + check-strings

7.  Validação completa (§4.3) + cargo clippy -D warnings

8.  Commit por arquivo (convenção do dono: conventional commits, SemVer por repo)
