import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import { HindsightPanelPage } from "./HindsightPanelPage";
import type {
  HindsightBankStats,
  HindsightBankSummary,
  HindsightDirective,
  HindsightDocumentDetail,
  HindsightDocumentItem,
  HindsightEntityDetail,
  HindsightEntityItem,
  HindsightGlobalSearchHit,
  HindsightGraphPayload,
  HindsightMemoryDetail,
  HindsightMemoryItem,
  HindsightMentalModel,
  HindsightOperation,
} from "../lib/auraTypes";

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    hindsightExploreApi: {
      ...actual.hindsightExploreApi,
      banksList: vi.fn(),
      bankStats: vi.fn(),
      memoriesList: vi.fn(),
      memoryGet: vi.fn(),
      memoryHistory: vi.fn(),
      documentsList: vi.fn(),
      documentGet: vi.fn(),
      entitiesList: vi.fn(),
      entityGet: vi.fn(),
      graph: vi.fn(),
      mentalModels: vi.fn(),
      globalSearch: vi.fn(),
      galaxySnapshot: vi.fn(),
      bankCreate: vi.fn(),
      memoryRetain: vi.fn(),
      mentalModelCreate: vi.fn(),
      mentalModelRefresh: vi.fn(),
      mentalModelDelete: vi.fn(),
      directivesList: vi.fn(),
      directiveCreate: vi.fn(),
      directiveDelete: vi.fn(),
      operationsList: vi.fn(),
      bankConsolidate: vi.fn(),
    },
  };
});

import { hindsightExploreApi } from "../lib/ipc";

const mockExplore = vi.mocked(hindsightExploreApi);

const BANKS: HindsightBankSummary[] = [
  {
    id: "estudos",
    name: "Estudos",
    totalNodes: 24,
    totalLinks: 41,
    totalDocuments: 5,
  },
  {
    id: "engenharia",
    name: "Engenharia",
    totalNodes: 18,
    totalLinks: 30,
    totalDocuments: 3,
  },
];

const STATS_BY_BANK: Record<string, HindsightBankStats> = {
  estudos: {
    bankId: "estudos",
    totalNodes: 24,
    totalLinks: 41,
    totalDocuments: 5,
    nodesByFactType: { world: 14, experience: 6, observation: 4 },
    linksByLinkType: { entity: 25, temporal: 16 },
    pendingOperations: 2,
    failedOperations: 0,
    pendingConsolidation: 1,
    failedConsolidation: 0,
    lastConsolidatedAt: "2026-11-22T10:00:00Z",
    lastMemoryWriteAt: "2026-11-22T11:30:00Z",
  },
  engenharia: {
    bankId: "engenharia",
    totalNodes: 18,
    totalLinks: 30,
    totalDocuments: 3,
    nodesByFactType: { world: 11, experience: 7 },
    linksByLinkType: { entity: 30 },
    pendingOperations: 0,
    failedOperations: 0,
    pendingConsolidation: 0,
    failedConsolidation: 0,
    lastConsolidatedAt: "2026-11-22T09:00:00Z",
    lastMemoryWriteAt: "2026-11-22T10:15:00Z",
  },
};

const MEMORIES_BY_BANK: Record<string, HindsightMemoryItem[]> = {
  estudos: [
    {
      id: "mem-est-1",
      text: "BGP peering uses AS-PATH prepending to influence inbound routing.",
      context: "ccnp/bgp-notes",
      date: "2026-11-21T14:00:00Z",
      factType: "world",
      documentId: "doc-est-1",
      mentionedAt: "2026-11-21T14:00:00Z",
      occurredStart: null,
      occurredEnd: null,
      entities: ["BGP", "AS-PATH"],
      tags: ["networking", "routing"],
      chunkId: "chunk-1",
      proofCount: 2,
      state: "consolidated",
    },
  ],
  engenharia: [
    {
      id: "mem-eng-1",
      text: "Rust async runtime on Tauri backend avoids blocking IPC threads.",
      context: "auradesk/architecture",
      date: "2026-11-22T08:30:00Z",
      factType: "experience",
      documentId: "doc-eng-1",
      mentionedAt: "2026-11-22T08:30:00Z",
      occurredStart: null,
      occurredEnd: null,
      entities: ["Rust", "Tauri"],
      tags: ["backend", "ipc"],
      chunkId: "chunk-2",
      proofCount: 1,
      state: "active",
    },
  ],
};

const MEMORY_DETAIL_EST_1: HindsightMemoryDetail = {
  id: "mem-est-1",
  text: "BGP peering uses AS-PATH prepending to influence inbound routing.",
  context: "ccnp/bgp-notes",
  date: "2026-11-21T14:00:00Z",
  factType: "world",
  documentId: "doc-est-1",
  mentionedAt: "2026-11-21T14:00:00Z",
  occurredStart: null,
  occurredEnd: null,
  entities: ["BGP", "AS-PATH"],
  tags: ["networking", "routing"],
  chunkId: "chunk-1",
  state: "consolidated",
  sourceMemoryIds: ["mem-est-src-1"],
  sourceMemories: [
    {
      id: "mem-est-src-1",
      text: "Raw lab capture showing AS 65001 prepended twice on uplink.",
      context: "lab-capture",
      date: "2026-11-20T09:00:00Z",
      factType: "experience",
      documentId: "doc-est-1",
      mentionedAt: null,
      occurredStart: null,
      occurredEnd: null,
      entities: ["BGP"],
      tags: [],
      chunkId: null,
      proofCount: 1,
      state: null,
    },
  ],
  history: [
    {
      id: "hist-1",
      text: "Initial BGP route preference note recorded.",
      changedAt: "2026-11-20T10:00:00Z",
      createdAt: "2026-11-20T10:00:00Z",
      occurredAt: null,
      action: "created",
      raw: {},
    },
  ],
};

const DOCUMENTS_ESTUDOS: HindsightDocumentItem[] = [
  {
    id: "doc-est-1",
    bankId: "estudos",
    contentHash: "sha256:abc123",
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-21T14:00:00Z",
    textLength: 420,
    memoryUnitCount: 6,
    context: "ccnp/bgp-notes.md",
    tags: ["ccnp", "bgp"],
  },
];

const DOCUMENT_DETAIL_EST_1: HindsightDocumentDetail = {
  id: "doc-est-1",
  bankId: "estudos",
  originalText:
    "# BGP Path Selection\n\nPrepending AS-PATH influences external neighbors to prefer the primary circuit.",
  contentHash: "sha256:abc123",
  createdAt: "2026-11-20T08:00:00Z",
  updatedAt: "2026-11-21T14:00:00Z",
  memoryUnitCount: 6,
  nodesByFactType: { world: 4, experience: 2 },
  tags: ["ccnp", "bgp"],
  context: "ccnp/bgp-notes.md",
  metadata: {},
};

const ENTITIES_ESTUDOS: HindsightEntityItem[] = [
  {
    id: "ent-fortinet",
    canonicalName: "Fortinet FortiGate",
    mentionCount: 9,
    firstSeen: "2026-11-10T10:00:00Z",
    lastSeen: "2026-11-21T16:00:00Z",
  },
];

const ENTITY_DETAIL_FORTINET: HindsightEntityDetail = {
  id: "ent-fortinet",
  canonicalName: "Fortinet FortiGate",
  mentionCount: 9,
  firstSeen: "2026-11-10T10:00:00Z",
  lastSeen: "2026-11-21T16:00:00Z",
  observations: [
    {
      text: "Configured SD-WAN SLA health checks over dual WAN links.",
      mentionedAt: "2026-11-21T16:00:00Z",
    },
    {
      text: "Verified BGP neighbor adjacency with FortiOS 7.4.",
      mentionedAt: "2026-11-21T17:00:00Z",
    },
  ],
};

const GRAPH_ESTUDOS: HindsightGraphPayload = {
  nodes: [
    {
      id: "g-node-1",
      label: "BGP Routing",
      text: "BGP peering across dual ISP uplinks with local-pref 200.",
      date: "2026-11-21T14:00:00Z",
      context: "network/edge",
      entities: ["BGP", "ISP"],
      color: "#38bdf8",
      factType: "world",
    },
    {
      id: "g-node-2",
      label: "DNS Failover",
      text: "DNS resolver switches to secondary forwarder on health probe failure.",
      date: "2026-11-21T15:00:00Z",
      context: "network/dns",
      entities: ["DNS"],
      color: "#34d399",
      factType: "experience",
    },
  ],
  edges: [
    {
      id: "g-edge-1",
      source: "g-node-1",
      target: "g-node-2",
      linkType: "entity",
      weight: 0.9,
      entityName: "Edge Resilience",
      color: "#94a3b8",
      lineStyle: "solid",
    },
  ],
  totalUnits: 2,
};

const MENTAL_MODELS_ESTUDOS: HindsightMentalModel[] = [
  {
    id: "mm-1",
    bankId: "estudos",
    name: "Edge Firewall & Routing Playbook",
    sourceQuery: "How do FortiGate SD-WAN and BGP failover interact?",
    content: "Maintain asymmetric routing protection and bind SLA probes to BGP route-maps.",
    tags: ["fortinet", "sd-wan"],
    lastRefreshedAt: "2026-11-22T07:00:00Z",
    lastMemorySeenAt: "2026-11-21T17:00:00Z",
    lastRefreshFailedAt: null,
    createdAt: "2026-11-18T10:00:00Z",
    isStale: false,
  },
  {
    id: "mm-2",
    bankId: "estudos",
    name: "Legacy DNS Caching Notes",
    sourceQuery: "Older unbound resolver tuning notes",
    content: "Prefetch expired records when TTL drops below 10%.",
    tags: ["dns"],
    lastRefreshedAt: "2026-11-15T10:00:00Z",
    lastMemorySeenAt: "2026-11-21T17:00:00Z",
    lastRefreshFailedAt: null,
    createdAt: "2026-11-12T10:00:00Z",
    isStale: true,
  },
];

const DIRECTIVES_ESTUDOS: HindsightDirective[] = [
  {
    id: "dir-1",
    bankId: "estudos",
    name: "Literal certification vocabulary",
    content: "Preserve official Fortinet NSE terms verbatim.",
    priority: 0,
    isActive: true,
    tags: ["fortinet"],
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
  },
];

const OPERATIONS_ESTUDOS: HindsightOperation[] = [
  {
    id: "op-1",
    bankId: "estudos",
    operationType: "consolidate",
    status: "completed",
    createdAt: "2026-11-22T10:00:00Z",
    updatedAt: "2026-11-22T10:00:05Z",
    errorMessage: null,
  },
];

const GLOBAL_SEARCH_HITS: HindsightGlobalSearchHit[] = [
  {
    id: "hit-eng-99",
    bankId: "engenharia",
    bankName: "Engenharia",
    text: "Fortinet VPN tunnel monitor integrated into Rust telemetry collector.",
    context: "infra/vpn",
    factType: "world",
    date: "2026-11-22T09:00:00Z",
    documentId: "doc-eng-1",
    entities: ["Fortinet", "Rust"],
    tags: ["telemetry"],
    matchKind: "semantic",
  },
  {
    id: "hit-est-42",
    bankId: "estudos",
    bankName: "Estudos",
    text: "Fortinet NSE4 study notes on IPsec phase 2 selectors.",
    context: "ccnp/ipsec",
    factType: "observation",
    date: "2026-11-20T12:00:00Z",
    documentId: "doc-est-1",
    entities: ["Fortinet", "IPsec"],
    tags: ["security"],
    matchKind: "keyword",
  },
];

function setupOnlineMocks() {
  mockExplore.banksList.mockResolvedValue(BANKS);
  mockExplore.bankStats.mockImplementation(async (bank) => {
    return STATS_BY_BANK[bank] ?? STATS_BY_BANK.estudos;
  });
  mockExplore.memoriesList.mockImplementation(async (bank) => ({
    items: MEMORIES_BY_BANK[bank] ?? [],
    total: (MEMORIES_BY_BANK[bank] ?? []).length,
    limit: 50,
    offset: 0,
  }));
  mockExplore.memoryGet.mockResolvedValue(MEMORY_DETAIL_EST_1);
  mockExplore.documentsList.mockResolvedValue({
    items: DOCUMENTS_ESTUDOS,
    total: DOCUMENTS_ESTUDOS.length,
    limit: 50,
    offset: 0,
  });
  mockExplore.documentGet.mockResolvedValue(DOCUMENT_DETAIL_EST_1);
  mockExplore.entitiesList.mockResolvedValue({
    items: ENTITIES_ESTUDOS,
    total: ENTITIES_ESTUDOS.length,
    limit: 50,
    offset: 0,
  });
  mockExplore.entityGet.mockResolvedValue(ENTITY_DETAIL_FORTINET);
  mockExplore.graph.mockResolvedValue(GRAPH_ESTUDOS);
  mockExplore.mentalModels.mockResolvedValue({
    items: MENTAL_MODELS_ESTUDOS,
    total: MENTAL_MODELS_ESTUDOS.length,
    limit: 25,
    offset: 0,
  });
  mockExplore.globalSearch.mockResolvedValue(GLOBAL_SEARCH_HITS);
  mockExplore.bankCreate.mockResolvedValue({
    id: "arquitetura-cloud",
    name: "Cloud Architecture",
    totalNodes: 0,
    totalLinks: 0,
    totalDocuments: 0,
  });
  mockExplore.memoryRetain.mockResolvedValue(true);
  mockExplore.mentalModelCreate.mockResolvedValue(MENTAL_MODELS_ESTUDOS[0]);
  mockExplore.mentalModelRefresh.mockResolvedValue(true);
  mockExplore.mentalModelDelete.mockResolvedValue(true);
  mockExplore.directivesList.mockResolvedValue(DIRECTIVES_ESTUDOS);
  mockExplore.directiveCreate.mockResolvedValue(DIRECTIVES_ESTUDOS[0]);
  mockExplore.directiveDelete.mockResolvedValue(true);
  mockExplore.operationsList.mockResolvedValue(OPERATIONS_ESTUDOS);
  mockExplore.bankConsolidate.mockResolvedValue(true);
}

describe("HindsightPanelPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows honest offline/empty banner when banksList returns empty or fails", async () => {
    mockExplore.banksList.mockResolvedValueOnce([]);

    render(<HindsightPanelPage />);

    const statusBanner = await screen.findByRole("status");
    expect(
      within(statusBanner).getByText(
        "Hindsight daemon unavailable or no active banks found.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Real Banks (0)")).toBeInTheDocument();
    expect(mockExplore.bankStats).not.toHaveBeenCalled();

    // Verify rejection surfaces diagnostic error in the offline banner
    mockExplore.banksList.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:8919"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("ECONNREFUSED 127.0.0.1:8919")).toBeInTheDocument();
    });
  });

  it("loads multiple banks, switches bank, displays stats breakdown, inspects memory, and opens 3D Galaxy", async () => {
    setupOnlineMocks();
    const onOpenInGalaxy = vi.fn();

    render(<HindsightPanelPage onOpenInGalaxy={onOpenInGalaxy} />);

    expect(await screen.findByText("Real Banks (2)")).toBeInTheDocument();

    // Initial bank ("estudos") stats breakdown and memories
    await waitFor(() => {
      expect(mockExplore.bankStats).toHaveBeenCalledWith("estudos");
      expect(mockExplore.memoriesList).toHaveBeenCalledWith("estudos", null, 50, 0, null);
    });

    expect(await screen.findByText("Pending operations: 2")).toBeInTheDocument();
    expect(screen.getByText("world: 14")).toBeInTheDocument();
    expect(screen.getByText("experience: 6")).toBeInTheDocument();
    expect(screen.getByText("observation: 4")).toBeInTheDocument();
    expect(
      screen.getByText(
        "BGP peering uses AS-PATH prepending to influence inbound routing.",
      ),
    ).toBeInTheDocument();

    // Filter memories by cognitive layer (world)
    fireEvent.click(screen.getByTestId("memory-layer-world"));
    await waitFor(() => {
      expect(mockExplore.memoriesList).toHaveBeenCalledWith(
        "estudos",
        null,
        50,
        0,
        "world",
      );
    });

    // Inspect memory detail
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

    await waitFor(() => {
      expect(mockExplore.memoryGet).toHaveBeenCalledWith("estudos", "mem-est-1");
    });

    expect(await screen.findByText("Source Memories (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Raw lab capture showing AS 65001 prepended twice on uplink."),
    ).toBeInTheDocument();
    expect(screen.getByText("Revision History")).toBeInTheDocument();
    expect(
      screen.getByText("Initial BGP route preference note recorded."),
    ).toBeInTheDocument();

    // Click "Open in 3D Galaxy" from the detail aside
    const galaxyButtons = screen.getAllByRole("button", { name: "Open in 3D Galaxy" });
    fireEvent.click(galaxyButtons[galaxyButtons.length - 1]);
    expect(onOpenInGalaxy).toHaveBeenCalledWith("estudos", "mem-est-1");

    // Switch to "engenharia" bank
    fireEvent.click(screen.getByRole("button", { name: /Engenharia/i }));

    await waitFor(() => {
      expect(mockExplore.bankStats).toHaveBeenCalledWith("engenharia");
      expect(mockExplore.memoriesList).toHaveBeenCalledWith(
        "engenharia",
        null,
        50,
        0,
        "world",
      );
    });

    expect(await screen.findByText("Pending operations: 0")).toBeInTheDocument();
    expect(screen.getByText("world: 11")).toBeInTheDocument();
    expect(screen.getByText("experience: 7")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Rust async runtime on Tauri backend avoids blocking IPC threads.",
      ),
    ).toBeInTheDocument();
  });

  it("navigates documents, entities, interactive SVG graph (World/Experience/Observation layers), and mentalModels tabs", async () => {
    setupOnlineMocks();
    const onOpenInGalaxy = vi.fn();

    const { container } = render(<HindsightPanelPage onOpenInGalaxy={onOpenInGalaxy} />);

    expect(await screen.findByText("Real Banks (2)")).toBeInTheDocument();

    // 1. Documents tab + documentGet originalText
    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    await waitFor(() => {
      expect(mockExplore.documentsList).toHaveBeenCalledWith("estudos", null, 50, 0);
    });

    const docButton = await screen.findByRole("button", { name: /doc-est-1/i });
    fireEvent.click(docButton);

    await waitFor(() => {
      expect(mockExplore.documentGet).toHaveBeenCalledWith("estudos", "doc-est-1");
    });

    expect(await screen.findByText("Original Text")).toBeInTheDocument();
    expect(
      screen.getByText(/Prepending AS-PATH influences external neighbors/i),
    ).toBeInTheDocument();
    expect(screen.getByText("world: 4")).toBeInTheDocument();

    // 2. Entities tab + entityGet observations
    fireEvent.click(screen.getByRole("tab", { name: "Entities" }));
    await waitFor(() => {
      expect(mockExplore.entitiesList).toHaveBeenCalledWith("estudos", 50, 0);
    });

    const entityBtn = await screen.findByRole("button", {
      name: /Fortinet FortiGate/i,
    });
    fireEvent.click(entityBtn);

    await waitFor(() => {
      expect(mockExplore.entityGet).toHaveBeenCalledWith("estudos", "ent-fortinet");
    });

    expect(await screen.findByText("Observations (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Configured SD-WAN SLA health checks over dual WAN links."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Verified BGP neighbor adjacency with FortiOS 7.4."),
    ).toBeInTheDocument();

    // 3. Graph tab + World / Experience / Observation layer switching + SVG node click inspection
    fireEvent.click(screen.getByRole("tab", { name: "Graph" }));
    await waitFor(() => {
      expect(mockExplore.graph).toHaveBeenCalledWith("estudos", 80, null, null);
    });

    // Switch to World Graph, Experience Graph, Observation Graph
    fireEvent.click(screen.getByTestId("graph-layer-world"));
    await waitFor(() => {
      expect(mockExplore.graph).toHaveBeenCalledWith("estudos", 80, null, "world");
    });

    fireEvent.click(screen.getByTestId("graph-layer-experience"));
    await waitFor(() => {
      expect(mockExplore.graph).toHaveBeenCalledWith("estudos", 80, null, "experience");
    });

    fireEvent.click(screen.getByTestId("graph-layer-observation"));
    await waitFor(() => {
      expect(mockExplore.graph).toHaveBeenCalledWith("estudos", 80, null, "observation");
    });

    const svg = await screen.findByLabelText("Graph");
    expect(svg.tagName.toLowerCase()).toBe("svg");

    const svgScope = within(svg as unknown as HTMLElement);
    const bgpNode = svgScope.getByRole("button", {
      name: "BGP Routing",
    });
    fireEvent.click(bgpNode);

    expect(
      await screen.findByText(
        "BGP peering across dual ISP uplinks with local-pref 200.",
      ),
    ).toBeInTheDocument();
    const graphDetailAside = container.querySelector("section aside") as HTMLElement;
    expect(graphDetailAside).not.toBeNull();
    expect(within(graphDetailAside).getByText("Links (1)")).toBeInTheDocument();
    expect(within(graphDetailAside).getByText("Edge Resilience")).toBeInTheDocument();
    expect(svgScope.getByText("Edge Resilience")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open in 3D Galaxy" }));
    expect(onOpenInGalaxy).toHaveBeenCalledWith("estudos", "g-node-1");

    // 4. Mental Models tab + Create / Refresh / Delete
    fireEvent.click(screen.getByRole("tab", { name: "Mental Models" }));
    await waitFor(() => {
      expect(mockExplore.mentalModels).toHaveBeenCalledWith("estudos", 25);
    });

    expect(
      await screen.findByText("Edge Firewall & Routing Playbook"),
    ).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Legacy DNS Caching Notes")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Maintain asymmetric routing protection and bind SLA probes to BGP route-maps.",
      ),
    ).toBeInTheDocument();

    // Create a new mental model
    fireEvent.click(screen.getByTestId("hindsight-new-mental-model-btn"));
    fireEvent.change(screen.getByLabelText("Mental Model Name"), {
      target: { value: "KVM Lab Synthesis" },
    });
    fireEvent.change(screen.getByLabelText("Source Query (Synthesis Prompt)"), {
      target: { value: "Summarize KVM bridges and FortiGate interfaces" },
    });
    fireEvent.click(screen.getByTestId("hindsight-mental-model-submit"));

    await waitFor(() => {
      expect(mockExplore.mentalModelCreate).toHaveBeenCalledWith({
        bank: "estudos",
        name: "KVM Lab Synthesis",
        sourceQuery: "Summarize KVM bridges and FortiGate interfaces",
        customId: null,
        tags: [],
      });
    });

    // Refresh mental model synthesis
    const refreshBtns = screen.getAllByRole("button", { name: "Refresh Synthesis" });
    fireEvent.click(refreshBtns[0]);
    await waitFor(() => {
      expect(mockExplore.mentalModelRefresh).toHaveBeenCalledWith("estudos", "mm-1");
    });
  });

  it("creates a new bank manually, retains a memory, and manages Directives & Operations", async () => {
    setupOnlineMocks();

    render(<HindsightPanelPage />);
    expect(await screen.findByText("Real Banks (2)")).toBeInTheDocument();

    // 1. Create a new bank manually
    fireEvent.click(screen.getByTestId("hindsight-create-bank-btn"));
    fireEvent.change(screen.getByLabelText("Bank ID (slug)"), {
      target: { value: "Arquitetura Cloud" },
    });
    fireEvent.change(screen.getByLabelText("Display Name"), {
      target: { value: "Cloud Architecture" },
    });
    fireEvent.change(screen.getByLabelText("Bank Mission & Context (optional)"), {
      target: { value: "AWS and GCP distributed systems notes" },
    });
    fireEvent.click(screen.getByTestId("hindsight-create-bank-submit"));

    await waitFor(() => {
      expect(mockExplore.bankCreate).toHaveBeenCalledWith({
        bankId: "arquitetura-cloud",
        name: "Cloud Architecture",
        mission: "AWS and GCP distributed systems notes",
        background: "AWS and GCP distributed systems notes",
      });
    });

    // 2. Retain a manual memory
    fireEvent.click(screen.getByTestId("hindsight-retain-btn"));
    fireEvent.change(screen.getByLabelText("Content / Fact to Retain"), {
      target: { value: "CloudFront signed URLs require trusted key groups." },
    });
    fireEvent.change(screen.getByLabelText("Context / Topic (optional)"), {
      target: { value: "aws/cdn" },
    });
    fireEvent.change(screen.getByLabelText("Tags (comma-separated)"), {
      target: { value: "aws, cloudfront" },
    });
    fireEvent.click(screen.getByTestId("hindsight-retain-submit"));

    await waitFor(() => {
      expect(mockExplore.memoryRetain).toHaveBeenCalledWith({
        bank: "arquitetura-cloud",
        content: "CloudFront signed URLs require trusted key groups.",
        context: "aws/cdn",
        tags: ["aws", "cloudfront"],
      });
    });

    // 3. Directives & Operations tab + Consolidate Bank
    fireEvent.click(screen.getByRole("tab", { name: "Directives & Operations" }));
    await waitFor(() => {
      expect(mockExplore.directivesList).toHaveBeenCalledWith("arquitetura-cloud");
      expect(mockExplore.operationsList).toHaveBeenCalledWith("arquitetura-cloud", 20);
    });

    expect(
      await screen.findByText("Literal certification vocabulary"),
    ).toBeInTheDocument();
    expect(screen.getByText("consolidate")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("hindsight-consolidate-btn"));
    await waitFor(() => {
      expect(mockExplore.bankConsolidate).toHaveBeenCalledWith("arquitetura-cloud");
    });
  });

  it("submits Global Search across all banks, switches to globalHits, and opens hit in 3D Galaxy", async () => {
    setupOnlineMocks();
    const onOpenInGalaxy = vi.fn();

    render(<HindsightPanelPage onOpenInGalaxy={onOpenInGalaxy} />);

    expect(await screen.findByText("Real Banks (2)")).toBeInTheDocument();

    const searchInput = screen.getByLabelText(
      "Global search across all banks (e.g., Fortinet, DNS, Rust)...",
    );
    fireEvent.change(searchInput, { target: { value: "  Fortinet  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search All Banks" }));

    await waitFor(() => {
      expect(mockExplore.globalSearch).toHaveBeenCalledWith(
        "Fortinet",
        null,
        null,
        30,
      );
    });

    const globalHitsTab = screen.getByRole("tab", { name: /Global Hits/i });
    expect(globalHitsTab).toHaveAttribute("aria-selected", "true");
    expect(within(globalHitsTab).getByText("2")).toBeInTheDocument();

    expect(
      await screen.findByText(
        "Fortinet VPN tunnel monitor integrated into Rust telemetry collector.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fortinet NSE4 study notes on IPsec phase 2 selectors."),
    ).toBeInTheDocument();

    const galaxyButtons = screen.getAllByRole("button", { name: "Open in 3D Galaxy" });
    expect(galaxyButtons).toHaveLength(2);
    fireEvent.click(galaxyButtons[0]);
    expect(onOpenInGalaxy).toHaveBeenCalledWith("engenharia", "hit-eng-99");

    fireEvent.click(galaxyButtons[1]);
    expect(onOpenInGalaxy).toHaveBeenCalledWith("estudos", "hit-est-42");
  });
});
