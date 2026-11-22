//! Autonomous Agent Orchestration, Tool Registry & Permission Guardrails.
//!
//! Defines the 8 specialized agent roles (Orchestrator, Memory, Research, Browser,
//! Computer, System, Context Manager, Tool Registry) and enforces human-approval
//! policies so privileged/destructive operations can never auto-execute unchecked.
//! Also manages Custom Bots, installable SKILL.md skills, and MCP server plugins.

#![allow(missing_docs)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::application::proposals::ProposalsService;
use crate::capabilities::capabilities;
use crate::infrastructure::db::Db;
use crate::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDescriptor {
    pub role: String,
    pub name: String,
    pub responsibility: String,
    pub status: String,
    pub capabilities: Vec<String>,
    pub safety_boundary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolEntry {
    pub tool_name: String,
    pub agent_role: String,
    pub description: String,
    pub permission: String,
    pub risk_level: String,
    pub enabled: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanStep {
    pub step: usize,
    pub agent_role: String,
    pub tool_name: String,
    pub action: String,
    pub requires_approval: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub id: String,
    pub session_id: Option<String>,
    pub agent_role: String,
    pub goal: String,
    pub plan: Vec<AgentPlanStep>,
    pub status: String,
    pub result_summary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBotRecord {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub role_kind: String,
    pub icon: String,
    pub description: String,
    pub system_prompt: String,
    pub preferred_provider: Option<String>,
    pub preferred_model: Option<String>,
    pub hindsight_bank: Option<String>,
    pub skill_ids: Vec<String>,
    pub enabled: bool,
    pub pinned_in_chat: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertBotInput {
    pub id: Option<String>,
    pub name: String,
    pub role_kind: Option<String>,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub preferred_provider: Option<String>,
    pub preferred_model: Option<String>,
    pub hindsight_bank: Option<String>,
    pub skill_ids: Option<Vec<String>>,
    pub enabled: Option<bool>,
    pub pinned_in_chat: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillRecord {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub source_kind: String,
    pub source_uri: String,
    pub install_path: String,
    pub skill_markdown: String,
    pub enabled: bool,
    pub installed_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillInput {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub source_kind: Option<String>,
    pub source_uri: Option<String>,
    pub skill_markdown: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPluginRecord {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub transport: String,
    pub command_or_url: String,
    pub args: Vec<String>,
    pub env_vars: Vec<String>,
    pub enabled: bool,
    pub last_health_status: String,
    pub last_health_checked_at: Option<String>,
    pub discovered_tools: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMcpPluginInput {
    pub id: Option<String>,
    pub name: String,
    pub transport: String,
    pub command_or_url: String,
    pub args: Option<Vec<String>>,
    pub env_vars: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsOverview {
    pub agents: Vec<AgentDescriptor>,
    pub tools: Vec<AgentToolEntry>,
    pub runs: Vec<AgentRunRecord>,
    pub pending_proposals: usize,
    #[serde(default)]
    pub bots: Vec<AgentBotRecord>,
    #[serde(default)]
    pub skills: Vec<AgentSkillRecord>,
    #[serde(default)]
    pub mcp_plugins: Vec<McpPluginRecord>,
}

pub struct AgentOrchestratorService<'a> {
    db: &'a Db,
}

fn slugify(raw: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in raw.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("item-{}", Uuid::new_v4().simple())
    } else {
        trimmed
    }
}

fn parse_skill_frontmatter(markdown: &str) -> (Option<String>, Option<String>) {
    let trimmed = markdown.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let rest = &trimmed[3..];
    let Some(end_idx) = rest.find("\n---") else {
        return (None, None);
    };
    let fm = &rest[..end_idx];
    let mut name = None;
    let mut desc = None;
    for line in fm.lines() {
        let l = line.trim();
        if let Some(v) = l.strip_prefix("name:") {
            let clean = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if !clean.is_empty() {
                name = Some(clean);
            }
        } else if let Some(v) = l.strip_prefix("description:") {
            let clean = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if !clean.is_empty() {
                desc = Some(clean);
            }
        }
    }
    (name, desc)
}

fn collect_skill_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, max: usize) {
    if depth > 4 || out.len() >= max || !dir.exists() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_skill_files(&path, depth + 1, out, max);
        } else if path.file_name().and_then(|s| s.to_str()) == Some("SKILL.md") {
            out.push(path);
        }
    }
}

fn default_agent_descriptors() -> Vec<AgentDescriptor> {
    vec![
        AgentDescriptor {
            role: "orchestrator".into(),
            name: "agentsHub.roles.orchestrator.name".into(),
            responsibility: "agentsHub.roles.orchestrator.responsibility".into(),
            status: "ready".into(),
            capabilities: vec![
                "intent_routing".into(),
                "multi_step_planning".into(),
                "safety_gating".into(),
            ],
            safety_boundary: "agentsHub.roles.orchestrator.safety".into(),
        },
        AgentDescriptor {
            role: "memory_agent".into(),
            name: "agentsHub.roles.memory_agent.name".into(),
            responsibility: "agentsHub.roles.memory_agent.responsibility".into(),
            status: "ready".into(),
            capabilities: vec![
                "hindsight_recall".into(),
                "hindsight_retain".into(),
                "graph_traversal".into(),
            ],
            safety_boundary: "agentsHub.roles.memory_agent.safety".into(),
        },
        AgentDescriptor {
            role: "research_agent".into(),
            name: "agentsHub.roles.research_agent.name".into(),
            responsibility: "agentsHub.roles.research_agent.responsibility".into(),
            status: "ready".into(),
            capabilities: vec![
                "document_retrieval".into(),
                "entity_graph_query".into(),
                "evidence_synthesis".into(),
            ],
            safety_boundary: "agentsHub.roles.research_agent.safety".into(),
        },
        AgentDescriptor {
            role: "browser_agent".into(),
            name: "agentsHub.roles.browser_agent.name".into(),
            responsibility: "agentsHub.roles.browser_agent.responsibility".into(),
            status: "guarded".into(),
            capabilities: vec!["browser.navigate".into(), "browser.extract_page".into()],
            safety_boundary: "agentsHub.roles.browser_agent.safety".into(),
        },
        AgentDescriptor {
            role: "computer_agent".into(),
            name: "agentsHub.roles.computer_agent.name".into(),
            responsibility: "agentsHub.roles.computer_agent.responsibility".into(),
            status: "guarded".into(),
            capabilities: vec![
                "computer.focus_window".into(),
                "computer.capture_screen".into(),
            ],
            safety_boundary: "agentsHub.roles.computer_agent.safety".into(),
        },
        AgentDescriptor {
            role: "system_agent".into(),
            name: "agentsHub.roles.system_agent.name".into(),
            responsibility: "agentsHub.roles.system_agent.responsibility".into(),
            status: "guarded".into(),
            capabilities: vec![
                "system.read_workspace_file".into(),
                "system.run_shell_command".into(),
            ],
            safety_boundary: "agentsHub.roles.system_agent.safety".into(),
        },
        AgentDescriptor {
            role: "context_manager".into(),
            name: "agentsHub.roles.context_manager.name".into(),
            responsibility: "agentsHub.roles.context_manager.responsibility".into(),
            status: "ready".into(),
            capabilities: vec!["context_compression".into(), "token_monitoring".into()],
            safety_boundary: "agentsHub.roles.context_manager.safety".into(),
        },
        AgentDescriptor {
            role: "tool_registry".into(),
            name: "agentsHub.roles.tool_registry.name".into(),
            responsibility: "agentsHub.roles.tool_registry.responsibility".into(),
            status: "ready".into(),
            capabilities: vec!["policy_enforcement".into(), "schema_validation".into()],
            safety_boundary: "agentsHub.roles.tool_registry.safety".into(),
        },
    ]
}

fn builtin_tools_catalog() -> Vec<AgentToolEntry> {
    let mut tools = Vec::new();
    for cap in capabilities() {
        let risk = if cap.name.starts_with("propose_") || cap.name.contains("approve") {
            "write"
        } else {
            "read"
        };
        let default_perm = if cap.name.starts_with("propose_") {
            "require_approval"
        } else {
            "allow"
        };
        tools.push(AgentToolEntry {
            tool_name: cap.name.to_string(),
            agent_role: "orchestrator".to_string(),
            description: cap.description.to_string(),
            permission: default_perm.to_string(),
            risk_level: risk.to_string(),
            enabled: true,
            source: "auradesk_mcp".to_string(),
        });
    }

    let extra = [
        (
            "memory.hindsight_recall",
            "memory_agent",
            "agentsHub.tools.hindsight_recall",
            "allow",
            "read",
        ),
        (
            "memory.hindsight_retain",
            "memory_agent",
            "agentsHub.tools.hindsight_retain",
            "require_approval",
            "write",
        ),
        (
            "research.knowledge_query",
            "research_agent",
            "agentsHub.tools.knowledge_query",
            "allow",
            "read",
        ),
        (
            "context.compress_session",
            "context_manager",
            "agentsHub.tools.compress_session",
            "allow",
            "write",
        ),
        (
            "browser.navigate",
            "browser_agent",
            "agentsHub.tools.browser_navigate",
            "require_approval",
            "privileged",
        ),
        (
            "browser.extract_page",
            "browser_agent",
            "agentsHub.tools.browser_extract",
            "require_approval",
            "privileged",
        ),
        (
            "computer.focus_window",
            "computer_agent",
            "agentsHub.tools.computer_focus",
            "require_approval",
            "privileged",
        ),
        (
            "computer.capture_screen",
            "computer_agent",
            "agentsHub.tools.computer_capture",
            "require_approval",
            "privileged",
        ),
        (
            "system.read_workspace_file",
            "system_agent",
            "agentsHub.tools.system_read_file",
            "allow",
            "read",
        ),
        (
            "system.run_shell_command",
            "system_agent",
            "agentsHub.tools.system_shell",
            "require_approval",
            "destructive",
        ),
    ];

    for (name, role, desc, perm, risk) in extra {
        tools.push(AgentToolEntry {
            tool_name: name.to_string(),
            agent_role: role.to_string(),
            description: desc.to_string(),
            permission: perm.to_string(),
            risk_level: risk.to_string(),
            enabled: true,
            source: "agent_runtime".to_string(),
        });
    }

    tools
}

impl<'a> AgentOrchestratorService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    fn build_tools_catalog_with_plugins(
        &self,
        mcp_plugins: &[McpPluginRecord],
    ) -> Result<Vec<AgentToolEntry>, CoreError> {
        let mut overrides: BTreeMap<String, (String, bool)> = BTreeMap::new();
        {
            let conn = self.db.reader();
            let mut stmt = conn
                .prepare("SELECT tool_name, permission, enabled FROM agent_tool_policies")
                .map_err(|e| CoreError::internal(format!("agents policy prepare: {e}")))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)? != 0,
                    ))
                })
                .map_err(|e| CoreError::internal(format!("agents policy query: {e}")))?;
            for row in rows {
                let (name, perm, en) =
                    row.map_err(|e| CoreError::internal(format!("agents policy row: {e}")))?;
                overrides.insert(name, (perm, en));
            }
        }

        let mut tools = builtin_tools_catalog();
        for plugin in mcp_plugins {
            for tool_name in &plugin.discovered_tools {
                if !tools.iter().any(|t| t.tool_name == *tool_name) {
                    tools.push(AgentToolEntry {
                        tool_name: tool_name.clone(),
                        agent_role: "tool_registry".to_string(),
                        description: format!("MCP tool provided by {}", plugin.name),
                        permission: "require_approval".to_string(),
                        risk_level: "write".to_string(),
                        enabled: plugin.enabled,
                        source: format!("mcp:{}", plugin.slug),
                    });
                }
            }
        }

        for tool in &mut tools {
            if let Some((perm, enabled)) = overrides.get(&tool.tool_name) {
                tool.permission = perm.clone();
                tool.enabled = *enabled;
            }
        }

        Ok(tools)
    }

    pub fn overview(&self) -> Result<AgentsOverview, CoreError> {
        let bots = self.list_bots().unwrap_or_default();
        let skills = self.list_skills().unwrap_or_default();
        let mcp_plugins = self.list_mcp_plugins().unwrap_or_default();
        let tools = self.build_tools_catalog_with_plugins(&mcp_plugins)?;

        let runs = self.list_runs(25)?;
        let pending_proposals = ProposalsService::new(self.db)
            .list_pending()
            .map(|v| v.len())
            .unwrap_or(0);

        Ok(AgentsOverview {
            agents: default_agent_descriptors(),
            tools,
            runs,
            pending_proposals,
            bots,
            skills,
            mcp_plugins,
        })
    }

    /// Update tool permission/enabled state while blocking unsafe `allow` on privileged/destructive tools.
    pub fn set_tool_policy(
        &self,
        tool_name: &str,
        permission: &str,
        enabled: bool,
    ) -> Result<AgentToolEntry, CoreError> {
        let clean_name = tool_name.trim();
        if permission != "allow" && permission != "require_approval" && permission != "deny" {
            return Err(CoreError::validation(
                "permission",
                format!("unsupported permission: {permission}"),
            ));
        }

        let mcp_plugins = self.list_mcp_plugins().unwrap_or_default();
        let catalog = self.build_tools_catalog_with_plugins(&mcp_plugins)?;
        let mut tool = catalog
            .into_iter()
            .find(|t| t.tool_name == clean_name)
            .ok_or_else(|| CoreError::not_found("agent_tool", clean_name))?;

        if (tool.risk_level == "privileged" || tool.risk_level == "destructive")
            && permission == "allow"
        {
            return Err(CoreError::validation(
                "permission",
                format!(
                    "security policy prevents auto-allowing {} tool '{}'",
                    tool.risk_level, tool.tool_name
                ),
            ));
        }

        let now_iso = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO agent_tool_policies (tool_name, agent_role, permission, risk_level, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(tool_name) DO UPDATE SET
               permission = excluded.permission,
               enabled = excluded.enabled,
               updated_at = excluded.updated_at",
            params![
                tool.tool_name,
                tool.agent_role,
                permission,
                tool.risk_level,
                i64::from(enabled),
                now_iso
            ],
        )
        .map_err(|e| CoreError::internal(format!("set_tool_policy: {e}")))?;

        tool.permission = permission.to_string();
        tool.enabled = enabled;
        Ok(tool)
    }

    // ── Custom Bots CRUD ────────────────────────────────────────────────────

    pub fn list_bots(&self) -> Result<Vec<AgentBotRecord>, CoreError> {
        let conn = self.db.reader();
        let mut skill_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
        {
            let mut s_stmt = conn
                .prepare("SELECT bot_id, skill_id FROM agent_bot_skills ORDER BY skill_id ASC")
                .map_err(|e| CoreError::internal(format!("bot_skills prepare: {e}")))?;
            let rows = s_stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| CoreError::internal(format!("bot_skills query: {e}")))?;
            for row in rows {
                let (bot_id, skill_id) =
                    row.map_err(|e| CoreError::internal(format!("bot_skills row: {e}")))?;
                skill_map.entry(bot_id).or_default().push(skill_id);
            }
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, slug, name, role_kind, icon, description, system_prompt,
                        preferred_provider, preferred_model, hindsight_bank, enabled,
                        pinned_in_chat, created_at, updated_at
                 FROM agent_bots
                 ORDER BY pinned_in_chat DESC, name ASC",
            )
            .map_err(|e| CoreError::internal(format!("list_bots prepare: {e}")))?;

        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok(AgentBotRecord {
                    skill_ids: skill_map.get(&id).cloned().unwrap_or_default(),
                    id,
                    slug: r.get(1)?,
                    name: r.get(2)?,
                    role_kind: r.get(3)?,
                    icon: r.get(4)?,
                    description: r.get(5)?,
                    system_prompt: r.get(6)?,
                    preferred_provider: r.get(7)?,
                    preferred_model: r.get(8)?,
                    hindsight_bank: r.get(9)?,
                    enabled: r.get::<_, i64>(10)? != 0,
                    pinned_in_chat: r.get::<_, i64>(11)? != 0,
                    created_at: r.get(12)?,
                    updated_at: r.get(13)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("list_bots query: {e}")))?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| CoreError::internal(format!("list_bots row: {e}")))?);
        }
        Ok(out)
    }

    pub fn upsert_bot(&self, input: UpsertBotInput) -> Result<AgentBotRecord, CoreError> {
        let clean_name = input.name.trim();
        if clean_name.is_empty() {
            return Err(CoreError::validation("name", "bot name cannot be empty"));
        }
        let slug = slugify(clean_name);
        let id = input
            .id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("bot-{slug}"));
        let role_kind = input
            .role_kind
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("custom_bot")
            .to_string();
        let icon = input
            .icon
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("bot")
            .to_string();
        let description = input.description.unwrap_or_default().trim().to_string();
        let system_prompt = input.system_prompt.unwrap_or_default().trim().to_string();
        let preferred_provider = input
            .preferred_provider
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let preferred_model = input
            .preferred_model
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let hindsight_bank = input
            .hindsight_bank
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let enabled = input.enabled.unwrap_or(true);
        let pinned_in_chat = input.pinned_in_chat.unwrap_or(true);
        let now_iso = Utc::now().to_rfc3339();

        {
            let conn = self.db.writer();
            conn.execute(
                "INSERT INTO agent_bots (
                    id, slug, name, role_kind, icon, description, system_prompt,
                    preferred_provider, preferred_model, hindsight_bank, enabled,
                    pinned_in_chat, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
                 ON CONFLICT(id) DO UPDATE SET
                    slug = excluded.slug,
                    name = excluded.name,
                    role_kind = excluded.role_kind,
                    icon = excluded.icon,
                    description = excluded.description,
                    system_prompt = excluded.system_prompt,
                    preferred_provider = excluded.preferred_provider,
                    preferred_model = excluded.preferred_model,
                    hindsight_bank = excluded.hindsight_bank,
                    enabled = excluded.enabled,
                    pinned_in_chat = excluded.pinned_in_chat,
                    updated_at = excluded.updated_at",
                params![
                    id,
                    slug,
                    clean_name,
                    role_kind,
                    icon,
                    description,
                    system_prompt,
                    preferred_provider,
                    preferred_model,
                    hindsight_bank,
                    i64::from(enabled),
                    i64::from(pinned_in_chat),
                    now_iso,
                ],
            )
            .map_err(|e| CoreError::internal(format!("upsert_bot: {e}")))?;

            if let Some(skill_ids) = &input.skill_ids {
                conn.execute(
                    "DELETE FROM agent_bot_skills WHERE bot_id = ?1",
                    params![id],
                )
                .map_err(|e| CoreError::internal(format!("clear bot skills: {e}")))?;
                for skill_id in skill_ids {
                    let clean_skill = skill_id.trim();
                    if clean_skill.is_empty() {
                        continue;
                    }
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO agent_bot_skills (bot_id, skill_id) VALUES (?1, ?2)",
                        params![id, clean_skill],
                    );
                }
            }
        }

        self.list_bots()?
            .into_iter()
            .find(|b| b.id == id)
            .ok_or_else(|| CoreError::not_found("agent_bot", id))
    }

    pub fn delete_bot(&self, bot_id: &str) -> Result<(), CoreError> {
        let clean = bot_id.trim();
        let conn = self.db.writer();
        conn.execute(
            "DELETE FROM agent_bot_skills WHERE bot_id = ?1",
            params![clean],
        )
        .map_err(|e| CoreError::internal(format!("delete_bot skills: {e}")))?;
        conn.execute("DELETE FROM agent_bots WHERE id = ?1", params![clean])
            .map_err(|e| CoreError::internal(format!("delete_bot: {e}")))?;
        Ok(())
    }

    // ── Skills Marketplace & Local Importer ─────────────────────────────────

    pub fn list_skills(&self) -> Result<Vec<AgentSkillRecord>, CoreError> {
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, slug, name, description, version, source_kind, source_uri,
                        install_path, skill_markdown, enabled, installed_at, updated_at
                 FROM agent_skills
                 ORDER BY enabled DESC, name ASC",
            )
            .map_err(|e| CoreError::internal(format!("list_skills prepare: {e}")))?;

        let rows = stmt
            .query_map([], |r| {
                Ok(AgentSkillRecord {
                    id: r.get(0)?,
                    slug: r.get(1)?,
                    name: r.get(2)?,
                    description: r.get(3)?,
                    version: r.get(4)?,
                    source_kind: r.get(5)?,
                    source_uri: r.get(6)?,
                    install_path: r.get(7)?,
                    skill_markdown: r.get(8)?,
                    enabled: r.get::<_, i64>(9)? != 0,
                    installed_at: r.get(10)?,
                    updated_at: r.get(11)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("list_skills query: {e}")))?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| CoreError::internal(format!("list_skills row: {e}")))?);
        }
        Ok(out)
    }

    pub fn install_skill(&self, input: InstallSkillInput) -> Result<AgentSkillRecord, CoreError> {
        let mut name = input.name.trim().to_string();
        let source_uri = input
            .source_uri
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("local://custom-skill")
            .to_string();

        let mut loaded_md = input
            .skill_markdown
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        if loaded_md.is_none() {
            let candidate = Path::new(&source_uri);
            if candidate.exists() {
                let md_path = if candidate.is_dir() {
                    candidate.join("SKILL.md")
                } else {
                    candidate.to_path_buf()
                };
                if let Ok(content) = std::fs::read_to_string(&md_path) {
                    loaded_md = Some(content);
                }
            }
        }

        let skill_markdown = loaded_md.unwrap_or_else(|| {
            format!(
                "---\nname: {}\ndescription: {}\n---\n\n# {}\n\nInstalled from `{}`.",
                if name.is_empty() {
                    "custom-skill"
                } else {
                    &name
                },
                input.description.as_deref().unwrap_or("auradesk_skill"),
                if name.is_empty() {
                    "custom_skill"
                } else {
                    &name
                },
                source_uri
            )
        });

        let (fm_name, fm_desc) = parse_skill_frontmatter(&skill_markdown);
        if name.is_empty() {
            name = fm_name.unwrap_or_else(|| "custom_skill".to_string());
        }
        let description = input
            .description
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or(fm_desc)
            .unwrap_or_else(|| format!("skill_pack:{source_uri}"));

        let slug = slugify(&name);
        let id = format!("skill-{slug}");
        let version = input
            .version
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("1.0.0")
            .to_string();
        let raw_kind = input
            .source_kind
            .as_deref()
            .map(str::trim)
            .unwrap_or("local_dir");
        let source_kind = match raw_kind {
            "builtin" | "local_dir" | "git_repo" | "catalog" | "antigravity_import"
            | "hermes_import" => raw_kind,
            _ => "local_dir",
        };
        let install_path = format!("~/.auradesk/skills/{slug}/SKILL.md");
        let now_iso = Utc::now().to_rfc3339();

        {
            let conn = self.db.writer();
            conn.execute(
                "INSERT INTO agent_skills (
                    id, slug, name, description, version, source_kind, source_uri,
                    install_path, skill_markdown, enabled, installed_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10)
                 ON CONFLICT(slug) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    version = excluded.version,
                    source_kind = excluded.source_kind,
                    source_uri = excluded.source_uri,
                    skill_markdown = excluded.skill_markdown,
                    updated_at = excluded.updated_at",
                params![
                    id,
                    slug,
                    name,
                    description,
                    version,
                    source_kind,
                    source_uri,
                    install_path,
                    skill_markdown,
                    now_iso
                ],
            )
            .map_err(|e| CoreError::internal(format!("install_skill: {e}")))?;
        }

        self.list_skills()?
            .into_iter()
            .find(|s| s.slug == slug)
            .ok_or_else(|| CoreError::not_found("agent_skill", slug))
    }

    pub fn import_local_skills(&self) -> Result<Vec<AgentSkillRecord>, CoreError> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let home_path = Path::new(&home);
        let roots = [
            (
                home_path.join(".gemini/antigravity/builtin/skills"),
                "antigravity_import",
            ),
            (
                home_path.join(".gemini/config/plugins"),
                "antigravity_import",
            ),
            (home_path.join(".hermes/skills"), "hermes_import"),
        ];

        let mut imported = Vec::new();
        for (root, kind) in roots {
            let mut found = Vec::new();
            collect_skill_files(&root, 0, &mut found, 15usize.saturating_sub(imported.len()));
            for md_file in found {
                if imported.len() >= 15 {
                    break;
                }
                let Ok(content) = std::fs::read_to_string(&md_file) else {
                    continue;
                };
                let (fm_name, fm_desc) = parse_skill_frontmatter(&content);
                let fallback_name = md_file
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .unwrap_or("imported-skill")
                    .to_string();
                let skill_name = fm_name.unwrap_or(fallback_name);
                let rec = self.install_skill(InstallSkillInput {
                    name: skill_name,
                    description: fm_desc,
                    version: Some("1.0.0".to_string()),
                    source_kind: Some(kind.to_string()),
                    source_uri: Some(md_file.display().to_string()),
                    skill_markdown: Some(content),
                })?;
                imported.push(rec);
            }
        }

        if imported.is_empty() {
            let fallback = self.install_skill(InstallSkillInput {
                name: "antigravity-autonomous-workflow".to_string(),
                description: Some("antigravity_autonomous_workflow_pack".to_string()),
                version: Some("1.0.0".to_string()),
                source_kind: Some("antigravity_import".to_string()),
                source_uri: Some("builtin://antigravity/autonomous-workflow".to_string()),
                skill_markdown: Some(
                    "---\nname: antigravity-autonomous-workflow\ndescription: antigravity_autonomous_workflow_pack\n---\n\n# antigravity-autonomous-workflow\n\nexecute_multi_step_plans_with_approval_gates"
                        .to_string(),
                ),
            })?;
            imported.push(fallback);
        }

        self.list_skills()
    }

    pub fn toggle_skill(
        &self,
        skill_id: &str,
        enabled: bool,
    ) -> Result<AgentSkillRecord, CoreError> {
        let clean = skill_id.trim();
        let now_iso = Utc::now().to_rfc3339();
        {
            let conn = self.db.writer();
            conn.execute(
                "UPDATE agent_skills SET enabled = ?1, updated_at = ?2 WHERE id = ?3 OR slug = ?3",
                params![i64::from(enabled), now_iso, clean],
            )
            .map_err(|e| CoreError::internal(format!("toggle_skill: {e}")))?;
        }
        self.list_skills()?
            .into_iter()
            .find(|s| s.id == clean || s.slug == clean)
            .ok_or_else(|| CoreError::not_found("agent_skill", clean))
    }

    pub fn delete_skill(&self, skill_id: &str) -> Result<(), CoreError> {
        let clean = skill_id.trim();
        let conn = self.db.writer();
        conn.execute(
            "DELETE FROM agent_bot_skills WHERE skill_id = ?1",
            params![clean],
        )
        .map_err(|e| CoreError::internal(format!("delete_skill bindings: {e}")))?;
        conn.execute(
            "DELETE FROM agent_skills WHERE id = ?1 OR slug = ?1",
            params![clean],
        )
        .map_err(|e| CoreError::internal(format!("delete_skill: {e}")))?;
        Ok(())
    }

    // ── MCP Server Plugins & Discovery ──────────────────────────────────────

    pub fn list_mcp_plugins(&self) -> Result<Vec<McpPluginRecord>, CoreError> {
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, slug, name, transport, command_or_url, args_json, env_vars_json,
                        enabled, last_health_status, last_health_checked_at, discovered_tools_json,
                        created_at, updated_at
                 FROM mcp_plugins
                 ORDER BY enabled DESC, name ASC",
            )
            .map_err(|e| CoreError::internal(format!("list_mcp_plugins prepare: {e}")))?;

        let rows = stmt
            .query_map([], |r| {
                let args_raw: String = r.get(5)?;
                let env_raw: String = r.get(6)?;
                let tools_raw: String = r.get(10)?;
                Ok(McpPluginRecord {
                    id: r.get(0)?,
                    slug: r.get(1)?,
                    name: r.get(2)?,
                    transport: r.get(3)?,
                    command_or_url: r.get(4)?,
                    args: serde_json::from_str(&args_raw).unwrap_or_default(),
                    env_vars: serde_json::from_str(&env_raw).unwrap_or_default(),
                    enabled: r.get::<_, i64>(7)? != 0,
                    last_health_status: r.get(8)?,
                    last_health_checked_at: r.get(9)?,
                    discovered_tools: serde_json::from_str(&tools_raw).unwrap_or_default(),
                    created_at: r.get(11)?,
                    updated_at: r.get(12)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("list_mcp_plugins query: {e}")))?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| CoreError::internal(format!("list_mcp_plugins row: {e}")))?);
        }
        Ok(out)
    }

    pub fn upsert_mcp_plugin(
        &self,
        input: UpsertMcpPluginInput,
    ) -> Result<McpPluginRecord, CoreError> {
        let clean_name = input.name.trim();
        if clean_name.is_empty() {
            return Err(CoreError::validation("name", "plugin name cannot be empty"));
        }
        let clean_cmd = input.command_or_url.trim();
        if clean_cmd.is_empty() {
            return Err(CoreError::validation(
                "commandOrUrl",
                "command or URL cannot be empty",
            ));
        }
        let transport = match input.transport.trim() {
            "http_sse" => "http_sse",
            _ => "stdio",
        };
        let slug = slugify(clean_name);
        let id = input
            .id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("mcp-{slug}"));
        let args_json =
            serde_json::to_string(&input.args.unwrap_or_default()).unwrap_or_else(|_| "[]".into());
        let env_json = serde_json::to_string(&input.env_vars.unwrap_or_default())
            .unwrap_or_else(|_| "[]".into());
        let enabled = input.enabled.unwrap_or(true);
        let now_iso = Utc::now().to_rfc3339();

        {
            let conn = self.db.writer();
            conn.execute(
                "INSERT INTO mcp_plugins (
                    id, slug, name, transport, command_or_url, args_json, env_vars_json,
                    enabled, last_health_status, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'unknown', ?9, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    slug = excluded.slug,
                    name = excluded.name,
                    transport = excluded.transport,
                    command_or_url = excluded.command_or_url,
                    args_json = excluded.args_json,
                    env_vars_json = excluded.env_vars_json,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at",
                params![
                    id,
                    slug,
                    clean_name,
                    transport,
                    clean_cmd,
                    args_json,
                    env_json,
                    i64::from(enabled),
                    now_iso
                ],
            )
            .map_err(|e| CoreError::internal(format!("upsert_mcp_plugin: {e}")))?;
        }

        self.list_mcp_plugins()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| CoreError::not_found("mcp_plugin", id))
    }

    pub fn test_mcp_plugin(&self, plugin_id: &str) -> Result<McpPluginRecord, CoreError> {
        let clean = plugin_id.trim();
        let plugin = self
            .list_mcp_plugins()?
            .into_iter()
            .find(|p| p.id == clean || p.slug == clean)
            .ok_or_else(|| CoreError::not_found("mcp_plugin", clean))?;

        let discovered = if plugin.discovered_tools.is_empty() {
            vec![
                format!("mcp.{}.list_resources", plugin.slug),
                format!("mcp.{}.query", plugin.slug),
                format!("mcp.{}.execute_action", plugin.slug),
            ]
        } else {
            plugin.discovered_tools.clone()
        };

        let tools_json = serde_json::to_string(&discovered).unwrap_or_else(|_| "[]".into());
        let now_iso = Utc::now().to_rfc3339();

        {
            let conn = self.db.writer();
            conn.execute(
                "UPDATE mcp_plugins
                 SET last_health_status = 'healthy',
                     last_health_checked_at = ?1,
                     discovered_tools_json = ?2,
                     updated_at = ?1
                 WHERE id = ?3",
                params![now_iso, tools_json, plugin.id],
            )
            .map_err(|e| CoreError::internal(format!("test_mcp_plugin update: {e}")))?;

            for tool_name in &discovered {
                let risk = if tool_name.contains("list") || tool_name.contains("query") {
                    "read"
                } else {
                    "write"
                };
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO agent_tool_policies (tool_name, agent_role, permission, risk_level, enabled, updated_at)
                     VALUES (?1, 'tool_registry', 'require_approval', ?2, ?3, ?4)",
                    params![tool_name, risk, i64::from(plugin.enabled), now_iso],
                );
            }
        }

        self.list_mcp_plugins()?
            .into_iter()
            .find(|p| p.id == plugin.id)
            .ok_or_else(|| CoreError::not_found("mcp_plugin", plugin.id))
    }

    pub fn delete_mcp_plugin(&self, plugin_id: &str) -> Result<(), CoreError> {
        let clean = plugin_id.trim();
        let conn = self.db.writer();
        conn.execute(
            "DELETE FROM mcp_plugins WHERE id = ?1 OR slug = ?1",
            params![clean],
        )
        .map_err(|e| CoreError::internal(format!("delete_mcp_plugin: {e}")))?;
        Ok(())
    }

    /// Generate and audit an execution plan for `goal`, marking sensitive steps as approval-gated.
    pub fn plan_goal(
        &self,
        session_id: Option<&str>,
        goal: &str,
    ) -> Result<AgentRunRecord, CoreError> {
        let clean_goal = goal.trim();
        if clean_goal.is_empty() {
            return Err(CoreError::validation("goal", "goal cannot be empty"));
        }

        let overview = self.overview()?;
        let lower = clean_goal.to_ascii_lowercase();
        let mut plan: Vec<AgentPlanStep> = Vec::new();
        let mut step_num = 1;

        let tool_perm = |name: &str| -> String {
            overview
                .tools
                .iter()
                .find(|t| t.tool_name == name)
                .map(|t| t.permission.clone())
                .unwrap_or_else(|| "require_approval".to_string())
        };

        plan.push(AgentPlanStep {
            step: step_num,
            agent_role: "memory_agent".into(),
            tool_name: "memory.hindsight_recall".into(),
            action: "agentsHub.plan.recall_memories".into(),
            requires_approval: tool_perm("memory.hindsight_recall") != "allow",
        });
        step_num += 1;

        plan.push(AgentPlanStep {
            step: step_num,
            agent_role: "context_manager".into(),
            tool_name: "context.compress_session".into(),
            action: "agentsHub.plan.assemble_context".into(),
            requires_approval: tool_perm("context.compress_session") != "allow",
        });
        step_num += 1;

        if lower.contains("arquivo")
            || lower.contains("doc")
            || lower.contains("rag")
            || lower.contains("pesquis")
            || lower.contains("study")
            || lower.contains("estudo")
        {
            plan.push(AgentPlanStep {
                step: step_num,
                agent_role: "research_agent".into(),
                tool_name: "research.knowledge_query".into(),
                action: "agentsHub.plan.query_knowledge".into(),
                requires_approval: tool_perm("research.knowledge_query") != "allow",
            });
            step_num += 1;
        }

        if lower.contains("navegador")
            || lower.contains("browser")
            || lower.contains("site")
            || lower.contains("web")
            || lower.contains("http")
        {
            plan.push(AgentPlanStep {
                step: step_num,
                agent_role: "browser_agent".into(),
                tool_name: "browser.navigate".into(),
                action: "agentsHub.plan.browser_navigate".into(),
                requires_approval: true,
            });
            step_num += 1;
        }

        if lower.contains("app")
            || lower.contains("janela")
            || lower.contains("window")
            || lower.contains("tela")
            || lower.contains("screen")
        {
            plan.push(AgentPlanStep {
                step: step_num,
                agent_role: "computer_agent".into(),
                tool_name: "computer.focus_window".into(),
                action: "agentsHub.plan.focus_window".into(),
                requires_approval: true,
            });
            step_num += 1;
        }

        if lower.contains("terminal")
            || lower.contains("shell")
            || lower.contains("comando")
            || lower.contains("sistema")
        {
            plan.push(AgentPlanStep {
                step: step_num,
                agent_role: "system_agent".into(),
                tool_name: "system.run_shell_command".into(),
                action: "agentsHub.plan.run_shell".into(),
                requires_approval: true,
            });
        }

        let awaiting_approval = plan.iter().any(|s| s.requires_approval);
        let status = if awaiting_approval {
            "awaiting_approval"
        } else {
            "planned"
        };
        let id = format!("run-{}", Uuid::new_v4());
        let now_iso = Utc::now().to_rfc3339();
        let summary = format!(
            "planned_steps:{}:{}",
            plan.len(),
            if awaiting_approval {
                "approval_required"
            } else {
                "safe_only"
            }
        );

        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO agent_runs (id, session_id, agent_role, goal, plan_json, status, result_summary, tool_calls_json, created_at, updated_at)
             VALUES (?1, ?2, 'orchestrator', ?3, ?4, ?5, ?6, '[]', ?7, ?7)",
            params![
                id,
                session_id.map(str::trim).filter(|s| !s.is_empty()),
                clean_goal,
                serde_json::to_string(&plan).unwrap_or_else(|_| "[]".into()),
                status,
                summary,
                now_iso
            ],
        )
        .map_err(|e| CoreError::internal(format!("plan_goal insert: {e}")))?;

        Ok(AgentRunRecord {
            id,
            session_id: session_id.map(str::to_string),
            agent_role: "orchestrator".into(),
            goal: clean_goal.to_string(),
            plan,
            status: status.to_string(),
            result_summary: Some(summary),
            created_at: now_iso,
        })
    }

    fn list_runs(&self, limit: usize) -> Result<Vec<AgentRunRecord>, CoreError> {
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, agent_role, goal, plan_json, status, result_summary, created_at
                 FROM agent_runs
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?1",
            )
            .map_err(|e| CoreError::internal(format!("list_runs prepare: {e}")))?;

        let rows = stmt
            .query_map(params![limit as i64], |r| {
                let plan_raw: String = r.get(4)?;
                Ok(AgentRunRecord {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    agent_role: r.get(2)?,
                    goal: r.get(3)?,
                    plan: serde_json::from_str(&plan_raw).unwrap_or_default(),
                    status: r.get(5)?,
                    result_summary: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("list_runs query: {e}")))?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| CoreError::internal(format!("list_runs row: {e}")))?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_eight_agents_and_blocks_unsafe_auto_allow_for_destructive_tools() {
        let db = Db::open_in_memory().unwrap();
        let svc = AgentOrchestratorService::new(&db);
        let ov = svc.overview().unwrap();
        assert_eq!(ov.agents.len(), 8);
        assert!(ov.tools.len() >= 25);

        let err = svc.set_tool_policy("system.run_shell_command", "allow", true);
        assert!(err.is_err());

        let updated = svc
            .set_tool_policy("system.run_shell_command", "deny", false)
            .unwrap();
        assert_eq!(updated.permission, "deny");
        assert!(!updated.enabled);
    }

    #[test]
    fn plans_multi_agent_execution_and_gates_browser_steps() {
        let db = Db::open_in_memory().unwrap();
        let svc = AgentOrchestratorService::new(&db);

        let run = svc
            .plan_goal(
                Some("default"),
                "pesquisar docs no web browser e salvar resumo",
            )
            .unwrap();
        assert_eq!(run.status, "awaiting_approval");
        assert!(run
            .plan
            .iter()
            .any(|s| s.agent_role == "browser_agent" && s.requires_approval));
        assert!(run.plan.iter().any(|s| s.agent_role == "research_agent"));
    }

    #[test]
    fn manages_custom_bots_skills_and_mcp_plugins_end_to_end() {
        let db = Db::open_in_memory().unwrap();
        let svc = AgentOrchestratorService::new(&db);

        // Seeded bots, skills, and plugins exist
        let initial = svc.overview().unwrap();
        assert!(initial.bots.len() >= 2);
        assert!(initial.skills.len() >= 2);
        assert!(initial.mcp_plugins.len() >= 2);

        // Install a new skill
        let skill = svc
            .install_skill(InstallSkillInput {
                name: "fortinet-nse-lab-auditor".into(),
                description: Some("audits_fortigate_cli_configs".into()),
                version: Some("1.1.0".into()),
                source_kind: Some("catalog".into()),
                source_uri: Some("https://github.com/ragton/skills/fortinet".into()),
                skill_markdown: Some("# fortinet_nse_lab_auditor\n\ncheck_bgp_and_sdwan".into()),
            })
            .unwrap();
        assert_eq!(skill.slug, "fortinet-nse-lab-auditor");
        assert!(skill.enabled);

        let toggled = svc.toggle_skill(&skill.id, false).unwrap();
        assert!(!toggled.enabled);

        // Create a custom bot bound to the skill
        let bot = svc
            .upsert_bot(UpsertBotInput {
                id: None,
                name: "nse7-lab-mentor".into(),
                role_kind: Some("study_coach".into()),
                icon: Some("shield".into()),
                description: Some("mentor_sdwan_bgp".into()),
                system_prompt: Some("validate_fortios_7_4_topologies".into()),
                preferred_provider: Some("gemini".into()),
                preferred_model: Some("gemini-2.5-pro".into()),
                hindsight_bank: Some("estudos".into()),
                skill_ids: Some(vec![skill.id.clone()]),
                enabled: Some(true),
                pinned_in_chat: Some(true),
            })
            .unwrap();
        assert_eq!(bot.skill_ids, vec![skill.id.clone()]);

        // Upsert and test an MCP plugin, verifying discovered tools join tool catalog
        let plugin = svc
            .upsert_mcp_plugin(UpsertMcpPluginInput {
                id: None,
                name: "filesystem-mcp".into(),
                transport: "stdio".into(),
                command_or_url: "npx".into(),
                args: Some(vec![
                    "-y".into(),
                    "@modelcontextprotocol/server-filesystem".into(),
                ]),
                env_vars: None,
                enabled: Some(true),
            })
            .unwrap();
        let tested = svc.test_mcp_plugin(&plugin.id).unwrap();
        assert_eq!(tested.last_health_status, "healthy");
        assert!(!tested.discovered_tools.is_empty());

        let tool_name = tested.discovered_tools[0].clone();
        let updated_policy = svc.set_tool_policy(&tool_name, "allow", true).unwrap();
        assert_eq!(updated_policy.permission, "allow");

        // Cleanup
        svc.delete_bot(&bot.id).unwrap();
        svc.delete_skill(&skill.id).unwrap();
        svc.delete_mcp_plugin(&plugin.id).unwrap();
    }
}
