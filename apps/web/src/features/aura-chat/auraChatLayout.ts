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

/** Width preset of the conversation panel. */
export type AuraChatSize = "compact" | "normal" | "wide";

export interface AuraChatLayoutSettings {
  dock: AuraChatDock;
  transparency: AuraChatTransparency;
  size: AuraChatSize;
}

const STORAGE_KEY = "auradesk_chat_layout";

export const DEFAULT_CHAT_LAYOUT: AuraChatLayoutSettings = {
  dock: "right",
  transparency: "balanced",
  size: "normal",
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
      size:
        parsed.size === "compact" || parsed.size === "wide"
          ? parsed.size
          : "normal",
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
    composer: string;
    input: string;
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
    composer: "bg-slate-950/20",
    input: "bg-slate-950/35",
    border: "border-sky-400/15",
    blur: "backdrop-blur-md",
  },
  balanced: {
    container: "bg-slate-950/60",
    transcript: "bg-slate-950/75",
    header: "bg-slate-950/45",
    composer: "bg-slate-950/50",
    input: "bg-slate-900/60",
    border: "border-sky-400/20",
    blur: "backdrop-blur-2xl",
  },
  solid: {
    container: "bg-slate-950/92",
    transcript: "bg-slate-950/95",
    header: "bg-slate-950/85",
    composer: "bg-slate-950/90",
    input: "bg-slate-900/90",
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
  composer: string;
  input: string;
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

/** Width classes for the floating conversation panel per dock, size preset, and sidebar state. */
export function chatPanelWidthClass(
  dock: AuraChatDock,
  size: AuraChatSize,
  sidebarOpen = false
): string {
  if (dock === "center") {
    if (sidebarOpen) {
      switch (size) {
        case "compact":
          return "w-full max-w-[680px]";
        case "wide":
          return "w-full max-w-[940px]";
        default:
          return "w-full max-w-[820px]";
      }
    }
    switch (size) {
      case "compact":
        return "w-full max-w-[460px]";
      case "wide":
        return "w-full max-w-[720px]";
      default:
        return "w-full max-w-[600px]";
    }
  }
  if (sidebarOpen) {
    switch (size) {
      case "compact":
        return "w-full lg:w-[530px]";
      case "wide":
        return "w-full lg:w-[700px] xl:w-[780px]";
      default:
        return "w-full lg:w-[600px] xl:w-[680px]";
    }
  }
  switch (size) {
    case "compact":
      return "w-full lg:w-[340px]";
    case "wide":
      return "w-full lg:w-[540px] xl:w-[600px]";
    default:
      return "w-full lg:w-[440px] xl:w-[500px]";
  }
}

/** Horizontal desktop HUD & pyramid center inset when a side panel is open. */
export function chatSideOverlayInsetPx(size: AuraChatSize, sidebarOpen = false): number {
  const base = (() => {
    switch (size) {
      case "compact":
        return 340;
      case "wide":
        return 560;
      default:
        return 460;
    }
  })();
  return sidebarOpen ? base + 190 : base;
}

/** Default width of the docked conversation column. */
export const CHAT_COLUMN_WIDTH = "w-full lg:w-[440px] xl:w-[520px]";

/** Default width of the centered floating conversation panel. */
export const CHAT_CENTERED_WIDTH = "w-full max-w-[640px]";
