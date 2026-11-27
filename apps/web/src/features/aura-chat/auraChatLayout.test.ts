import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_LAYOUT,
  chatDockOrder,
  chatPanelWidthClass,
  chatTransparencyClasses,
  loadChatLayout,
  saveChatLayout,
} from "./auraChatLayout";

describe("auraChatLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to a right-docked, balanced, normal-sized panel", () => {
    expect(loadChatLayout()).toEqual(DEFAULT_CHAT_LAYOUT);
    expect(DEFAULT_CHAT_LAYOUT.dock).toBe("right");
    expect(DEFAULT_CHAT_LAYOUT.transparency).toBe("balanced");
    expect(DEFAULT_CHAT_LAYOUT.size).toBe("normal");
  });

  it("round-trips through localStorage and migrates legacy settings missing size", () => {
    saveChatLayout({ dock: "center", transparency: "clear", size: "compact" });
    expect(loadChatLayout()).toEqual({ dock: "center", transparency: "clear", size: "compact" });

    localStorage.setItem(
      "auradesk_chat_layout",
      JSON.stringify({ dock: "left", transparency: "clear" })
    );
    expect(loadChatLayout()).toEqual({ dock: "left", transparency: "clear", size: "normal" });
  });

  it("falls back to the defaults for invalid stored values", () => {
    localStorage.setItem(
      "auradesk_chat_layout",
      JSON.stringify({ dock: "diagonal", transparency: "invisible", size: "huge" })
    );
    expect(loadChatLayout()).toEqual(DEFAULT_CHAT_LAYOUT);
  });

  it("orders the columns according to the dock", () => {
    expect(chatDockOrder("left")).toBe("chat-first");
    expect(chatDockOrder("right")).toBe("station-first");
    expect(chatDockOrder("center")).toBe("station-first");
  });

  it("keeps the text layer more opaque than the surrounding chrome", () => {
    for (const level of ["clear", "balanced", "solid"] as const) {
      const classes = chatTransparencyClasses(level);
      const opacityOf = (value: string) => {
        const match = value.match(/\/(\d+)\b/);
        return match ? Number(match[1]) : 100;
      };
      const container = opacityOf(classes.container);
      const transcript = opacityOf(classes.transcript);
      const header = opacityOf(classes.header);

      expect(transcript).toBeGreaterThan(container);
      expect(header).toBeLessThanOrEqual(container);
    }
  });

  it("makes clear level more transparent than solid across container, transcript, composer, and input", () => {
    const opacityOf = (value: string) => {
      const match = value.match(/\/(\d+)\b/);
      return match ? Number(match[1]) : 100;
    };
    const clear = chatTransparencyClasses("clear");
    const solid = chatTransparencyClasses("solid");

    expect(opacityOf(clear.container)).toBeLessThan(opacityOf(solid.container));
    expect(opacityOf(clear.transcript)).toBeLessThan(opacityOf(solid.transcript));
    expect(opacityOf(clear.composer)).toBeLessThan(opacityOf(solid.composer));
    expect(opacityOf(clear.input)).toBeLessThan(opacityOf(solid.input));
  });

  it("returns distinct width classes for compact, normal, and wide panels", () => {
    expect(chatPanelWidthClass("right", "compact")).toContain("lg:w-[340px]");
    expect(chatPanelWidthClass("right", "normal")).toContain("lg:w-[440px]");
    expect(chatPanelWidthClass("right", "wide")).toContain("lg:w-[540px]");
    expect(chatPanelWidthClass("center", "compact")).toContain("max-w-[460px]");
  });
});
