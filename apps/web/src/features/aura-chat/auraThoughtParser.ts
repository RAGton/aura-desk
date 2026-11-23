/**
 * Utilities for extracting model reasoning/thought blocks (Antigravity/DeepSeek/Gemini style)
 * and preparing clean text for natural Brazilian Portuguese speech synthesis.
 */

export interface ParsedAuraMessage {
  thought: string | null;
  answer: string;
  isThinking: boolean;
}

/**
 * Extracts `<thought>` or `<thinking>` blocks from raw model output.
 * Handles both completed blocks and streaming unclosed blocks.
 */
export function parseAuraMessageThought(rawText: string): ParsedAuraMessage {
  if (!rawText) {
    return { thought: null, answer: "", isThinking: false };
  }

  // 1. Closed tag: <thought>...</thought> or <thinking>...</thinking>
  const closedMatch = rawText.match(/<(thought|thinking)>([\s\S]*?)<\/\1>/i);
  if (closedMatch) {
    const thought = closedMatch[2].trim();
    const answer = rawText.replace(/<(thought|thinking)>[\s\S]*?<\/\1>/gi, "").trim();
    return {
      thought: thought.length > 0 ? thought : null,
      answer,
      isThinking: false,
    };
  }

  // 2. Open / Streaming tag: <thought>... without matching closing tag
  const openMatch = rawText.match(/<(thought|thinking)>([\s\S]*)$/i);
  if (openMatch) {
    const thought = openMatch[2].trim();
    const answer = rawText.replace(/<(thought|thinking)>[\s\S]*$/gi, "").trim();
    return {
      thought: thought.length > 0 ? thought : null,
      answer,
      isThinking: true,
    };
  }

  return {
    thought: null,
    answer: rawText,
    isThinking: false,
  };
}

/**
 * Strips code blocks, raw markdown formatting, and URLs so SpeechSynthesis
 * produces pleasant, conversational Brazilian Portuguese audio without reading syntax.
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
