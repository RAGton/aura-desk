import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import { AgentsHubPage } from "./AgentsHubPage";

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    agentsApi: {
      overview: vi.fn(),
      setToolPolicy: vi.fn(),
      planPreview: vi.fn(),
      executeRun: vi.fn(),
      resumeRun: vi.fn(),
      listCapabilities: vi.fn(),
      selectCapabilities: vi.fn(),
      listBots: vi.fn(),
      upsertBot: vi.fn(),
      deleteBot: vi.fn(),
      listSkills: vi.fn(),
      installSkill: vi.fn(),
      importLocalSkills: vi.fn(),
      toggleSkill: vi.fn(),
      deleteSkill: vi.fn(),
      listMcpPlugins: vi.fn(),
      upsertMcpPlugin: vi.fn(),
      testMcpPlugin: vi.fn(),
      deleteMcpPlugin: vi.fn(),
    },
  };
});

import {
  agentsApi,
  type AgentBotRecord,
  type AgentDescriptor,
  type AgentRunRecord,
  type AgentSkillRecord,
  type AgentsOverview,
  type AgentToolEntry,
  type McpPluginRecord,
} from "../lib/ipc";

const mockAgentsApi = vi.mocked(agentsApi);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAgents(): AgentDescriptor[] {
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

function makeTools(): AgentToolEntry[] {
  return [
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
      toolName: "browser.navigate",
      agentRole: "browser_agent",
      description: "agentsHub.tools.browser_navigate",
      permission: "require_approval",
      riskLevel: "privileged",
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
}

function makeOverview(overrides: Partial<AgentsOverview> = {}): AgentsOverview {
  return {
    agents: makeAgents(),
    tools: makeTools(),
    runs: [],
    pendingProposals: 3,
    ...overrides,
  };
}

describe("AgentsHubPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    mockAgentsApi.overview.mockReset();
    mockAgentsApi.setToolPolicy.mockReset();
    mockAgentsApi.planPreview.mockReset();
  });

  it("shows loading skeletons, renders EmptyState on initial error, and recovers on retry", async () => {
    const user = userEvent.setup();
    const initialLoad = createDeferred<AgentsOverview>();
    mockAgentsApi.overview.mockImplementationOnce(() => initialLoad.promise);

    render(<AgentsHubPage />);

    expect(screen.getByTestId("agents-loading")).toBeInTheDocument();
    expect(screen.getByTestId("agents-refresh-btn")).toBeDisabled();
    expect(screen.queryByTestId("agents-pending-proposals")).not.toBeInTheDocument();

    initialLoad.reject(new Error("Agent runtime IPC unavailable"));

    expect(await screen.findByText("Agent runtime IPC unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-loading")).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    mockAgentsApi.overview.mockResolvedValueOnce(makeOverview());

    await user.click(retryButton);

    await waitFor(() => {
      expect(mockAgentsApi.overview).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId("agent-card-orchestrator")).toBeInTheDocument();
    expect(screen.queryByText("Agent runtime IPC unavailable")).not.toBeInTheDocument();
  });

  it("renders all 8 specialized agents with capabilities, safety boundaries, and pending proposals badge", async () => {
    mockAgentsApi.overview.mockResolvedValueOnce(makeOverview({ pendingProposals: 4 }));

    render(<AgentsHubPage />);

    const proposalsBadge = await screen.findByTestId("agents-pending-proposals");
    expect(proposalsBadge).toHaveTextContent("4 proposals awaiting approval");

    const expectedAgents = [
      {
        role: "orchestrator",
        name: "Orchestrator",
        status: "ready",
        capabilities: ["intent_routing", "multi_step_planning", "safety_gating"],
        safety: "Sensitive actions emit approval proposals before execution.",
      },
      {
        role: "memory_agent",
        name: "Memory Agent",
        status: "ready",
        capabilities: ["hindsight_recall", "hindsight_retain", "graph_traversal"],
        safety: "Deduplicated writes preserving audit trail for superseded facts.",
      },
      {
        role: "research_agent",
        name: "Research Agent",
        status: "ready",
        capabilities: ["document_retrieval", "entity_graph_query", "evidence_synthesis"],
        safety: "Read-only across authorized folders and configured endpoints.",
      },
      {
        role: "browser_agent",
        name: "Browser Agent",
        status: "guarded",
        capabilities: ["browser.navigate", "browser.extract_page"],
        safety: "Always requires user approval before mutating external state or submitting forms.",
      },
      {
        role: "computer_agent",
        name: "Computer Agent",
        status: "guarded",
        capabilities: ["computer.focus_window", "computer.capture_screen"],
        safety: "Privileged UI actions require explicit human confirmation.",
      },
      {
        role: "system_agent",
        name: "System Agent",
        status: "guarded",
        capabilities: ["system.read_workspace_file", "system.run_shell_command"],
        safety: "Destructive or shell operations cannot bypass human approval.",
      },
      {
        role: "context_manager",
        name: "Context Manager",
        status: "ready",
        capabilities: ["context_compression", "token_monitoring"],
        safety: "Never deletes raw message history during compression.",
      },
      {
        role: "tool_registry",
        name: "Tool Registry",
        status: "ready",
        capabilities: ["policy_enforcement", "schema_validation"],
        safety: "Rejects unsafe auto-allow overrides on privileged or destructive tools.",
      },
    ];

    for (const agent of expectedAgents) {
      const card = screen.getByTestId(`agent-card-${agent.role}`);
      const cardScope = within(card);

      expect(cardScope.getByRole("heading", { name: agent.name })).toBeInTheDocument();
      expect(cardScope.getByText(agent.role)).toBeInTheDocument();
      expect(cardScope.getByText(agent.status)).toBeInTheDocument();
      expect(cardScope.getByText("Capabilities")).toBeInTheDocument();
      for (const cap of agent.capabilities) {
        expect(cardScope.getByText(cap)).toBeInTheDocument();
      }
      expect(cardScope.getByText("Safety Boundary")).toBeInTheDocument();
      expect(cardScope.getByText(agent.safety)).toBeInTheDocument();
    }

    const renderedCards = screen.getAllByTestId(/^agent-card-/);
    expect(renderedCards).toHaveLength(8);
  });

  it("enforces disabled allow options for privileged/destructive tools and updates safe tool policies via select and switch", async () => {
    const user = userEvent.setup();
    const overview = makeOverview();
    mockAgentsApi.overview.mockResolvedValueOnce(overview);

    render(<AgentsHubPage />);

    const privilegedSelect = (await screen.findByTestId(
      "tool-permission-browser.navigate",
    )) as HTMLSelectElement;
    const destructiveSelect = screen.getByTestId(
      "tool-permission-system.run_shell_command",
    ) as HTMLSelectElement;
    const readSelect = screen.getByTestId(
      "tool-permission-memory.hindsight_recall",
    ) as HTMLSelectElement;
    const writeSelect = screen.getByTestId(
      "tool-permission-memory.hindsight_retain",
    ) as HTMLSelectElement;

    expect(
      within(privilegedSelect).getByRole("option", { name: "Allow" }),
    ).toBeDisabled();
    expect(
      within(destructiveSelect).getByRole("option", { name: "Allow" }),
    ).toBeDisabled();
    expect(within(readSelect).getByRole("option", { name: "Allow" })).toBeEnabled();
    expect(within(writeSelect).getByRole("option", { name: "Allow" })).toBeEnabled();

    const retainTool = overview.tools.find(
      (tool) => tool.toolName === "memory.hindsight_retain",
    )!;
    mockAgentsApi.setToolPolicy.mockResolvedValueOnce({
      ...retainTool,
      permission: "allow",
    });

    await user.selectOptions(writeSelect, "allow");

    await waitFor(() => {
      expect(mockAgentsApi.setToolPolicy).toHaveBeenCalledWith(
        "memory.hindsight_retain",
        "allow",
        true,
      );
    });
    expect(writeSelect).toHaveValue("allow");

    const recallTool = overview.tools.find(
      (tool) => tool.toolName === "memory.hindsight_recall",
    )!;
    const recallSwitch = screen.getByRole("switch", {
      name: "memory.hindsight_recall Enabled",
    });
    expect(recallSwitch).toHaveAttribute("aria-checked", "true");

    mockAgentsApi.setToolPolicy.mockResolvedValueOnce({
      ...recallTool,
      enabled: false,
    });

    await user.click(recallSwitch);

    await waitFor(() => {
      expect(mockAgentsApi.setToolPolicy).toHaveBeenCalledWith(
        "memory.hindsight_recall",
        "allow",
        false,
      );
    });
    expect(recallSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("surfaces an accessible role=alert error banner when setToolPolicy rejects", async () => {
    const user = userEvent.setup();
    mockAgentsApi.overview.mockResolvedValueOnce(makeOverview());
    mockAgentsApi.setToolPolicy.mockRejectedValueOnce(
      new Error("Security policy prevents modifying locked tool policy"),
    );

    render(<AgentsHubPage />);

    const shellSwitch = await screen.findByRole("switch", {
      name: "system.run_shell_command Enabled",
    });
    expect(shellSwitch).toHaveAttribute("aria-checked", "true");

    await user.click(shellSwitch);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "agents-policy-error");
    expect(alert).toHaveTextContent(
      "Security policy prevents modifying locked tool policy",
    );
    expect(shellSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("simulates an orchestrator plan, shows approval/auto-allowed step badges, and adds runs to recent list", async () => {
    const user = userEvent.setup();
    mockAgentsApi.overview.mockResolvedValueOnce(makeOverview({ runs: [] }));

    render(<AgentsHubPage activeSessionId="session-42" />);

    expect(await screen.findByText("No planned runs simulated yet.")).toBeInTheDocument();

    const goalInput = screen.getByTestId("agents-plan-input");
    const submitButton = screen.getByTestId("agents-plan-submit");
    expect(submitButton).toBeDisabled();

    const simulatedRun: AgentRunRecord = {
      id: "run-101",
      sessionId: "session-42",
      agentRole: "orchestrator",
      goal: "Read docs and inspect target site",
      status: "awaiting_approval",
      resultSummary: "planned_steps:3:approval_required",
      createdAt: "2026-11-22T12:30:00Z",
      plan: [
        {
          step: 1,
          agentRole: "memory_agent",
          toolName: "memory.hindsight_recall",
          action: "agentsHub.plan.recall_memories",
          requiresApproval: false,
        },
        {
          step: 2,
          agentRole: "research_agent",
          toolName: "research.knowledge_query",
          action: "agentsHub.plan.query_knowledge",
          requiresApproval: false,
        },
        {
          step: 3,
          agentRole: "browser_agent",
          toolName: "browser.navigate",
          action: "agentsHub.plan.browser_navigate",
          requiresApproval: true,
        },
      ],
    };
    mockAgentsApi.planPreview.mockResolvedValueOnce(simulatedRun);

    await user.type(goalInput, "Read docs and inspect target site");
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockAgentsApi.planPreview).toHaveBeenCalledWith(
        "Read docs and inspect target site",
        "session-42",
      );
    });

    const runCard = await screen.findByTestId("agent-run-run-101");
    const runScope = within(runCard);

    expect(runScope.getByText("Read docs and inspect target site")).toBeInTheDocument();
    expect(
      runScope.getByText(
        "Planned 3 step(s) — human approval required for sensitive steps",
      ),
    ).toBeInTheDocument();
    expect(runScope.getByText("awaiting_approval")).toBeInTheDocument();

    const stepItems = runScope.getAllByRole("listitem");
    expect(stepItems).toHaveLength(3);

    expect(within(stepItems[0]).getByText("Memory Agent")).toBeInTheDocument();
    expect(
      within(stepItems[0]).getByText("Retrieve relevant memories from Hindsight banks"),
    ).toBeInTheDocument();
    expect(within(stepItems[0]).getByText("memory.hindsight_recall")).toBeInTheDocument();
    expect(within(stepItems[0]).getByText("Auto-allowed")).toBeInTheDocument();

    expect(within(stepItems[1]).getByText("Research Agent")).toBeInTheDocument();
    expect(
      within(stepItems[1]).getByText("Query indexed documents, entities, and relations"),
    ).toBeInTheDocument();
    expect(within(stepItems[1]).getByText("research.knowledge_query")).toBeInTheDocument();
    expect(within(stepItems[1]).getByText("Auto-allowed")).toBeInTheDocument();

    expect(within(stepItems[2]).getByText("Browser Agent")).toBeInTheDocument();
    expect(
      within(stepItems[2]).getByText(
        "Open and inspect target page through guarded Browser Agent",
      ),
    ).toBeInTheDocument();
    expect(within(stepItems[2]).getByText("browser.navigate")).toBeInTheDocument();
    expect(
      within(stepItems[2]).getByText("Requires human approval"),
    ).toBeInTheDocument();

    expect(screen.queryByText("No planned runs simulated yet.")).not.toBeInTheDocument();
    expect(goalInput).toHaveValue("");

    const safeRun: AgentRunRecord = {
      id: "run-102",
      sessionId: "session-42",
      agentRole: "orchestrator",
      goal: "Recall recent project decisions",
      status: "planned",
      resultSummary: "planned_steps:1:safe_only",
      createdAt: "2026-11-22T12:35:00Z",
      plan: [
        {
          step: 1,
          agentRole: "memory_agent",
          toolName: "memory.hindsight_recall",
          action: "agentsHub.plan.recall_memories",
          requiresApproval: false,
        },
      ],
    };
    mockAgentsApi.planPreview.mockResolvedValueOnce(safeRun);

    await user.type(goalInput, "Recall recent project decisions");
    await user.click(submitButton);

    const secondRunCard = await screen.findByTestId("agent-run-run-102");
    expect(
      within(secondRunCard).getByText(
        "Planned 1 step(s) — safe read/context steps only",
      ),
    ).toBeInTheDocument();
    expect(within(secondRunCard).getByText("Auto-allowed")).toBeInTheDocument();

    const allRunCards = screen.getAllByTestId(/^agent-run-/);
    expect(allRunCards).toHaveLength(2);
    expect(allRunCards[0]).toHaveAttribute("data-testid", "agent-run-run-102");
    expect(allRunCards[1]).toHaveAttribute("data-testid", "agent-run-run-101");
  });

  it("manages custom bots, SKILL.md skills, and MCP server plugins across sub-tabs", async () => {
    const user = userEvent.setup();
    const initialBot: AgentBotRecord = {
      id: "bot-aura-professora",
      slug: "aura-professora",
      name: "Aura Professora & Lab Coach",
      roleKind: "study_coach",
      icon: "brain",
      description: "NSE & Infra study specialist",
      systemPrompt: "Use official terminology",
      preferredProvider: "auto",
      preferredModel: "gemini-2.5-pro",
      hindsightBank: "estudos",
      skillIds: ["skill-hindsight-curator"],
      enabled: true,
      pinnedInChat: true,
      createdAt: "2026-11-22T12:00:00Z",
      updatedAt: "2026-11-22T12:00:00Z",
    };
    const initialSkill: AgentSkillRecord = {
      id: "skill-hindsight-curator",
      slug: "hindsight-memory-curator",
      name: "Hindsight Memory Curator",
      description: "Semantic memory curation",
      version: "1.2.0",
      sourceKind: "builtin",
      sourceUri: "builtin://skills/hindsight-memory-curator",
      installPath: "~/.auradesk/skills/hindsight-memory-curator/SKILL.md",
      skillMarkdown: "# Hindsight Memory Curator\n\nRetain validated facts.",
      enabled: true,
      installedAt: "2026-11-22T12:00:00Z",
      updatedAt: "2026-11-22T12:00:00Z",
    };
    const initialMcp: McpPluginRecord = {
      id: "mcp-hindsight-local",
      slug: "hindsight-memory-mcp",
      name: "Hindsight Memory Server",
      transport: "http_sse",
      commandOrUrl: "http://127.0.0.1:8919/mcp",
      args: [],
      envVars: [],
      enabled: true,
      lastHealthStatus: "unknown",
      lastHealthCheckedAt: null,
      discoveredTools: [],
      createdAt: "2026-11-22T12:00:00Z",
      updatedAt: "2026-11-22T12:00:00Z",
    };

    mockAgentsApi.overview.mockResolvedValueOnce(
      makeOverview({
        bots: [initialBot],
        skills: [initialSkill],
        mcpPlugins: [initialMcp],
      }),
    );

    render(<AgentsHubPage />);

    // 1. Bots Tab
    const botsTab = await screen.findByTestId("agents-tab-bots");
    await user.click(botsTab);

    expect(await screen.findByTestId("bot-card-aura-professora")).toBeInTheDocument();

    const createdBot: AgentBotRecord = {
      id: "bot-devops",
      slug: "devops-nixos",
      name: "DevOps NixOS Bot",
      roleKind: "custom_bot",
      icon: "terminal",
      description: "Podman & Nix Flakes automation",
      systemPrompt: "Keep builds reproducible",
      preferredProvider: "auto",
      preferredModel: "gemini-2.5-pro",
      hindsightBank: "garos",
      skillIds: [],
      enabled: true,
      pinnedInChat: true,
      createdAt: "2026-11-22T12:10:00Z",
      updatedAt: "2026-11-22T12:10:00Z",
    };
    mockAgentsApi.upsertBot.mockResolvedValueOnce(createdBot);

    await user.type(screen.getByTestId("bot-name-input"), "DevOps NixOS Bot");
    await user.type(screen.getByTestId("bot-bank-input"), "garos");
    await user.click(screen.getByTestId("bot-save-btn"));

    expect(await screen.findByTestId("bot-card-devops-nixos")).toBeInTheDocument();

    mockAgentsApi.deleteBot.mockResolvedValueOnce();
    await user.click(screen.getByTestId("bot-delete-devops-nixos"));
    await waitFor(() => {
      expect(screen.queryByTestId("bot-card-devops-nixos")).not.toBeInTheDocument();
    });

    // 2. Skills Tab
    await user.click(screen.getByTestId("agents-tab-skills"));
    expect(await screen.findByTestId("skill-card-hindsight-memory-curator")).toBeInTheDocument();

    await user.click(screen.getByTestId("skill-inspect-hindsight-memory-curator"));
    expect(
      screen.getByTestId("skill-markdown-preview-hindsight-memory-curator"),
    ).toHaveTextContent("# Hindsight Memory Curator");

    const importedSkill: AgentSkillRecord = {
      id: "skill-antigravity-guide",
      slug: "antigravity-guide",
      name: "Antigravity Guide",
      description: "Imported Antigravity skill",
      version: "2.0.0",
      sourceKind: "antigravity_import",
      sourceUri: "~/.gemini/antigravity/builtin/skills/antigravity_guide/SKILL.md",
      installPath: "~/.gemini/antigravity/builtin/skills/antigravity_guide/SKILL.md",
      skillMarkdown: "# Antigravity Guide",
      enabled: true,
      installedAt: "2026-11-22T12:15:00Z",
      updatedAt: "2026-11-22T12:15:00Z",
    };
    mockAgentsApi.importLocalSkills.mockResolvedValueOnce([importedSkill, initialSkill]);
    await user.click(screen.getByTestId("skills-import-local-btn"));
    expect(await screen.findByTestId("skill-card-antigravity-guide")).toBeInTheDocument();

    // 3. MCP Plugins Tab
    await user.click(screen.getByTestId("agents-tab-mcp"));
    expect(await screen.findByTestId("mcp-card-hindsight-memory-mcp")).toBeInTheDocument();

    mockAgentsApi.testMcpPlugin.mockResolvedValueOnce({
      ...initialMcp,
      lastHealthStatus: "healthy",
      discoveredTools: ["mcp.hindsight-memory-mcp.recall", "mcp.hindsight-memory-mcp.retain"],
    });
    await user.click(screen.getByTestId("mcp-test-hindsight-memory-mcp"));
    expect(await screen.findByText("mcp.hindsight-memory-mcp.recall")).toBeInTheDocument();
  });

  it("executes planned runs and approves/resumes gated runs from the planner list", async () => {
    const user = userEvent.setup();
    const plannedRun: AgentRunRecord = {
      id: "run-exec-1",
      sessionId: "default",
      agentRole: "orchestrator",
      goal: "List today tasks",
      status: "planned",
      resultSummary: "planned_steps:1:safe_only",
      createdAt: "2026-11-26T10:00:00Z",
      plan: [
        {
          step: 1,
          agentRole: "orchestrator",
          toolName: "tasks.list",
          action: "List tasks",
          requiresApproval: false,
        },
      ],
    };
    const gatedRun: AgentRunRecord = {
      id: "run-gate-2",
      sessionId: "default",
      agentRole: "orchestrator",
      goal: "Open docs in browser",
      status: "awaiting_approval",
      resultSummary: "planned_steps:1:approval_required",
      createdAt: "2026-11-26T10:01:00Z",
      plan: [
        {
          step: 1,
          agentRole: "browser_agent",
          toolName: "browser.navigate",
          action: "Navigate page",
          requiresApproval: true,
        },
      ],
    };

    mockAgentsApi.overview.mockResolvedValueOnce(
      makeOverview({ runs: [plannedRun, gatedRun] }),
    );
    mockAgentsApi.executeRun.mockResolvedValueOnce({
      runId: "run-exec-1",
      status: "completed",
      goal: "List today tasks",
      completedSteps: 1,
      totalSteps: 1,
      eventsCount: 2,
    });
    mockAgentsApi.resumeRun.mockResolvedValueOnce({
      runId: "run-gate-2",
      status: "completed",
      goal: "Open docs in browser",
      completedSteps: 1,
      totalSteps: 1,
      eventsCount: 3,
    });

    render(<AgentsHubPage />);

    const execBtn = await screen.findByTestId("agent-exec-run-run-exec-1");
    await user.click(execBtn);
    await waitFor(() => {
      expect(mockAgentsApi.executeRun).toHaveBeenCalledWith("run-exec-1");
    });

    const resumeBtn = screen.getByTestId("agent-exec-run-run-gate-2");
    await user.click(resumeBtn);
    await waitFor(() => {
      expect(mockAgentsApi.resumeRun).toHaveBeenCalledWith("run-gate-2");
    });

    const gateCard = screen.getByTestId("agent-run-run-gate-2");
    expect(within(gateCard).getByText("completed")).toBeInTheDocument();
  });
});
