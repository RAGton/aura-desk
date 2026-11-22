import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BellRing,
  Check,
  Maximize2,
  Pause,
  Play,
  SquareCheckBig,
  Timer,
  X,
} from "lucide-react";

import { AuraDeskLogo } from "../components/AuraDeskLogo";
import { Badge, Button } from "../components/ui";
import {
  alertsApi,
  dashboardApi,
  desktopApi,
  isTauriRuntime,
  pomodoroApi,
  settingsApi,
  tasksApi,
  type Alert,
  type DashboardSummary,
  type PomodoroSession,
} from "../lib/ipc";
import { applyTheme, loadVisualPrefs } from "../lib/theme";
import { asArray } from "../lib/utils";

function formatClock(secs: number): string {
  const safe = Math.max(0, secs);
  const m = String(Math.floor(safe / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Floating ~304x104 always-on-top mini bar (MVP Phase 3 Compact Mode).
 */
export function CompactPage() {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activePomo, setActivePomo] = useState<PomodoroSession | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [focusMin, setFocusMin] = useState(25);
  const [paused, setPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadVisualPrefs();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [sum, pomo, pending, entries] = await Promise.all([
        dashboardApi.summary(),
        pomodoroApi.active(),
        alertsApi.listPending(),
        settingsApi.getAll().catch(() => [] as [string, unknown][]),
      ]);
      if (!mountedRef.current) return;
      setSummary(sum);
      setActivePomo(pomo);
      setAlerts(asArray<Alert>(pending));

      const map: Record<string, unknown> = {};
      for (const [k, v] of asArray<[string, unknown]>(entries)) {
        map[k] = v;
      }
      if ("app.theme" in map) applyTheme(map["app.theme"]);
      if (typeof map["app.locale"] === "string" && map["app.locale"] !== i18n.language) {
        void i18n.changeLanguage(map["app.locale"]);
      }
      const cfgFocus = Math.max(1, Number(map["pomodoro.focus_min"] ?? 25) || 25);
      setFocusMin(cfgFocus);
      if (pomo) {
        const elapsed = Math.floor((Date.now() - Date.parse(pomo.started_at)) / 1000);
        setSecondsLeft(Math.max(0, pomo.planned_min * 60 - elapsed));
      } else {
        setPaused(false);
        setSecondsLeft(cfgFocus * 60);
      }
    } catch {
      // keep existing UI state on transient IPC errors
    }
  }, [i18n]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!activePomo || paused) return;
    const tick = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [activePomo, paused]);

  const nextTask = summary?.nextTask ?? null;
  const clockLabel = useMemo(() => formatClock(secondsLeft), [secondsLeft]);

  const handleStartOrToggle = async () => {
    if (busy) return;
    if (activePomo) {
      setPaused((p) => !p);
      return;
    }
    setBusy(true);
    try {
      await pomodoroApi.start({
        kind: "focus",
        planned_min: focusMin,
        task_id: nextTask?.id ?? null,
      });
      await refresh();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleCompletePomo = async () => {
    if (!activePomo || busy) return;
    setBusy(true);
    try {
      const elapsedMin = Math.max(
        1,
        Math.round((activePomo.planned_min * 60 - secondsLeft) / 60) || activePomo.planned_min
      );
      await pomodoroApi.complete(elapsedMin);
      await refresh();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleCompleteNextTask = async () => {
    if (!nextTask || busy) return;
    setBusy(true);
    try {
      await tasksApi.setStatus({
        id: nextTask.id,
        status: "done",
        kanban_order: nextTask.kanban_order ?? 0,
      });
      await refresh();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleOpenMain = async () => {
    await desktopApi.showMain();
    if (!isTauriRuntime()) {
      window.location.assign("/");
    }
  };

  const handleCloseCompact = async () => {
    await desktopApi.toggleCompact(false);
    if (!isTauriRuntime()) {
      window.location.assign("/");
    }
  };

  return (
    <div
      data-testid="compact-widget"
      className="h-screen w-screen aura-bg aura-glass text-slate-100 p-2.5 flex flex-col justify-between overflow-hidden select-none"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AuraDeskLogo size={20} />
          <span className="font-mono text-sm font-bold tabular-nums text-aura-accent">
            {clockLabel}
          </span>
          {alerts.length > 0 && (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px] gap-1">
              <BellRing className="h-2.5 w-2.5" aria-hidden="true" />
              {t("compact.alertsBadge", { count: alerts.length })}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="secondary"
            aria-label={
              activePomo
                ? paused
                  ? t("pomodoro.resumeTimer")
                  : t("pomodoro.pauseTimer")
                : t("compact.startFocus")
            }
            disabled={busy}
            onClick={() => void handleStartOrToggle()}
            className="h-6 w-6 rounded-lg"
          >
            {activePomo ? (
              paused ? (
                <Play className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Pause className="h-3 w-3" aria-hidden="true" />
              )
            ) : (
              <Timer className="h-3 w-3 text-aura-accent" aria-hidden="true" />
            )}
          </Button>
          {activePomo && (
            <Button
              size="icon"
              variant="primary"
              aria-label={t("pomodoro.complete")}
              disabled={busy}
              onClick={() => void handleCompletePomo()}
              className="h-6 w-6 rounded-lg bg-aura-success text-aura-inverse hover:bg-aura-success/90"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("compact.openMain")}
            title={t("compact.openMain")}
            onClick={() => void handleOpenMain()}
            className="h-6 w-6 rounded-lg"
          >
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("compact.close")}
            title={t("compact.close")}
            onClick={() => void handleCloseCompact()}
            className="h-6 w-6 rounded-lg"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl aura-glass-pill px-2.5 py-1.5 min-w-0">
        <span className="truncate text-xs font-medium text-slate-100">
          {nextTask ? nextTask.title : t("compact.noNextTask")}
        </span>
        {nextTask && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("compact.completeTask")}
            title={t("compact.completeTask")}
            disabled={busy}
            onClick={() => void handleCompleteNextTask()}
            className="h-5 w-5 shrink-0 rounded-md text-emerald-400 hover:bg-emerald-500/20"
          >
            <SquareCheckBig className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
