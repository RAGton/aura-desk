import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";

export interface AuraMarkdownViewProps {
  content: string;
}

interface Block {
  type: "code" | "paragraph" | "list";
  language?: string;
  code?: string;
  lines?: string[];
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];
  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      blocks.push({
        type: "paragraph",
        lines: [...paragraphBuffer],
      });
      paragraphBuffer = [];
    }
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({
        type: "list",
        lines: [...listBuffer],
      });
      listBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Fenced code block check
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      if (inCode) {
        blocks.push({
          type: "code",
          language: codeLang || "text",
          code: codeBuffer.join("\n"),
        });
        codeBuffer = [];
        codeLang = "";
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = codeMatch[1] || "";
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    // Bullet list check
    if (line.match(/^[-*+]\s+/)) {
      flushParagraph();
      listBuffer.push(line.replace(/^[-*+]\s+/, ""));
      continue;
    }

    // Empty line separates paragraphs / lists
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    // Regular line in paragraph
    flushList();
    paragraphBuffer.push(line);
  }

  if (inCode && codeBuffer.length > 0) {
    blocks.push({
      type: "code",
      language: codeLang || "text",
      code: codeBuffer.join("\n"),
    });
  } else {
    flushParagraph();
    flushList();
  }

  return blocks;
}

/** Renders bold, italics, inline code, and links within an inline line */
function renderInlineText(text: string) {
  // Simple tokenization for inline code `...`, bold **...**, italic *...*
  const parts: (string | JSX.Element)[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // 1. Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      keyIndex += 1;
      parts.push(
        <code
          key={`code-${keyIndex}`}
          className="rounded bg-sky-950/70 border border-sky-400/25 px-1.5 py-0.5 font-mono text-[11px] text-sky-200"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 2. Bold text: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      keyIndex += 1;
      parts.push(
        <strong key={`bold-${keyIndex}`} className="font-semibold text-slate-100">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 3. Regular chunk up to next special character
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Single stray symbol
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts;
}

export function AuraMarkdownView({ content }: AuraMarkdownViewProps) {
  const { t } = useTranslation();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!content) return null;

  const blocks = parseBlocks(content);

  const handleCopyCode = async (code: string, index: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // ignore copy failures in test/restricted environments
    }
  };

  return (
    <div className="space-y-2.5 text-xs text-slate-100 leading-relaxed break-words">
      {blocks.map((block, idx) => {
        if (block.type === "code") {
          const isCopied = copiedIndex === idx;
          return (
            <div
              key={`block-${idx}`}
              className="my-2 overflow-hidden rounded-xl border border-sky-400/25 bg-slate-950/85 backdrop-blur-md shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-sky-400/15 px-3 py-1.5 text-[10px] text-slate-400">
                <span className="font-mono uppercase tracking-wider text-sky-400/90 font-semibold">
                  {block.language || "code"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyCode(block.code ?? "", idx)}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-slate-300 hover:text-white hover:bg-sky-500/10 transition-colors"
                  aria-label={t("hermes.copyCode")}
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                      <span className="text-emerald-400">{t("hermes.copied")}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      <span>{t("hermes.copyCode")}</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-sky-100/90">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`block-${idx}`} className="space-y-1 pl-4 my-1 list-disc list-outside marker:text-sky-400">
              {block.lines?.map((line, lineIdx) => (
                <li key={`list-${lineIdx}`} className="leading-relaxed">
                  {renderInlineText(line)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`block-${idx}`} className="leading-relaxed">
            {block.lines?.map((line, lineIdx) => (
              <span key={`line-${lineIdx}`}>
                {renderInlineText(line)}
                {lineIdx < (block.lines?.length ?? 1) - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
