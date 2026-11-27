import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  hermesApi,
  hindsightApi,
  hindsightExploreApi,
  proposalsApi,
  raglightApi,
} from "../../lib/ipc";
import { AuraChatPanel } from "./AuraChatPanel";
import { AuraMonitoringPanel } from "./AuraMonitoringPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("AuraChatPanel", () => {
  beforeEach(async () => {
    localStorage.clear();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  function renderPanel(onProposalApplied?: () => void) {
    return render(
      <I18nextProvider i18n={i18n}>
        <AuraChatPanel onProposalApplied={onProposalApplied} />
      </I18nextProvider>
    );
  }

  it("proposes tasks via chat, shows floating transcript popover, supports collapse/clear, and records proposal + audit", async () => {
    renderPanel();

    // The status chrome is collapsed into a single floating menu.
    fireEvent.click(screen.getByTestId("aura-status-menu-btn"));
    await waitFor(() => {
      expect(screen.getByText(/Hermes CLI offline/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
    fireEvent.change(input, { target: { value: "create task: Draft RFC" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Created pending proposal/i)).toBeInTheDocument();
    });

    // Toggle transcript popover collapse & reopen (the status menu stays open)
    expect(screen.getByRole("button", { name: /Chat \(2\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hide chat/i }));
    expect(screen.queryByText(/Created pending proposal/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Chat \(2\)/i }));
    expect(screen.getByText(/Created pending proposal/i)).toBeInTheDocument();

    // Verify proposal & audit entry persisted in backend/mock DB
    const recent = await proposalsApi.listRecent(50);
    expect(recent).toHaveLength(1);
    expect(recent[0].summary).toBe("Create task: Draft RFC");

    const cmds = await proposalsApi.listCommands(50);
    expect(cmds.some((c) => c.toolName === "propose_create_task")).toBe(true);

    // Clear chat
    fireEvent.click(screen.getByRole("button", { name: /Clear chat/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Created pending proposal/i)).not.toBeInTheDocument();
    });
  });

  it("handles voice capture and Live mode gracefully when SpeechRecognition and microphone APIs are unavailable", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Transcribe Audio/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Live Voice/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Transcribe Audio/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Audio recording is not supported in this browser/i)
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Live Voice/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Live On/i })).toBeInTheDocument();
      expect(
        screen.getByText(/Live speech recognition unavailable in this browser/i)
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Live On/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Live Voice/i })).toBeInTheDocument();
    });
  });

  it("supports quick action chips and records WAV audio fallback when microphone APIs are mocked", async () => {
    const stopTrack = vi.fn();
    const disconnectProc = vi.fn();
    const closeCtx = vi.fn().mockResolvedValue(undefined);
    const mockProcessor: Record<string, unknown> = {
      connect: vi.fn(),
      disconnect: disconnectProc,
      onaudioprocess: null as ((ev: unknown) => void) | null,
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });
    (window as unknown as { AudioContext?: unknown }).AudioContext = vi.fn(() => ({
      sampleRate: 16_000,
      destination: {},
      createMediaStreamSource: () => ({ connect: vi.fn() }),
      createScriptProcessor: () => mockProcessor,
      close: closeCtx,
    }));

    try {
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: /Today's summary/i }));
      await waitFor(() => {
        expect(screen.getByText(/Today:/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /^Propose task$/i }));
      const chatInput = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
      expect((chatInput as HTMLInputElement).value).toBe("Propose task: ");

      fireEvent.click(screen.getByRole("button", { name: /Transcribe Audio/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Stop & Save WAV/i })).toBeInTheDocument();
      });

      const onAudio = mockProcessor.onaudioprocess as ((ev: unknown) => void) | null;
      onAudio?.({ inputBuffer: { getChannelData: () => new Float32Array([0.1, -0.2]) } });

      fireEvent.click(screen.getByRole("button", { name: /Stop & Save WAV/i }));
      await waitFor(() => {
        expect(screen.getByText(/Saved voice note/i)).toBeInTheDocument();
      });
      expect(stopTrack).toHaveBeenCalledTimes(1);
      expect(disconnectProc).toHaveBeenCalledTimes(1);
      expect(closeCtx).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  it("supports Web Speech API for Live Voice auto-send and single-utterance audio transcription", async () => {
    interface MockSpeechInstance {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((ev: unknown) => void) | null;
      onerror: ((ev: unknown) => void) | null;
      onend: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    }

    const instances: MockSpeechInstance[] = [];
    const MockSpeechRecognition = vi.fn(() => {
      const instance: MockSpeechInstance = {
        continuous: false,
        interimResults: false,
        lang: "",
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
      };
      instances.push(instance);
      return instance;
    });

    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition =
      MockSpeechRecognition;

    try {
      renderPanel();

      // 1. Single-utterance Transcribe Audio dictation
      fireEvent.click(screen.getByRole("button", { name: /Transcribe Audio/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Listening/i })).toBeInTheDocument();
      });
      const dictInst = instances[0];
      expect(dictInst.continuous).toBe(false);
      expect(dictInst.lang).toBe("en-US");
      expect(dictInst.start).toHaveBeenCalledTimes(1);

      act(() => {
        dictInst.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { isFinal: true, length: 1, 0: { transcript: "create task: Voice memo" } },
          },
        });
        dictInst.onend?.();
      });

      const chatInput = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
      expect((chatInput as HTMLInputElement).value).toBe("create task: Voice memo");
      expect(screen.getByRole("button", { name: /Transcribe Audio/i })).toBeInTheDocument();

      // Clear input before Live mode
      fireEvent.change(chatInput, { target: { value: "" } });

      // 2. Continuous Live Conversation mode
      fireEvent.click(screen.getByRole("button", { name: /Live Voice/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Live On/i })).toBeInTheDocument();
      });

      const liveInst = instances[1];
      expect(liveInst.continuous).toBe(true);
      expect(liveInst.interimResults).toBe(true);
      expect(liveInst.start).toHaveBeenCalledTimes(1);

      await act(async () => {
        liveInst.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { isFinal: true, length: 1, 0: { transcript: "summary" } },
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/Today:/i)).toBeInTheDocument();
      });

      // Turn Live mode off
      fireEvent.click(screen.getByRole("button", { name: /Live On/i }));
      expect(liveInst.stop).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /Live Voice/i })).toBeInTheDocument();
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it("fires Hindsight recall and RAGLight query pulses when sending a prompt", async () => {
    const recallSpy = vi.spyOn(hindsightApi, "recall").mockResolvedValue([
      {
        id: "mem-1",
        bank: "aura-main",
        content: "Architecture notes stored in docs",
        source: "chat",
        createdAt: "2026-11-22T00:00:00Z",
      },
    ]);
    const ragStatusSpy = vi.spyOn(raglightApi, "status").mockResolvedValue({
      enabled: true,
      mode: "local",
      baseUrl: "http://127.0.0.1:8765",
      provider: "openai",
      embeddingModel: "text-embedding-3-small",
      llmModel: "gpt-4o-mini",
      vectorStore: "chroma",
      folders: ["/docs"],
      hasApiKey: true,
      installed: true,
      running: true,
      venvPath: "/tmp/venv",
      dbPath: "/tmp/db",
    });
    const ragQuerySpy = vi
      .spyOn(raglightApi, "query")
      .mockResolvedValue({ answer: "Found in docs", sources: ["/docs/arch.md"] });

    try {
      renderPanel();

      await waitFor(() => {
        expect(ragStatusSpy).toHaveBeenCalled();
      });

      const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
      fireEvent.change(input, { target: { value: "summary" } });
      fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

      await waitFor(() => {
        expect(recallSpy).toHaveBeenCalledWith("summary", null, 24);
        expect(ragQuerySpy).toHaveBeenCalledWith("summary", 4);
      });
    } finally {
      recallSpy.mockRestore();
      ragStatusSpy.mockRestore();
      ragQuerySpy.mockRestore();
    }
  });

  it("walks the prompt history with the arrow keys and documents the shortcuts", async () => {
    renderPanel();

    const input = screen.getByPlaceholderText(
      /create task: Review sprint backlog/i
    ) as HTMLInputElement;

    const send = async (text: string) => {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
      // Wait for the turn to settle before sending the next one.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument();
      });
    };

    await send("first prompt");
    await send("second prompt");

    // The shortcuts are written down under the composer.
    expect(screen.getByText("sends")).toBeInTheDocument();
    expect(screen.getByText("history")).toBeInTheDocument();
    expect(screen.getByText("commands")).toBeInTheDocument();

    // ↑ recalls the last prompt, and again the one before it.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("second prompt");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("first prompt");

    // ↓ walks forward again.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("second prompt");

    // And past the end it gives back the draft that was being typed.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("");

    // Typing by hand leaves the history behind.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("second prompt");
    fireEvent.change(input, { target: { value: "half typed" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("second prompt");
  });

  it("creates a dedicated new chat session when clicking + New chat session", async () => {    renderPanel();

    fireEvent.click(screen.getByTestId("aura-status-menu-btn"));
    const newBtn = await screen.findByTestId("aura-new-session-btn");
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByText(/Session:/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
    fireEvent.change(input, { target: { value: "summary" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Today:/i)).toBeInTheDocument();
    });
  });

  it("keeps the 3D pyramid stage visible above the chat panel on narrow viewports and expands when chat is hidden", () => {
    renderPanel();

    const stage = screen.getByTestId("aura-pyramid-stage");
    const chatPanel = screen.getByTestId("aura-chat-panel");

    expect(stage.className).toContain("h-[36%]");
    expect(stage.className).toContain("min-h-[220px]");
    expect(chatPanel.className).toContain("flex-1 min-h-0");
    expect(chatPanel.className).not.toMatch(/(^|\s)h-full(\s|$)/);

    fireEvent.click(screen.getByRole("button", { name: /Hide chat/i }));

    expect(stage.className).toContain("flex-1");
    expect(stage.className).not.toContain("h-[36%]");
    expect(chatPanel.className).toContain("h-auto");
  });

  it("applies glass transparency and desktop overlay across left, right, and center docks including the composer", () => {
    renderPanel();

    const chatPanel = screen.getByTestId("aura-chat-panel");
    const composer = screen.getByTestId("aura-chat-composer");

    // Default right dock floats on desktop over full-bleed galaxy
    expect(chatPanel.className).toContain("lg:absolute");
    expect(chatPanel.className).toContain("lg:right-0");

    fireEvent.click(screen.getByTestId("aura-layout-menu-btn"));
    fireEvent.click(screen.getByTestId("aura-transparency-clear"));

    expect(chatPanel.className).toContain("bg-slate-950/25");
    expect(composer.className).toContain("bg-slate-950/20");

    fireEvent.click(screen.getByTestId("aura-layout-menu-btn"));
    fireEvent.click(screen.getByTestId("aura-dock-left"));

    expect(chatPanel.className).toContain("lg:absolute");
    expect(chatPanel.className).toContain("lg:left-0");
    expect(chatPanel.className).toContain("bg-slate-950/25");
    expect(composer.className).toContain("bg-slate-950/20");
  });

  it("supports resizing width and collapsing into a floating prompt-only capsule", () => {
    renderPanel();

    const chatPanel = screen.getByTestId("aura-chat-panel");
    fireEvent.click(screen.getByTestId("aura-layout-menu-btn"));
    fireEvent.click(screen.getByTestId("aura-size-compact"));

    expect(chatPanel.className).toContain("lg:w-[340px]");

    // Switching to left dock anchors the layout popover inward (left-2) so it never clips under the sidebar
    fireEvent.click(screen.getByTestId("aura-layout-menu-btn"));
    fireEvent.click(screen.getByTestId("aura-dock-left"));
    fireEvent.click(screen.getByTestId("aura-layout-menu-btn"));
    const leftPopover = screen.getByTestId("aura-layout-popover");
    expect(leftPopover.className).toContain("left-2");
    expect(leftPopover.className).toContain("top-11");

    // In prompt-only mode at the bottom, the popover opens upward (bottom-11)
    fireEvent.click(screen.getByRole("button", { name: /Hide chat/i }));
    expect(chatPanel.className).toContain("h-auto");
    expect(chatPanel.className).toContain("lg:bottom-4");
    expect(screen.queryByTestId("aura-transcript")).not.toBeInTheDocument();
    expect(screen.getByTestId("aura-layout-popover").className).toContain("bottom-11");

    fireEvent.click(screen.getByTestId("aura-show-transcript-btn"));
    expect(screen.getByTestId("aura-transcript")).toBeInTheDocument();
  });

  it("toggles voice-reply mode directly in the prompt bar and speaks/stops individual messages", async () => {
    const speakMock = vi.fn();
    const cancelMock = vi.fn();
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: speakMock,
        cancel: cancelMock,
        getVoices: () => [],
      },
    });
    (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      vi.fn((text: string) => ({
        text,
        lang: "",
        rate: 1,
        pitch: 1,
        voice: null,
        onstart: null,
        onend: null,
        onerror: null,
      }));

    try {
      renderPanel();

      const autoSpeakBtn = screen.getByTestId("aura-autospeak-toggle");
      expect(autoSpeakBtn).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(autoSpeakBtn);
      expect(autoSpeakBtn).toHaveAttribute("aria-pressed", "false");
      expect(JSON.parse(localStorage.getItem("auradesk_voice_settings") || "{}").autoSpeak).toBe(
        false
      );

      const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
      fireEvent.change(input, { target: { value: "summary" } });
      fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

      await waitFor(() => {
        expect(screen.getByText(/Today:/i)).toBeInTheDocument();
      });

      const speakMsgBtn = screen.getByRole("button", { name: /^Read aloud$/i });
      fireEvent.click(speakMsgBtn);
      expect(speakMock).toHaveBeenCalled();
    } finally {
      delete (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
      delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    }
  });

  it("opens quick conversations/projects sidebar, creates a project linked to a new Hindsight bank, and scopes recall", async () => {
    const bankCreateSpy = vi
      .spyOn(hindsightExploreApi, "bankCreate")
      .mockResolvedValue({
        id: "zabbix-infra",
        name: "Zabbix Infra",
        totalNodes: 0,
        totalLinks: 0,
        totalDocuments: 0,
      });
    const recallSpy = vi.spyOn(hindsightApi, "recall").mockResolvedValue([]);

    try {
      renderPanel();

      fireEvent.click(screen.getByTestId("aura-sessions-sidebar-btn"));
      expect(screen.getByTestId("aura-chat-sidebar")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("aura-new-project-btn"));
      fireEvent.change(screen.getByTestId("aura-project-name-input"), {
        target: { value: "Zabbix Infra" },
      });
      expect(
        (screen.getByTestId("aura-project-bank-id-input") as HTMLInputElement).value
      ).toBe("zabbix-infra");

      await act(async () => {
        fireEvent.click(screen.getByTestId("aura-project-create-submit"));
      });

      expect(bankCreateSpy).toHaveBeenCalledWith({
        bankId: "zabbix-infra",
        name: "Zabbix Infra",
        mission: null,
      });

      // Create a new chat while the project filter is selected -> assigns session to project
      await act(async () => {
        fireEvent.click(screen.getByTestId("aura-sidebar-new-chat"));
      });

      const activeBar = await screen.findByTestId("aura-active-project-bar");
      expect(activeBar).toHaveTextContent("Zabbix Infra");
      expect(activeBar).toHaveTextContent("zabbix-infra");

      const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
      fireEvent.change(input, { target: { value: "summary" } });
      fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

      await waitFor(() => {
        expect(recallSpy).toHaveBeenCalledWith("summary", "zabbix-infra", 24);
      });
    } finally {
      bankCreateSpy.mockRestore();
      recallSpy.mockRestore();
    }
  });

  it("keeps assistant message footer actions compact and single-line with full aria-labels", async () => {
    renderPanel();

    const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
    fireEvent.change(input, { target: { value: "summary" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Today:/i)).toBeInTheDocument();
    });

    const actionBars = screen.getAllByTestId("aura-message-actions");
    const assistantActions = actionBars[actionBars.length - 1];
    expect(assistantActions).toBeInTheDocument();

    const speakBtn = screen.getByRole("button", { name: /^Read aloud$/i });
    const copyBtn = screen.getByRole("button", { name: /^Copy message$/i });
    const regenerateBtn = screen.getByRole("button", { name: /^Regenerate$/i });

    expect(speakBtn).toHaveClass("whitespace-nowrap");
    expect(copyBtn).toHaveClass("whitespace-nowrap");
    expect(regenerateBtn).toHaveClass("whitespace-nowrap");
    expect(speakBtn).toHaveTextContent("Listen");
    expect(copyBtn).toHaveTextContent("Copy");
    expect(regenerateBtn).toHaveTextContent("Retry");

    const timestamp = assistantActions.querySelector("time");
    expect(timestamp).not.toBeNull();
    expect(timestamp).toHaveClass("ml-auto", "shrink-0");
  });

  it("opens integrated sidebar by default on desktop screens, shows linked bank badges, and auto-titles new chats", async () => {
    const originalWidth = window.innerWidth;
    const bankCreateSpy = vi
      .spyOn(hindsightExploreApi, "bankCreate")
      .mockResolvedValue({
        id: "infra-onu",
        name: "Infra ONU",
        totalNodes: 0,
        totalLinks: 0,
        totalDocuments: 0,
      });

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    });

    try {
      renderPanel();

      // Sidebar opens by default on desktop without clicking the toggle
      const sidebar = screen.getByTestId("aura-chat-sidebar");
      expect(sidebar).toBeInTheDocument();

      // Toggle closes sidebar and persists preference
      fireEvent.click(screen.getByTestId("aura-sessions-sidebar-btn"));
      expect(screen.queryByTestId("aura-chat-sidebar")).not.toBeInTheDocument();
      expect(localStorage.getItem("auradesk_chat_sidebar_open")).toBe("0");

      // Reopen sidebar
      fireEvent.click(screen.getByTestId("aura-sessions-sidebar-btn"));
      expect(screen.getByTestId("aura-chat-sidebar")).toBeInTheDocument();
      expect(localStorage.getItem("auradesk_chat_sidebar_open")).toBe("1");

      // Create a project linked to a Hindsight bank and verify badge renders in sidebar
      fireEvent.click(screen.getByTestId("aura-new-project-btn"));
      fireEvent.change(screen.getByTestId("aura-project-name-input"), {
        target: { value: "Infra ONU" },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("aura-project-create-submit"));
      });
      expect(screen.getByTestId("aura-chat-sidebar")).toHaveTextContent("infra-onu");

      // Create a new chat in the project and send a prompt -> auto-titles the session in header
      await act(async () => {
        fireEvent.click(screen.getByTestId("aura-sidebar-new-chat"));
      });
      const input = screen.getByPlaceholderText(/create task: Review sprint backlog/i);
      fireEvent.change(input, { target: { value: "Descobrir IP da ONU GPON" } });
      fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

      await waitFor(() => {
        expect(screen.getByTestId("aura-chat-sidebar")).toHaveTextContent(
          "Descobrir IP da ONU GPON"
        );
      });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: originalWidth,
      });
      bankCreateSpy.mockRestore();
    }
  });
});

describe("AuraMonitoringPanel", () => {
  beforeEach(async () => {
    localStorage.clear();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  function renderMonitoring(onProposalApplied?: () => void) {
    return render(
      <I18nextProvider i18n={i18n}>
        <AuraMonitoringPanel onProposalApplied={onProposalApplied} />
      </I18nextProvider>
    );
  }

  it("renders monitoring section header and empty states when no proposals or audit commands exist", async () => {
    renderMonitoring();

    await waitFor(() => {
      expect(
        screen.getByText(/AI Monitoring, Proposal Queue & Audit/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/No proposals in this view/i)).toBeInTheDocument();
      expect(screen.getByText(/No IA commands logged yet/i)).toBeInTheDocument();
    });
  });

  it("supports Edit & Approve with modifications and updates IA Command Audit Log", async () => {
    await hermesApi.sendMessage("create task: Draft RFC", false);
    const onApplied = vi.fn();
    renderMonitoring(onApplied);

    await waitFor(() => {
      expect(screen.getByText("Create task: Draft RFC")).toBeInTheDocument();
    });
    expect(screen.getByText(/propose_create_task/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Edit & Approve/i }));
    const titleInput = screen.getByLabelText(/^Title$/i);
    fireEvent.change(titleInput, { target: { value: "Finalize Q4 RFC" } });
    const prioritySelect = screen.getByLabelText(/^Priority$/i);
    fireEvent.change(prioritySelect, { target: { value: "urgent" } });

    fireEvent.click(screen.getByRole("button", { name: /Apply & Approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/Proposal approved and applied/i)).toBeInTheDocument();
    });
    expect(onApplied).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /History \(1\)/i }));
    await waitFor(() => {
      expect(screen.getByText("approved")).toBeInTheDocument();
    });
    expect(screen.getByText(/approve_proposal/i)).toBeInTheDocument();
  });

  it("approves a pending proposal directly with optional decision note", async () => {
    await hermesApi.sendMessage("create task: Ship release", false);
    const onApplied = vi.fn();
    renderMonitoring(onApplied);

    await waitFor(() => {
      expect(screen.getByText("Create task: Ship release")).toBeInTheDocument();
    });

    const noteInput = screen.getByLabelText(/Decision note/i);
    fireEvent.change(noteInput, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Proposal approved and applied/i)).toBeInTheDocument();
    });
    expect(onApplied).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /History \(1\)/i }));
    await waitFor(() => {
      expect(screen.getByText("Looks good")).toBeInTheDocument();
    });
  });

  it("rejects a proposed reminder with optional note and logs reject_proposal", async () => {
    await hermesApi.sendMessage("remind me: Take vitamins", false);
    const onApplied = vi.fn();
    renderMonitoring(onApplied);

    await waitFor(() => {
      expect(screen.getByText("Create reminder: Take vitamins")).toBeInTheDocument();
    });

    const noteInput = screen.getByLabelText(/Decision note/i);
    fireEvent.change(noteInput, { target: { value: "Already done" } });
    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    await waitFor(() => {
      expect(screen.getByText(/Proposal rejected/i)).toBeInTheDocument();
    });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/reject_proposal/i)).toBeInTheDocument();
  });
});
