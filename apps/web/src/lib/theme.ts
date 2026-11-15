export type AppTheme = "dark" | "light" | "system";
export type ThemePreset = "obsidian" | "frosted" | "aurora" | "emerald" | "sunset";
export type AccentColor = "sky" | "indigo" | "emerald" | "amber" | "rose" | "violet";
export type GlassIntensity = "subtle" | "medium" | "intense";
export type NavLayout = "top" | "sidebar";

export interface VisualPrefs {
  preset: ThemePreset;
  accent: AccentColor;
  glass: GlassIntensity;
  navLayout: NavLayout;
}

const VISUAL_PREFS_KEY = "auradesk_visual_prefs_v1";

export const DEFAULT_VISUAL_PREFS: VisualPrefs = {
  preset: "aurora",
  accent: "sky",
  glass: "medium",
  navLayout: "top",
};

const ACCENT_MAP: Record<AccentColor, { solid: string; soft: string; glow: string }> = {
  sky: {
    solid: "56 189 248",
    soft: "rgba(56, 189, 248, 0.16)",
    glow: "rgba(56, 189, 248, 0.35)",
  },
  indigo: {
    solid: "129 140 248",
    soft: "rgba(129, 140, 248, 0.18)",
    glow: "rgba(129, 140, 248, 0.35)",
  },
  emerald: {
    solid: "52 211 153",
    soft: "rgba(52, 211, 153, 0.16)",
    glow: "rgba(52, 211, 153, 0.35)",
  },
  amber: {
    solid: "251 191 36",
    soft: "rgba(251, 191, 36, 0.18)",
    glow: "rgba(251, 191, 36, 0.35)",
  },
  rose: {
    solid: "251 113 133",
    soft: "rgba(251, 113, 133, 0.18)",
    glow: "rgba(251, 113, 133, 0.35)",
  },
  violet: {
    solid: "167 139 250",
    soft: "rgba(167, 139, 250, 0.18)",
    glow: "rgba(167, 139, 250, 0.35)",
  },
};

const BLUR_MAP: Record<GlassIntensity, string> = {
  subtle: "10px",
  medium: "20px",
  intense: "32px",
};

function resolveEffectiveTheme(theme: AppTheme): "dark" | "light" {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/**
 * Applies the selected theme (`dark` | `light` | `system`) onto `document.documentElement`
 * so Tailwind/CSS theme rules react immediately across every page.
 */
export function applyTheme(theme: unknown): "dark" | "light" {
  const normalized: AppTheme =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "dark";
  const effective = resolveEffectiveTheme(normalized);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.theme = effective;
    root.dataset.themePref = normalized;
    root.classList.toggle("dark", effective === "dark");
    root.classList.toggle("light", effective === "light");
  }
  return effective;
}

export function loadVisualPrefs(): VisualPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_VISUAL_PREFS;
  try {
    const raw = localStorage.getItem(VISUAL_PREFS_KEY);
    if (!raw) return DEFAULT_VISUAL_PREFS;
    const parsed = JSON.parse(raw) as Partial<VisualPrefs>;
    const preset: ThemePreset =
      parsed.preset === "obsidian" ||
      parsed.preset === "frosted" ||
      parsed.preset === "aurora" ||
      parsed.preset === "emerald" ||
      parsed.preset === "sunset"
        ? parsed.preset
        : DEFAULT_VISUAL_PREFS.preset;
    const accent: AccentColor =
      parsed.accent && parsed.accent in ACCENT_MAP
        ? parsed.accent
        : DEFAULT_VISUAL_PREFS.accent;
    const glass: GlassIntensity =
      parsed.glass === "subtle" || parsed.glass === "medium" || parsed.glass === "intense"
        ? parsed.glass
        : DEFAULT_VISUAL_PREFS.glass;
    const navLayout: NavLayout =
      parsed.navLayout === "sidebar" || parsed.navLayout === "top"
        ? parsed.navLayout
        : DEFAULT_VISUAL_PREFS.navLayout;
    return { preset, accent, glass, navLayout };
  } catch {
    return DEFAULT_VISUAL_PREFS;
  }
}

export function applyVisualPrefs(prefs: VisualPrefs = loadVisualPrefs()): VisualPrefs {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.preset = prefs.preset;
    root.dataset.accent = prefs.accent;
    root.dataset.glass = prefs.glass;
    root.dataset.navLayout = prefs.navLayout;
    const accent = ACCENT_MAP[prefs.accent] ?? ACCENT_MAP.sky;
    root.style.setProperty("--aura-accent-rgb", accent.solid);
    root.style.setProperty("--aura-accent-soft", accent.soft);
    root.style.setProperty("--aura-accent-glow", accent.glow);
    root.style.setProperty("--aura-blur", BLUR_MAP[prefs.glass] ?? "20px");
    if (prefs.preset === "frosted") {
      applyTheme("light");
    } else if (!root.dataset.theme) {
      applyTheme("dark");
    }
  }
  return prefs;
}

export function saveVisualPrefs(patch: Partial<VisualPrefs>): VisualPrefs {
  const next: VisualPrefs = { ...loadVisualPrefs(), ...patch };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(VISUAL_PREFS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota/private mode errors
    }
  }
  return applyVisualPrefs(next);
}

let mediaListenerRegistered = false;

export function registerSystemThemeListener(): void {
  if (mediaListenerRegistered) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  mediaListenerRegistered = true;
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    if (document.documentElement.dataset.themePref === "system") {
      applyTheme("system");
    }
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
  }
}
