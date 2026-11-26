//! Unified Capability Registry domain types (Issue #25).
//!
//! Provides the single source of truth for all tools reachable by AuraDesk,
//! spanning native Rust tools, MCP stdio/HTTP servers, skills (SKILL.md),
//! plugins, external APIs, terminal, browser, and memory engines.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Source category providing a capability.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilitySourceKind {
    /// Native Rust implementation inside crates/auradesk-core.
    Native,
    /// Model Context Protocol over stdio child process.
    McpStdio,
    /// Model Context Protocol over HTTP Server-Sent Events.
    McpHttp,
    /// Executable procedure or skill guideline (SKILL.md).
    Skill,
    /// External plugin or integration.
    Plugin,
    /// Memory engines (LightRAG knowledge graph or Hindsight recall).
    Memory,
    /// External REST or gRPC API.
    Api,
    /// Host terminal / shell execution.
    Terminal,
    /// Headless or desktop browser automation.
    Browser,
    /// Host desktop integration or accessibility surface.
    DesktopApp,
}

impl CapabilitySourceKind {
    /// Canonical string identifier for the source kind.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::McpStdio => "mcp_stdio",
            Self::McpHttp => "mcp_http",
            Self::Skill => "skill",
            Self::Plugin => "plugin",
            Self::Memory => "memory",
            Self::Api => "api",
            Self::Terminal => "terminal",
            Self::Browser => "browser",
            Self::DesktopApp => "desktop_app",
        }
    }
}

/// Detailed origin of a capability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySource {
    /// Source kind.
    pub kind: CapabilitySourceKind,
    /// Identifier of the provider (e.g., `github`, `caveman`).
    pub identifier: String,
    /// Friendly display label.
    pub display_name: String,
    /// Optional command line or endpoint URI.
    pub uri: Option<String>,
}

/// Operational availability of a capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    /// Ready for execution.
    Available,
    /// Disabled by user configuration or plugin status.
    Disabled,
    /// Operating with degraded capabilities or partial connectivity.
    Degraded,
    /// Failed health checks or crashed.
    Error,
}

/// Access and confirmation policy for a capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityPermission {
    /// Read-only / safe actions executed automatically without friction.
    Auto,
    /// Requires user approval via Propose -> Approve cycle before mutation.
    RequireApproval,
    /// Can only create a proposal draft, never execute directly.
    ProposeOnly,
    /// Explicitly blocked by user or administrator policy.
    Blocked,
}

/// Approval policy requirements.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalPolicy {
    /// Always allowed without interactive confirmation.
    AlwaysAllow,
    /// Structured proposal awaiting user review.
    ProposeApprove,
    /// Critical modal confirmation required.
    RequireExplicitConfirm,
}

/// Telemetry and usage metrics for a capability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsageMetrics {
    /// Total times this tool was invoked.
    pub call_count: u64,
    /// Successful invocations.
    pub success_count: u64,
    /// Failed invocations.
    pub failure_count: u64,
    /// Cumulative execution time in milliseconds.
    pub total_latency_ms: u64,
    /// Average latency in milliseconds.
    pub avg_latency_ms: u64,
    /// ISO 8601 timestamp of last invocation.
    pub last_used_at: Option<String>,
    /// Last error string if any.
    pub last_error: Option<String>,
}

impl ToolUsageMetrics {
    /// Update usage metrics with the outcome of a new invocation.
    pub fn record_call(&mut self, success: bool, latency_ms: u64, error: Option<String>, now_iso: &str) {
        self.call_count += 1;
        if success {
            self.success_count += 1;
        } else {
            self.failure_count += 1;
            self.last_error = error;
        }
        self.total_latency_ms = self.total_latency_ms.saturating_add(latency_ms);
        self.avg_latency_ms = self.total_latency_ms / self.call_count.max(1);
        self.last_used_at = Some(now_iso.to_string());
    }
}

/// Unified capability definition spanning all sources.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedCapability {
    /// Unique identifier across workspace (e.g., `native:list_tasks`, `mcp:github:create_issue`).
    pub id: String,
    /// Invocation name exposed to the LLM (e.g., `list_tasks`).
    pub name: String,
    /// Human-readable description explaining purpose, arguments, and return value.
    pub description: String,
    /// Origin providing this capability.
    pub source: CapabilitySource,
    /// JSON Schema Draft 2020-12 describing the arguments object.
    pub input_schema: Value,
    /// Optional JSON Schema Draft 2020-12 describing the result.
    pub output_schema: Option<Value>,
    /// Current operational availability.
    pub status: CapabilityStatus,
    /// Security and execution permission level.
    pub permission: CapabilityPermission,
    /// Individual timeout in milliseconds. Defaults to 10_000 (10s).
    pub timeout_ms: u64,
    /// Approval policy.
    pub approval_policy: ApprovalPolicy,
    /// Usage telemetry.
    pub metrics: ToolUsageMetrics,
    /// Semantic search tags used by the Context Engine for tool pruning.
    pub tags: Vec<String>,
}

impl UnifiedCapability {
    /// Estimate the token cost of this tool's definition and schema when injected into a prompt.
    pub fn estimate_schema_tokens(&self) -> usize {
        let schema_len = self.input_schema.to_string().len();
        let desc_len = self.description.len();
        let name_len = self.name.len();
        // ~4 characters per token heuristic
        ((schema_len + desc_len + name_len) / 4).max(15)
    }
}

/// Result of executing a tool in an isolated context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionResult {
    /// Unique tool ID.
    pub tool_id: String,
    /// Tool function name.
    pub tool_name: String,
    /// Whether execution succeeded.
    pub success: bool,
    /// JSON output or error payload.
    pub output: Value,
    /// Error message if execution failed.
    pub error: Option<String>,
    /// Execution latency in milliseconds.
    pub latency_ms: u64,
}

/// Criteria for contextually selecting relevant tools (*Tool Pruning*).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSelectionCriteria {
    /// Raw user intent or prompt for semantic and keyword matching.
    pub intent: String,
    /// Maximum number of tools to select. Default: 5.
    pub max_tools: usize,
    /// Maximum token budget reserved for tool schemas. Default: 1500.
    pub max_schema_tokens: usize,
    /// Tool IDs or names that MUST be included regardless of score.
    pub required_tools: Vec<String>,
    /// Optional restriction to specific source kinds.
    pub allowed_sources: Option<Vec<CapabilitySourceKind>>,
}

impl Default for ToolSelectionCriteria {
    fn default() -> Self {
        Self {
            intent: String::new(),
            max_tools: 5,
            max_schema_tokens: 1500,
            required_tools: Vec::new(),
            allowed_sources: None,
        }
    }
}

/// A selected capability paired with its relevance score for telemetry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedCapability {
    /// The capability selected.
    pub capability: UnifiedCapability,
    /// Computed relevance score based on intent match.
    pub relevance_score: u32,
    /// Whether this capability was explicitly required by the caller.
    pub is_required: bool,
}
