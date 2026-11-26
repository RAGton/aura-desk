//! Capability registry application service (Issue #25).
//!
//! Unifies native Rust tools, MCP plugins, skills, memory queries, and external APIs
//! into a dynamic catalog with contextual tool selection (intent pruning) and
//! isolated resilient execution.

#![allow(missing_docs)]

use std::collections::{BTreeMap, HashSet};
use std::time::Instant;

use chrono::Utc;
use serde_json::{json, Value};

use crate::application::agents::{AgentSkillRecord, McpPluginRecord};
use crate::capabilities::capabilities as builtin_capabilities;
use crate::domain::capability_registry::{
    ApprovalPolicy, CapabilityPermission, CapabilitySource, CapabilitySourceKind, CapabilityStatus,
    SelectedCapability, ToolExecutionResult, ToolSelectionCriteria, ToolUsageMetrics,
    UnifiedCapability,
};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Registry managing all dynamic and native capabilities.
#[derive(Debug, Clone, Default)]
pub struct CapabilityRegistry {
    tools: BTreeMap<String, UnifiedCapability>,
}

impl CapabilityRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register or update a unified capability.
    pub fn register(&mut self, capability: UnifiedCapability) {
        self.tools.insert(capability.id.clone(), capability);
    }

    /// Retrieve a capability by its unique id or tool name.
    pub fn find(&self, id_or_name: &str) -> Option<&UnifiedCapability> {
        self.tools
            .get(id_or_name)
            .or_else(|| self.tools.values().find(|c| c.name == id_or_name))
    }

    /// Retrieve a mutable reference to a capability by its unique id or tool name.
    pub fn find_mut(&mut self, id_or_name: &str) -> Option<&mut UnifiedCapability> {
        if self.tools.contains_key(id_or_name) {
            return self.tools.get_mut(id_or_name);
        }
        self.tools.values_mut().find(|c| c.name == id_or_name)
    }

    /// Return all registered capabilities.
    pub fn list_all(&self) -> Vec<UnifiedCapability> {
        self.tools.values().cloned().collect()
    }

    /// Count of registered capabilities.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// Whether registry is empty.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// Ingest the 19 standard built-in tools from `crates/auradesk-core/src/capabilities.rs`.
    pub fn register_builtin_tools(&mut self) {
        for cap in builtin_capabilities() {
            let is_propose = cap.name.starts_with("propose_");
            let is_approval = cap.name == "approve_proposal" || cap.name == "reject_proposal";

            let (permission, approval_policy) = if is_propose {
                (CapabilityPermission::RequireApproval, ApprovalPolicy::ProposeApprove)
            } else if is_approval {
                (CapabilityPermission::RequireApproval, ApprovalPolicy::RequireExplicitConfirm)
            } else {
                (CapabilityPermission::Auto, ApprovalPolicy::AlwaysAllow)
            };

            let tags = extract_tags_from_name(cap.name);

            let unified = UnifiedCapability {
                id: format!("native:{}", cap.name),
                name: cap.name.to_string(),
                description: cap.description.to_string(),
                source: CapabilitySource {
                    kind: CapabilitySourceKind::Native,
                    identifier: cap.name.to_string(),
                    display_name: format!("AuraDesk Native ({})", cap.name),
                    uri: None,
                },
                input_schema: cap.input_schema.clone(),
                output_schema: Some(cap.output_schema.clone()),
                status: CapabilityStatus::Available,
                permission,
                timeout_ms: 10_000,
                approval_policy,
                metrics: ToolUsageMetrics::default(),
                tags,
            };
            self.register(unified);
        }
    }

    /// Ingest tools discovered by MCP server plugins.
    pub fn register_mcp_plugins(&mut self, plugins: &[McpPluginRecord]) {
        for plugin in plugins {
            let status = if plugin.enabled {
                CapabilityStatus::Available
            } else {
                CapabilityStatus::Disabled
            };

            for tool_name in &plugin.discovered_tools {
                let id = format!("mcp:{}:{}", plugin.slug, tool_name);
                let tags = vec![
                    "mcp".to_string(),
                    plugin.slug.clone(),
                    tool_name.clone(),
                ];

                let unified = UnifiedCapability {
                    id,
                    name: tool_name.clone(),
                    description: format!(
                        "External tool '{}' provided by MCP plugin '{}'.",
                        tool_name, plugin.name
                    ),
                    source: CapabilitySource {
                        kind: match plugin.transport.as_str() {
                            "http_sse" => CapabilitySourceKind::McpHttp,
                            _ => CapabilitySourceKind::McpStdio,
                        },
                        identifier: plugin.slug.clone(),
                        display_name: plugin.name.clone(),
                        uri: Some(plugin.command_or_url.clone()),
                    },
                    input_schema: json!({
                        "$schema": "https://json-schema.org/draft/2020-12/schema",
                        "type": "object",
                        "description": format!("Arguments for MCP tool {}", tool_name),
                    }),
                    output_schema: None,
                    status,
                    permission: CapabilityPermission::RequireApproval,
                    timeout_ms: 15_000,
                    approval_policy: ApprovalPolicy::ProposeApprove,
                    metrics: ToolUsageMetrics::default(),
                    tags,
                };
                self.register(unified);
            }
        }
    }

    /// Ingest procedural skills (`SKILL.md`) as invokable capabilities.
    pub fn register_skills(&mut self, skills: &[AgentSkillRecord]) {
        for skill in skills {
            let id = format!("skill:{}", skill.slug);
            let tags = vec![
                "skill".to_string(),
                skill.slug.clone(),
                skill.source_kind.clone(),
            ];

            let unified = UnifiedCapability {
                id,
                name: format!("run_skill_{}", skill.slug.replace('-', "_")),
                description: format!(
                    "Activate procedural skill '{}': {}",
                    skill.name, skill.description
                ),
                source: CapabilitySource {
                    kind: CapabilitySourceKind::Skill,
                    identifier: skill.slug.clone(),
                    display_name: skill.name.clone(),
                    uri: Some(skill.source_uri.clone()),
                },
                input_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "properties": {
                        "user_instruction": {
                            "type": "string",
                            "description": "Specific instruction or parameters to execute with this skill"
                        }
                    },
                    "required": ["user_instruction"]
                }),
                output_schema: None,
                status: if skill.enabled {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Disabled
                },
                permission: CapabilityPermission::Auto,
                timeout_ms: 30_000,
                approval_policy: ApprovalPolicy::AlwaysAllow,
                metrics: ToolUsageMetrics::default(),
                tags,
            };
            self.register(unified);
        }
    }

    /// Register memory capabilities (LightRAG Knowledge Graph and Hindsight Recall).
    pub fn register_memory_tools(&mut self) {
        self.register(UnifiedCapability {
            id: "memory:lightrag_search".to_string(),
            name: "lightrag_knowledge_search".to_string(),
            description: "Query indexed project files and local documentation via LightRAG knowledge graph and embeddings.".to_string(),
            source: CapabilitySource {
                kind: CapabilitySourceKind::Memory,
                identifier: "lightrag".to_string(),
                display_name: "LightRAG Knowledge Base".to_string(),
                uri: None,
            },
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Semantic query or technical topic to search in the knowledge base" },
                    "top_k": { "type": "integer", "description": "Number of entities or snippets to retrieve", "default": 5 }
                },
                "required": ["query"]
            }),
            output_schema: None,
            status: CapabilityStatus::Available,
            permission: CapabilityPermission::Auto,
            timeout_ms: 8_000,
            approval_policy: ApprovalPolicy::AlwaysAllow,
            metrics: ToolUsageMetrics::default(),
            tags: vec!["memory".into(), "rag".into(), "lightrag".into(), "docs".into(), "code".into()],
        });

        self.register(UnifiedCapability {
            id: "memory:hindsight_recall".to_string(),
            name: "hindsight_memory_recall".to_string(),
            description: "Recall episodic memory, past user decisions, habits, and preferences from Hindsight banks.".to_string(),
            source: CapabilitySource {
                kind: CapabilitySourceKind::Memory,
                identifier: "hindsight".to_string(),
                display_name: "Hindsight Episodic Memory".to_string(),
                uri: None,
            },
            input_schema: json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Topic or context to recall from memory" },
                    "bank": { "type": "string", "description": "Target bank (e.g. aura-main, estudos, trabalho)" }
                },
                "required": ["query"]
            }),
            output_schema: None,
            status: CapabilityStatus::Available,
            permission: CapabilityPermission::Auto,
            timeout_ms: 5_000,
            approval_policy: ApprovalPolicy::AlwaysAllow,
            metrics: ToolUsageMetrics::default(),
            tags: vec!["memory".into(), "hindsight".into(), "episodic".into(), "user_facts".into()],
        });
    }

    /// Select contextually relevant capabilities for a given user intent.
    ///
    /// Implements Tool Pruning:
    /// 1. Scores tools by keyword and semantic token overlap against intent.
    /// 2. Always includes tools listed in `criteria.required_tools`.
    /// 3. Filters out disabled or blocked tools.
    /// 4. Respects `max_tools` limit.
    /// 5. Respects `max_schema_tokens` budget.
    pub fn select_for_intent(&self, criteria: &ToolSelectionCriteria) -> Vec<SelectedCapability> {
        let intent_tokens = tokenize(&criteria.intent);
        let required_set: HashSet<&str> = criteria
            .required_tools
            .iter()
            .map(String::as_str)
            .collect();

        let mut scored: Vec<SelectedCapability> = Vec::new();

        for tool in self.tools.values() {
            if tool.status == CapabilityStatus::Disabled
                || tool.status == CapabilityStatus::Error
                || tool.permission == CapabilityPermission::Blocked
            {
                continue;
            }

            if let Some(allowed) = &criteria.allowed_sources {
                if !allowed.contains(&tool.source.kind) {
                    continue;
                }
            }

            let is_req = required_set.contains(tool.id.as_str())
                || required_set.contains(tool.name.as_str());

            let mut score: u32 = 0;
            if is_req {
                score = 10_000;
            } else {
                score += compute_relevance_score(tool, &intent_tokens);
            }

            if is_req || score > 0 {
                scored.push(SelectedCapability {
                    capability: tool.clone(),
                    relevance_score: score,
                    is_required: is_req,
                });
            }
        }

        // Sort descending: required first, then highest relevance score, then most used
        scored.sort_by(|a, b| {
            b.is_required
                .cmp(&a.is_required)
                .then_with(|| b.relevance_score.cmp(&a.relevance_score))
                .then_with(|| b.capability.metrics.call_count.cmp(&a.capability.metrics.call_count))
        });

        // Apply max_tools and schema token budget limits
        let mut selected: Vec<SelectedCapability> = Vec::new();
        let mut total_schema_tokens = 0;

        for item in scored {
            if selected.len() >= criteria.max_tools && !item.is_required {
                break;
            }

            let est_tokens = item.capability.estimate_schema_tokens();
            if total_schema_tokens + est_tokens > criteria.max_schema_tokens && !item.is_required {
                continue;
            }

            total_schema_tokens += est_tokens;
            selected.push(item);
        }

        selected
    }

    /// Execute a tool in an isolated wrapper that catches errors, enforces resilience,
    /// tracks execution latency, and updates metrics without aborting the agent turn.
    pub fn execute_isolated<F>(
        &mut self,
        tool_id_or_name: &str,
        input: Value,
        handler: F,
    ) -> ToolExecutionResult
    where
        F: FnOnce(Value) -> Result<Value, CoreError>,
    {
        let start = Instant::now();
        let now_iso = Utc::now().to_rfc3339();

        let tool_meta = self.find(tool_id_or_name).cloned();
        let (id, name) = match &tool_meta {
            Some(t) => (t.id.clone(), t.name.clone()),
            None => (
                tool_id_or_name.to_string(),
                tool_id_or_name.to_string(),
            ),
        };

        let result = handler(input);
        let latency_ms = start.elapsed().as_millis() as u64;

        let (success, output, err_str) = match result {
            Ok(val) => (true, val, None),
            Err(e) => (false, json!({ "error": e.to_string() }), Some(e.to_string())),
        };

        if let Some(tool) = self.find_mut(&id) {
            tool.metrics.record_call(success, latency_ms, err_str.clone(), &now_iso);
        }

        ToolExecutionResult {
            tool_id: id,
            tool_name: name,
            success,
            output,
            error: err_str,
            latency_ms,
        }
    }

    /// Format selected capabilities as OpenAI-compatible function tool definitions.
    pub fn export_openai_tools(&self, selected: &[SelectedCapability]) -> Vec<Value> {
        selected
            .iter()
            .map(|sc| {
                json!({
                    "type": "function",
                    "function": {
                        "name": sc.capability.name,
                        "description": sc.capability.description,
                        "parameters": sc.capability.input_schema
                    }
                })
            })
            .collect()
    }
}

/// Service exposing the capability registry backed by SQLite database.
pub struct CapabilityRegistryService<'a> {
    db: &'a Db,
    registry: CapabilityRegistry,
}

impl<'a> CapabilityRegistryService<'a> {
    /// Initialize registry service and populate it with native tools, MCP plugins, and skills.
    pub fn load_unified(db: &'a Db) -> Result<Self, CoreError> {
        let mut registry = CapabilityRegistry::new();
        registry.register_builtin_tools();
        registry.register_memory_tools();

        let agent_svc = crate::application::agents::AgentOrchestratorService::new(db);
        if let Ok(plugins) = agent_svc.list_mcp_plugins() {
            registry.register_mcp_plugins(&plugins);
        }
        if let Ok(skills) = agent_svc.list_skills() {
            registry.register_skills(&skills);
        }

        Ok(Self { db, registry })
    }

    /// Return the database reference.
    pub fn db(&self) -> &'a Db {
        self.db
    }

    /// Access the underlying registry.
    pub fn registry(&self) -> &CapabilityRegistry {
        &self.registry
    }

    /// Access the underlying registry mutably.
    pub fn registry_mut(&mut self) -> &mut CapabilityRegistry {
        &mut self.registry
    }

    /// Select tools for the given intent.
    pub fn select_tools(&self, intent: &str, max_tools: usize) -> Vec<SelectedCapability> {
        self.registry.select_for_intent(&ToolSelectionCriteria {
            intent: intent.to_string(),
            max_tools,
            ..Default::default()
        })
    }
}

fn normalize_str(s: &str) -> String {
    s.to_lowercase()
        .replace(['á', 'à', 'ã', 'â', 'ä'], "a")
        .replace(['é', 'è', 'ê', 'ë'], "e")
        .replace(['í', 'ì', 'î', 'ï'], "i")
        .replace(['ó', 'ò', 'õ', 'ô', 'ö'], "o")
        .replace(['ú', 'ù', 'û', 'ü'], "u")
        .replace('ç', "c")
}

fn extract_tags_from_name(name: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for part in name.split('_') {
        if !part.is_empty() {
            tags.push(normalize_str(part));
        }
    }
    tags
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 2)
        .map(normalize_str)
        .collect()
}

fn compute_relevance_score(tool: &UnifiedCapability, intent_tokens: &[String]) -> u32 {
    let mut score = 0;
    let name_norm = normalize_str(&tool.name);
    let desc_norm = normalize_str(&tool.description);

    for token in intent_tokens {
        // Name exact match
        if name_norm == *token {
            score += 150;
        } else if name_norm.contains(token) {
            score += 60;
        }

        // Tags match
        if tool.tags.iter().any(|t| normalize_str(t) == *token) {
            score += 80;
        }

        // Description token match
        if desc_norm.contains(token) {
            score += 25;
        }
    }

    // Domain heuristics for common synonyms
    for token in intent_tokens {
        match token.as_str() {
            "tarefa" | "tarefas" | "task" | "todo" => {
                if name_norm.contains("task") {
                    score += 120;
                }
            }
            "kanban" | "board" | "quadro" => {
                if name_norm.contains("kanban") {
                    score += 120;
                }
            }
            "lembrete" | "lembrar" | "reminder" => {
                if name_norm.contains("reminder") {
                    score += 120;
                }
            }
            "foco" | "pomodoro" | "timer" => {
                if name_norm.contains("pomodoro") {
                    score += 120;
                }
            }
            "plano" | "dia" | "planejar" | "daily" => {
                if name_norm.contains("plan") || name_norm.contains("today") {
                    score += 100;
                }
            }
            "memoria" | "recordar" | "historico" | "hindsight" => {
                if tool.source.kind == CapabilitySourceKind::Memory {
                    score += 150;
                }
            }
            "arquivo" | "codigo" | "projeto" | "busca" | "rag" | "lightrag" => {
                if tool.name.contains("lightrag") || name_norm.contains("project") {
                    score += 120;
                }
            }
            _ => {}
        }
    }

    score
}
