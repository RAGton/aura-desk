import React from "react";

export interface AuraDeskLogoProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

/**
 * Logo oficial do AuraDesk — "Tri-Prism AI Delta".
 * Emblema triangular facetado em estilo prisma neural formando um "A" estilizado para a Aura.
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
      aria-label="AuraDesk"
      className={`select-none ${className}`}
    >
      <defs>
        <linearGradient id="ad-bgGrad" x1="20" y1="16" x2="236" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#070B19" />
          <stop offset="52%" stopColor="#16133B" />
          <stop offset="100%" stopColor="#050814" />
        </linearGradient>

        <radialGradient id="ad-prismGlow" cx="50%" cy="52%" r="48%">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
          <stop offset="50%" stopColor="#818CF8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#070B19" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="ad-squircleStroke" x1="20" y1="20" x2="236" y2="236" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.58" />
          <stop offset="50%" stopColor="#818CF8" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0.48" />
        </linearGradient>

        {/* Faceta esquerda do prisma triangular */}
        <linearGradient id="ad-facetLeft" x1="48" y1="196" x2="132" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284C7" />
          <stop offset="55%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#A5F3FC" />
        </linearGradient>

        {/* Faceta direita do prisma triangular */}
        <linearGradient id="ad-facetRight" x1="126" y1="42" x2="208" y2="196" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C084FC" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#312E81" />
        </linearGradient>

        {/* Barra inferior / ponte neural em ângulo */}
        <linearGradient id="ad-facetBase" x1="68" y1="162" x2="192" y2="192" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="52%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>

        {/* Núcleo interno prismático */}
        <linearGradient id="ad-coreShard" x1="128" y1="98" x2="128" y2="162" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F8FAFC" />
          <stop offset="50%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#818CF8" />
        </linearGradient>
      </defs>

      {/* Container Squircle */}
      <rect
        x="14"
        y="14"
        width="228"
        height="228"
        rx="56"
        fill="url(#ad-bgGrad)"
        stroke="url(#ad-squircleStroke)"
        strokeWidth="2.5"
      />
      <rect
        x="20"
        y="20"
        width="216"
        height="216"
        rx="50"
        stroke="#FFFFFF"
        strokeOpacity="0.06"
        strokeWidth="1"
      />

      {/* Halo luminoso */}
      <circle
        cx="128"
        cy="132"
        r="92"
        fill="url(#ad-prismGlow)"
        className={animated ? "aura-breathe" : undefined}
      />

      {/* Moldura triangular externa tracejada de precisão */}
      <path
        d="M128 34 L214 188 L42 188 Z"
        stroke="#38BDF8"
        strokeOpacity="0.22"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeDasharray="6 6"
      />

      {/* Estrutura Tri-Prisma Assimétrica (forma um 'A' futurista aberto) */}
      {/* Lâmina Esquerda */}
      <path
        d="M128 42 L94 104 L68 186 L46 186 L108 68 C114 55, 121 46, 128 42 Z"
        fill="url(#ad-facetLeft)"
      />
      <path
        d="M128 42 L106 84 L94 104 L128 84 Z"
        fill="#E0F2FE"
        fillOpacity="0.35"
      />

      {/* Lâmina Direita */}
      <path
        d="M128 42 C135 46, 142 55, 148 68 L210 186 L186 186 L160 116 L128 74 Z"
        fill="url(#ad-facetRight)"
      />
      <path
        d="M128 42 L160 116 L140 100 L128 74 Z"
        fill="#F5D0FE"
        fillOpacity="0.28"
      />

      {/* Ponte Inferior Assimétrica em Chevrão */}
      <path
        d="M78 166 L154 146 L192 186 L96 186 Z"
        fill="url(#ad-facetBase)"
        fillOpacity="0.92"
      />

      {/* Prisma Neural Flutuante no Centro do Triângulo */}
      <g className={animated ? "aura-breathe" : undefined}>
        <polygon
          points="128,98 150,136 128,154 106,136"
          fill="url(#ad-coreShard)"
          stroke="#E0F2FE"
          strokeOpacity="0.85"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Linha de clivagem interna do cristal */}
        <line
          x1="128"
          y1="98"
          x2="128"
          y2="154"
          stroke="#FFFFFF"
          strokeOpacity="0.55"
          strokeWidth="1.25"
        />
      </g>

      {/* Nós Neurais nos 3 Vértices do Triângulo */}
      <circle cx="128" cy="40" r="5" fill="#E0F2FE" />
      <circle cx="128" cy="40" r="10" fill="#38BDF8" fillOpacity="0.28" />

      <circle cx="46" cy="186" r="4.5" fill="#38BDF8" />
      <circle cx="210" cy="186" r="4.5" fill="#34D399" />
    </svg>
  );
};
