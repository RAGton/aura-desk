import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import type {
  ChatSession,
  ContextInspection,
  ContextLayerSnapshot,
  PersistedChatMessage,
} from "../lib/ipc";

const { mockSessionsApi, mockContextEngineApi, mockAiApi } = vi.hoisted(() => ({
  mockSessionsApi: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
  },
  mockContextEngineApi: {
    inspect: vi.fn(),
    compress: vi.fn(),
  },
  mockAiApi: {
    providerStatus: vi.fn(),
    chatHistory: vi.fn(),
    chatClear: vi.fn(),
  },
}));

vi.mock("../lib/ipc", () => ({
  sessionsApi: mockSessionsApi,
  contextEngineApi: mockContextEngineApi,
  aiApi: mockAiApi,
}));

import { SessionsCenterPage } from "./SessionsCenterPage";

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "default",
    title: "sessions.defaultTitle",
    status: "active",
    semanticSummary: "",
    contextState: "healthy",
    compressionState: "none",
    compressionCount: 0,
    estimatedTokens: 120,
    tokenBudget: 8192,
    model: "gpt-4o-mini",
    provider: "openai",
    associatedMemories: [],
    toolsUsed: [],
    messageCount: 2,
    lastMessagePreview: "Latest reply preview",
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
    lastActivityAt: "2026-11-22T12:00:00.000Z",
    ...overrides,
  };
}

function makeSevenLayers(
  overrides: Partial<Record<ContextLayerSnapshot["kind"], Partial<ContextLayerSnapshot>>> = {}
): ContextLayerSnapshot[] {
  const defaults: ContextLayerSnapshot[] = [
    {
      kind: "system",
      label: "system",
      tokenCount: 160,
      itemCount: 1,
      preview: "aura_persona_policy",
    },
    {
      kind: "user",
      label: "user",
      tokenCount: 140,
      itemCount: 4,
      preview: "user_facts_empty",
    },
    {
      kind: "session",
      label: "session",
      tokenCount: 220,
      itemCount: 1,
      preview: "semantic_summary_empty",
    },
    {
      kind: "recent",
      label: "recent",
      tokenCount: 640,
      itemCount: 6,
      preview: "[user] Deploy checklist | [assistant] Ready",
    },
    {
      kind: "retrieved",
      label: "retrieved",
      tokenCount: 180,
      itemCount: 2,
      preview: "2 retrieved_memories",
    },
    {
      kind: "working",
      label: "working",
      tokenCount: 90,
      itemCount: 2,
      preview: "workspace_tasks_pomodoro",
    },
    {
      kind: "tool",
      label: "tool",
      tokenCount: 64,
      itemCount: 1,
      preview: "—",
    },
  ];

  return defaults.map((layer) => ({
    ...layer,
    ...(overrides[layer.kind] ?? {}),
  }));
}

function makeInspection(overrides: Partial<ContextInspection> = {}): ContextInspection {
  const session = overrides.session ?? makeSession();
  const layers = overrides.layers ?? makeSevenLayers();
  return {
    session,
    layers,
    totalTokens: 1494,
    tokenBudget: 8192,
    usagePct: 18,
    totalHistoryMessages: 8,
    events: [],
    ...overrides,
  };
}

function renderPage(
  props: Partial<{
    activeSessionId: string;
    onContinueSession: (sessionId: string) => void;
    onActiveSessionDeleted?: () => void;
  }> = {}
) {
  const onContinueSession = props.onContinueSession ?? vi.fn();
  const onActiveSessionDeleted = props.onActiveSessionDeleted ?? vi.fn();
  return {
    onContinueSession,
    onActiveSessionDeleted,
    ...render(
      <I18nextProvider i18n={i18n}>
        <SessionsCenterPage
          activeSessionId={props.activeSessionId ?? "default"}
          onContinueSession={onContinueSession}
          onActiveSessionDeleted={onActiveSessionDeleted}
        />
      </I18nextProvider>
    ),
  };
}

describe("SessionsCenterPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    mockSessionsApi.list.mockResolvedValue([makeSession()]);
    mockSessionsApi.create.mockResolvedValue(
      makeSession({
        id: "sess-created",
        title: "sessions.untitledSession",
        lastMessagePreview: null,
      })
    );
    mockSessionsApi.rename.mockImplementation(async (id: string, title: string) =>
      makeSession({ id, title })
    );
    mockSessionsApi.setStatus.mockImplementation(async (id: string, status: string) =>
      makeSession({ id, status })
    );
    mockSessionsApi.delete.mockResolvedValue(undefined);
    mockAiApi.chatHistory.mockResolvedValue([]);
    mockContextEngineApi.inspect.mockResolvedValue(makeInspection());
    mockContextEngineApi.compress.mockResolvedValue(
      makeInspection({
        session: makeSession({
          contextState: "compressed",
          compressionState: "compressed",
          compressionCount: 1,
        }),
        usagePct: 12,
        totalTokens: 980,
      })
    );
  });

  it("renders loading skeletons, then session badges across healthy, approaching_limit, and compressed states", async () => {
    let resolveList!: (rows: ChatSession[]) => void;
    mockSessionsApi.list.mockReturnValueOnce(
      new Promise<ChatSession[]>((resolve) => {
        resolveList = resolve;
      })
    );

    const { onContinueSession } = renderPage({ activeSessionId: "default" });

    // Loading state shows skeletons before list resolves (also check Management tab skeleton)
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("sessions-tab-management"));
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("sessions-tab-conversations"));

    const sessions: ChatSession[] = [
      makeSession({
        id: "default",
        title: "sessions.defaultTitle",
        status: "active",
        contextState: "healthy",
        lastMessagePreview: "Latest reply preview",
      }),
      makeSession({
        id: "s-approach",
        title: "Sprint Planning",
        status: "active",
        contextState: "approaching_limit",
        semanticSummary: "Semantic summary fallback preview",
        lastMessagePreview: null,
        lastActivityAt: "not-a-valid-date-xyz",
      }),
      makeSession({
        id: "s-comp-active",
        title: "sessions.untitledSession",
        status: "active",
        contextState: "compressed",
        compressionCount: 2,
        lastActivityAt: "",
      }),
      makeSession({
        id: "s-comp-status",
        title: "   ",
        status: "compressed",
        contextState: "compressed",
        compressionCount: 3,
      }),
      makeSession({
        id: "s-archived",
        title: "Archived Thread",
        status: "archived",
        contextState: "healthy",
      }),
    ];

    await act(async () => {
      resolveList(sessions);
    });

    await waitFor(() => {
      expect(screen.getByTestId("sessions-conversations-list")).toBeInTheDocument();
    });

    const defaultCard = screen.getByTestId("session-card-default");
    expect(within(defaultCard).getByText("Aura Main Session")).toBeInTheDocument();
    expect(within(defaultCard).getByText("Session: Aura Main Session")).toBeInTheDocument();
    expect(within(defaultCard).getByText("Active")).toBeInTheDocument();
    expect(within(defaultCard).getByText("Latest reply preview")).toBeInTheDocument();
    expect(screen.getByTestId("session-delete-default")).toBeDisabled();

    const approachCard = screen.getByTestId("session-card-s-approach");
    expect(within(approachCard).getByText("Sprint Planning")).toBeInTheDocument();
    expect(within(approachCard).getByText("Approaching Limit")).toBeInTheDocument();
    expect(within(approachCard).getByText("Semantic summary fallback preview")).toBeInTheDocument();
    expect(within(approachCard).getByText("not-a-valid-date-xy")).toBeInTheDocument();
    expect(screen.getByTestId("session-delete-s-approach")).toBeEnabled();

    // Active status with compressed contextState shows extra Compressed badge
    const compActiveCard = screen.getByTestId("session-card-s-comp-active");
    expect(within(compActiveCard).getByText("New Aura conversation")).toBeInTheDocument();
    expect(within(compActiveCard).getByText("Compressed")).toBeInTheDocument();
    expect(within(compActiveCard).getByText("—")).toBeInTheDocument();

    // Blank title resolves to New Aura conversation; compressed status renders single Compressed badge
    const compStatusCard = screen.getByTestId("session-card-s-comp-status");
    expect(within(compStatusCard).getByText("New Aura conversation")).toBeInTheDocument();
    expect(within(compStatusCard).getAllByText("Compressed")).toHaveLength(1);

    const archivedCard = screen.getByTestId("session-card-s-archived");
    expect(within(archivedCard).getByText("Archived")).toBeInTheDocument();
    expect(within(archivedCard).getByText("Reactivate")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("session-continue-s-approach"));
    expect(onContinueSession).toHaveBeenCalledWith("s-approach");
  });

  it("supports search, status, and date filters plus empty states with and without active filters", async () => {
    mockSessionsApi.list.mockImplementation(
      async (query?: string | null, status?: string | null) => {
        if (query === "nothing" || status === "archived") {
          return [];
        }
        return [makeSession()];
      }
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("session-card-default")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("sessions-search-input"), {
      target: { value: "nothing" },
    });
    fireEvent.change(screen.getByTestId("sessions-status-select"), {
      target: { value: "archived" },
    });
    fireEvent.change(screen.getByTestId("sessions-date-from"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByTestId("sessions-date-to"), {
      target: { value: "2026-11-22" },
    });

    await waitFor(() => {
      expect(mockSessionsApi.list).toHaveBeenLastCalledWith(
        "nothing",
        "archived",
        "2026-11-01",
        "2026-11-22"
      );
      expect(
        screen.getByText("No conversations match the current filters.")
      ).toBeInTheDocument();
    });

    const clearButtons = screen.getAllByRole("button", { name: "Clear filters" });
    expect(clearButtons).toHaveLength(2);
    fireEvent.click(clearButtons[1]);

    await waitFor(() => {
      expect(mockSessionsApi.list).toHaveBeenLastCalledWith("", null, null, null);
      expect(screen.getByTestId("session-card-default")).toBeInTheDocument();
    });

    // Also verify filter bar X clear button resets filters cleanly
    mockSessionsApi.list.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByTestId("sessions-search-input"), {
      target: { value: "x" },
    });
    await waitFor(() => {
      expect(screen.getByText("No conversations match the current filters.")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => {
      expect(mockSessionsApi.list).toHaveBeenLastCalledWith("", null, null, null);
      expect(screen.getByTestId("session-card-default")).toBeInTheDocument();
    });
  });

  it("renders empty state without clear action when unfiltered sessions list is empty", async () => {
    mockSessionsApi.list.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("No conversations match the current filters.")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Clear filters" })
    ).not.toBeInTheDocument();
  });

  it("supports creating, renaming (save, empty guard, Escape, Cancel), archiving/reactivating, and deleting sessions", async () => {
    const second = makeSession({
      id: "s-work",
      title: "Work Stream",
      status: "active",
    });
    mockSessionsApi.list.mockResolvedValue([makeSession(), second]);

    const onActiveSessionDeleted = vi.fn();
    renderPage({
      activeSessionId: "s-work",
      onActiveSessionDeleted,
    });

    await waitFor(() => {
      expect(screen.getByTestId("session-card-s-work")).toBeInTheDocument();
    });

    // Create new session
    const createdSession = makeSession({
      id: "s-new",
      title: "sessions.untitledSession",
      status: "active",
    });
    mockSessionsApi.create.mockResolvedValueOnce(createdSession);
    fireEvent.click(screen.getByTestId("sessions-new-btn"));

    await waitFor(() => {
      expect(mockSessionsApi.create).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("session-card-s-new")).toBeInTheDocument();
    });

    // Rename: open, test empty guard, Escape cancel, button cancel, and valid save
    fireEvent.click(screen.getByTestId("session-rename-s-work"));
    const renameInput = screen.getByTestId("session-rename-input-s-work") as HTMLInputElement;
    expect(renameInput.value).toBe("Work Stream");

    fireEvent.change(renameInput, { target: { value: "   " } });
    expect(screen.getByTestId("session-rename-save-s-work")).toBeDisabled();
    fireEvent.submit(renameInput.closest("form")!);
    expect(mockSessionsApi.rename).not.toHaveBeenCalled();

    fireEvent.keyDown(renameInput, { key: "Escape" });
    expect(screen.queryByTestId("session-rename-input-s-work")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("session-rename-s-work"));
    fireEvent.click(screen.getByTestId("session-rename-cancel-s-work"));
    expect(screen.queryByTestId("session-rename-input-s-work")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("session-rename-s-work"));
    fireEvent.change(screen.getByTestId("session-rename-input-s-work"), {
      target: { value: "  Renamed Stream  " },
    });
    mockSessionsApi.rename.mockResolvedValueOnce(
      makeSession({ id: "s-work", title: "Renamed Stream", status: "active" })
    );
    fireEvent.click(screen.getByTestId("session-rename-save-s-work"));

    await waitFor(() => {
      expect(mockSessionsApi.rename).toHaveBeenCalledWith("s-work", "Renamed Stream");
      expect(within(screen.getByTestId("session-card-s-work")).getByText("Renamed Stream")).toBeInTheDocument();
    });

    // Archive and reactivate
    mockSessionsApi.setStatus.mockResolvedValueOnce(
      makeSession({ id: "s-work", title: "Renamed Stream", status: "archived" })
    );
    fireEvent.click(screen.getByTestId("session-status-s-work"));

    await waitFor(() => {
      expect(mockSessionsApi.setStatus).toHaveBeenCalledWith("s-work", "archived");
      expect(
        within(screen.getByTestId("session-card-s-work")).getByText("Reactivate")
      ).toBeInTheDocument();
    });

    mockSessionsApi.setStatus.mockResolvedValueOnce(
      makeSession({ id: "s-work", title: "Renamed Stream", status: "active" })
    );
    fireEvent.click(screen.getByTestId("session-status-s-work"));

    await waitFor(() => {
      expect(mockSessionsApi.setStatus).toHaveBeenCalledWith("s-work", "active");
    });

    // Select non-active session s-new, then delete it so selectedSessionId falls back to activeSessionId
    fireEvent.click(screen.getByTestId("session-select-s-new"));
    fireEvent.click(screen.getByTestId("session-delete-s-new"));
    await waitFor(() => {
      expect(mockSessionsApi.delete).toHaveBeenCalledWith("s-new");
      expect(screen.queryByTestId("session-card-s-new")).not.toBeInTheDocument();
    });

    // Delete active session while renaming it (exercises renaming cleanup & onActiveSessionDeleted)
    fireEvent.click(screen.getByTestId("session-select-s-work"));
    fireEvent.click(screen.getByTestId("session-rename-s-work"));
    fireEvent.click(screen.getByTestId("session-delete-s-work"));

    await waitFor(() => {
      expect(mockSessionsApi.delete).toHaveBeenCalledWith("s-work");
      expect(screen.queryByTestId("session-card-s-work")).not.toBeInTheDocument();
      expect(onActiveSessionDeleted).toHaveBeenCalledTimes(1);
    });
  });

  it("removes archived session from active-filtered list and handles mutation/load errors cleanly", async () => {
    mockSessionsApi.list.mockRejectedValueOnce(new Error("List backend offline"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("List backend offline");
    });

    // Recover with active filter and non-default session
    const s2 = makeSession({ id: "s-2", title: "Session Two", status: "active" });
    mockSessionsApi.list.mockResolvedValue([makeSession(), s2]);
    fireEvent.change(screen.getByTestId("sessions-status-select"), {
      target: { value: "active" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("session-card-s-2")).toBeInTheDocument();
    });

    // Create fails with non-Error rejection
    mockSessionsApi.create.mockRejectedValueOnce("create_failed_string");
    fireEvent.click(screen.getByTestId("sessions-new-btn"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("create_failed_string");
    });

    // Rename error
    mockSessionsApi.rename.mockRejectedValueOnce(new Error("Rename rejected"));
    fireEvent.click(screen.getByTestId("session-rename-s-2"));
    fireEvent.change(screen.getByTestId("session-rename-input-s-2"), {
      target: { value: "Bad Name" },
    });
    fireEvent.click(screen.getByTestId("session-rename-save-s-2"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Rename rejected");
    });
    fireEvent.click(screen.getByTestId("session-rename-cancel-s-2"));

    // Status error
    mockSessionsApi.setStatus.mockRejectedValueOnce(new Error("Status update error"));
    fireEvent.click(screen.getByTestId("session-status-s-2"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Status update error");
    });

    // Delete error
    mockSessionsApi.delete.mockRejectedValueOnce(new Error("Delete forbidden"));
    fireEvent.click(screen.getByTestId("session-delete-s-2"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Delete forbidden");
    });

    // Archiving s-2 under statusFilter="active" removes it from the visible list
    mockSessionsApi.setStatus.mockResolvedValueOnce(
      makeSession({ id: "s-2", title: "Session Two", status: "archived" })
    );
    fireEvent.click(screen.getByTestId("session-status-s-2"));
    await waitFor(() => {
      expect(screen.queryByTestId("session-card-s-2")).not.toBeInTheDocument();
    });
  });

  it("displays Management tab metadata, memories/tools badges, raw transcript, and history states", async () => {
    const richSession = makeSession({
      id: "default",
      title: "sessions.defaultTitle",
      contextState: "compressed",
      provider: "openai",
      model: "gpt-4o",
      associatedMemories: ["mem-firewall", "mem-dns"],
      toolsUsed: ["propose_create_task", "memory.hindsight_recall"],
      semanticSummary: "User configured BGP and Fortinet VPN tunnels.",
    });
    const bareSession = makeSession({
      id: "s-bare",
      title: "Bare Session",
      contextState: "healthy",
      provider: null,
      model: null,
      associatedMemories: [],
      toolsUsed: [],
      semanticSummary: "   ",
    });

    mockSessionsApi.list.mockResolvedValue([richSession, bareSession]);

    const historyMessages: PersistedChatMessage[] = [
      {
        id: "m1",
        sessionId: "default",
        role: "user",
        content: "Summarize network notes",
        createdAt: "2026-11-22T10:00:00.000Z",
      },
      {
        id: "m2",
        sessionId: "default",
        role: "assistant",
        content: "Here is the summary",
        createdAt: "2026-11-22T10:00:05.000Z",
      },
      {
        id: "m3",
        sessionId: "default",
        role: "system",
        content: "Policy injected",
        createdAt: "2026-11-22T10:00:06.000Z",
      },
    ];
    mockAiApi.chatHistory.mockResolvedValueOnce(historyMessages);

    renderPage({ activeSessionId: "default" });

    await waitFor(() => {
      expect(screen.getByTestId("session-card-default")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("sessions-tab-management"));

    await waitFor(() => {
      expect(screen.getByTestId("sessions-management-list")).toBeInTheDocument();
      expect(mockAiApi.chatHistory).toHaveBeenCalledWith(50, "default");
    });

    // Metadata panel assertions
    expect(screen.getByTestId("meta-session-id")).toHaveTextContent("default");
    expect(screen.getByTestId("meta-session-provider")).toHaveTextContent("openai · gpt-4o");
    expect(screen.getByTestId("meta-session-summary")).toHaveTextContent(
      "User configured BGP and Fortinet VPN tunnels."
    );
    const metaPanel = screen.getByTestId("session-metadata-panel");
    expect(within(metaPanel).getByText("mem-firewall")).toBeInTheDocument();
    expect(within(metaPanel).getByText("mem-dns")).toBeInTheDocument();
    expect(within(metaPanel).getByText("propose_create_task")).toBeInTheDocument();
    expect(within(metaPanel).getByText("memory.hindsight_recall")).toBeInTheDocument();

    // Transcript assertions (user, assistant, system roles)
    const transcript = await screen.findByTestId("meta-session-transcript");
    expect(within(transcript).getByText("You")).toBeInTheDocument();
    expect(within(transcript).getByText("Aura")).toBeInTheDocument();
    expect(within(transcript).getByText("system")).toBeInTheDocument();
    expect(within(transcript).getByText("Summarize network notes")).toBeInTheDocument();
    expect(within(transcript).getByText("Here is the summary")).toBeInTheDocument();
    expect(within(transcript).getByText("Policy injected")).toBeInTheDocument();

    // Switch to bareSession -> empty history
    mockAiApi.chatHistory.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByTestId("session-select-s-bare"));

    await waitFor(() => {
      expect(mockAiApi.chatHistory).toHaveBeenCalledWith(50, "s-bare");
      expect(screen.getByTestId("meta-session-id")).toHaveTextContent("s-bare");
    });
    expect(screen.getByTestId("meta-session-provider")).toHaveTextContent("—");
    expect(screen.getByTestId("meta-session-summary")).toHaveTextContent("—");
    expect(within(metaPanel).getByText("No records found in this view.")).toBeInTheDocument();

    // Switch back to default -> chatHistory error branch
    mockAiApi.chatHistory.mockRejectedValueOnce(new Error("Transcript query failed"));
    fireEvent.click(screen.getByTestId("session-select-default"));

    await waitFor(() => {
      expect(within(metaPanel).getByRole("alert")).toHaveTextContent(
        "Transcript query failed"
      );
    });
  });

  it("renders Management tab empty states when no sessions exist", async () => {
    mockSessionsApi.list.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("No conversations match the current filters.")
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("sessions-tab-management"));
    expect(
      screen.getAllByText("No conversations match the current filters.")
    ).toHaveLength(2);
  });

  it("exercises Context Engine tab: 7 layers, healthy/approaching_limit/compressed states, audit log, refresh/retry, and manual compression", async () => {
    const sessHealthy = makeSession({
      id: "default",
      title: "sessions.defaultTitle",
      contextState: "healthy",
      compressionCount: 0,
    });
    const sessApproaching = makeSession({
      id: "s-approach",
      title: "Heavy Investigation",
      contextState: "approaching_limit",
      compressionCount: 0,
      tokenBudget: 2048,
      estimatedTokens: 1300,
    });

    mockSessionsApi.list.mockResolvedValue([sessHealthy, sessApproaching]);

    const healthyInspection = makeInspection({
      session: sessHealthy,
      totalTokens: 1494,
      tokenBudget: 8192,
      usagePct: 18,
      totalHistoryMessages: 8,
      layers: [
        ...makeSevenLayers(),
        {
          kind: "custom_extra",
          label: "Custom Extension Layer",
          tokenCount: 16,
          itemCount: 1,
          preview: "",
        },
      ],
      events: [],
    });

    const approachingInspection = makeInspection({
      session: sessApproaching,
      totalTokens: 1300,
      tokenBudget: 2048,
      usagePct: 63,
      totalHistoryMessages: 12,
      layers: makeSevenLayers({
        session: {
          preview: "Older conversation summary",
          tokenCount: 150,
          itemCount: 1,
        },
        retrieved: {
          preview: "3 active_items",
          tokenCount: 120,
          itemCount: 3,
        },
        tool: {
          preview: "propose_create_task",
          tokenCount: 40,
          itemCount: 1,
        },
      }),
      events: [
        {
          id: "ev-1",
          sessionId: "s-approach",
          kind: "compression",
          reason: "autonomous_budget_guard",
          tokensBefore: 1600,
          tokensAfter: 880,
          messagesCompressed: 4,
          preservedMessageIds: ["m1", "m2", "m3"],
          retrievedMemoryIds: ["mem-1"],
          layers: [],
          createdAt: "2026-11-22T11:30:00.000Z",
        },
      ],
    });

    const compressedSession = makeSession({
      ...sessApproaching,
      contextState: "compressed",
      compressionState: "compressed",
      compressionCount: 1,
      estimatedTokens: 820,
    });
    const compressedInspection = makeInspection({
      session: compressedSession,
      totalTokens: 820,
      tokenBudget: 2048,
      usagePct: 40,
      totalHistoryMessages: 12,
      events: [
        {
          id: "ev-manual",
          sessionId: "s-approach",
          kind: "compression",
          reason: "manual_ui",
          tokensBefore: 1300,
          tokensAfter: 820,
          messagesCompressed: 8,
          preservedMessageIds: [],
          retrievedMemoryIds: [],
          layers: [],
          createdAt: "2026-11-22T12:05:00.000Z",
        },
      ],
    });

    mockContextEngineApi.inspect.mockResolvedValueOnce(healthyInspection);

    renderPage({ activeSessionId: "default" });

    await waitFor(() => {
      expect(screen.getByTestId("session-card-default")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("sessions-tab-context"));

    await waitFor(() => {
      expect(mockContextEngineApi.inspect).toHaveBeenCalledWith("default");
      expect(screen.getByTestId("context-engine-view")).toBeInTheDocument();
    });

    // Healthy state, progress gauge, and all 7 layers
    expect(screen.getByTestId("context-state-badge")).toHaveTextContent("Healthy");
    expect(screen.getByTestId("context-usage-pct")).toHaveTextContent("18%");
    expect(screen.getByTestId("context-history-count")).toHaveTextContent(
      "8 raw turns preserved in SQLite"
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "18");

    expect(within(screen.getByTestId("context-layer-system")).getByText("System Context")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-system")).getByText("Extra Aura persona instructions")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-user")).getByText("User Context")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-user")).getByText("No records found in this view.")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-session")).getByText("Session Summary")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-recent")).getByText("Recent Messages")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-retrieved")).getByText("Retrieved Memories")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-retrieved")).getByText("2 retrieved memories")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-working")).getByText("Working Workspace")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-working")).getByText("Tasks & Kanban · Pomodoro & Focus")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-tool")).getByText("Tool Context")).toBeInTheDocument();
    expect(within(screen.getByTestId("context-layer-tool")).getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText("No compression or retrieval events logged for this session yet.")
    ).toBeInTheDocument();

    // Switch session -> inspect rejects first, then Retry succeeds with approaching_limit
    mockContextEngineApi.inspect.mockRejectedValueOnce(new Error("Inspect timeout"));
    fireEvent.change(screen.getByTestId("context-session-select"), {
      target: { value: "s-approach" },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Inspect timeout");
    });

    mockContextEngineApi.inspect.mockResolvedValueOnce(approachingInspection);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("context-state-badge")).toHaveTextContent(
        "Approaching Limit"
      );
    });
    expect(screen.getByTestId("context-usage-pct")).toHaveTextContent("63%");
    expect(screen.getByTestId("context-events-list")).toBeInTheDocument();
    const ev1 = screen.getByTestId("context-event-ev-1");
    expect(within(ev1).getByText("autonomous budget guard")).toBeInTheDocument();
    expect(within(ev1).getByText("1600 → 880 tokens · 4 compressed turns")).toBeInTheDocument();
    expect(within(ev1).getByText("3 messages")).toBeInTheDocument();
    expect(within(ev1).getByText(/Associated memories: 1/)).toBeInTheDocument();

    // Compress failure displays alert
    mockContextEngineApi.compress.mockRejectedValueOnce(new Error("Compression failed"));
    fireEvent.click(screen.getByTestId("compress-context-btn"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Compression failed");
    });

    // Compress success updates ContextEngineView AND parent session card state
    mockContextEngineApi.compress.mockResolvedValueOnce(compressedInspection);
    fireEvent.click(screen.getByTestId("compress-context-btn"));

    await waitFor(() => {
      expect(mockContextEngineApi.compress).toHaveBeenLastCalledWith(
        "s-approach",
        "manual_ui"
      );
      expect(screen.getByTestId("context-state-badge")).toHaveTextContent("Compressed");
      expect(screen.getByTestId("context-usage-pct")).toHaveTextContent("40%");
      expect(screen.getByTestId("context-event-ev-manual")).toBeInTheDocument();
    });

    // Manual Refresh triggers inspect again (error branch then recovery)
    mockContextEngineApi.inspect.mockRejectedValueOnce(new Error("Refresh failed"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
    });

    mockContextEngineApi.inspect.mockResolvedValueOnce(compressedInspection);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(mockContextEngineApi.inspect).toHaveBeenLastCalledWith("s-approach");
    });

    // Switch back to Conversations tab -> s-approach card reflects updated compressionCount & Compressed badge
    fireEvent.click(screen.getByTestId("sessions-tab-conversations"));
    const updatedCard = screen.getByTestId("session-card-s-approach");
    expect(within(updatedCard).getByText("Compressed")).toBeInTheDocument();
    expect(within(updatedCard).getByText("1 compressions")).toBeInTheDocument();
  });
});
