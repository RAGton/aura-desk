import { describe, expect, it } from "vitest";
import ptBR from "../../locales/pt-BR.json";
import en from "../../locales/en.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe("i18n locales parity", () => {
  it("pt-BR.json and en.json expose the exact same translation key tree", () => {
    const ptKeys = flattenKeys(ptBR as Record<string, unknown>);
    const enKeys = flattenKeys(en as Record<string, unknown>);
    expect(ptKeys).toEqual(enKeys);
  });
});
