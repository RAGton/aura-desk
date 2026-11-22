import {
  Bell,
  Bot,
  Brain,
  Database,
  Droplets,
  GitBranch,
  Monitor,
  Palette,
  RefreshCw,
  Settings,
  Timer,
} from "lucide-react";

import type { VisualPrefs } from "@/lib/theme";

export type SettingType = "string" | "number" | "boolean" | "select";

export type SettingsGroupKey =
  | "app"
  | "desktop"
  | "appearance"
  | "pomodoro"
  | "reminders"
  | "routines"
  | "ai"
  | "github";

export type SettingsSectionKey =
  | "general"
  | "desktop"
  | "focus"
  | "reminders"
  | "ai"
  | "hindsight"
  | "raglight"
  | "system";

export interface SettingsSectionNavDef {
  key: SettingsSectionKey;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Settings;
  groups: SettingsGroupKey[];
}

export interface SettingOption {
  value: string;
  label?: string;
  labelKey?: string;
}

export interface SettingDef {
  key: string;
  labelKey: string;
  descriptionKey: string;
  type: SettingType;
  options?: SettingOption[];
  placeholder?: string;
  numericValue?: boolean;
  visualField?: keyof VisualPrefs;
  group: SettingsGroupKey;
}

export const SETTINGS_DEF: SettingDef[] = [
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
    key: "updates.auto_update",
    labelKey: "settings.items.autoUpdate.label",
    descriptionKey: "settings.items.autoUpdate.description",
    type: "boolean",
    group: "app",
  },
  {
    key: "app.autostart",
    labelKey: "settings.items.autostart.label",
    descriptionKey: "settings.items.autostart.description",
    type: "boolean",
    group: "desktop",
  },
  {
    key: "desktop.compact_mode",
    labelKey: "settings.items.compactMode.label",
    descriptionKey: "settings.items.compactMode.description",
    type: "boolean",
    group: "desktop",
  },
  {
    key: "monitor.preferred",
    labelKey: "settings.items.monitorPreferred.label",
    descriptionKey: "settings.items.monitorPreferred.description",
    type: "select",
    options: [
      { value: "primary", labelKey: "settings.items.monitorPreferred.primary" },
      { value: "secondary", labelKey: "settings.items.monitorPreferred.secondary" },
    ],
    group: "desktop",
  },
  {
    key: "monitor.fallback_strategy",
    labelKey: "settings.items.monitorFallback.label",
    descriptionKey: "settings.items.monitorFallback.description",
    type: "select",
    options: [
      {
        value: "primary_then_hide",
        labelKey: "settings.items.monitorFallback.primary_then_hide",
      },
      { value: "primary", labelKey: "settings.items.monitorFallback.primary" },
      { value: "hide", labelKey: "settings.items.monitorFallback.hide" },
    ],
    group: "desktop",
  },
  {
    key: "desktop.idle_threshold_min",
    labelKey: "settings.items.idleThresholdMin.label",
    descriptionKey: "settings.items.idleThresholdMin.description",
    type: "number",
    group: "desktop",
  },
  {
    key: "desktop.idle_auto_pause_pomodoro",
    labelKey: "settings.items.idleAutoPausePomodoro.label",
    descriptionKey: "settings.items.idleAutoPausePomodoro.description",
    type: "boolean",
    group: "desktop",
  },
  {
    key: "desktop.idle_suppress_routines",
    labelKey: "settings.items.idleSuppressRoutines.label",
    descriptionKey: "settings.items.idleSuppressRoutines.description",
    type: "boolean",
    group: "desktop",
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
    key: "ai.provider",
    labelKey: "settings.items.aiProvider.label",
    descriptionKey: "settings.items.aiProvider.description",
    type: "select",
    options: [
      { value: "auto", labelKey: "settings.items.aiProvider.auto" },
      { value: "openai", labelKey: "settings.items.aiProvider.openai" },
      { value: "minimax", labelKey: "settings.items.aiProvider.minimax" },
      { value: "ollama", labelKey: "settings.items.aiProvider.ollama" },
      { value: "openrouter", label: "OpenRouter" },
      { value: "codex_cli", labelKey: "settings.items.aiProvider.codexCli" },
      { value: "hermes_cli", labelKey: "settings.items.aiProvider.hermesCli" },
      { value: "custom", labelKey: "settings.items.aiProvider.custom" },
      { value: "offline", labelKey: "settings.items.aiProvider.offline" },
    ],
    group: "ai",
  },
  {
    key: "ai.model",
    labelKey: "settings.items.aiModel.label",
    descriptionKey: "settings.items.aiModel.description",
    type: "string",
    placeholder: "MiniMax-M1 / gpt-4.1-mini / llama3.2",
    group: "ai",
  },
  {
    key: "ai.base_url",
    labelKey: "settings.items.aiBaseUrl.label",
    descriptionKey: "settings.items.aiBaseUrl.description",
    type: "string",
    placeholder: "https://api.minimax.io/v1",
    group: "ai",
  },
  {
    key: "ai.api_key",
    labelKey: "settings.items.aiApiKey.label",
    descriptionKey: "settings.items.aiApiKey.description",
    type: "string",
    placeholder: "sk-...",
    group: "ai",
  },
  {
    key: "ai.system_prompt",
    labelKey: "settings.items.aiSystemPrompt.label",
    descriptionKey: "settings.items.aiSystemPrompt.description",
    type: "string",
    placeholder: "rust, security",
    group: "ai",
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

export const GROUP_LABEL_KEYS: Record<string, string> = {
  app: "settings.groups.app",
  desktop: "settings.groups.desktop",
  appearance: "settings.groups.appearance",
  pomodoro: "settings.groups.pomodoro",
  reminders: "settings.groups.reminders",
  routines: "settings.groups.routines",
  ai: "settings.groups.ai",
  github: "settings.groups.github",
};

export const GROUP_ICONS: Record<string, typeof Settings> = {
  app: Settings,
  desktop: Monitor,
  appearance: Palette,
  pomodoro: Timer,
  reminders: Bell,
  routines: Droplets,
  ai: Bot,
  github: GitBranch,
};

export const SETTINGS_SECTIONS: SettingsSectionNavDef[] = [
  {
    key: "general",
    labelKey: "settings.nav.general",
    descriptionKey: "settings.navDesc.general",
    icon: Palette,
    groups: ["app", "appearance"],
  },
  {
    key: "desktop",
    labelKey: "settings.nav.desktop",
    descriptionKey: "settings.navDesc.desktop",
    icon: Monitor,
    groups: ["desktop"],
  },
  {
    key: "focus",
    labelKey: "settings.nav.focus",
    descriptionKey: "settings.navDesc.focus",
    icon: Timer,
    groups: ["pomodoro", "routines"],
  },
  {
    key: "reminders",
    labelKey: "settings.nav.reminders",
    descriptionKey: "settings.navDesc.reminders",
    icon: Bell,
    groups: ["reminders"],
  },
  {
    key: "ai",
    labelKey: "settings.nav.ai",
    descriptionKey: "settings.navDesc.ai",
    icon: Bot,
    groups: ["ai", "github"],
  },
  {
    key: "hindsight",
    labelKey: "settings.nav.hindsight",
    descriptionKey: "settings.navDesc.hindsight",
    icon: Brain,
    groups: [],
  },
  {
    key: "raglight",
    labelKey: "settings.nav.raglight",
    descriptionKey: "settings.navDesc.raglight",
    icon: Database,
    groups: [],
  },
  {
    key: "system",
    labelKey: "settings.nav.system",
    descriptionKey: "settings.navDesc.system",
    icon: RefreshCw,
    groups: [],
  },
];

export function defaultFor(s: SettingDef): unknown {
  switch (s.key) {
    case "app.locale":
      return "pt-BR";
    case "app.theme":
      return "dark";
    case "app.autostart":
    case "desktop.compact_mode":
      return false;
    case "monitor.preferred":
      return "primary";
    case "monitor.fallback_strategy":
      return "primary_then_hide";
    case "desktop.idle_threshold_min":
      return 5;
    case "desktop.idle_auto_pause_pomodoro":
    case "desktop.idle_suppress_routines":
      return true;
    case "dashboard.refresh_sec":
      return 30;
    case "pomodoro.focus_min":
      return 25;
    case "pomodoro.short_min":
      return 5;
    case "pomodoro.long_min":
      return 15;
    case "pomodoro.cycles_to_long":
      return 4;
    case "reminders.sound":
    case "updates.auto_update":
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
    case "ai.base_url":
    case "ai.model":
    case "ai.api_key":
    case "ai.system_prompt":
      return "";
    case "ai.provider":
      return "auto";
    case "github.auto_sync":
      return false;
    default:
      return "";
  }
}

export function groupBy<T>(list: T[], fn: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of list) {
    const k = fn(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
