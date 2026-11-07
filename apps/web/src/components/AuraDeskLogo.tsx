import React from "react";

export interface AuraDeskLogoProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

/**
 * Logo oficial do AuraDesk — "Caderneta de Asa" (Winged Notebook).
 * Une a caderneta de produtividade pessoal (tarefas, kanban, notas, rotina)
 * às asas de Hermes (integração MCP com o Hermes Agent).
 */
export const AuraDeskLogo: React.FC<AuraDeskLogoProps> = ({
  size = 96,
  className = "",
  animated = true,
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="AuraDesk — Logo Caderneta de Asa"
      className={`select-none ${className}`}
    >
      <defs>
        <linearGradient id="ad-bgGrad" x1="24" y1="16" x2="232" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="50%" stopColor="#1E1B4B" />
          <stop offset="100%" stopColor="#090D16" />
        </linearGradient>

        <radialGradient id="ad-auraGlow" cx="50%" cy="48%" r="48%">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
          <stop offset="55%" stopColor="#818CF8" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0F172A" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="ad-wingTop" x1="16" y1="68" x2="240" y2="148" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>

        <linearGradient id="ad-wingMid" x1="24" y1="96" x2="232" y2="172" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="35%" stopColor="#38BDF8" />
          <stop offset="65%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#FBBF24" />
        </linearGradient>

        <linearGradient id="ad-notebookCover" x1="82" y1="54" x2="178" y2="204" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E293B" />
          <stop offset="100%" stopColor="#0F172A" />
        </linearGradient>

        <linearGradient id="ad-notebookStroke" x1="80" y1="52" x2="176" y2="204" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="55%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>

        <linearGradient id="ad-goldAccent" x1="128" y1="50" x2="160" y2="210" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>

      {/* Base Squircle */}
      <rect
        x="14"
        y="14"
        width="228"
        height="228"
        rx="54"
        fill="url(#ad-bgGrad)"
        stroke="#334155"
        strokeWidth="2.5"
      />
      <circle
        cx="128"
        cy="126"
        r="104"
        fill="url(#ad-auraGlow)"
        className={animated ? "animate-pulse" : undefined}
      />

      {/* Asa Esquerda */}
      <g className={animated ? "origin-[84px_128px] transition-transform duration-500 hover:-rotate-6" : undefined}>
        <path
          d="M84 106 C58 94, 34 72, 20 46 C19 68, 30 92, 50 106 C32 102, 22 92, 16 82 C20 104, 38 120, 64 126 Z"
          fill="url(#ad-wingTop)"
        />
        <path
          d="M84 124 C56 120, 34 112, 20 98 C25 118, 42 134, 68 140 Z"
          fill="url(#ad-wingMid)"
          opacity="0.95"
        />
        <path
          d="M84 140 C60 140, 40 136, 28 126 C35 144, 52 156, 76 158 Z"
          fill="#6366F1"
          opacity="0.9"
        />
        <path
          d="M84 154 C68 156, 52 156, 42 150 C50 164, 66 170, 84 168 Z"
          fill="#38BDF8"
          opacity="0.75"
        />
      </g>

      {/* Asa Direita */}
      <g className={animated ? "origin-[172px_128px] transition-transform duration-500 hover:rotate-6" : undefined}>
        <path
          d="M172 106 C198 94, 222 72, 236 46 C237 68, 226 92, 206 106 C224 102, 234 92, 240 82 C236 104, 218 120, 192 126 Z"
          fill="url(#ad-wingTop)"
        />
        <path
          d="M172 124 C200 120, 222 112, 236 98 C231 118, 214 134, 188 140 Z"
          fill="url(#ad-wingMid)"
          opacity="0.95"
        />
        <path
          d="M172 140 C196 140, 216 136, 228 126 C221 144, 204 156, 180 158 Z"
          fill="#6366F1"
          opacity="0.9"
        />
        <path
          d="M172 154 C188 156, 204 156, 214 150 C206 164, 190 170, 172 168 Z"
          fill="#38BDF8"
          opacity="0.75"
        />
      </g>

      {/* Folhas Internas da Caderneta */}
      <rect x="86" y="58" width="90" height="142" rx="14" fill="#E2E8F0" opacity="0.9" />
      <rect x="83" y="55" width="90" height="142" rx="14" fill="#94A3B8" opacity="0.5" />

      {/* Capa Principal da Caderneta */}
      <rect
        x="80"
        y="52"
        width="92"
        height="144"
        rx="14"
        fill="url(#ad-notebookCover)"
        stroke="url(#ad-notebookStroke)"
        strokeWidth="3.5"
      />

      {/* Lombada Esquerda */}
      <path
        d="M94 52 H96 V196 H94 C86.268 196 80 189.732 80 182 V66 C80 58.268 86.268 52 94 52 Z"
        fill="#0F172A"
        opacity="0.75"
      />
      <line x1="96" y1="54" x2="96" y2="194" stroke="#334155" strokeWidth="1.5" />

      {/* Espiral / Argolas Douradas */}
      <g stroke="url(#ad-goldAccent)" strokeWidth="3.5" strokeLinecap="round">
        <path d="M74 74 H88" />
        <path d="M74 96 H88" />
        <path d="M74 118 H88" />
        <path d="M74 140 H88" />
        <path d="M74 162 H88" />
        <path d="M74 180 H88" />
      </g>

      {/* Pautas e Checklists da Caderneta */}
      <path
        d="M106 86 L111 91 L120 81"
        stroke="#38BDF8"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="128" y1="86" x2="156" y2="86" stroke="#94A3B8" strokeWidth="3.2" strokeLinecap="round" />

      <path
        d="M106 110 L111 115 L120 105"
        stroke="#38BDF8"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="128" y1="110" x2="158" y2="110" stroke="#CBD5E1" strokeWidth="3.2" strokeLinecap="round" />

      <circle cx="113" cy="134" r="4.5" fill="#FBBF24" />
      <line x1="128" y1="134" x2="152" y2="134" stroke="#FDE68A" strokeWidth="3.2" strokeLinecap="round" />

      <line x1="108" y1="158" x2="146" y2="158" stroke="#64748B" strokeWidth="3" strokeLinecap="round" />

      {/* Estrela / Brilho Aura no Topo da Capa */}
      <path
        d="M150 64 L152.5 70.5 L159 73 L152.5 75.5 L150 82 L147.5 75.5 L141 73 L147.5 70.5 Z"
        fill="#FBBF24"
      />

      {/* Fita Marcadora de Página */}
      <path d="M142 196 V218 L150 211 L158 218 V196 Z" fill="url(#ad-goldAccent)" />
    </svg>
  );
};
