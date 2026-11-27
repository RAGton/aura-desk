import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_CHAT_PROJECTS_STATE,
  assignSessionToProject,
  createChatProject,
  deleteChatProject,
  loadChatProjects,
  saveChatProjects,
  slugifyBankId,
} from "./auraChatProjects";

describe("auraChatProjects", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("slugifies accented names into valid Hindsight bank IDs", () => {
    expect(slugifyBankId("Casa em C++ & Hardware!")).toBe("casa-em-c-hardware");
    expect(slugifyBankId("Estudos Ação — Redes")).toBe("estudos-acao-redes");
    expect(slugifyBankId("   ")).toBe("");
  });

  it("creates projects, assigns sessions, deletes cleanly, and round-trips via localStorage", () => {
    const { state: s1, project: p1 } = createChatProject(EMPTY_CHAT_PROJECTS_STATE, {
      name: "Seniorsystem",
      bankId: "seniorsystem",
      contextNote: "ERP e rotinas",
    });
    const s2 = assignSessionToProject(s1, "sess-1", p1.id);
    saveChatProjects(s2);

    const loaded = loadChatProjects();
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0].bankId).toBe("seniorsystem");
    expect(loaded.sessionProjectMap["sess-1"]).toBe(p1.id);

    const s3 = assignSessionToProject(loaded, "sess-1", null);
    expect(s3.sessionProjectMap["sess-1"]).toBeUndefined();

    const s4 = deleteChatProject(loaded, p1.id);
    expect(s4.projects).toHaveLength(0);
    expect(s4.sessionProjectMap["sess-1"]).toBeUndefined();
  });
});
