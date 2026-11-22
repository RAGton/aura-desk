import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, History, Pencil, ShieldCheck, X } from "lucide-react";

import { Badge, Button, EmptyState, Input, Select } from "../../components/ui";
import {
  isTauriRuntime,
  proposalsApi,
  type IaCommandEntry,
  type ProposalItem,
  type TaskPriority,
} from "../../lib/ipc";

export interface AuraMonitoringPanelProps {
  onProposalApplied?: () => void;
}

type ProposalViewFilter = "pending" | "recent";

function proposalStatusVariant(status: string) {
  switch (status) {
    case "approved":
      return "success" as const;
    case "rejected":
    case "expired":
      return "danger" as const;
    case "pending":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function normalizePriority(value: unknown): TaskPriority {
  const raw = String(value ?? "normal");
  if (raw === "low" || raw === "normal" || raw === "high" || raw === "urgent") {
    return raw;
  }
  return "normal";
}

export function AuraMonitoringPanel({ onProposalApplied }: AuraMonitoringPanelProps) {
  const { t } = useTranslation();
  const mountedRef = useRef(true);

  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [commands, setCommands] = useState<IaCommandEntry[]>([]);
  const [filter, setFilter] = useState<ProposalViewFilter>("pending");
  const [decisionNote, setDecisionNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit & Approve inline editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>("normal");

  const loadData = useCallback(async () => {
    try {
      const [recentProps, auditEntries] = await Promise.all([
        proposalsApi.listRecent(50).catch(() => [] as ProposalItem[]),
        proposalsApi.listCommands(50).catch(() => [] as IaCommandEntry[]),
      ]);
      if (!mountedRef.current) return;
      setProposals(Array.isArray(recentProps) ? [...recentProps] : []);
      setCommands(Array.isArray(auditEntries) ? [...auditEntries] : []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(String(err));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadData();

    if (!isTauriRuntime()) {
      return () => {
        mountedRef.current = false;
      };
    }

    let active = true;
    const unlisteners: Array<() => void> = [];
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const unlistenProposals = await listen("auradesk://proposals-updated", () => {
          if (mountedRef.current) void loadData();
        });
        if (active) {
          unlisteners.push(unlistenProposals);
        } else {
          unlistenProposals();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      mountedRef.current = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [loadData]);

  const pendingProposals = proposals.filter((p) => p.status === "pending");
  const visibleProposals = filter === "pending" ? pendingProposals : proposals;

  const handleStartEdit = (prop: ProposalItem) => {
    setEditingId(prop.id);
    setEditTitle(String(prop.payload?.title ?? prop.summary ?? ""));
    setEditPriority(normalizePriority(prop.payload?.priority));
  };

  const handleApprove = async (
    id: string,
    modifications?: Record<string, unknown> | null
  ) => {
    setErrorMsg(null);
    try {
      await proposalsApi.approve(id, decisionNote.trim() || null, modifications ?? null);
      if (!mountedRef.current) return;
      setEditingId(null);
      setDecisionNote("");
      setFeedback(t("hermes.proposals.approvedSuccess"));
      onProposalApplied?.();
      await loadData();
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReject = async (id: string) => {
    setErrorMsg(null);
    try {
      await proposalsApi.reject(id, decisionNote.trim() || null);
      if (!mountedRef.current) return;
      if (editingId === id) setEditingId(null);
      setDecisionNote("");
      setFeedback(t("hermes.proposals.rejectedSuccess"));
      onProposalApplied?.();
      await loadData();
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section
      aria-label={t("hermes.monitoringTitle")}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-aura-primary flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-aura-warning" aria-hidden="true" />
          {t("hermes.monitoringTitle")}
        </h2>
      </div>

      {feedback && (
        <div
          role="status"
          className="rounded-aura-md border border-aura-success/40 bg-aura-success/10 px-3 py-2 text-xs text-aura-success"
        >
          {feedback}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-aura-md border border-aura-danger/40 bg-aura-danger/10 px-3 py-2 text-xs text-aura-danger"
        >
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Proposal Approval Queue */}
        <section className="lg:col-span-6 glass-panel rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-aura-primary flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-aura-warning" aria-hidden="true" />
              {t("hermes.proposals.title")}
            </h3>

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={filter === "pending" ? "primary" : "ghost"}
                onClick={() => setFilter("pending")}
              >
                {t("hermes.proposals.filterPending", { count: pendingProposals.length })}
              </Button>
              <Button
                size="sm"
                variant={filter === "recent" ? "primary" : "ghost"}
                onClick={() => setFilter("recent")}
              >
                {t("hermes.proposals.filterRecent", { count: proposals.length })}
              </Button>
            </div>
          </div>

          <Input
            label={t("hermes.proposals.noteLabel")}
            placeholder={t("hermes.proposals.notePlaceholder")}
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
          />

          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
            {visibleProposals.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6 text-aura-text-muted" />}
                title={t("hermes.proposals.empty")}
              />
            ) : (
              visibleProposals.map((prop) => {
                const isEditing = editingId === prop.id;
                return (
                  <div
                    key={prop.id}
                    className="rounded-aura-md border border-aura-border/40 bg-aura-canvas/50 p-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant={proposalStatusVariant(prop.status)}>
                          {prop.status}
                        </Badge>
                        <Badge variant="neutral">{prop.kind}</Badge>
                      </div>
                      <span className="text-[11px] text-aura-text-muted">
                        {prop.source}
                      </span>
                    </div>

                    <p className="text-sm font-medium text-aura-primary break-words">
                      {prop.summary}
                    </p>

                    {prop.decision_note && (
                      <p className="text-xs text-aura-secondary italic">
                        {prop.decision_note}
                      </p>
                    )}

                    {isEditing ? (
                      <div className="space-y-2 pt-2 border-t border-aura-border/30">
                        <Input
                          label={t("hermes.proposals.titleLabel")}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                        {prop.kind === "create_task" && (
                          <Select
                            label={t("hermes.proposals.priorityLabel")}
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                          >
                            <option value="low">{t("kanban.priority.low")}</option>
                            <option value="normal">{t("kanban.priority.normal")}</option>
                            <option value="high">{t("kanban.priority.high")}</option>
                            <option value="urgent">{t("kanban.priority.urgent")}</option>
                          </Select>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              void handleApprove(prop.id, {
                                title: editTitle.trim(),
                                ...(prop.kind === "create_task" ? { priority: editPriority } : {}),
                              })
                            }
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("hermes.proposals.saveApprove")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            {t("hermes.proposals.cancelEdit")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      prop.status === "pending" && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button size="sm" onClick={() => void handleApprove(prop.id)}>
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("hermes.proposals.approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleStartEdit(prop)}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("hermes.proposals.editApprove")}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void handleReject(prop.id)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("hermes.proposals.reject")}
                          </Button>
                        </div>
                      )
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Audit Log (ia_commands) */}
        <section className="lg:col-span-6 glass-panel rounded-aura-lg border border-aura-border/40 bg-aura-surface/70 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-aura-primary flex items-center gap-2">
              <History className="h-4 w-4 text-aura-info" aria-hidden="true" />
              {t("hermes.audit.title")}
            </h3>
            <p className="text-xs text-aura-secondary mt-0.5">
              {t("hermes.audit.subtitle")}
            </p>
          </div>

          {commands.length === 0 ? (
            <p className="text-xs text-aura-text-muted py-4">{t("hermes.audit.empty")}</p>
          ) : (
            <div className="overflow-x-auto max-h-[410px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-aura-border/40 text-aura-text-muted">
                    <th className="py-2 pr-3 font-medium">{t("hermes.audit.columns.time")}</th>
                    <th className="py-2 pr-3 font-medium">{t("hermes.audit.columns.source")}</th>
                    <th className="py-2 pr-3 font-medium">{t("hermes.audit.columns.tool")}</th>
                    <th className="py-2 pr-3 font-medium">{t("hermes.audit.columns.status")}</th>
                    <th className="py-2 font-medium">{t("hermes.audit.columns.args")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-aura-border/20">
                  {commands.slice(0, 20).map((cmd) => (
                    <tr key={cmd.id} className="text-aura-secondary">
                      <td className="py-2 pr-3 whitespace-nowrap font-mono text-[11px]">
                        {cmd.invokedAt.slice(0, 19).replace("T", " ")}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{cmd.source}</td>
                      <td className="py-2 pr-3 whitespace-nowrap font-mono text-aura-primary">
                        {cmd.toolName}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Badge variant={cmd.resultStatus === "ok" ? "success" : "danger"}>
                          {cmd.resultStatus}
                        </Badge>
                      </td>
                      <td className="py-2 font-mono text-[11px] max-w-md truncate">
                        {cmd.argsJson}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
