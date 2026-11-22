import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bell, ShieldAlert, Unlock } from "lucide-react";

import { ReminderModal } from "../components/ReminderModal";
import { alertsApi, isTauriRuntime, settingsApi, type Alert } from "../lib/ipc";
import { applyTheme } from "../lib/theme";
import { asArray } from "../lib/utils";

export interface AlertLockPageProps {
  /**
   * When true, renders the compact Tecnobyte-style external floating dialog
   * (`/alert-popup`) filling its OS window and honoring `reminders.block_screen`.
   */
  popupWindow?: boolean;
  /**
   * When true, forces the fullscreen multi-monitor backdrop view even without
   * `?backdrop=1` in the URL (used by standalone `alert-lock-*` OS windows).
   */
  forceBackdrop?: boolean;
}

export function AlertLockPage({ popupWindow = false, forceBackdrop = false }: AlertLockPageProps) {
  const { i18n, t } = useTranslation();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [blockScreen, setBlockScreen] = useState<boolean>(!popupWindow);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const consecutiveErrorsRef = useRef(0);

  const winMeta =
    typeof window !== "undefined"
      ? (window as unknown as {
          __AURADESK_WINDOW_MODE__?: string;
          __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
        })
      : null;
  const tauriLabel = winMeta?.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  const isBackdrop =
    !popupWindow &&
    (forceBackdrop ||
      winMeta?.__AURADESK_WINDOW_MODE__ === "alert-lock-backdrop" ||
      (typeof tauriLabel === "string" && tauriLabel.startsWith("alert-lock-")) ||
      (typeof window !== "undefined" && window.location.search.includes("backdrop=1")));

  const loadState = useCallback(async () => {
    try {
      const [pending, sound, blockSetting, locale, theme] = await Promise.all([
        alertsApi.listPending(),
        settingsApi.get("reminders.sound"),
        settingsApi.get("reminders.block_screen"),
        settingsApi.get("app.locale"),
        settingsApi.get("app.theme"),
      ]);
      setAlerts(asArray<Alert>(pending));
      if (typeof sound === "boolean") setSoundEnabled(sound);
      if (popupWindow) {
        setBlockScreen(blockSetting === true);
      }
      if (typeof locale === "string" && locale !== i18n.language) {
        await i18n.changeLanguage(locale);
      }
      if (theme === "light" || theme === "dark" || theme === "system") {
        applyTheme(theme);
      }
      consecutiveErrorsRef.current = 0;
      setActionError(null);
    } catch {
      consecutiveErrorsRef.current += 1;
      if (consecutiveErrorsRef.current >= 2) {
        setActionError(t("alertLock.ipcErrorBanner"));
      }
    }
  }, [i18n, popupWindow, t]);

  const forceCloseCurrentWindow = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const current = getCurrentWindow();
      try {
        await current.close();
      } catch {
        await current.destroy();
      }
    } catch {
      // ignore unavailable window runtime (browser or test environment)
    }
  }, []);

  const handleEmergencyUnlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    try {
      await alertsApi.emergencyUnlock();
      setActionError(null);
    } catch {
      setActionError(t("alertLock.ipcErrorBanner"));
    } finally {
      await forceCloseCurrentWindow();
      setUnlocking(false);
    }
  }, [forceCloseCurrentWindow, t, unlocking]);

  const emergencyUnlockRef = useRef(handleEmergencyUnlock);
  emergencyUnlockRef.current = handleEmergencyUnlock;

  useEffect(() => {
    void loadState();

    // Prevent escaping the external popup / lock overlay via context menu or refresh keys,
    // while keeping Ctrl+Shift+U always active as an emergency unlock failsafe.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        void emergencyUnlockRef.current();
        return;
      }
      if (e.key === "F5" || e.key === "F11" || e.key === "F12") {
        e.preventDefault();
      }
    };
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);

    let unlisten: (() => void) | undefined;
    if (isTauriRuntime()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<Alert[]>("auradesk://alerts-updated", (event) => {
            if (Array.isArray(event.payload)) {
              setAlerts(event.payload);
            } else {
              void loadState();
            }
          })
        )
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }

    const timer = window.setInterval(() => void loadState(), 1000);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.clearInterval(timer);
      if (unlisten) unlisten();
    };
  }, [loadState]);

  const activeAlert =
    alerts.find((a) => a.kind === "routine" || a.kind === "reminder") ?? alerts[0] ?? null;

  const handleResolve = async (id: string) => {
    try {
      setActionError(null);
      await alertsApi.resolve(id);
      await loadState();
    } catch {
      setActionError(t("alertLock.ipcErrorBanner"));
    }
  };

  const handleSnooze = async (id: string) => {
    try {
      setActionError(null);
      await alertsApi.snooze(id);
      await loadState();
    } catch {
      setActionError(t("alertLock.ipcErrorBanner"));
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      setActionError(null);
      await alertsApi.dismiss(id);
      await loadState();
    } catch {
      setActionError(t("alertLock.ipcErrorBanner"));
    }
  };

  if (isBackdrop) {
    return (
      <div
        data-testid="alert-lock-backdrop"
        className="flex min-h-screen w-screen flex-col items-center justify-center gap-3 aura-bg p-6 text-center select-none overflow-hidden"
      >
        <div className="flex flex-col items-center gap-3 rounded-2xl aura-glass-elevated px-6 py-5 text-center shadow-2xl">
          <div className="rounded-2xl aura-glass bg-rose-500/15 p-4 ring-1 ring-rose-500/40 shadow-lg shadow-rose-500/10">
            <ShieldAlert className="h-8 w-8 text-rose-400" />
          </div>
          <h1 className="text-lg font-bold text-rose-100">{t("reminders.lockBackdropTitle")}</h1>
          <p className="max-w-md text-xs text-rose-200/80">
            {t("reminders.lockBackdropSubtitle")}
          </p>
          {actionError && (
            <div
              role="alert"
              data-testid="alert-lock-ipc-error"
              className="mt-2 flex max-w-md items-center gap-2 rounded-xl bg-rose-950/70 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/40"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
              <span>{actionError}</span>
            </div>
          )}
          <div className="mt-2 flex flex-col items-center gap-1.5">
            <button
              type="button"
              data-testid="emergency-unlock-btn"
              disabled={unlocking}
              onClick={() => void handleEmergencyUnlock()}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 ring-1 ring-rose-400/40 hover:bg-rose-500/30 disabled:opacity-50 cursor-pointer"
            >
              <Unlock className="h-3.5 w-3.5" />
              {t("alertLock.emergencyUnlock")}
            </button>
            <span className="text-[11px] text-rose-200/60">
              {t("alertLock.emergencyUnlockHint")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen aura-bg select-none overflow-hidden">
      {actionError && (
        <div
          role="alert"
          data-testid="alert-lock-ipc-error"
          className="fixed top-3 left-1/2 z-50 flex w-[92%] max-w-lg -translate-x-1/2 items-center justify-between gap-3 rounded-xl bg-rose-950/90 px-4 py-2.5 text-xs text-rose-100 ring-1 ring-rose-500/50 shadow-lg backdrop-blur"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            data-testid="emergency-unlock-btn"
            disabled={unlocking}
            onClick={() => void handleEmergencyUnlock()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-aura-danger px-3 py-1.5 text-[11px] font-semibold text-aura-inverse hover:bg-aura-danger/90 disabled:opacity-50 cursor-pointer"
          >
            <Unlock className="h-3 w-3" />
            {t("alertLock.emergencyUnlock")}
          </button>
        </div>
      )}
      {activeAlert ? (
        <ReminderModal
          alert={activeAlert}
          locked={popupWindow ? blockScreen : true}
          playSound={soundEnabled}
          inline={popupWindow}
          pendingCount={alerts.length}
          onResolve={handleResolve}
          onSnooze={handleSnooze}
          onDismiss={handleDismiss}
        />
      ) : (
        <div className="flex min-h-screen w-full items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 rounded-2xl aura-glass-elevated px-6 py-5 text-center ring-1 ring-slate-700/60 shadow-xl">
            <div className="rounded-xl bg-sky-500/15 p-2.5 ring-1 ring-sky-500/30">
              <Bell className="h-5 w-5 text-sky-400 animate-pulse" />
            </div>
            <p className="text-xs font-medium text-slate-300">{t("reminders.syncingAlert")}</p>
            <button
              type="button"
              data-testid={actionError ? undefined : "emergency-unlock-btn"}
              disabled={unlocking}
              onClick={() => void handleEmergencyUnlock()}
              className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 ring-1 ring-rose-400/35 hover:bg-rose-500/25 disabled:opacity-50 cursor-pointer"
            >
              <Unlock className="h-3.5 w-3.5" />
              {t("alertLock.emergencyUnlock")}
            </button>
            <p className="max-w-xs text-[11px] text-slate-400">
              {t("alertLock.emergencyUnlockHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
