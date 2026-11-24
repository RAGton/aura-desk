import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  HindsightGraphView,
  linkTypeLabel,
} from "../features/hindsight/HindsightGraphView";
import {
  Activity,
  AlertTriangle,
  Brain,
  Clock,
  Database,
  FileText,
  History,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Textarea,
} from "../components/ui";
import {
  hindsightApi,
  hindsightExploreApi,
  type HindsightBankStats,
  type HindsightBankSummary,
  type HindsightDirective,
  type HindsightDocumentDetail,
  type HindsightDocumentItem,
  type HindsightEntityDetail,
  type HindsightEntityItem,
  type HindsightGlobalSearchHit,
  type HindsightGraphEdge,
  type HindsightGraphNode,
  type HindsightGraphPayload,
  type HindsightMemoryDetail,
  type HindsightMemoryItem,
  type HindsightMentalModel,
  type HindsightOperation,
  type HindsightStatus,
} from "../lib/ipc";

export interface HindsightPanelPageProps {
  initialBank?: string | null;
  onOpenInGalaxy?: (bankId: string, memoryId: string) => void;
}

type HindsightTab =
  | "memories"
  | "documents"
  | "entities"
  | "graph"
  | "mentalModels"
  | "directivesOps"
  | "globalHits";

type CognitiveLayerFilter = "" | "world" | "experience" | "observation";

interface Point2D {
  x: number;
  y: number;
}

const GRAPH_WIDTH = 800;
const GRAPH_HEIGHT = 480;

function formatDate(raw?: string | null): string {
  if (!raw) return "—";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw.slice(0, 19);
  return dt.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function factTypeVariant(factType?: string | null) {
  switch ((factType ?? "").toLowerCase()) {
    case "world":
      return "info" as const;
    case "experience":
      return "success" as const;
    case "observation":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function parseTagsCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function computeConstellationLayout(
  nodes: HindsightGraphNode[],
  edges: HindsightGraphEdge[],
): Record<string, Point2D> {
  const positions: Record<string, Point2D> = {};
  if (nodes.length === 0) return positions;

  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    if (degree.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    if (degree.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const ordered = [...nodes].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
  );

  const cx = GRAPH_WIDTH / 2;
  const cy = GRAPH_HEIGHT / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  ordered.forEach((node, idx) => {
    const ratio = ordered.length === 1 ? 0 : Math.sqrt((idx + 0.5) / ordered.length);
    const angle = idx * goldenAngle;
    const rx = ratio * (GRAPH_WIDTH * 0.39);
    const ry = ratio * (GRAPH_HEIGHT * 0.39);
    positions[node.id] = {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    };
  });

  if (nodes.length > 1) {
    const disp: Record<string, Point2D> = {};
    const area = GRAPH_WIDTH * GRAPH_HEIGHT;
    const k = Math.sqrt(area / nodes.length) * 0.65;

    for (let iter = 0; iter < 40; iter += 1) {
      for (const n of nodes) {
        disp[n.id] = { x: 0, y: 0 };
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const u = nodes[i];
        const pu = positions[u.id];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const v = nodes[j];
          const pv = positions[v.id];
          const dx = pu.x - pv.x;
          const dy = pu.y - pv.y;
          const dist = Math.max(12, Math.hypot(dx, dy));
          const force = (k * k) / dist;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          disp[u.id].x += fx;
          disp[u.id].y += fy;
          disp[v.id].x -= fx;
          disp[v.id].y -= fy;
        }
      }

      for (const e of edges) {
        const ps = positions[e.source];
        const pt = positions[e.target];
        if (!ps || !pt || e.source === e.target) continue;
        const dx = ps.x - pt.x;
        const dy = ps.y - pt.y;
        const dist = Math.max(12, Math.hypot(dx, dy));
        const force = (dist * dist) / Math.max(1, k * 2.2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[e.source].x -= fx;
        disp[e.source].y -= fy;
        disp[e.target].x += fx;
        disp[e.target].y += fy;
      }

      const maxStep = Math.max(2, 18 * (1 - iter / 40));
      for (const n of nodes) {
        const d = disp[n.id];
        const len = Math.hypot(d.x, d.y);
        if (len > 0) {
          const step = Math.min(len, maxStep);
          positions[n.id].x = Math.min(
            GRAPH_WIDTH - 68,
            Math.max(68, positions[n.id].x + (d.x / len) * step),
          );
          positions[n.id].y = Math.min(
            GRAPH_HEIGHT - 44,
            Math.max(44, positions[n.id].y + (d.y / len) * step),
          );
        }
      }
    }
  }

  return positions;
}

export function HindsightPanelPage({
  initialBank = null,
  onOpenInGalaxy,
}: HindsightPanelPageProps) {
  const { t } = useTranslation();

  const [banks, setBanks] = useState<HindsightBankSummary[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [selectedBank, setSelectedBank] = useState<string | null>(initialBank ?? null);

  const [bankStats, setBankStats] = useState<HindsightBankStats | null>(null);
  const [hindsightStatus, setHindsightStatus] = useState<HindsightStatus | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [consolidatingBank, setConsolidatingBank] = useState(false);

  const [activeTab, setActiveTab] = useState<HindsightTab>("memories");

  // Create Bank form state
  const [showCreateBankForm, setShowCreateBankForm] = useState(false);
  // Bank lifecycle: rename / delete.
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editingBankName, setEditingBankName] = useState("");
  const [bankBusyId, setBankBusyId] = useState<string | null>(null);
  const [newBankId, setNewBankId] = useState("");
  const [newBankName, setNewBankName] = useState("");
  const [newBankMission, setNewBankMission] = useState("");
  const [creatingBank, setCreatingBank] = useState(false);

  // Global search state
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalBankFilter, setGlobalBankFilter] = useState("");
  const [globalFactTypeFilter, setGlobalFactTypeFilter] = useState("");
  const [globalHits, setGlobalHits] = useState<HindsightGlobalSearchHit[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [globalSearched, setGlobalSearched] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Per-bank tab state: Memories + Retain Form
  const [memories, setMemories] = useState<HindsightMemoryItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [memoryFactType, setMemoryFactType] = useState<CognitiveLayerFilter>("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [selectedMemory, setSelectedMemory] = useState<HindsightMemoryDetail | null>(null);
  const [loadingMemoryDetail, setLoadingMemoryDetail] = useState(false);

  const [showRetainForm, setShowRetainForm] = useState(false);
  const [retainContent, setRetainContent] = useState("");
  const [retainContext, setRetainContext] = useState("");
  const [retainTags, setRetainTags] = useState("");
  const [retainingMemory, setRetainingMemory] = useState(false);

  // Documents
  const [documents, setDocuments] = useState<HindsightDocumentItem[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<HindsightDocumentDetail | null>(null);
  const [loadingDocumentDetail, setLoadingDocumentDetail] = useState(false);

  // Entities
  const [entities, setEntities] = useState<HindsightEntityItem[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<HindsightEntityDetail | null>(null);
  const [loadingEntityDetail, setLoadingEntityDetail] = useState(false);

  // Graph (World / Experience / Observation switcher + filters)
  const [graphPayload, setGraphPayload] = useState<HindsightGraphPayload | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graphFactType, setGraphFactType] = useState<CognitiveLayerFilter>("");
  const [graphQuery, setGraphQuery] = useState("");
  const [graphLinkTypeFilter, setGraphLinkTypeFilter] = useState("");
  // How many nodes the graph shows. The backend clamps this to 200.
  const [graphNodeLimit, setGraphNodeLimit] = useState(60);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);

  // Mental Models + Create / Refresh / Delete
  const [mentalModels, setMentalModels] = useState<HindsightMentalModel[]>([]);
  const [loadingMentalModels, setLoadingMentalModels] = useState(false);
  const [showMentalModelForm, setShowMentalModelForm] = useState(false);
  const [mmName, setMmName] = useState("");
  const [mmQuery, setMmQuery] = useState("");
  const [mmCustomId, setMmCustomId] = useState("");
  const [mmTags, setMmTags] = useState("");
  const [creatingMentalModel, setCreatingMentalModel] = useState(false);
  const [refreshingModelId, setRefreshingModelId] = useState<string | null>(null);

  // Directives & Operations
  const [directives, setDirectives] = useState<HindsightDirective[]>([]);
  const [operations, setOperations] = useState<HindsightOperation[]>([]);
  const [loadingDirectivesOps, setLoadingDirectivesOps] = useState(false);
  const [showDirectiveForm, setShowDirectiveForm] = useState(false);
  const [dirName, setDirName] = useState("");
  const [dirContent, setDirContent] = useState("");
  const [savingDirective, setSavingDirective] = useState(false);

  const [tabError, setTabError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadBanks = useCallback(async () => {
    setLoadingBanks(true);
    setBanksError(null);
    try {
      const list = await hindsightExploreApi.banksList();
      const normalized = Array.isArray(list) ? list : [];
      setBanks(normalized);
      setSelectedBank((prev) => {
        if (initialBank && normalized.some((b) => b.id === initialBank)) {
          return initialBank;
        }
        if (prev && normalized.some((b) => b.id === prev)) {
          return prev;
        }
        return normalized[0]?.id ?? null;
      });
    } catch (err) {
      setBanks([]);
      setSelectedBank(null);
      setBanksError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBanks(false);
    }
  }, [initialBank]);

  useEffect(() => {
    void loadBanks();
  }, [loadBanks]);

  // The daemon's own health, so the screen can say what is wrong instead of
  // showing an empty list.
  useEffect(() => {
    let active = true;
    void hindsightApi
      .status()
      .then((status) => {
        if (active) setHindsightStatus(status);
      })
      .catch(() => {
        if (active) setHindsightStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialBank && banks.some((b) => b.id === initialBank)) {
      setSelectedBank(initialBank);
    }
  }, [initialBank, banks]);

  // Clear stale inspections and load active bank stats when bank changes
  useEffect(() => {
    setSelectedMemory(null);
    setSelectedDocument(null);
    setSelectedEntity(null);
    setSelectedGraphNodeId(null);

    if (!selectedBank) {
      setBankStats(null);
      return;
    }

    let active = true;
    setLoadingStats(true);
    void hindsightExploreApi
      .bankStats(selectedBank)
      .then((stats) => {
        if (active) setBankStats(stats);
      })
      .catch(() => {
        if (active) setBankStats(null);
      })
      .finally(() => {
        if (active) setLoadingStats(false);
      });

    return () => {
      active = false;
    };
  }, [selectedBank, refreshNonce]);

  // Load per-bank active tab data
  useEffect(() => {
    if (!selectedBank || activeTab === "globalHits") return;

    let active = true;
    setTabError(null);

    if (activeTab === "memories") {
      setLoadingMemories(true);
      void hindsightExploreApi
        .memoriesList(
          selectedBank,
          memoryQuery.trim() || null,
          50,
          0,
          memoryFactType || null,
        )
        .then((page) => {
          if (active) setMemories(Array.isArray(page?.items) ? page.items : []);
        })
        .catch((err) => {
          if (active) {
            setMemories([]);
            setTabError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (active) setLoadingMemories(false);
        });
    } else if (activeTab === "documents") {
      setLoadingDocuments(true);
      void hindsightExploreApi
        .documentsList(selectedBank, null, 50, 0)
        .then((page) => {
          if (active) setDocuments(Array.isArray(page?.items) ? page.items : []);
        })
        .catch((err) => {
          if (active) {
            setDocuments([]);
            setTabError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (active) setLoadingDocuments(false);
        });
    } else if (activeTab === "entities") {
      setLoadingEntities(true);
      void hindsightExploreApi
        .entitiesList(selectedBank, 50, 0)
        .then((page) => {
          if (active) setEntities(Array.isArray(page?.items) ? page.items : []);
        })
        .catch((err) => {
          if (active) {
            setEntities([]);
            setTabError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (active) setLoadingEntities(false);
        });
    } else if (activeTab === "graph") {
      setLoadingGraph(true);
      void hindsightExploreApi
        .graph(
          selectedBank,
          graphNodeLimit,
          graphQuery.trim() || null,
          graphFactType || null,
        )
        .then((payload) => {
          if (active) {
            setGraphPayload(payload ?? { nodes: [], edges: [], totalUnits: 0 });
          }
        })
        .catch((err) => {
          if (active) {
            setGraphPayload({ nodes: [], edges: [], totalUnits: 0 });
            setTabError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (active) setLoadingGraph(false);
        });
    } else if (activeTab === "mentalModels") {
      setLoadingMentalModels(true);
      void hindsightExploreApi
        .mentalModels(selectedBank, 25)
        .then((page) => {
          if (active) setMentalModels(Array.isArray(page?.items) ? page.items : []);
        })
        .catch((err) => {
          if (active) {
            setMentalModels([]);
            setTabError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (active) setLoadingMentalModels(false);
        });
    } else if (activeTab === "directivesOps") {
      setLoadingDirectivesOps(true);
      void Promise.all([
        hindsightExploreApi.directivesList(selectedBank),
        hindsightExploreApi.operationsList(selectedBank, 20),
      ])
        .then(([dirs, ops]) => {
          if (active) {
            setDirectives(Array.isArray(dirs) ? dirs : []);
            setOperations(Array.isArray(ops) ? ops : []);
          }
        })
        .catch((err) => {
          if (active) {
            setDirectives([]);
            setOperations([]);
            setTabError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (active) setLoadingDirectivesOps(false);
        });
    }

    return () => {
      active = false;
    };
  }, [
    selectedBank,
    activeTab,
    refreshNonce,
    memoryFactType,
    memoryQuery,
    graphFactType,
    graphNodeLimit,
    graphQuery,
  ]);

  const handleRefresh = () => {
    void loadBanks();
    setRefreshNonce((n) => n + 1);
  };

  /** Renames a bank. The id never changes — only its display name. */
  const handleRenameBank = async () => {
    const bankId = editingBankId;
    const name = editingBankName.trim();
    if (!bankId || !name) return;

    setBankBusyId(bankId);
    setTabError(null);
    try {
      await hindsightExploreApi.bankUpdate({ bankId, name });
      setEditingBankId(null);
      setEditingBankName("");
      await loadBanks();
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setBankBusyId(null);
    }
  };

  /** Deletes a bank and everything it holds. */
  const handleDeleteBank = async (bankId: string) => {
    setBankBusyId(bankId);
    setTabError(null);
    try {
      await hindsightExploreApi.bankDelete(bankId);
      if (selectedBank === bankId) {
        setSelectedBank("");
        setSelectedGraphNodeId(null);
        setSelectedMemory(null);
      }
      setEditingBankId(null);
      setEditingBankName("");
      await loadBanks();
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setBankBusyId(null);
    }
  };

  const handleCreateBank = async (e: FormEvent) => {
    e.preventDefault();
    const cleanId = newBankId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!cleanId) return;

    setCreatingBank(true);
    setTabError(null);
    try {
      const created = await hindsightExploreApi.bankCreate({
        bankId: cleanId,
        name: newBankName.trim() || cleanId,
        mission: newBankMission.trim() || null,
        background: newBankMission.trim() || null,
      });
      setShowCreateBankForm(false);
      setNewBankId("");
      setNewBankName("");
      setNewBankMission("");
      await loadBanks();
      setSelectedBank(created?.id || cleanId);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingBank(false);
    }
  };

  const handleConsolidateBank = async () => {
    if (!selectedBank) return;
    setConsolidatingBank(true);
    setTabError(null);
    try {
      await hindsightExploreApi.bankConsolidate(selectedBank);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setConsolidatingBank(false);
    }
  };

  const handleRetainMemory = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBank || !retainContent.trim()) return;
    setRetainingMemory(true);
    setTabError(null);
    try {
      await hindsightExploreApi.memoryRetain({
        bank: selectedBank,
        content: retainContent.trim(),
        context: retainContext.trim() || null,
        tags: parseTagsCsv(retainTags),
      });
      setRetainContent("");
      setRetainContext("");
      setRetainTags("");
      setShowRetainForm(false);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetainingMemory(false);
    }
  };

  const handleCreateMentalModel = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBank || !mmName.trim() || !mmQuery.trim()) return;
    setCreatingMentalModel(true);
    setTabError(null);
    try {
      await hindsightExploreApi.mentalModelCreate({
        bank: selectedBank,
        name: mmName.trim(),
        sourceQuery: mmQuery.trim(),
        customId: mmCustomId.trim() || null,
        tags: parseTagsCsv(mmTags),
      });
      setMmName("");
      setMmQuery("");
      setMmCustomId("");
      setMmTags("");
      setShowMentalModelForm(false);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingMentalModel(false);
    }
  };

  const handleRefreshMentalModel = async (modelId: string) => {
    if (!selectedBank) return;
    setRefreshingModelId(modelId);
    setTabError(null);
    try {
      await hindsightExploreApi.mentalModelRefresh(selectedBank, modelId);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingModelId(null);
    }
  };

  const handleDeleteMentalModel = async (modelId: string) => {
    if (!selectedBank) return;
    setTabError(null);
    try {
      await hindsightExploreApi.mentalModelDelete(selectedBank, modelId);
      setMentalModels((prev) => prev.filter((m) => m.id !== modelId));
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateDirective = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBank || !dirName.trim() || !dirContent.trim()) return;
    setSavingDirective(true);
    setTabError(null);
    try {
      await hindsightExploreApi.directiveCreate({
        bank: selectedBank,
        name: dirName.trim(),
        content: dirContent.trim(),
      });
      setDirName("");
      setDirContent("");
      setShowDirectiveForm(false);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDirective(false);
    }
  };

  const handleDeleteDirective = async (directiveId: string) => {
    if (!selectedBank) return;
    setTabError(null);
    try {
      await hindsightExploreApi.directiveDelete(selectedBank, directiveId);
      setDirectives((prev) => prev.filter((d) => d.id !== directiveId));
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGlobalSearch = async (e: FormEvent) => {
    e.preventDefault();
    setGlobalSearching(true);
    setGlobalSearched(true);
    setGlobalError(null);
    setActiveTab("globalHits");
    try {
      const hits = await hindsightExploreApi.globalSearch(
        globalQuery.trim(),
        globalBankFilter || null,
        globalFactTypeFilter || null,
        30,
      );
      setGlobalHits(Array.isArray(hits) ? hits : []);
    } catch (err) {
      setGlobalHits([]);
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setGlobalSearching(false);
    }
  };

  const handleInspectMemory = async (bankId: string, memoryId: string) => {
    setLoadingMemoryDetail(true);
    setTabError(null);
    try {
      const detail = await hindsightExploreApi.memoryGet(bankId, memoryId);
      setSelectedMemory(detail);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMemoryDetail(false);
    }
  };

  const handleSelectDocument = async (documentId: string) => {
    if (!selectedBank) return;
    setLoadingDocumentDetail(true);
    setTabError(null);
    try {
      const detail = await hindsightExploreApi.documentGet(selectedBank, documentId);
      setSelectedDocument(detail);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDocumentDetail(false);
    }
  };

  const handleSelectEntity = async (entityId: string) => {
    if (!selectedBank) return;
    setLoadingEntityDetail(true);
    setTabError(null);
    try {
      const detail = await hindsightExploreApi.entityGet(selectedBank, entityId);
      setSelectedEntity(detail);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEntityDetail(false);
    }
  };

  const handleLayerBadgeClick = (layer: CognitiveLayerFilter) => {
    if (activeTab === "graph") {
      setGraphFactType(layer);
    } else if (activeTab === "memories") {
      setMemoryFactType(layer);
    } else {
      setGraphFactType(layer);
      setActiveTab("graph");
    }
  };

  const graphNodes = graphPayload?.nodes ?? [];
  const graphEdges = useMemo(() => {
    const allEdges = graphPayload?.edges ?? [];
    if (!graphLinkTypeFilter) return allEdges;
    return allEdges.filter(
      (e) => (e.linkType ?? "").toLowerCase() === graphLinkTypeFilter.toLowerCase(),
    );
  }, [graphPayload?.edges, graphLinkTypeFilter]);

  /**
   * The link types that actually exist in this bank, with the ones the
   * backend reports first. The filter is data-driven instead of a fixed
   * list of four options that may not exist.
   */
  const graphLinkTypes = useMemo(() => {
    const fromStats = Object.keys(bankStats?.linksByLinkType ?? {});
    const fromEdges = new Set(
      (graphPayload?.edges ?? [])
        .map((edge) => edge.linkType)
        .filter((value): value is string => Boolean(value))
    );
    const all = Array.from(new Set([...fromStats, ...fromEdges]));
    // Keep a sensible order for the known types, then the rest.
    const preferred = ["semantic", "temporal", "entity", "caused_by"];
    return [
      ...preferred.filter((type) => all.includes(type)),
      ...all.filter((type) => !preferred.includes(type)).sort(),
    ];
  }, [bankStats?.linksByLinkType, graphPayload?.edges]);

  // The geometry is computed from the full edge set: filtering by link type
  // then only changes what is drawn, not where the nodes sit.
  const nodePositions = useMemo(
    () => computeConstellationLayout(graphNodes, graphPayload?.edges ?? []),
    [graphNodes, graphPayload?.edges],
  );

  const selectedGraphNode = useMemo(
    () => graphNodes.find((n) => n.id === selectedGraphNodeId) ?? null,
    [graphNodes, selectedGraphNodeId],
  );

  const connectedGraphEdges = useMemo(() => {
    if (!selectedGraphNodeId) return [];
    return graphEdges.filter(
      (e) => e.source === selectedGraphNodeId || e.target === selectedGraphNodeId,
    );
  }, [graphEdges, selectedGraphNodeId]);

  const tabItems: Array<{ id: HindsightTab; label: string; badge?: number }> = [
    { id: "memories", label: t("hindsightPanel.tabs.memories") },
    { id: "graph", label: t("hindsightPanel.tabs.graph") },
    { id: "mentalModels", label: t("hindsightPanel.tabs.mentalModels") },
    { id: "documents", label: t("hindsightPanel.tabs.documents") },
    { id: "entities", label: t("hindsightPanel.tabs.entities") },
    { id: "directivesOps", label: t("hindsightPanel.tabs.directivesOps") },
    {
      id: "globalHits",
      label: t("hindsightPanel.tabs.globalHits"),
      badge: globalSearched ? globalHits.length : undefined,
    },
  ];

  const isOffline = !loadingBanks && banks.length === 0;
  const activeLayerFilter =
    activeTab === "graph" ? graphFactType : activeTab === "memories" ? memoryFactType : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl aura-glass p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-aura-primary">
            <Brain className="h-5 w-5 text-aura-accent" aria-hidden="true" />
            {t("hindsightPanel.title")}
          </h2>
          <p className="mt-1 text-xs text-aura-text-muted">
            {t("hindsightPanel.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            data-testid="hindsight-create-bank-btn"
            onClick={() => setShowCreateBankForm((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("hindsightPanel.createBank.button")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            loading={loadingBanks}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("hindsightPanel.refresh")}
          </Button>
        </div>
      </div>

      {/* Create New Bank Panel */}
      {showCreateBankForm && (
        <form
          onSubmit={handleCreateBank}
          data-testid="hindsight-create-bank-form"
          className="rounded-aura-lg border border-aura-accent/50 bg-aura-surface/90 p-4 shadow-aura-surface space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-aura-primary">
              <Database className="h-4 w-4 text-aura-accent" aria-hidden="true" />
              {t("hindsightPanel.createBank.title")}
            </h3>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setShowCreateBankForm(false)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t("hindsightPanel.createBank.cancel")}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label={t("hindsightPanel.createBank.idLabel")}
              value={newBankId}
              onChange={(e) => setNewBankId(e.target.value)}
              placeholder={t("hindsightPanel.createBank.idPlaceholder")}
              required
            />
            <Input
              label={t("hindsightPanel.createBank.nameLabel")}
              value={newBankName}
              onChange={(e) => setNewBankName(e.target.value)}
              placeholder={t("hindsightPanel.createBank.namePlaceholder")}
            />
          </div>

          <Textarea
            label={t("hindsightPanel.createBank.missionLabel")}
            value={newBankMission}
            onChange={(e) => setNewBankMission(e.target.value)}
            placeholder={t("hindsightPanel.createBank.missionPlaceholder")}
            rows={2}
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowCreateBankForm(false)}
            >
              {t("hindsightPanel.createBank.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={creatingBank}
              data-testid="hindsight-create-bank-submit"
            >
              {creatingBank
                ? t("hindsightPanel.createBank.creating")
                : t("hindsightPanel.createBank.submit")}
            </Button>
          </div>
        </form>
      )}

      {/* Global Search across all banks */}
      <form
        onSubmit={handleGlobalSearch}
        className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 shadow-aura-surface"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            containerClassName="flex-1 min-w-0"
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder={t("hindsightPanel.globalSearchPlaceholder")}
            aria-label={t("hindsightPanel.globalSearchPlaceholder")}
          />

          <Select
            containerClassName="w-full lg:w-48"
            value={globalBankFilter}
            onChange={(e) => setGlobalBankFilter(e.target.value)}
            aria-label={t("hindsightPanel.allBanks")}
          >
            <option value="">{t("hindsightPanel.allBanks")}</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}
              </option>
            ))}
          </Select>

          <Select
            containerClassName="w-full lg:w-40"
            value={globalFactTypeFilter}
            onChange={(e) => setGlobalFactTypeFilter(e.target.value)}
            aria-label={t("hindsightPanel.allFactTypes")}
          >
            <option value="">{t("hindsightPanel.allFactTypes")}</option>
            <option value="world">world</option>
            <option value="experience">experience</option>
            <option value="observation">observation</option>
          </Select>

          <Button type="submit" variant="primary" loading={globalSearching}>
            <Search className="h-4 w-4" aria-hidden="true" />
            {t("hindsightPanel.searchButton")}
          </Button>
        </div>
      </form>

      {/* Honest Offline Banner */}
      {isOffline && (
        <div
          role="status"
          className="flex flex-wrap items-start justify-between gap-3 rounded-aura-lg border border-aura-warning/40 bg-aura-warning/10 p-4 text-sm text-aura-primary"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-aura-warning"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="font-semibold text-aura-warning">
                {t("hindsightPanel.offlineBanner")}
              </p>
              {banksError && (
                <p className="font-mono text-xs text-aura-text-muted break-all">
                  {banksError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {loadingBanks && banks.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <div className="lg:col-span-8">
            <Skeleton className="h-72" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Sidebar: Real Banks + Active Bank Stats */}
          <aside className="space-y-4 lg:col-span-4 xl:col-span-3">
            {/* Health strip: what the daemon reports about itself. */}
            {hindsightStatus && (
              <div
                className={`rounded-aura-lg border p-3 text-[11px] ${
                  hindsightStatus.enabled && hindsightStatus.online
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                    : "border-rose-400/30 bg-rose-500/10 text-rose-200"
                }`}
                data-testid="hindsight-health-strip"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {hindsightStatus.enabled && hindsightStatus.online
                      ? t("hindsightPanel.health.online")
                      : t("hindsightPanel.health.offline")}
                  </span>
                  <span className="font-mono text-[10px] opacity-80">
                    {hindsightStatus.banks.length} {t("hindsightPanel.health.banks")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 opacity-90">
                  <span>{t("hindsightPanel.health.localMemories")}: {hindsightStatus.localCount}</span>
                  <span>
                    {t("hindsightPanel.health.dailyMaintenance")}:{" "}
                    {hindsightStatus.dailyMaintenance
                      ? t("hindsightPanel.health.on")
                      : t("hindsightPanel.health.off")}
                  </span>
                  {hindsightStatus.lastMaintenanceDate && (
                    <span>
                      {t("hindsightPanel.health.lastMaintenance")}:{" "}
                      {hindsightStatus.lastMaintenanceDate}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-aura-secondary">
                  <Database className="h-3.5 w-3.5 text-aura-accent" aria-hidden="true" />
                  {t("hindsightPanel.banksTitle", { count: banks.length })}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateBankForm((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-aura-sm border border-aura-accent/40 bg-aura-accent/10 px-2 py-0.5 text-[11px] font-medium text-aura-accent hover:bg-aura-accent/20 transition-colors"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {t("hindsightPanel.createBank.button")}
                </button>
              </div>

              {banks.length === 0 ? (
                <EmptyState
                  icon={<Database className="h-5 w-5" />}
                  title={t("hindsightPanel.offlineBanner")}
                />
              ) : (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {banks.map((bank) => {
                    const active = bank.id === selectedBank;
                    return (
                      <div
                        key={bank.id}
                        className={`group relative rounded-aura-md border p-3 transition-colors ${
                          active
                            ? "border-aura-accent/70 bg-aura-accent/10"
                            : "border-aura-border/40 bg-aura-canvas/40 hover:border-aura-border-strong/70 hover:bg-aura-surface"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBank(bank.id);
                            if (activeTab === "globalHits") {
                              setActiveTab("memories");
                            }
                          }}
                          className="block w-full text-left"
                        >
                        <div className="flex items-center justify-between gap-2">
                          {editingBankId === bank.id ? (
                            <Input
                              containerClassName="flex-1"
                              value={editingBankName}
                              autoFocus
                              onChange={(e) => setEditingBankName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleRenameBank();
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  setEditingBankId(null);
                                  setEditingBankName("");
                                }
                              }}
                              aria-label={t("hindsightPanel.banks.rename")}
                            />
                          ) : (
                            <span className="truncate text-sm font-semibold text-aura-primary">
                              {bank.name || bank.id}
                            </span>
                          )}
                          {editingBankId !== bank.id && bank.name && bank.name !== bank.id && (
                            <span className="shrink-0 font-mono text-[10px] text-aura-text-muted">
                              {bank.id}
                            </span>
                          )}
                        </div>

                        {editingBankId === bank.id && (
                          <div className="mt-2 flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingBankId(null);
                                setEditingBankName("");
                              }}
                              className="h-6 rounded-full px-2.5 text-[10px]"
                            >
                              {t("common.cancel", { defaultValue: "Cancel" })}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              data-testid="hindsight-bank-save-btn"
                              loading={bankBusyId === bank.id}
                              onClick={() => void handleRenameBank()}
                              disabled={!editingBankName.trim()}
                              className="h-6 rounded-full px-2.5 text-[10px]"
                            >
                              {t("common.save", { defaultValue: "Save" })}
                            </Button>
                          </div>
                        )}
                        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                          <div className="rounded-aura-sm bg-aura-surface/80 px-2 py-1">
                            <div className="text-aura-text-muted">
                              {t("hindsightPanel.totalNodes")}
                            </div>
                            <div className="font-semibold text-aura-primary tabular-nums">
                              {bank.totalNodes}
                            </div>
                          </div>
                          <div className="rounded-aura-sm bg-aura-surface/80 px-2 py-1">
                            <div className="text-aura-text-muted">
                              {t("hindsightPanel.totalLinks")}
                            </div>
                            <div className="font-semibold text-aura-primary tabular-nums">
                              {bank.totalLinks}
                            </div>
                          </div>
                          <div className="rounded-aura-sm bg-aura-surface/80 px-2 py-1">
                            <div className="text-aura-text-muted">
                              {t("hindsightPanel.totalDocs")}
                            </div>
                            <div className="font-semibold text-aura-primary tabular-nums">
                              {bank.totalDocuments}
                            </div>
                          </div>
                        </div>
                        </button>

                        {/* Bank lifecycle: a bank you can create must also
                            be renamable and removable. */}
                        <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            data-testid={`hindsight-bank-edit-${bank.id}`}
                            onClick={() => {
                              setEditingBankId(bank.id);
                              setEditingBankName(bank.name || bank.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-aura-sm border border-aura-border/50 px-1.5 py-0.5 text-[10px] text-aura-secondary hover:border-aura-accent/60 hover:text-aura-accent transition-colors"
                            aria-label={t("hindsightPanel.banks.rename")}
                            title={t("hindsightPanel.banks.rename")}
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            {t("hindsightPanel.banks.rename")}
                          </button>
                          <button
                            type="button"
                            data-testid={`hindsight-bank-delete-${bank.id}`}
                            onClick={() => void handleDeleteBank(bank.id)}
                            disabled={bankBusyId === bank.id}
                            className="inline-flex items-center gap-1 rounded-aura-sm border border-rose-400/40 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/15 transition-colors disabled:opacity-40"
                            aria-label={t("hindsightPanel.banks.delete")}
                            title={t("hindsightPanel.banks.delete")}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            {t("hindsightPanel.banks.delete")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Bank Stats Card + Layer Filter Pills + Consolidate */}
            {selectedBank && (
              <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-aura-accent">
                    {selectedBank}
                  </span>
                  {bankStats && (
                    <Badge
                      variant={bankStats.pendingOperations > 0 ? "warning" : "neutral"}
                    >
                      {t("hindsightPanel.pendingOps")}: {bankStats.pendingOperations}
                    </Badge>
                  )}
                </div>

                {loadingStats ? (
                  <Skeleton lines={3} />
                ) : bankStats ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-aura-sm border border-aura-border/30 bg-aura-canvas/50 p-2">
                        <div className="text-[11px] text-aura-text-muted">
                          {t("hindsightPanel.totalNodes")}
                        </div>
                        <div className="text-sm font-bold text-aura-primary tabular-nums">
                          {bankStats.totalNodes}
                        </div>
                      </div>
                      <div className="rounded-aura-sm border border-aura-border/30 bg-aura-canvas/50 p-2">
                        <div className="text-[11px] text-aura-text-muted">
                          {t("hindsightPanel.totalLinks")}
                        </div>
                        <div className="text-sm font-bold text-aura-primary tabular-nums">
                          {bankStats.totalLinks}
                        </div>
                      </div>
                      <div className="rounded-aura-sm border border-aura-border/30 bg-aura-canvas/50 p-2">
                        <div className="text-[11px] text-aura-text-muted">
                          {t("hindsightPanel.totalDocs")}
                        </div>
                        <div className="text-sm font-bold text-aura-primary tabular-nums">
                          {bankStats.totalDocuments}
                        </div>
                      </div>
                    </div>

                    {/* Interactive Cognitive Layer Filter Badges */}
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLayerBadgeClick("")}
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          activeLayerFilter === ""
                            ? "border-aura-accent bg-aura-accent/15 text-aura-accent"
                            : "border-aura-border/50 bg-aura-canvas/40 text-aura-secondary hover:text-aura-primary"
                        }`}
                      >
                        {t("hindsightPanel.factTypes.all")}
                      </button>
                      {(["world", "experience", "observation"] as const).map((layer) => {
                        const count = bankStats.nodesByFactType[layer] ?? 0;
                        const active = activeLayerFilter === layer;
                        return (
                          <button
                            key={layer}
                            type="button"
                            onClick={() => handleLayerBadgeClick(layer)}
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              active
                                ? "border-aura-accent bg-aura-accent text-aura-inverse"
                                : "border-aura-border/50 bg-aura-canvas/40 text-aura-secondary hover:border-aura-accent/60 hover:text-aura-primary"
                            }`}
                          >
                            {layer}: {count}
                          </button>
                        );
                      })}
                    </div>

                    {/* Operational counters the backend already reports. */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {(
                        [
                          {
                            key: "pendingConsolidation",
                            label: t("hindsightPanel.stats.pendingConsolidation"),
                            value: bankStats.pendingConsolidation,
                          },
                          {
                            key: "failedConsolidation",
                            label: t("hindsightPanel.stats.failedConsolidation"),
                            value: bankStats.failedConsolidation,
                          },
                          {
                            key: "failedOperations",
                            label: t("hindsightPanel.stats.failedOperations"),
                            value: bankStats.failedOperations,
                          },
                          {
                            key: "lastConsolidatedAt",
                            label: t("hindsightPanel.stats.lastConsolidatedAt"),
                            value: bankStats.lastConsolidatedAt
                              ? formatDate(bankStats.lastConsolidatedAt)
                              : "—",
                          },
                          {
                            key: "lastMemoryWriteAt",
                            label: t("hindsightPanel.stats.lastMemoryWriteAt"),
                            value: bankStats.lastMemoryWriteAt
                              ? formatDate(bankStats.lastMemoryWriteAt)
                              : "—",
                          },
                        ] as const
                      ).map((stat) => (
                        <div
                          key={stat.key}
                          className="rounded-aura-sm border border-aura-border/30 bg-aura-canvas/50 px-2 py-1.5"
                        >
                          <div className="text-aura-text-muted">{stat.label}</div>
                          <div className="font-semibold text-aura-primary tabular-nums">
                            {stat.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* How the links are distributed — the same numbers the
                        graph filter uses. */}
                    {Object.keys(bankStats.linksByLinkType ?? {}).length > 0 && (
                      <div className="rounded-aura-sm border border-aura-border/30 bg-aura-canvas/50 p-2">
                        <div className="mb-1 text-[11px] text-aura-text-muted">
                          {t("hindsightPanel.stats.linksByType")}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-aura-secondary">
                          {Object.entries(bankStats.linksByLinkType).map(
                            ([linkType, count]) => (
                              <span key={linkType} className="tabular-nums">
                                {linkTypeLabel(linkType)}:{" "}
                                <span className="font-semibold text-aura-primary">
                                  {count}
                                </span>
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      data-testid="hindsight-consolidate-btn"
                      loading={consolidatingBank}
                      onClick={() => void handleConsolidateBank()}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      {consolidatingBank
                        ? t("hindsightPanel.consolidating")
                        : t("hindsightPanel.consolidateNow")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </aside>

          {/* Main Tabbed Workspace */}
          <section className="min-w-0 space-y-4 lg:col-span-8 xl:col-span-9">
            <div
              role="tablist"
              aria-label={t("hindsightPanel.title")}
              className="flex flex-wrap items-center gap-1.5 rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-1.5"
            >
              {tabItems.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-aura-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-aura-accent text-aura-inverse shadow-sm"
                        : "text-aura-secondary hover:bg-aura-muted/40 hover:text-aura-primary"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.badge !== undefined && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                          isActive
                            ? "bg-aura-canvas/25 text-aura-inverse"
                            : "bg-aura-muted/50 text-aura-primary"
                        }`}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {tabError && (
              <div
                role="alert"
                className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 font-mono text-xs text-aura-danger break-all"
              >
                {tabError}
              </div>
            )}

            {/* Memories Tab */}
            {activeTab === "memories" && (
              <div className="space-y-4">
                {/* Cognitive Layer Filter Bar + Manual Retain Trigger */}
                {selectedBank && (
                  <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(
                          [
                            { id: "", label: t("hindsightPanel.factTypes.all"), testId: "memory-layer-all" },
                            { id: "world", label: t("hindsightPanel.factTypes.world"), testId: "memory-layer-world" },
                            { id: "experience", label: t("hindsightPanel.factTypes.experience"), testId: "memory-layer-experience" },
                            { id: "observation", label: t("hindsightPanel.factTypes.observation"), testId: "memory-layer-observation" },
                          ] as const
                        ).map((layer) => {
                          const active = memoryFactType === layer.id;
                          return (
                            <button
                              key={layer.id || "all"}
                              type="button"
                              data-testid={layer.testId}
                              onClick={() => setMemoryFactType(layer.id)}
                              className={`rounded-aura-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                active
                                  ? "bg-aura-accent text-aura-inverse shadow-sm"
                                  : "bg-aura-canvas/60 text-aura-secondary hover:text-aura-primary"
                              }`}
                            >
                              {layer.label}
                            </button>
                          );
                        })}
                      </div>

                      <Button
                        size="sm"
                        variant="primary"
                        data-testid="hindsight-retain-btn"
                        onClick={() => setShowRetainForm((v) => !v)}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("hindsightPanel.retainForm.button")}
                      </Button>
                    </div>

                    <Input
                      value={memoryQuery}
                      onChange={(e) => setMemoryQuery(e.target.value)}
                      placeholder={t("hindsightPanel.graphLayers.filterPlaceholder")}
                      aria-label={t("hindsightPanel.graphLayers.filterPlaceholder")}
                    />

                    {showRetainForm && (
                      <form
                        onSubmit={handleRetainMemory}
                        data-testid="hindsight-retain-form"
                        className="rounded-aura-md border border-aura-accent/40 bg-aura-canvas/60 p-3 space-y-3"
                      >
                        <h4 className="text-xs font-semibold text-aura-primary">
                          {t("hindsightPanel.retainForm.title")}
                        </h4>
                        <Textarea
                          label={t("hindsightPanel.retainForm.contentLabel")}
                          value={retainContent}
                          onChange={(e) => setRetainContent(e.target.value)}
                          placeholder={t("hindsightPanel.retainForm.contentPlaceholder")}
                          rows={3}
                          required
                        />
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <Input
                            label={t("hindsightPanel.retainForm.contextLabel")}
                            value={retainContext}
                            onChange={(e) => setRetainContext(e.target.value)}
                            placeholder={t("hindsightPanel.retainForm.contextPlaceholder")}
                          />
                          <Input
                            label={t("hindsightPanel.retainForm.tagsLabel")}
                            value={retainTags}
                            onChange={(e) => setRetainTags(e.target.value)}
                            placeholder={t("hindsightPanel.retainForm.tagsPlaceholder")}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowRetainForm(false)}
                          >
                            {t("hindsightPanel.createBank.cancel")}
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            variant="primary"
                            loading={retainingMemory}
                            data-testid="hindsight-retain-submit"
                          >
                            {retainingMemory
                              ? t("hindsightPanel.retainForm.saving")
                              : t("hindsightPanel.retainForm.submit")}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                  <div
                    className={
                      selectedMemory || loadingMemoryDetail
                        ? "space-y-3 xl:col-span-7"
                        : "space-y-3 xl:col-span-12"
                    }
                  >
                    {!selectedBank ? (
                      <EmptyState
                        icon={<Brain className="h-5 w-5" />}
                        title={t("hindsightPanel.offlineBanner")}
                      />
                    ) : loadingMemories ? (
                      <div className="space-y-3">
                        <Skeleton className="h-24" />
                        <Skeleton className="h-24" />
                        <Skeleton className="h-24" />
                      </div>
                    ) : memories.length === 0 ? (
                      <EmptyState
                        icon={<Brain className="h-5 w-5" />}
                        title={t("hindsightPanel.emptyList")}
                      />
                    ) : (
                      memories.map((item) => {
                        const isSelected = selectedMemory?.id === item.id;
                        return (
                          <article
                            key={item.id}
                            className={`rounded-aura-lg border p-4 space-y-2.5 transition-colors ${
                              isSelected
                                ? "border-aura-accent/70 bg-aura-accent/5"
                                : "border-aura-border/40 bg-aura-surface/75"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {item.factType && (
                                  <Badge variant={factTypeVariant(item.factType)}>
                                    {item.factType}
                                  </Badge>
                                )}
                                {item.context && (
                                  <Badge variant="neutral" className="font-mono">
                                    {item.context}
                                  </Badge>
                                )}
                              </div>
                              <span className="flex items-center gap-1 text-[11px] text-aura-text-muted">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {formatDate(item.date || item.mentionedAt)}
                              </span>
                            </div>

                            <p className="text-sm text-aura-primary whitespace-pre-wrap break-words">
                              {item.text}
                            </p>

                            {(item.entities.length > 0 || item.tags.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {item.entities.map((entity) => (
                                  <Badge key={entity} variant="info">
                                    {entity}
                                  </Badge>
                                ))}
                                {item.tags.map((tag) => (
                                  <Badge key={tag} variant="neutral">
                                    <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  void handleInspectMemory(selectedBank, item.id)
                                }
                              >
                                {t("hindsightPanel.inspect")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onOpenInGalaxy?.(selectedBank, item.id)}
                              >
                                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                                {t("hindsightPanel.openInGalaxy")}
                              </Button>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>

                  {(selectedMemory || loadingMemoryDetail) && selectedBank && (
                    <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 space-y-4 self-start xl:col-span-5">
                      <div className="flex items-center justify-between gap-2 border-b border-aura-border/40 pb-2.5">
                        <span className="truncate font-mono text-xs text-aura-accent">
                          {selectedMemory?.id ?? "..."}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedMemory(null)}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("hindsightPanel.closeDetail")}
                        </Button>
                      </div>

                      {loadingMemoryDetail ? (
                        <Skeleton lines={5} />
                      ) : selectedMemory ? (
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {selectedMemory.factType && (
                              <Badge variant={factTypeVariant(selectedMemory.factType)}>
                                {selectedMemory.factType}
                              </Badge>
                            )}
                            {selectedMemory.state && (
                              <Badge variant="neutral">{selectedMemory.state}</Badge>
                            )}
                            {(selectedMemory.date || selectedMemory.mentionedAt) && (
                              <Badge variant="neutral">
                                {formatDate(
                                  selectedMemory.date || selectedMemory.mentionedAt,
                                )}
                              </Badge>
                            )}
                          </div>

                          {selectedMemory.context && (
                            <div className="text-xs text-aura-secondary">
                              <span className="font-semibold">
                                {t("hermes.galaxy.contextLabel")}:{" "}
                              </span>
                              <span className="font-mono break-all">
                                {selectedMemory.context}
                              </span>
                            </div>
                          )}

                          <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 text-sm text-aura-primary whitespace-pre-wrap break-words">
                            {selectedMemory.text}
                          </div>

                          {selectedMemory.entities.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-xs font-semibold text-aura-secondary">
                                {t("hermes.galaxy.entitiesLabel")}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedMemory.entities.map((entity) => (
                                  <Badge key={entity} variant="info">
                                    {entity}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedMemory.tags.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-xs font-semibold text-aura-secondary">
                                {t("hermes.galaxy.tagsLabel")}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedMemory.tags.map((tag) => (
                                  <Badge key={tag} variant="neutral">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedMemory.sourceMemories.length > 0 && (
                            <div className="space-y-2 border-t border-aura-border/40 pt-3">
                              <div className="text-xs font-semibold text-aura-secondary">
                                {t("hindsightPanel.sourceMemories")} (
                                {selectedMemory.sourceMemories.length})
                              </div>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {selectedMemory.sourceMemories.map((src) => (
                                  <button
                                    key={src.id}
                                    type="button"
                                    onClick={() =>
                                      void handleInspectMemory(selectedBank, src.id)
                                    }
                                    className="w-full rounded-aura-sm border border-aura-border/40 bg-aura-canvas/50 p-2 text-left text-xs text-aura-secondary hover:border-aura-accent/60 hover:text-aura-primary transition-colors"
                                  >
                                    <p className="line-clamp-2">{src.text}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedMemory.history.length > 0 && (
                            <div className="space-y-2 border-t border-aura-border/40 pt-3">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-aura-secondary">
                                <History className="h-3.5 w-3.5" aria-hidden="true" />
                                {t("hermes.galaxy.historyLabel")}
                              </div>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {selectedMemory.history.map((entry, idx) => (
                                  <div
                                    key={entry.id ?? idx}
                                    className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/50 p-2 text-xs text-aura-secondary space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      {entry.action && (
                                        <Badge variant="warning">{entry.action}</Badge>
                                      )}
                                      <span className="text-[11px] text-aura-text-muted">
                                        {formatDate(
                                          entry.changedAt ||
                                            entry.occurredAt ||
                                            entry.createdAt,
                                        )}
                                      </span>
                                    </div>
                                    {entry.text && (
                                      <p className="text-aura-primary whitespace-pre-wrap break-words">
                                        {entry.text}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex justify-end pt-1">
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() =>
                                onOpenInGalaxy?.(selectedBank, selectedMemory.id)
                              }
                            >
                              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                              {t("hindsightPanel.openInGalaxy")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </aside>
                  )}
                </div>
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === "documents" && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <div
                  className={
                    selectedDocument || loadingDocumentDetail
                      ? "space-y-2.5 xl:col-span-5"
                      : "space-y-2.5 xl:col-span-12"
                  }
                >
                  {!selectedBank ? (
                    <EmptyState
                      icon={<FileText className="h-5 w-5" />}
                      title={t("hindsightPanel.offlineBanner")}
                    />
                  ) : loadingDocuments ? (
                    <div className="space-y-2.5">
                      <Skeleton className="h-20" />
                      <Skeleton className="h-20" />
                    </div>
                  ) : documents.length === 0 ? (
                    <EmptyState
                      icon={<FileText className="h-5 w-5" />}
                      title={t("hindsightPanel.emptyList")}
                    />
                  ) : (
                    documents.map((doc) => {
                      const active = selectedDocument?.id === doc.id;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => void handleSelectDocument(doc.id)}
                          className={`w-full rounded-aura-lg border p-3.5 text-left space-y-2 transition-colors ${
                            active
                              ? "border-aura-accent/70 bg-aura-accent/10"
                              : "border-aura-border/40 bg-aura-surface/75 hover:border-aura-border-strong/70"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs font-semibold text-aura-primary">
                              {doc.id}
                            </span>
                            <Badge variant="info">
                              {doc.memoryUnitCount} {t("hindsightPanel.totalNodes")}
                            </Badge>
                          </div>
                          {doc.context && (
                            <p className="truncate text-xs text-aura-secondary">
                              {doc.context}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-aura-text-muted">
                            <span>{formatDate(doc.updatedAt || doc.createdAt)}</span>
                            <span className="tabular-nums">{doc.textLength} ch</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {(selectedDocument || loadingDocumentDetail) && (
                  <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 space-y-4 self-start xl:col-span-7">
                    <div className="flex items-center justify-between gap-2 border-b border-aura-border/40 pb-2.5">
                      <span className="truncate font-mono text-xs font-semibold text-aura-accent">
                        {selectedDocument?.id ?? "..."}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedDocument(null)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("hindsightPanel.closeDetail")}
                      </Button>
                    </div>

                    {loadingDocumentDetail ? (
                      <Skeleton lines={6} />
                    ) : selectedDocument ? (
                      <div className="space-y-4">
                        {Object.keys(selectedDocument.nodesByFactType).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(selectedDocument.nodesByFactType).map(
                              ([factType, count]) => (
                                <Badge
                                  key={factType}
                                  variant={factTypeVariant(factType)}
                                >
                                  {factType}: {count}
                                </Badge>
                              ),
                            )}
                          </div>
                        )}

                        {selectedDocument.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedDocument.tags.map((tag) => (
                              <Badge key={tag} variant="neutral">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-aura-secondary">
                            {t("hindsightPanel.originalText")}
                          </div>
                          <div className="max-h-[420px] overflow-y-auto rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 font-mono text-xs text-aura-primary whitespace-pre-wrap break-words">
                            {selectedDocument.originalText ?? "—"}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </aside>
                )}
              </div>
            )}

            {/* Entities Tab */}
            {activeTab === "entities" && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <div
                  className={
                    selectedEntity || loadingEntityDetail
                      ? "space-y-2.5 xl:col-span-5"
                      : "grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:col-span-12"
                  }
                >
                  {!selectedBank ? (
                    <EmptyState
                      icon={<Layers className="h-5 w-5" />}
                      title={t("hindsightPanel.offlineBanner")}
                    />
                  ) : loadingEntities ? (
                    <div className="space-y-2.5">
                      <Skeleton className="h-16" />
                      <Skeleton className="h-16" />
                    </div>
                  ) : entities.length === 0 ? (
                    <div className="col-span-full">
                      <EmptyState
                        icon={<Layers className="h-5 w-5" />}
                        title={t("hindsightPanel.emptyList")}
                      />
                    </div>
                  ) : (
                    entities.map((entity) => {
                      const active = selectedEntity?.id === entity.id;
                      return (
                        <button
                          key={entity.id}
                          type="button"
                          onClick={() => void handleSelectEntity(entity.id)}
                          className={`w-full rounded-aura-lg border p-3.5 text-left space-y-1.5 transition-colors ${
                            active
                              ? "border-aura-accent/70 bg-aura-accent/10"
                              : "border-aura-border/40 bg-aura-surface/75 hover:border-aura-border-strong/70"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-aura-primary">
                              {entity.canonicalName}
                            </span>
                            <Badge variant="info">
                              {t("hindsightPanel.mentions", {
                                count: entity.mentionCount,
                              })}
                            </Badge>
                          </div>
                          {(entity.firstSeen || entity.lastSeen) && (
                            <div className="text-[11px] text-aura-text-muted">
                              {formatDate(entity.lastSeen || entity.firstSeen)}
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {(selectedEntity || loadingEntityDetail) && (
                  <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 space-y-4 self-start xl:col-span-7">
                    <div className="flex items-center justify-between gap-2 border-b border-aura-border/40 pb-2.5">
                      <span className="truncate text-sm font-semibold text-aura-primary">
                        {selectedEntity?.canonicalName ?? "..."}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedEntity(null)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("hindsightPanel.closeDetail")}
                      </Button>
                    </div>

                    {loadingEntityDetail ? (
                      <Skeleton lines={5} />
                    ) : selectedEntity ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="info">
                            {t("hindsightPanel.mentions", {
                              count: selectedEntity.mentionCount,
                            })}
                          </Badge>
                          {selectedEntity.lastSeen && (
                            <span className="text-aura-text-muted">
                              {formatDate(selectedEntity.lastSeen)}
                            </span>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-aura-secondary">
                            {t("hindsightPanel.observations")} (
                            {selectedEntity.observations.length})
                          </div>
                          {selectedEntity.observations.length === 0 ? (
                            <p className="text-xs text-aura-text-muted">
                              {t("hindsightPanel.emptyList")}
                            </p>
                          ) : (
                            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                              {selectedEntity.observations.map((obs, idx) => (
                                <div
                                  key={idx}
                                  className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 space-y-1 text-xs"
                                >
                                  <p className="text-aura-primary whitespace-pre-wrap break-words">
                                    {obs.text}
                                  </p>
                                  {obs.mentionedAt && (
                                    <div className="text-[11px] text-aura-text-muted">
                                      {formatDate(obs.mentionedAt)}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </aside>
                )}
              </div>
            )}

            {/* Graph Tab (Interactive World / Experience / Observation Constellation) */}
            {activeTab === "graph" && (
              <div className="space-y-4">
                {selectedBank && (
                  <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-aura-secondary">
                        {t("hindsightPanel.graphLayers.title")}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(
                          [
                            { id: "", label: t("hindsightPanel.graphLayers.all"), testId: "graph-layer-all", dot: "bg-sky-400" },
                            { id: "world", label: t("hindsightPanel.graphLayers.world"), testId: "graph-layer-world", dot: "bg-sky-400" },
                            { id: "experience", label: t("hindsightPanel.graphLayers.experience"), testId: "graph-layer-experience", dot: "bg-emerald-400" },
                            { id: "observation", label: t("hindsightPanel.graphLayers.observation"), testId: "graph-layer-observation", dot: "bg-amber-400" },
                          ] as const
                        ).map((layer) => {
                          const active = graphFactType === layer.id;
                          return (
                            <button
                              key={layer.id || "all"}
                              type="button"
                              data-testid={layer.testId}
                              onClick={() => {
                                setGraphFactType(layer.id);
                                setSelectedGraphNodeId(null);
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-aura-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                active
                                  ? "bg-aura-accent text-aura-inverse shadow-sm"
                                  : "bg-aura-canvas/60 text-aura-secondary hover:text-aura-primary"
                              }`}
                            >
                              <span className={`h-2 w-2 rounded-full ${layer.dot}`} />
                              {layer.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <Input
                        containerClassName="flex-1"
                        value={graphQuery}
                        onChange={(e) => setGraphQuery(e.target.value)}
                        placeholder={t("hindsightPanel.graphLayers.filterPlaceholder")}
                        aria-label={t("hindsightPanel.graphLayers.filterPlaceholder")}
                      />
                      <Select
                        containerClassName="w-full sm:w-44"
                        value={graphLinkTypeFilter}
                        onChange={(e) => setGraphLinkTypeFilter(e.target.value)}
                        aria-label={t("hindsightPanel.graphLayers.linkAll")}
                      >
                        <option value="">{t("hindsightPanel.graphLayers.linkAll")}</option>
                        {graphLinkTypes.map((linkType) => (
                          <option key={linkType} value={linkType}>
                            {linkTypeLabel(linkType)}
                            {typeof bankStats?.linksByLinkType?.[linkType] === "number"
                              ? ` (${bankStats.linksByLinkType[linkType]})`
                              : ""}
                          </option>
                        ))}
                      </Select>
                      <Select
                        containerClassName="w-full sm:w-36"
                        value={String(graphNodeLimit)}
                        onChange={(e) => setGraphNodeLimit(Number(e.target.value))}
                        aria-label={t("hindsightPanel.graphLayers.nodeLimit")}
                      >
                        {[25, 60, 100, 150, 200].map((limit) => (
                          <option key={limit} value={limit}>
                            {t("hindsightPanel.graphLayers.nodeLimitValue", { limit })}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {/* How much of the graph is on screen, and what the colours mean. */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-aura-border/30 pt-2.5">
                      <p className="text-[11px] text-aura-muted">
                        {t("hindsightPanel.graphLayers.showing", {
                          shown: graphNodes.length,
                          total: graphPayload?.totalUnits ?? 0,
                        })}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        {(
                          [
                            { id: "world", label: t("hindsightPanel.graphLayers.world"), dot: "bg-sky-400" },
                            { id: "experience", label: t("hindsightPanel.graphLayers.experience"), dot: "bg-emerald-400" },
                            { id: "observation", label: t("hindsightPanel.graphLayers.observation"), dot: "bg-amber-400" },
                          ] as const
                        ).map((layer) => (
                          <span key={layer.id} className="inline-flex items-center gap-1 text-[10px] text-aura-muted">
                            <span className={`h-2 w-2 rounded-full ${layer.dot}`} />
                            {layer.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {!selectedBank ? (
                  <EmptyState
                    icon={<Network className="h-5 w-5" />}
                    title={t("hindsightPanel.offlineBanner")}
                  />
                ) : loadingGraph ? (
                  <Skeleton className="h-[460px]" />
                ) : graphNodes.length === 0 ? (
                  <EmptyState
                    icon={<Network className="h-5 w-5" />}
                    title={t("hindsightPanel.emptyList")}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 xl:col-span-9">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-aura-text-muted">
                        <span>
                          {t("hindsightPanel.totalNodes")}: {graphNodes.length} ·{" "}
                          {t("hindsightPanel.totalLinks")}: {graphEdges.length}
                        </span>
                        {selectedGraphNodeId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedGraphNodeId(null)}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                            {t("hindsightPanel.closeDetail")}
                          </Button>
                        )}
                      </div>

                      <HindsightGraphView
                        nodes={graphNodes}
                        edges={graphEdges}
                        positions={nodePositions}
                        width={GRAPH_WIDTH}
                        height={GRAPH_HEIGHT}
                        selectedNodeId={selectedGraphNodeId}
                        onSelectNode={setSelectedGraphNodeId}
                      />
                    </div>

                    {selectedGraphNode && (
                      <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 space-y-3 self-start xl:col-span-3">
                        <div className="flex items-start justify-between gap-2 border-b border-aura-border/40 pb-2">
                          <div className="min-w-0 space-y-1">
                            <h4 className="truncate text-sm font-semibold text-aura-primary">
                              {selectedGraphNode.label || selectedGraphNode.id}
                            </h4>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(selectedGraphNode.factType || graphFactType) && (
                                <Badge
                                  variant={factTypeVariant(
                                    selectedGraphNode.factType || graphFactType,
                                  )}
                                >
                                  {selectedGraphNode.factType || graphFactType}
                                </Badge>
                              )}
                              {selectedGraphNode.date && (
                                <span className="text-[11px] text-aura-text-muted">
                                  {formatDate(selectedGraphNode.date)}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedGraphNodeId(null)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>

                        {selectedGraphNode.context && (
                          <div className="font-mono text-xs text-aura-secondary break-all">
                            {selectedGraphNode.context}
                          </div>
                        )}

                        <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 text-xs text-aura-primary whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                          {selectedGraphNode.text}
                        </div>

                        {selectedGraphNode.entities.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-aura-secondary">
                              {t("hermes.galaxy.entitiesLabel")}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {selectedGraphNode.entities.map((entity) => (
                                <Badge key={entity} variant="info">
                                  {entity}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {connectedGraphEdges.length > 0 && (
                          <div className="space-y-1.5 border-t border-aura-border/40 pt-2">
                            <div className="text-xs font-semibold text-aura-secondary">
                              {t("hindsightPanel.totalLinks")} ({connectedGraphEdges.length})
                            </div>
                            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                              {connectedGraphEdges.map((edge) => {
                                const neighborId =
                                  edge.source === selectedGraphNode.id
                                    ? edge.target
                                    : edge.source;
                                const neighborNode = graphNodes.find(
                                  (n) => n.id === neighborId,
                                );
                                return (
                                  <button
                                    key={edge.id}
                                    type="button"
                                    onClick={() => setSelectedGraphNodeId(neighborId)}
                                    className="flex w-full items-center justify-between gap-2 rounded-aura-sm border border-aura-border/40 bg-aura-canvas/50 px-2.5 py-1.5 text-left text-xs text-aura-primary hover:border-aura-accent/60 transition-colors"
                                  >
                                    <span className="truncate">
                                      {neighborNode?.label || neighborId}
                                    </span>
                                    {(edge.entityName || edge.linkType) && (
                                      <Badge variant="neutral">
                                        {edge.entityName || edge.linkType}
                                      </Badge>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="flex justify-end pt-1">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              onOpenInGalaxy?.(selectedBank, selectedGraphNode.id)
                            }
                          >
                            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("hindsightPanel.openInGalaxy")}
                          </Button>
                        </div>
                      </aside>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mental Models Tab */}
            {activeTab === "mentalModels" && (
              <div className="space-y-4">
                {selectedBank && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3.5">
                    <div>
                      <h3 className="text-sm font-semibold text-aura-primary">
                        {t("hindsightPanel.mentalModelForm.title")}
                      </h3>
                      <p className="text-xs text-aura-text-muted">
                        {t("hindsightPanel.mentalModelForm.subtitle")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      data-testid="hindsight-new-mental-model-btn"
                      onClick={() => setShowMentalModelForm((v) => !v)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("hindsightPanel.mentalModelForm.newButton")}
                    </Button>
                  </div>
                )}

                {showMentalModelForm && selectedBank && (
                  <form
                    onSubmit={handleCreateMentalModel}
                    data-testid="hindsight-mental-model-form"
                    className="rounded-aura-lg border border-aura-accent/50 bg-aura-surface/90 p-4 space-y-3"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Input
                        label={t("hindsightPanel.mentalModelForm.nameLabel")}
                        value={mmName}
                        onChange={(e) => setMmName(e.target.value)}
                        placeholder={t("hindsightPanel.mentalModelForm.namePlaceholder")}
                        required
                      />
                      <Input
                        label={t("hindsightPanel.mentalModelForm.idLabel")}
                        value={mmCustomId}
                        onChange={(e) => setMmCustomId(e.target.value)}
                        placeholder={t("hindsightPanel.mentalModelForm.idPlaceholder")}
                      />
                    </div>

                    <Textarea
                      label={t("hindsightPanel.mentalModelForm.queryLabel")}
                      value={mmQuery}
                      onChange={(e) => setMmQuery(e.target.value)}
                      placeholder={t("hindsightPanel.mentalModelForm.queryPlaceholder")}
                      rows={3}
                      required
                    />

                    <Input
                      label={t("hindsightPanel.mentalModelForm.tagsLabel")}
                      value={mmTags}
                      onChange={(e) => setMmTags(e.target.value)}
                      placeholder={t("hindsightPanel.mentalModelForm.tagsPlaceholder")}
                    />

                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowMentalModelForm(false)}
                      >
                        {t("hindsightPanel.createBank.cancel")}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        loading={creatingMentalModel}
                        data-testid="hindsight-mental-model-submit"
                      >
                        {creatingMentalModel
                          ? t("hindsightPanel.mentalModelForm.creating")
                          : t("hindsightPanel.mentalModelForm.submit")}
                      </Button>
                    </div>
                  </form>
                )}

                {!selectedBank ? (
                  <EmptyState
                    icon={<Brain className="h-5 w-5" />}
                    title={t("hindsightPanel.offlineBanner")}
                  />
                ) : loadingMentalModels ? (
                  <div className="space-y-3">
                    <Skeleton className="h-32" />
                    <Skeleton className="h-32" />
                  </div>
                ) : mentalModels.length === 0 ? (
                  <EmptyState
                    icon={<Brain className="h-5 w-5" />}
                    title={t("hindsightPanel.emptyList")}
                  />
                ) : (
                  mentalModels.map((model) => (
                    <article
                      key={model.id}
                      className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <h4 className="text-sm font-semibold text-aura-primary">
                            {model.name}
                          </h4>
                          <span className="font-mono text-[11px] text-aura-text-muted">
                            {model.id}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={model.isStale ? "warning" : "success"}>
                            {model.isStale
                              ? t("hindsightPanel.staleBadge")
                              : t("hindsightPanel.freshBadge")}
                          </Badge>
                          {model.lastRefreshedAt && (
                            <span className="text-[11px] text-aura-text-muted">
                              {formatDate(model.lastRefreshedAt)}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={refreshingModelId === model.id}
                            onClick={() => void handleRefreshMentalModel(model.id)}
                          >
                            <RefreshCw className="h-3 w-3" aria-hidden="true" />
                            {refreshingModelId === model.id
                              ? t("hindsightPanel.mentalModelForm.refreshing")
                              : t("hindsightPanel.mentalModelForm.refreshButton")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleDeleteMentalModel(model.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-aura-danger" aria-hidden="true" />
                            {t("hindsightPanel.mentalModelForm.deleteButton")}
                          </Button>
                        </div>
                      </div>

                      {model.sourceQuery && (
                        <div className="space-y-1">
                          <div className="text-[11px] font-semibold text-aura-secondary">
                            {t("hindsightPanel.mentalModelForm.sourceQueryHeading")}
                          </div>
                          <div className="rounded-aura-sm border border-aura-border/30 bg-aura-canvas/50 px-2.5 py-1.5 font-mono text-xs text-aura-secondary break-words">
                            {model.sourceQuery}
                          </div>
                        </div>
                      )}

                      <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/60 p-3 text-sm text-aura-primary whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                        {model.content || t("hindsightPanel.mentalModelForm.noContentYet")}
                      </div>

                      {model.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {model.tags.map((tag) => (
                            <Badge key={tag} variant="neutral">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            )}

            {/* Directives & Operations Tab */}
            {activeTab === "directivesOps" && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                {/* Directives Column */}
                <div className="space-y-3 xl:col-span-6">
                  <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-aura-primary">
                          <ShieldCheck className="h-4 w-4 text-aura-accent" aria-hidden="true" />
                          {t("hindsightPanel.directives.title")}
                        </h3>
                        <p className="text-xs text-aura-text-muted">
                          {t("hindsightPanel.directives.subtitle")}
                        </p>
                      </div>
                      {selectedBank && (
                        <Button
                          size="sm"
                          variant="primary"
                          data-testid="hindsight-new-directive-btn"
                          onClick={() => setShowDirectiveForm((v) => !v)}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("hindsightPanel.directives.newButton")}
                        </Button>
                      )}
                    </div>

                    {showDirectiveForm && selectedBank && (
                      <form
                        onSubmit={handleCreateDirective}
                        data-testid="hindsight-directive-form"
                        className="rounded-aura-md border border-aura-accent/40 bg-aura-canvas/60 p-3 space-y-3"
                      >
                        <Input
                          label={t("hindsightPanel.directives.nameLabel")}
                          value={dirName}
                          onChange={(e) => setDirName(e.target.value)}
                          placeholder={t("hindsightPanel.directives.namePlaceholder")}
                          required
                        />
                        <Textarea
                          label={t("hindsightPanel.directives.contentLabel")}
                          value={dirContent}
                          onChange={(e) => setDirContent(e.target.value)}
                          placeholder={t("hindsightPanel.directives.contentPlaceholder")}
                          rows={3}
                          required
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowDirectiveForm(false)}
                          >
                            {t("hindsightPanel.createBank.cancel")}
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            variant="primary"
                            loading={savingDirective}
                            data-testid="hindsight-directive-submit"
                          >
                            {t("hindsightPanel.directives.submit")}
                          </Button>
                        </div>
                      </form>
                    )}

                    {loadingDirectivesOps ? (
                      <Skeleton lines={4} />
                    ) : directives.length === 0 ? (
                      <p className="text-xs text-aura-text-muted py-4">
                        {t("hindsightPanel.directives.empty")}
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {directives.map((dir) => (
                          <div
                            key={dir.id}
                            className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-aura-primary">
                                {dir.name}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleDeleteDirective(dir.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-aura-danger" aria-hidden="true" />
                                {t("hindsightPanel.directives.deleteButton")}
                              </Button>
                            </div>
                            <p className="text-xs text-aura-secondary whitespace-pre-wrap break-words">
                              {dir.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Operations Column */}
                <div className="space-y-3 xl:col-span-6">
                  <div className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-aura-primary">
                          <Activity className="h-4 w-4 text-aura-accent" aria-hidden="true" />
                          {t("hindsightPanel.operations.title")}
                        </h3>
                        <p className="text-xs text-aura-text-muted">
                          {t("hindsightPanel.operations.subtitle")}
                        </p>
                      </div>
                      {selectedBank && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={consolidatingBank}
                          onClick={() => void handleConsolidateBank()}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("hindsightPanel.consolidateNow")}
                        </Button>
                      )}
                    </div>

                    {loadingDirectivesOps ? (
                      <Skeleton lines={4} />
                    ) : operations.length === 0 ? (
                      <p className="text-xs text-aura-text-muted py-4">
                        {t("hindsightPanel.operations.empty")}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                        {operations.map((op) => (
                          <div
                            key={op.id}
                            className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-2.5 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-aura-primary">
                                {op.operationType}
                              </span>
                              <Badge
                                variant={
                                  op.status === "completed"
                                    ? "success"
                                    : op.status === "failed"
                                      ? "danger"
                                      : "warning"
                                }
                              >
                                {op.status}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-aura-text-muted">
                              <span className="truncate font-mono">{op.id}</span>
                              <span>{formatDate(op.updatedAt || op.createdAt)}</span>
                            </div>
                            {op.errorMessage && (
                              <p className="font-mono text-[11px] text-aura-danger break-all">
                                {op.errorMessage}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Global Hits Tab */}
            {activeTab === "globalHits" && (
              <div className="space-y-3">
                {globalError && (
                  <div
                    role="alert"
                    className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 font-mono text-xs text-aura-danger break-all"
                  >
                    {globalError}
                  </div>
                )}

                {globalSearching ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                  </div>
                ) : globalHits.length === 0 ? (
                  <EmptyState
                    icon={<Search className="h-5 w-5" />}
                    title={t("hindsightPanel.emptyList")}
                  />
                ) : (
                  globalHits.map((hit) => (
                    <article
                      key={`${hit.bankId}:${hit.id}`}
                      className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="default">
                            {hit.bankName || hit.bankId}
                          </Badge>
                          {hit.factType && (
                            <Badge variant={factTypeVariant(hit.factType)}>
                              {hit.factType}
                            </Badge>
                          )}
                          <Badge variant="neutral">{hit.matchKind}</Badge>
                          {hit.context && (
                            <Badge variant="neutral" className="font-mono">
                              {hit.context}
                            </Badge>
                          )}
                        </div>
                        {hit.date && (
                          <span className="text-[11px] text-aura-text-muted">
                            {formatDate(hit.date)}
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-aura-primary whitespace-pre-wrap break-words">
                        {hit.text}
                      </p>

                      {(hit.entities.length > 0 || hit.tags.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {hit.entities.map((entity) => (
                            <Badge key={entity} variant="info">
                              {entity}
                            </Badge>
                          ))}
                          {hit.tags.map((tag) => (
                            <Badge key={tag} variant="neutral">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-end pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenInGalaxy?.(hit.bankId, hit.id)}
                        >
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("hindsightPanel.openInGalaxy")}
                        </Button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
