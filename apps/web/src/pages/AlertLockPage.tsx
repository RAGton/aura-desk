import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ReminderModal } from "../components/ReminderModal";
import { alertsApi, isTauriRuntime, settingsApi, type Alert } from "../lib/ipc";
import { applyTheme } from "../lib/theme";

export function AlertLockPage() {
  const { i18n } = useTranslation();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const loadState = useCallback(async () => {
    try {
      const [pending, sound, locale, theme] = await Promise.all([
        alertsApi.listPending(),
        settingsApi.get("reminders.sound"),
        settingsApi.get("app.locale"),
        settingsApi.get("app.theme"),
      ]);
      setAlerts(pending);
      if (typeof sound === "boolean") setSoundEnabled(sound);
      if (typeof locale === "string" && locale !== i18n.language) {
        await i18n.changeLanguage(locale);
      }
      applyTheme(theme);
    } catch {
      // ignore transient startup IPC delays
    }
  }, [i18n]);

  useEffect(() => {
    void loadState();

    // Prevent escaping the desktop lock overlay via context menu or refresh keys.
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

  return (
    <div className="min-h-screen w-screen bg-slate-950 select-none overflow-hidden">
      <ReminderModal
        alert={activeAlert}
        locked
        playSound={soundEnabled}
        onResolve={handleResolve}
        onSnooze={handleSnooze}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
