import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

import { ReminderModal } from "../components/ReminderModal";
import { alertsApi, isTauriRuntime, settingsApi, type Alert } from "../lib/ipc";
import { applyTheme } from "../lib/theme";

export interface AlertLockPageProps {
  /**
   * When true, renders the compact Tecnobyte-style external floating dialog
   * (`/alert-popup`) filling its OS window and honoring `reminders.block_screen`.
   */
  popupWindow?: boolean;
}

export function AlertLockPage({ popupWindow = false }: AlertLockPageProps) {
  const { i18n, t } = useTranslation();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [blockScreen, setBlockScreen] = useState<boolean>(!popupWindow);

  const isBackdrop =
    !popupWindow &&
    typeof window !== "undefined" &&
    window.location.search.includes("backdrop=1");

  const loadState = useCallback(async () => {
    try {
      const [pending, sound, blockSetting, locale, theme] = await Promise.all([
        alertsApi.listPending(),
        settingsApi.get("reminders.sound"),
        settingsApi.get("reminders.block_screen"),
        settingsApi.get("app.locale"),
        settingsApi.get("app.theme"),
      ]);
      setAlerts(pending);
      if (typeof sound === "boolean") setSoundEnabled(sound);
      if (popupWindow) {
        setBlockScreen(blockSetting === true);
      }
      if (typeof locale === "string" && locale !== i18n.language) {
        await i18n.changeLanguage(locale);
      }
      applyTheme(theme);
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
        className="flex min-h-screen w-screen flex-col items-center justify-center gap-3 bg-slate-950/95 p-6 text-center select-none overflow-hidden"
      >
        <div className="rounded-2xl bg-rose-500/15 p-4 ring-1 ring-rose-500/40">
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
    <div
      className={
        popupWindow
          ? "min-h-screen w-screen bg-slate-900 select-none overflow-hidden"
          : "min-h-screen w-screen bg-slate-950 select-none overflow-hidden"
      }
    >
      <ReminderModal
        alert={activeAlert}
        locked={popupWindow ? blockScreen : true}
        playSound={soundEnabled}
        inline={popupWindow}
        onResolve={handleResolve}
        onSnooze={handleSnooze}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
