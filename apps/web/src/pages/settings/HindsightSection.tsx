import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  HelpCircle,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";

import { Badge, Button, Input, Switch } from "@/components/ui";
import {
  hindsightApi,
  type HindsightRecallItem,
  type HindsightStatus,
} from "@/lib/ipc";

export interface HindsightSectionProps {
  values: Record<string, unknown>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
  onSave: (key: string, value: unknown) => void;
}

export function HindsightSection({
  values,
  disabled,
  onChange,
  onSave,
}: HindsightSectionProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HindsightStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recallQuery, setRecallQuery] = useState("");
  const [recallResults, setRecallResults] = useState<HindsightRecallItem[] | null>(null);
  // How many memories a recall returns — persisted as a setting.
  const [recallTopK, setRecallTopK] = useState(8);
  // How many nodes the knowledge graph shows — persisted as a setting.
  const [graphNodeLimit, setGraphNodeLimit] = useState(60);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await hindsightApi?.status?.();
      if (s) setStatus(s);
    } catch {
      // ignore in mocked environments
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // The limits follow the section's own settings flow: the parent holds the
  // values and persists them through onSave.
  useEffect(() => {
    const topK = values["hindsight.recall_top_k"];
    if (typeof topK === "number" && topK > 0) setRecallTopK(topK);
    const nodeLimit = values["hindsight.graph_node_limit"];
    if (typeof nodeLimit === "number" && nodeLimit > 0) {
      setGraphNodeLimit(nodeLimit);
    }
  }, [values]);

  const enabled = values["hindsight.enabled"] !== false;
  const autoCreateBanks = values["hindsight.auto_create_banks"] !== false;
  const dailyMaintenance = values["hindsight.daily_maintenance"] !== false;
  const baseUrl = String(values["hindsight.base_url"] ?? "http://127.0.0.1:8919");
  const defaultBank = String(values["hindsight.default_bank"] ?? "aura-main");
  const isWorking = disabled || busy !== null;

  const handleRunMaintenance = async () => {
    setBusy("maintenance");
    setFeedback(null);
    try {
      const res = await hindsightApi.runMaintenance();
      setFeedback(res.message);
      await refreshStatus();
    } catch (err) {
      setFeedback(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRecall = async () => {
    if (!recallQuery.trim()) return;
    setBusy("recall");
    setFeedback(null);
    try {
      const items = await hindsightApi.recall(
        recallQuery.trim(),
        defaultBank,
        recallTopK
      );
      setRecallResults(items);
    } catch (err) {
      setFeedback(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label={t("settings.hindsight.title")}
      className="lg:col-span-2 rounded-2xl aura-glass p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
          <span className="rounded-lg bg-violet-500/15 p-1.5">
            <Brain className="h-3.5 w-3.5 text-violet-400" />
          </span>
          {t("settings.hindsight.title")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status?.online ? "success" : "info"} className="text-[11px]">
            {status?.online
              ? t("settings.hindsight.statusOnline")
              : t("settings.hindsight.statusFallback")}
          </Badge>
          {status && (
            <Badge variant="default" className="text-[11px]">
              {t("settings.hindsight.banksCount", { count: status.banks.length })}
            </Badge>
          )}
          {status && (
            <Badge variant="neutral" className="text-[11px]">
              {t("settings.hindsight.localCount", { count: status.localCount })}
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="rounded-lg text-[11px]"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t("settings.hindsight.guideTitle")}
          </Button>
        </div>
      </div>

      <p className="text-xs text-aura-text-muted">{t("settings.hindsight.description")}</p>

      {showGuide && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3.5 space-y-1.5 text-xs text-aura-primary">
          <p className="font-semibold text-violet-300">{t("settings.hindsight.guideTitle")}</p>
          <p>{t("settings.hindsight.guideBody")}</p>
        </div>
      )}

      {/* Toggles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-aura-border/40 bg-aura-surface/70 px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-medium text-aura-primary">
              {t("settings.hindsight.enableLabel")}
            </div>
            <div className="text-[11px] text-aura-text-muted">
              {t("settings.hindsight.enableDescription")}
            </div>
          </div>
          <Switch
            disabled={isWorking}
            aria-label={t("settings.hindsight.enableLabel")}
            checked={enabled}
            onCheckedChange={(next) => {
              onChange("hindsight.enabled", next);
              onSave("hindsight.enabled", next);
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-aura-border/40 bg-aura-surface/70 px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-medium text-aura-primary">
              {t("settings.hindsight.autoBanksLabel")}
            </div>
            <div className="text-[11px] text-aura-text-muted">
              {t("settings.hindsight.autoBanksDescription")}
            </div>
          </div>
          <Switch
            disabled={isWorking}
            aria-label={t("settings.hindsight.autoBanksLabel")}
            checked={autoCreateBanks}
            onCheckedChange={(next) => {
              onChange("hindsight.auto_create_banks", next);
              onSave("hindsight.auto_create_banks", next);
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-aura-border/40 bg-aura-surface/70 px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-medium text-aura-primary">
              {t("settings.hindsight.dailyMaintenanceLabel")}
            </div>
            <div className="text-[11px] text-aura-text-muted">
              {t("settings.hindsight.dailyMaintenanceDescription")}
            </div>
          </div>
          <Switch
            disabled={isWorking}
            aria-label={t("settings.hindsight.dailyMaintenanceLabel")}
            checked={dailyMaintenance}
            onCheckedChange={(next) => {
              onChange("hindsight.daily_maintenance", next);
              onSave("hindsight.daily_maintenance", next);
            }}
          />
        </div>
      </div>

      {/* URL & Bank */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-aura-secondary">
              {t("settings.hindsight.baseUrlLabel")}
            </label>
            <Input
              aria-label={t("settings.hindsight.baseUrlLabel")}
              value={baseUrl}
              placeholder="http://127.0.0.1:8919"
              onChange={(e) => onChange("hindsight.base_url", e.target.value)}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            disabled={isWorking}
            onClick={() => onSave("hindsight.base_url", baseUrl)}
          >
            {t("kanban.save")}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-aura-secondary">
              {t("settings.hindsight.defaultBankLabel")}
            </label>
            <Input
              aria-label={t("settings.hindsight.defaultBankLabel")}
              value={defaultBank}
              placeholder="aura-main"
              onChange={(e) => onChange("hindsight.default_bank", e.target.value)}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            disabled={isWorking}
            onClick={() => onSave("hindsight.default_bank", defaultBank)}
          >
            {t("kanban.save")}
          </Button>
        </div>
      </div>

      {/* Maintenance + Status actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={isWorking}
            onClick={() => void handleRunMaintenance()}
            className="rounded-xl text-xs font-semibold"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {busy === "maintenance"
              ? t("settings.hindsight.runningMaintenance")
              : t("settings.hindsight.runMaintenanceButton")}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            disabled={isWorking}
            onClick={() => void refreshStatus()}
            className="rounded-xl text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("settings.raglight.refreshButton")}
          </Button>
        </div>

        <span className="text-[11px] text-aura-text-muted">
          {status?.lastMaintenanceDate
            ? t("settings.hindsight.lastMaintenance", { date: status.lastMaintenanceDate })
            : t("settings.hindsight.neverMaintained")}
        </span>
      </div>

      {/* Retrieval and graph limits */}
      <div className="grid gap-3 pt-3 border-t border-aura-border/35 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="flex items-center justify-between text-[11px] text-aura-text-muted">
            {t("settings.hindsight.recallTopK")}
            <span className="font-semibold text-aura-primary tabular-nums">
              {recallTopK}
            </span>
          </span>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={recallTopK}
            aria-label={t("settings.hindsight.recallTopK")}
            onChange={(e) => {
              const value = Number(e.target.value);
              setRecallTopK(value);
              onChange("hindsight.recall_top_k", value);
            }}
            onMouseUp={() => onSave("hindsight.recall_top_k", recallTopK)}
            onTouchEnd={() => onSave("hindsight.recall_top_k", recallTopK)}
            className="w-full accent-violet-400 cursor-pointer"
          />
        </label>

        <label className="space-y-1">
          <span className="flex items-center justify-between text-[11px] text-aura-text-muted">
            {t("settings.hindsight.graphNodeLimit")}
            <span className="font-semibold text-aura-primary tabular-nums">
              {graphNodeLimit}
            </span>
          </span>
          <input
            type="range"
            min={25}
            max={200}
            step={25}
            value={graphNodeLimit}
            aria-label={t("settings.hindsight.graphNodeLimit")}
            onChange={(e) => {
              const value = Number(e.target.value);
              setGraphNodeLimit(value);
              onChange("hindsight.graph_node_limit", value);
            }}
            onMouseUp={() => onSave("hindsight.graph_node_limit", graphNodeLimit)}
            onTouchEnd={() => onSave("hindsight.graph_node_limit", graphNodeLimit)}
            className="w-full accent-violet-400 cursor-pointer"
          />
        </label>
      </div>

      {/* Recall test */}
      <div className="flex items-center gap-2 pt-2 border-t border-aura-border/35">
        <Input
          containerClassName="flex-1"
          aria-label={t("settings.hindsight.testRecallPlaceholder")}
          placeholder={t("settings.hindsight.testRecallPlaceholder")}
          value={recallQuery}
          onChange={(e) => setRecallQuery(e.target.value)}
        />
        <Button
          size="md"
          variant="secondary"
          disabled={isWorking || !recallQuery.trim()}
          onClick={() => void handleRecall()}
        >
          <Search className="h-3.5 w-3.5" />
          {t("settings.hindsight.testRecallButton")}
        </Button>
      </div>

      {feedback && (
        <p className="text-xs text-violet-400 break-all">{feedback}</p>
      )}

      {recallResults !== null && (
        <div className="rounded-xl border border-aura-border/40 bg-aura-surface/75 p-3 space-y-2 text-xs text-aura-primary">
          {recallResults.length === 0 ? (
            <p className="text-aura-text-muted">{t("settings.hindsight.emptyRecall")}</p>
          ) : (
            recallResults.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2 border-b border-aura-border/30 pb-1.5 last:border-0 last:pb-0">
                <span>{item.content}</span>
                <Badge variant="neutral" className="shrink-0 text-[10px]">
                  {item.bank} ({item.source})
                </Badge>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
