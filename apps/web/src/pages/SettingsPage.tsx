// `<SettingsPage>`: edit the user-facing settings. We render the
// 17 settings keys grouped by concern (Pomodoro, Reminders,
// Routines, Misc). Backend persistence goes through
// `settings.set(key, json_value)`; the Rust side validates types.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { IpcError } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface Setting {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "time" | "select";
  options?: string[];
  group: string;
}

const SETTINGS_DEF: Setting[] = [
  {
    key: "app.locale",
    label: "Idioma",
    description: "Idioma da interface (pt-BR | en).",
    type: "select",
    options: ["pt-BR", "en"],
    group: "app",
  },
  {
    key: "app.theme",
    label: "Tema",
    description: "Tema da interface. Apenas dark por enquanto.",
    type: "select",
    options: ["dark", "light", "system"],
    group: "app",
  },
  {
    key: "pomodoro.focus_min",
    label: "Foco (min)",
    description: "Duração do bloco de foco em minutos.",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "pomodoro.short_min",
    label: "Pausa curta (min)",
    description: "Duração da pausa curta em minutos.",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "pomodoro.long_min",
    label: "Pausa longa (min)",
    description: "Duração da pausa longa em minutos.",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "pomodoro.cycles_to_long",
    label: "Ciclos até pausa longa",
    description: "Quantos blocos de foco antes de uma pausa longa.",
    type: "number",
    group: "pomodoro",
  },
  {
    key: "reminders.sound",
    label: "Som dos lembretes",
    description: "Tocar som ao disparar um lembrete.",
    type: "boolean",
    group: "reminders",
  },
  {
    key: "routine.daily_planning_time",
    label: "Planejamento diário",
    description: "Horário local (HH:MM) do planejamento diário.",
    type: "time",
    group: "routines",
  },
  {
    key: "routine.water_interval_min",
    label: "Intervalo de hidratação (min)",
    description: "A cada quantos minutos lembrar de beber água.",
    type: "number",
    group: "routines",
  },
  {
    key: "routine.break_interval_min",
    label: "Intervalo de pausa (min)",
    description: "A cada quantos minutos lembrar de fazer uma pausa.",
    type: "number",
    group: "routines",
  },
];

const GROUP_LABELS: Record<string, string> = {
  app: "Aplicativo",
  pomodoro: "Pomodoro",
  reminders: "Lembretes",
  routines: "Rotinas",
};

export function SettingsPage() {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    // Settings read path: we re-use the SettingsService via a
    // dedicated IPC command. To keep this page self-contained
    // while the settings IPC set is wired in Phase 6 polish, we
    // lazily read via `getAll` once it lands. For now we just
    // initialize with sensible defaults from SETTINGS_DEF.
    const initial: Record<string, unknown> = {};
    for (const s of SETTINGS_DEF) {
      initial[s.key] = defaultFor(s);
    }
    setValues(initial);
  }, []);

  async function saveOne(key: string, value: unknown) {
    setLoading(true);
    setError(null);
    try {
      // settings_set is wired in the runtime; we call it directly via
      // the generic `invoke` to avoid coupling the page to the
      // generated api object (which is being added alongside this
      // page in the same commit).
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("settings_set", { key, value });
      setValues((v) => ({ ...v, [key]: value }));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof IpcError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const groups = groupBy(SETTINGS_DEF, (s) => s.group);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
            {t("settings.title")}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">{t("settings.subtitle")}</p>
        </div>
        {savedAt ? (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            ✓ Salvo {savedAt}
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
          className="rounded-xl bg-slate-900/30 p-4 ring-1 ring-slate-800/80"
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {GROUP_LABELS[group] ?? group}
          </h2>
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
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
      <div>
        <div className="text-sm font-medium text-slate-200">{setting.label}</div>
        <div className="text-[11px] text-slate-500">{setting.description}</div>
      </div>
      <div className="flex items-center gap-2">
        {setting.type === "number" ? (
          <input
            type="number"
            min={1}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
            className="w-24 rounded-md bg-slate-800 px-2 py-1.5 text-right text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-blue-500 outline-none tabular-nums"
          />
        ) : setting.type === "boolean" ? (
          <button
            type="button"
            onClick={() => onChange(!value)}
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors",
              value ? "bg-blue-600" : "bg-slate-700"
            )}
            aria-pressed={!!value}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                value ? "translate-x-5" : "translate-x-0.5"
              )}
            />
          </button>
        ) : setting.type === "select" ? (
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-blue-500"
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
            className="rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-blue-500"
          />
        ) : (
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-40 rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-blue-500"
          />
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSave(value)}
          className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
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
