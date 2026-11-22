import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bell,
  BellOff,
  Bot,
  Kanban,
  LayoutDashboard,
  Moon,
  PictureInPicture2,
  Play,
  Plus,
  Search,
  Settings,
  Timer,
} from "lucide-react";

import { Badge } from "@/components/ui";
import type { Task } from "@/lib/ipc";

export type CommandTabKey =
  | "dashboard"
  | "kanban"
  | "pomodoro"
  | "reminders"
  | "reports"
  | "hermes"
  | "settings";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  hasActivePomodoro: boolean;
  pomodoroPaused: boolean;
  onSelectTab: (tab: CommandTabKey) => void;
  onQuickCreateTask: (title: string) => void | Promise<void>;
  onStartPomodoro: (taskId?: string | null) => void | Promise<void>;
  onTogglePausePomodoro: () => void;
  onToggleDnd: () => void | Promise<void>;
  onToggleTheme: () => void | Promise<void>;
  onToggleCompact: () => void | Promise<void>;
}

interface PaletteItem {
  id: string;
  group: "quickCreate" | "navigation" | "actions" | "tasks";
  label: string;
  subtitle?: string;
  badge?: string;
  keywords: string;
  icon: typeof Search;
  onRun: () => void | Promise<void>;
}

export function CommandPalette({
  open,
  onClose,
  tasks,
  hasActivePomodoro,
  pomodoroPaused,
  onSelectTab,
  onQuickCreateTask,
  onStartPomodoro,
  onTogglePausePomodoro,
  onToggleDnd,
  onToggleTheme,
  onToggleCompact,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim();
    const q = trimmed.toLowerCase();
    const list: PaletteItem[] = [];

    if (trimmed.length >= 2) {
      list.push({
        id: "quick-create-task",
        group: "quickCreate",
        label: t("commandPalette.actions.createTask", { title: trimmed }),
        keywords: trimmed,
        icon: Plus,
        onRun: () => onQuickCreateTask(trimmed),
      });
    }

    const navItems: PaletteItem[] = [
      {
        id: "nav-dashboard",
        group: "navigation",
        label: t("nav.dashboard"),
        keywords: "dashboard inicio home resumo",
        icon: LayoutDashboard,
        onRun: () => onSelectTab("dashboard"),
      },
      {
        id: "nav-kanban",
        group: "navigation",
        label: t("nav.kanban"),
        keywords: "kanban tasks tarefas quadro",
        icon: Kanban,
        onRun: () => onSelectTab("kanban"),
      },
      {
        id: "nav-pomodoro",
        group: "navigation",
        label: t("nav.pomodoro"),
        keywords: "pomodoro foco timer focus",
        icon: Timer,
        onRun: () => onSelectTab("pomodoro"),
      },
      {
        id: "nav-reminders",
        group: "navigation",
        label: t("nav.reminders"),
        keywords: "reminders lembretes alerts alertas",
        icon: Bell,
        onRun: () => onSelectTab("reminders"),
      },
      {
        id: "nav-reports",
        group: "navigation",
        label: t("nav.reports"),
        keywords: "reports relatorios metricas csv json",
        icon: BarChart3,
        onRun: () => onSelectTab("reports"),
      },
      {
        id: "nav-hermes",
        group: "navigation",
        label: t("nav.hermes"),
        keywords: "hermes ia ai chat propostas audit",
        icon: Bot,
        onRun: () => onSelectTab("hermes"),
      },
      {
        id: "nav-settings",
        group: "navigation",
        label: t("nav.settings"),
        keywords: "settings configuracoes backup logs theme idioma",
        icon: Settings,
        onRun: () => onSelectTab("settings"),
      },
    ];

    const actionItems: PaletteItem[] = [
      hasActivePomodoro
        ? {
            id: "action-pomo-pause",
            group: "actions",
            label: pomodoroPaused
              ? t("commandPalette.actions.resumePomodoro")
              : t("commandPalette.actions.pausePomodoro"),
            keywords: "pomodoro pause resume pausar retomar timer",
            icon: Timer,
            onRun: () => onTogglePausePomodoro(),
          }
        : {
            id: "action-pomo-start",
            group: "actions",
            label: t("commandPalette.actions.startPomodoro"),
            keywords: "pomodoro start iniciar foco focus",
            icon: Play,
            onRun: () => onStartPomodoro(null),
          },
      {
        id: "action-dnd",
        group: "actions",
        label: t("commandPalette.actions.toggleDnd"),
        keywords: "dnd nao perturbe do not disturb silenciar",
        icon: BellOff,
        onRun: () => onToggleDnd(),
      },
      {
        id: "action-theme",
        group: "actions",
        label: t("commandPalette.actions.toggleTheme"),
        keywords: "theme tema dark light escuro claro",
        icon: Moon,
        onRun: () => onToggleTheme(),
      },
      {
        id: "action-compact",
        group: "actions",
        label: t("commandPalette.actions.toggleCompact"),
        keywords: "compact compacto floating mini pip",
        icon: PictureInPicture2,
        onRun: () => onToggleCompact(),
      },
    ];

    const matches = (item: PaletteItem) =>
      !q ||
      item.label.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q) ||
      (item.subtitle?.toLowerCase().includes(q) ?? false);

    list.push(...navItems.filter(matches));
    list.push(...actionItems.filter(matches));

    const matchingTasks = tasks
      .filter((task) => {
        if (!q) return task.status !== "done";
        const haystack = `${task.title} ${task.description ?? ""} ${(task.tags ?? []).join(" ")}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);

    for (const task of matchingTasks) {
      list.push({
        id: `task-${task.id}`,
        group: "tasks",
        label: task.title,
        subtitle: t("commandPalette.actions.focusTask"),
        badge: task.status,
        keywords: task.title,
        icon: Play,
        onRun: () => {
          onSelectTab("pomodoro");
          return onStartPomodoro(task.id);
        },
      });
    }

    return list;
  }, [
    query,
    t,
    tasks,
    hasActivePomodoro,
    pomodoroPaused,
    onQuickCreateTask,
    onSelectTab,
    onStartPomodoro,
    onTogglePausePomodoro,
    onToggleDnd,
    onToggleTheme,
    onToggleCompact,
  ]);

  useEffect(() => {
    setSelectedIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const executeItem = (item: PaletteItem) => {
    onClose();
    void Promise.resolve(item.onRun());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-aura-backdrop/75 p-4 pt-16 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette.title")}
        data-testid="command-palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-aura-border bg-aura-overlay/95 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 border-b border-aura-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  items.length === 0 ? 0 : (prev + 1) % items.length
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  items.length === 0 ? 0 : (prev - 1 + items.length) % items.length
                );
              } else if (e.key === "Enter" && items[selectedIndex]) {
                e.preventDefault();
                executeItem(items[selectedIndex]);
              }
            }}
            placeholder={t("commandPalette.placeholder")}
            aria-label={t("commandPalette.placeholder")}
            className="w-full bg-transparent text-sm text-aura-primary placeholder:text-slate-500 focus:outline-none"
          />
          <Badge variant="default" className="shrink-0 font-mono text-[10px]">
            {t("commandPalette.shortcut")}
          </Badge>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-400">
              {t("commandPalette.empty")}
            </p>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              const prevGroup = idx > 0 ? items[idx - 1]?.group : null;
              const showGroupHeader = item.group !== prevGroup;

              return (
                <div key={item.id}>
                  {showGroupHeader && (
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {t(`commandPalette.groups.${item.group}`)}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeItem(item)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-aura-accent/15 text-aura-accent ring-1 ring-aura-accent/30"
                        : "text-slate-200 hover:bg-slate-800/50"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.label}</span>
                        {item.subtitle && (
                          <span className="block truncate text-[11px] text-slate-400">
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                    </span>
                    {item.badge && (
                      <Badge variant="info" className="shrink-0 text-[10px]">
                        {item.badge}
                      </Badge>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-aura-border px-4 py-2 text-[11px] text-slate-500">
          {t("commandPalette.footerHint")}
        </div>
      </div>
    </div>
  );
}
