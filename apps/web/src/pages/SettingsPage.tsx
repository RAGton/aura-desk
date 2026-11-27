import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  Monitor,
  Settings,
  ShieldAlert,
} from "lucide-react";

import { Badge, Button, PageHeader, Toast } from "@/components/ui";
import {
  alertsApi,
  dataIoApi,
  desktopApi,
  githubApi,
  settingsApi,
  updaterApi,
  type GithubAuthStatus,
  type MonitorInfo,
  type UpdateStateSnapshot,
} from "@/lib/ipc";
import {
  applyTheme,
  loadVisualPrefs,
  saveVisualPrefs,
  type VisualPrefs,
} from "@/lib/theme";
import { asArray } from "@/lib/utils";
import {
  BackupRestoreSection,
  base64ToBlob,
  bytesToBase64,
} from "./settings/BackupRestoreSection";
import { SettingRow } from "./settings/SettingRow";
import { RaglightSection } from "./settings/RaglightSection";
import { HindsightSection } from "./settings/HindsightSection";
import { PluginsSection } from "./settings/PluginsSection";
import {
  defaultFor,
  GROUP_ICONS,
  GROUP_LABEL_KEYS,
  groupBy,
  SETTINGS_DEF,
  SETTINGS_SECTIONS,
  type SettingDef,
  type SettingsSectionKey,
} from "./settings/settingsSchema";
import { UpdatesAndLogsSection } from "./settings/UpdatesAndLogsSection";

const HINDSIGHT_FIELD_DEFAULTS: Record<string, string> = {
  "hindsight.base_url": "http://127.0.0.1:8919",
  "hindsight.default_bank": "aura-main",
};

const RAGLIGHT_FIELD_DEFAULTS: Record<string, string> = {
  "raglight.base_url": "http://127.0.0.1:8000",
  "raglight.api_key": "",
  "raglight.llm_model": "qwen3:0.6b",
  "raglight.embedding_model": "nomic-embed-text",
};

function isSchemaSettingDirty(
  def: SettingDef,
  values: Record<string, unknown>,
  savedValues: Record<string, unknown>
): boolean {
  if (def.visualField || (def.type !== "number" && def.type !== "string")) {
    return false;
  }
  const rowVal = values[def.key] ?? defaultFor(def);
  const savedVal = savedValues[def.key] ?? defaultFor(def);
  return String(rowVal ?? "") !== String(savedVal ?? "");
}

function hasFieldDefaultsDirty(
  defaults: Record<string, string>,
  values: Record<string, unknown>,
  savedValues: Record<string, unknown>
): boolean {
  return Object.entries(defaults).some(([key, fallback]) => {
    const current = values[key] ?? fallback;
    const saved = savedValues[key] ?? fallback;
    return String(current) !== String(saved);
  });
}

export interface SettingsPageProps {
  externalTheme?: string;
  externalLocale?: string;
  initialSection?: SettingsSectionKey;
  sectionRequest?: { section: SettingsSectionKey; seq: number } | null;
  onSettingSaved?: (key: string, value: unknown) => void;
  onAlertTriggered?: () => void;
  onVisualPrefsChange?: (prefs: VisualPrefs) => void;
}

export function SettingsPage({
  externalTheme,
  externalLocale,
  initialSection,
  sectionRequest,
  onSettingSaved,
  onAlertTriggered,
  onVisualPrefsChange,
}: SettingsPageProps = {}) {
  const { t, i18n } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(
    sectionRequest?.section ?? initialSection ?? "general"
  );
  const tabRefs = useRef<Partial<Record<SettingsSectionKey, HTMLButtonElement | null>>>({});
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const s of SETTINGS_DEF) {
      initial[s.key] = defaultFor(s);
    }
    return initial;
  });
  const [savedValues, setSavedValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const s of SETTINGS_DEF) {
      initial[s.key] = defaultFor(s);
    }
    return initial;
  });
  const [visualPrefs, setVisualPrefs] = useState<VisualPrefs>(loadVisualPrefs);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [githubAuth, setGithubAuth] = useState<GithubAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sectionRequest) return;
    setActiveSection(sectionRequest.section);
  }, [sectionRequest]);

  useEffect(() => {
    if (!externalTheme) return;
    setValues((prev) => (prev["app.theme"] === externalTheme ? prev : { ...prev, "app.theme": externalTheme }));
    setSavedValues((prev) =>
      prev["app.theme"] === externalTheme ? prev : { ...prev, "app.theme": externalTheme }
    );
    setVisualPrefs(loadVisualPrefs());
  }, [externalTheme]);

  useEffect(() => {
    if (!externalLocale) return;
    setValues((prev) => (prev["app.locale"] === externalLocale ? prev : { ...prev, "app.locale": externalLocale }));
    setSavedValues((prev) =>
      prev["app.locale"] === externalLocale ? prev : { ...prev, "app.locale": externalLocale }
    );
  }, [externalLocale]);

  const loadAll = async (applyLoaded = false) => {
    try {
      const [entries, detectedMonitors] = await Promise.all([
        settingsApi.getAll(),
        desktopApi.listMonitors().catch(() => [] as MonitorInfo[]),
      ]);
      if (!mountedRef.current) return;
      setMonitors(asArray<MonitorInfo>(detectedMonitors));
      const map: Record<string, unknown> = {};
      for (const [k, v] of asArray<[string, unknown]>(entries)) {
        map[k] = v;
      }
      setValues((prev) => ({ ...prev, ...map }));
      setSavedValues((prev) => ({ ...prev, ...map }));
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

  const [updateState, setUpdateState] = useState<UpdateStateSnapshot | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [logsTail, setLogsTail] = useState<string[] | null>(null);
  const [logsOpenedPath, setLogsOpenedPath] = useState<string | null>(null);

  async function refreshDiagnostics() {
    try {
      const [snap, lines] = await Promise.all([
        updaterApi.getState(),
        updaterApi.getLogsTail(80),
      ]);
      if (snap && typeof snap === "object") {
        setUpdateState(snap);
      }
      if (Array.isArray(lines)) {
        setLogsTail(lines);
      }
    } catch {
      // Non-blocking in browser/test runtimes without native log files.
    }
  }

  async function handleCheckUpdates() {
    setCheckingUpdate(true);
    setError(null);
    try {
      const snap = await updaterApi.checkNow(false);
      if (snap && typeof snap === "object") {
        setUpdateState(snap);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    setCheckingUpdate(true);
    setError(null);
    try {
      const snap = await updaterApi.installNow();
      if (snap && typeof snap === "object") {
        setUpdateState(snap);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleOpenLogsDir() {
    setError(null);
    try {
      const dir = await updaterApi.openLogsDir();
      if (dir) {
        setLogsOpenedPath(dir);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void loadAll();
    void refreshDiagnostics();

    const hasTauriInternals =
      typeof window !== "undefined" &&
      Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (!hasTauriInternals) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        unlisten = await listen<UpdateStateSnapshot>("auradesk://update-status", (event) => {
          if (cancelled || !event.payload) return;
          setUpdateState(event.payload);
          setCheckingUpdate(
            event.payload.status === "checking" ||
              event.payload.status === "downloading" ||
              event.payload.status === "verifying" ||
              event.payload.status === "installing"
          );
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function saveOne(key: string, rawValue: unknown) {
    const def = SETTINGS_DEF.find((d) => d.key === key);

    if (def?.visualField) {
      const nextPrefs = saveVisualPrefs({ [def.visualField]: rawValue as never });
      setVisualPrefs(nextPrefs);
      onVisualPrefsChange?.(nextPrefs);
      setSavedMsg(t("settings.saved"));
      setTimeout(() => setSavedMsg(null), 2000);
      if (def.visualField === "preset" && rawValue === "frosted") {
        await saveOne("app.theme", "light");
      }
      return;
    }

    const rawTrimmed = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    const isNumberSetting = def?.type === "number" || def?.numericValue;
    const value = isNumberSetting
      ? rawTrimmed === ""
        ? NaN
        : Number(rawTrimmed)
      : rawValue;

    if (isNumberSetting) {
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
      if (key === "app.autostart") {
        await desktopApi.setAutostart(Boolean(value));
      } else if (key === "desktop.compact_mode") {
        await desktopApi.toggleCompact(Boolean(value));
      } else {
        await settingsApi.set(key, value);
      }
      setValues((v) => ({ ...v, [key]: value }));
      setSavedValues((v) => ({ ...v, [key]: value }));

      if (key === "app.locale" && typeof value === "string") {
        await i18n.changeLanguage(value);
      } else if (key === "app.theme") {
        applyTheme(value);
      } else if (key === "reminders.block_screen") {
        await alertsApi.syncDesktopLock().catch(() => {});
      } else if (key === "monitor.preferred" || key === "monitor.fallback_strategy") {
        await desktopApi.applyMonitorPreference(false).catch(() => {});
      }

      onSettingSaved?.(key, value);
      if (key === "github.auto_sync" && value === true && !String(values["github.repo"] ?? "").trim()) {
        setSavedMsg(t("settings.githubAutoSyncNeedsRepo"));
        setTimeout(() => setSavedMsg(null), 3500);
      } else {
        setSavedMsg(t("settings.saved"));
        setTimeout(() => setSavedMsg(null), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyMonitorPlacement() {
    setLoading(true);
    setError(null);
    try {
      const outcome = await desktopApi.applyMonitorPreference(true);
      setSavedMsg(t("settings.monitorApplied", { outcome }));
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
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

  async function confirmImportZip() {
    const file = pendingImportFile;
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const b64 = bytesToBase64(new Uint8Array(buf));
      const summary = await dataIoApi.importZipBase64(b64);
      setPendingImportFile(null);
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
      setPendingImportFile(null);
      setError(String(e) || t("settings.backup.invalidZip"));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function cancelPendingImport() {
    if (loading) return;
    setPendingImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  const groups = useMemo(() => groupBy(SETTINGS_DEF, (s) => s.group), []);

  const sectionDirtyMap = useMemo(() => {
    const map: Record<SettingsSectionKey, boolean> = {
      general: false,
      desktop: false,
      focus: false,
      reminders: false,
      ai: false,
      hindsight: hasFieldDefaultsDirty(HINDSIGHT_FIELD_DEFAULTS, values, savedValues),
      raglight: hasFieldDefaultsDirty(RAGLIGHT_FIELD_DEFAULTS, values, savedValues),
      plugins: false,
      system: false,
    };
    for (const section of SETTINGS_SECTIONS) {
      if (section.groups.length > 0) {
        map[section.key] = section.groups.some((group) =>
          (groups[group] ?? []).some((s) => isSchemaSettingDirty(s, values, savedValues))
        );
      }
    }
    return map;
  }, [groups, values, savedValues]);

  const hasPendingUpdate =
    updateState?.status === "available" ||
    updateState?.status === "downloading" ||
    updateState?.status === "verifying" ||
    updateState?.status === "installing";

  const activeSectionDef =
    SETTINGS_SECTIONS.find((s) => s.key === activeSection) ?? SETTINGS_SECTIONS[0];
  const isSingleGroup = activeSectionDef.groups.length === 1;

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (index + 1) % SETTINGS_SECTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = SETTINGS_SECTIONS.length - 1;
    }
    if (nextIndex !== null) {
      e.preventDefault();
      const nextKey = SETTINGS_SECTIONS[nextIndex].key;
      setActiveSection(nextKey);
      tabRefs.current[nextKey]?.focus();
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto aura-scrollbar pr-1">
      <PageHeader
        icon={<Settings className="h-5 w-5" aria-hidden="true" />}
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
      />

      <div className="grid grid-cols-1 md:grid-cols-[230px_1fr] gap-5 items-start">
        {/* Dedicated Settings Subgroup Navbar (Linear/Raycast 2-column style) */}
        <div
          role="tablist"
          aria-label={t("settings.navAriaLabel")}
          aria-orientation="vertical"
          className="aura-glass rounded-2xl p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:sticky md:top-4 shrink-0"
        >
          {SETTINGS_SECTIONS.map((section, idx) => {
            const SectionIcon = section.icon;
            const isActive = activeSection === section.key;
            const dirty = sectionDirtyMap[section.key];
            const showUpdateDot = section.key === "system" && hasPendingUpdate;
            return (
              <button
                key={section.key}
                ref={(el) => {
                  tabRefs.current[section.key] = el;
                }}
                id={`settings-tab-${section.key}`}
                data-testid={`settings-tab-${section.key}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`settings-panel-${section.key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveSection(section.key)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`relative inline-flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer touch-manipulation whitespace-nowrap md:w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus ${
                  isActive
                    ? "bg-aura-accent/15 text-aura-accent ring-1 ring-aura-accent/35 shadow-sm"
                    : "text-aura-text-muted hover:text-aura-primary hover:bg-aura-elevated/60"
                }`}
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <SectionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(section.labelKey)}</span>
                </span>
                {dirty && (
                  <span
                    aria-hidden="true"
                    title={t("settings.unsavedIndicator")}
                    className="h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-2 ring-amber-400/25"
                  />
                )}
                {!dirty && showUpdateDot && (
                  <span
                    aria-hidden="true"
                    title={t("settings.updates.available", {
                      version: updateState?.latestVersion ?? updateState?.currentVersion ?? "",
                    })}
                    className="h-2 w-2 shrink-0 rounded-full bg-indigo-400 animate-pulse ring-2 ring-indigo-400/25"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col items-end gap-2 max-w-[calc(100vw-2rem)]">
          <Toast
            open={Boolean(savedMsg)}
            variant="success"
            message={savedMsg ? `✓ ${savedMsg}` : ""}
            onClose={() => setSavedMsg(null)}
          />
          <Toast
            open={Boolean(error)}
            variant="error"
            message={error ?? ""}
            onClose={() => setError(null)}
          />
        </div>

        <div
          key={activeSection}
          role="tabpanel"
          id={`settings-panel-${activeSection}`}
          aria-labelledby={`settings-tab-${activeSection}`}
          className="space-y-4 aura-panel-enter min-w-0"
        >
          <div className="rounded-2xl aura-glass-pill px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-aura-accent">
                {t(activeSectionDef.labelKey)}
              </span>
              <span className="text-slate-500">·</span>
              <p className="text-xs text-slate-400">
                {t(activeSectionDef.descriptionKey)}
              </p>
            </div>
          </div>

        {activeSectionDef.groups.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {activeSectionDef.groups.map((group) => {
              const items = groups[group] ?? [];
              const GroupIcon = GROUP_ICONS[group] ?? Settings;
              return (
                <section
                  key={group}
                  className={`rounded-2xl aura-glass p-5 flex flex-col justify-between ${
                    isSingleGroup ? "lg:col-span-2" : ""
                  }`}
                >
                  <div>
                    <h3 className="mb-3.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
                      <span className="rounded-lg bg-sky-500/15 p-1.5">
                        <GroupIcon className="h-3.5 w-3.5 text-sky-400" />
                      </span>
                      {t(GROUP_LABEL_KEYS[group] ?? group)}
                    </h3>
                    <div
                      className={
                        isSingleGroup
                          ? "grid grid-cols-1 lg:grid-cols-2 lg:gap-x-8 divide-y lg:divide-y-0 divide-slate-800/60"
                          : "divide-y divide-slate-800/60"
                      }
                    >
                      {items.map((s) => {
                        const rowVal = s.visualField
                          ? visualPrefs[s.visualField]
                          : (values[s.key] ?? defaultFor(s));
                        const isDirty = isSchemaSettingDirty(s, values, savedValues);
                        const effectiveDef =
                          s.key === "monitor.preferred" && monitors.length > 0
                            ? {
                                ...s,
                                options: [
                                  ...(s.options ?? []),
                                  ...monitors.map((m) => ({
                                    value: m.name,
                                    label: `${m.name} (${m.width}x${m.height}${m.isPrimary ? " ★" : ""})`,
                                  })),
                                ],
                              }
                            : s;
                        return (
                          <SettingRow
                            key={s.key}
                            def={effectiveDef}
                            value={rowVal}
                            dirty={isDirty}
                            disabled={loading}
                            className={
                              isSingleGroup
                                ? "first:pt-3 last:pb-3 lg:border-b lg:border-slate-800/60"
                                : undefined
                            }
                            onChange={(val) => {
                              if (!s.visualField) {
                                setValues((v) => ({ ...v, [s.key]: val }));
                              }
                            }}
                            onSave={(v) => void saveOne(s.key, v)}
                          />
                        );
                      })}

                      {group === "desktop" && (
                        <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-4 py-3 lg:pt-4 lg:pb-0">
                          <div className="text-xs text-slate-400">
                            {monitors.map((m) => `${m.name} (${m.width}x${m.height})`).join(" • ")}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={loading}
                            onClick={() => void handleApplyMonitorPlacement()}
                            className="rounded-xl text-xs font-semibold"
                          >
                            <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("settings.applyMonitorButton")}
                          </Button>
                        </div>
                      )}

                      {group === "reminders" && (
                        <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-4 py-3 lg:pt-4 lg:pb-0">
                          <div>
                            <div className="text-sm font-medium text-slate-100">
                              {t("settings.testBlockLabel")}
                            </div>
                            <div className="text-xs text-slate-400">
                              {t("settings.testBlockDescription")}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={loading}
                            onClick={() => void handleTestBlockingModal()}
                            className="rounded-xl bg-rose-500/20 text-xs font-semibold text-rose-200 border-rose-500/40 hover:bg-rose-500/30"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {t("reminders.testBlockButton")}
                          </Button>
                        </div>
                      )}

                      {group === "github" && (
                        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                          <div className="flex flex-wrap items-center gap-2.5 text-xs">
                            {githubAuth && (
                              <Badge
                                variant={githubAuth.authenticated ? "success" : "warning"}
                                className="rounded-full px-2.5 py-0.5 font-medium"
                              >
                                {!githubAuth.available
                                  ? t("settings.githubCliMissing")
                                  : githubAuth.authenticated
                                    ? t("settings.githubConnected", {
                                        account: githubAuth.account ?? "",
                                      })
                                    : t("settings.githubNotConnected")}
                              </Badge>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={loading}
                            onClick={() => void handleCheckGithubAuth()}
                            className="rounded-xl text-xs font-semibold"
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                            {t("settings.githubCheckButton")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {activeSection === "hindsight" && (
          <HindsightSection
            values={values}
            disabled={loading}
            onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
            onSave={(k, v) => void saveOne(k, v)}
          />
        )}

        {activeSection === "raglight" && (
          <RaglightSection
            values={values}
            disabled={loading}
            onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
            onSave={(k, v) => void saveOne(k, v)}
          />
        )}

        {activeSection === "plugins" && <PluginsSection />}

        {activeSection === "system" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <UpdatesAndLogsSection
              className="lg:col-span-2"
              updateState={updateState}
              appVersion={String(values["app.version"] ?? "0.2.2")}
              autoUpdateEnabled={values["updates.auto_update"] !== false}
              checkingUpdate={checkingUpdate}
              logsTail={logsTail}
              logsOpenedPath={logsOpenedPath}
              onCheckUpdates={() => void handleCheckUpdates()}
              onInstallUpdate={() => void handleInstallUpdate()}
              onOpenLogsDir={() => void handleOpenLogsDir()}
              onRefreshDiagnostics={() => void refreshDiagnostics()}
            />
            <BackupRestoreSection
              className="lg:col-span-1 flex flex-col justify-between"
              loading={loading}
              fileInputRef={fileInputRef}
              pendingImportFile={pendingImportFile}
              onExportZip={() => void handleExportZip()}
              onSelectImportFile={(f) => setPendingImportFile(f)}
              onConfirmImport={() => void confirmImportZip()}
              onCancelImport={cancelPendingImport}
            />
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
