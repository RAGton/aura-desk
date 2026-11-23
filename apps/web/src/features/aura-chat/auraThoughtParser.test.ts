import { describe, expect, it } from "vitest";
import { cleanTextForSpeech, parseAuraMessageThought } from "./auraThoughtParser";

describe("auraThoughtParser", () => {
  it("parses closed <thought> tags into separate thought and answer", () => {
    const raw = "<thought>\nAnalyzing user request.\nStep 1: Check DB.\n</thought>\n\nHere is your requested plan.";
    const result = parseAuraMessageThought(raw);
    expect(result.thought).toBe("Analyzing user request.\nStep 1: Check DB.");
    expect(result.answer).toBe("Here is your requested plan.");
    expect(result.isThinking).toBe(false);
  });

  it("parses closed <thinking> tags", () => {
    const raw = "<thinking>Consider time zones</thinking>The time is 10:00.";
    const result = parseAuraMessageThought(raw);
    expect(result.thought).toBe("Consider time zones");
    expect(result.answer).toBe("The time is 10:00.");
  });

  it("handles streaming unclosed <thought> tags gracefully", () => {
    const streaming = "<thought>Drafting code...";
    const result = parseAuraMessageThought(streaming);
    expect(result.thought).toBe("Drafting code...");
    expect(result.answer).toBe("");
    expect(result.isThinking).toBe(true);
  });

  it("returns null thought when no thought tags are present", () => {
    const raw = "Simples resposta em texto plano.";
    const result = parseAuraMessageThought(raw);
    expect(result.thought).toBeNull();
    expect(result.answer).toBe("Simples resposta em texto plano.");
    expect(result.isThinking).toBe(false);
  });

  it("cleans code blocks and markdown markers for natural voice synthesis", () => {
    const raw = "Aqui está o comando:\n```bash\nnix develop\n```\nExecute com `sucesso` e veja **tudo** rodando.";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toBe("Aqui está o comando: Execute com sucesso e veja tudo rodando.");
  });
});
