/**
 * Layout preferences for the Aura conversation panel.
 *
 * The panel is fully dockable: it can sit on the right (default), on the
 * left, or float centered over the galaxy. It can also be made translucent
 * so the galaxy shows through — while keeping the text legible by giving the
 * text area a more opaque background than the surrounding chrome.
 */

/** Where the conversation column sits relative to the 3D station. */
export type AuraChatDock = "left" | "right" | "center";

/** How transparent the conversation panel is. */
export type AuraChatTransparency = "clear" | "balanced" | "solid";

export interface AuraChatLayoutSettings {
  dock: AuraChatDock;
  transparency: AuraChatTransparency;
}

const STORAGE_KEY = "auradesk_chat_layout";

export const DEFAULT_CHAT_LAYOUT: AuraChatLayoutSettings = {
  dock: "right",
  transparency: "balanced",
};

export function loadChatLayout(): AuraChatLayoutSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_CHAT_LAYOUT };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHAT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<AuraChatLayoutSettings>;
    return {
      dock:
        parsed.dock === "left" || parsed.dock === "center" ? parsed.dock : "right",
      transparency:
        parsed.transparency === "clear" || parsed.transparency === "solid"
          ? parsed.transparency
          : "balanced",
    };
  } catch {
    return { ...DEFAULT_CHAT_LAYOUT };
  }
}

export function saveChatLayout(settings: AuraChatLayoutSettings): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage write errors
  }
}

/** Opacity ramps for the panel chrome and for the text area. */
const TRANSPARENCY_RAMP: Record<
  AuraChatTransparency,
  {
    container: string;
    transcript: string;
    header: string;
    border: string;
    blur: string;
  }
> = {
  // The galaxy reads through the panel, but the transcript keeps its own
  // darker layer so the words stay legible.
  clear: {
    container: "bg-slate-950/25",
    transcript: "bg-slate-950/45",
    header: "bg-slate-950/20",
    border: "border-sky-400/15",
    blur: "backdrop-blur-md",
  },
  balanced: {
    container: "bg-slate-950/60",
    transcript: "bg-slate-950/75",
    header: "bg-slate-950/45",
    border: "border-sky-400/20",
    blur: "backdrop-blur-2xl",
  },
  solid: {
    container: "bg-slate-950/92",
    transcript: "bg-slate-950/95",
    header: "bg-slate-950/85",
    border: "border-sky-400/25",
    blur: "backdrop-blur-2xl",
  },
};

/** Classes for the conversation column, given the transparency level. */
export function chatTransparencyClasses(
  transparency: AuraChatTransparency
): {
  container: string;
  transcript: string;
  header: string;
  border: string;
  blur: string;
} {
  return TRANSPARENCY_RAMP[transparency] ?? TRANSPARENCY_RAMP.balanced;
}

/**
 * Order of the two columns for the docked layout.
 *
 * `center` is handled separately: the conversation floats over the station
 * instead of splitting the width with it.
 */
export function chatDockOrder(dock: AuraChatDock): "chat-first" | "station-first" {
  return dock === "left" ? "chat-first" : "station-first";
}

/** Width of the docked conversation column. */
export const CHAT_COLUMN_WIDTH = "w-full lg:w-[440px] xl:w-[520px]";

/** Width of the centered floating conversation panel. */
export const CHAT_CENTERED_WIDTH = "w-full max-w-[640px]";
