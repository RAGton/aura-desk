import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Globe,
  Layers,
  Lock,
  Monitor,
  Network,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";

import {
  Badge,
  type BadgeProps,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from "../components/ui";
import {
  agentsApi,
  type AgentBotRecord,
  type AgentDescriptor,
  type AgentPlanStep,
  type AgentRunRecord,
  type AgentSkillRecord,
  type AgentsOverview,
  type AgentToolEntry,
  type McpPluginRecord,
} from "../lib/ipc";
import { asArray } from "../lib/utils";

export interface AgentsHubPageProps {
  activeSessionId?: string;
}

type BadgeVariant = NonNullable<BadgeProps["variant"]>;
type AgentsHubTab = "overview" | "bots" | "skills" | "mcp";

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function formatTimestamp(raw?: string | null): string {
  if (!raw) return "—";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString();
}

function agentStatusVariant(status: string): BadgeVariant {
  if (status === "guarded") return "warning";
  if (status === "ready") return "success";
  return "neutral";
}

function riskBadgeVariant(riskLevel: string): BadgeVariant {
  switch (riskLevel) {
    case "read":
      return "info";
    case "write":
      return "default";
    case "privileged":
      return "warning";
    case "destructive":
      return "danger";
    default:
      return "neutral";
  }
}

function healthBadgeVariant(status: string): BadgeVariant {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "offline") return "danger";
  return "neutral";
}

function isRestrictedRisk(riskLevel: string): boolean {
  return riskLevel === "privileged" || riskLevel === "destructive";
}

function renderAgentIcon(role: string) {
  const iconClass = "h-4 w-4 shrink-0";
  switch (role) {
    case "orchestrator":
      return <Network className={iconClass} aria-hidden="true" />;
    case "memory_agent":
    case "brain":
    case "study_coach":
      return <Brain className={iconClass} aria-hidden="true" />;
    case "research_agent":
      return <Search className={iconClass} aria-hidden="true" />;
    case "browser_agent":
      return <Globe className={iconClass} aria-hidden="true" />;
    case "computer_agent":
      return <Monitor className={iconClass} aria-hidden="true" />;
    case "system_agent":
    case "terminal":
      return <Terminal className={iconClass} aria-hidden="true" />;
    case "context_manager":
      return <Layers className={iconClass} aria-hidden="true" />;
    case "tool_registry":
      return <ShieldCheck className={iconClass} aria-hidden="true" />;
    case "cpu":
    case "code_reviewer":
      return <Cpu className={iconClass} aria-hidden="true" />;
    default:
      return <Bot className={iconClass} aria-hidden="true" />;
  }
}

export function AgentsHubPage({ activeSessionId }: AgentsHubPageProps) {
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  const [activeSubTab, setActiveSubTab] = useState<AgentsHubTab>("overview");
  const [overview, setOverview] = useState<AgentsOverview | null>(null);
  const [bots, setBots] = useState<AgentBotRecord[]>([]);
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [mcpPlugins, setMcpPlugins] = useState<McpPluginRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [hubActionError, setHubActionError] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<Record<string, boolean>>({});
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);

  // Bot composer state
  const [botName, setBotName] = useState("");
  const [botBank, setBotBank] = useState("");
  const [botModel, setBotModel] = useState("");
  const [botDescription, setBotDescription] = useState("");
  const [botPrompt, setBotPrompt] = useState("");
  const [botSkillIds, setBotSkillIds] = useState<string[]>([]);
  const [savingBot, setSavingBot] = useState(false);

  // Skill installer state
  const [skillName, setSkillName] = useState("");
  const [skillSourceKind, setSkillSourceKind] = useState("local_dir");
  const [skillSourceUri, setSkillSourceUri] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillMarkdown, setSkillMarkdown] = useState("");
  const [installingSkill, setInstallingSkill] = useState(false);
  const [importingSkills, setImportingSkills] = useState(false);
  const [inspectedSkillId, setInspectedSkillId] = useState<string | null>(null);

  // MCP plugin state
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http_sse">("stdio");
  const [mcpCommandOrUrl, setMcpCommandOrUrl] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [savingMcp, setSavingMcp] = useState(false);
  const [testingMcpId, setTestingMcpId] = useState<string | null>(null);

  const loadOverview = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);

    try {
      const data = await agentsApi.overview();
      if (!mountedRef.current) return;
      setOverview(data);
      if (Array.isArray(data.bots)) {
        setBots(data.bots);
      }
      if (Array.isArray(data.skills)) {
        setSkills(data.skills);
      }
      if (Array.isArray(data.mcpPlugins)) {
        setMcpPlugins(data.mcpPlugins);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadOverview(false);
    return () => {
      mountedRef.current = false;
    };
  }, [loadOverview]);

  const handleUpdateToolPolicy = async (
    tool: AgentToolEntry,
    nextPermission: string,
    nextEnabled: boolean,
  ) => {
    setPolicyError(null);
    setPendingTools((prev) => ({ ...prev, [tool.toolName]: true }));

    try {
      const updated = await agentsApi.setToolPolicy(
        tool.toolName,
        nextPermission,
        nextEnabled,
      );
      if (!mountedRef.current) return;
      setOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tools: asArray<AgentToolEntry>(prev.tools).map((item) =>
            item.toolName === updated.toolName ? updated : item,
          ),
        };
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setPolicyError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setPendingTools((prev) => {
          const next = { ...prev };
          delete next[tool.toolName];
          return next;
        });
      }
    }
  };

  const handlePlanPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || planning) return;

    setPlanError(null);
    setPlanning(true);
    try {
      const created = await agentsApi.planPreview(trimmed, activeSessionId);
      if (!mountedRef.current) return;
      setOverview((prev) => {
        if (!prev) return prev;
        const existingRuns = asArray<AgentRunRecord>(prev.runs);
        return {
          ...prev,
          runs: [created, ...existingRuns.filter((r) => r.id !== created.id)],
        };
      });
      setGoal("");
    } catch (err) {
      if (!mountedRef.current) return;
      setPlanError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setPlanning(false);
      }
    }
  };

  // ── Bots Handlers ──────────────────────────────────────────────────────
  const handleCreateBot = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanName = botName.trim();
    if (!cleanName || savingBot) return;
    setHubActionError(null);
    setSavingBot(true);
    try {
      const saved = await agentsApi.upsertBot({
        name: cleanName,
        hindsightBank: botBank.trim() || null,
        preferredModel: botModel.trim() || null,
        description: botDescription.trim(),
        systemPrompt: botPrompt.trim(),
        skillIds: botSkillIds,
        enabled: true,
        pinnedInChat: true,
      });
      if (!mountedRef.current) return;
      setBots((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)]);
      setBotName("");
      setBotBank("");
      setBotModel("");
      setBotDescription("");
      setBotPrompt("");
      setBotSkillIds([]);
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setSavingBot(false);
    }
  };

  const handleQuickBotPreset = async (preset: {
    name: string;
    roleKind: string;
    icon: string;
    bank: string;
    model: string;
    description: string;
    systemPrompt: string;
  }) => {
    setHubActionError(null);
    setSavingBot(true);
    try {
      const saved = await agentsApi.upsertBot({
        name: preset.name,
        roleKind: preset.roleKind,
        icon: preset.icon,
        hindsightBank: preset.bank,
        preferredModel: preset.model,
        description: preset.description,
        systemPrompt: preset.systemPrompt,
        skillIds: skills.slice(0, 2).map((s) => s.id),
        enabled: true,
        pinnedInChat: true,
      });
      if (!mountedRef.current) return;
      setBots((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)]);
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setSavingBot(false);
    }
  };

  const handleToggleBotEnabled = async (bot: AgentBotRecord, nextEnabled: boolean) => {
    setHubActionError(null);
    try {
      const saved = await agentsApi.upsertBot({
        id: bot.id,
        name: bot.name,
        roleKind: bot.roleKind,
        icon: bot.icon,
        description: bot.description,
        systemPrompt: bot.systemPrompt,
        preferredProvider: bot.preferredProvider,
        preferredModel: bot.preferredModel,
        hindsightBank: bot.hindsightBank,
        skillIds: bot.skillIds,
        enabled: nextEnabled,
        pinnedInChat: bot.pinnedInChat,
      });
      if (!mountedRef.current) return;
      setBots((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    }
  };

  const handleDeleteBot = async (botId: string) => {
    setHubActionError(null);
    try {
      await agentsApi.deleteBot(botId);
      if (!mountedRef.current) return;
      setBots((prev) => prev.filter((b) => b.id !== botId));
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    }
  };

  // ── Skills Handlers ────────────────────────────────────────────────────
  const handleInstallSkill = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanName = skillName.trim();
    if (!cleanName || installingSkill) return;
    setHubActionError(null);
    setInstallingSkill(true);
    try {
      const installed = await agentsApi.installSkill({
        name: cleanName,
        sourceKind: skillSourceKind,
        sourceUri: skillSourceUri.trim() || null,
        description: skillDescription.trim() || null,
        skillMarkdown: skillMarkdown.trim() || null,
      });
      if (!mountedRef.current) return;
      setSkills((prev) => [installed, ...prev.filter((s) => s.id !== installed.id)]);
      setSkillName("");
      setSkillSourceUri("");
      setSkillDescription("");
      setSkillMarkdown("");
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setInstallingSkill(false);
    }
  };

  const handleQuickCatalogSkill = async (item: {
    name: string;
    sourceUri: string;
    description: string;
    skillMarkdown: string;
  }) => {
    setHubActionError(null);
    setInstallingSkill(true);
    try {
      const installed = await agentsApi.installSkill({
        name: item.name,
        sourceKind: "catalog",
        sourceUri: item.sourceUri,
        description: item.description,
        skillMarkdown: item.skillMarkdown,
      });
      if (!mountedRef.current) return;
      setSkills((prev) => [installed, ...prev.filter((s) => s.id !== installed.id)]);
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setInstallingSkill(false);
    }
  };

  const handleImportLocalSkills = async () => {
    if (importingSkills) return;
    setHubActionError(null);
    setImportingSkills(true);
    try {
      const imported = await agentsApi.importLocalSkills();
      if (!mountedRef.current) return;
      setSkills(asArray<AgentSkillRecord>(imported));
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setImportingSkills(false);
    }
  };

  const handleToggleSkill = async (skill: AgentSkillRecord, nextEnabled: boolean) => {
    setHubActionError(null);
    try {
      const updated = await agentsApi.toggleSkill(skill.id, nextEnabled);
      if (!mountedRef.current) return;
      setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    setHubActionError(null);
    try {
      await agentsApi.deleteSkill(skillId);
      if (!mountedRef.current) return;
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    }
  };

  // ── MCP Plugins Handlers ───────────────────────────────────────────────
  const handleSaveMcpPlugin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanName = mcpName.trim();
    const cleanCmd = mcpCommandOrUrl.trim();
    if (!cleanName || !cleanCmd || savingMcp) return;
    setHubActionError(null);
    setSavingMcp(true);
    try {
      const parsedArgs = mcpArgs
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const saved = await agentsApi.upsertMcpPlugin({
        name: cleanName,
        transport: mcpTransport,
        commandOrUrl: cleanCmd,
        args: parsedArgs,
        enabled: true,
      });
      if (!mountedRef.current) return;
      setMcpPlugins((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      setMcpName("");
      setMcpCommandOrUrl("");
      setMcpArgs("");
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setSavingMcp(false);
    }
  };

  const handleQuickMcpPreset = async (preset: {
    name: string;
    transport: "stdio" | "http_sse";
    commandOrUrl: string;
    args: string[];
  }) => {
    setHubActionError(null);
    setSavingMcp(true);
    try {
      const saved = await agentsApi.upsertMcpPlugin({
        name: preset.name,
        transport: preset.transport,
        commandOrUrl: preset.commandOrUrl,
        args: preset.args,
        enabled: true,
      });
      if (!mountedRef.current) return;
      setMcpPlugins((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setSavingMcp(false);
    }
  };

  const handleTestMcpPlugin = async (plugin: McpPluginRecord) => {
    setHubActionError(null);
    setTestingMcpId(plugin.id);
    try {
      const tested = await agentsApi.testMcpPlugin(plugin.id);
      if (!mountedRef.current) return;
      setMcpPlugins((prev) => prev.map((p) => (p.id === tested.id ? tested : p)));
      setOverview((prev) => {
        if (!prev) return prev;
        const currentTools = [...asArray<AgentToolEntry>(prev.tools)];
        const known = new Set(currentTools.map((t) => t.toolName));
        for (const toolName of asArray<string>(tested.discoveredTools)) {
          if (!known.has(toolName)) {
            known.add(toolName);
            currentTools.push({
              toolName,
              agentRole: "tool_registry",
              description: `MCP tool (${tested.name})`,
              permission: "require_approval",
              riskLevel: "write",
              enabled: tested.enabled,
              source: `mcp:${tested.slug}`,
            });
          }
        }
        return { ...prev, tools: currentTools };
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    } finally {
      if (mountedRef.current) setTestingMcpId(null);
    }
  };

  const handleDeleteMcpPlugin = async (pluginId: string) => {
    setHubActionError(null);
    try {
      await agentsApi.deleteMcpPlugin(pluginId);
      if (!mountedRef.current) return;
      setMcpPlugins((prev) => prev.filter((p) => p.id !== pluginId));
    } catch (err) {
      if (!mountedRef.current) return;
      setHubActionError(extractErrorMessage(err));
    }
  };

  const formatRunSummary = (run: AgentRunRecord): string => {
    const steps = asArray<AgentPlanStep>(run.plan);
    if (!run.resultSummary || run.resultSummary.startsWith("planned_steps:")) {
      const needsApproval = run.resultSummary
        ? run.resultSummary.endsWith("approval_required")
        : run.status === "awaiting_approval" || steps.some((s) => s.requiresApproval);
      return needsApproval
        ? t("agentsHub.plan.summary_approval", { count: steps.length })
        : t("agentsHub.plan.summary_safe", { count: steps.length });
    }
    return t(run.resultSummary, { defaultValue: run.resultSummary });
  };

  const agents = asArray<AgentDescriptor>(overview?.agents);
  const tools = asArray<AgentToolEntry>(overview?.tools);
  const runs = asArray<AgentRunRecord>(overview?.runs);

  return (
    <div className="space-y-6" data-testid="agents-hub-page">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2.5 text-xl font-bold text-aura-primary">
            <Bot className="h-5 w-5 shrink-0 text-aura-accent" aria-hidden="true" />
            <span>{t("agentsHub.title")}</span>
          </h2>
          <p className="text-xs leading-relaxed text-aura-text-muted">
            {t("agentsHub.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {overview ? (
            <Badge
              variant={overview.pendingProposals > 0 ? "warning" : "neutral"}
              data-testid="agents-pending-proposals"
            >
              {t("agentsHub.pendingProposals", { count: overview.pendingProposals })}
            </Badge>
          ) : (
            <Skeleton className="h-6 w-44 rounded-aura-sm" />
          )}

          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={refreshing}
            disabled={loading || refreshing}
            onClick={() => void loadOverview(true)}
            data-testid="agents-refresh-btn"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("hindsightPanel.refresh")}
          </Button>
        </div>
      </header>

      {/* Sub-navigation bar: Overview, Bots & Squads, Skills (SKILL.md), MCP Plugins */}
      <div
        role="tablist"
        aria-label={t("agentsHub.title")}
        className="flex flex-wrap items-center gap-2 rounded-2xl aura-glass p-2"
      >
        <Button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "overview"}
          size="sm"
          variant={activeSubTab === "overview" ? "primary" : "secondary"}
          onClick={() => setActiveSubTab("overview")}
          data-testid="agents-tab-overview"
        >
          <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("agentsHub.tabs.overview")}</span>
        </Button>

        <Button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "bots"}
          size="sm"
          variant={activeSubTab === "bots" ? "primary" : "secondary"}
          onClick={() => setActiveSubTab("bots")}
          data-testid="agents-tab-bots"
        >
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("agentsHub.tabs.bots")}</span>
          {bots.length > 0 && (
            <Badge variant="info" className="ml-1 px-1.5 py-0 text-[10px]">
              {bots.length}
            </Badge>
          )}
        </Button>

        <Button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "skills"}
          size="sm"
          variant={activeSubTab === "skills" ? "primary" : "secondary"}
          onClick={() => setActiveSubTab("skills")}
          data-testid="agents-tab-skills"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("agentsHub.tabs.skills")}</span>
          {skills.length > 0 && (
            <Badge variant="info" className="ml-1 px-1.5 py-0 text-[10px]">
              {skills.length}
            </Badge>
          )}
        </Button>

        <Button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "mcp"}
          size="sm"
          variant={activeSubTab === "mcp" ? "primary" : "secondary"}
          onClick={() => setActiveSubTab("mcp")}
          data-testid="agents-tab-mcp"
        >
          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("agentsHub.tabs.mcp")}</span>
          {mcpPlugins.length > 0 && (
            <Badge variant="info" className="ml-1 px-1.5 py-0 text-[10px]">
              {mcpPlugins.length}
            </Badge>
          )}
        </Button>
      </div>

      {loadError && overview && (
        <div
          role="alert"
          data-testid="agents-load-error"
          className="flex items-center gap-2 rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3.5 py-2.5 text-xs text-aura-danger"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{loadError}</span>
        </div>
      )}

      {hubActionError && (
        <div
          role="alert"
          data-testid="agents-hub-action-error"
          className="flex items-center gap-2 rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3.5 py-2.5 text-xs text-aura-danger"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{hubActionError}</span>
        </div>
      )}

      {loading && !overview ? (
        <div className="space-y-6" data-testid="agents-loading">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, idx) => (
              <div
                key={idx}
                className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-4 space-y-3"
              >
                <Skeleton className="h-5 w-2/3" />
                <Skeleton lines={3} />
              </div>
            ))}
          </div>
          <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-5">
            <Skeleton lines={4} />
          </div>
        </div>
      ) : loadError && !overview ? (
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5 text-aura-danger" />}
          title={loadError}
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void loadOverview(true)}
            >
              {t("updater.banner.retry")}
            </Button>
          }
        />
      ) : activeSubTab === "bots" ? (
        <div className="space-y-6" data-testid="agents-bots-panel">
          {/* 1-Click Bot Presets & Custom Bot Composer */}
          <section className="space-y-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-aura-primary">
                  <Sparkles className="h-4 w-4 text-aura-accent" aria-hidden="true" />
                  <span>{t("agentsHub.bots.title")}</span>
                </h3>
                <p className="mt-1 text-xs text-aura-text-muted">
                  {t("agentsHub.bots.subtitle")}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-aura-text-muted">
                {t("agentsHub.bots.presetsTitle")}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingBot}
                  data-testid="bot-preset-study"
                  onClick={() =>
                    void handleQuickBotPreset({
                      name: t("agentsHub.seeds.bot_study_name"),
                      roleKind: "study_coach",
                      icon: "brain",
                      bank: "estudos",
                      model: "gemini-2.5-pro",
                      description: t("agentsHub.seeds.bot_study_desc"),
                      systemPrompt: t("agentsHub.seeds.bot_study_prompt"),
                    })
                  }
                >
                  {t("agentsHub.bots.presetStudy")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingBot}
                  data-testid="bot-preset-rust"
                  onClick={() =>
                    void handleQuickBotPreset({
                      name: t("agentsHub.seeds.bot_rust_name"),
                      roleKind: "code_reviewer",
                      icon: "cpu",
                      bank: "engenharia",
                      model: "gpt-4.1",
                      description: t("agentsHub.seeds.bot_rust_desc"),
                      systemPrompt: t("agentsHub.seeds.bot_rust_prompt"),
                    })
                  }
                >
                  {t("agentsHub.bots.presetRust")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingBot}
                  data-testid="bot-preset-commercial"
                  onClick={() =>
                    void handleQuickBotPreset({
                      name: t("agentsHub.seeds.bot_commercial_name"),
                      roleKind: "commercial_advisor",
                      icon: "bot",
                      bank: "comercial",
                      model: "gemini-2.5-pro",
                      description: t("agentsHub.seeds.bot_commercial_desc"),
                      systemPrompt: t("agentsHub.seeds.bot_commercial_prompt"),
                    })
                  }
                >
                  {t("agentsHub.bots.presetCommercial")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingBot}
                  data-testid="bot-preset-devops"
                  onClick={() =>
                    void handleQuickBotPreset({
                      name: t("agentsHub.seeds.bot_devops_name"),
                      roleKind: "devops_agent",
                      icon: "terminal",
                      bank: "garos",
                      model: "gemini-2.5-pro",
                      description: t("agentsHub.seeds.bot_devops_desc"),
                      systemPrompt: t("agentsHub.seeds.bot_devops_prompt"),
                    })
                  }
                >
                  {t("agentsHub.bots.presetDevops")}
                </Button>
              </div>
            </div>

            <form
              onSubmit={(e) => void handleCreateBot(e)}
              className="grid grid-cols-1 gap-3 border-t border-aura-border/30 pt-4 md:grid-cols-3"
            >
              <Input
                label={t("agentsHub.bots.nameLabel")}
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder={t("agentsHub.bots.namePlaceholder")}
                data-testid="bot-name-input"
              />
              <Input
                label={t("agentsHub.bots.bankLabel")}
                value={botBank}
                onChange={(e) => setBotBank(e.target.value)}
                placeholder={t("agentsHub.bots.bankPlaceholder")}
                data-testid="bot-bank-input"
              />
              <Input
                label={t("agentsHub.bots.modelLabel")}
                value={botModel}
                onChange={(e) => setBotModel(e.target.value)}
                placeholder={t("agentsHub.bots.modelPlaceholder")}
                data-testid="bot-model-input"
              />
              <div className="md:col-span-3">
                <Input
                  label={t("agentsHub.bots.descriptionLabel")}
                  value={botDescription}
                  onChange={(e) => setBotDescription(e.target.value)}
                  placeholder={t("agentsHub.bots.descriptionPlaceholder")}
                  data-testid="bot-desc-input"
                />
              </div>
              <div className="md:col-span-3">
                <Textarea
                  label={t("agentsHub.bots.promptLabel")}
                  value={botPrompt}
                  onChange={(e) => setBotPrompt(e.target.value)}
                  placeholder={t("agentsHub.bots.promptPlaceholder")}
                  rows={2}
                  data-testid="bot-prompt-input"
                />
              </div>

              {skills.length > 0 && (
                <div className="md:col-span-3 space-y-1.5">
                  <div className="text-xs font-medium text-aura-secondary">
                    {t("agentsHub.bots.skillsLabel")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {skills.map((sk) => {
                      const selected = botSkillIds.includes(sk.id);
                      return (
                        <button
                          key={sk.id}
                          type="button"
                          onClick={() =>
                            setBotSkillIds((prev) =>
                              prev.includes(sk.id)
                                ? prev.filter((id) => id !== sk.id)
                                : [...prev, sk.id],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                            selected
                              ? "border-aura-accent bg-aura-accent/15 text-aura-accent"
                              : "border-aura-border/40 bg-aura-canvas/50 text-aura-secondary hover:border-aura-accent/40"
                          }`}
                        >
                          {sk.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="md:col-span-3 flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  loading={savingBot}
                  disabled={savingBot || !botName.trim()}
                  data-testid="bot-save-btn"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("agentsHub.bots.createAction")}
                </Button>
              </div>
            </form>
          </section>

          {/* Bots Grid */}
          {bots.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-5 w-5" />}
              title={t("agentsHub.bots.empty")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {bots.map((bot) => (
                <article
                  key={bot.id}
                  data-testid={`bot-card-${bot.slug}`}
                  className="flex flex-col justify-between gap-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 text-aura-accent">
                          {renderAgentIcon(bot.icon || bot.roleKind)}
                        </span>
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-bold text-aura-primary">
                            {t(bot.name, { defaultValue: bot.name })}
                          </h4>
                          <p className="truncate font-mono text-[11px] text-aura-text-muted">
                            {bot.slug}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={bot.enabled ? "success" : "neutral"}>
                          {bot.enabled
                            ? t("agentsHub.bots.activeBadge")
                            : t("agentsHub.bots.disabledBadge")}
                        </Badge>
                        <Switch
                          size="sm"
                          checked={bot.enabled}
                          aria-label={`${t(bot.name, { defaultValue: bot.name })} ${t("agentsHub.columns.enabled")}`}
                          data-testid={`bot-toggle-${bot.slug}`}
                          onCheckedChange={(next) => void handleToggleBotEnabled(bot, next)}
                        />
                      </div>
                    </div>

                    {bot.description && (
                      <p className="text-xs leading-relaxed text-aura-secondary">
                        {t(bot.description, { defaultValue: bot.description })}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {bot.hindsightBank && (
                        <Badge variant="info">bank: {bot.hindsightBank}</Badge>
                      )}
                      {bot.preferredModel && (
                        <Badge variant="neutral">{bot.preferredModel}</Badge>
                      )}
                      {bot.pinnedInChat && (
                        <Badge variant="default">{t("agentsHub.bots.pinnedBadge")}</Badge>
                      )}
                    </div>

                    {bot.systemPrompt && (
                      <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/50 p-2.5 font-mono text-[11px] text-aura-secondary">
                        {t(bot.systemPrompt, { defaultValue: bot.systemPrompt })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end border-t border-aura-border/25 pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-testid={`bot-delete-${bot.slug}`}
                      onClick={() => void handleDeleteBot(bot.id)}
                      className="text-aura-danger hover:text-aura-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("agentsHub.bots.deleteAction")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : activeSubTab === "skills" ? (
        <div className="space-y-6" data-testid="agents-skills-panel">
          {/* Skills Installer & 1-Click Auto-Import */}
          <section className="space-y-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-aura-primary">
                  <BookOpen className="h-4 w-4 text-aura-accent" aria-hidden="true" />
                  <span>{t("agentsHub.skills.title")}</span>
                </h3>
                <p className="mt-1 text-xs text-aura-text-muted">
                  {t("agentsHub.skills.subtitle")}
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={importingSkills}
                disabled={importingSkills}
                data-testid="skills-import-local-btn"
                onClick={() => void handleImportLocalSkills()}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {t("agentsHub.skills.importLocalAction")}
              </Button>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-aura-text-muted">
                {t("agentsHub.skills.catalogTitle")}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={installingSkill}
                  data-testid="skill-preset-security"
                  onClick={() =>
                    void handleQuickCatalogSkill({
                      name: t("agentsHub.seeds.skill_security_name"),
                      sourceUri: "catalog://skills/security-audit-clean-code",
                      description: t("agentsHub.seeds.skill_security_desc"),
                      skillMarkdown:
                        "# Security_Audit_Clean_Code\n\n1. Check secret_redaction.\n2. Enforce human_approval.\n3. Verify SQLite_parameter_binding.",
                    })
                  }
                >
                  {t("agentsHub.skills.catalogSecurity")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={installingSkill}
                  data-testid="skill-preset-infra"
                  onClick={() =>
                    void handleQuickCatalogSkill({
                      name: t("agentsHub.seeds.skill_infra_name"),
                      sourceUri: "catalog://skills/kvm-fortigate-lab",
                      description: t("agentsHub.seeds.skill_infra_desc"),
                      skillMarkdown:
                        "# KVM_FortiGate_Lab_Automation\n\nPreserve exact IPs, interfaces, and official Fortinet_NSE terminology.",
                    })
                  }
                >
                  {t("agentsHub.skills.catalogInfra")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={installingSkill}
                  data-testid="skill-preset-api"
                  onClick={() =>
                    void handleQuickCatalogSkill({
                      name: t("agentsHub.seeds.skill_api_name"),
                      sourceUri: "catalog://skills/api-contract-guard",
                      description: t("agentsHub.seeds.skill_api_desc"),
                      skillMarkdown:
                        "# API_Testing_Contract_Guard\n\nValidate request/response schemas and deterministic offline_fallbacks.",
                    })
                  }
                >
                  {t("agentsHub.skills.catalogApi")}
                </Button>
              </div>
            </div>

            <form
              onSubmit={(e) => void handleInstallSkill(e)}
              className="grid grid-cols-1 gap-3 border-t border-aura-border/30 pt-4 md:grid-cols-3"
            >
              <Input
                label={t("agentsHub.skills.nameLabel")}
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder={t("agentsHub.skills.namePlaceholder")}
                data-testid="skill-name-input"
              />
              <Select
                label={t("agentsHub.skills.sourceKindLabel")}
                value={skillSourceKind}
                onChange={(e) => setSkillSourceKind(e.target.value)}
                data-testid="skill-source-select"
              >
                <option value="local_dir">{t("agentsHub.skills.sources.local_dir")}</option>
                <option value="git_repo">{t("agentsHub.skills.sources.git_repo")}</option>
                <option value="catalog">{t("agentsHub.skills.sources.catalog")}</option>
              </Select>
              <Input
                label={t("agentsHub.skills.sourceUriLabel")}
                value={skillSourceUri}
                onChange={(e) => setSkillSourceUri(e.target.value)}
                placeholder={t("agentsHub.skills.sourceUriPlaceholder")}
                data-testid="skill-uri-input"
              />
              <div className="md:col-span-3">
                <Input
                  label={t("agentsHub.skills.descriptionLabel")}
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  placeholder={t("agentsHub.skills.descriptionPlaceholder")}
                  data-testid="skill-desc-input"
                />
              </div>
              <div className="md:col-span-3">
                <Textarea
                  label={t("agentsHub.skills.markdownLabel")}
                  value={skillMarkdown}
                  onChange={(e) => setSkillMarkdown(e.target.value)}
                  placeholder={t("agentsHub.skills.markdownPlaceholder")}
                  rows={3}
                  data-testid="skill-markdown-input"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  loading={installingSkill}
                  disabled={installingSkill || !skillName.trim()}
                  data-testid="skill-install-btn"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("agentsHub.skills.installAction")}
                </Button>
              </div>
            </form>
          </section>

          {/* Installed Skills List */}
          {skills.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-5 w-5" />}
              title={t("agentsHub.skills.empty")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {skills.map((skill) => {
                const isInspected = inspectedSkillId === skill.id;
                const sourceLabel = t(`agentsHub.skills.sources.${skill.sourceKind}`, {
                  defaultValue: skill.sourceKind,
                });
                return (
                  <article
                    key={skill.id}
                    data-testid={`skill-card-${skill.slug}`}
                    className="flex flex-col justify-between gap-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-aura-primary">
                              {t(skill.name, { defaultValue: skill.name })}
                            </h4>
                            <Badge variant="info">{sourceLabel}</Badge>
                            <Badge variant="neutral">v{skill.version}</Badge>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-aura-text-muted">
                            {skill.installPath || skill.sourceUri}
                          </p>
                        </div>

                        <Switch
                          size="sm"
                          checked={skill.enabled}
                          aria-label={`${t(skill.name, { defaultValue: skill.name })} ${t("agentsHub.columns.enabled")}`}
                          data-testid={`skill-toggle-${skill.slug}`}
                          onCheckedChange={(next) => void handleToggleSkill(skill, next)}
                        />
                      </div>

                      <p className="text-xs leading-relaxed text-aura-secondary">
                        {t(skill.description, { defaultValue: skill.description })}
                      </p>

                      {isInspected && (
                        <pre
                          data-testid={`skill-markdown-preview-${skill.slug}`}
                          className="max-h-48 overflow-auto rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 font-mono text-[11px] leading-relaxed text-aura-secondary whitespace-pre-wrap"
                        >
                          {skill.skillMarkdown}
                        </pre>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-aura-border/25 pt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-testid={`skill-inspect-${skill.slug}`}
                        onClick={() =>
                          setInspectedSkillId((prev) => (prev === skill.id ? null : skill.id))
                        }
                      >
                        {isInspected ? (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {isInspected
                          ? t("agentsHub.skills.hideInspectAction")
                          : t("agentsHub.skills.inspectAction")}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`skill-delete-${skill.slug}`}
                        onClick={() => void handleDeleteSkill(skill.id)}
                        className="text-aura-danger hover:text-aura-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("agentsHub.skills.deleteAction")}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : activeSubTab === "mcp" ? (
        <div className="space-y-6" data-testid="agents-mcp-panel">
          {/* MCP Server Registration & 1-Click Presets */}
          <section className="space-y-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-aura-primary">
                <Plug className="h-4 w-4 text-aura-accent" aria-hidden="true" />
                <span>{t("agentsHub.mcp.title")}</span>
              </h3>
              <p className="mt-1 text-xs text-aura-text-muted">
                {t("agentsHub.mcp.subtitle")}
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-aura-text-muted">
                {t("agentsHub.mcp.presetsTitle")}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingMcp}
                  data-testid="mcp-preset-filesystem"
                  onClick={() =>
                    void handleQuickMcpPreset({
                      name: t("agentsHub.seeds.mcp_filesystem_name"),
                      transport: "stdio",
                      commandOrUrl: "npx",
                      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
                    })
                  }
                >
                  {t("agentsHub.mcp.presetFilesystem")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingMcp}
                  data-testid="mcp-preset-github"
                  onClick={() =>
                    void handleQuickMcpPreset({
                      name: t("agentsHub.seeds.mcp_github_name"),
                      transport: "stdio",
                      commandOrUrl: "npx",
                      args: ["-y", "@modelcontextprotocol/server-github"],
                    })
                  }
                >
                  {t("agentsHub.mcp.presetGithub")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingMcp}
                  data-testid="mcp-preset-playwright"
                  onClick={() =>
                    void handleQuickMcpPreset({
                      name: t("agentsHub.seeds.mcp_playwright_name"),
                      transport: "stdio",
                      commandOrUrl: "npx",
                      args: ["-y", "@playwright/mcp@latest"],
                    })
                  }
                >
                  {t("agentsHub.mcp.presetPlaywright")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingMcp}
                  data-testid="mcp-preset-podman"
                  onClick={() =>
                    void handleQuickMcpPreset({
                      name: t("agentsHub.seeds.mcp_podman_name"),
                      transport: "stdio",
                      commandOrUrl: "podman-mcp-server",
                      args: ["--rootless"],
                    })
                  }
                >
                  {t("agentsHub.mcp.presetPodman")}
                </Button>
              </div>
            </div>

            <form
              onSubmit={(e) => void handleSaveMcpPlugin(e)}
              className="grid grid-cols-1 gap-3 border-t border-aura-border/30 pt-4 md:grid-cols-3"
            >
              <Input
                label={t("agentsHub.mcp.nameLabel")}
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                placeholder={t("agentsHub.mcp.namePlaceholder")}
                data-testid="mcp-name-input"
              />
              <Select
                label={t("agentsHub.mcp.transportLabel")}
                value={mcpTransport}
                onChange={(e) =>
                  setMcpTransport(e.target.value === "http_sse" ? "http_sse" : "stdio")
                }
                data-testid="mcp-transport-select"
              >
                <option value="stdio">stdio</option>
                <option value="http_sse">HTTP / SSE</option>
              </Select>
              <Input
                label={t("agentsHub.mcp.argsLabel")}
                value={mcpArgs}
                onChange={(e) => setMcpArgs(e.target.value)}
                placeholder={t("agentsHub.mcp.argsPlaceholder")}
                data-testid="mcp-args-input"
              />
              <div className="md:col-span-3">
                <Input
                  label={t("agentsHub.mcp.commandOrUrlLabel")}
                  value={mcpCommandOrUrl}
                  onChange={(e) => setMcpCommandOrUrl(e.target.value)}
                  placeholder={t("agentsHub.mcp.commandOrUrlPlaceholder")}
                  data-testid="mcp-cmd-input"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  loading={savingMcp}
                  disabled={savingMcp || !mcpName.trim() || !mcpCommandOrUrl.trim()}
                  data-testid="mcp-save-btn"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("agentsHub.mcp.addAction")}
                </Button>
              </div>
            </form>
          </section>

          {/* Registered MCP Plugins List */}
          {mcpPlugins.length === 0 ? (
            <EmptyState
              icon={<Plug className="h-5 w-5" />}
              title={t("agentsHub.mcp.empty")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {mcpPlugins.map((plugin) => {
                const discovered = asArray<string>(plugin.discoveredTools);
                const healthLabel = t(`agentsHub.mcp.health.${plugin.lastHealthStatus}`, {
                  defaultValue: plugin.lastHealthStatus,
                });
                return (
                  <article
                    key={plugin.id}
                    data-testid={`mcp-card-${plugin.slug}`}
                    className="flex flex-col justify-between gap-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-aura-primary">
                              {t(plugin.name, { defaultValue: plugin.name })}
                            </h4>
                            <Badge variant="info">{plugin.transport}</Badge>
                            <Badge variant={healthBadgeVariant(plugin.lastHealthStatus)}>
                              {healthLabel}
                            </Badge>
                          </div>
                          <p className="mt-1 break-all font-mono text-xs text-aura-secondary">
                            {plugin.commandOrUrl}{" "}
                            {asArray<string>(plugin.args).join(" ")}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-aura-text-muted">
                          {t("agentsHub.mcp.discoveredToolsLabel")} ({discovered.length})
                        </div>
                        {discovered.length === 0 ? (
                          <p className="text-xs text-aura-text-muted">
                            {t("agentsHub.mcp.noToolsDiscovered")}
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {discovered.map((toolName) => (
                              <span
                                key={toolName}
                                className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/60 px-2 py-0.5 font-mono text-[11px] text-aura-secondary"
                              >
                                {toolName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-aura-border/25 pt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        loading={testingMcpId === plugin.id}
                        disabled={testingMcpId === plugin.id}
                        data-testid={`mcp-test-${plugin.slug}`}
                        onClick={() => void handleTestMcpPlugin(plugin)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("agentsHub.mcp.testAction")}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`mcp-delete-${plugin.slug}`}
                        onClick={() => void handleDeleteMcpPlugin(plugin.id)}
                        className="text-aura-danger hover:text-aura-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("agentsHub.mcp.deleteAction")}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Specialized Agents (8) */}
          <section aria-labelledby="agents-section-heading" className="space-y-3">
            <h3
              id="agents-section-heading"
              className="inline-flex items-center gap-2 rounded-xl aura-glass-pill px-3.5 py-2 text-sm font-semibold text-aura-primary"
            >
              <Cpu className="h-4 w-4 text-aura-accent" aria-hidden="true" />
              <span>{t("agentsHub.agentsSection")}</span>
            </h3>

            {agents.length === 0 ? (
              <EmptyState title={t("hindsightPanel.emptyList")} />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {agents.map((agent) => {
                  const isGuarded = agent.status === "guarded";
                  const capabilities = asArray<string>(agent.capabilities);

                  return (
                    <article
                      key={agent.role}
                      data-testid={`agent-card-${agent.role}`}
                      className="flex flex-col justify-between gap-3 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-4 shadow-aura-surface backdrop-blur-md transition-colors hover:border-aura-accent/40"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 text-aura-accent">
                              {renderAgentIcon(agent.role)}
                            </span>
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold text-aura-primary">
                                {t(agent.name, { defaultValue: agent.name })}
                              </h4>
                              <p className="truncate font-mono text-[11px] text-aura-text-muted">
                                {agent.role}
                              </p>
                            </div>
                          </div>

                          <Badge
                            variant={agentStatusVariant(agent.status)}
                            className="shrink-0"
                          >
                            {agent.status}
                          </Badge>
                        </div>

                        <p className="text-xs leading-relaxed text-aura-secondary">
                          {t(agent.responsibility, {
                            defaultValue: agent.responsibility,
                          })}
                        </p>

                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium uppercase tracking-wider text-aura-text-muted">
                            {t("agentsHub.capabilities")}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {capabilities.map((cap) => (
                              <span
                                key={cap}
                                className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/60 px-2 py-0.5 font-mono text-[11px] text-aura-secondary"
                              >
                                {cap}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div
                        className={
                          isGuarded
                            ? "rounded-aura-md border border-aura-warning/30 bg-aura-warning/10 px-3 py-2 text-xs"
                            : "rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 px-3 py-2 text-xs"
                        }
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-aura-text-muted">
                          {isGuarded ? (
                            <ShieldAlert
                              className="h-3.5 w-3.5 text-aura-warning"
                              aria-hidden="true"
                            />
                          ) : (
                            <ShieldCheck
                              className="h-3.5 w-3.5 text-aura-success"
                              aria-hidden="true"
                            />
                          )}
                          <span>{t("agentsHub.safetyBoundary")}</span>
                        </div>
                        <p className="mt-1 leading-relaxed text-aura-secondary">
                          {t(agent.safetyBoundary, {
                            defaultValue: agent.safetyBoundary,
                          })}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Tool Registry & Permission Policies */}
          <section
            aria-labelledby="registry-section-heading"
            className="space-y-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md"
          >
            <div>
              <h3
                id="registry-section-heading"
                className="flex items-center gap-2 text-sm font-semibold text-aura-primary"
              >
                <Wrench className="h-4 w-4 text-aura-accent" aria-hidden="true" />
                <span>{t("agentsHub.registrySection")}</span>
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-aura-text-muted">
                <Lock className="h-3.5 w-3.5 shrink-0 text-aura-warning" aria-hidden="true" />
                <span>{t("agentsHub.registryHint")}</span>
              </p>
            </div>

            {policyError && (
              <div
                role="alert"
                data-testid="agents-policy-error"
                className="flex items-center gap-2 rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3.5 py-2.5 text-xs text-aura-danger"
              >
                <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">{policyError}</span>
              </div>
            )}

            {tools.length === 0 ? (
              <EmptyState title={t("hindsightPanel.emptyList")} />
            ) : (
              <div className="overflow-x-auto rounded-aura-md border border-aura-border/40 bg-aura-canvas/40">
                <table className="w-full min-w-[740px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-aura-border/40 bg-aura-surface/70 text-[11px] uppercase tracking-wider text-aura-text-muted">
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("agentsHub.columns.tool")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("agentsHub.columns.agent")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("agentsHub.columns.risk")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("agentsHub.columns.permission")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold text-right">
                        {t("agentsHub.columns.enabled")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-aura-border/25">
                    {tools.map((tool) => {
                      const restricted = isRestrictedRisk(tool.riskLevel);
                      const updating = Boolean(pendingTools[tool.toolName]);
                      const roleLabel = t(`agentsHub.roles.${tool.agentRole}.name`, {
                        defaultValue: tool.agentRole,
                      });

                      return (
                        <tr
                          key={tool.toolName}
                          data-testid={`tool-row-${tool.toolName}`}
                          className="transition-colors hover:bg-aura-surface/40"
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-aura-primary">
                                {tool.toolName}
                              </span>
                              {tool.source && (
                                <span className="rounded-aura-sm border border-aura-border/35 bg-aura-surface/70 px-1.5 py-0.5 font-mono text-[10px] text-aura-text-muted">
                                  {tool.source}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-aura-secondary">
                              {t(tool.description, { defaultValue: tool.description })}
                            </p>
                          </td>

                          <td className="px-4 py-3 align-middle whitespace-nowrap text-aura-secondary">
                            {roleLabel}
                          </td>

                          <td className="px-4 py-3 align-middle whitespace-nowrap">
                            <Badge variant={riskBadgeVariant(tool.riskLevel)}>
                              {tool.riskLevel}
                            </Badge>
                          </td>

                          <td className="px-4 py-3 align-middle">
                            <Select
                              value={tool.permission}
                              disabled={updating}
                              aria-label={`${tool.toolName} ${t("agentsHub.columns.permission")}`}
                              data-testid={`tool-permission-${tool.toolName}`}
                              onChange={(e) => {
                                void handleUpdateToolPolicy(
                                  tool,
                                  e.target.value,
                                  tool.enabled,
                                );
                              }}
                              className="h-8 min-w-[168px] py-1 text-xs"
                            >
                              <option value="allow" disabled={restricted}>
                                {t("agentsHub.permissions.allow")}
                              </option>
                              <option value="require_approval">
                                {t("agentsHub.permissions.require_approval")}
                              </option>
                              <option value="deny">
                                {t("agentsHub.permissions.deny")}
                              </option>
                            </Select>
                          </td>

                          <td className="px-4 py-3 align-middle text-right">
                            <div className="inline-flex items-center justify-end">
                              <Switch
                                size="sm"
                                checked={tool.enabled}
                                disabled={updating}
                                aria-label={`${tool.toolName} ${t("agentsHub.columns.enabled")}`}
                                data-testid={`tool-enabled-${tool.toolName}`}
                                onCheckedChange={(nextEnabled) => {
                                  void handleUpdateToolPolicy(
                                    tool,
                                    tool.permission,
                                    nextEnabled,
                                  );
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Orchestrator — Safe Plan Simulation */}
          <section
            aria-labelledby="planner-section-heading"
            className="space-y-4 rounded-aura-lg border border-aura-border/40 bg-aura-surface/80 p-5 shadow-aura-surface backdrop-blur-md"
          >
            <h3
              id="planner-section-heading"
              className="flex items-center gap-2 text-sm font-semibold text-aura-primary"
            >
              <Play className="h-4 w-4 text-aura-accent" aria-hidden="true" />
              <span>{t("agentsHub.plannerSection")}</span>
            </h3>

            <form
              onSubmit={(e) => {
                void handlePlanPreview(e);
              }}
              className="flex flex-col gap-3 sm:flex-row sm:items-start"
            >
              <Input
                containerClassName="flex-1"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={t("agentsHub.goalPlaceholder")}
                aria-label={t("agentsHub.goalPlaceholder")}
                data-testid="agents-plan-input"
                disabled={planning}
              />
              <Button
                type="submit"
                loading={planning}
                disabled={planning || !goal.trim()}
                data-testid="agents-plan-submit"
                className="shrink-0 sm:h-[38px]"
              >
                {t("agentsHub.planAction")}
              </Button>
            </form>

            {planError && (
              <div
                role="alert"
                data-testid="agents-plan-error"
                className="flex items-center gap-2 rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3.5 py-2.5 text-xs text-aura-danger"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">{planError}</span>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-aura-text-muted">
                {t("agentsHub.recentRuns")}
              </h4>

              {runs.length === 0 ? (
                <EmptyState
                  icon={<Network className="h-5 w-5" />}
                  title={t("agentsHub.noRuns")}
                />
              ) : (
                <div className="space-y-3">
                  {runs.map((run) => {
                    const steps = asArray<AgentPlanStep>(run.plan);
                    const needsApproval =
                      run.status === "awaiting_approval" ||
                      steps.some((step) => step.requiresApproval);

                    return (
                      <article
                        key={run.id}
                        data-testid={`agent-run-${run.id}`}
                        className="space-y-3 rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-sm font-semibold text-aura-primary break-words">
                              {run.goal}
                            </div>
                            <div className="text-xs text-aura-secondary">
                              {formatRunSummary(run)}
                            </div>
                            <div className="text-[11px] text-aura-text-muted">
                              {formatTimestamp(run.createdAt)}
                            </div>
                          </div>

                          <Badge variant={needsApproval ? "warning" : "success"}>
                            {run.status}
                          </Badge>
                        </div>

                        {steps.length > 0 && (
                          <ol className="space-y-2">
                            {steps.map((step) => {
                              const stepRoleLabel = t(
                                `agentsHub.roles.${step.agentRole}.name`,
                                { defaultValue: step.agentRole },
                              );

                              return (
                                <li
                                  key={`${run.id}-${step.step}-${step.toolName}`}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-aura-sm border border-aura-border/30 bg-aura-surface/70 px-3 py-2 text-xs"
                                >
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-aura-accent/15 font-mono text-[11px] font-semibold text-aura-accent">
                                      {step.step}
                                    </span>
                                    <Badge variant="neutral">{stepRoleLabel}</Badge>
                                    <span className="font-medium text-aura-primary">
                                      {t(step.action, { defaultValue: step.action })}
                                    </span>
                                    <span className="font-mono text-[11px] text-aura-text-muted">
                                      {step.toolName}
                                    </span>
                                  </div>

                                  <Badge
                                    variant={step.requiresApproval ? "warning" : "success"}
                                  >
                                    {step.requiresApproval ? (
                                      <ShieldAlert
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <CheckCircle2
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {step.requiresApproval
                                      ? t("agentsHub.requiresApproval")
                                      : t("agentsHub.autoAllowed")}
                                  </Badge>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
