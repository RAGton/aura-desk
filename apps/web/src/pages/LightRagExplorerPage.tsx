import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Compass,
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  Network,
  Play,
  RefreshCw,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";

import { Badge, Button, EmptyState, Input, PageHeader, Skeleton } from "../components/ui";
import {
  knowledgeApi,
  raglightApi,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentsResult,
  type KnowledgeEntityEntry,
  type KnowledgeExplorerOverview,
  type KnowledgeGraphPayload,
  type KnowledgeRelationEntry,
  type KnowledgeSearchResult,
  type RaglightStatus,
} from "../lib/ipc";

export interface LightRagExplorerPageProps {
  onOpenSettings?: () => void;
}

type KnowledgeTab = "documents" | "entities" | "graph" | "search";

interface Point2D {
  x: number;
  y: number;
}

const SVG_WIDTH = 800;
const SVG_HEIGHT = 480;

function truncateLabel(text: string, maxLen = 22): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function relationMatchesEntity(
  rel: KnowledgeRelationEntry,
  entity: KnowledgeEntityEntry,
): boolean {
  return (
    rel.source === entity.id ||
    rel.target === entity.id ||
    rel.source === entity.name ||
    rel.target === entity.name
  );
}

function resolveNeighborKey(
  rel: KnowledgeRelationEntry,
  entity: KnowledgeEntityEntry,
): string {
  if (rel.source === entity.id || rel.source === entity.name) {
    return rel.target;
  }
  return rel.source;
}

function computeKnowledgeLayout(
  entities: KnowledgeEntityEntry[],
  relations: KnowledgeRelationEntry[],
): {
  positions: Record<string, Point2D>;
  resolvedEdges: Array<{
    relation: KnowledgeRelationEntry;
    sourceId: string;
    targetId: string;
  }>;
} {
  const positions: Record<string, Point2D> = {};
  if (entities.length === 0) {
    return { positions, resolvedEdges: [] };
  }

  const keyToNodeId = new Map<string, string>();
  for (const e of entities) {
    keyToNodeId.set(e.id, e.id);
    if (e.name) keyToNodeId.set(e.name, e.id);
  }

  const resolvedEdges: Array<{
    relation: KnowledgeRelationEntry;
    sourceId: string;
    targetId: string;
  }> = [];
  const degree = new Map<string, number>();
  for (const e of entities) degree.set(e.id, 0);

  for (const r of relations) {
    const sourceId = keyToNodeId.get(r.source);
    const targetId = keyToNodeId.get(r.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    resolvedEdges.push({ relation: r, sourceId, targetId });
    degree.set(sourceId, (degree.get(sourceId) ?? 0) + 1);
    degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
  }

  const ordered = [...entities].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
  );

  const cx = SVG_WIDTH / 2;
  const cy = SVG_HEIGHT / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  ordered.forEach((node, idx) => {
    const ratio =
      ordered.length === 1 ? 0 : Math.sqrt((idx + 0.5) / ordered.length);
    const angle = idx * goldenAngle;
    positions[node.id] = {
      x: cx + Math.cos(angle) * ratio * (SVG_WIDTH * 0.39),
      y: cy + Math.sin(angle) * ratio * (SVG_HEIGHT * 0.39),
    };
  });

  if (entities.length > 1) {
    const disp: Record<string, Point2D> = {};
    const k = Math.sqrt((SVG_WIDTH * SVG_HEIGHT) / entities.length) * 0.65;

    for (let iter = 0; iter < 40; iter += 1) {
      for (const e of entities) disp[e.id] = { x: 0, y: 0 };

      for (let i = 0; i < entities.length; i += 1) {
        const u = entities[i];
        const pu = positions[u.id];
        for (let j = i + 1; j < entities.length; j += 1) {
          const v = entities[j];
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

      for (const edge of resolvedEdges) {
        const ps = positions[edge.sourceId];
        const pt = positions[edge.targetId];
        if (!ps || !pt) continue;
        const dx = ps.x - pt.x;
        const dy = ps.y - pt.y;
        const dist = Math.max(12, Math.hypot(dx, dy));
        const force = (dist * dist) / Math.max(1, k * 2.2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[edge.sourceId].x -= fx;
        disp[edge.sourceId].y -= fy;
        disp[edge.targetId].x += fx;
        disp[edge.targetId].y += fy;
      }

      const maxStep = Math.max(2, 18 * (1 - iter / 40));
      for (const e of entities) {
        const d = disp[e.id];
        const len = Math.hypot(d.x, d.y);
        if (len > 0) {
          const step = Math.min(len, maxStep);
          positions[e.id].x = Math.min(
            SVG_WIDTH - 68,
            Math.max(68, positions[e.id].x + (d.x / len) * step),
          );
          positions[e.id].y = Math.min(
            SVG_HEIGHT - 44,
            Math.max(44, positions[e.id].y + (d.y / len) * step),
          );
        }
      }
    }
  }

  return { positions, resolvedEdges };
}

export function LightRagExplorerPage({
  onOpenSettings,
}: LightRagExplorerPageProps) {
  const { t } = useTranslation();

  const [overview, setOverview] = useState<KnowledgeExplorerOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // The managed service (RAGLight) has its own lifecycle: install, start,
  // stop, index. The page drives it directly instead of only pointing the
  // reader at Settings.
  const [raglightStatus, setRaglightStatus] = useState<RaglightStatus | null>(null);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<KnowledgeTab>("documents");
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Documents tab state
  const [docQuery, setDocQuery] = useState("");
  const [docsResult, setDocsResult] = useState<KnowledgeDocumentsResult | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedDocDetail, setSelectedDocDetail] =
    useState<KnowledgeDocumentDetail | null>(null);
  const [loadingDocDetail, setLoadingDocDetail] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  // Entities & Graph state
  const [graphPayload, setGraphPayload] = useState<KnowledgeGraphPayload | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("");
  const [selectedEntityKey, setSelectedEntityKey] = useState<string | null>(null);
  const [selectedGraphEntityKey, setSelectedGraphEntityKey] = useState<string | null>(
    null,
  );

  // Global search tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await knowledgeApi.overview();
      setOverview(data);
    } catch (err) {
      setOverview(null);
      setOverviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOverview(false);
    }
    // The managed service has its own state; the overview alone does not say
    // whether RAGLight is even installed yet.
    try {
      setRaglightStatus(await raglightApi.status());
    } catch {
      setRaglightStatus(null);
    }
  }, []);

  /** Runs one of the service lifecycle actions and reports what happened. */
  const runServiceAction = useCallback(
    async (action: "provision" | "start" | "stop" | "ingest") => {
      setServiceBusy(action);
      setServiceMessage(null);
      try {
        const result =
          action === "provision"
            ? await raglightApi.provision()
            : action === "start"
              ? await raglightApi.start()
              : action === "stop"
                ? await raglightApi.stop()
                : await raglightApi.ingest();
        setServiceMessage(result?.message ?? null);
        await loadOverview();
      } catch (err) {
        setServiceMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setServiceBusy(null);
      }
    },
    [loadOverview]
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, refreshNonce]);

  // Load documents when documents tab is active
  useEffect(() => {
    if (activeTab !== "documents" || !overview?.online) return;
    let active = true;
    setLoadingDocs(true);
    setDocError(null);
    const trimmed = docQuery.trim();
    const request = trimmed
      ? knowledgeApi.documentsList(trimmed, 100)
      : knowledgeApi.documentsList();
    void request
      .then((res) => {
        if (active) setDocsResult(res);
      })
      .catch((err) => {
        if (active) {
          setDocsResult(null);
          setDocError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (active) setLoadingDocs(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, docQuery, refreshNonce, overview?.online]);

  // Load graph (entities & relations) when entities or graph tab is active
  useEffect(() => {
    if ((activeTab !== "entities" && activeTab !== "graph") || !overview?.online)
      return;
    let active = true;
    setLoadingGraph(true);
    setGraphError(null);
    void knowledgeApi
      .graph()
      .then((res) => {
        if (active) setGraphPayload(res);
      })
      .catch((err) => {
        if (active) {
          setGraphPayload(null);
          setGraphError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (active) setLoadingGraph(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, refreshNonce, overview?.online]);

  const handleRefresh = () => {
    setRefreshNonce((n) => n + 1);
  };

  const handleSelectDocument = async (docId: string) => {
    setLoadingDocDetail(true);
    setDocError(null);
    try {
      const detail = await knowledgeApi.documentGet(docId);
      setSelectedDocDetail(detail);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDocDetail(false);
    }
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || !overview?.online) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await knowledgeApi.search(q, 10);
      setSearchResult(result);
    } catch (err) {
      setSearchResult(null);
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const entities = graphPayload?.entities ?? [];
  const relations = graphPayload?.relations ?? [];

  const filteredEntities = useMemo(() => {
    const q = entityFilter.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (ent) =>
        ent.name.toLowerCase().includes(q) ||
        ent.id.toLowerCase().includes(q) ||
        ent.entityType.toLowerCase().includes(q) ||
        ent.description.toLowerCase().includes(q),
    );
  }, [entities, entityFilter]);

  const resolveEntityByKey = useCallback(
    (key: string | null): KnowledgeEntityEntry | null => {
      if (!key) return null;
      const found = entities.find((e) => e.id === key || e.name === key);
      if (found) return found;
      return {
        id: key,
        name: key,
        entityType: "",
        description: "",
        sourceId: null,
      };
    },
    [entities],
  );

  const selectedEntity = useMemo(
    () => resolveEntityByKey(selectedEntityKey),
    [resolveEntityByKey, selectedEntityKey],
  );

  const selectedEntityRelations = useMemo(() => {
    if (!selectedEntity) return [];
    return relations.filter((rel) => relationMatchesEntity(rel, selectedEntity));
  }, [relations, selectedEntity]);

  const svgEntities = useMemo(() => entities.slice(0, 80), [entities]);
  const { positions: svgPositions, resolvedEdges: svgEdges } = useMemo(
    () => computeKnowledgeLayout(svgEntities, relations),
    [svgEntities, relations],
  );

  const selectedGraphEntity = useMemo(
    () => resolveEntityByKey(selectedGraphEntityKey),
    [resolveEntityByKey, selectedGraphEntityKey],
  );

  const selectedGraphRelations = useMemo(() => {
    if (!selectedGraphEntity) return [];
    return relations.filter((rel) => relationMatchesEntity(rel, selectedGraphEntity));
  }, [relations, selectedGraphEntity]);

  const graphNeighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedGraphEntity) return ids;
    for (const edge of svgEdges) {
      if (edge.sourceId === selectedGraphEntity.id) ids.add(edge.targetId);
      if (edge.targetId === selectedGraphEntity.id) ids.add(edge.sourceId);
    }
    return ids;
  }, [svgEdges, selectedGraphEntity]);

  const tabItems: Array<{ id: KnowledgeTab; label: string }> = [
    { id: "documents", label: t("knowledgePanel.tabs.documents") },
    { id: "entities", label: t("knowledgePanel.tabs.entities") },
    { id: "graph", label: t("knowledgePanel.tabs.graph") },
    { id: "search", label: t("knowledgePanel.tabs.search") },
  ];

  const documents = docsResult?.documents ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Compass className="h-5 w-5" aria-hidden="true" />}
        title={t("knowledgePanel.title")}
        subtitle={t("knowledgePanel.subtitle")}
        badges={
          overview ? (
            <Badge variant={overview.online ? "success" : "warning"}>
              {overview.serviceKind === "lightrag"
                ? t("knowledgePanel.service.lightrag")
                : t("knowledgePanel.service.raglight")}
            </Badge>
          ) : undefined
        }
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRefresh}
              loading={loadingOverview}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("knowledgePanel.refresh")}
            </Button>
            {overview?.online && onOpenSettings && (
              <Button size="sm" variant="outline" onClick={onOpenSettings}>
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {t("knowledgePanel.openSettings")}
              </Button>
            )}
          </>
        }
      />

      {/* Honest Connection & Diagnostics Banner */}
      {loadingOverview && !overview ? (
        <Skeleton className="h-32" />
      ) : overviewError && !overview ? (
        <div
          role="alert"
          className="rounded-aura-lg aura-glass border border-aura-danger/50 p-4 space-y-2"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-aura-danger">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>{t("knowledgePanel.offlineStatus")}</span>
          </div>
          <p className="text-xs text-aura-secondary">{t("knowledgePanel.offlineHelp")}</p>
          <p className="font-mono text-xs text-aura-text-muted break-all">
            {overviewError}
          </p>
          {onOpenSettings && (
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              {t("knowledgePanel.openSettings")}
            </Button>
          )}
        </div>
      ) : overview ? (
        overview.online ? (
          <section className="rounded-aura-lg border border-aura-success/35 bg-aura-surface/80 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge variant="success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {overview.serviceKind === "lightrag"
                    ? t("knowledgePanel.onlineLightrag")
                    : t("knowledgePanel.onlineRaglight")}
                </Badge>
                {overview.baseUrl && (
                  <span className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/60 px-2 py-0.5 font-mono text-xs text-aura-secondary">
                    {overview.baseUrl}
                  </span>
                )}
              </div>

              {Object.keys(overview.statusCounts).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(overview.statusCounts).map(([statusKey, count]) => (
                    <Badge key={statusKey} variant="neutral">
                      {statusKey}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3">
                <div className="text-xs text-aura-text-muted">
                  {t("knowledgePanel.documentsCount")}
                </div>
                <div className="mt-1 text-lg font-bold text-aura-primary tabular-nums">
                  {overview.documentsCount}
                </div>
              </div>
              <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3">
                <div className="text-xs text-aura-text-muted">
                  {t("knowledgePanel.entitiesCount")}
                </div>
                <div className="mt-1 text-lg font-bold text-aura-primary tabular-nums">
                  {overview.entitiesCount}
                </div>
              </div>
              <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3">
                <div className="text-xs text-aura-text-muted">
                  {t("knowledgePanel.relationsCount")}
                </div>
                <div className="mt-1 text-lg font-bold text-aura-primary tabular-nums">
                  {overview.relationsCount}
                </div>
              </div>
              <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3">
                <div className="text-xs text-aura-text-muted">
                  {t("knowledgePanel.localFilesCount")}
                </div>
                <div className="mt-1 text-lg font-bold text-aura-primary tabular-nums">
                  {overview.localFileCount}
                </div>
              </div>
            </div>

            {overview.configuredFolders.length > 0 && (
              <div className="space-y-1.5 border-t border-aura-border/40 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-aura-secondary">
                    <FolderOpen className="h-3.5 w-3.5 text-aura-accent" aria-hidden="true" />
                    {t("knowledgePanel.configuredFolders", {
                      count: overview.configuredFolders.length,
                    })}
                  </div>
                  {/* Re-index the authorized folders without leaving the
                      page — the reader came here to look at the knowledge. */}
                  {raglightStatus?.installed && raglightStatus.running && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={serviceBusy === "ingest"}
                      data-testid="knowledge-ingest"
                      onClick={() => void runServiceAction("ingest")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("knowledgePanel.service.ingest")}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {overview.configuredFolders.map((folder) => (
                    <span
                      key={folder}
                      className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/60 px-2 py-1 font-mono text-xs text-aura-primary"
                    >
                      {folder}
                    </span>
                  ))}
                </div>
                {serviceMessage && (
                  <p className="font-mono text-xs text-aura-secondary break-all">
                    {serviceMessage}
                  </p>
                )}
              </div>
            )}
          </section>
        ) : (
          <section
            role="status"
            className="rounded-aura-lg aura-glass border border-aura-warning/50 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-aura-warning"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-aura-warning">
                    {t("knowledgePanel.offlineStatus")}
                  </h3>
                  <p className="text-xs text-aura-primary">
                    {t("knowledgePanel.offlineHelp")}
                  </p>
                  {overview.baseUrl && (
                    <p className="font-mono text-xs text-aura-secondary">
                      {overview.baseUrl}
                    </p>
                  )}
                  {overview.diagnosticMessage && (
                    <p className="rounded-aura-sm border border-aura-warning/35 bg-aura-elevated/80 px-2.5 py-1.5 font-mono text-xs text-aura-primary break-words">
                      {overview.diagnosticMessage}
                    </p>
                  )}
                </div>
              </div>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenSettings?.()}
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {t("knowledgePanel.openSettings")}
              </Button>
            </div>

            {/* The next step, right here: the managed service can be
                installed and started without leaving the page. */}
            {raglightStatus && (
              <div
                className="space-y-3 border-t border-aura-warning/25 pt-3"
                data-testid="knowledge-service-actions"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-aura-secondary">
                    {t("knowledgePanel.service.raglightLabel")}
                  </span>
                  <Badge variant={raglightStatus.installed ? "success" : "warning"}>
                    {raglightStatus.installed
                      ? t("knowledgePanel.service.installed")
                      : t("knowledgePanel.service.notInstalled")}
                  </Badge>
                  <span className="font-mono text-xs text-aura-text-muted">
                    {raglightStatus.baseUrl}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!raglightStatus.installed ? (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={serviceBusy === "provision"}
                      data-testid="knowledge-install-service"
                      onClick={() => void runServiceAction("provision")}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("knowledgePanel.service.install")}
                    </Button>
                  ) : !raglightStatus.running ? (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={serviceBusy === "start"}
                      data-testid="knowledge-start-service"
                      onClick={() => void runServiceAction("start")}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("knowledgePanel.service.start")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={serviceBusy === "stop"}
                      data-testid="knowledge-stop-service"
                      onClick={() => void runServiceAction("stop")}
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("knowledgePanel.service.stop")}
                    </Button>
                  )}
                </div>

                {serviceMessage && (
                  <p className="font-mono text-xs text-aura-secondary break-all">
                    {serviceMessage}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5 border-t border-aura-warning/25 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-aura-secondary">
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {t("knowledgePanel.configuredFolders", {
                  count: overview.configuredFolders.length,
                })}
              </div>
              {overview.configuredFolders.length === 0 ? (
                <p className="text-xs text-aura-text-muted">
                  {t("knowledgePanel.noFolders")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {overview.configuredFolders.map((folder) => (
                    <span
                      key={folder}
                      className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/60 px-2 py-1 font-mono text-xs text-aura-primary"
                    >
                      {folder}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        )
      ) : null}

      {/* Sub-tabs — only once there is something behind them. With the
          service down, four empty tabs and a search that cannot answer are
          just noise; the panel above already says what to do. */}
      {overview?.online ? (
        <div
          role="tablist"
          aria-label={t("knowledgePanel.title")}
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
                className={`rounded-aura-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-aura-accent text-aura-inverse shadow-sm"
                    : "text-aura-secondary hover:bg-aura-muted/40 hover:text-aura-primary"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Documents Sub-tab */}
      {overview?.online && activeTab === "documents" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              containerClassName="flex-1 min-w-[220px]"
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder={t("knowledgePanel.documentsFilter")}
              aria-label={t("knowledgePanel.documentsFilter")}
            />
          </div>

          {docError && (
            <div
              role="alert"
              className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 font-mono text-xs text-aura-danger break-all"
            >
              {docError}
            </div>
          )}

          {loadingDocs ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-2.5 lg:col-span-5">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
              <div className="lg:col-span-7">
                <Skeleton className="h-64" />
              </div>
            </div>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title={
                overview && !overview.online
                  ? t("knowledgePanel.emptyData")
                  : t("knowledgePanel.selectDocHint")
              }
              description={docsResult?.diagnosticMessage ?? undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-2.5 lg:col-span-5 max-h-[560px] overflow-y-auto pr-1">
                {documents.map((doc) => {
                  const isSelected = selectedDocDetail?.id === doc.id;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => void handleSelectDocument(doc.id)}
                      className={`w-full rounded-aura-lg border p-3.5 text-left space-y-2 transition-colors ${
                        isSelected
                          ? "border-aura-accent/70 bg-aura-accent/10"
                          : "border-aura-border/40 bg-aura-surface/75 hover:border-aura-border-strong/70"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-aura-primary">
                          {doc.title || doc.id}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="info">{doc.status}</Badge>
                          <Badge variant="neutral">{doc.origin}</Badge>
                        </div>
                      </div>

                      {doc.sourcePath && (
                        <div className="truncate font-mono text-[11px] text-aura-text-muted">
                          {doc.sourcePath}
                        </div>
                      )}

                      {doc.contentPreview && (
                        <p className="line-clamp-2 text-xs text-aura-secondary">
                          {doc.contentPreview}
                        </p>
                      )}

                      {doc.entities.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {doc.entities.slice(0, 6).map((ent) => (
                            <Badge key={ent} variant="neutral">
                              {ent}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 lg:col-span-7 self-start">
                {loadingDocDetail ? (
                  <Skeleton lines={7} />
                ) : !selectedDocDetail ? (
                  <EmptyState
                    icon={<FileText className="h-5 w-5" />}
                    title={t("knowledgePanel.selectDocHint")}
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2 border-b border-aura-border/40 pb-3">
                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate text-sm font-semibold text-aura-primary">
                          {selectedDocDetail.title || selectedDocDetail.id}
                        </h3>
                        {selectedDocDetail.sourcePath && (
                          <p className="truncate font-mono text-xs text-aura-text-muted">
                            {selectedDocDetail.sourcePath}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="info">{selectedDocDetail.status}</Badge>
                          <Badge variant="neutral">{selectedDocDetail.origin}</Badge>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedDocDetail(null)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>

                    <div className="max-h-64 overflow-y-auto rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 font-mono text-xs text-aura-primary whitespace-pre-wrap break-words">
                      {selectedDocDetail.content || "—"}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-aura-secondary">
                        {t("knowledgePanel.entitiesCount")} (
                        {selectedDocDetail.entities.length})
                      </div>
                      {selectedDocDetail.entities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedDocDetail.entities.map((ent) => (
                            <Badge key={ent} variant="info">
                              {ent}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 border-t border-aura-border/40 pt-3">
                      <div className="text-xs font-semibold text-aura-secondary">
                        {t("knowledgePanel.relationsCount")} (
                        {selectedDocDetail.relations.length})
                      </div>
                      {selectedDocDetail.relations.length > 0 && (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {selectedDocDetail.relations.map((rel) => (
                            <div
                              key={rel.id}
                              className="rounded-aura-sm border border-aura-border/40 bg-aura-canvas/50 p-2.5 text-xs space-y-1"
                            >
                              <div className="flex flex-wrap items-center gap-1.5 font-semibold text-aura-primary">
                                <span>{rel.source}</span>
                                <ArrowRight
                                  className="h-3 w-3 text-aura-accent"
                                  aria-hidden="true"
                                />
                                <span>{rel.target}</span>
                              </div>
                              {rel.description && (
                                <p className="text-aura-secondary">{rel.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      )}

      {/* Entities & Relations Sub-tab */}
      {overview?.online && activeTab === "entities" && (
        <div className="space-y-4">
          <Input
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            placeholder={t("knowledgePanel.searchPlaceholder")}
            aria-label={t("knowledgePanel.searchPlaceholder")}
          />

          {graphError && (
            <div
              role="alert"
              className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 font-mono text-xs text-aura-danger break-all"
            >
              {graphError}
            </div>
          )}

          {loadingGraph ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-2.5 lg:col-span-5">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
              <div className="lg:col-span-7">
                <Skeleton className="h-64" />
              </div>
            </div>
          ) : entities.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-5 w-5" />}
              title={
                overview && !overview.online
                  ? t("knowledgePanel.emptyData")
                  : t("knowledgePanel.selectEntityHint")
              }
              description={graphPayload?.diagnosticMessage ?? undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-5 max-h-[560px] overflow-y-auto pr-1">
                {filteredEntities.map((entity) => {
                  const active =
                    selectedEntity !== null &&
                    (selectedEntity.id === entity.id ||
                      selectedEntity.name === entity.name);
                  return (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => setSelectedEntityKey(entity.id)}
                      className={`w-full rounded-aura-lg border p-3 text-left space-y-1.5 transition-colors ${
                        active
                          ? "border-aura-accent/70 bg-aura-accent/10"
                          : "border-aura-border/40 bg-aura-surface/75 hover:border-aura-border-strong/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-aura-primary">
                          {entity.name || entity.id}
                        </span>
                        {entity.entityType && (
                          <Badge variant="info">{entity.entityType}</Badge>
                        )}
                      </div>
                      {entity.description && (
                        <p className="line-clamp-2 text-xs text-aura-secondary">
                          {entity.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 lg:col-span-7 self-start">
                {!selectedEntity ? (
                  <EmptyState
                    icon={<GitBranch className="h-5 w-5" />}
                    title={t("knowledgePanel.selectEntityHint")}
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2 border-b border-aura-border/40 pb-3">
                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate text-base font-semibold text-aura-primary">
                          {selectedEntity.name || selectedEntity.id}
                        </h3>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-aura-text-muted">
                            {selectedEntity.id}
                          </span>
                          {selectedEntity.entityType && (
                            <Badge variant="info">{selectedEntity.entityType}</Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedEntityKey(null)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>

                    {selectedEntity.description && (
                      <p className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-3 text-xs text-aura-primary whitespace-pre-wrap break-words">
                        {selectedEntity.description}
                      </p>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-aura-secondary">
                        <GitBranch className="h-3.5 w-3.5 text-aura-accent" aria-hidden="true" />
                        {t("knowledgePanel.connectedRelations", {
                          count: selectedEntityRelations.length,
                        })}
                      </div>

                      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                        {selectedEntityRelations.map((rel) => {
                          const neighborKey = resolveNeighborKey(rel, selectedEntity);
                          return (
                            <div
                              key={rel.id}
                              className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3 space-y-2 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5 font-medium text-aura-primary">
                                  <span className="font-mono">{rel.source}</span>
                                  <ArrowRight
                                    className="h-3.5 w-3.5 text-aura-accent"
                                    aria-hidden="true"
                                  />
                                  <span className="font-mono">{rel.target}</span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setSelectedEntityKey(neighborKey)}
                                >
                                  {neighborKey}
                                </Button>
                              </div>

                              {rel.description && (
                                <p className="text-aura-secondary">{rel.description}</p>
                              )}

                              {rel.keywords.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {rel.keywords.map((kw) => (
                                    <Badge key={kw} variant="neutral">
                                      {kw}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      )}

      {/* Knowledge Graph SVG Sub-tab */}
      {overview?.online && activeTab === "graph" && (
        <div className="space-y-4">
          {graphError && (
            <div
              role="alert"
              className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 font-mono text-xs text-aura-danger break-all"
            >
              {graphError}
            </div>
          )}

          {loadingGraph ? (
            <Skeleton className="h-[440px]" />
          ) : svgEntities.length === 0 ? (
            <EmptyState
              icon={<Network className="h-5 w-5" />}
              title={t("knowledgePanel.emptyData")}
              description={graphPayload?.diagnosticMessage ?? undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <div
                className={
                  selectedGraphEntity
                    ? "rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 xl:col-span-8"
                    : "rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 xl:col-span-12"
                }
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-aura-text-muted">
                  <span>
                    {t("knowledgePanel.entitiesCount")}: {svgEntities.length} ·{" "}
                    {t("knowledgePanel.relationsCount")}: {svgEdges.length}
                  </span>
                  {selectedGraphEntityKey && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedGraphEntityKey(null)}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  )}
                </div>

                <svg
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  aria-label={t("knowledgePanel.tabs.graph")}
                  className="h-[430px] w-full rounded-aura-md border border-aura-border/40 bg-aura-canvas/90"
                >
                  <g>
                    {svgEdges.map(({ relation, sourceId, targetId }) => {
                      const from = svgPositions[sourceId];
                      const to = svgPositions[targetId];
                      if (!from || !to) return null;
                      const isHighlighted =
                        selectedGraphEntity !== null &&
                        (sourceId === selectedGraphEntity.id ||
                          targetId === selectedGraphEntity.id);
                      const dimmed =
                        selectedGraphEntity !== null && !isHighlighted;

                      return (
                        <g key={relation.id}>
                          <line
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={
                              isHighlighted
                                ? "rgb(56 189 248)"
                                : "rgba(148, 163, 184, 0.45)"
                            }
                            strokeWidth={isHighlighted ? 2.2 : 1.1}
                            strokeOpacity={dimmed ? 0.16 : isHighlighted ? 0.95 : 0.45}
                          />
                          {isHighlighted && relation.keywords.length > 0 && (
                            <text
                              x={(from.x + to.x) / 2}
                              y={(from.y + to.y) / 2 - 4}
                              textAnchor="middle"
                              className="fill-sky-300 text-[10px] font-medium pointer-events-none"
                            >
                              {truncateLabel(relation.keywords[0], 18)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>

                  <g>
                    {svgEntities.map((entity) => {
                      const pos = svgPositions[entity.id];
                      if (!pos) return null;
                      const isSelected =
                        selectedGraphEntity !== null &&
                        selectedGraphEntity.id === entity.id;
                      const isNeighbor = graphNeighborIds.has(entity.id);
                      const dimmed =
                        selectedGraphEntity !== null && !isSelected && !isNeighbor;

                      return (
                        <g
                          key={entity.id}
                          transform={`translate(${pos.x}, ${pos.y})`}
                          role="button"
                          tabIndex={0}
                          aria-label={entity.name || entity.id}
                          onClick={() => setSelectedGraphEntityKey(entity.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedGraphEntityKey(entity.id);
                            }
                          }}
                          style={{
                            cursor: "pointer",
                            opacity: dimmed ? 0.3 : 1,
                          }}
                        >
                          {isSelected && (
                            <circle
                              r={15}
                              fill="none"
                              stroke="rgb(56 189 248)"
                              strokeWidth={2}
                            />
                          )}
                          <circle
                            r={isSelected ? 10 : isNeighbor ? 8.5 : 7}
                            fill={
                              isSelected
                                ? "rgb(56 189 248)"
                                : isNeighbor
                                  ? "rgb(99 102 241)"
                                  : "rgb(16 185 129)"
                            }
                            stroke="rgb(248 250 252)"
                            strokeWidth={isSelected ? 2 : 1}
                          />
                          <text
                            y={20}
                            textAnchor="middle"
                            className="fill-slate-200 text-[10px] font-medium pointer-events-none"
                          >
                            {truncateLabel(entity.name || entity.id, 18)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>

              {selectedGraphEntity && (
                <aside className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/85 p-4 space-y-3 self-start xl:col-span-4">
                  <div className="flex items-start justify-between gap-2 border-b border-aura-border/40 pb-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-aura-primary">
                        {selectedGraphEntity.name || selectedGraphEntity.id}
                      </h4>
                      {selectedGraphEntity.entityType && (
                        <Badge variant="info" className="mt-1">
                          {selectedGraphEntity.entityType}
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedGraphEntityKey(null)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>

                  {selectedGraphEntity.description && (
                    <p className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/60 p-2.5 text-xs text-aura-primary whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {selectedGraphEntity.description}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-aura-secondary">
                      {t("knowledgePanel.connectedRelations", {
                        count: selectedGraphRelations.length,
                      })}
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {selectedGraphRelations.map((rel) => {
                        const neighborKey = resolveNeighborKey(
                          rel,
                          selectedGraphEntity,
                        );
                        return (
                          <button
                            key={rel.id}
                            type="button"
                            onClick={() => setSelectedGraphEntityKey(neighborKey)}
                            className="w-full rounded-aura-sm border border-aura-border/40 bg-aura-canvas/50 p-2 text-left text-xs hover:border-aura-accent/60 transition-colors space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2 font-medium text-aura-primary">
                              <span className="truncate">{neighborKey}</span>
                              <ArrowRight
                                className="h-3 w-3 shrink-0 text-aura-accent"
                                aria-hidden="true"
                              />
                            </div>
                            {rel.description && (
                              <p className="line-clamp-2 text-[11px] text-aura-secondary">
                                {rel.description}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>
              )}
            </div>
          )}
        </div>
      )}

      {/* Global Search Sub-tab */}
      {overview?.online && activeTab === "search" && (
        <div className="space-y-4">
          <form
            onSubmit={handleSearch}
            className="flex flex-col gap-3 rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 sm:flex-row sm:items-center"
          >
            <Input
              containerClassName="flex-1 min-w-0"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("knowledgePanel.searchPlaceholder")}
              aria-label={t("knowledgePanel.searchPlaceholder")}
            />
            <Button type="submit" variant="primary" loading={searching}>
              <Search className="h-4 w-4" aria-hidden="true" />
              {t("knowledgePanel.searchAction")}
            </Button>
          </form>

          {searchError && (
            <div
              role="alert"
              className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 font-mono text-xs text-aura-danger break-all"
            >
              {searchError}
            </div>
          )}

          {searching ? (
            <Skeleton lines={6} />
          ) : searchResult ? (
            <div className="space-y-4">
              {!searchResult.online && searchResult.diagnosticMessage && (
                <div
                  role="status"
                  className="rounded-aura-md border border-aura-warning/40 bg-aura-warning/10 px-3 py-2 font-mono text-xs text-aura-warning break-words"
                >
                  {searchResult.diagnosticMessage}
                </div>
              )}

              {searchResult.answer && (
                <div className="rounded-aura-lg border border-aura-accent/40 bg-aura-surface/85 p-4 space-y-2.5">
                  <p className="text-sm text-aura-primary whitespace-pre-wrap break-words">
                    {searchResult.answer}
                  </p>
                  {searchResult.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {searchResult.sources.map((src) => (
                        <Badge key={src} variant="neutral" className="font-mono">
                          {src}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Matching Documents */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-aura-secondary">
                  {t("knowledgePanel.documentsCount")} (
                  {searchResult.matchingDocuments.length})
                </h3>
                {searchResult.matchingDocuments.length > 0 && (
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {searchResult.matchingDocuments.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => {
                          setActiveTab("documents");
                          void handleSelectDocument(doc.id);
                        }}
                        className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 text-left space-y-1.5 hover:border-aura-accent/60 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-aura-primary">
                            {doc.title || doc.id}
                          </span>
                          <Badge variant="info">{doc.status}</Badge>
                        </div>
                        {doc.contentPreview && (
                          <p className="line-clamp-2 text-xs text-aura-secondary">
                            {doc.contentPreview}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Matching Entities */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-aura-secondary">
                  {t("knowledgePanel.entitiesCount")} (
                  {searchResult.matchingEntities.length})
                </h3>
                {searchResult.matchingEntities.length > 0 && (
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {searchResult.matchingEntities.map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        onClick={() => {
                          setSelectedEntityKey(entity.id);
                          setActiveTab("entities");
                        }}
                        className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 text-left space-y-1.5 hover:border-aura-accent/60 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-aura-primary">
                            {entity.name || entity.id}
                          </span>
                          {entity.entityType && (
                            <Badge variant="info">{entity.entityType}</Badge>
                          )}
                        </div>
                        {entity.description && (
                          <p className="line-clamp-2 text-xs text-aura-secondary">
                            {entity.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Matching Relations */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-aura-secondary">
                  {t("knowledgePanel.relationsCount")} (
                  {searchResult.matchingRelations.length})
                </h3>
                {searchResult.matchingRelations.length > 0 && (
                  <div className="space-y-2">
                    {searchResult.matchingRelations.map((rel) => (
                      <div
                        key={rel.id}
                        className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-3 space-y-1.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold text-aura-primary">
                          <span>{rel.source}</span>
                          <ArrowRight
                            className="h-3.5 w-3.5 text-aura-accent"
                            aria-hidden="true"
                          />
                          <span>{rel.target}</span>
                        </div>
                        {rel.description && (
                          <p className="text-aura-secondary">{rel.description}</p>
                        )}
                        {rel.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {rel.keywords.map((kw) => (
                              <Badge key={kw} variant="neutral">
                                {kw}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title={t("knowledgePanel.searchPlaceholder")}
            />
          )}
        </div>
      )}
    </div>
  );
}
