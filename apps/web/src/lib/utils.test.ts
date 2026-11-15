import { describe, expect, it } from "vitest";
import { applyVisualPrefs, saveVisualPrefs } from "./theme";
import { asArray, cn } from "./utils";

describe("cn utility", () => {
  it("combines class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    const isHidden = false;
    const isActive = true;
    expect(cn("base", isHidden && "hidden", isActive && "active")).toBe("base active");
  });

  it("resolves Tailwind class conflicts with twMerge", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles empty and falsy values gracefully", () => {
    expect(cn(null, undefined, false, "")).toBe("");
  });
});

describe("asArray utility", () => {
  it("returns the original array or falls back to empty array", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("not-an-array")).toEqual([]);
  });
});

describe("theme visual prefs", () => {
  it("activates light theme automatically for frosted preset and saves obsidian", () => {
    delete document.documentElement.dataset.theme;
    applyVisualPrefs({
      preset: "frosted",
      accent: "sky",
      glass: "medium",
      navLayout: "top",
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.preset).toBe("frosted");

    const updated = saveVisualPrefs({ preset: "obsidian" });
    expect(updated.preset).toBe("obsidian");
    expect(document.documentElement.dataset.preset).toBe("obsidian");
  });
});
