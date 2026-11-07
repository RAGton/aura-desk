import { describe, expect, it } from "vitest";
import { cn } from "./utils";

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
