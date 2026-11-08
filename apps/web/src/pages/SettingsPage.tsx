import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { IpcError, settingsApi } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface Setting {
  key: string;
  /** i18n key for the row label. */
  labelKey: string;
  /** i18n key for the row description. */
  descriptionKey: string;
  type: "string" | "number" | "boolean" | "time" | "select";
  options?: string[];
  group: string;
}

const SETTINGS_DEF: Setting[] = [
  {
    key: "app.locale",
    labelKey: "settings.items.locale.label",
    descriptionKey: "settings.items.locale.description",
    type: "select",
    options: ["pt-BR", "en"],
    group: "app",
  },
  {
    key: "app.theme",
    labelKey: "settings.items.theme.label",
    descriptionKey: "settings.items.theme.description",
    type: "select",
    options: ["dark", "light", "system"],
    group: "app",
  },
  {
    key: "pomodoro.focus_min",
    labelKey: "settings.items.focusMin.label",
    descriptionKey: "settings.items.focusMin.description",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "pomodoro.short_min",
    labelKey: "settings.items.shortMin.label",
    descriptionKey: "settings.items.shortMin.description",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "pomodoro.long_min",
    labelKey: "settings.items.longMin.label",
    descriptionKey: "settings.items.longMin.description",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "pomodoro.cycles_to_long",
    labelKey: "settings.items.cyclesToLong.label",
    descriptionKey: "settings.items.cyclesToLong.description",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "reminders.sound",
    labelKey: "settings.items.sound.label",
    descriptionKey: "settings.items.sound.description",
    type: "boolean",
    group: "reminders",
  },
  {
    key: "routine.daily_planning_time",
    labelKey: "settings.items.planningTime.label",
    descriptionKey: "settings.items.planningTime.description",
    type: "time",
    group: "routines",
  },
  {
    key: "routine.water_interval_min",
    labelKey: "settings.items.waterInterval.label",
    descriptionKey: "settings.items.waterInterval.description",
    type: "number",
    group: "routines",
  },
  {
    key: "routine.break_interval_min",
    labelKey: "settings.items.breakInterval.label",
    descriptionKey: "settings.items.breakInterval.description",
    type: "number",
    group: "routines",
  },
];

/** i18n key for each settings group heading. */
const GROUP_LABEL_KEYS: Record<string, string> = {
  app: "settings.groups.app",
  pomodoro: "settings.groups.pomodoro",
  reminders: "settings.groups.reminders",
  routines: "settings.groups.routines",
};

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const s of SETTINGS_DEF) {
      initial[s.key] = defaultFor(s);
    }
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .getAll()
      .then((pairs) => {
        setValues((prev) => {
          const next = { ...prev };
          for (const [k, v] of pairs) {
            next[k] = v;
          }
          return next;
        });
      })
      .catch(() => {
        // Fallback to local defaults if running in browser preview outside Tauri
      });
  }, []);

  async function saveOne(key: string, value: unknown) {
    setLoading(true);
    setError(null);
    try {
      await settingsApi.set(key, value);
      setValues((v) => ({ ...v, [key]: value }));
      if (key === "app.locale" && typeof value === "string") {
        await i18n.changeLanguage(value);
      }
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      if (key === "app.locale" && typeof value === "string") {
        await i18n.changeLanguage(value);
        setSavedAt(new Date().toLocaleTimeString());
      } else {
        setError(e instanceof IpcError ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  const groups = groupBy(SETTINGS_DEF, (s) => s.group);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-50">
            {t("settings.title")}
          </h2>
        </div>
        {savedAt ? (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
            ✓ {t("settings.saved")} ({savedAt})
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      ) : null}

      {Object.entries(groups).map(([group, items]) => (
        <section
          key={group}
          className="rounded-xl bg-slate-900/50 p-4 ring-1 ring-slate-800/80"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-sky-400">
            {t(GROUP_LABEL_KEYS[group] ?? group)}
          </h3>
          <div className="space-y-3">
            {items.map((s) => (
              <SettingRow
                key={s.key}
                setting={s}
                value={values[s.key]}
                disabled={loading}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, [s.key]: v }))
                }
                onSave={(v) => void saveOne(s.key, v)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface SettingRowProps {
  setting: Setting;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
  onSave: (v: unknown) => void;
}

function SettingRow({ setting, value, disabled, onChange, onSave }: SettingRowProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-800/50 pb-2.5 last:border-0 last:pb-0">
      <div>
        <div className="text-sm font-medium text-slate-200">
          {t(setting.labelKey)}
        </div>
        <div className="text-xs text-slate-400">{t(setting.descriptionKey)}</div>
      </div>
      <div className="flex items-center gap-2">
        {setting.type === "number" ? (
          <input
            type="number"
            min={1}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
            className="w-24 rounded-md bg-slate-800 px-2.5 py-1.5 text-right text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500 outline-none tabular-nums"
          />
        ) : setting.type === "boolean" ? (
          <button
            type="button"
            onClick={() => {
              const next = !value;
              onChange(next);
              onSave(next);
            }}
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors cursor-pointer",
              value ? "bg-sky-500" : "bg-slate-700"
            )}
            aria-pressed={!!value}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                value ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        ) : setting.type === "select" ? (
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value);
              onSave(e.target.value);
            }}
            className="rounded-md bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500"
          >
            {(setting.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : setting.type === "time" ? (
          <input
            type="time"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-md bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500"
          />
        ) : (
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-40 rounded-md bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500"
          />
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSave(value)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 cursor-pointer transition-colors"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

function defaultFor(s: Setting): unknown {
  switch (s.key) {
    case "app.locale":
      return "pt-BR";
    case "app.theme":
      return "dark";
    case "pomodoro.focus_min":
      return 25;
    case "pomodoro.short_min":
      return 5;
    case "pomodoro.long_min":
      return 15;
    case "pomodoro.cycles_to_long":
      return 4;
    case "reminders.sound":
      return true;
    case "routine.daily_planning_time":
      return "07:50";
    case "routine.water_interval_min":
      return 90;
    case "routine.break_interval_min":
      return 50;
    default:
      return null;
  }
}

function groupBy<T, K extends string>(items: T[], fn: (x: T) => K): Record<K, T[]> {
  const out: Record<K, T[]> = {} as Record<K, T[]>;
  for (const it of items) {
    const k = fn(it);
    if (!out[k]) out[k] = [];
    out[k].push(it);
  }
  return out;
}
