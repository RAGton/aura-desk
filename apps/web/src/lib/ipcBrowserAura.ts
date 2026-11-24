import type {
  AgentBotRecord,
  AgentDescriptor,
  AgentPlanStep,
  AgentRunRecord,
  AgentSkillRecord,
  AgentsOverview,
  AgentToolEntry,
  ChatSession,
  ContextEventRecord,
  ContextInspection,
  ContextLayerSnapshot,
  HindsightBankStats,
  HindsightBankSummary,
  HindsightDirective,
  HindsightDocumentDetail,
  HindsightDocumentItem,
  HindsightDocumentPage,
  HindsightEntityDetail,
  HindsightEntityItem,
  HindsightEntityPage,
  HindsightGalaxyGlobe,
  HindsightGalaxyLink,
  HindsightGalaxySnapshot,
  HindsightGlobalSearchHit,
  HindsightGraphEdge,
  HindsightGraphNode,
  HindsightGraphPayload,
  HindsightMemoryDetail,
  HindsightMemoryHistoryEntry,
  HindsightMemoryItem,
  HindsightMemoryPage,
  HindsightMentalModel,
  HindsightMentalModelPage,
  HindsightOperation,
  InstallSkillInput,
  KnowledgeDocumentDetail,
  KnowledgeDocumentEntry,
  KnowledgeDocumentsResult,
  KnowledgeEntityEntry,
  KnowledgeExplorerOverview,
  KnowledgeGraphPayload,
  KnowledgeRelationEntry,
  KnowledgeSearchResult,
  McpPluginRecord,
  UpsertBotInput,
  UpsertMcpPluginInput,
} from "./auraTypes";
import type {
  HermesChatReply,
  HindsightRecallItem,
  HindsightStatus,
  PersistedChatMessage,
  ProposalItem,
} from "./ipc";

export interface BrowserAuraStateSlice {
  tasks: Array<{ status: string; title: string }>;
  reminders: Array<{ status: string; title: string }>;
  alerts: Array<{ resolution?: string | null; title: string }>;
  proposals?: ProposalItem[];
  settings: Record<string, unknown>;
  chatSessions?: ChatSession[];
  chatMessages?: PersistedChatMessage[];
  contextEvents?: ContextEventRecord[];
  agentToolPolicies?: Record<string, { permission: string; enabled: boolean }>;
  agentRuns?: AgentRunRecord[];
  agentBots?: AgentBotRecord[];
  agentSkills?: AgentSkillRecord[];
  mcpPlugins?: McpPluginRecord[];
}

export interface BrowserAuraDeps<TDb extends BrowserAuraStateSlice> {
  db: TDb;
  args: Record<string, unknown>;
  nowIso: string;
  genId: () => string;
  saveBrowserDb: (db: TDb) => void;
  runBrowserHermesPrompt: (db: TDb, prompt: string, nowIso: string) => HermesChatReply;
}

const DEFAULT_SESSION_ID = "default";
const DEFAULT_TOKEN_BUDGET = 8192;
const RECENT_TAIL_KEEP = 6;
const COMPRESS_USAGE_RATIO = 0.72;
const APPROACHING_USAGE_RATIO = 0.55;

function allowLiveProxyFetch(): boolean {
  const meta = import.meta as ImportMeta & { env?: { MODE?: string; VITEST?: unknown } };
  const mode = meta.env?.MODE;
  const isVitest = mode === "test" || Boolean(meta.env?.VITEST);
  return typeof window !== "undefined" && !isVitest && typeof fetch === "function";
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function looseStrings(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 3500): Promise<unknown> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller?.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchHindsight(path: string, query?: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        params.set(k, String(v));
      }
    }
  }
  const qs = params.toString();
  return fetchJsonWithTimeout(`/__hindsight${path}${qs ? `?${qs}` : ""}`, 6000);
}

async function fetchHindsightWrite(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 8000
): Promise<unknown> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(`/__hindsight${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const text = await resp.text();
    return text.trim() ? JSON.parse(text) : {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeMemoryItem(raw: Record<string, unknown>): HindsightMemoryItem {
  return {
    id: String(raw.id ?? ""),
    text: String(raw.text ?? raw.content ?? ""),
    context: asStr(raw.context),
    date: asStr(raw.date),
    factType: asStr(raw.fact_type ?? raw.type),
    documentId: asStr(raw.document_id),
    mentionedAt: asStr(raw.mentioned_at),
    occurredStart: asStr(raw.occurred_start),
    occurredEnd: asStr(raw.occurred_end),
    entities: looseStrings(raw.entities),
    tags: looseStrings(raw.tags),
    chunkId: asStr(raw.chunk_id),
    proofCount: asNum(raw.proof_count, 0),
    state: asStr(raw.state),
  };
}

function normalizeBankStats(raw: Record<string, unknown>, bankId: string): HindsightBankStats {
  const nodesMap =
    raw.nodes_by_fact_type && typeof raw.nodes_by_fact_type === "object"
      ? (raw.nodes_by_fact_type as Record<string, number>)
      : {};
  const linksMap =
    raw.links_by_link_type && typeof raw.links_by_link_type === "object"
      ? (raw.links_by_link_type as Record<string, number>)
      : {};
  return {
    bankId: asStr(raw.bank_id) ?? bankId,
    totalNodes: asNum(raw.total_nodes, 0),
    totalLinks: asNum(raw.total_links, 0),
    totalDocuments: asNum(raw.total_documents, 0),
    nodesByFactType: nodesMap,
    linksByLinkType: linksMap,
    pendingOperations: asNum(raw.pending_operations, 0),
    failedOperations: asNum(raw.failed_operations, 0),
    pendingConsolidation: asNum(raw.pending_consolidation, 0),
    failedConsolidation: asNum(raw.failed_consolidation, 0),
    lastConsolidatedAt: asStr(raw.last_consolidated_at),
    lastMemoryWriteAt: asStr(raw.last_memory_write_at),
  };
}

async function proxyHindsightBanksList(): Promise<HindsightBankSummary[]> {
  const data = (await fetchHindsight("/v1/default/banks")) as {
    banks?: Array<{ bank_id?: string; id?: string; name?: string }>;
  };
  const list = Array.isArray(data?.banks) ? data.banks : [];
  const enriched = await Promise.all(
    list.map(async (b) => {
      const id = String(b.bank_id ?? b.id ?? b.name ?? "").trim();
      if (!id) return null;
      const name = String(b.name ?? id);
      try {
        const statsRaw = (await fetchHindsight(
          `/v1/default/banks/${encodeURIComponent(id)}/stats`
        )) as Record<string, unknown>;
        return {
          id,
          name,
          totalNodes: asNum(statsRaw.total_nodes, 0),
          totalLinks: asNum(statsRaw.total_links, 0),
          totalDocuments: asNum(statsRaw.total_documents, 0),
        } satisfies HindsightBankSummary;
      } catch {
        return {
          id,
          name,
          totalNodes: 0,
          totalLinks: 0,
          totalDocuments: 0,
        } satisfies HindsightBankSummary;
      }
    })
  );
  return enriched.filter((x): x is HindsightBankSummary => x !== null);
}

async function proxyHindsightGraph(
  bank: string,
  limit = 100,
  query?: string | null,
  factType?: string | null
): Promise<HindsightGraphPayload> {
  const cleanType = factType && factType !== "all" ? factType : undefined;
  const raw = (await fetchHindsight(`/v1/default/banks/${encodeURIComponent(bank)}/graph`, {
    limit: Math.min(200, Math.max(1, limit)),
    q: query ?? undefined,
    type: cleanType,
  })) as Record<string, unknown>;
  const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw?.edges) ? raw.edges : [];

  const nodes: HindsightGraphNode[] = rawNodes
    .map((entry) => (entry && typeof entry === "object" ? (entry as { data?: Record<string, unknown> }).data ?? (entry as Record<string, unknown>) : null))
    .filter((d): d is Record<string, unknown> => d !== null)
    .map((d) => ({
      id: String(d.id ?? ""),
      label: String(d.label ?? d.text ?? ""),
      text: String(d.text ?? d.label ?? ""),
      date: asStr(d.date),
      context: asStr(d.context),
      entities: looseStrings(d.entities),
      color: asStr(d.color),
    }));

  const edges: HindsightGraphEdge[] = rawEdges
    .map((entry) => (entry && typeof entry === "object" ? (entry as { data?: Record<string, unknown> }).data ?? (entry as Record<string, unknown>) : null))
    .filter((d): d is Record<string, unknown> => d !== null)
    .map((d) => ({
      id: String(d.id ?? `${d.source ?? ""}-${d.target ?? ""}`),
      source: String(d.source ?? ""),
      target: String(d.target ?? ""),
      linkType: asStr(d.linkType ?? d.link_type),
      weight: typeof d.weight === "number" ? d.weight : null,
      entityName: asStr(d.entityName ?? d.entity_name),
      color: asStr(d.color),
      lineStyle: asStr(d.lineStyle ?? d.line_style),
    }));

  return {
    nodes,
    edges,
    totalUnits: asNum(raw?.total_units, nodes.length),
  };
}

function defaultChatSession(nowIso: string, settings: Record<string, unknown>): ChatSession {
  const activeProvider = String(settings["ai.provider"] ?? "offline");
  const model = String(settings["ai.model"] ?? "") || activeProvider;
  return {
    id: DEFAULT_SESSION_ID,
    title: "sessions.defaultTitle",
    status: "active",
    semanticSummary: "",
    contextState: "healthy",
    compressionState: "none",
    compressionCount: 0,
    estimatedTokens: 0,
    tokenBudget: DEFAULT_TOKEN_BUDGET,
    model,
    provider: activeProvider,
    associatedMemories: [],
    toolsUsed: [],
    messageCount: 0,
    lastMessagePreview: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
  };
}

function ensureSessions(db: BrowserAuraStateSlice, nowIso: string): ChatSession[] {
  if (!Array.isArray(db.chatSessions)) db.chatSessions = [];
  if (!db.chatSessions.some((s) => s.id === DEFAULT_SESSION_ID)) {
    db.chatSessions.unshift(defaultChatSession(nowIso, db.settings));
  }
  return db.chatSessions;
}

function estimateTokens(text: string): number {
  const chars = text.trim().length;
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 4));
}

function compactPreview(text: string, maxChars = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(1, maxChars - 3))}...`;
}

function buildContextLayers(
  db: BrowserAuraStateSlice,
  session: ChatSession,
  messages: PersistedChatMessage[]
): { layers: ContextLayerSnapshot[]; totalTokens: number } {
  const systemText = "aura_persona_policy";
  const systemTokens = estimateTokens(systemText);
  const userFactsText = `tasks:${db.tasks.length};reminders:${db.reminders.length}`;
  const userTokens = estimateTokens(userFactsText);
  const summaryTokens = estimateTokens(session.semanticSummary);
  const recent = messages.slice(-RECENT_TAIL_KEEP);
  const recentTokens = recent.reduce((acc, m) => acc + estimateTokens(m.content), 0);
  const retrievedTokens = session.associatedMemories.length * 16;
  const pendingAlerts = db.alerts.filter((a) => !a.resolution).length;
  const workingText = `pending_tasks=${db.tasks.filter((t) => t.status !== "done").length}; pending_alerts=${pendingAlerts}`;
  const workingTokens = estimateTokens(workingText);
  const toolTokens = session.toolsUsed.length * 12;

  const layers: ContextLayerSnapshot[] = [
    {
      kind: "system",
      label: "system",
      tokenCount: systemTokens,
      itemCount: 1,
      preview: systemText,
    },
    {
      kind: "user",
      label: "user",
      tokenCount: userTokens,
      itemCount: db.tasks.length + db.reminders.length,
      preview: userFactsText,
    },
    {
      kind: "session",
      label: "session",
      tokenCount: summaryTokens,
      itemCount: session.semanticSummary.trim() ? 1 : 0,
      preview: compactPreview(session.semanticSummary || "—"),
    },
    {
      kind: "recent",
      label: "recent",
      tokenCount: recentTokens,
      itemCount: recent.length,
      preview: compactPreview(recent.map((m) => `[${m.role}] ${m.content}`).join(" | ") || "—"),
    },
    {
      kind: "retrieved",
      label: "retrieved",
      tokenCount: retrievedTokens,
      itemCount: session.associatedMemories.length,
      preview: session.associatedMemories.slice(0, 4).join(", ") || "—",
    },
    {
      kind: "working",
      label: "working",
      tokenCount: workingTokens,
      itemCount: 2,
      preview: workingText,
    },
    {
      kind: "tool",
      label: "tool",
      tokenCount: toolTokens,
      itemCount: session.toolsUsed.length,
      preview: session.toolsUsed.slice(0, 4).join(", ") || "—",
    },
  ];

  const totalTokens = layers.reduce((acc, l) => acc + l.tokenCount, 0);
  return { layers, totalTokens };
}

function defaultAgentDescriptors(): AgentDescriptor[] {
  return [
    {
      role: "orchestrator",
      name: "agentsHub.roles.orchestrator.name",
      responsibility: "agentsHub.roles.orchestrator.responsibility",
      status: "ready",
      capabilities: ["intent_routing", "multi_step_planning", "safety_gating"],
      safetyBoundary: "agentsHub.roles.orchestrator.safety",
    },
    {
      role: "memory_agent",
      name: "agentsHub.roles.memory_agent.name",
      responsibility: "agentsHub.roles.memory_agent.responsibility",
      status: "ready",
      capabilities: ["hindsight_recall", "hindsight_retain", "graph_traversal"],
      safetyBoundary: "agentsHub.roles.memory_agent.safety",
    },
    {
      role: "research_agent",
      name: "agentsHub.roles.research_agent.name",
      responsibility: "agentsHub.roles.research_agent.responsibility",
      status: "ready",
      capabilities: ["document_retrieval", "entity_graph_query", "evidence_synthesis"],
      safetyBoundary: "agentsHub.roles.research_agent.safety",
    },
    {
      role: "browser_agent",
      name: "agentsHub.roles.browser_agent.name",
      responsibility: "agentsHub.roles.browser_agent.responsibility",
      status: "guarded",
      capabilities: ["browser.navigate", "browser.extract_page"],
      safetyBoundary: "agentsHub.roles.browser_agent.safety",
    },
    {
      role: "computer_agent",
      name: "agentsHub.roles.computer_agent.name",
      responsibility: "agentsHub.roles.computer_agent.responsibility",
      status: "guarded",
      capabilities: ["computer.focus_window", "computer.capture_screen"],
      safetyBoundary: "agentsHub.roles.computer_agent.safety",
    },
    {
      role: "system_agent",
      name: "agentsHub.roles.system_agent.name",
      responsibility: "agentsHub.roles.system_agent.responsibility",
      status: "guarded",
      capabilities: ["system.read_workspace_file", "system.run_shell_command"],
      safetyBoundary: "agentsHub.roles.system_agent.safety",
    },
    {
      role: "context_manager",
      name: "agentsHub.roles.context_manager.name",
      responsibility: "agentsHub.roles.context_manager.responsibility",
      status: "ready",
      capabilities: ["context_compression", "token_monitoring"],
      safetyBoundary: "agentsHub.roles.context_manager.safety",
    },
    {
      role: "tool_registry",
      name: "agentsHub.roles.tool_registry.name",
      responsibility: "agentsHub.roles.tool_registry.responsibility",
      status: "ready",
      capabilities: ["policy_enforcement", "schema_validation"],
      safetyBoundary: "agentsHub.roles.tool_registry.safety",
    },
  ];
}

function builtinToolsCatalog(db: BrowserAuraStateSlice): AgentToolEntry[] {
  const base: AgentToolEntry[] = [
    {
      toolName: "memory.hindsight_recall",
      agentRole: "memory_agent",
      description: "agentsHub.tools.hindsight_recall",
      permission: "allow",
      riskLevel: "read",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "memory.hindsight_retain",
      agentRole: "memory_agent",
      description: "agentsHub.tools.hindsight_retain",
      permission: "require_approval",
      riskLevel: "write",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "research.knowledge_query",
      agentRole: "research_agent",
      description: "agentsHub.tools.knowledge_query",
      permission: "allow",
      riskLevel: "read",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "context.compress_session",
      agentRole: "context_manager",
      description: "agentsHub.tools.compress_session",
      permission: "allow",
      riskLevel: "write",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "propose_create_task",
      agentRole: "orchestrator",
      description: "agentsHub.tools.propose_create_task",
      permission: "require_approval",
      riskLevel: "write",
      enabled: true,
      source: "auradesk_mcp",
    },
    {
      toolName: "propose_create_reminder",
      agentRole: "orchestrator",
      description: "agentsHub.tools.propose_create_reminder",
      permission: "require_approval",
      riskLevel: "write",
      enabled: true,
      source: "auradesk_mcp",
    },
    {
      toolName: "browser.navigate",
      agentRole: "browser_agent",
      description: "agentsHub.tools.browser_navigate",
      permission: "require_approval",
      riskLevel: "privileged",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "browser.extract_page",
      agentRole: "browser_agent",
      description: "agentsHub.tools.browser_extract",
      permission: "require_approval",
      riskLevel: "privileged",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "computer.focus_window",
      agentRole: "computer_agent",
      description: "agentsHub.tools.computer_focus",
      permission: "require_approval",
      riskLevel: "privileged",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "computer.capture_screen",
      agentRole: "computer_agent",
      description: "agentsHub.tools.computer_capture",
      permission: "require_approval",
      riskLevel: "privileged",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "system.read_workspace_file",
      agentRole: "system_agent",
      description: "agentsHub.tools.system_read_file",
      permission: "allow",
      riskLevel: "read",
      enabled: true,
      source: "agent_runtime",
    },
    {
      toolName: "system.run_shell_command",
      agentRole: "system_agent",
      description: "agentsHub.tools.system_shell",
      permission: "require_approval",
      riskLevel: "destructive",
      enabled: true,
      source: "agent_runtime",
    },
  ];

  const plugins = ensureMcpPlugins(db, "2026-11-22T00:00:00Z");
  const known = new Set(base.map((t) => t.toolName));
  for (const plugin of plugins) {
    for (const toolName of plugin.discoveredTools) {
      if (!known.has(toolName)) {
        known.add(toolName);
        base.push({
          toolName,
          agentRole: "tool_registry",
          description: `MCP tool (${plugin.name})`,
          permission: "require_approval",
          riskLevel: "write",
          enabled: plugin.enabled,
          source: `mcp:${plugin.slug}`,
        });
      }
    }
  }

  const overrides = db.agentToolPolicies ?? {};
  return base.map((tool) => {
    const ov = overrides[tool.toolName];
    return ov ? { ...tool, permission: ov.permission, enabled: ov.enabled } : tool;
  });
}

function slugifyName(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}

function ensureAgentSkills(db: BrowserAuraStateSlice, nowIso: string): AgentSkillRecord[] {
  if (!Array.isArray(db.agentSkills)) {
    db.agentSkills = [
      {
        id: "skill-hindsight-curator",
        slug: "hindsight-memory-curator",
        name: "agentsHub.seeds.skill_hindsight_name",
        description: "agentsHub.seeds.skill_hindsight_desc",
        version: "1.2.0",
        sourceKind: "builtin",
        sourceUri: "builtin://skills/hindsight-memory-curator",
        installPath: "~/.auradesk/skills/hindsight-memory-curator/SKILL.md",
        skillMarkdown:
          "# Hindsight_Memory_Curator\n\nUse `memory.hindsight_recall` before answering and retain validated facts with topic_keys.",
        enabled: true,
        installedAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "skill-nixos-flake-ops",
        slug: "nixos-flake-ops",
        name: "agentsHub.seeds.skill_nixos_name",
        description: "agentsHub.seeds.skill_nixos_desc",
        version: "1.0.0",
        sourceKind: "catalog",
        sourceUri: "https://github.com/ragton/aura-skills/tree/main/nixos-flake-ops",
        installPath: "~/.auradesk/skills/nixos-flake-ops/SKILL.md",
        skillMarkdown:
          "# NixOS_Flakes_Operations\n\nValidate `flake.nix`, `PKG_CONFIG_PATH`, and `nix_develop` builds.",
        enabled: true,
        installedAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }
  return db.agentSkills;
}

function ensureAgentBots(db: BrowserAuraStateSlice, nowIso: string): AgentBotRecord[] {
  ensureAgentSkills(db, nowIso);
  if (!Array.isArray(db.agentBots)) {
    db.agentBots = [
      {
        id: "bot-aura-professora",
        slug: "aura-professora",
        name: "agentsHub.seeds.bot_study_name",
        roleKind: "study_coach",
        icon: "brain",
        description: "agentsHub.seeds.bot_study_desc",
        systemPrompt: "agentsHub.seeds.bot_study_prompt",
        preferredProvider: "auto",
        preferredModel: "gemini-2.5-pro",
        hindsightBank: "estudos",
        skillIds: ["skill-hindsight-curator"],
        enabled: true,
        pinnedInChat: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "bot-rust-architect",
        slug: "rust-clean-architect",
        name: "agentsHub.seeds.bot_rust_name",
        roleKind: "code_reviewer",
        icon: "cpu",
        description: "agentsHub.seeds.bot_rust_desc",
        systemPrompt: "agentsHub.seeds.bot_rust_prompt",
        preferredProvider: "auto",
        preferredModel: "gpt-4.1",
        hindsightBank: "engenharia",
        skillIds: ["skill-hindsight-curator", "skill-nixos-flake-ops"],
        enabled: true,
        pinnedInChat: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }
  return db.agentBots;
}

function ensureMcpPlugins(db: BrowserAuraStateSlice, nowIso: string): McpPluginRecord[] {
  if (!Array.isArray(db.mcpPlugins)) {
    db.mcpPlugins = [
      {
        id: "mcp-auradesk-builtin",
        slug: "auradesk-core-mcp",
        name: "agentsHub.seeds.mcp_core_name",
        transport: "stdio",
        commandOrUrl: "auradesk-mcp",
        args: ["--stdio"],
        envVars: [],
        enabled: true,
        lastHealthStatus: "healthy",
        lastHealthCheckedAt: nowIso,
        discoveredTools: ["propose_create_task", "propose_create_reminder"],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "mcp-hindsight-local",
        slug: "hindsight-memory-mcp",
        name: "agentsHub.seeds.mcp_hindsight_name",
        transport: "http_sse",
        commandOrUrl: "http://127.0.0.1:8919/mcp",
        args: [],
        envVars: [],
        enabled: true,
        lastHealthStatus: "healthy",
        lastHealthCheckedAt: nowIso,
        discoveredTools: ["memory.hindsight_recall", "memory.hindsight_retain"],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }
  return db.mcpPlugins;
}

async function detectBrowserKnowledgeEndpoint(): Promise<{
  serviceKind: string;
  online: boolean;
  prefix: string;
  diagnosticMessage: string | null;
}> {
  if (!allowLiveProxyFetch()) {
    return {
      serviceKind: "offline",
      online: false,
      prefix: "",
      diagnosticMessage: "lightrag_offline: live HTTP disabled in test runtime",
    };
  }
  try {
    const health = (await fetchJsonWithTimeout("/__lightrag/health", 1500)) as Record<
      string,
      unknown
    >;
    if (health && (health.core_version || health.configuration || health.pipeline_busy !== undefined)) {
      return { serviceKind: "lightrag", online: true, prefix: "/__lightrag", diagnosticMessage: null };
    }
  } catch {
    // try RAGLight managed server
  }
  try {
    await fetchJsonWithTimeout("/__raglight/health", 1500);
    return {
      serviceKind: "raglight_managed",
      online: true,
      prefix: "/__raglight",
      diagnosticMessage: null,
    };
  } catch {
    return {
      serviceKind: "offline",
      online: false,
      prefix: "",
      diagnosticMessage: "LightRAG / RAGLight endpoint offline (127.0.0.1:9621 / 8000)",
    };
  }
}

export async function handleAuraBrowserIpc<TDb extends BrowserAuraStateSlice>(
  cmd: string,
  deps: BrowserAuraDeps<TDb>
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  const { db, args, nowIso, genId, saveBrowserDb, runBrowserHermesPrompt } = deps;

  switch (cmd) {
    case "hindsight_status": {
      const configuredDefault = String(db.settings["hindsight.default_bank"] ?? "aura-main");
      const base: HindsightStatus = {
        enabled: db.settings["hindsight.enabled"] !== false,
        baseUrl: String(db.settings["hindsight.base_url"] ?? "http://127.0.0.1:8919"),
        defaultBank: configuredDefault,
        autoCreateBanks: db.settings["hindsight.auto_create_banks"] !== false,
        dailyMaintenance: db.settings["hindsight.daily_maintenance"] !== false,
        lastMaintenanceDate: String(db.settings["hindsight.last_maintenance_date"] ?? ""),
        online: false,
        banks: [configuredDefault],
        localCount: 0,
      };
      if (allowLiveProxyFetch() && base.enabled) {
        try {
          const banks = await proxyHindsightBanksList();
          if (banks.length > 0) {
            return {
              handled: true,
              result: {
                ...base,
                online: true,
                banks: banks.map((b) => b.id),
                defaultBank: banks.some((b) => b.id === configuredDefault)
                  ? configuredDefault
                  : banks[0].id,
              } satisfies HindsightStatus,
            };
          }
        } catch {
          // honest offline status
        }
      }
      return { handled: true, result: base };
    }

    case "hindsight_recall": {
      if (!allowLiveProxyFetch()) {
        return { handled: true, result: [] as HindsightRecallItem[] };
      }
      try {
        const banks = await proxyHindsightBanksList();
        const bank = asStr(args.bank) ?? banks[0]?.id ?? "aura-main";
        const limit = Math.min(50, Math.max(1, asNum(args.limit, 12)));
        const query = asStr(args.query);
        const page = (await fetchHindsight(
          `/v1/default/banks/${encodeURIComponent(bank)}/memories/list`,
          { limit, offset: 0, q: query ?? undefined }
        )) as { items?: Array<Record<string, unknown>> };
        const items: HindsightRecallItem[] = (Array.isArray(page?.items) ? page.items : []).map(
          (item) => ({
            id: String(item.id ?? ""),
            bank,
            content: String(item.text ?? item.content ?? ""),
            source: "hindsight_http",
            createdAt: asStr(item.date ?? item.mentioned_at),
          })
        );
        return { handled: true, result: items };
      } catch {
        return { handled: true, result: [] as HindsightRecallItem[] };
      }
    }

    case "hindsight_banks_list": {
      if (!allowLiveProxyFetch()) {
        return { handled: true, result: [] as HindsightBankSummary[] };
      }
      const banks = await proxyHindsightBanksList();
      return { handled: true, result: banks };
    }

    case "hindsight_bank_update": {
      const bankId = String(args.bankId ?? args.bank_id ?? "").trim();
      if (!bankId) throw new Error("bank_id_required");
      const name = asStr(args.name) ?? bankId;
      const mission = asStr(args.mission);
      const background = asStr(args.background);
      if (allowLiveProxyFetch()) {
        // The daemon updates a bank with the same PUT that creates one.
        await fetchHindsightWrite("PUT", `/v1/default/banks/${encodeURIComponent(bankId)}`, {
          name,
          ...(mission
            ? { mission, retain_mission: mission, reflect_mission: mission }
            : {}),
          ...(background ? { background } : {}),
        });
      }
      return {
        handled: true,
        result: {
          id: bankId,
          name,
          totalNodes: 0,
          totalLinks: 0,
          totalDocuments: 0,
        } satisfies HindsightBankSummary,
      };
    }

    case "hindsight_bank_delete": {
      const bankId = String(args.bankId ?? args.bank_id ?? "").trim();
      if (!bankId) throw new Error("bank_id_required");
      if (allowLiveProxyFetch()) {
        await fetchHindsightWrite(
          "DELETE",
          `/v1/default/banks/${encodeURIComponent(bankId)}`,
        );
      }
      return { handled: true, result: null };
    }

    case "hindsight_bank_create": {
      const bankId = String(args.bankId ?? args.bank_id ?? "").trim();
      if (!bankId) throw new Error("bank_id_required");
      const name = asStr(args.name) ?? bankId;
      const mission = asStr(args.mission);
      const background = asStr(args.background);
      if (allowLiveProxyFetch()) {
        await fetchHindsightWrite("PUT", `/v1/default/banks/${encodeURIComponent(bankId)}`, {
          name,
          ...(mission
            ? { mission, retain_mission: mission, reflect_mission: mission }
            : {}),
          ...(background ? { background } : {}),
        });
      }
      return {
        handled: true,
        result: {
          id: bankId,
          name,
          totalNodes: 0,
          totalLinks: 0,
          totalDocuments: 0,
        } satisfies HindsightBankSummary,
      };
    }

    case "hindsight_bank_stats": {
      const bank = String(args.bank ?? "");
      if (!allowLiveProxyFetch() || !bank) {
        return { handled: true, result: normalizeBankStats({}, bank) };
      }
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/stats`
      )) as Record<string, unknown>;
      return { handled: true, result: normalizeBankStats(raw ?? {}, bank) };
    }

    case "hindsight_memories_list": {
      const bank = String(args.bank ?? "");
      const limit = Math.min(200, Math.max(1, asNum(args.limit, 25)));
      const offset = Math.max(0, asNum(args.offset, 0));
      const query = asStr(args.query);
      const factType = asStr(args.factType ?? args.fact_type);
      if (!allowLiveProxyFetch() || !bank) {
        return {
          handled: true,
          result: { items: [], total: 0, limit, offset } satisfies HindsightMemoryPage,
        };
      }
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/memories/list`,
        {
          limit,
          offset,
          q: query ?? undefined,
          type: factType && factType !== "all" ? factType : undefined,
        }
      )) as { items?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number };
      return {
        handled: true,
        result: {
          items: (Array.isArray(raw?.items) ? raw.items : []).map(normalizeMemoryItem),
          total: asNum(raw?.total, 0),
          limit: asNum(raw?.limit, limit),
          offset: asNum(raw?.offset, offset),
        } satisfies HindsightMemoryPage,
      };
    }

    case "hindsight_memory_retain": {
      const bank = String(args.bank ?? "").trim();
      const content = String(args.content ?? "").trim();
      if (!bank || !content) throw new Error("memory_content_required");
      const context = asStr(args.context);
      const tags = looseStrings(args.tags);
      if (!allowLiveProxyFetch()) {
        return { handled: true, result: { ok: true } };
      }
      const res = await fetchHindsightWrite(
        "POST",
        `/v1/default/banks/${encodeURIComponent(bank)}/memories`,
        {
          items: [{ content, ...(context ? { context } : {}), ...(tags.length ? { tags } : {}) }],
          async: false,
        }
      );
      return { handled: true, result: res };
    }

    case "hindsight_memory_get": {
      const bank = String(args.bank ?? "");
      const memoryId = String(args.memoryId ?? args.memory_id ?? "");
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(memoryId)}`
      )) as Record<string, unknown>;
      const sourceMemoriesRaw = Array.isArray(raw?.source_memories)
        ? (raw.source_memories as Array<Record<string, unknown>>)
        : [];
      const historyRaw = Array.isArray(raw?.history)
        ? (raw.history as Array<Record<string, unknown>>)
        : [];
      const detail: HindsightMemoryDetail = {
        id: String(raw?.id ?? memoryId),
        text: String(raw?.text ?? ""),
        context: asStr(raw?.context),
        date: asStr(raw?.date),
        factType: asStr(raw?.type ?? raw?.fact_type),
        documentId: asStr(raw?.document_id),
        mentionedAt: asStr(raw?.mentioned_at),
        occurredStart: asStr(raw?.occurred_start),
        occurredEnd: asStr(raw?.occurred_end),
        entities: looseStrings(raw?.entities),
        tags: looseStrings(raw?.tags),
        chunkId: asStr(raw?.chunk_id),
        state: asStr(raw?.state),
        sourceMemoryIds: looseStrings(raw?.source_memory_ids),
        sourceMemories: sourceMemoriesRaw.map(normalizeMemoryItem),
        history: historyRaw.map(
          (entry): HindsightMemoryHistoryEntry => ({
            id: asStr(entry.id),
            text: asStr(entry.text),
            changedAt: asStr(entry.changed_at),
            createdAt: asStr(entry.created_at),
            occurredAt: asStr(entry.occurred_at),
            action: asStr(entry.action),
            raw: entry,
          })
        ),
      };
      return { handled: true, result: detail };
    }

    case "hindsight_memory_history": {
      const bank = String(args.bank ?? "");
      const memoryId = String(args.memoryId ?? args.memory_id ?? "");
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(memoryId)}/history`
      )) as Array<Record<string, unknown>> | { history?: Array<Record<string, unknown>> };
      const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.history) ? raw.history : [];
      return {
        handled: true,
        result: arr.map(
          (entry): HindsightMemoryHistoryEntry => ({
            id: asStr(entry.id),
            text: asStr(entry.text),
            changedAt: asStr(entry.changed_at),
            createdAt: asStr(entry.created_at),
            occurredAt: asStr(entry.occurred_at),
            action: asStr(entry.action),
            raw: entry,
          })
        ),
      };
    }

    case "hindsight_documents_list": {
      const bank = String(args.bank ?? "");
      const limit = Math.min(200, Math.max(1, asNum(args.limit, 25)));
      const offset = Math.max(0, asNum(args.offset, 0));
      const query = asStr(args.query);
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/documents`,
        { limit, offset, q: query ?? undefined }
      )) as { items?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number };
      return {
        handled: true,
        result: {
          items: (Array.isArray(raw?.items) ? raw.items : []).map(
            (d): HindsightDocumentItem => ({
              id: String(d.id ?? ""),
              bankId: asStr(d.bank_id),
              contentHash: asStr(d.content_hash),
              createdAt: asStr(d.created_at),
              updatedAt: asStr(d.updated_at),
              textLength: asNum(d.text_length, 0),
              memoryUnitCount: asNum(d.memory_unit_count, 0),
              context: asStr((d.retain_params as Record<string, unknown> | undefined)?.context ?? d.context),
              tags: looseStrings(d.tags),
            })
          ),
          total: asNum(raw?.total, 0),
          limit: asNum(raw?.limit, limit),
          offset: asNum(raw?.offset, offset),
        } satisfies HindsightDocumentPage,
      };
    }

    case "hindsight_document_get": {
      const bank = String(args.bank ?? "");
      const docId = String(args.documentId ?? args.document_id ?? "");
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/documents/${encodeURIComponent(docId)}`
      )) as Record<string, unknown>;
      return {
        handled: true,
        result: {
          id: String(raw?.id ?? docId),
          bankId: asStr(raw?.bank_id),
          originalText: typeof raw?.original_text === "string" ? raw.original_text : null,
          contentHash: asStr(raw?.content_hash),
          createdAt: asStr(raw?.created_at),
          updatedAt: asStr(raw?.updated_at),
          memoryUnitCount: asNum(raw?.memory_unit_count, 0),
          nodesByFactType:
            raw?.nodes_by_fact_type && typeof raw.nodes_by_fact_type === "object"
              ? (raw.nodes_by_fact_type as Record<string, number>)
              : {},
          tags: looseStrings(raw?.tags),
          context: asStr(
            (raw?.retain_params as Record<string, unknown> | undefined)?.context ?? raw?.context
          ),
          metadata: raw?.document_metadata ?? null,
        } satisfies HindsightDocumentDetail,
      };
    }

    case "hindsight_entities_list": {
      const bank = String(args.bank ?? "");
      const limit = Math.min(200, Math.max(1, asNum(args.limit, 25)));
      const offset = Math.max(0, asNum(args.offset, 0));
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/entities`,
        { limit, offset }
      )) as { items?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number };
      return {
        handled: true,
        result: {
          items: (Array.isArray(raw?.items) ? raw.items : []).map(
            (e): HindsightEntityItem => ({
              id: String(e.id ?? ""),
              canonicalName: String(e.canonical_name ?? e.id ?? ""),
              mentionCount: asNum(e.mention_count, 0),
              firstSeen: asStr(e.first_seen),
              lastSeen: asStr(e.last_seen),
            })
          ),
          total: asNum(raw?.total, 0),
          limit: asNum(raw?.limit, limit),
          offset: asNum(raw?.offset, offset),
        } satisfies HindsightEntityPage,
      };
    }

    case "hindsight_entity_get": {
      const bank = String(args.bank ?? "");
      const entityId = String(args.entityId ?? args.entity_id ?? "");
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/entities/${encodeURIComponent(entityId)}`
      )) as Record<string, unknown>;
      const obs = Array.isArray(raw?.observations)
        ? (raw.observations as Array<Record<string, unknown>>)
        : [];
      return {
        handled: true,
        result: {
          id: String(raw?.id ?? entityId),
          canonicalName: String(raw?.canonical_name ?? entityId),
          mentionCount: asNum(raw?.mention_count, 0),
          firstSeen: asStr(raw?.first_seen),
          lastSeen: asStr(raw?.last_seen),
          observations: obs.map((o) => ({
            text: String(o.text ?? ""),
            mentionedAt: asStr(o.mentioned_at),
          })),
        } satisfies HindsightEntityDetail,
      };
    }

    case "hindsight_graph": {
      const bank = String(args.bank ?? "");
      const limit = asNum(args.limit, 100);
      const query = asStr(args.query);
      const factType = asStr(args.factType ?? args.fact_type);
      if (!allowLiveProxyFetch() || !bank) {
        return {
          handled: true,
          result: { nodes: [], edges: [], totalUnits: 0 } satisfies HindsightGraphPayload,
        };
      }
      return {
        handled: true,
        result: await proxyHindsightGraph(bank, limit, query, factType),
      };
    }

    case "hindsight_mental_models": {
      const bank = String(args.bank ?? "");
      const limit = Math.min(200, Math.max(1, asNum(args.limit, 25)));
      if (!allowLiveProxyFetch() || !bank) {
        return {
          handled: true,
          result: { items: [], total: 0, limit, offset: 0 } satisfies HindsightMentalModelPage,
        };
      }
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/mental-models`,
        { limit, detail: "content" }
      )) as { items?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number };
      return {
        handled: true,
        result: {
          items: (Array.isArray(raw?.items) ? raw.items : []).map(
            (m): HindsightMentalModel => ({
              id: String(m.id ?? ""),
              bankId: asStr(m.bank_id),
              name: String(m.name ?? ""),
              sourceQuery: asStr(m.source_query),
              content: typeof m.content === "string" ? m.content : null,
              tags: looseStrings(m.tags),
              lastRefreshedAt: asStr(m.last_refreshed_at),
              lastMemorySeenAt: asStr(m.last_memory_seen_at),
              lastRefreshFailedAt: asStr(m.last_refresh_failed_at),
              createdAt: asStr(m.created_at),
              isStale: Boolean(m.is_stale),
            })
          ),
          total: asNum(raw?.total, 0),
          limit: asNum(raw?.limit, limit),
          offset: asNum(raw?.offset, 0),
        } satisfies HindsightMentalModelPage,
      };
    }

    case "hindsight_mental_model_create": {
      const bank = String(args.bank ?? "").trim();
      const name = String(args.name ?? "").trim();
      const sourceQuery = String(args.sourceQuery ?? args.source_query ?? "").trim();
      if (!bank || !name || !sourceQuery) {
        throw new Error("mental_model_name_and_query_required");
      }
      const customId = asStr(args.customId ?? args.custom_id);
      const tags = looseStrings(args.tags);
      if (!allowLiveProxyFetch()) {
        return {
          handled: true,
          result: {
            id: customId ?? genId(),
            bankId: bank,
            name,
            sourceQuery,
            content: null,
            tags,
            lastRefreshedAt: nowIso,
            lastMemorySeenAt: null,
            lastRefreshFailedAt: null,
            createdAt: nowIso,
            isStale: false,
          } satisfies HindsightMentalModel,
        };
      }
      const m = (await fetchHindsightWrite(
        "POST",
        `/v1/default/banks/${encodeURIComponent(bank)}/mental-models`,
        {
          name,
          source_query: sourceQuery,
          ...(customId ? { id: customId } : {}),
          ...(tags.length ? { tags } : {}),
        }
      )) as Record<string, unknown>;
      return {
        handled: true,
        result: {
          id: String(m?.id ?? customId ?? genId()),
          bankId: asStr(m?.bank_id) ?? bank,
          name: String(m?.name ?? name),
          sourceQuery: asStr(m?.source_query) ?? sourceQuery,
          content: typeof m?.content === "string" ? m.content : null,
          tags: looseStrings(m?.tags ?? tags),
          lastRefreshedAt: asStr(m?.last_refreshed_at),
          lastMemorySeenAt: asStr(m?.last_memory_seen_at),
          lastRefreshFailedAt: asStr(m?.last_refresh_failed_at),
          createdAt: asStr(m?.created_at) ?? nowIso,
          isStale: Boolean(m?.is_stale),
        } satisfies HindsightMentalModel,
      };
    }

    case "hindsight_mental_model_refresh": {
      const bank = String(args.bank ?? "").trim();
      const modelId = String(args.modelId ?? args.model_id ?? "").trim();
      if (!allowLiveProxyFetch() || !bank || !modelId) {
        return { handled: true, result: { ok: true } };
      }
      const res = await fetchHindsightWrite(
        "POST",
        `/v1/default/banks/${encodeURIComponent(bank)}/mental-models/${encodeURIComponent(modelId)}/refresh`
      );
      return { handled: true, result: res };
    }

    case "hindsight_mental_model_delete": {
      const bank = String(args.bank ?? "").trim();
      const modelId = String(args.modelId ?? args.model_id ?? "").trim();
      if (allowLiveProxyFetch() && bank && modelId) {
        await fetchHindsightWrite(
          "DELETE",
          `/v1/default/banks/${encodeURIComponent(bank)}/mental-models/${encodeURIComponent(modelId)}`
        );
      }
      return { handled: true, result: true };
    }

    case "hindsight_directives_list": {
      const bank = String(args.bank ?? "").trim();
      if (!allowLiveProxyFetch() || !bank) {
        return { handled: true, result: [] as HindsightDirective[] };
      }
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/directives`,
        { active_only: "false", limit: 100 }
      )) as { items?: Array<Record<string, unknown>> };
      return {
        handled: true,
        result: (Array.isArray(raw?.items) ? raw.items : []).map(
          (d): HindsightDirective => ({
            id: String(d.id ?? ""),
            bankId: asStr(d.bank_id) ?? bank,
            name: String(d.name ?? ""),
            content: String(d.content ?? ""),
            priority: asNum(d.priority, 0),
            isActive: d.is_active !== false,
            tags: looseStrings(d.tags),
            createdAt: asStr(d.created_at),
            updatedAt: asStr(d.updated_at),
          })
        ),
      };
    }

    case "hindsight_directive_create": {
      const bank = String(args.bank ?? "").trim();
      const name = String(args.name ?? "").trim();
      const content = String(args.content ?? "").trim();
      if (!bank || !name || !content) {
        throw new Error("directive_name_and_content_required");
      }
      const tags = looseStrings(args.tags);
      if (!allowLiveProxyFetch()) {
        return {
          handled: true,
          result: {
            id: genId(),
            bankId: bank,
            name,
            content,
            priority: 0,
            isActive: true,
            tags,
            createdAt: nowIso,
            updatedAt: nowIso,
          } satisfies HindsightDirective,
        };
      }
      const d = (await fetchHindsightWrite(
        "POST",
        `/v1/default/banks/${encodeURIComponent(bank)}/directives`,
        { name, content, priority: 0, is_active: true, tags }
      )) as Record<string, unknown>;
      return {
        handled: true,
        result: {
          id: String(d?.id ?? genId()),
          bankId: asStr(d?.bank_id) ?? bank,
          name: String(d?.name ?? name),
          content: String(d?.content ?? content),
          priority: asNum(d?.priority, 0),
          isActive: d?.is_active !== false,
          tags: looseStrings(d?.tags ?? tags),
          createdAt: asStr(d?.created_at) ?? nowIso,
          updatedAt: asStr(d?.updated_at) ?? nowIso,
        } satisfies HindsightDirective,
      };
    }

    case "hindsight_directive_delete": {
      const bank = String(args.bank ?? "").trim();
      const directiveId = String(args.directiveId ?? args.directive_id ?? "").trim();
      if (allowLiveProxyFetch() && bank && directiveId) {
        await fetchHindsightWrite(
          "DELETE",
          `/v1/default/banks/${encodeURIComponent(bank)}/directives/${encodeURIComponent(directiveId)}`
        );
      }
      return { handled: true, result: true };
    }

    case "hindsight_operations_list": {
      const bank = String(args.bank ?? "").trim();
      const limit = Math.min(100, Math.max(1, asNum(args.limit, 20)));
      if (!allowLiveProxyFetch() || !bank) {
        return { handled: true, result: [] as HindsightOperation[] };
      }
      const raw = (await fetchHindsight(
        `/v1/default/banks/${encodeURIComponent(bank)}/operations`,
        { limit }
      )) as { operations?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> };
      const list = Array.isArray(raw?.operations)
        ? raw.operations
        : Array.isArray(raw?.items)
          ? raw.items
          : [];
      return {
        handled: true,
        result: list.map(
          (op): HindsightOperation => ({
            id: String(op.id ?? op.operation_id ?? ""),
            operationType: String(op.operation_type ?? op.task_type ?? "operation"),
            status: String(op.status ?? "unknown"),
            createdAt: asStr(op.created_at),
            updatedAt: asStr(op.updated_at),
            errorMessage: asStr(op.error_message),
          })
        ),
      };
    }

    case "hindsight_bank_consolidate": {
      const bank = String(args.bank ?? "").trim();
      if (!allowLiveProxyFetch() || !bank) {
        return { handled: true, result: { ok: true } };
      }
      const res = await fetchHindsightWrite(
        "POST",
        `/v1/default/banks/${encodeURIComponent(bank)}/consolidate`
      );
      return { handled: true, result: res };
    }

    case "hindsight_global_search": {
      if (!allowLiveProxyFetch()) {
        return { handled: true, result: [] as HindsightGlobalSearchHit[] };
      }
      const query = String(args.query ?? "").trim();
      const targetBank = asStr(args.bank);
      const factType = asStr(args.factType ?? args.fact_type);
      const limit = Math.min(200, Math.max(1, asNum(args.limit, 25)));
      const banks = targetBank
        ? [{ id: targetBank, name: targetBank, totalNodes: 0, totalLinks: 0, totalDocuments: 0 }]
        : await proxyHindsightBanksList().catch(() => []);
      const seen = new Set<string>();
      const hits: HindsightGlobalSearchHit[] = [];
      for (const b of banks) {
        try {
          const raw = (await fetchHindsight(
            `/v1/default/banks/${encodeURIComponent(b.id)}/memories/list`,
            {
              limit,
              offset: 0,
              q: query || undefined,
              type: factType && factType !== "all" ? factType : undefined,
            }
          )) as { items?: Array<Record<string, unknown>> };
          for (const entry of Array.isArray(raw?.items) ? raw.items : []) {
            const norm = normalizeMemoryItem(entry);
            if (!norm.id || seen.has(norm.id)) continue;
            seen.add(norm.id);
            hits.push({
              id: norm.id,
              bankId: b.id,
              bankName: b.name,
              text: norm.text,
              context: norm.context,
              factType: norm.factType,
              date: norm.date,
              documentId: norm.documentId,
              entities: norm.entities,
              tags: norm.tags,
              matchKind: "text",
            });
          }
        } catch {
          // continue across remaining banks
        }
      }
      return { handled: true, result: hits };
    }

    case "hindsight_galaxy_snapshot": {
      const bankFilter = asStr(args.bankFilter ?? args.bank_filter);
      const perBank = Math.min(50, Math.max(4, asNum(args.limitPerBank ?? args.limit_per_bank, 18)));
      if (!allowLiveProxyFetch()) {
        return {
          handled: true,
          result: {
            online: false,
            banks: [],
            globes: [],
            links: [],
            totalRealNodes: 0,
          } satisfies HindsightGalaxySnapshot,
        };
      }
      try {
        const banks = await proxyHindsightBanksList();
        const selected = bankFilter ? banks.filter((b) => b.id === bankFilter) : banks;
        const globes: HindsightGalaxyGlobe[] = [];
        const links: HindsightGalaxyLink[] = [];
        const seen = new Set<string>();

        await Promise.all(
          selected.map(async (b) => {
            try {
              const rawPage = (await fetchHindsight(
                `/v1/default/banks/${encodeURIComponent(b.id)}/memories/list`,
                { limit: perBank, offset: 0 }
              )) as { items?: Array<Record<string, unknown>> };
              for (const entry of Array.isArray(rawPage?.items) ? rawPage.items : []) {
                const item = normalizeMemoryItem(entry);
                if (!item.id || seen.has(item.id)) continue;
                seen.add(item.id);
                const firstLine = item.text.split("\n")[0] ?? item.text;
                globes.push({
                  id: item.id,
                  bankId: b.id,
                  bankName: b.name,
                  title: item.context || firstLine.slice(0, 64),
                  content: item.text,
                  factType: item.factType ?? "world",
                  date: item.date ?? item.mentionedAt,
                  context: item.context,
                  documentId: item.documentId,
                  entities: item.entities,
                  tags: item.tags,
                });
              }
            } catch {
              // ignore individual bank read error
            }
            try {
              const gr = await proxyHindsightGraph(b.id, perBank * 2, null);
              for (const e of gr.edges) {
                links.push({
                  source: e.source,
                  target: e.target,
                  bankId: b.id,
                  linkType: e.linkType,
                  weight: e.weight ?? 0.5,
                  entityName: e.entityName,
                });
              }
            } catch {
              // ignore individual graph error
            }
          })
        );

        return {
          handled: true,
          result: {
            online: banks.length > 0,
            banks,
            globes,
            links,
            totalRealNodes: banks.reduce((sum, b) => sum + b.totalNodes, 0),
          } satisfies HindsightGalaxySnapshot,
        };
      } catch {
        return {
          handled: true,
          result: {
            online: false,
            banks: [],
            globes: [],
            links: [],
            totalRealNodes: 0,
          } satisfies HindsightGalaxySnapshot,
        };
      }
    }

    case "knowledge_overview": {
      const folders = String(db.settings["raglight.folders"] ?? "")
        .split(/[;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const baseUrl = String(db.settings["raglight.base_url"] ?? "http://127.0.0.1:9621");
      const probe = await detectBrowserKnowledgeEndpoint();
      const statusCounts: Record<string, number> = {};
      let documentsCount = 0;
      let entitiesCount = 0;
      let relationsCount = 0;

      if (probe.online && probe.serviceKind === "lightrag") {
        try {
          const docs = (await fetchJsonWithTimeout(`${probe.prefix}/documents`, 2500)) as {
            statuses?: Record<string, Array<Record<string, unknown>>>;
          };
          if (docs?.statuses && typeof docs.statuses === "object") {
            for (const [st, arr] of Object.entries(docs.statuses)) {
              const count = Array.isArray(arr) ? arr.length : 0;
              statusCounts[st] = count;
              documentsCount += count;
            }
          }
          const gr = (await fetchJsonWithTimeout(`${probe.prefix}/graphs?label=*`, 2500)) as {
            nodes?: unknown[];
            edges?: unknown[];
          };
          entitiesCount = Array.isArray(gr?.nodes) ? gr.nodes.length : 0;
          relationsCount = Array.isArray(gr?.edges) ? gr.edges.length : 0;
        } catch {
          // keep partial honest counts
        }
      }

      return {
        handled: true,
        result: {
          serviceKind: probe.serviceKind,
          online: probe.online,
          baseUrl,
          documentsCount,
          entitiesCount,
          relationsCount,
          configuredFolders: folders,
          localFileCount: 0,
          statusCounts,
          diagnosticMessage: probe.diagnosticMessage,
        } satisfies KnowledgeExplorerOverview,
      };
    }

    case "knowledge_documents_list": {
      const probe = await detectBrowserKnowledgeEndpoint();
      if (!probe.online || probe.serviceKind !== "lightrag") {
        return {
          handled: true,
          result: {
            serviceKind: probe.serviceKind,
            online: probe.online,
            documents: [],
            diagnosticMessage: probe.diagnosticMessage,
          } satisfies KnowledgeDocumentsResult,
        };
      }
      const query = (asStr(args.query) ?? "").toLowerCase();
      const raw = (await fetchJsonWithTimeout(`${probe.prefix}/documents`, 3000)) as {
        statuses?: Record<string, Array<Record<string, unknown>>>;
      };
      const documents: KnowledgeDocumentEntry[] = [];
      if (raw?.statuses && typeof raw.statuses === "object") {
        for (const [st, arr] of Object.entries(raw.statuses)) {
          for (const d of Array.isArray(arr) ? arr : []) {
            const title = String(d.file_path ?? d.id ?? "");
            const preview = String(d.content_summary ?? "");
            if (query && !title.toLowerCase().includes(query) && !preview.toLowerCase().includes(query)) {
              continue;
            }
            documents.push({
              id: String(d.id ?? ""),
              title,
              sourcePath: asStr(d.file_path),
              status: String(d.status ?? st),
              contentPreview: preview.slice(0, 220),
              contentLength: asNum(d.content_length, preview.length),
              chunksCount: asNum(d.chunks_count, 0),
              entities: [],
              updatedAt: asStr(d.updated_at ?? d.created_at),
              origin: "lightrag",
            });
          }
        }
      }
      return {
        handled: true,
        result: {
          serviceKind: probe.serviceKind,
          online: true,
          documents,
          diagnosticMessage: null,
        } satisfies KnowledgeDocumentsResult,
      };
    }

    case "knowledge_document_get": {
      const docId = String(args.docId ?? args.doc_id ?? "");
      const probe = await detectBrowserKnowledgeEndpoint();
      if (!probe.online || probe.serviceKind !== "lightrag") {
        throw new Error(probe.diagnosticMessage ?? "knowledge_offline");
      }
      const docs = (await fetchJsonWithTimeout(`${probe.prefix}/documents`, 3000)) as {
        statuses?: Record<string, Array<Record<string, unknown>>>;
      };
      let found: Record<string, unknown> | null = null;
      if (docs?.statuses) {
        for (const arr of Object.values(docs.statuses)) {
          const hit = (Array.isArray(arr) ? arr : []).find((d) => String(d.id ?? "") === docId);
          if (hit) {
            found = hit;
            break;
          }
        }
      }
      if (!found) throw new Error(`document_not_found: ${docId}`);
      return {
        handled: true,
        result: {
          id: docId,
          title: String(found.file_path ?? docId),
          sourcePath: asStr(found.file_path),
          content: String(found.content ?? found.content_summary ?? ""),
          status: String(found.status ?? "indexed"),
          entities: [],
          relations: [],
          origin: "lightrag",
        } satisfies KnowledgeDocumentDetail,
      };
    }

    case "knowledge_graph": {
      const probe = await detectBrowserKnowledgeEndpoint();
      if (!probe.online || probe.serviceKind !== "lightrag") {
        return {
          handled: true,
          result: {
            serviceKind: probe.serviceKind,
            online: probe.online,
            entities: [],
            relations: [],
            diagnosticMessage: probe.diagnosticMessage,
          } satisfies KnowledgeGraphPayload,
        };
      }
      const label = asStr(args.label) ?? "*";
      const raw = (await fetchJsonWithTimeout(
        `${probe.prefix}/graphs?label=${encodeURIComponent(label)}`,
        3500
      )) as {
        nodes?: Array<Record<string, unknown>>;
        edges?: Array<Record<string, unknown>>;
      };
      const entities: KnowledgeEntityEntry[] = (Array.isArray(raw?.nodes) ? raw.nodes : []).map(
        (n) => {
          const props = (n.properties as Record<string, unknown> | undefined) ?? n;
          return {
            id: String(n.id ?? ""),
            name: String(props.entity_id ?? n.id ?? ""),
            entityType: String(props.entity_type ?? "entity"),
            description: String(props.description ?? ""),
            sourceId: asStr(props.source_id),
          };
        }
      );
      const relations: KnowledgeRelationEntry[] = (Array.isArray(raw?.edges) ? raw.edges : []).map(
        (e) => {
          const props = (e.properties as Record<string, unknown> | undefined) ?? e;
          return {
            id: String(e.id ?? `${e.source ?? ""}-${e.target ?? ""}`),
            source: String(e.source ?? ""),
            target: String(e.target ?? ""),
            description: String(props.description ?? ""),
            keywords: looseStrings(props.keywords),
            weight: asNum(props.weight, 1),
            sourceId: asStr(props.source_id),
          };
        }
      );
      return {
        handled: true,
        result: {
          serviceKind: probe.serviceKind,
          online: true,
          entities,
          relations,
          diagnosticMessage: null,
        } satisfies KnowledgeGraphPayload,
      };
    }

    case "knowledge_search": {
      const probe = await detectBrowserKnowledgeEndpoint();
      if (!probe.online) {
        return {
          handled: true,
          result: {
            serviceKind: probe.serviceKind,
            online: false,
            answer: "",
            sources: [],
            matchingDocuments: [],
            matchingEntities: [],
            matchingRelations: [],
            diagnosticMessage: probe.diagnosticMessage,
          } satisfies KnowledgeSearchResult,
        };
      }
      return {
        handled: true,
        result: {
          serviceKind: probe.serviceKind,
          online: true,
          answer: "",
          sources: [],
          matchingDocuments: [],
          matchingEntities: [],
          matchingRelations: [],
          diagnosticMessage: null,
        } satisfies KnowledgeSearchResult,
      };
    }

    case "chat_sessions_list": {
      const sessions = ensureSessions(db, nowIso);
      const query = (asStr(args.query) ?? "").toLowerCase();
      const status = asStr(args.status);
      const dateFrom = asStr(args.dateFrom ?? args.date_from);
      const dateTo = asStr(args.dateTo ?? args.date_to);
      const messages = db.chatMessages ?? [];
      const filtered = sessions.filter((s) => {
        if (status && status !== "all" && s.status !== status) return false;
        if (dateFrom && s.createdAt.slice(0, 10) < dateFrom) return false;
        if (dateTo && s.createdAt.slice(0, 10) > dateTo) return false;
        if (query) {
          const inSession =
            s.title.toLowerCase().includes(query) ||
            s.semanticSummary.toLowerCase().includes(query) ||
            (s.lastMessagePreview ?? "").toLowerCase().includes(query);
          const inMsg = messages.some(
            (m) => m.sessionId === s.id && m.content.toLowerCase().includes(query)
          );
          return inSession || inMsg;
        }
        return true;
      });
      return {
        handled: true,
        result: [...filtered].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
      };
    }

    case "chat_sessions_create": {
      const sessions = ensureSessions(db, nowIso);
      const created: ChatSession = {
        ...defaultChatSession(nowIso, db.settings),
        id: genId(),
        title: asStr(args.title) ?? "sessions.untitledSession",
      };
      sessions.unshift(created);
      saveBrowserDb(db);
      return { handled: true, result: created };
    }

    case "chat_sessions_get": {
      const sessions = ensureSessions(db, nowIso);
      const sid = String(args.sessionId ?? args.session_id ?? DEFAULT_SESSION_ID);
      return { handled: true, result: sessions.find((s) => s.id === sid) ?? null };
    }

    case "chat_sessions_rename": {
      const sessions = ensureSessions(db, nowIso);
      const sid = String(args.sessionId ?? args.session_id ?? DEFAULT_SESSION_ID);
      const title = asStr(args.title) ?? "sessions.untitledSession";
      const found = sessions.find((s) => s.id === sid);
      if (!found) throw new Error(`session_not_found: ${sid}`);
      found.title = title;
      found.updatedAt = nowIso;
      saveBrowserDb(db);
      return { handled: true, result: found };
    }

    case "chat_sessions_set_status": {
      const sessions = ensureSessions(db, nowIso);
      const sid = String(args.sessionId ?? args.session_id ?? DEFAULT_SESSION_ID);
      const status = String(args.status ?? "active");
      const found = sessions.find((s) => s.id === sid);
      if (!found) throw new Error(`session_not_found: ${sid}`);
      found.status = status;
      found.updatedAt = nowIso;
      saveBrowserDb(db);
      return { handled: true, result: found };
    }

    case "chat_sessions_delete": {
      const sid = String(args.sessionId ?? args.session_id ?? "");
      if (sid === DEFAULT_SESSION_ID) {
        throw new Error("cannot delete default session");
      }
      db.chatSessions = ensureSessions(db, nowIso).filter((s) => s.id !== sid);
      db.chatMessages = (db.chatMessages ?? []).filter((m) => m.sessionId !== sid);
      db.contextEvents = (db.contextEvents ?? []).filter((e) => e.sessionId !== sid);
      saveBrowserDb(db);
      return { handled: true, result: null };
    }

    case "ai_chat_history": {
      const limit = Math.max(1, asNum(args.limit, 50));
      const sid = asStr(args.sessionId ?? args.session_id);
      const all = Array.isArray(db.chatMessages) ? db.chatMessages : [];
      const scoped = sid ? all.filter((m) => m.sessionId === sid) : all;
      return { handled: true, result: scoped.slice(-limit) };
    }

    case "ai_chat_clear": {
      const sid = asStr(args.sessionId ?? args.session_id) ?? DEFAULT_SESSION_ID;
      const before = Array.isArray(db.chatMessages) ? db.chatMessages.length : 0;
      db.chatMessages = (db.chatMessages ?? []).filter((m) => m.sessionId !== sid);
      const sessions = ensureSessions(db, nowIso);
      const sess = sessions.find((s) => s.id === sid);
      if (sess) {
        sess.messageCount = 0;
        sess.lastMessagePreview = null;
        sess.updatedAt = nowIso;
      }
      saveBrowserDb(db);
      return { handled: true, result: before - db.chatMessages.length };
    }

    case "hermes_chat_cancel": {
      // The browser build answers synchronously — there is nothing to stop.
      return { handled: true, result: false };
    }

    case "hermes_chat_send": {
      const prompt = String(args.prompt ?? "");
      if (!prompt.trim()) throw new Error("prompt is required");
      const sid = asStr(args.sessionId ?? args.session_id) ?? DEFAULT_SESSION_ID;
      const sessions = ensureSessions(db, nowIso);
      const sess = sessions.find((s) => s.id === sid) ?? sessions[0];
      const reply = runBrowserHermesPrompt(db, prompt, nowIso);
      if (!Array.isArray(db.chatMessages)) db.chatMessages = [];
      db.chatMessages.push({
        id: genId(),
        sessionId: sess.id,
        role: "user",
        content: prompt.trim(),
        provider: sess.provider ?? "local",
        model: sess.model ?? "offline",
        areaId: null,
        createdAt: nowIso,
      });
      db.chatMessages.push({
        id: genId(),
        sessionId: sess.id,
        role: "assistant",
        content: reply.replyText,
        provider: reply.mode,
        model: sess.model ?? "offline",
        areaId: null,
        createdAt: nowIso,
      });

      const sessMsgs = db.chatMessages.filter((m) => m.sessionId === sess.id);
      const { totalTokens, layers } = buildContextLayers(db, sess, sessMsgs);
      const ratio = totalTokens / Math.max(1024, sess.tokenBudget);
      if (sessMsgs.length > RECENT_TAIL_KEEP && ratio >= COMPRESS_USAGE_RATIO) {
        const splitAt = sessMsgs.length - RECENT_TAIL_KEEP;
        const older = sessMsgs.slice(0, splitAt);
        const preservedIds = older.map((m) => m.id);
        sess.semanticSummary = compactPreview(
          `${sess.semanticSummary}\n${older.map((m) => `[${m.role}] ${m.content}`).join("\n")}`,
          1400
        );
        sess.compressionCount += 1;
        sess.compressionState = "compressed";
        sess.contextState = "compressed";
        if (!Array.isArray(db.contextEvents)) db.contextEvents = [];
        db.contextEvents.unshift({
          id: genId(),
          sessionId: sess.id,
          kind: "compression",
          reason: "autonomous_budget_guard",
          tokensBefore: totalTokens,
          tokensAfter: Math.max(1, Math.round(totalTokens * 0.55)),
          messagesCompressed: older.length,
          preservedMessageIds: preservedIds,
          retrievedMemoryIds: sess.associatedMemories,
          layers,
          createdAt: nowIso,
        });
      } else {
        sess.contextState =
          sess.compressionCount > 0
            ? "compressed"
            : ratio >= APPROACHING_USAGE_RATIO
              ? "approaching_limit"
              : "healthy";
      }

      sess.messageCount = sessMsgs.length;
      sess.lastMessagePreview = compactPreview(reply.replyText, 120);
      sess.estimatedTokens = totalTokens;
      sess.updatedAt = nowIso;
      sess.lastActivityAt = nowIso;
      if (reply.proposal) {
        const toolName =
          reply.proposal.kind === "create_task" ? "propose_create_task" : "propose_create_reminder";
        if (!sess.toolsUsed.includes(toolName)) {
          sess.toolsUsed.push(toolName);
        }
      }
      saveBrowserDb(db);
      return { handled: true, result: reply };
    }

    case "context_engine_inspect": {
      const sid = asStr(args.sessionId ?? args.session_id) ?? DEFAULT_SESSION_ID;
      const sessions = ensureSessions(db, nowIso);
      const session = sessions.find((s) => s.id === sid) ?? sessions[0];
      const sessMsgs = (db.chatMessages ?? []).filter((m) => m.sessionId === session.id);
      const { layers, totalTokens } = buildContextLayers(db, session, sessMsgs);
      const tokenBudget = Math.max(1024, session.tokenBudget);
      const usagePct = Math.min(100, Math.round((totalTokens / tokenBudget) * 100));
      const events = (db.contextEvents ?? []).filter((e) => e.sessionId === session.id);
      return {
        handled: true,
        result: {
          session,
          layers,
          totalTokens,
          tokenBudget,
          usagePct,
          totalHistoryMessages: sessMsgs.length,
          events,
        } satisfies ContextInspection,
      };
    }

    case "context_engine_compress": {
      const sid = asStr(args.sessionId ?? args.session_id) ?? DEFAULT_SESSION_ID;
      const reason = asStr(args.reason) ?? "manual_compress";
      const sessions = ensureSessions(db, nowIso);
      const session = sessions.find((s) => s.id === sid) ?? sessions[0];
      const sessMsgs = (db.chatMessages ?? []).filter((m) => m.sessionId === session.id);
      const splitAt = Math.max(0, sessMsgs.length - Math.min(4, sessMsgs.length));
      const older = sessMsgs.slice(0, splitAt);
      const before = buildContextLayers(db, session, sessMsgs);
      if (older.length > 0) {
        session.semanticSummary = compactPreview(
          `${session.semanticSummary}\n${older.map((m) => `[${m.role}] ${compactPreview(m.content, 160)}`).join("\n")}`,
          1400
        );
      }
      session.compressionCount += 1;
      session.compressionState = "compressed";
      session.contextState = "compressed";
      session.updatedAt = nowIso;
      const after = buildContextLayers(db, session, sessMsgs);
      session.estimatedTokens = after.totalTokens;
      if (!Array.isArray(db.contextEvents)) db.contextEvents = [];
      db.contextEvents.unshift({
        id: genId(),
        sessionId: session.id,
        kind: "compression",
        reason,
        tokensBefore: before.totalTokens,
        tokensAfter: after.totalTokens,
        messagesCompressed: older.length,
        preservedMessageIds: older.map((m) => m.id),
        retrievedMemoryIds: session.associatedMemories,
        layers: after.layers,
        createdAt: nowIso,
      });
      saveBrowserDb(db);
      return {
        handled: true,
        result: {
          session,
          layers: after.layers,
          totalTokens: after.totalTokens,
          tokenBudget: Math.max(1024, session.tokenBudget),
          usagePct: Math.min(
            100,
            Math.round((after.totalTokens / Math.max(1024, session.tokenBudget)) * 100)
          ),
          totalHistoryMessages: sessMsgs.length,
          events: db.contextEvents.filter((e) => e.sessionId === session.id),
        } satisfies ContextInspection,
      };
    }

    case "agents_overview": {
      const bots = ensureAgentBots(db, nowIso);
      const skills = ensureAgentSkills(db, nowIso);
      const mcpPlugins = ensureMcpPlugins(db, nowIso);
      return {
        handled: true,
        result: {
          agents: defaultAgentDescriptors(),
          tools: builtinToolsCatalog(db),
          runs: db.agentRuns ?? [],
          pendingProposals: (db.proposals ?? []).filter((p) => p.status === "pending").length,
          bots,
          skills,
          mcpPlugins,
        } satisfies AgentsOverview,
      };
    }

    case "agents_bots_list": {
      return { handled: true, result: [...ensureAgentBots(db, nowIso)] };
    }

    case "agents_bots_upsert": {
      const rawInput = (args.input && typeof args.input === "object"
        ? args.input
        : args) as Partial<UpsertBotInput>;
      const name = String(rawInput.name ?? "").trim();
      if (!name) throw new Error("bot name cannot be empty");
      const bots = ensureAgentBots(db, nowIso);
      const existingIdx = rawInput.id ? bots.findIndex((b) => b.id === rawInput.id) : -1;
      const slug = slugifyName(name);
      const record: AgentBotRecord = {
        id: existingIdx >= 0 ? bots[existingIdx].id : String(rawInput.id || `bot-${slug}-${genId()}`),
        slug,
        name,
        roleKind: asStr(rawInput.roleKind) ?? (existingIdx >= 0 ? bots[existingIdx].roleKind : "custom_bot"),
        icon: asStr(rawInput.icon) ?? (existingIdx >= 0 ? bots[existingIdx].icon : "bot"),
        description:
          typeof rawInput.description === "string"
            ? rawInput.description.trim()
            : existingIdx >= 0
              ? bots[existingIdx].description
              : "",
        systemPrompt:
          typeof rawInput.systemPrompt === "string"
            ? rawInput.systemPrompt.trim()
            : existingIdx >= 0
              ? bots[existingIdx].systemPrompt
              : "",
        preferredProvider:
          rawInput.preferredProvider !== undefined
            ? asStr(rawInput.preferredProvider)
            : existingIdx >= 0
              ? bots[existingIdx].preferredProvider
              : "auto",
        preferredModel:
          rawInput.preferredModel !== undefined
            ? asStr(rawInput.preferredModel)
            : existingIdx >= 0
              ? bots[existingIdx].preferredModel
              : null,
        hindsightBank:
          rawInput.hindsightBank !== undefined
            ? asStr(rawInput.hindsightBank)
            : existingIdx >= 0
              ? bots[existingIdx].hindsightBank
              : null,
        skillIds: Array.isArray(rawInput.skillIds)
          ? rawInput.skillIds.map(String)
          : existingIdx >= 0
            ? bots[existingIdx].skillIds
            : [],
        enabled:
          typeof rawInput.enabled === "boolean"
            ? rawInput.enabled
            : existingIdx >= 0
              ? bots[existingIdx].enabled
              : true,
        pinnedInChat:
          typeof rawInput.pinnedInChat === "boolean"
            ? rawInput.pinnedInChat
            : existingIdx >= 0
              ? bots[existingIdx].pinnedInChat
              : true,
        createdAt: existingIdx >= 0 ? bots[existingIdx].createdAt : nowIso,
        updatedAt: nowIso,
      };
      if (existingIdx >= 0) {
        bots[existingIdx] = record;
      } else {
        bots.unshift(record);
      }
      saveBrowserDb(db);
      return { handled: true, result: record };
    }

    case "agents_bots_delete": {
      const botId = String(args.botId ?? args.bot_id ?? "").trim();
      const bots = ensureAgentBots(db, nowIso);
      db.agentBots = bots.filter((b) => b.id !== botId);
      saveBrowserDb(db);
      return { handled: true, result: null };
    }

    case "agents_skills_list": {
      return { handled: true, result: [...ensureAgentSkills(db, nowIso)] };
    }

    case "agents_skills_install": {
      const rawInput = (args.input && typeof args.input === "object"
        ? args.input
        : args) as Partial<InstallSkillInput>;
      const name = String(rawInput.name ?? "").trim();
      if (!name) throw new Error("skill name cannot be empty");
      const skills = ensureAgentSkills(db, nowIso);
      const slug = slugifyName(name);
      const sourceKind = asStr(rawInput.sourceKind) ?? "catalog";
      const sourceUri = asStr(rawInput.sourceUri) ?? `local://skills/${slug}`;
      const description =
        asStr(rawInput.description) ?? `Skill ${name} instalada via ${sourceKind}`;
      const skillMarkdown =
        asStr(rawInput.skillMarkdown) ??
        `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}`;
      const existingIdx = skills.findIndex((s) => s.slug === slug);
      const record: AgentSkillRecord = {
        id: existingIdx >= 0 ? skills[existingIdx].id : `skill-${slug}-${genId()}`,
        slug,
        name,
        description,
        version: asStr(rawInput.version) ?? "1.0.0",
        sourceKind,
        sourceUri,
        installPath: `~/.auradesk/skills/${slug}/SKILL.md`,
        skillMarkdown,
        enabled: true,
        installedAt: existingIdx >= 0 ? skills[existingIdx].installedAt : nowIso,
        updatedAt: nowIso,
      };
      if (existingIdx >= 0) {
        skills[existingIdx] = record;
      } else {
        skills.unshift(record);
      }
      saveBrowserDb(db);
      return { handled: true, result: record };
    }

    case "agents_skills_import_local": {
      const skills = ensureAgentSkills(db, nowIso);
      const discovered: Array<Omit<AgentSkillRecord, "id" | "installedAt" | "updatedAt">> = [
        {
          slug: "antigravity-guide",
          name: "agentsHub.seeds.skill_agy_name",
          description: "agentsHub.seeds.skill_agy_desc",
          version: "2.0.0",
          sourceKind: "antigravity_import",
          sourceUri: "~/.gemini/antigravity/builtin/skills/antigravity_guide/SKILL.md",
          installPath: "~/.gemini/antigravity/builtin/skills/antigravity_guide/SKILL.md",
          skillMarkdown:
            "# Antigravity_Guide\n\nComprehensive guide for Google_Antigravity skills, rules, MCP_servers, and multi_agent workflows.",
          enabled: true,
        },
        {
          slug: "code-review-coderabbit",
          name: "agentsHub.seeds.skill_review_name",
          description: "agentsHub.seeds.skill_review_desc",
          version: "1.4.0",
          sourceKind: "antigravity_import",
          sourceUri: "~/.gemini/config/plugins/coderabbit/skills/code-review/SKILL.md",
          installPath: "~/.gemini/config/plugins/coderabbit/skills/code-review/SKILL.md",
          skillMarkdown:
            "# Code_Review_Skill\n\nRun structured code_quality and security_checks before merging.",
          enabled: true,
        },
      ];
      for (const item of discovered) {
        if (!skills.some((s) => s.slug === item.slug)) {
          skills.unshift({
            ...item,
            id: `skill-${item.slug}`,
            installedAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }
      saveBrowserDb(db);
      return { handled: true, result: [...skills] };
    }

    case "agents_skills_toggle": {
      const skillId = String(args.skillId ?? args.skill_id ?? "").trim();
      const enabled = Boolean(args.enabled);
      const skills = ensureAgentSkills(db, nowIso);
      const found = skills.find((s) => s.id === skillId || s.slug === skillId);
      if (!found) throw new Error(`skill not found: ${skillId}`);
      found.enabled = enabled;
      found.updatedAt = nowIso;
      saveBrowserDb(db);
      return { handled: true, result: { ...found } };
    }

    case "agents_skills_delete": {
      const skillId = String(args.skillId ?? args.skill_id ?? "").trim();
      const skills = ensureAgentSkills(db, nowIso);
      db.agentSkills = skills.filter((s) => s.id !== skillId && s.slug !== skillId);
      if (Array.isArray(db.agentBots)) {
        for (const bot of db.agentBots) {
          bot.skillIds = bot.skillIds.filter((id) => id !== skillId);
        }
      }
      saveBrowserDb(db);
      return { handled: true, result: null };
    }

    case "agents_mcp_plugins_list": {
      return { handled: true, result: [...ensureMcpPlugins(db, nowIso)] };
    }

    case "agents_mcp_plugins_upsert": {
      const rawInput = (args.input && typeof args.input === "object"
        ? args.input
        : args) as Partial<UpsertMcpPluginInput>;
      const name = String(rawInput.name ?? "").trim();
      const commandOrUrl = String(rawInput.commandOrUrl ?? "").trim();
      if (!name || !commandOrUrl) throw new Error("plugin name and command/url are required");
      const transport = rawInput.transport === "http_sse" ? "http_sse" : "stdio";
      const plugins = ensureMcpPlugins(db, nowIso);
      const slug = slugifyName(name);
      const existingIdx = rawInput.id
        ? plugins.findIndex((p) => p.id === rawInput.id)
        : plugins.findIndex((p) => p.slug === slug);
      const discoveredTools =
        existingIdx >= 0 && plugins[existingIdx].discoveredTools.length > 0
          ? plugins[existingIdx].discoveredTools
          : [`mcp.${slug}.query`, `mcp.${slug}.execute`];
      const record: McpPluginRecord = {
        id: existingIdx >= 0 ? plugins[existingIdx].id : `mcp-${slug}-${genId()}`,
        slug,
        name,
        transport,
        commandOrUrl,
        args: Array.isArray(rawInput.args) ? rawInput.args.map(String) : [],
        envVars: Array.isArray(rawInput.envVars) ? rawInput.envVars.map(String) : [],
        enabled:
          typeof rawInput.enabled === "boolean"
            ? rawInput.enabled
            : existingIdx >= 0
              ? plugins[existingIdx].enabled
              : true,
        lastHealthStatus: existingIdx >= 0 ? plugins[existingIdx].lastHealthStatus : "healthy",
        lastHealthCheckedAt: nowIso,
        discoveredTools,
        createdAt: existingIdx >= 0 ? plugins[existingIdx].createdAt : nowIso,
        updatedAt: nowIso,
      };
      if (existingIdx >= 0) {
        plugins[existingIdx] = record;
      } else {
        plugins.unshift(record);
      }
      saveBrowserDb(db);
      return { handled: true, result: record };
    }

    case "agents_mcp_plugins_test": {
      const pluginId = String(args.pluginId ?? args.plugin_id ?? "").trim();
      const plugins = ensureMcpPlugins(db, nowIso);
      const found = plugins.find((p) => p.id === pluginId || p.slug === pluginId);
      if (!found) throw new Error(`MCP plugin not found: ${pluginId}`);
      if (found.discoveredTools.length === 0) {
        found.discoveredTools = [
          `mcp.${found.slug}.list_resources`,
          `mcp.${found.slug}.query`,
          `mcp.${found.slug}.execute_action`,
        ];
      }
      found.lastHealthStatus = "healthy";
      found.lastHealthCheckedAt = nowIso;
      found.updatedAt = nowIso;
      saveBrowserDb(db);
      return { handled: true, result: { ...found } };
    }

    case "agents_mcp_plugins_delete": {
      const pluginId = String(args.pluginId ?? args.plugin_id ?? "").trim();
      const plugins = ensureMcpPlugins(db, nowIso);
      db.mcpPlugins = plugins.filter((p) => p.id !== pluginId && p.slug !== pluginId);
      saveBrowserDb(db);
      return { handled: true, result: null };
    }

    case "agents_set_tool_policy": {
      const toolName = String(args.toolName ?? args.tool_name ?? "");
      const permission = String(args.permission ?? "require_approval");
      const enabled = Boolean(args.enabled);
      const tools = builtinToolsCatalog(db);
      const found = tools.find((t) => t.toolName === toolName);
      if (!found) throw new Error(`tool not found: ${toolName}`);
      if (
        (found.riskLevel === "privileged" || found.riskLevel === "destructive") &&
        permission === "allow"
      ) {
        throw new Error(
          `security policy prevents auto-allowing ${found.riskLevel} tool '${found.toolName}'`
        );
      }
      if (!db.agentToolPolicies) db.agentToolPolicies = {};
      db.agentToolPolicies[toolName] = { permission, enabled };
      saveBrowserDb(db);
      return { handled: true, result: { ...found, permission, enabled } satisfies AgentToolEntry };
    }

    case "agents_plan_preview": {
      const goal = String(args.goal ?? "").trim();
      if (!goal) throw new Error("goal cannot be empty");
      const sessionId = asStr(args.sessionId ?? args.session_id);
      const tools = builtinToolsCatalog(db);
      const permOf = (name: string) =>
        tools.find((t) => t.toolName === name)?.permission ?? "require_approval";
      const lower = goal.toLowerCase();
      const plan: AgentPlanStep[] = [
        {
          step: 1,
          agentRole: "memory_agent",
          toolName: "memory.hindsight_recall",
          action: "agentsHub.plan.recall_memories",
          requiresApproval: permOf("memory.hindsight_recall") !== "allow",
        },
        {
          step: 2,
          agentRole: "context_manager",
          toolName: "context.compress_session",
          action: "agentsHub.plan.assemble_context",
          requiresApproval: permOf("context.compress_session") !== "allow",
        },
      ];
      let stepNum = 3;
      if (lower.includes("doc") || lower.includes("rag") || lower.includes("arquivo") || lower.includes("file")) {
        plan.push({
          step: stepNum++,
          agentRole: "research_agent",
          toolName: "research.knowledge_query",
          action: "agentsHub.plan.query_knowledge",
          requiresApproval: permOf("research.knowledge_query") !== "allow",
        });
      }
      if (lower.includes("site") || lower.includes("web") || lower.includes("browser") || lower.includes("naveg")) {
        plan.push({
          step: stepNum++,
          agentRole: "browser_agent",
          toolName: "browser.navigate",
          action: "agentsHub.plan.browser_navigate",
          requiresApproval: true,
        });
      }
      if (lower.includes("tela") || lower.includes("screen") || lower.includes("window") || lower.includes("janela")) {
        plan.push({
          step: stepNum++,
          agentRole: "computer_agent",
          toolName: "computer.capture_screen",
          action: "agentsHub.plan.capture_screen",
          requiresApproval: true,
        });
      }
      if (lower.includes("shell") || lower.includes("terminal") || lower.includes("comando") || lower.includes("cmd")) {
        plan.push({
          step: stepNum++,
          agentRole: "system_agent",
          toolName: "system.run_shell_command",
          action: "agentsHub.plan.run_shell",
          requiresApproval: true,
        });
      }
      const awaiting = plan.some((p) => p.requiresApproval);
      const record: AgentRunRecord = {
        id: genId(),
        sessionId,
        agentRole: "orchestrator",
        goal,
        plan,
        status: awaiting ? "awaiting_approval" : "planned",
        resultSummary: `planned_steps:${plan.length}:${awaiting ? "approval_required" : "safe_only"}`,
        createdAt: nowIso,
      };
      if (!Array.isArray(db.agentRuns)) db.agentRuns = [];
      db.agentRuns.unshift(record);
      db.agentRuns = db.agentRuns.slice(0, 40);
      saveBrowserDb(db);
      return { handled: true, result: record };
    }

    default:
      return { handled: false };
  }
}
