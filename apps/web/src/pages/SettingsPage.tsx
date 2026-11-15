import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Download,
  Droplets,
  GitBranch,
  Palette,
  Settings,
  ShieldAlert,
  Timer,
  Upload,
} from "lucide-react";

import { alertsApi, dataIoApi, githubApi, settingsApi, type GithubAuthStatus } from "@/lib/ipc";
import {
  applyTheme,
  loadVisualPrefs,
  saveVisualPrefs,
  type VisualPrefs,
} from "@/lib/theme";
import { asArray } from "@/lib/utils";

type SettingType = "string" | "number" | "boolean" | "select";

interface SettingOption {
  value: string;
  label?: string;
  labelKey?: string;
}

interface SettingDef {
  key: string;
  labelKey: string;
  descriptionKey: string;
  type: SettingType;
  options?: SettingOption[];
  placeholder?: string;
  numericValue?: boolean;
  visualField?: keyof VisualPrefs;
  group: "app" | "appearance" | "pomodoro" | "reminders" | "routines" | "github";
}

const SETTINGS_DEF: SettingDef[] = [
  {
    key: "app.locale",
    labelKey: "settings.items.locale.label",
    descriptionKey: "settings.items.locale.description",
    type: "select",
    options: [
      { value: "pt-BR", label: "pt-BR" },
      { value: "en", label: "en" },
    ],
    group: "app",
  },
  {
    key: "app.theme",
    labelKey: "settings.items.theme.label",
    descriptionKey: "settings.items.theme.description",
    type: "select",
    options: [
      { value: "dark", label: "dark" },
      { value: "light", label: "light" },
      { value: "system", label: "system" },
    ],
    group: "app",
  },
  {
    key: "dashboard.refresh_sec",
    labelKey: "settings.items.refreshSec.label",
    descriptionKey: "settings.items.refreshSec.description",
    type: "select",
    numericValue: true,
    options: [
      { value: "3", label: "3s" },
      { value: "5", label: "5s" },
      { value: "10", label: "10s" },
      { value: "15", label: "15s" },
      { value: "30", label: "30s" },
      { value: "60", label: "60s" },
    ],
    group: "app",
  },
  {
    key: "ui.preset",
    labelKey: "settings.items.preset.label",
    descriptionKey: "settings.items.preset.description",
    type: "select",
    visualField: "preset",
    options: [
      { value: "aurora", labelKey: "settings.items.presets.aurora" },
      { value: "obsidian", labelKey: "settings.items.presets.obsidian" },
      { value: "frosted", labelKey: "settings.items.presets.frosted" },
      { value: "emerald", labelKey: "settings.items.presets.emerald" },
      { value: "sunset", labelKey: "settings.items.presets.sunset" },
    ],
    group: "appearance",
  },
  {
    key: "ui.accent",
    labelKey: "settings.items.accent.label",
    descriptionKey: "settings.items.accent.description",
    type: "select",
    visualField: "accent",
    options: [
      { value: "sky", labelKey: "settings.items.accents.sky" },
      { value: "indigo", labelKey: "settings.items.accents.indigo" },
      { value: "emerald", labelKey: "settings.items.accents.emerald" },
      { value: "amber", labelKey: "settings.items.accents.amber" },
      { value: "rose", labelKey: "settings.items.accents.rose" },
      { value: "violet", labelKey: "settings.items.accents.violet" },
    ],
    group: "appearance",
  },
  {
    key: "ui.glass",
    labelKey: "settings.items.glass.label",
    descriptionKey: "settings.items.glass.description",
    type: "select",
    visualField: "glass",
    options: [
      { value: "subtle", labelKey: "settings.items.glasses.subtle" },
      { value: "medium", labelKey: "settings.items.glasses.medium" },
      { value: "intense", labelKey: "settings.items.glasses.intense" },
    ],
    group: "appearance",
  },
  {
    key: "ui.navLayout",
    labelKey: "settings.items.navLayout.label",
    descriptionKey: "settings.items.navLayout.description",
    type: "select",
    visualField: "navLayout",
    options: [
      { value: "top", labelKey: "settings.items.navLayouts.top" },
      { value: "sidebar", labelKey: "settings.items.navLayouts.sidebar" },
    ],
    group: "appearance",
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
    key: "reminders.block_screen",
    labelKey: "settings.items.blockScreen.label",
    descriptionKey: "settings.items.blockScreen.description",
    type: "boolean",
    group: "reminders",
  },
  {
    key: "alerts.max_queue_size",
    labelKey: "settings.items.maxQueue.label",
    descriptionKey: "settings.items.maxQueue.description",
    type: "number",
    group: "reminders",
  },
  {
    key: "proposals.ttl_hours",
    labelKey: "settings.items.proposalsTtl.label",
    descriptionKey: "settings.items.proposalsTtl.description",
    type: "number",
    group: "reminders",
  },
  {
    key: "routine.daily_planning_time",
    labelKey: "settings.items.planningTime.label",
    descriptionKey: "settings.items.planningTime.description",
    type: "string",
    placeholder: "07:50",
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
  {
    key: "github.repo",
    labelKey: "settings.items.githubRepo.label",
    descriptionKey: "settings.items.githubRepo.description",
    type: "string",
    placeholder: "owner/repo",
    group: "github",
  },
  {
    key: "github.filter_labels",
    labelKey: "settings.items.githubLabels.label",
    descriptionKey: "settings.items.githubLabels.description",
    type: "string",
    placeholder: "bug,enhancement",
    group: "github",
  },
  {
    key: "github.auto_sync",
    labelKey: "settings.items.githubAutoSync.label",
    descriptionKey: "settings.items.githubAutoSync.description",
    type: "boolean",
    group: "github",
  },
];

const GROUP_LABEL_KEYS: Record<string, string> = {
  app: "settings.groups.app",
  appearance: "settings.groups.appearance",
  pomodoro: "settings.groups.pomodoro",
  reminders: "settings.groups.reminders",
  routines: "settings.groups.routines",
  github: "settings.groups.github",
};

const GROUP_ICONS: Record<string, typeof Settings> = {
  app: Settings,
  appearance: Palette,
  pomodoro: Timer,
  reminders: Bell,
  routines: Droplets,
  github: GitBranch,
};

export interface SettingsPageProps {
  onSettingSaved?: (key: string, value: unknown) => void;
  onAlertTriggered?: () => void;
  onVisualPrefsChange?: (prefs: VisualPrefs) => void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/zip" });
}

export function SettingsPage({
  onSettingSaved,
  onAlertTriggered,
  onVisualPrefsChange,
}: SettingsPageProps = {}) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const s of SETTINGS_DEF) {
      initial[s.key] = defaultFor(s);
    }
    return initial;
  });
  const [visualPrefs, setVisualPrefs] = useState<VisualPrefs>(loadVisualPrefs);
  const [githubAuth, setGithubAuth] = useState<GithubAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAll = async (applyLoaded = false) => {
    try {
      const entries = asArray<[string, unknown]>(await settingsApi.getAll());
      const map: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        map[k] = v;
      }
      setValues((prev) => ({ ...prev, ...map }));
      if (applyLoaded) {
        if (typeof map["app.locale"] === "string") {
          await i18n.changeLanguage(map["app.locale"]);
        }
        if ("app.theme" in map) {
          applyTheme(map["app.theme"]);
        }
      }
    } catch {
      // Keep defaults when IPC is unavailable
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveOne(key: string, rawValue: unknown) {
    const def = SETTINGS_DEF.find((d) => d.key === key);

    if (def?.visualField) {
      const nextPrefs = saveVisualPrefs({ [def.visualField]: rawValue as never });
      setVisualPrefs(nextPrefs);
      onVisualPrefsChange?.(nextPrefs);
      setSavedMsg(t("settings.saved"));
      setTimeout(() => setSavedMsg(null), 2000);
      if (def.visualField === "preset") {
        const mappedTheme = rawValue === "frosted" ? "light" : "dark";
        await saveOne("app.theme", mappedTheme);
      }
      return;
    }

    const value = def?.numericValue ? Number(rawValue) : rawValue;

    if (def?.type === "number" || def?.numericValue) {
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        setError(t("settings.validation.invalidNumber"));
        return;
      }
    }

    if (key === "routine.daily_planning_time") {
      const s = String(value ?? "").trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) {
        setError(t("settings.validation.invalidTime"));
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      await settingsApi.set(key, value);
      setValues((v) => ({ ...v, [key]: value }));

      if (key === "app.locale" && typeof value === "string") {
        await i18n.changeLanguage(value);
      } else if (key === "app.theme") {
        applyTheme(value);
      } else if (key === "reminders.block_screen") {
        await alertsApi.syncDesktopLock().catch(() => {});
      }

      onSettingSaved?.(key, value);
      setSavedMsg(t("settings.saved"));
      setTimeout(() => setSavedMsg(null), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckGithubAuth() {
    setLoading(true);
    setError(null);
    try {
      const status = await githubApi.checkAuth();
      setGithubAuth(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleTestBlockingModal() {
    setLoading(true);
    setError(null);
    try {
      await alertsApi.triggerTestBlock(
        t("reminders.testBlockTitle"),
        t("reminders.testBlockBody")
      );
      setValues((v) => ({ ...v, "reminders.block_screen": true }));
      onSettingSaved?.("reminders.block_screen", true);
      onAlertTriggered?.();
      setSavedMsg(t("reminders.firedNow"));
      setTimeout(() => setSavedMsg(null), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleExportZip() {
    setLoading(true);
    setError(null);
    try {
      const zipBase64 = await dataIoApi.exportZipBase64();
      const blob = base64ToBlob(zipBase64);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `auradesk-backup-${today}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSavedMsg(t("settings.backup.exportSuccess"));
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleImportZip(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const b64 = bytesToBase64(new Uint8Array(buf));
      const summary = await dataIoApi.importZipBase64(b64);
      await loadAll(true);
      onAlertTriggered?.();
      setSavedMsg(
        t("settings.backup.importSuccess", {
          tasks: summary.tasks,
          settings: summary.settings,
        })
      );
      setTimeout(() => setSavedMsg(null), 3500);
    } catch (e) {
      setError(String(e) || t("settings.backup.invalidZip"));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const groups = groupBy(SETTINGS_DEF, (s) => s.group);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto aura-scrollbar pr-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-sky-400" />
            <h2 className="text-xl font-bold text-slate-50">{t("settings.title")}</h2>
          </div>
          <p className="text-xs text-slate-400">{t("settings.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2.5 text-xs">
          {savedMsg && (
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-300 ring-1 ring-emerald-500/35">
              ✓ {savedMsg}
            </span>
          )}
          {error && (
            <span className="rounded-full bg-red-500/15 px-3 py-1 font-semibold text-red-300 ring-1 ring-red-500/35">
              {error}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {Object.entries(groups).map(([group, items]) => {
          const GroupIcon = GROUP_ICONS[group] ?? Settings;
          return (
            <section
              key={group}
              className="rounded-2xl aura-glass p-5 flex flex-col justify-between"
            >
              <div>
                <h3 className="mb-3.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
                  <span className="rounded-lg bg-sky-500/15 p-1.5">
                    <GroupIcon className="h-3.5 w-3.5 text-sky-400" />
                  </span>
                  {t(GROUP_LABEL_KEYS[group] ?? group)}
                </h3>
                <div className="divide-y divide-slate-800/60">
                  {items.map((s) => {
                    const rowVal = s.visualField
                      ? visualPrefs[s.visualField]
                      : (values[s.key] ?? defaultFor(s));
                    return (
                      <SettingRow
                        key={s.key}
                        def={s}
                        value={rowVal}
                        disabled={loading}
                        onChange={(val) => {
                          if (!s.visualField) {
                            setValues((v) => ({ ...v, [s.key]: val }));
                          }
                        }}
                        onSave={(v) => void saveOne(s.key, v)}
                      />
                    );
                  })}

                  {group === "reminders" && (
                    <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-slate-100">
                          {t("settings.testBlockLabel")}
                        </div>
                        <div className="text-xs text-slate-400">
                          {t("settings.testBlockDescription")}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleTestBlockingModal()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40 cursor-pointer"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                        {t("reminders.testBlockButton")}
                      </button>
                    </div>
                  )}

                  {group === "github" && (
                    <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                      <div className="flex flex-wrap items-center gap-2.5 text-xs">
                        {githubAuth && (
                          <span
                            className={`rounded-full px-2.5 py-0.5 font-medium ring-1 ${
                              githubAuth.authenticated
                                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                                : "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                            }`}
                          >
                            {!githubAuth.available
                              ? t("settings.githubCliMissing")
                              : githubAuth.authenticated
                                ? t("settings.githubConnected", {
                                    account: githubAuth.account ?? "",
                                  })
                                : t("settings.githubNotConnected")}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleCheckGithubAuth()}
                        className="inline-flex items-center gap-1.5 rounded-xl aura-glass-pill px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-sky-300 disabled:opacity-40 cursor-pointer"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        {t("settings.githubCheckButton")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}

        {/* Backup & Portability (.zip) */}
        <section className="lg:col-span-2 rounded-2xl aura-glass p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
            <span className="rounded-lg bg-sky-500/15 p-1.5">
              <Download className="h-3.5 w-3.5 text-sky-400" />
            </span>
            {t("settings.groups.backup")}
          </h3>
          <p className="text-xs text-slate-400">{t("settings.backup.description")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleExportZip()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-sm shadow-sky-500/25 hover:bg-sky-400 disabled:opacity-40 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              {t("settings.backup.exportButton")}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              data-testid="backup-zip-input"
              onChange={(e) => void handleImportZip(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              {t("settings.backup.importButton")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingRow({
  def,
  value,
  disabled,
  onChange,
  onSave,
}: {
  def: SettingDef;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
  onSave: (v: unknown) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div>
        <div className="text-sm font-medium text-slate-100">{t(def.labelKey)}</div>
        <div className="text-xs text-slate-400">{t(def.descriptionKey)}</div>
      </div>
      <div className="flex items-center gap-2">
        {def.type === "boolean" ? (
          <button
            type="button"
            disabled={disabled}
            aria-label={t(def.labelKey)}
            aria-pressed={Boolean(value)}
            onClick={() => {
              const next = !value;
              onChange(next);
              onSave(next);
            }}
            className={`h-6 w-11 rounded-full transition-colors cursor-pointer ${
              value ? "bg-sky-500" : "bg-slate-700"
            }`}
          >
            <span
              className={`block h-5 w-5 transform rounded-full bg-white transition-transform ${
                value ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : def.type === "select" ? (
          <select
            aria-label={t(def.labelKey)}
            disabled={disabled}
            value={String(value ?? "")}
            onChange={(e) => {
              const next = e.target.value;
              onChange(next);
              onSave(next);
            }}
            className="rounded-lg bg-slate-950/70 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700"
          >
            {def.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.labelKey ? t(o.labelKey) : o.label}
              </option>
            ))}
          </select>
        ) : def.type === "number" ? (
          <input
            aria-label={t(def.labelKey)}
            type="number"
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-24 rounded-lg bg-slate-950/70 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700"
          />
        ) : (
          <input
            aria-label={t(def.labelKey)}
            type="text"
            placeholder={def.placeholder ?? ""}
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="w-40 rounded-lg bg-slate-950/70 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700"
          />
        )}

        {(def.type === "number" || def.type === "string") && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSave(value)}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            {t("kanban.save")}
          </button>
        )}
      </div>
    </div>
  );
}

function defaultFor(s: SettingDef): unknown {
  switch (s.key) {
    case "app.locale":
      return "pt-BR";
    case "app.theme":
      return "dark";
    case "dashboard.refresh_sec":
      return 5;
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
    case "reminders.block_screen":
      return false;
    case "alerts.max_queue_size":
      return 20;
    case "proposals.ttl_hours":
      return 24;
    case "routine.daily_planning_time":
      return "07:50";
    case "routine.water_interval_min":
      return 60;
    case "routine.break_interval_min":
      return 90;
    case "github.repo":
    case "github.filter_labels":
      return "";
    case "github.auto_sync":
      return false;
    default:
      return "";
  }
}

function groupBy<T>(list: T[], fn: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of list) {
    const k = fn(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
