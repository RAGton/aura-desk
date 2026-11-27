/**
 * Local storage persistence and helpers for Aura chat folders / projects.
 *
 * Each project groups conversations together, optionally carries a short
 * context note, and can be linked to a Hindsight memory bank (`bankId`) so
 * every prompt inside that project recalls from that bank.
 */

export interface AuraChatProject {
  id: string;
  name: string;
  bankId: string | null;
  contextNote: string;
  createdAt: string;
}

export interface AuraChatProjectsState {
  projects: AuraChatProject[];
  /** Maps sessionId -> projectId; absent means "Contexto geral". */
  sessionProjectMap: Record<string, string>;
}

const STORAGE_KEY = "auradesk_chat_projects";

export const EMPTY_CHAT_PROJECTS_STATE: AuraChatProjectsState = {
  projects: [],
  sessionProjectMap: {},
};

/** Converts an arbitrary project name into a valid Hindsight bank slug. */
export function slugifyBankId(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function loadChatProjects(): AuraChatProjectsState {
  if (typeof window === "undefined" || !window.localStorage) {
    return { projects: [], sessionProjectMap: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: [], sessionProjectMap: {} };
    const parsed = JSON.parse(raw) as Partial<AuraChatProjectsState>;
    const projects: AuraChatProject[] = Array.isArray(parsed.projects)
      ? parsed.projects
          .filter(
            (p): p is AuraChatProject =>
              Boolean(p) &&
              typeof p.id === "string" &&
              typeof p.name === "string" &&
              p.name.trim().length > 0
          )
          .map((p) => ({
            id: p.id,
            name: p.name.trim(),
            bankId:
              typeof p.bankId === "string" && p.bankId.trim().length > 0
                ? p.bankId.trim()
                : null,
            contextNote: typeof p.contextNote === "string" ? p.contextNote : "",
            createdAt:
              typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
          }))
      : [];
    const validIds = new Set(projects.map((p) => p.id));
    const sessionProjectMap: Record<string, string> = {};
    if (parsed.sessionProjectMap && typeof parsed.sessionProjectMap === "object") {
      for (const [sid, pid] of Object.entries(parsed.sessionProjectMap)) {
        if (typeof sid === "string" && typeof pid === "string" && validIds.has(pid)) {
          sessionProjectMap[sid] = pid;
        }
      }
    }
    return { projects, sessionProjectMap };
  } catch {
    return { projects: [], sessionProjectMap: {} };
  }
}

export function saveChatProjects(state: AuraChatProjectsState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage write errors
  }
}

export function createChatProject(
  state: AuraChatProjectsState,
  input: { name: string; bankId: string | null; contextNote?: string }
): { state: AuraChatProjectsState; project: AuraChatProject } {
  const cleanName = input.name.trim();
  const cleanBank = input.bankId?.trim() ? input.bankId.trim() : null;
  const project: AuraChatProject = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    bankId: cleanBank,
    contextNote: input.contextNote?.trim() ?? "",
    createdAt: new Date().toISOString(),
  };
  return {
    project,
    state: {
      projects: [...state.projects, project],
      sessionProjectMap: { ...state.sessionProjectMap },
    },
  };
}

export function deleteChatProject(
  state: AuraChatProjectsState,
  projectId: string
): AuraChatProjectsState {
  const nextMap: Record<string, string> = {};
  for (const [sid, pid] of Object.entries(state.sessionProjectMap)) {
    if (pid !== projectId) nextMap[sid] = pid;
  }
  return {
    projects: state.projects.filter((p) => p.id !== projectId),
    sessionProjectMap: nextMap,
  };
}

export function assignSessionToProject(
  state: AuraChatProjectsState,
  sessionId: string,
  projectId: string | null
): AuraChatProjectsState {
  const nextMap = { ...state.sessionProjectMap };
  if (!projectId) {
    delete nextMap[sessionId];
  } else {
    nextMap[sessionId] = projectId;
  }
  return {
    projects: state.projects,
    sessionProjectMap: nextMap,
  };
}
