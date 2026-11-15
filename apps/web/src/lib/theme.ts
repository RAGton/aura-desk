export type AppTheme = "dark" | "light" | "system";

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
