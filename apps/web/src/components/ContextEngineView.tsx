import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Brain,
  Cpu,
  Database,
  History,
  Layers,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Badge, Button, EmptyState, Skeleton } from "./ui";
import {
  contextEngineApi,
  type ChatSession,
  type ContextInspection,
  type ContextLayerSnapshot,
} from "../lib/ipc";

export interface ContextEngineViewProps {
  sessionId: string;
  onSessionUpdated?: (session: ChatSession) => void;
}

const LAYER_TITLE_KEYS: Record<string, string> = {
  system: "sessions.context.layers.system",
  user: "sessions.context.layers.user",
  session: "sessions.context.layers.session",
  recent: "sessions.context.layers.recent",
  retrieved: "sessions.context.layers.retrieved",
  working: "sessions.context.layers.working",
  tool: "sessions.context.layers.tool",
};

function renderLayerIcon(kind: string) {
  switch (kind) {
    case "system":
      return <ShieldCheck className="h-4 w-4 text-aura-accent shrink-0" aria-hidden="true" />;
    case "user":
      return <Sparkles className="h-4 w-4 text-aura-accent-secondary shrink-0" aria-hidden="true" />;
    case "session":
      return <Brain className="h-4 w-4 text-aura-info shrink-0" aria-hidden="true" />;
    case "recent":
      return <MessageSquare className="h-4 w-4 text-aura-success shrink-0" aria-hidden="true" />;
    case "retrieved":
      return <Database className="h-4 w-4 text-aura-warning shrink-0" aria-hidden="true" />;
    case "working":
      return <Cpu className="h-4 w-4 text-aura-accent shrink-0" aria-hidden="true" />;
    case "tool":
      return <Wrench className="h-4 w-4 text-aura-secondary shrink-0" aria-hidden="true" />;
    default:
      return <Layers className="h-4 w-4 text-aura-secondary shrink-0" aria-hidden="true" />;
  }
}

function getContextStatePresentation(
  state: string,
  t: TFunction
): { label: string; variant: "info" | "warning" | "success"; barClass: string } {
  if (state === "compressed") {
    return {
      label: t("sessions.context.stateCompressed"),
      variant: "info",
      barClass: "bg-aura-info",
    };
  }
  if (state === "approaching_limit") {
    return {
      label: t("sessions.context.stateApproaching"),
      variant: "warning",
      barClass: "bg-aura-warning",
    };
  }
  return {
    label: t("sessions.context.stateHealthy"),
    variant: "success",
    barClass: "bg-aura-success",
  };
}

function formatLayerPreview(layer: ContextLayerSnapshot, t: TFunction): string {
  const raw = (layer.preview ?? "").trim();
  if (!raw || raw === "—") {
    return "—";
  }
  if (raw === "aura_persona_policy") {
    return t("settings.items.aiSystemPrompt.label");
  }
  if (raw === "workspace_tasks_pomodoro") {
    return `${t("nav.kanban")} · ${t("nav.pomodoro")}`;
  }
  if (raw === "user_facts_empty" || raw === "semantic_summary_empty") {
    return t("hindsightPanel.emptyList");
  }
  if (/^\d+\s+[a-z]+(?:_[a-z]+)+$/.test(raw)) {
    return raw.replace(/_/g, " ");
  }
  return raw;
}

function formatMachineToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "—";
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+(?:\s*\([^)]*\))?$/.test(trimmed)) {
    return trimmed.replace(/_/g, " ");
  }
  return trimmed;
}

function formatDateTime(raw?: string | null): string {
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

export function ContextEngineView({
  sessionId,
  onSessionUpdated,
}: ContextEngineViewProps) {
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  const [inspection, setInspection] = useState<ContextInspection | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [compressing, setCompressing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    setInspection(null);

    void contextEngineApi
      .inspect(sessionId)
      .then((res) => {
        if (!active) return;
        setInspection(res);
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [sessionId]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await contextEngineApi.inspect(sessionId);
      if (!mountedRef.current) return;
      setInspection(res);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [sessionId]);

  const handleCompress = async () => {
    setCompressing(true);
    setErrorMsg(null);
    try {
      const updated = await contextEngineApi.compress(sessionId, "manual_ui");
      if (!mountedRef.current) return;
      setInspection(updated);
      onSessionUpdated?.(updated.session);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setCompressing(false);
      }
    }
  };

  const stateUi = getContextStatePresentation(
    inspection?.session.contextState ?? "healthy",
    t
  );
  const clampedPct = Math.max(0, Math.min(100, inspection?.usagePct ?? 0));
  const totalTokensDenom = Math.max(1, inspection?.totalTokens ?? 0);

  return (
    <div className="space-y-4" data-testid="context-engine-view">
      {/* Header & Token Budget Gauge */}
      <section className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="h-4 w-4 text-aura-accent shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-aura-primary">
                {t("sessions.context.title")}
              </h3>
              {inspection && (
                <Badge variant={stateUi.variant} data-testid="context-state-badge">
                  {stateUi.label}
                </Badge>
              )}
            </div>
            <p className="text-xs text-aura-text-muted">
              {t("sessions.context.subtitle")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void handleRefresh()}
              disabled={loading || compressing}
              aria-label={t("hindsightPanel.refresh")}
              title={t("hindsightPanel.refresh")}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {t("hindsightPanel.refresh")}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="primary"
              data-testid="compress-context-btn"
              loading={compressing}
              disabled={loading || compressing}
              onClick={() => void handleCompress()}
            >
              {compressing
                ? t("sessions.context.compressing")
                : t("sessions.context.compressNow")}
            </Button>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 text-xs text-aura-danger"
          >
            <span className="break-words">{errorMsg}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleRefresh()}
            >
              {t("updater.banner.retry")}
            </Button>
          </div>
        )}

        {loading && !inspection ? (
          <Skeleton lines={4} />
        ) : inspection ? (
          <div className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-aura-secondary tabular-nums">
                {t("sessions.tokensUsage", {
                  used: inspection.totalTokens,
                  budget: inspection.tokenBudget,
                })}
              </span>
              <span
                className="font-semibold text-aura-primary tabular-nums"
                data-testid="context-usage-pct"
              >
                {inspection.usagePct}%
              </span>
            </div>

            <div
              role="progressbar"
              aria-valuenow={clampedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("sessions.context.title")}
              className="h-2.5 w-full overflow-hidden rounded-full bg-aura-muted/45"
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${stateUi.barClass}`}
                style={{ width: `${clampedPct}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-aura-text-muted">
              <span data-testid="context-history-count">
                {t("sessions.context.historyCount", {
                  count: inspection.totalHistoryMessages,
                })}
              </span>
              <Badge variant="neutral">
                {t("sessions.compressionsCount", {
                  count: inspection.session.compressionCount,
                })}
              </Badge>
            </div>
          </div>
        ) : null}
      </section>

      {/* 7 Context Window Layers */}
      {inspection && (
        <section className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-aura-secondary">
              {t("sessions.context.layersTitle")}
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {inspection.layers.map((layer) => {
              const titleKey = LAYER_TITLE_KEYS[layer.kind];
              const layerTitle = titleKey
                ? t(titleKey)
                : layer.label || layer.kind;
              const sharePct = Math.min(
                100,
                Math.round((layer.tokenCount / totalTokensDenom) * 100)
              );

              return (
                <article
                  key={layer.kind}
                  data-testid={`context-layer-${layer.kind}`}
                  className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/45 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {renderLayerIcon(layer.kind)}
                      <span className="text-xs font-semibold text-aura-primary truncate">
                        {layerTitle}
                      </span>
                    </div>
                    <Badge variant="neutral" className="shrink-0 tabular-nums">
                      {t("sessions.context.layerTokens", {
                        tokens: layer.tokenCount,
                        items: layer.itemCount,
                      })}
                    </Badge>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-aura-muted/35">
                    <div
                      className="h-full rounded-full bg-aura-accent/75 transition-all duration-300"
                      style={{ width: `${sharePct}%` }}
                    />
                  </div>

                  <p className="text-xs text-aura-secondary leading-relaxed break-words whitespace-pre-wrap">
                    {formatLayerPreview(layer, t)}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Chronological Audit Trail */}
      {inspection && (
        <section className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-aura-accent shrink-0" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-aura-secondary">
              {t("sessions.context.eventsTitle")}
            </h4>
          </div>

          {inspection.events.length === 0 ? (
            <EmptyState
              icon={<History className="h-5 w-5" />}
              title={t("sessions.context.noEvents")}
            />
          ) : (
            <div className="space-y-2.5" data-testid="context-events-list">
              {inspection.events.map((ev) => (
                <article
                  key={ev.id}
                  data-testid={`context-event-${ev.id}`}
                  className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/45 p-3 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={ev.kind === "compression" ? "info" : "neutral"}
                      >
                        {formatMachineToken(ev.kind)}
                      </Badge>
                      <span className="text-xs font-medium text-aura-primary">
                        {formatMachineToken(ev.reason)}
                      </span>
                    </div>
                    <time className="text-[11px] text-aura-text-muted tabular-nums">
                      {formatDateTime(ev.createdAt)}
                    </time>
                  </div>

                  <p className="text-xs text-aura-secondary tabular-nums">
                    {t("sessions.context.eventTokens", {
                      before: ev.tokensBefore,
                      after: ev.tokensAfter,
                      compressed: ev.messagesCompressed,
                    })}
                  </p>

                  {(ev.preservedMessageIds.length > 0 ||
                    ev.retrievedMemoryIds.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-aura-text-muted">
                      {ev.preservedMessageIds.length > 0 && (
                        <span>
                          {t("sessions.messagesCount", {
                            count: ev.preservedMessageIds.length,
                          })}
                        </span>
                      )}
                      {ev.retrievedMemoryIds.length > 0 && (
                        <span>
                          {t("sessions.metaMemories")}: {ev.retrievedMemoryIds.length}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
