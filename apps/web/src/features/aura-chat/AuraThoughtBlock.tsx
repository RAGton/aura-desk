import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, ChevronDown, Sparkles } from "lucide-react";

export interface AuraThoughtBlockProps {
  thought: string;
  isThinking?: boolean;
}

export function AuraThoughtBlock({ thought, isThinking = false }: AuraThoughtBlockProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(isThinking);

  const linesCount = thought.split("\n").filter((l) => l.trim().length > 0).length || 1;

  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-sky-400/25 bg-slate-950/50 backdrop-blur-md transition-all">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-sky-200/90 hover:bg-sky-500/10 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          {isThinking ? (
            <Sparkles className="h-3.5 w-3.5 text-amber-400 animate-pulse" aria-hidden="true" />
          ) : (
            <Brain className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
          )}
          <span>
            {isThinking
              ? t("hermes.thoughtThinking")
              : t("hermes.thoughtLines", { count: linesCount })}
          </span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-sky-300/70 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-sky-400/15 bg-slate-950/80 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-300 font-mono whitespace-pre-wrap select-text max-h-60 overflow-y-auto">
          {thought}
        </div>
      )}
    </div>
  );
}
