import { useTranslation } from "react-i18next";
import { Download, FolderOpen, RefreshCw, Terminal } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import type { UpdateStateSnapshot } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export interface UpdatesAndLogsSectionProps {
  updateState: UpdateStateSnapshot | null;
  appVersion: string;
  autoUpdateEnabled: boolean;
  checkingUpdate: boolean;
  logsTail: string[] | null;
  logsOpenedPath: string | null;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onOpenLogsDir: () => void;
  onRefreshDiagnostics: () => void;
  className?: string;
}

export function formatUpdateStatusMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  state: UpdateStateSnapshot | null
): string {
  if (!state || state.status === "idle" || state.status === "up_to_date") {
    return t("settings.updates.upToDate", {
      version: state?.currentVersion ?? "0.2.2",
    });
  }
  const version = state.latestVersion ?? state.currentVersion;
  switch (state.status) {
    case "checking":
      return t("settings.updates.checking");
    case "available":
      return t("settings.updates.available", { version });
    case "downloading":
      return t("settings.updates.downloading", {
        version,
        pct: state.progressPct,
      });
    case "verifying":
      return t("settings.updates.verifying", { version });
    case "installing":
      return t("settings.updates.installing", { version });
    case "error":
      return t("settings.updates.error", {
        message: state.errorMessage ?? "",
      });
  }
}

export function UpdatesAndLogsSection({
  updateState,
  appVersion,
  autoUpdateEnabled,
  checkingUpdate,
  logsTail,
  logsOpenedPath,
  onCheckUpdates,
  onInstallUpdate,
  onOpenLogsDir,
  onRefreshDiagnostics,
  className,
}: UpdatesAndLogsSectionProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("settings.updates.title")}
      className={cn("lg:col-span-2 rounded-2xl aura-glass p-5 space-y-4", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">
          <span className="rounded-lg bg-indigo-500/15 p-1.5">
            <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
          </span>
          {t("settings.updates.title")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" className="rounded-full px-2.5 py-0.5 font-mono text-[11px]">
            {t("settings.updates.currentVersion")}: v
            {updateState?.currentVersion ?? appVersion}
          </Badge>
          <Badge
            variant={autoUpdateEnabled ? "success" : "warning"}
            className="rounded-full px-2.5 py-0.5 text-[11px]"
          >
            {autoUpdateEnabled
              ? t("settings.updates.autoUpdateEnabled")
              : t("settings.updates.autoUpdateDisabled")}
          </Badge>
        </div>
      </div>

      <p className="text-xs text-slate-400">{t("settings.updates.description")}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/70 bg-slate-950/50 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-medium text-slate-200">
            {formatUpdateStatusMessage(t, updateState)}
          </p>
          {updateState?.status === "downloading" && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${Math.max(4, updateState.progressPct)}%` }}
              />
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            {updateState?.lastCheckedAt
              ? t("settings.updates.lastChecked", {
                  time: new Date(updateState.lastCheckedAt).toLocaleString(),
                })
              : t("settings.updates.neverChecked")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={checkingUpdate}
            onClick={onCheckUpdates}
            className="rounded-xl text-xs font-semibold"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${checkingUpdate ? "animate-spin" : ""}`}
            />
            {checkingUpdate
              ? t("settings.updates.checking")
              : t("settings.updates.checkButton")}
          </Button>

          {(updateState?.status === "available" ||
            (updateState?.status === "error" && Boolean(updateState.latestVersion))) && (
            <Button
              size="sm"
              variant="primary"
              disabled={checkingUpdate}
              onClick={onInstallUpdate}
              className="rounded-xl text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              {updateState.status === "error"
                ? t("settings.updates.retryButton")
                : t("settings.updates.installButton")}
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenLogsDir}
            className="rounded-xl text-xs font-semibold"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("settings.updates.openLogs")}
          </Button>
        </div>
      </div>

      {logsOpenedPath && (
        <p className="text-[11px] text-emerald-400">
          {t("settings.updates.openedLogs", { path: logsOpenedPath })}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Terminal className="h-3.5 w-3.5 text-slate-400" />
            {t("settings.updates.logsTitle")}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={onRefreshDiagnostics}
            className="rounded-lg px-2.5 py-1 text-[11px]"
          >
            {t("settings.updates.refreshLogs")}
          </Button>
        </div>
        <pre className="max-h-40 overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/70 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {logsTail && logsTail.length > 0
            ? logsTail.join("\n")
            : t("settings.updates.logsEmpty")}
        </pre>
      </div>
    </section>
  );
}
