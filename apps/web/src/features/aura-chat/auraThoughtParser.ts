/**
 * Utilities for extracting model reasoning/thought blocks and preparing
 * clean text for natural Brazilian Portuguese speech synthesis.
 *
 * Reasoning models expose their chain of thought under several tag names.
 * The ones observed in the wild, and therefore supported here:
 *
 *   `<think>`      MiniMax, Qwen, DeepSeek, GLM
 *   `<thought>`    Anthropic-style, Gemini-style, Hermes
 *   `<thinking>`   GPT-5 style, older Hermes builds
 *   `<reasoning>`  some open-weights models
 *   `<reflection>` self-critique passes
 *
 * A block that is still open (the model is still streaming) is treated as a
 * thought too, so the reasoning never leaks into the visible answer.
 */

/** Tag names that open a reasoning block. */
const THOUGHT_TAGS = ["think", "thought", "thinking", "reasoning", "reflection"];

/** Matches an opening tag of any supported kind. */
const OPEN_TAG = new RegExp(`<(${THOUGHT_TAGS.join("|")})\\s*>`, "i");

export interface ParsedAuraMessage {
  thought: string | null;
  answer: string;
  isThinking: boolean;
}

/**
 * Extracts the reasoning blocks from raw model output.
 *
 * Handles completed blocks, blocks that are still streaming, and several
 * blocks in the same message. Text outside the blocks is the answer.
 */
export function parseAuraMessageThought(rawText: string): ParsedAuraMessage {
  if (!rawText) {
    return { thought: null, answer: "", isThinking: false };
  }

  const thoughts: string[] = [];
  let answer = "";
  let isThinking = false;
  let cursor = 0;

  for (;;) {
    const rest = rawText.slice(cursor);
    const open = OPEN_TAG.exec(rest);
    if (!open) {
      // Everything left is answer text.
      answer += rest;
      break;
    }

    // Text before the tag belongs to the answer.
    answer += rest.slice(0, open.index);

    const tag = open[1].toLowerCase();
    const contentStart = cursor + open.index + open[0].length;

    // Find the matching closing tag. When it is missing the block is still
    // being streamed.
    const closeRe = new RegExp(`</${tag}\\s*>`, "i");
    const afterContent = rawText.slice(contentStart);
    const close = closeRe.exec(afterContent);

    if (!close) {
      const openThought = afterContent.trim();
      if (openThought) thoughts.push(openThought);
      isThinking = true;
      break;
    }

    const thought = afterContent.slice(0, close.index).trim();
    if (thought) thoughts.push(thought);
    cursor = contentStart + close.index + close[0].length;
  }

  const thought = thoughts.length > 0 ? thoughts.join("\n\n") : null;

  return {
    thought,
    answer: answer.trim(),
    isThinking,
  };
}

/**
 * Strips code blocks, raw markdown formatting, and URLs so SpeechSynthesis
 * produces pleasant, conversational Brazilian Portuguese audio without reading
 * syntax.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return "";

  return text
    // Remove fenced code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code ticks
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown links [Label](url) -> Label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove URLs
    .replace(/https?:\/\/\S+/g, "")
    // Remove markdown headers and list markers
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    // Remove bold/italics
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // Collapse excess spaces and newlines
    .replace(/\s+/g, " ")
    .trim();
}
