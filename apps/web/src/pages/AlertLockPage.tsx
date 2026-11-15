import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ShieldAlert } from "lucide-react";

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
    } catch {
      // ignore transient startup IPC delays
    }
  }, [i18n, popupWindow]);

  useEffect(() => {
    void loadState();

    // Prevent escaping the external popup / lock overlay via context menu or refresh keys.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
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
    await alertsApi.resolve(id);
    await loadState();
  };

  const handleSnooze = async (id: string) => {
    await alertsApi.snooze(id);
    await loadState();
  };

  const handleDismiss = async (id: string) => {
    await alertsApi.dismiss(id);
    await loadState();
  };

  if (isBackdrop) {
    return (
      <div
        data-testid="alert-lock-backdrop"
        className="flex min-h-screen w-screen flex-col items-center justify-center gap-3 aura-bg p-6 text-center select-none overflow-hidden"
      >
        <div className="rounded-2xl aura-glass bg-rose-500/15 p-4 ring-1 ring-rose-500/40 shadow-lg shadow-rose-500/10">
          <ShieldAlert className="h-8 w-8 text-rose-400" />
        </div>
        <h1 className="text-lg font-bold text-rose-100">{t("reminders.lockBackdropTitle")}</h1>
        <p className="max-w-md text-xs text-rose-200/80">
          {t("reminders.lockBackdropSubtitle")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen aura-bg select-none overflow-hidden">
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
          </div>
        </div>
      )}
    </div>
  );
}
