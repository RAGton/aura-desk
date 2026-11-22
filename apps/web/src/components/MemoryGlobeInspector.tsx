import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  Sparkles,
  Tag,
} from "lucide-react";

import {
  hindsightExploreApi,
  type HindsightMemoryDetail,
} from "../lib/ipc";
import { Badge, Button } from "./ui";

export interface SelectedGalaxyGlobe {
  id: string;
  bankId: string;
  bankName?: string;
  title: string;
  content: string;
  factType?: string | null;
  date?: string | null;
  context?: string | null;
  documentId?: string | null;
  entities: string[];
  tags: string[];
}

export interface ConnectedGalaxyGlobe {
  id: string;
  bankId: string;
  title: string;
  linkType?: string | null;
  entityName?: string | null;
}

export interface MemoryGlobeInspectorProps {
  globe: SelectedGalaxyGlobe;
  connectedGlobes: ConnectedGalaxyGlobe[];
  onSelectGlobe: (memoryId: string, bankId?: string) => void;
  onBackToGalaxy: () => void;
  onOpenHindsightBank?: (bankId: string) => void;
}

function formatDateLabel(raw?: string | null): string {
  if (!raw) return "—";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw.slice(0, 16);
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function MemoryGlobeInspector({
  globe,
  connectedGlobes,
  onSelectGlobe,
  onBackToGalaxy,
  onOpenHindsightBank,
}: MemoryGlobeInspectorProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<HindsightMemoryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let active = true;
    setDetail(null);
    if (!globe.bankId || !globe.id || globe.id.startsWith("mem-")) {
      return;
    }
    setLoadingDetail(true);
    void hindsightExploreApi
      .memoryGet(globe.bankId, globe.id)
      .then((res) => {
        if (active && res && res.id) {
          setDetail(res);
        }
      })
      .catch(() => {
        // Keep base globe snapshot cleanly if daemon detail endpoint is unavailable
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [globe.bankId, globe.id]);

  const effectiveContent = detail?.text || globe.content;
  const effectiveFactType = detail?.factType || globe.factType || "world";
  const effectiveContext = detail?.context || globe.context;
  const effectiveDate = detail?.date || detail?.mentionedAt || globe.date;
  const effectiveEntities =
    detail && detail.entities.length > 0 ? detail.entities : globe.entities;
  const effectiveTags = detail && detail.tags.length > 0 ? detail.tags : globe.tags;

  return (
    <aside
      data-testid="memory-globe-inspector"
      aria-label={t("hermes.galaxy.inspectorTitle")}
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-sky-400/35 bg-slate-950/88 backdrop-blur-xl shadow-2xl shadow-sky-950/60 p-4 text-slate-100 space-y-3 max-h-[68vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2 border-b border-sky-400/20 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sky-300 font-semibold">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t("hermes.galaxy.inspectorTitle")}</span>
          </div>
          <h3 className="text-sm font-semibold text-white truncate mt-0.5">
            {globe.title || effectiveContext || globe.id}
          </h3>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="back-to-galaxy-btn"
          onClick={onBackToGalaxy}
          className="h-7 shrink-0 rounded-full border-sky-400/40 bg-slate-900/90 text-sky-200 hover:bg-sky-500/20 text-[11px] px-2.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("hermes.galaxy.backToGalaxy")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge variant="info" className="rounded-full">
          <FolderOpen className="h-3 w-3" aria-hidden="true" />
          {t("hermes.galaxy.bankLabel")}: {globe.bankName || globe.bankId}
        </Badge>
        <Badge variant="neutral" className="rounded-full">
          {t("hermes.galaxy.categoryLabel")}: {effectiveFactType}
        </Badge>
        {effectiveDate && (
          <Badge variant="neutral" className="rounded-full">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {formatDateLabel(effectiveDate)}
          </Badge>
        )}
      </div>

      {effectiveContext && (
        <div className="text-[11px] text-slate-300">
          <span className="font-semibold text-sky-300">{t("hermes.galaxy.contextLabel")}: </span>
          <span className="font-mono break-all">{effectiveContext}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-700/60 bg-slate-900/75 p-3 text-xs text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
        {effectiveContent}
      </div>

      {loadingDetail && (
        <div className="flex items-center gap-2 text-[11px] text-sky-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>{t("hermes.galaxy.loadingDetail")}</span>
        </div>
      )}

      {effectiveEntities.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-300">
            {t("hermes.galaxy.entitiesLabel")}
          </div>
          <div className="flex flex-wrap gap-1">
            {effectiveEntities.map((entity) => (
              <span
                key={entity}
                className="rounded-full border border-indigo-400/35 bg-indigo-500/15 px-2 py-0.5 text-[10px] text-indigo-200"
              >
                {entity}
              </span>
            ))}
          </div>
        </div>
      )}

      {effectiveTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Tag className="h-3 w-3 text-emerald-300" aria-hidden="true" />
          {effectiveTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-1.5 border-t border-slate-800 pt-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("hermes.galaxy.connectedLabel", { count: connectedGlobes.length })}</span>
        </div>
        {connectedGlobes.length === 0 ? (
          <p className="text-[11px] text-slate-400">{t("hermes.galaxy.noConnected")}</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
            {connectedGlobes.map((conn) => (
              <button
                key={`${conn.bankId}:${conn.id}`}
                type="button"
                onClick={() => onSelectGlobe(conn.id, conn.bankId)}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-sky-400/60 hover:bg-sky-500/15 transition-colors cursor-pointer"
              >
                <span className="truncate font-medium">{conn.title}</span>
                <span className="shrink-0 text-[10px] text-sky-300">
                  {conn.entityName || conn.linkType || conn.bankId}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && detail.history.length > 0 && (
        <div className="space-y-1 border-t border-slate-800 pt-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("hermes.galaxy.historyLabel")}</span>
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
            {detail.history.slice(0, 5).map((entry, idx) => (
              <div
                key={entry.id ?? idx}
                className="rounded-md bg-slate-900/80 border border-slate-800 px-2 py-1 text-[10px] text-slate-300"
              >
                <span className="text-amber-300 font-semibold mr-1.5">
                  {entry.action || "rev"}
                </span>
                <span>{entry.text || entry.changedAt || entry.createdAt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {onOpenHindsightBank && (
        <div className="pt-1 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onOpenHindsightBank(globe.bankId)}
            className="h-7 rounded-full text-[11px] text-sky-300 hover:bg-sky-500/15"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {t("hermes.galaxy.openInPanel")}
          </Button>
        </div>
      )}
    </aside>
  );
}
