import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Cpu,
  Layers,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { ContextEngineView } from "../components/ContextEngineView";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "../components/ui";
import {
  aiApi,
  sessionsApi,
  type ChatSession,
  type PersistedChatMessage,
} from "../lib/ipc";

export interface SessionsCenterPageProps {
  activeSessionId: string;
  onContinueSession: (sessionId: string) => void;
  onActiveSessionDeleted?: () => void;
}

type SessionsSubTab = "conversations" | "management" | "contextEngine";

function resolveSessionTitle(session: ChatSession, t: TFunction): string {
  if (
    session.title === "sessions.defaultTitle" ||
    session.title === "sessions.untitledSession"
  ) {
    return t(session.title);
  }
  return session.title.trim() || t("sessions.untitledSession");
}

function getSessionStatusBadge(
  status: string,
  t: TFunction
): { label: string; variant: "success" | "neutral" | "info" } {
  if (status === "archived") {
    return { label: t("sessions.statusArchived"), variant: "neutral" };
  }
  if (status === "compressed") {
    return { label: t("sessions.statusCompressed"), variant: "info" };
  }
  return { label: t("sessions.statusActive"), variant: "success" };
}

function getContextBadge(
  contextState: string,
  t: TFunction
): { label: string; variant: "info" | "warning" | "success" } {
  if (contextState === "compressed") {
    return { label: t("sessions.context.stateCompressed"), variant: "info" };
  }
  if (contextState === "approaching_limit") {
    return { label: t("sessions.context.stateApproaching"), variant: "warning" };
  }
  return { label: t("sessions.context.stateHealthy"), variant: "success" };
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

export function SessionsCenterPage({
  activeSessionId,
  onContinueSession,
  onActiveSessionDeleted,
}: SessionsCenterPageProps) {
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  const [subTab, setSubTab] = useState<SessionsSubTab>("conversations");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [query, setQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>("");

  // Selection & raw transcript inspection for Management view
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    activeSessionId || "default"
  );
  const [history, setHistory] = useState<PersistedChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      setSelectedSessionId((prev) => prev || activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);

    void sessionsApi
      .list(
        query,
        statusFilter === "all" ? null : statusFilter,
        dateFrom || null,
        dateTo || null
      )
      .then((list) => {
        if (!active) return;
        const safeList = Array.isArray(list) ? list : [];
        setSessions(safeList);
        if (safeList.length > 0) {
          setSelectedSessionId((prev) =>
            safeList.some((s) => s.id === prev)
              ? prev
              : safeList.find((s) => s.id === activeSessionId)?.id ??
                safeList[0].id
          );
        }
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
  }, [query, statusFilter, dateFrom, dateTo]);

  const selectedSession =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null;
  const effectiveSelectedId = selectedSession?.id ?? "";

  useEffect(() => {
    if (subTab !== "management" || !effectiveSelectedId) {
      return;
    }
    let active = true;
    setHistoryLoading(true);
    setHistoryError(null);

    void aiApi
      .chatHistory(50, effectiveSelectedId)
      .then((rows) => {
        if (!active) return;
        setHistory(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!active) return;
        setHistoryError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [subTab, effectiveSelectedId]);

  const handleCreateSession = async () => {
    setCreating(true);
    setErrorMsg(null);
    try {
      const created = await sessionsApi.create();
      if (!mountedRef.current) return;
      setSessions((prev) => {
        const next = [created, ...prev.filter((s) => s.id !== created.id)];
        return statusFilter === "all" || statusFilter === created.status
          ? next
          : prev;
      });
      setSelectedSessionId(created.id);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setCreating(false);
      }
    }
  };

  const handleStartRename = (session: ChatSession) => {
    setRenamingId(session.id);
    setDraftTitle(resolveSessionTitle(session, t));
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setDraftTitle("");
  };

  const handleSaveRename = async (e: FormEvent, sessionId: string) => {
    e.preventDefault();
    const trimmed = draftTitle.trim();
    if (!trimmed) return;
    setBusySessionId(sessionId);
    setErrorMsg(null);
    try {
      const updated = await sessionsApi.rename(sessionId, trimmed);
      if (!mountedRef.current) return;
      setSessions((prev) =>
        prev.map((item) => (item.id === sessionId ? updated : item))
      );
      setRenamingId(null);
      setDraftTitle("");
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setBusySessionId(null);
      }
    }
  };

  const handleToggleStatus = async (session: ChatSession) => {
    const nextStatus = session.status === "archived" ? "active" : "archived";
    setBusySessionId(session.id);
    setErrorMsg(null);
    try {
      const updated = await sessionsApi.setStatus(session.id, nextStatus);
      if (!mountedRef.current) return;
      setSessions((prev) => {
        if (statusFilter !== "all" && updated.status !== statusFilter) {
          return prev.filter((item) => item.id !== session.id);
        }
        return prev.map((item) => (item.id === session.id ? updated : item));
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setBusySessionId(null);
      }
    }
  };

  const handleDeleteSession = async (session: ChatSession) => {
    if (session.id === "default") return;
    setBusySessionId(session.id);
    setErrorMsg(null);
    try {
      await sessionsApi.delete(session.id);
      if (!mountedRef.current) return;
      setSessions((prev) => {
        const remaining = prev.filter((item) => item.id !== session.id);
        if (selectedSessionId === session.id) {
          const fallback =
            remaining.find((item) => item.id === activeSessionId)?.id ??
            remaining[0]?.id ??
            "default";
          setSelectedSessionId(fallback);
        }
        return remaining;
      });
      if (renamingId === session.id) {
        setRenamingId(null);
        setDraftTitle("");
      }
      if (session.id === activeSessionId) {
        onActiveSessionDeleted?.();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setBusySessionId(null);
      }
    }
  };

  const handleSessionUpdatedFromContext = (updated: ChatSession) => {
    setSessions((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const handleClearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const hasFilters = Boolean(
    query.trim() || statusFilter !== "all" || dateFrom || dateTo
  );

  const renderSessionCard = (session: ChatSession, compact = false) => {
    const title = resolveSessionTitle(session, t);
    const statusBadge = getSessionStatusBadge(session.status, t);
    const contextBadge = getContextBadge(session.contextState, t);
    const isActiveSession = session.id === activeSessionId;
    const isSelected = session.id === effectiveSelectedId;
    const isBusy = busySessionId === session.id;
    const isRenaming = renamingId === session.id;

    return (
      <article
        key={session.id}
        data-testid={`session-card-${session.id}`}
        className={`rounded-aura-lg border bg-aura-surface/75 p-4 transition-colors space-y-3 ${
          isSelected
            ? "border-aura-accent/70 ring-1 ring-aura-accent/30"
            : isActiveSession
              ? "border-aura-accent/40"
              : "border-aura-border/40 hover:border-aura-border-strong/60"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            {isRenaming ? (
              <form
                onSubmit={(e) => void handleSaveRename(e, session.id)}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      handleCancelRename();
                    }
                  }}
                  aria-label={t("sessions.rename")}
                  data-testid={`session-rename-input-${session.id}`}
                  containerClassName="flex-1 min-w-[180px]"
                  autoFocus
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!draftTitle.trim() || isBusy}
                  loading={isBusy}
                  data-testid={`session-rename-save-${session.id}`}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("sessions.saveRename")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={handleCancelRename}
                  data-testid={`session-rename-cancel-${session.id}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("sessions.cancel")}
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSessionId(session.id)}
                  data-testid={`session-select-${session.id}`}
                  className="text-left text-sm font-semibold text-aura-primary hover:text-aura-accent transition-colors truncate max-w-full focus-visible:outline-none focus-visible:underline"
                >
                  {title}
                </button>
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                {(session.contextState === "approaching_limit" ||
                  (session.contextState === "compressed" &&
                    session.status !== "compressed")) && (
                  <Badge variant={contextBadge.variant}>
                    {contextBadge.label}
                  </Badge>
                )}
                {isActiveSession && (
                  <Badge variant="default">
                    {t("hermes.sessionBadge", { title })}
                  </Badge>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-aura-text-muted tabular-nums">
                <span>
                  {t("sessions.messagesCount", { count: session.messageCount })}
                </span>
                <span>
                  {t("sessions.compressionsCount", {
                    count: session.compressionCount,
                  })}
                </span>
                <span>
                  {t("sessions.tokensUsage", {
                    used: session.estimatedTokens,
                    budget: session.tokenBudget,
                  })}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {formatDateTime(session.lastActivityAt)}
                </span>
              </div>
              {(() => {
                const budget = Math.max(1, session.tokenBudget);
                const pct = Math.min(100, Math.round((session.estimatedTokens / budget) * 100));
                const barTone =
                  pct >= 90
                    ? "bg-rose-400"
                    : pct >= 75
                      ? "bg-amber-400"
                      : "bg-aura-accent";
                return (
                  <div
                    className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-aura-muted/40"
                    aria-hidden="true"
                  >
                    <div
                      className={`h-full transition-[width] duration-300 ${barTone}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {!compact && (session.lastMessagePreview || session.semanticSummary) && (
          <p className="text-xs text-aura-secondary line-clamp-2 break-words rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 px-3 py-2">
            {session.lastMessagePreview || session.semanticSummary}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            variant={isActiveSession ? "primary" : "secondary"}
            onClick={() => onContinueSession(session.id)}
            data-testid={`session-continue-${session.id}`}
          >
            <span>{t("sessions.continueConversation")}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>

          {!isRenaming && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={() => handleStartRename(session)}
              data-testid={`session-rename-${session.id}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {t("sessions.rename")}
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isBusy}
            onClick={() => void handleToggleStatus(session)}
            data-testid={`session-status-${session.id}`}
          >
            {session.status === "archived" ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                {t("sessions.reactivate")}
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                {t("sessions.archive")}
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={session.id === "default" || isBusy}
            onClick={() => void handleDeleteSession(session)}
            data-testid={`session-delete-${session.id}`}
            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("sessions.delete")}
          </Button>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-5" data-testid="sessions-center-page">
      <PageHeader
        icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
        title={t("sessions.title")}
        subtitle={t("sessions.subtitle")}
        actions={
          <Button
            type="button"
            size="md"
            variant="primary"
            loading={creating}
            disabled={creating}
            onClick={() => void handleCreateSession()}
            data-testid="sessions-new-btn"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("sessions.newSession")}
          </Button>
        }
      />

      {/* Sub-Tabs */}
      <div
        role="tablist"
        aria-label={t("sessions.title")}
        className="flex flex-wrap items-center gap-2 rounded-2xl aura-glass p-2"
      >
        <Button
          type="button"
          role="tab"
          aria-selected={subTab === "conversations"}
          size="sm"
          variant={subTab === "conversations" ? "primary" : "secondary"}
          onClick={() => setSubTab("conversations")}
          data-testid="sessions-tab-conversations"
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {t("sessions.tabs.conversations")}
        </Button>

        <Button
          type="button"
          role="tab"
          aria-selected={subTab === "management"}
          size="sm"
          variant={subTab === "management" ? "primary" : "secondary"}
          onClick={() => setSubTab("management")}
          data-testid="sessions-tab-management"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {t("sessions.tabs.management")}
        </Button>

        <Button
          type="button"
          role="tab"
          aria-selected={subTab === "contextEngine"}
          size="sm"
          variant={subTab === "contextEngine" ? "primary" : "secondary"}
          onClick={() => setSubTab("contextEngine")}
          data-testid="sessions-tab-context"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          {t("sessions.tabs.contextEngine")}
        </Button>
      </div>

      {/* Global Search & Filters (Conversations & Management views) */}
      {subTab !== "contextEngine" && (
        <section className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-3.5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-5 relative">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aura-text-muted"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("sessions.searchPlaceholder")}
                  aria-label={t("sessions.searchPlaceholder")}
                  data-testid="sessions-search-input"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t("sessions.statusFilterAll")}
                data-testid="sessions-status-select"
              >
                <option value="all">{t("sessions.statusFilterAll")}</option>
                <option value="active">{t("sessions.statusActive")}</option>
                <option value="archived">{t("sessions.statusArchived")}</option>
                <option value="compressed">
                  {t("sessions.statusCompressed")}
                </option>
              </Select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-aura-text-muted">
                {t("sessions.dateFrom")}
              </span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label={t("sessions.metaCreated")}
                data-testid="sessions-date-from"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-aura-text-muted">
                {t("sessions.dateTo")}
              </span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label={t("reports.dateLabel")}
                  data-testid="sessions-date-to"
                  containerClassName="flex-1"
                />
                {hasFilters && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleClearFilters}
                    aria-label={t("kanban.clearFilters")}
                    title={t("kanban.clearFilters")}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3.5 py-2.5 text-xs text-aura-danger"
        >
          {errorMsg}
        </div>
      )}

      {/* Sub-Tab 1: Conversations */}
      {subTab === "conversations" && (
        <section
          role="tabpanel"
          aria-label={t("sessions.tabs.conversations")}
          className="space-y-3"
        >
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-5 w-5" />}
              title={t("sessions.empty")}
              action={
                hasFilters ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleClearFilters}
                  >
                    {t("kanban.clearFilters")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3" data-testid="sessions-conversations-list">
              {sessions.map((session) => renderSessionCard(session, false))}
            </div>
          )}
        </section>
      )}

      {/* Sub-Tab 2: Session Management */}
      {subTab === "management" && (
        <section
          role="tabpanel"
          aria-label={t("sessions.tabs.management")}
          className="grid grid-cols-1 lg:grid-cols-12 gap-5"
        >
          {/* Left: Session Selector & Actions */}
          <div className="lg:col-span-5 space-y-3">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={<MessageSquare className="h-5 w-5" />}
                title={t("sessions.empty")}
              />
            ) : (
              <div className="space-y-2.5" data-testid="sessions-management-list">
                {sessions.map((session) => renderSessionCard(session, true))}
              </div>
            )}
          </div>

          {/* Right: Selected Session Metadata & Raw Preserved History */}
          <div className="lg:col-span-7">
            {!selectedSession ? (
              <EmptyState
                icon={<SlidersHorizontal className="h-5 w-5" />}
                title={t("sessions.empty")}
              />
            ) : (
              <div
                data-testid="session-metadata-panel"
                className="rounded-aura-lg border border-aura-border/40 bg-aura-surface/75 p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-aura-border/40 pb-3">
                  <div className="space-y-0.5 min-w-0">
                    <h3 className="text-sm font-semibold text-aura-primary">
                      {t("sessions.metaTitle")}
                    </h3>
                    <p className="text-xs text-aura-text-muted truncate">
                      {resolveSessionTitle(selectedSession, t)}
                    </p>
                  </div>

                  <Badge
                    variant={
                      getContextBadge(selectedSession.contextState, t).variant
                    }
                  >
                    {getContextBadge(selectedSession.contextState, t).label}
                  </Badge>
                </div>

                {/* Metadata Grid */}
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 p-2.5 space-y-1">
                    <dt className="text-aura-text-muted font-medium">
                      {t("sessions.metaId")}
                    </dt>
                    <dd
                      className="font-mono text-aura-primary break-all"
                      data-testid="meta-session-id"
                    >
                      {selectedSession.id}
                    </dd>
                  </div>

                  <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 p-2.5 space-y-1">
                    <dt className="text-aura-text-muted font-medium flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("sessions.metaProvider")}
                    </dt>
                    <dd
                      className="text-aura-primary break-words"
                      data-testid="meta-session-provider"
                    >
                      {[selectedSession.provider, selectedSession.model]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </dd>
                  </div>

                  <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 p-2.5 space-y-1">
                    <dt className="text-aura-text-muted font-medium flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("sessions.metaCreated")}
                    </dt>
                    <dd
                      className="text-aura-primary tabular-nums"
                      data-testid="meta-session-created"
                    >
                      {formatDateTime(selectedSession.createdAt)}
                    </dd>
                  </div>

                  <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 p-2.5 space-y-1">
                    <dt className="text-aura-text-muted font-medium flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("sessions.metaLastActivity")}
                    </dt>
                    <dd
                      className="text-aura-primary tabular-nums"
                      data-testid="meta-session-last-activity"
                    >
                      {formatDateTime(selectedSession.lastActivityAt)}
                    </dd>
                  </div>
                </dl>

                {/* Associated Memories & Tools Used */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-aura-text-muted font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("sessions.metaMemories")}
                      </span>
                      <span className="tabular-nums">
                        {selectedSession.associatedMemories.length}
                      </span>
                    </div>
                    {selectedSession.associatedMemories.length === 0 ? (
                      <p className="text-aura-text-muted">—</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {selectedSession.associatedMemories.map((mem) => (
                          <Badge key={mem} variant="info">
                            {mem}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/40 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-aura-text-muted font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("sessions.metaTools")}
                      </span>
                      <span className="tabular-nums">
                        {selectedSession.toolsUsed.length}
                      </span>
                    </div>
                    {selectedSession.toolsUsed.length === 0 ? (
                      <p className="text-aura-text-muted">—</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {selectedSession.toolsUsed.map((tool) => (
                          <Badge key={tool} variant="neutral">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Persistent Semantic Summary */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-aura-secondary">
                    {t("sessions.metaSummary")}
                  </h4>
                  <div
                    data-testid="meta-session-summary"
                    className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/45 p-3 text-xs text-aura-primary leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto aura-scrollbar"
                  >
                    {selectedSession.semanticSummary.trim() || "—"}
                  </div>
                </div>

                {/* Preserved Raw History */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-aura-secondary">
                      {t("sessions.metaTranscript")}
                    </h4>
                    <Badge variant="neutral" className="tabular-nums">
                      {t("sessions.messagesCount", { count: history.length })}
                    </Badge>
                  </div>

                  {historyError && (
                    <div
                      role="alert"
                      className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 text-xs text-aura-danger"
                    >
                      {historyError}
                    </div>
                  )}

                  {historyLoading ? (
                    <Skeleton lines={3} />
                  ) : history.length === 0 ? (
                    <EmptyState
                      icon={<MessageSquare className="h-4 w-4" />}
                      title={t("hindsightPanel.emptyList")}
                    />
                  ) : (
                    <div
                      data-testid="meta-session-transcript"
                      className="space-y-2 max-h-72 overflow-y-auto pr-1 aura-scrollbar"
                    >
                      {history.map((msg) => (
                        <div
                          key={msg.id}
                          className="rounded-aura-md border border-aura-border/30 bg-aura-canvas/45 p-2.5 space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <Badge
                              variant={
                                msg.role === "user"
                                  ? "default"
                                  : msg.role === "assistant"
                                    ? "info"
                                    : "neutral"
                              }
                            >
                              {msg.role === "user"
                                ? t("hermes.userRole")
                                : msg.role === "assistant"
                                  ? t("hermes.assistantRole")
                                  : msg.role}
                            </Badge>
                            <span className="text-aura-text-muted tabular-nums">
                              {formatDateTime(msg.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-aura-primary whitespace-pre-wrap break-words leading-relaxed">
                            {msg.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Sub-Tab 3: Context Engine */}
      {subTab === "contextEngine" && (
        <section
          role="tabpanel"
          aria-label={t("sessions.tabs.contextEngine")}
          className="space-y-4"
        >
          {sessions.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 px-4 py-3">
              <span className="text-xs font-medium text-aura-secondary">
                {t("sessions.metaTitle")}
              </span>
              <div className="w-full sm:w-72">
                <Select
                  aria-label={t("sessions.metaTitle")}
                  value={selectedSessionId || activeSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  data-testid="context-session-select"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {resolveSessionTitle(s, t)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <ContextEngineView
            sessionId={selectedSessionId || activeSessionId}
            onSessionUpdated={handleSessionUpdatedFromContext}
          />
        </section>
      )}
    </div>
  );
}
