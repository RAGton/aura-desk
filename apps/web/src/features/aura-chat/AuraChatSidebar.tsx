import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  MessageSquare,
  Plus,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";

import type { ChatSession } from "../../lib/auraTypes";
import { Button, Input } from "../../components/ui";
import {
  slugifyBankId,
  type AuraChatProject,
  type AuraChatProjectsState,
} from "./auraChatProjects";

export type SidebarBankMode = "none" | "existing" | "create";

export interface CreateProjectPayload {
  name: string;
  contextNote: string;
  bankMode: SidebarBankMode;
  bankId: string | null;
}

export interface AuraChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  projectsState: AuraChatProjectsState;
  selectedProjectFilter: string | null;
  onSelectProjectFilter: (projectId: string | null) => void;
  availableBanks: string[];
  creatingSession?: boolean;
  onSelectSession: (sessionId: string) => void;
  onNewChat: (projectIdOverride?: string | null) => void;
  onCreateProject: (payload: CreateProjectPayload) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onAssignSessionProject: (sessionId: string, projectId: string | null) => void;
  onOpenSessions?: () => void;
  onOpenBank?: (bankId: string) => void;
  onClose?: () => void;
  surfaceClassName?: string;
  borderClassName?: string;
}

export function AuraChatSidebar({
  sessions,
  activeSessionId,
  projectsState,
  selectedProjectFilter,
  onSelectProjectFilter,
  availableBanks,
  creatingSession = false,
  onSelectSession,
  onNewChat,
  onCreateProject,
  onDeleteProject,
  onAssignSessionProject,
  onOpenSessions,
  onOpenBank,
  onClose,
  surfaceClassName,
  borderClassName,
}: AuraChatSidebarProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [projName, setProjName] = useState("");
  const [projContext, setProjContext] = useState("");
  const [bankMode, setBankMode] = useState<SidebarBankMode>("create");
  const [selectedExistingBank, setSelectedExistingBank] = useState<string>(
    () => availableBanks[0] ?? "aura-main"
  );
  const [customBankId, setCustomBankId] = useState("");
  const [bankIdEdited, setBankIdEdited] = useState(false);
  const [savingProject, setSavingProject] = useState(false);

  const projectMap = useMemo(() => {
    const map = new Map<string, AuraChatProject>();
    for (const p of projectsState.projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projectsState.projects]);

  const countsByProject = useMemo(() => {
    const counts = new Map<string, number>();
    let generalCount = 0;
    for (const s of sessions) {
      const pid = projectsState.sessionProjectMap[s.id];
      if (pid && projectMap.has(pid)) {
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      } else {
        generalCount += 1;
      }
    }
    return { counts, generalCount };
  }, [projectMap, projectsState.sessionProjectMap, sessions]);

  const filteredSessions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...sessions]
      .sort((a, b) =>
        (b.lastActivityAt || b.updatedAt || "").localeCompare(
          a.lastActivityAt || a.updatedAt || ""
        )
      )
      .filter((s) => {
        const assignedPid = projectsState.sessionProjectMap[s.id];
        if (selectedProjectFilter === "general") {
          if (assignedPid && projectMap.has(assignedPid)) return false;
        } else if (selectedProjectFilter) {
          if (assignedPid !== selectedProjectFilter) return false;
        }
        if (!needle) return true;
        const resolvedTitle = t(s.title, { defaultValue: s.title }).toLowerCase();
        const preview = (s.lastMessagePreview ?? "").toLowerCase();
        return resolvedTitle.includes(needle) || preview.includes(needle);
      });
  }, [
    projectMap,
    projectsState.sessionProjectMap,
    search,
    selectedProjectFilter,
    sessions,
    t,
  ]);

  const handleProjNameChange = (value: string) => {
    setProjName(value);
    if (!bankIdEdited) {
      setCustomBankId(slugifyBankId(value));
    }
  };

  const resetProjectForm = () => {
    setNewProjOpen(false);
    setProjName("");
    setProjContext("");
    setBankMode("create");
    setCustomBankId("");
    setBankIdEdited(false);
  };

  const handleSubmitProject = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = projName.trim();
    if (!cleanName || savingProject) return;

    let resolvedBankId: string | null = null;
    if (bankMode === "existing") {
      resolvedBankId = selectedExistingBank || availableBanks[0] || null;
    } else if (bankMode === "create") {
      resolvedBankId = slugifyBankId(customBankId || cleanName) || null;
    }

    setSavingProject(true);
    try {
      await onCreateProject({
        name: cleanName,
        contextNote: projContext.trim(),
        bankMode,
        bankId: resolvedBankId,
      });
      resetProjectForm();
    } finally {
      setSavingProject(false);
    }
  };

  const activeTargetProjectForNewChat =
    selectedProjectFilter && selectedProjectFilter !== "general"
      ? selectedProjectFilter
      : null;

  return (
    <aside
      data-testid="aura-chat-sidebar"
      aria-label={t("hermes.sidebar.title")}
      className={`flex flex-col w-full h-full min-h-0 border-r select-none ${
        surfaceClassName ?? "bg-slate-950/75"
      } ${borderClassName ?? "border-sky-400/15"}`}
    >
      {/* Top actions: New Chat + close on compact screens */}
      <div className="p-2.5 space-y-2 border-b border-sky-400/15 shrink-0">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={creatingSession}
            data-testid="aura-sidebar-new-chat"
            onClick={() => onNewChat(activeTargetProjectForNewChat)}
            className="flex-1 justify-start h-8 rounded-lg px-2.5 text-xs text-slate-100 hover:bg-sky-500/15 hover:text-sky-100 border border-sky-400/20"
          >
            <SquarePen className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("hermes.sidebar.newChat")}</span>
          </Button>

          {onClose && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              aria-label={t("compact.close", { defaultValue: "Close" })}
              className="h-8 w-8 p-0 shrink-0 rounded-lg text-slate-400 hover:text-white lg:hidden"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            data-testid="aura-sidebar-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("hermes.sidebar.searchPlaceholder")}
            aria-label={t("hermes.sidebar.searchPlaceholder")}
            className="w-full h-7 rounded-lg border border-sky-400/15 bg-slate-900/70 pl-7 pr-2 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400/50"
          />
        </div>
      </div>

      {/* Scrollable Projects + Recent Conversations */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
        {/* General Context */}
        <div className="space-y-1">
          <button
            type="button"
            data-testid="aura-project-all"
            onClick={() => onSelectProjectFilter(null)}
            className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
              selectedProjectFilter === null
                ? "bg-sky-500/20 text-sky-100"
                : "text-slate-300 hover:bg-slate-800/60"
            }`}
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <MessageSquare className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("hermes.sidebar.allChats")}</span>
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">{sessions.length}</span>
          </button>

          <button
            type="button"
            data-testid="aura-project-general"
            onClick={() =>
              onSelectProjectFilter(selectedProjectFilter === "general" ? null : "general")
            }
            className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
              selectedProjectFilter === "general"
                ? "bg-sky-500/20 text-sky-100"
                : "text-slate-300 hover:bg-slate-800/60"
            }`}
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("hermes.sidebar.generalContext")}</span>
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {countsByProject.generalCount}
            </span>
          </button>
        </div>

        {/* Projects / Folders Section */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t("hermes.sidebar.projectsTitle")}
            </span>
            <button
              type="button"
              data-testid="aura-new-project-btn"
              onClick={() => setNewProjOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/15 transition-colors"
            >
              <FolderPlus className="h-3 w-3" aria-hidden="true" />
              <span>{t("hermes.sidebar.newProject")}</span>
            </button>
          </div>

          {newProjOpen && (
            <form
              data-testid="aura-new-project-form"
              onSubmit={(e) => void handleSubmitProject(e)}
              className="rounded-xl border border-sky-400/25 bg-slate-900/90 p-2 space-y-2"
            >
              <Input
                containerClassName="w-full"
                data-testid="aura-project-name-input"
                value={projName}
                onChange={(e) => handleProjNameChange(e.target.value)}
                placeholder={t("hermes.sidebar.projectNamePlaceholder")}
                aria-label={t("hermes.sidebar.projectNamePlaceholder")}
                className="h-7 px-2 text-xs bg-slate-950/80 border-sky-400/25"
                autoFocus
              />
              <Input
                containerClassName="w-full"
                data-testid="aura-project-context-input"
                value={projContext}
                onChange={(e) => setProjContext(e.target.value)}
                placeholder={t("hermes.sidebar.projectContextPlaceholder")}
                aria-label={t("hermes.sidebar.projectContextPlaceholder")}
                className="h-7 px-2 text-[11px] bg-slate-950/80 border-sky-400/20"
              />

              <div className="space-y-1">
                <label className="block text-[10px] text-slate-400">
                  {t("hermes.sidebar.bankLinkLabel")}
                </label>
                <select
                  data-testid="aura-project-bank-mode"
                  value={bankMode}
                  onChange={(e) => setBankMode(e.target.value as SidebarBankMode)}
                  className="w-full h-7 rounded-lg border border-sky-400/25 bg-slate-950/80 px-2 text-[11px] text-slate-100 focus:outline-none"
                >
                  <option value="create">{t("hermes.sidebar.bankModeCreate")}</option>
                  <option value="existing">{t("hermes.sidebar.bankModeExisting")}</option>
                  <option value="none">{t("hermes.sidebar.bankModeNone")}</option>
                </select>
              </div>

              {bankMode === "existing" && (
                <select
                  data-testid="aura-project-bank-select"
                  value={selectedExistingBank}
                  onChange={(e) => setSelectedExistingBank(e.target.value)}
                  aria-label={t("hermes.sidebar.bankSelectLabel")}
                  className="w-full h-7 rounded-lg border border-sky-400/25 bg-slate-950/80 px-2 text-[11px] text-slate-100 focus:outline-none"
                >
                  {(availableBanks.length > 0 ? availableBanks : ["aura-main"]).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}

              {bankMode === "create" && (
                <Input
                  containerClassName="w-full"
                  data-testid="aura-project-bank-id-input"
                  value={customBankId}
                  onChange={(e) => {
                    setBankIdEdited(true);
                    setCustomBankId(e.target.value);
                  }}
                  placeholder={t("hermes.sidebar.bankIdPlaceholder")}
                  aria-label={t("hermes.sidebar.bankIdPlaceholder")}
                  className="h-7 px-2 text-[11px] font-mono bg-slate-950/80 border-cyan-400/30"
                />
              )}

              <div className="flex items-center justify-end gap-1.5 pt-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={resetProjectForm}
                  className="h-6 px-2 text-[11px] text-slate-400"
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!projName.trim() || savingProject}
                  data-testid="aura-project-create-submit"
                  className="h-6 px-2.5 text-[11px]"
                >
                  {t("hermes.sidebar.createProject")}
                </Button>
              </div>
            </form>
          )}

          {projectsState.projects.length === 0 ? (
            <p className="px-2 py-1 text-[10px] text-slate-500">
              {t("hermes.sidebar.noProjects")}
            </p>
          ) : (
            <div className="space-y-0.5">
              {projectsState.projects.map((proj) => {
                const isSelected = selectedProjectFilter === proj.id;
                const count = countsByProject.counts.get(proj.id) ?? 0;
                return (
                  <div
                    key={proj.id}
                    className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors ${
                      isSelected ? "bg-sky-500/20 text-sky-100" : "text-slate-300 hover:bg-slate-800/60"
                    }`}
                  >
                    <button
                      type="button"
                      data-testid={`aura-project-item-${proj.id}`}
                      onClick={() => onSelectProjectFilter(isSelected ? null : proj.id)}
                      className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-[11px]"
                    >
                      {isSelected ? (
                        <FolderOpen className="h-3.5 w-3.5 text-sky-300 shrink-0" aria-hidden="true" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate flex-1 font-medium">{proj.name}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                        {count}
                      </span>
                    </button>

                    {proj.bankId && (
                      <button
                        type="button"
                        onClick={() => onOpenBank?.(proj.bankId!)}
                        title={t("hermes.station.memoryBankTag", { bank: proj.bankId })}
                        aria-label={t("hermes.station.memoryBankTag", { bank: proj.bankId })}
                        className="inline-flex items-center gap-1 max-w-[78px] rounded-full border border-cyan-400/25 px-1.5 py-0.5 text-[9px] text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/25 shrink-0"
                      >
                        <Brain className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                        <span className="truncate font-mono">{proj.bankId}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onNewChat(proj.id)}
                      title={t("hermes.sidebar.newChatInProject", { name: proj.name })}
                      aria-label={t("hermes.sidebar.newChatInProject", { name: proj.name })}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-slate-400 hover:text-sky-200 transition-opacity shrink-0"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteProject(proj.id)}
                      title={t("hermes.sidebar.deleteProject")}
                      aria-label={t("hermes.sidebar.deleteProject")}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-slate-500 hover:text-rose-300 transition-opacity shrink-0"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Conversations */}
        <div className="space-y-1">
          <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {t("hermes.sidebar.recentsTitle")}
          </div>

          {filteredSessions.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-slate-500">
              {t("hermes.sidebar.noChats")}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filteredSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const assignedPid = projectsState.sessionProjectMap[session.id] ?? "";
                const assignedProject = assignedPid ? projectMap.get(assignedPid) : undefined;
                const label = t(session.title, { defaultValue: session.title });
                return (
                  <div
                    key={session.id}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
                      isActive
                        ? "bg-sky-500/20 text-white ring-1 ring-sky-400/30"
                        : "text-slate-300 hover:bg-slate-800/60"
                    }`}
                  >
                    <button
                      type="button"
                      data-testid={`aura-sidebar-session-${session.id}`}
                      onClick={() => onSelectSession(session.id)}
                      className="flex-1 min-w-0 text-left space-y-0.5"
                    >
                      <div className="truncate text-[11px] font-medium">{label}</div>
                      {(assignedProject || session.lastMessagePreview) && (
                        <div className="truncate text-[10px] text-slate-400">
                          {assignedProject
                            ? `${assignedProject.name}${
                                assignedProject.bankId ? ` · ${assignedProject.bankId}` : ""
                              }`
                            : session.lastMessagePreview}
                        </div>
                      )}
                    </button>

                    {projectsState.projects.length > 0 && (
                      <div
                        className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-45 group-hover:opacity-100 focus-within:opacity-100 hover:bg-slate-800/80 text-slate-400 hover:text-sky-300 transition-opacity"
                        title={t("hermes.sidebar.moveToProject")}
                      >
                        <Folder className="h-3 w-3 pointer-events-none" aria-hidden="true" />
                        <select
                          value={assignedProject ? assignedProject.id : ""}
                          onChange={(e) =>
                            onAssignSessionProject(
                              session.id,
                              e.target.value ? e.target.value : null
                            )
                          }
                          aria-label={t("hermes.sidebar.moveToProject")}
                          title={t("hermes.sidebar.moveToProject")}
                          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                        >
                          <option value="" className="bg-slate-950">
                            {t("hermes.sidebar.generalContext")}
                          </option>
                          {projectsState.projects.map((p) => (
                            <option key={p.id} value={p.id} className="bg-slate-950">
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer link to full Sessions & Context Center */}
      {onOpenSessions && (
        <div className="p-2 border-t border-sky-400/15 shrink-0">
          <button
            type="button"
            onClick={onOpenSessions}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors"
          >
            <ExternalLink className="h-3 w-3 text-sky-400" aria-hidden="true" />
            <span>{t("hermes.openSessions")}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
