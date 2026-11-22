import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import { hindsightExploreApi, type HindsightGalaxySnapshot } from "../lib/ipc";
import { AuraPyramidStation } from "./AuraPyramidStation";

function createMock2dContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "middle",
    shadowColor: "",
    shadowBlur: 0,
  };
}

describe("AuraPyramidStation & MemoryGlobeInspector", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRaf = window.requestAnimationFrame;
  const originalCaf = window.cancelAnimationFrame;

  const sampleSnapshot: HindsightGalaxySnapshot = {
    online: true,
    totalRealNodes: 42,
    banks: [
      { id: "estudos", name: "estudos", totalNodes: 25, totalLinks: 100, totalDocuments: 5 },
      { id: "engenharia", name: "engenharia", totalNodes: 17, totalLinks: 50, totalDocuments: 3 },
    ],
    globes: [
      {
        id: "uuid-globe-1",
        bankId: "estudos",
        bankName: "estudos",
        title: "Fortinet ZTNA Architecture",
        content: "Detailed notes about Zero Trust Network Access with FortiGate",
        factType: "world",
        date: "2026-11-21T18:00:00Z",
        context: "nse1-ztna",
        documentId: "doc-1",
        entities: ["Fortinet", "ZTNA"],
        tags: ["security"],
      },
      {
        id: "uuid-globe-2",
        bankId: "engenharia",
        bankName: "engenharia",
        title: "Rust SQLite WAL Layer",
        content: "Clean hexagonal architecture for SQLite WAL connection pooling",
        factType: "experience",
        date: "2026-11-22T09:00:00Z",
        context: "auradesk-rust",
        documentId: "doc-2",
        entities: ["Rust", "SQLite"],
        tags: ["architecture"],
      },
    ],
    links: [
      {
        source: "uuid-globe-1",
        target: "uuid-globe-2",
        bankId: "estudos",
        linkType: "semantic",
        weight: 0.9,
        entityName: "SecurityDesign",
      },
    ],
  };

  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const ctx2d = createMock2dContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(function (contextId: string) {
      if (contextId === "2d") {
        return ctx2d as unknown as RenderingContext;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    let rafCount = 0;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCount += 1;
      if (rafCount <= 1) cb(16);
      return rafCount;
    });
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCaf;
    vi.restoreAllMocks();
  });

  it("loads real galaxySnapshot globes, searches and flies to a globe, traverses connected globes, and returns to galaxy", async () => {
    const memGetSpy = vi.spyOn(hindsightExploreApi, "memoryGet").mockResolvedValue({
      id: "uuid-globe-1",
      text: "Full hydrated text about FortiGate ZTNA policies.",
      context: "nse1-ztna",
      date: "2026-11-21T18:00:00Z",
      factType: "world",
      documentId: "doc-1",
      entities: ["Fortinet", "ZTNA"],
      tags: ["security"],
      sourceMemoryIds: [],
      sourceMemories: [],
      history: [{ id: "h1", text: "Initial capture", action: "retain", raw: {} }],
    });

    const onOpenBank = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <AuraPyramidStation
          aiStatus={{
            configuredProvider: "ollama",
            activeProvider: "ollama",
            model: "qwen3:8b",
            hasApiKey: false,
            hermesCliAvailable: false,
            codexCliAvailable: false,
            ready: true,
          }}
          hindsightStatus={{
            enabled: true,
            baseUrl: "http://127.0.0.1:8919",
            defaultBank: "estudos",
            autoCreateBanks: true,
            dailyMaintenance: true,
            lastMaintenanceDate: "2026-11-22",
            online: true,
            banks: ["estudos", "engenharia"],
            localCount: 0,
          }}
          raglightStatus={null}
          galaxySnapshot={sampleSnapshot}
          onOpenHindsightBank={onOpenBank}
        />
      </I18nextProvider>
    );

    const searchInput = screen.getByTestId("galaxy-search-input");
    fireEvent.change(searchInput, { target: { value: "Fortinet" } });

    const matchBtn = await screen.findByText(/Fortinet ZTNA Architecture/i);
    fireEvent.click(matchBtn);

    await waitFor(() => {
      expect(screen.getByTestId("memory-globe-inspector")).toBeInTheDocument();
      expect(memGetSpy).toHaveBeenCalledWith("estudos", "uuid-globe-1");
    });

    expect(
      screen.getByText(/Full hydrated text about FortiGate ZTNA policies/i)
    ).toBeInTheDocument();

    // Traverse to connected globe #2 directly inside inspector
    const connectedBtn = screen.getByRole("button", { name: /Rust SQLite WAL Layer/i });
    fireEvent.click(connectedBtn);

    await waitFor(() => {
      expect(memGetSpy).toHaveBeenCalledWith("engenharia", "uuid-globe-2");
    });

    fireEvent.click(screen.getByRole("button", { name: /Open in Hindsight Panel/i }));
    expect(onOpenBank).toHaveBeenCalledWith("engenharia");

    fireEvent.click(screen.getByTestId("back-to-galaxy-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("memory-globe-inspector")).not.toBeInTheDocument();
    });
  });

  it("handles focusedMemoryId fly-to and station zoom/expand/reset controls cleanly", async () => {
    const onFocusedHandled = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <AuraPyramidStation
          aiStatus={null}
          hindsightStatus={null}
          raglightStatus={null}
          galaxySnapshot={sampleSnapshot}
          focusedMemoryId="uuid-globe-2"
          onFocusedMemoryHandled={onFocusedHandled}
        />
      </I18nextProvider>
    );

    await waitFor(() => {
      expect(onFocusedHandled).toHaveBeenCalled();
      expect(screen.getByTestId("memory-globe-inspector")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Zoom in/i }));
    fireEvent.click(screen.getByRole("button", { name: /Zoom out/i }));
    fireEvent.click(screen.getByRole("button", { name: /4D layer/i }));
    fireEvent.click(screen.getByRole("button", { name: /Reset view/i }));
  });
});
