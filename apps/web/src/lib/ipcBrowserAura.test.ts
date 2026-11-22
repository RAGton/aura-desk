import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "./auraTypes";
import type { HermesChatReply } from "./ipc";
import {
  handleAuraBrowserIpc,
  type BrowserAuraDeps,
  type BrowserAuraStateSlice,
} from "./ipcBrowserAura";

interface TestDb extends BrowserAuraStateSlice {}

function makeDb(overrides: Partial<TestDb> = {}): TestDb {
  return {
    tasks: [{ status: "todo", title: "Review firewall rules" }],
    reminders: [{ status: "pending", title: "Standup" }],
    alerts: [{ resolution: null, title: "Pending alert" }],
    proposals: [],
    settings: {
      "ai.provider": "openai",
      "ai.model": "gpt-4o-mini",
      "hindsight.default_bank": "aura-main",
      "raglight.folders": "/docs;/notes",
      "raglight.base_url": "http://127.0.0.1:9621",
    },
    chatSessions: [],
    chatMessages: [],
    contextEvents: [],
    agentToolPolicies: {},
    agentRuns: [],
    ...overrides,
  };
}

function makeHarness(initialDb?: Partial<TestDb>) {
  const db = makeDb(initialDb);
  let seq = 0;
  const saveBrowserDb = vi.fn();
  const runBrowserHermesPrompt = vi.fn(
    (_targetDb: TestDb, prompt: string, _nowIso: string): HermesChatReply => {
      const lower = prompt.toLowerCase();
      if (lower.startsWith("create task:")) {
        return {
          requestId: `req-${++seq}`,
          mode: "local",
          replyText: `Proposal created for ${prompt}`,
          proposal: {
            id: `prop-${++seq}`,
            source: "hermes",
            kind: "create_task",
            payload: { title: prompt.slice(12).trim() },
            summary: "Create task",
            status: "pending",
            created_at: "2026-11-22T12:00:00.000Z",
            expires_at: "2026-11-23T12:00:00.000Z",
          },
          streaming: false,
        };
      }
      if (lower.startsWith("remind me:")) {
        return {
          requestId: `req-${++seq}`,
          mode: "local",
          replyText: "Reminder proposal created",
          proposal: {
            id: `prop-${++seq}`,
            source: "hermes",
            kind: "create_reminder",
            payload: { title: prompt.slice(10).trim() },
            summary: "Create reminder",
            status: "pending",
            created_at: "2026-11-22T12:00:00.000Z",
            expires_at: "2026-11-23T12:00:00.000Z",
          },
          streaming: false,
        };
      }
      return {
        requestId: `req-${++seq}`,
        mode: "local",
        replyText: "Ack: processed offline reply.",
        proposal: null,
        streaming: false,
      };
    }
  );

  const call = async (
    cmd: string,
    args: Record<string, unknown> = {},
    nowIso = "2026-11-22T12:00:00.000Z"
  ) => {
    const deps: BrowserAuraDeps<TestDb> = {
      db,
      args,
      nowIso,
      genId: () => `id-${++seq}`,
      saveBrowserDb,
      runBrowserHermesPrompt,
    };
    return handleAuraBrowserIpc(cmd, deps);
  };

  return { db, saveBrowserDb, runBrowserHermesPrompt, call };
}

function makeJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe("ipcBrowserAura (handleAuraBrowserIpc)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("returns handled: false for unrelated commands", async () => {
    const { call } = makeHarness();
    const res = await call("tasks_list");
    expect(res).toEqual({ handled: false });
  });

  describe("chat sessions & message history", () => {
    it("creates, lists with query/status/date filters, retrieves, renames, updates status, and deletes sessions", async () => {
      const { db, saveBrowserDb, call } = makeHarness();

      // Create sessions with and without explicit title
      const createdRes = await call(
        "chat_sessions_create",
        { title: "  Network Audit  " },
        "2026-11-15T09:00:00.000Z"
      );
      expect(createdRes.handled).toBe(true);
      const s1 = (createdRes as { handled: true; result: ChatSession }).result;
      expect(s1.title).toBe("Network Audit");
      expect(s1.provider).toBe("openai");
      expect(s1.model).toBe("gpt-4o-mini");
      expect(saveBrowserDb).toHaveBeenCalledTimes(1);

      const untitledRes = await call(
        "chat_sessions_create",
        { title: "   " },
        "2026-11-21T11:00:00.000Z"
      );
      const s2 = (untitledRes as { handled: true; result: ChatSession }).result;
      expect(s2.title).toBe("sessions.untitledSession");

      // Adjust timestamps & summary & message to exercise all list filters and sorting
      s1.lastActivityAt = "2026-11-16T10:00:00.000Z";
      s1.semanticSummary = "FortiGate IPSec tunnel debugging";
      s2.lastActivityAt = "2026-11-22T15:00:00.000Z";
      s2.lastMessagePreview = "Reviewed BGP route table";
      db.chatMessages!.push({
        id: "msg-match",
        sessionId: s1.id,
        role: "user",
        content: "Check fortios firmware",
        createdAt: "2026-11-15T09:05:00.000Z",
      });

      // Rename s2 and archive s1
      const renamed = await call(
        "chat_sessions_rename",
        { sessionId: s2.id, title: "BGP Review" },
        "2026-11-22T15:05:00.000Z"
      );
      expect((renamed as { handled: true; result: ChatSession }).result.title).toBe("BGP Review");

      const archived = await call(
        "chat_sessions_set_status",
        { sessionId: s1.id, status: "archived" },
        "2026-11-22T15:06:00.000Z"
      );
      expect((archived as { handled: true; result: ChatSession }).result.status).toBe("archived");

      // Get existing & missing session
      const fetched = await call("chat_sessions_get", { sessionId: s1.id });
      expect((fetched as { handled: true; result: ChatSession | null }).result?.id).toBe(s1.id);
      const missing = await call("chat_sessions_get", { sessionId: "does-not-exist" });
      expect((missing as { handled: true; result: ChatSession | null }).result).toBeNull();

      // List all: sorted descending by lastActivityAt
      const allList = (await call("chat_sessions_list", { status: "all" })) as {
        handled: true;
        result: ChatSession[];
      };
      expect(allList.result.map((s) => s.id)).toEqual([s2.id, s1.id, "default"]);

      // Query matching message content (on s1)
      const byMsgQuery = (await call("chat_sessions_list", { query: "FIRMWARE" })) as {
        handled: true;
        result: ChatSession[];
      };
      expect(byMsgQuery.result.map((s) => s.id)).toEqual([s1.id]);

      // Query matching semantic summary (on s1) & lastMessagePreview (on s2)
      const bySummary = (await call("chat_sessions_list", { query: "ipsec" })) as {
        handled: true;
        result: ChatSession[];
      };
      expect(bySummary.result.map((s) => s.id)).toEqual([s1.id]);

      const byPreview = (await call("chat_sessions_list", { query: "route table" })) as {
        handled: true;
        result: ChatSession[];
      };
      expect(byPreview.result.map((s) => s.id)).toEqual([s2.id]);

      // Status filter
      const archivedOnly = (await call("chat_sessions_list", { status: "archived" })) as {
        handled: true;
        result: ChatSession[];
      };
      expect(archivedOnly.result.map((s) => s.id)).toEqual([s1.id]);

      // Date range filters
      const dateFiltered = (await call("chat_sessions_list", {
        dateFrom: "2026-11-18",
        dateTo: "2026-11-21",
      })) as { handled: true; result: ChatSession[] };
      expect(dateFiltered.result.map((s) => s.id)).toEqual([s2.id]);

      // Rename/setStatus error on missing session
      await expect(
        call("chat_sessions_rename", { sessionId: "missing", title: "X" })
      ).rejects.toThrow(/session_not_found/);
      await expect(
        call("chat_sessions_set_status", { sessionId: "missing", status: "archived" })
      ).rejects.toThrow(/session_not_found/);

      // Cannot delete default session
      await expect(call("chat_sessions_delete", { sessionId: "default" })).rejects.toThrow(
        /cannot delete default session/
      );

      // Delete s1 cascades chatMessages & contextEvents
      db.contextEvents!.push({
        id: "ev-s1",
        sessionId: s1.id,
        kind: "compression",
        reason: "manual",
        tokensBefore: 500,
        tokensAfter: 250,
        messagesCompressed: 2,
        preservedMessageIds: [],
        retrievedMemoryIds: [],
        layers: [],
        createdAt: "2026-11-22T12:00:00.000Z",
      });
      await call("chat_sessions_delete", { sessionId: s1.id });
      expect(db.chatSessions!.some((s) => s.id === s1.id)).toBe(false);
      expect(db.chatMessages!.some((m) => m.sessionId === s1.id)).toBe(false);
      expect(db.contextEvents!.some((e) => e.sessionId === s1.id)).toBe(false);
    });

    it("lists scoped chat history with limit and clears session messages", async () => {
      const { db, call } = makeHarness({
        chatMessages: [
          {
            id: "m1",
            sessionId: "default",
            role: "user",
            content: "one",
            createdAt: "2026-11-22T10:00:00.000Z",
          },
          {
            id: "m2",
            sessionId: "default",
            role: "assistant",
            content: "two",
            createdAt: "2026-11-22T10:01:00.000Z",
          },
          {
            id: "m3",
            sessionId: "other",
            role: "user",
            content: "three",
            createdAt: "2026-11-22T10:02:00.000Z",
          },
        ],
      });

      const hist = (await call("ai_chat_history", {
        sessionId: "default",
        limit: 1,
      })) as { handled: true; result: Array<{ id: string }> };
      expect(hist.result.map((m) => m.id)).toEqual(["m2"]);

      const cleared = (await call("ai_chat_clear", { sessionId: "default" })) as {
        handled: true;
        result: number;
      };
      expect(cleared.result).toBe(2);
      expect(db.chatMessages).toHaveLength(1);
      expect(db.chatMessages![0].sessionId).toBe("other");
    });
  });

  describe("hermes_chat_send & autonomous context engine", () => {
    it("rejects empty prompts and records toolsUsed when proposals are generated", async () => {
      const { db, call } = makeHarness();

      await expect(call("hermes_chat_send", { prompt: "   " })).rejects.toThrow(
        /prompt is required/
      );

      await call("hermes_chat_send", { prompt: "create task: Harden SSH config" });
      await call("hermes_chat_send", { prompt: "remind me: Rotate keys" });

      const defSess = db.chatSessions!.find((s) => s.id === "default")!;
      expect(defSess.messageCount).toBe(4);
      expect(defSess.contextState).toBe("healthy");
      expect(defSess.toolsUsed).toEqual(["propose_create_task", "propose_create_reminder"]);
    });

    it("tracks approaching_limit and triggers autonomous compression when tokenBudget is 1024 with > 6 messages while preserving raw history", async () => {
      const lowBudgetSession: ChatSession = {
        id: "sess-low",
        title: "Low Budget Session",
        status: "active",
        semanticSummary: "",
        contextState: "healthy",
        compressionState: "none",
        compressionCount: 0,
        estimatedTokens: 0,
        tokenBudget: 1024,
        model: "gpt-4o-mini",
        provider: "openai",
        associatedMemories: ["mem-1"],
        toolsUsed: [],
        messageCount: 0,
        lastMessagePreview: null,
        createdAt: "2026-11-22T09:00:00.000Z",
        updatedAt: "2026-11-22T09:00:00.000Z",
        lastActivityAt: "2026-11-22T09:00:00.000Z",
      };

      // Pre-seed 5 messages (~600 chars = ~150 tok each -> 4*150 = 600 tok on last 4, within approaching range before send or compressed after 7th)
      const seedMsgs = Array.from({ length: 5 }, (_, idx) => ({
        id: `seed-${idx + 1}`,
        sessionId: "sess-low",
        role: (idx % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Turn ${idx + 1}: ` + "A".repeat(580),
        createdAt: `2026-11-22T10:0${idx}:00.000Z`,
      }));

      const { db, call } = makeHarness({
        chatSessions: [lowBudgetSession],
        chatMessages: seedMsgs,
      });

      // Send a medium prompt first with only 3 messages in a separate session to hit approaching_limit (ratio >= 0.55 && < 0.72)
      const approachSession: ChatSession = {
        ...lowBudgetSession,
        id: "sess-approach",
        associatedMemories: [],
      };
      db.chatSessions!.push(approachSession);
      await call("hermes_chat_send", {
        sessionId: "sess-approach",
        prompt: "X".repeat(2350), // ~588 tokens + overhead ~610 / 1024 ~= 0.595
      });
      expect(approachSession.contextState).toBe("approaching_limit");
      expect(approachSession.compressionCount).toBe(0);

      // Now send on sess-low: 5 seed + 2 new = 7 messages (> 6), recent 6 exceed 0.72 * 1024
      await call("hermes_chat_send", {
        sessionId: "sess-low",
        prompt: "Final heavy turn: " + "B".repeat(700),
      });

      expect(lowBudgetSession.compressionCount).toBe(1);
      expect(lowBudgetSession.compressionState).toBe("compressed");
      expect(lowBudgetSession.contextState).toBe("compressed");
      expect(lowBudgetSession.semanticSummary).toContain("Turn 1:");
      expect(lowBudgetSession.messageCount).toBe(7);

      // Raw messages MUST remain preserved in db.chatMessages
      const preserved = db.chatMessages!.filter((m) => m.sessionId === "sess-low");
      expect(preserved).toHaveLength(7);

      const events = db.contextEvents!.filter((e) => e.sessionId === "sess-low");
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("compression");
      expect(events[0].reason).toBe("autonomous_budget_guard");
      expect(events[0].messagesCompressed).toBe(1);
      expect(events[0].preservedMessageIds).toEqual(["seed-1"]);
      expect(events[0].retrievedMemoryIds).toEqual(["mem-1"]);

      // Subsequent send below compress ratio preserves compressed contextState when compressionCount > 0
      const compressedShortSess: ChatSession = {
        ...lowBudgetSession,
        id: "sess-already-compressed",
        compressionCount: 1,
        compressionState: "compressed",
        contextState: "compressed",
      };
      db.chatSessions!.push(compressedShortSess);
      await call("hermes_chat_send", {
        sessionId: "sess-already-compressed",
        prompt: "Quick follow-up",
      });
      expect(compressedShortSess.contextState).toBe("compressed");
    });

    it("inspects 7 context layers and manually compresses older turns while preserving raw messages", async () => {
      const seedMessages = Array.from({ length: 7 }, (_, i) => ({
        id: `raw-${i + 1}`,
        sessionId: "default",
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Conversation message number ${i + 1} with detailed architecture notes.`,
        createdAt: `2026-11-22T11:0${i}:00.000Z`,
      }));
      const { db, saveBrowserDb, call } = makeHarness({
        chatMessages: seedMessages,
      });

      const inspectRes = (await call("context_engine_inspect", {
        sessionId: "default",
      })) as {
        handled: true;
        result: {
          layers: Array<{ kind: string; tokenCount: number; itemCount: number }>;
          totalTokens: number;
          tokenBudget: number;
          usagePct: number;
          totalHistoryMessages: number;
          events: unknown[];
        };
      };

      expect(inspectRes.handled).toBe(true);
      expect(inspectRes.result.layers.map((l) => l.kind)).toEqual([
        "system",
        "user",
        "session",
        "recent",
        "retrieved",
        "working",
        "tool",
      ]);
      expect(inspectRes.result.totalHistoryMessages).toBe(7);
      expect(inspectRes.result.tokenBudget).toBe(8192);
      expect(inspectRes.result.totalTokens).toBeGreaterThan(0);

      const compressRes = (await call("context_engine_compress", {
        sessionId: "default",
        reason: "manual_ui",
      })) as {
        handled: true;
        result: {
          session: ChatSession;
          totalHistoryMessages: number;
          events: Array<{
            reason: string;
            messagesCompressed: number;
            preservedMessageIds: string[];
          }>;
        };
      };

      expect(compressRes.result.session.compressionCount).toBe(1);
      expect(compressRes.result.session.contextState).toBe("compressed");
      expect(compressRes.result.session.compressionState).toBe("compressed");
      expect(compressRes.result.session.semanticSummary).toContain(
        "Conversation message number 1"
      );
      expect(compressRes.result.totalHistoryMessages).toBe(7);
      expect(compressRes.result.events).toHaveLength(1);
      expect(compressRes.result.events[0].reason).toBe("manual_ui");
      expect(compressRes.result.events[0].messagesCompressed).toBe(3); // 7 - 4
      expect(compressRes.result.events[0].preservedMessageIds).toEqual([
        "raw-1",
        "raw-2",
        "raw-3",
      ]);
      expect(db.chatMessages).toHaveLength(7);
      expect(saveBrowserDb).toHaveBeenCalled();
    });
  });

  describe("agents hub, tool policies, and plan preview", () => {
    it("returns 8 agents, 12 tools with policy overrides, and pending proposal count", async () => {
      const { call } = makeHarness({
        agentToolPolicies: {
          "memory.hindsight_recall": { permission: "deny", enabled: false },
        },
        proposals: [
          {
            id: "p1",
            source: "hermes",
            kind: "create_task",
            payload: {},
            summary: "Pending 1",
            status: "pending",
            created_at: "2026-11-22T10:00:00.000Z",
            expires_at: "2026-11-23T10:00:00.000Z",
          },
          {
            id: "p2",
            source: "hermes",
            kind: "create_task",
            payload: {},
            summary: "Approved 1",
            status: "approved",
            created_at: "2026-11-22T10:00:00.000Z",
            expires_at: "2026-11-23T10:00:00.000Z",
          },
        ],
      });

      const res = (await call("agents_overview")) as {
        handled: true;
        result: {
          agents: Array<{ role: string }>;
          tools: Array<{ toolName: string; permission: string; enabled: boolean }>;
          pendingProposals: number;
        };
      };

      expect(res.handled).toBe(true);
      expect(res.result.agents).toHaveLength(8);
      expect(res.result.tools).toHaveLength(12);
      expect(res.result.pendingProposals).toBe(1);
      const recalled = res.result.tools.find(
        (t) => t.toolName === "memory.hindsight_recall"
      )!;
      expect(recalled.permission).toBe("deny");
      expect(recalled.enabled).toBe(false);
    });

    it("enforces security policy blocking allow on privileged/destructive tools while allowing deny", async () => {
      const { db, saveBrowserDb, call } = makeHarness();

      await expect(
        call("agents_set_tool_policy", {
          toolName: "nonexistent.tool",
          permission: "allow",
          enabled: true,
        })
      ).rejects.toThrow(/tool not found/);

      await expect(
        call("agents_set_tool_policy", {
          toolName: "system.run_shell_command",
          permission: "allow",
          enabled: true,
        })
      ).rejects.toThrow(/security policy prevents auto-allowing destructive tool/);

      await expect(
        call("agents_set_tool_policy", {
          toolName: "browser.navigate",
          permission: "allow",
          enabled: true,
        })
      ).rejects.toThrow(/security policy prevents auto-allowing privileged tool/);

      const deniedShell = (await call("agents_set_tool_policy", {
        toolName: "system.run_shell_command",
        permission: "deny",
        enabled: false,
      })) as {
        handled: true;
        result: { toolName: string; permission: string; enabled: boolean };
      };
      expect(deniedShell.result.permission).toBe("deny");
      expect(deniedShell.result.enabled).toBe(false);
      expect(db.agentToolPolicies!["system.run_shell_command"]).toEqual({
        permission: "deny",
        enabled: false,
      });

      const allowedRead = (await call("agents_set_tool_policy", {
        toolName: "memory.hindsight_recall",
        permission: "allow",
        enabled: true,
      })) as {
        handled: true;
        result: { permission: string };
      };
      expect(allowedRead.result.permission).toBe("allow");
      expect(saveBrowserDb).toHaveBeenCalledTimes(2);
    });

    it("generates safe and guarded plans for doc, browser, screen, and shell keywords", async () => {
      const { db, call } = makeHarness();

      await expect(call("agents_plan_preview", { goal: "   " })).rejects.toThrow(
        /goal cannot be empty/
      );

      // Safe-only plan (2 base steps)
      const safePlan = (await call("agents_plan_preview", {
        goal: "Summarize today priorities",
        sessionId: "default",
      })) as {
        handled: true;
        result: {
          status: string;
          resultSummary: string;
          plan: Array<{ toolName: string; requiresApproval: boolean }>;
        };
      };
      expect(safePlan.result.status).toBe("planned");
      expect(safePlan.result.resultSummary).toBe("planned_steps:2:safe_only");
      expect(safePlan.result.plan.map((s) => s.toolName)).toEqual([
        "memory.hindsight_recall",
        "context.compress_session",
      ]);

      // Full multi-agent guarded plan (doc + browser + screen + shell)
      const guardedPlan = (await call("agents_plan_preview", {
        goal: "Read doc notes, open browser site, capture screen window, and run shell command",
        sessionId: "default",
      })) as {
        handled: true;
        result: {
          status: string;
          resultSummary: string;
          plan: Array<{ step: number; agentRole: string; toolName: string; requiresApproval: boolean }>;
        };
      };

      expect(guardedPlan.result.status).toBe("awaiting_approval");
      expect(guardedPlan.result.resultSummary).toBe("planned_steps:6:approval_required");
      expect(guardedPlan.result.plan.map((s) => s.toolName)).toEqual([
        "memory.hindsight_recall",
        "context.compress_session",
        "research.knowledge_query",
        "browser.navigate",
        "computer.capture_screen",
        "system.run_shell_command",
      ]);
      expect(guardedPlan.result.plan[2].requiresApproval).toBe(false);
      expect(guardedPlan.result.plan[3].requiresApproval).toBe(true);
      expect(guardedPlan.result.plan[4].requiresApproval).toBe(true);
      expect(guardedPlan.result.plan[5].requiresApproval).toBe(true);
      expect(db.agentRuns).toHaveLength(2);
    });
  });

  describe("hindsight & knowledge offline branches in MODE === 'test'", () => {
    it("returns honest offline payloads for proxy-gated hindsight and knowledge commands without calling fetch", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const { call } = makeHarness();

      const status = (await call("hindsight_status")) as {
        handled: true;
        result: { online: boolean; banks: string[]; defaultBank: string };
      };
      expect(status.result.online).toBe(false);
      expect(status.result.defaultBank).toBe("aura-main");

      expect(await call("hindsight_recall", { query: "dns" })).toEqual({
        handled: true,
        result: [],
      });
      expect(await call("hindsight_banks_list")).toEqual({
        handled: true,
        result: [],
      });

      const stats = (await call("hindsight_bank_stats", { bank: "aura-main" })) as {
        handled: true;
        result: { bankId: string; totalNodes: number };
      };
      expect(stats.result.bankId).toBe("aura-main");
      expect(stats.result.totalNodes).toBe(0);

      expect(
        await call("hindsight_memories_list", { bank: "aura-main", limit: 20, offset: 5 })
      ).toEqual({
        handled: true,
        result: { items: [], total: 0, limit: 20, offset: 5 },
      });

      expect(await call("hindsight_graph", { bank: "aura-main" })).toEqual({
        handled: true,
        result: { nodes: [], edges: [], totalUnits: 0 },
      });

      expect(await call("hindsight_global_search", { query: "bgp" })).toEqual({
        handled: true,
        result: [],
      });

      expect(await call("hindsight_galaxy_snapshot")).toEqual({
        handled: true,
        result: {
          online: false,
          banks: [],
          globes: [],
          links: [],
          totalRealNodes: 0,
        },
      });

      const kOverview = (await call("knowledge_overview")) as {
        handled: true;
        result: {
          serviceKind: string;
          online: boolean;
          configuredFolders: string[];
          diagnosticMessage: string;
        };
      };
      expect(kOverview.result.serviceKind).toBe("offline");
      expect(kOverview.result.online).toBe(false);
      expect(kOverview.result.configuredFolders).toEqual(["/docs", "/notes"]);
      expect(kOverview.result.diagnosticMessage).toContain("lightrag_offline");

      const kDocs = (await call("knowledge_documents_list")) as {
        handled: true;
        result: { online: boolean; documents: unknown[]; serviceKind: string };
      };
      expect(kDocs.result.online).toBe(false);
      expect(kDocs.result.documents).toEqual([]);

      await expect(
        call("knowledge_document_get", { docId: "doc-1" })
      ).rejects.toThrow(/lightrag_offline/);

      const kGraph = (await call("knowledge_graph")) as {
        handled: true;
        result: { online: boolean; entities: unknown[]; relations: unknown[] };
      };
      expect(kGraph.result.online).toBe(false);
      expect(kGraph.result.entities).toEqual([]);

      const kSearch = (await call("knowledge_search", { query: "firewall" })) as {
        handled: true;
        result: { online: boolean; serviceKind: string; answer: string };
      };
      expect(kSearch.result.online).toBe(false);
      expect(kSearch.result.serviceKind).toBe("offline");

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("hindsight detail & page normalizers with mocked fetch", () => {
    it("normalizes hindsight_memory_get, hindsight_memory_history, hindsight_documents_list, hindsight_document_get, hindsight_entities_list, hindsight_entity_get, and hindsight_mental_models", async () => {
      vi.stubEnv("MODE", "development");
      vi.stubEnv("VITEST", "");
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith("/memories/mem-1/history")) {
          return makeJsonResponse([
            {
              id: "h1",
              text: "Old version",
              changed_at: "2026-11-20T10:00:00Z",
              action: "updated",
            },
          ]);
        }
        if (url.endsWith("/memories/mem-1")) {
          return makeJsonResponse({
            id: "mem-1",
            text: "Primary BGP policy",
            context: "network",
            date: "2026-11-21",
            type: "world",
            document_id: "doc-9",
            entities: "FortiGate, BGP",
            tags: ["infra", "routing"],
            source_memory_ids: ["src-1"],
            source_memories: [
              { id: "src-1", content: "Original excerpt", fact_type: "experience" },
            ],
            history: [{ id: "mh-1", text: "Initial", action: "created" }],
          });
        }
        if (url.includes("/documents/doc-9")) {
          return makeJsonResponse({
            id: "doc-9",
            bank_id: "aura-main",
            original_text: "Full router config",
            content_hash: "sha256-abc",
            memory_unit_count: 5,
            nodes_by_fact_type: { world: 5 },
            tags: "core, bgp",
            retain_params: { context: "router-runbook" },
            document_metadata: { author: "netops" },
          });
        }
        if (url.includes("/documents?")) {
          return makeJsonResponse({
            items: [
              {
                id: "doc-9",
                bank_id: "aura-main",
                text_length: 1200,
                memory_unit_count: 5,
                retain_params: { context: "router-runbook" },
                tags: ["core"],
              },
            ],
            total: 1,
            limit: 10,
            offset: 0,
          });
        }
        if (url.includes("/entities/ent-1")) {
          return makeJsonResponse({
            id: "ent-1",
            canonical_name: "FortiGate",
            mention_count: 14,
            observations: [{ text: "Handles IPSec", mentioned_at: "2026-11-22" }],
          });
        }
        if (url.includes("/entities?")) {
          return makeJsonResponse({
            items: [
              {
                id: "ent-1",
                canonical_name: "FortiGate",
                mention_count: 14,
                first_seen: "2026-11-01",
                last_seen: "2026-11-22",
              },
            ],
            total: 1,
            limit: 15,
            offset: 0,
          });
        }
        if (url.includes("/mental-models")) {
          return makeJsonResponse({
            items: [
              {
                id: "mm-1",
                bank_id: "aura-main",
                name: "Edge Topology",
                source_query: "firewall topology",
                content: "Dual ISP failover",
                tags: ["network"],
                is_stale: true,
              },
            ],
            total: 1,
            limit: 20,
          });
        }
        return makeJsonResponse({}, 404);
      });

      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { call } = makeHarness();

      const memDetail = (await call("hindsight_memory_get", {
        bank: "aura-main",
        memoryId: "mem-1",
      })) as { handled: true; result: { entities: string[]; sourceMemories: unknown[]; history: unknown[] } };
      expect(memDetail.result.entities).toEqual(["FortiGate", "BGP"]);
      expect(memDetail.result.sourceMemories).toHaveLength(1);
      expect(memDetail.result.history).toHaveLength(1);

      const memHist = (await call("hindsight_memory_history", {
        bank: "aura-main",
        memoryId: "mem-1",
      })) as { handled: true; result: Array<{ action: string }> };
      expect(memHist.result[0].action).toBe("updated");

      // Also verify object { history: [...] } wrapper shape
      globalThis.fetch = vi.fn(async () =>
        makeJsonResponse({
          history: [{ id: "h2", text: "Wrapped", created_at: "2026-11-21T00:00:00Z", action: "created" }],
        })
      ) as unknown as typeof fetch;
      const wrappedHist = (await call("hindsight_memory_history", {
        bank: "aura-main",
        memoryId: "mem-1",
      })) as { handled: true; result: Array<{ id: string; action: string }> };
      expect(wrappedHist.result[0]).toMatchObject({ id: "h2", action: "created" });

      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const docs = (await call("hindsight_documents_list", {
        bank: "aura-main",
        query: "router",
        limit: 10,
        offset: 0,
      })) as { handled: true; result: { items: Array<{ id: string; context: string }>; total: number } };
      expect(docs.result.total).toBe(1);
      expect(docs.result.items[0].context).toBe("router-runbook");

      const docDetail = (await call("hindsight_document_get", {
        bank: "aura-main",
        documentId: "doc-9",
      })) as { handled: true; result: { originalText: string; tags: string[] } };
      expect(docDetail.result.originalText).toBe("Full router config");
      expect(docDetail.result.tags).toEqual(["core", "bgp"]);

      const entities = (await call("hindsight_entities_list", {
        bank: "aura-main",
        limit: 15,
      })) as { handled: true; result: { items: Array<{ canonicalName: string; mentionCount: number }> } };
      expect(entities.result.items[0].canonicalName).toBe("FortiGate");
      expect(entities.result.items[0].mentionCount).toBe(14);

      const entityDetail = (await call("hindsight_entity_get", {
        bank: "aura-main",
        entityId: "ent-1",
      })) as { handled: true; result: { observations: Array<{ text: string }> } };
      expect(entityDetail.result.observations[0].text).toBe("Handles IPSec");

      const models = (await call("hindsight_mental_models", {
        bank: "aura-main",
        limit: 20,
      })) as { handled: true; result: { items: Array<{ name: string; isStale: boolean }> } };
      expect(models.result.items[0]).toMatchObject({ name: "Edge Topology", isStale: true });

      // Non-OK HTTP status raises error
      globalThis.fetch = vi.fn(async () => makeJsonResponse({}, 502)) as unknown as typeof fetch;
      await expect(
        call("hindsight_memory_get", { bank: "aura-main", memoryId: "mem-1" })
      ).rejects.toThrow(/HTTP 502/);
    });
  });

  describe("online hindsight & knowledge normalizers (with proxy fetch enabled via stubbed env)", () => {
    it("normalizes hindsight_status, hindsight_recall, hindsight_banks_list, hindsight_bank_stats, hindsight_memories_list, hindsight_graph, hindsight_global_search, and hindsight_galaxy_snapshot", async () => {
      vi.stubEnv("MODE", "development");
      vi.stubEnv("VITEST", "");

      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/__hindsight/v1/default/banks") {
          return makeJsonResponse({
            banks: [
              { bank_id: "aura-main", name: "Aura Main" },
              { bank_id: "sec-ops", name: "SecOps" },
            ],
          });
        }
        if (url === "/__hindsight/v1/default/banks/aura-main/stats") {
          return makeJsonResponse({
            bank_id: "aura-main",
            total_nodes: 42,
            total_links: 18,
            total_documents: 6,
            nodes_by_fact_type: { world: 30, experience: 12 },
            links_by_link_type: { entity: 18 },
            pending_operations: 1,
          });
        }
        if (url === "/__hindsight/v1/default/banks/sec-ops/stats") {
          return makeJsonResponse({}, 500);
        }
        if (url.includes("/banks/aura-main/memories/list")) {
          return makeJsonResponse({
            items: [
              {
                id: "m-shared",
                text: "Shared DNS rule\nLine two",
                context: "dns",
                fact_type: "world",
                entities: ["DNS"],
                tags: ["net"],
                proof_count: 3,
              },
              {
                id: "m-2",
                content: "Secondary fact",
                type: "opinion",
              },
            ],
            total: 2,
            limit: 25,
            offset: 0,
          });
        }
        if (url.includes("/banks/sec-ops/memories/list")) {
          return makeJsonResponse({
            items: [
              { id: "m-shared", text: "Duplicate across banks" },
              { id: "m-sec", text: "Firewall port check", fact_type: "world" },
            ],
          });
        }
        if (url.includes("/banks/aura-main/graph")) {
          return makeJsonResponse({
            nodes: [
              {
                data: {
                  id: "n1",
                  label: "DNS",
                  text: "DNS resolver",
                  entities: ["DNS"],
                  color: "#38bdf8",
                },
              },
            ],
            edges: [
              {
                data: {
                  id: "e1",
                  source: "n1",
                  target: "n2",
                  link_type: "entity",
                  weight: 0.9,
                  entity_name: "DNS",
                },
              },
            ],
            total_units: 12,
          });
        }
        if (url.includes("/banks/sec-ops/graph")) {
          return makeJsonResponse({}, 503);
        }
        return makeJsonResponse({}, 404);
      });

      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { call } = makeHarness();

      const statusRes = (await call("hindsight_status")) as {
        handled: true;
        result: { online: boolean; banks: string[]; defaultBank: string };
      };
      expect(statusRes.result.online).toBe(true);
      expect(statusRes.result.banks).toEqual(["aura-main", "sec-ops"]);

      const recallRes = (await call("hindsight_recall", {
        query: "DNS",
        bank: "aura-main",
        limit: 5,
      })) as { handled: true; result: Array<{ id: string; source: string }> };
      expect(recallRes.result).toHaveLength(2);
      expect(recallRes.result[0].source).toBe("hindsight_http");

      const banksRes = (await call("hindsight_banks_list")) as {
        handled: true;
        result: Array<{ id: string; totalNodes: number }>;
      };
      expect(banksRes.result).toEqual([
        { id: "aura-main", name: "Aura Main", totalNodes: 42, totalLinks: 18, totalDocuments: 6 },
        { id: "sec-ops", name: "SecOps", totalNodes: 0, totalLinks: 0, totalDocuments: 0 },
      ]);

      const statsRes = (await call("hindsight_bank_stats", { bank: "aura-main" })) as {
        handled: true;
        result: { totalNodes: number; pendingOperations: number };
      };
      expect(statsRes.result.totalNodes).toBe(42);
      expect(statsRes.result.pendingOperations).toBe(1);

      const memPage = (await call("hindsight_memories_list", {
        bank: "aura-main",
        query: "DNS",
      })) as { handled: true; result: { items: Array<{ id: string; proofCount: number }>; total: number } };
      expect(memPage.result.total).toBe(2);
      expect(memPage.result.items[0].proofCount).toBe(3);

      const graphRes = (await call("hindsight_graph", {
        bank: "aura-main",
        limit: 50,
        query: "DNS",
      })) as { handled: true; result: { nodes: Array<{ id: string }>; edges: Array<{ entityName: string }>; totalUnits: number } };
      expect(graphRes.result.nodes[0].id).toBe("n1");
      expect(graphRes.result.edges[0].entityName).toBe("DNS");
      expect(graphRes.result.totalUnits).toBe(12);

      const searchRes = (await call("hindsight_global_search", {
        query: "rule",
        factType: "world",
      })) as { handled: true; result: Array<{ id: string; bankId: string }> };
      // Deduplicates m-shared across aura-main & sec-ops
      expect(searchRes.result.map((h) => h.id)).toEqual(["m-shared", "m-2", "m-sec"]);

      const galaxyRes = (await call("hindsight_galaxy_snapshot")) as {
        handled: true;
        result: { online: boolean; globes: Array<{ id: string; title: string }>; links: unknown[]; totalRealNodes: number };
      };
      expect(galaxyRes.result.online).toBe(true);
      expect(galaxyRes.result.totalRealNodes).toBe(42);
      expect(galaxyRes.result.globes.map((g) => g.id)).toEqual(["m-shared", "m-2", "m-sec"]);
      expect(galaxyRes.result.globes[0].title).toBe("dns");
      expect(galaxyRes.result.links).toHaveLength(1);

      // Filtered galaxy snapshot + targeted global search + online error tolerance
      const filteredGalaxy = (await call("hindsight_galaxy_snapshot", {
        bankFilter: "aura-main",
        limitPerBank: 10,
      })) as { handled: true; result: { globes: Array<{ bankId: string }> } };
      expect(filteredGalaxy.result.globes.every((g) => g.bankId === "aura-main")).toBe(true);

      const singleBankSearch = (await call("hindsight_global_search", {
        query: "DNS",
        bank: "aura-main",
      })) as { handled: true; result: Array<{ bankId: string }> };
      expect(singleBankSearch.result.every((h) => h.bankId === "aura-main")).toBe(true);

      globalThis.fetch = vi.fn(async () => makeJsonResponse({}, 500)) as unknown as typeof fetch;
      const errStatus = (await call("hindsight_status")) as { handled: true; result: { online: boolean } };
      expect(errStatus.result.online).toBe(false);
      expect(await call("hindsight_recall", { query: "x" })).toEqual({ handled: true, result: [] });
      const errGalaxy = (await call("hindsight_galaxy_snapshot")) as { handled: true; result: { online: boolean } };
      expect(errGalaxy.result.online).toBe(false);
    });

    it("handles online LightRAG, managed RAGLight, and live-offline knowledge_* branches", async () => {
      vi.stubEnv("MODE", "development");
      vi.stubEnv("VITEST", "");

      // 1. LightRAG online
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url === "/__lightrag/health") {
          return makeJsonResponse({ core_version: "1.2.0" });
        }
        if (url === "/__lightrag/documents") {
          return makeJsonResponse({
            statuses: {
              processed: [
                {
                  id: "doc-1",
                  file_path: "/docs/fortinet.md",
                  content_summary: "IPSec VPN phase 1 and 2 config",
                  content: "Full markdown content",
                  content_length: 420,
                  chunks_count: 4,
                  status: "processed",
                  updated_at: "2026-11-22T10:00:00Z",
                },
                {
                  id: "doc-2",
                  file_path: "/docs/notes.txt",
                  content_summary: "Shopping list",
                },
              ],
            },
          });
        }
        if (url.startsWith("/__lightrag/graphs")) {
          return makeJsonResponse({
            nodes: [
              {
                id: "ent-fw",
                properties: {
                  entity_id: "FortiGate",
                  entity_type: "appliance",
                  description: "Perimeter firewall",
                  source_id: "doc-1",
                },
              },
            ],
            edges: [
              {
                id: "rel-1",
                source: "ent-fw",
                target: "ent-vpn",
                properties: {
                  description: "terminates",
                  keywords: "ipsec, tunnel",
                  weight: 2.5,
                  source_id: "doc-1",
                },
              },
            ],
          });
        }
        return makeJsonResponse({}, 404);
      }) as unknown as typeof fetch;

      const { call } = makeHarness();

      const overview = (await call("knowledge_overview")) as {
        handled: true;
        result: {
          serviceKind: string;
          online: boolean;
          documentsCount: number;
          entitiesCount: number;
          relationsCount: number;
          statusCounts: Record<string, number>;
        };
      };
      expect(overview.result).toMatchObject({
        serviceKind: "lightrag",
        online: true,
        documentsCount: 2,
        entitiesCount: 1,
        relationsCount: 1,
        statusCounts: { processed: 2 },
      });

      const docs = (await call("knowledge_documents_list", { query: "ipsec" })) as {
        handled: true;
        result: { documents: Array<{ id: string; title: string }> };
      };
      expect(docs.result.documents).toHaveLength(1);
      expect(docs.result.documents[0].id).toBe("doc-1");

      const docDetail = (await call("knowledge_document_get", { docId: "doc-1" })) as {
        handled: true;
        result: { id: string; content: string };
      };
      expect(docDetail.result.content).toBe("Full markdown content");

      await expect(
        call("knowledge_document_get", { docId: "missing-doc" })
      ).rejects.toThrow(/document_not_found: missing-doc/);

      const graph = (await call("knowledge_graph", { label: "FortiGate" })) as {
        handled: true;
        result: {
          entities: Array<{ name: string; entityType: string }>;
          relations: Array<{ keywords: string[]; weight: number }>;
        };
      };
      expect(graph.result.entities[0]).toMatchObject({
        name: "FortiGate",
        entityType: "appliance",
      });
      expect(graph.result.relations[0]).toMatchObject({
        keywords: ["ipsec", "tunnel"],
        weight: 2.5,
      });

      const searchOnline = (await call("knowledge_search", { query: "ipsec" })) as {
        handled: true;
        result: { online: boolean; serviceKind: string };
      };
      expect(searchOnline.result.online).toBe(true);
      expect(searchOnline.result.serviceKind).toBe("lightrag");

      // 2. RAGLight fallback when LightRAG health fails
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url === "/__raglight/health") {
          return makeJsonResponse({ ok: true });
        }
        return makeJsonResponse({}, 503);
      }) as unknown as typeof fetch;

      const ragOverview = (await call("knowledge_overview")) as {
        handled: true;
        result: { serviceKind: string; online: boolean };
      };
      expect(ragOverview.result.serviceKind).toBe("raglight_managed");
      expect(ragOverview.result.online).toBe(true);

      const ragDocs = (await call("knowledge_documents_list")) as {
        handled: true;
        result: { serviceKind: string; online: boolean; documents: unknown[] };
      };
      expect(ragDocs.result.serviceKind).toBe("raglight_managed");
      expect(ragDocs.result.documents).toEqual([]);

      // 3. Both LightRAG and RAGLight offline
      globalThis.fetch = vi.fn(async () => makeJsonResponse({}, 503)) as unknown as typeof fetch;
      const offlineOverview = (await call("knowledge_overview")) as {
        handled: true;
        result: { serviceKind: string; online: boolean; diagnosticMessage: string };
      };
      expect(offlineOverview.result.serviceKind).toBe("offline");
      expect(offlineOverview.result.online).toBe(false);
      expect(offlineOverview.result.diagnosticMessage).toContain("127.0.0.1:9621");
    });
  });
});
