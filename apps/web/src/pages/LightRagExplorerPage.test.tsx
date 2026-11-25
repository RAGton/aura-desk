import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import { LightRagExplorerPage } from "./LightRagExplorerPage";
import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentEntry,
  KnowledgeEntityEntry,
  KnowledgeExplorerOverview,
  KnowledgeGraphPayload,
  KnowledgeRelationEntry,
  KnowledgeSearchResult,
} from "../lib/auraTypes";

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    knowledgeApi: {
      ...actual.knowledgeApi,
      overview: vi.fn(),
      documentsList: vi.fn(),
      documentGet: vi.fn(),
      graph: vi.fn(),
      search: vi.fn(),
    },
    raglightApi: {
      ...actual.raglightApi,
      status: vi.fn(),
      provision: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      ingest: vi.fn(),
    },
  };
});

import { knowledgeApi, raglightApi, type RaglightStatus } from "../lib/ipc";

const mockKnowledge = vi.mocked(knowledgeApi);
const mockRaglight = vi.mocked(raglightApi);

const RAGLIGHT_STATUS: RaglightStatus = {
  enabled: true,
  mode: "managed",
  baseUrl: "http://127.0.0.1:8765",
  provider: "ollama",
  embeddingModel: "nomic-embed-text",
  llmModel: "llama3",
  vectorStore: "chroma",
  folders: ["/home/ragton/Docs/Architecture"],
  hasApiKey: false,
  installed: false,
  running: false,
  managedPid: null,
  venvPath: "/home/ragton/.local/share/auradesk/raglight/.venv",
  dbPath: "/home/ragton/.local/share/auradesk/raglight/db",
  pythonTool: null,
};

const OFFLINE_OVERVIEW: KnowledgeExplorerOverview = {
  serviceKind: "offline",
  online: false,
  baseUrl: "http://127.0.0.1:9621",
  documentsCount: 0,
  entitiesCount: 0,
  relationsCount: 0,
  configuredFolders: ["/home/ragton/Docs/Architecture", "/home/ragton/Notes/Security"],
  localFileCount: 0,
  statusCounts: {},
  diagnosticMessage: "Connection refused at http://127.0.0.1:9621/documents",
};

const ONLINE_OVERVIEW: KnowledgeExplorerOverview = {
  serviceKind: "lightrag",
  online: true,
  baseUrl: "http://127.0.0.1:9621",
  documentsCount: 2,
  entitiesCount: 3,
  relationsCount: 2,
  configuredFolders: ["/home/ragton/Docs/Architecture"],
  localFileCount: 14,
  statusCounts: { processed: 2, pending: 0 },
  diagnosticMessage: null,
};

const DOCS_LIST: KnowledgeDocumentEntry[] = [
  {
    id: "doc-arch-1",
    title: "AuraDesk Zero-Trust IPC Guide",
    sourcePath: "/home/ragton/Docs/Architecture/ipc-guide.md",
    status: "processed",
    contentPreview: "Tauri commands enforce typed schemas before accessing SQLite or LightRAG.",
    contentLength: 1280,
    chunksCount: 4,
    entities: ["Tauri IPC", "SQLite"],
    updatedAt: "2026-11-22T10:00:00Z",
    origin: "lightrag",
  },
  {
    id: "doc-rag-2",
    title: "RAGLight Local Vector Indexing",
    sourcePath: "/home/ragton/Docs/Architecture/raglight.md",
    status: "processed",
    contentPreview: "Chroma vector store indexes Markdown and PDF documents locally.",
    contentLength: 920,
    chunksCount: 3,
    entities: ["ChromaDB"],
    updatedAt: "2026-11-22T11:00:00Z",
    origin: "lightrag",
  },
];

const DOC_DETAIL_1: KnowledgeDocumentDetail = {
  id: "doc-arch-1",
  title: "AuraDesk Zero-Trust IPC Guide",
  sourcePath: "/home/ragton/Docs/Architecture/ipc-guide.md",
  content:
    "Full content: Every Tauri command validates inputs in Rust and emits structured errors to React.",
  status: "processed",
  entities: ["Tauri IPC", "SQLite", "Rust Backend"],
  relations: [
    {
      id: "doc-rel-1",
      source: "Tauri IPC",
      target: "Rust Backend",
      description: "Dispatches validated commands to native handlers.",
      keywords: ["ipc", "validation"],
      weight: 1.0,
      sourceId: "doc-arch-1",
    },
  ],
  origin: "lightrag",
};

const GRAPH_ENTITIES: KnowledgeEntityEntry[] = [
  {
    id: "ent-tauri",
    name: "Tauri IPC",
    entityType: "Architecture",
    description: "Typed bridge between React frontend and Rust core.",
    sourceId: "doc-arch-1",
  },
  {
    id: "ent-rust",
    name: "Rust Backend",
    entityType: "Service",
    description: "Hosts Hindsight, LightRAG HTTP clients, and SQLite persistence.",
    sourceId: "doc-arch-1",
  },
  {
    id: "ent-chroma",
    name: "ChromaDB",
    entityType: "Storage",
    description: "Local embedding store for authorized folders.",
    sourceId: "doc-rag-2",
  },
];

const GRAPH_RELATIONS: KnowledgeRelationEntry[] = [
  {
    id: "rel-1",
    source: "ent-tauri",
    target: "ent-rust",
    description: "Routes knowledge_graph and knowledge_search commands.",
    keywords: ["routes", "commands"],
    weight: 0.95,
    sourceId: "doc-arch-1",
  },
  {
    id: "rel-2",
    source: "ent-rust",
    target: "ent-chroma",
    description: "Queries local vector chunks via managed RAGLight sidecar.",
    keywords: ["vector", "sidecar"],
    weight: 0.8,
    sourceId: "doc-rag-2",
  },
];

const ONLINE_GRAPH: KnowledgeGraphPayload = {
  serviceKind: "lightrag",
  online: true,
  entities: GRAPH_ENTITIES,
  relations: GRAPH_RELATIONS,
  diagnosticMessage: null,
};

const SEARCH_RESULT: KnowledgeSearchResult = {
  serviceKind: "lightrag",
  online: true,
  answer:
    "AuraDesk uses Tauri IPC to invoke Rust Backend handlers that query LightRAG and ChromaDB.",
  sources: ["ipc-guide.md", "raglight.md"],
  matchingDocuments: [DOCS_LIST[0]],
  matchingEntities: [GRAPH_ENTITIES[0], GRAPH_ENTITIES[1]],
  matchingRelations: [GRAPH_RELATIONS[0]],
  diagnosticMessage: null,
};

function setupOnlineMocks() {
  mockKnowledge.overview.mockResolvedValue(ONLINE_OVERVIEW);
  mockKnowledge.documentsList.mockResolvedValue({
    serviceKind: "lightrag",
    online: true,
    documents: DOCS_LIST,
    diagnosticMessage: null,
  });
  mockKnowledge.documentGet.mockResolvedValue(DOC_DETAIL_1);
  mockKnowledge.graph.mockResolvedValue(ONLINE_GRAPH);
  mockKnowledge.search.mockResolvedValue(SEARCH_RESULT);
}

describe("LightRagExplorerPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRaglight.status.mockResolvedValue(RAGLIGHT_STATUS);
    const actionResult = (message: string) => ({
      ok: true,
      message,
      outputTail: "",
      status: RAGLIGHT_STATUS,
    });
    mockRaglight.provision.mockResolvedValue(actionResult("raglight_provisioned"));
    mockRaglight.start.mockResolvedValue(actionResult("raglight_started"));
    mockRaglight.stop.mockResolvedValue(actionResult("raglight_stopped"));
    mockRaglight.ingest.mockResolvedValue(actionResult("raglight_ingested"));
  });

  it("renders honest offline diagnostics, configured folders, Settings action, and zero fake documents", async () => {
    const onOpenSettings = vi.fn();
    mockKnowledge.overview.mockResolvedValue(OFFLINE_OVERVIEW);
    mockKnowledge.documentsList.mockResolvedValue({
      serviceKind: "offline",
      online: false,
      documents: [],
      diagnosticMessage: "No LightRAG service reachable",
    });
    mockKnowledge.graph.mockResolvedValue({
      serviceKind: "offline",
      online: false,
      entities: [],
      relations: [],
      diagnosticMessage: "Graph unavailable while offline",
    });

    render(<LightRagExplorerPage onOpenSettings={onOpenSettings} />);

    const statusBanner = await screen.findByRole("status");
    expect(
      within(statusBanner).getByText("Service Offline — No Fake Data"),
    ).toBeInTheDocument();
    expect(
      within(statusBanner).getByText(
        "Connection refused at http://127.0.0.1:9621/documents",
      ),
    ).toBeInTheDocument();
    expect(
      within(statusBanner).getByText("Authorized Folders (2)"),
    ).toBeInTheDocument();
    expect(
      within(statusBanner).getByText("/home/ragton/Docs/Architecture"),
    ).toBeInTheDocument();
    expect(
      within(statusBanner).getByText("/home/ragton/Notes/Security"),
    ).toBeInTheDocument();

    // Verify zero fake documents appear
    expect(screen.queryByText("AuraDesk Zero-Trust IPC Guide")).not.toBeInTheDocument();
    expect(mockKnowledge.documentGet).not.toHaveBeenCalled();
    // A dead service is not asked for anything.
    expect(mockKnowledge.documentsList).not.toHaveBeenCalled();

    // Verify Configure in Settings button triggers onOpenSettings
    fireEvent.click(
      within(statusBanner).getByRole("button", { name: "Configure in Settings" }),
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // The tabs are hidden while the service is down: empty tabs and a
    // search that cannot answer are noise, and the panel above already
    // says what to do.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    // The next step is offered right here: install the managed service.
    const actions = await screen.findByTestId("knowledge-service-actions");
    fireEvent.click(
      within(actions).getByRole("button", { name: "Install RAGLight" }),
    );
    await waitFor(() => {
      expect(mockRaglight.provision).toHaveBeenCalled();
    });
  });

  it("loads documents list and inspects original content and entities via documentGet when online", async () => {
    setupOnlineMocks();

    render(<LightRagExplorerPage />);

    expect(await screen.findByText("LightRAG Connected")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:9621")).toBeInTheDocument();
    expect(screen.getByText("processed: 2")).toBeInTheDocument();
    expect(screen.getByText("Authorized Folders (1)")).toBeInTheDocument();

    const docBtn = await screen.findByRole("button", {
      name: /AuraDesk Zero-Trust IPC Guide/i,
    });
    expect(
      screen.getByRole("button", { name: /RAGLight Local Vector Indexing/i }),
    ).toBeInTheDocument();

    fireEvent.click(docBtn);

    await waitFor(() => {
      expect(mockKnowledge.documentGet).toHaveBeenCalledWith("doc-arch-1");
    });

    expect(
      await screen.findByText(
        "Full content: Every Tauri command validates inputs in Rust and emits structured errors to React.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Entities (3)")).toBeInTheDocument();
    expect(screen.getAllByText("Rust Backend").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Relations (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Dispatches validated commands to native handlers."),
    ).toBeInTheDocument();
  });

  it("inspects entities, highlights connected relations, and traverses to neighbor entity on click", async () => {
    setupOnlineMocks();

    const { container } = render(<LightRagExplorerPage />);
    expect(await screen.findByText("LightRAG Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Entities & Relations" }));
    await waitFor(() => {
      expect(mockKnowledge.graph).toHaveBeenCalledTimes(1);
    });

    const tauriEntityBtn = await screen.findByRole("button", { name: /Tauri IPC/i });
    fireEvent.click(tauriEntityBtn);

    expect(await screen.findByText("Connected Relations (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Routes knowledge_graph and knowledge_search commands."),
    ).toBeInTheDocument();
    expect(screen.getByText("routes")).toBeInTheDocument();
    expect(screen.getByText("commands")).toBeInTheDocument();

    // Traverse by clicking the neighbor key button ("ent-rust")
    fireEvent.click(screen.getByRole("button", { name: "ent-rust" }));

    expect(await screen.findByText("Connected Relations (2)")).toBeInTheDocument();
    const detailAside = container.querySelector("aside") as HTMLElement;
    expect(detailAside).not.toBeNull();
    expect(
      within(detailAside).getByRole("heading", { name: "Rust Backend" }),
    ).toBeInTheDocument();
    expect(
      within(detailAside).getByText(
        "Hosts Hindsight, LightRAG HTTP clients, and SQLite persistence.",
      ),
    ).toBeInTheDocument();
    expect(
      within(detailAside).getByText(
        "Queries local vector chunks via managed RAGLight sidecar.",
      ),
    ).toBeInTheDocument();
  });

  it("renders interactive SVG Knowledge Graph with nodes and edges and inspects selected node", async () => {
    setupOnlineMocks();

    const { container } = render(<LightRagExplorerPage />);
    expect(await screen.findByText("LightRAG Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Knowledge Graph" }));
    await waitFor(() => {
      expect(mockKnowledge.graph).toHaveBeenCalled();
    });

    const svg = await screen.findByLabelText("Knowledge Graph");
    expect(svg.tagName.toLowerCase()).toBe("svg");

    expect(screen.getByText("Entities: 3 · Relations: 2")).toBeInTheDocument();
    expect(container.querySelectorAll("svg line")).toHaveLength(2);

    const svgScope = within(svg as unknown as HTMLElement);
    const rustNode = svgScope.getByRole("button", { name: "Rust Backend" });
    expect(svgScope.getByRole("button", { name: "Tauri IPC" })).toBeInTheDocument();
    expect(svgScope.getByRole("button", { name: "ChromaDB" })).toBeInTheDocument();

    fireEvent.click(rustNode);

    expect(await screen.findByText("Connected Relations (2)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hosts Hindsight, LightRAG HTTP clients, and SQLite persistence.",
      ),
    ).toBeInTheDocument();

    // Highlighted relation keywords appear as SVG labels when node is selected
    expect(svgScope.getByText("routes")).toBeInTheDocument();
    expect(svgScope.getByText("vector")).toBeInTheDocument();
  });

  it("runs Global Search and renders answer, matching documents, entities, and relations", async () => {
    setupOnlineMocks();

    render(<LightRagExplorerPage />);
    expect(await screen.findByText("LightRAG Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Global Search" }));

    const searchInput = screen.getByLabelText(
      "Query documents, entities, and relations...",
    );
    fireEvent.change(searchInput, { target: { value: "  Tauri IPC  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(mockKnowledge.search).toHaveBeenCalledWith("Tauri IPC", 10);
    });

    expect(
      await screen.findByText(
        "AuraDesk uses Tauri IPC to invoke Rust Backend handlers that query LightRAG and ChromaDB.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ipc-guide.md")).toBeInTheDocument();
    expect(screen.getByText("raglight.md")).toBeInTheDocument();

    expect(screen.getByText("Documents (1)")).toBeInTheDocument();
    expect(screen.getByText("AuraDesk Zero-Trust IPC Guide")).toBeInTheDocument();

    expect(screen.getByText("Entities (2)")).toBeInTheDocument();
    expect(screen.getByText("Tauri IPC")).toBeInTheDocument();
    expect(screen.getByText("Rust Backend")).toBeInTheDocument();

    expect(screen.getByText("Relations (1)")).toBeInTheDocument();
    expect(
      screen.getByText("Routes knowledge_graph and knowledge_search commands."),
    ).toBeInTheDocument();
  });
});
