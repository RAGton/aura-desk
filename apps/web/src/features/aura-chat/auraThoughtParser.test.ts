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

  it("parses <think> blocks, the tag MiniMax emits", () => {
    const raw =
      "<think>We need answer based on memories: user wants help to create projects. " +
      "Answer in Portuguese casual.</think>\n\nVocê quer ajuda para criar um projeto?";
    const result = parseAuraMessageThought(raw);

    expect(result.thought).toContain("We need answer based on memories");
    expect(result.answer).toBe("Você quer ajuda para criar um projeto?");
    expect(result.isThinking).toBe(false);
  });

  it("keeps an unclosed <think> block out of the answer while streaming", () => {
    const result = parseAuraMessageThought("<think>Still reasoning about the request");

    expect(result.thought).toBe("Still reasoning about the request");
    expect(result.answer).toBe("");
    expect(result.isThinking).toBe(true);
  });

  it("keeps the text around a reasoning block", () => {
    const result = parseAuraMessageThought("Antes <think>meio</think> depois");

    expect(result.thought).toBe("meio");
    expect(result.answer).toBe("Antes  depois");
  });

  it("handles several reasoning blocks in the same message", () => {
    const result = parseAuraMessageThought("<think>a</think>X<think>b</think>Y");

    expect(result.thought).toBe("a\n\nb");
    expect(result.answer).toBe("XY");
  });

  it("supports the reasoning and reflection tags", () => {
    expect(parseAuraMessageThought("<reasoning>r</reasoning>R").answer).toBe("R");
    expect(parseAuraMessageThought("<reflection>r</reflection>R").answer).toBe("R");
  });

  it("cleans code blocks and markdown markers for natural voice synthesis", () => {
    const raw = "Aqui está o comando:\n```bash\nnix develop\n```\nExecute com `sucesso` e veja **tudo** rodando.";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toBe("Aqui está o comando: Execute com sucesso e veja tudo rodando.");
  });
});
