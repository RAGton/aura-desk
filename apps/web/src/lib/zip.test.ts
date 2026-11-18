import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  crc32,
  decodeZipBase64,
  decodeZipTextEntries,
  decodeZipTextEntriesAsync,
  encodeZipBase64,
} from "./zip";

describe("PKZIP codec (browser fallback)", () => {
  it("computes standard IEEE 802.3 CRC-32 checksum", () => {
    const vector = new TextEncoder().encode("123456789");
    expect(crc32(vector)).toBe(0xcbf43926);
  });

  it("roundtrips ASCII and UTF-8 files through Store method 0 PKZIP", () => {
    const input = {
      "bundle.json": JSON.stringify({ title: "Revisão Semanal 🚀", count: 3 }),
      "notas/plano-diário.txt": "Prioridades: Foco, Café & Código",
    };

    const zipB64 = encodeZipBase64(input);
    const bytes = base64ToBytes(zipB64);

    // Local file header magic signature: PK\x03\x04
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);

    const decodedBinary = decodeZipBase64(zipB64);
    expect(Object.keys(decodedBinary)).toEqual(Object.keys(input));

    const decodedText = decodeZipTextEntries(zipB64);
    expect(decodedText).toEqual(input);
  });

  it("supports legacy auradesk-browser-backup JSON envelopes", () => {
    const legacyPayload = JSON.stringify({
      format: "auradesk-browser-backup",
      version: 1,
      files: {
        "tasks.json": "[]",
        "settings.json": "{}",
      },
    });
    const b64 = btoa(legacyPayload);
    expect(decodeZipTextEntries(b64)).toEqual({
      "tasks.json": "[]",
      "settings.json": "{}",
    });
  });

  it("detects CRC mismatches and corrupt archives", () => {
    const zipB64 = encodeZipBase64({ "bundle.json": '{"ok":true}' });
    const corrupted = base64ToBytes(zipB64);
    // Flip a byte inside the file payload (after 30-byte local header + filename).
    const payloadOffset = 30 + "bundle.json".length + 2;
    corrupted[payloadOffset] ^= 0xff;
    const corruptedB64 = btoa(String.fromCharCode(...corrupted));

    expect(() => decodeZipBase64(corruptedB64)).toThrow(/crc mismatch/);
    expect(() => decodeZipTextEntries(corruptedB64)).toThrow(/crc mismatch/);
    expect(() => decodeZipTextEntries("bm90LWEtemlw")).toThrow(/invalid zip archive/);
    expect(() => base64ToBytes("   ")).toThrow(/corrupt base64 archive/);
  });

  it("decodes asynchronously via decodeZipTextEntriesAsync", async () => {
    const zipB64 = encodeZipBase64({ "bundle.json": '{"async":true}' });
    const out = await decodeZipTextEntriesAsync(zipB64);
    expect(out).toEqual({ "bundle.json": '{"async":true}' });
  });

  it("roundtrips a large multi-hundred-record backup archive (> 150 KB)", () => {
    const largeTasks = Array.from({ length: 450 }, (_, idx) => ({
      id: `task-${idx}`,
      title: `Tarefa extensiva de validação ${idx} — integração Desktop/Web`,
      description: `Descrição detalhada número ${idx} para simular backup grande com acentuação e payload realístico (${"x".repeat(240)}).`,
      priority: idx % 4 === 0 ? "urgent" : "normal",
      status: idx % 3 === 0 ? "done" : "todo",
      kanban_order: idx,
      tags: ["phase1_5", "backup", `batch-${idx % 10}`],
    }));

    const files = {
      "manifest.json": JSON.stringify({ format: "auradesk-backup", version: 2, count: 450 }),
      "data.json": JSON.stringify({ tasks: largeTasks }),
    };

    const zipB64 = encodeZipBase64(files);
    const bytes = base64ToBytes(zipB64);
    expect(bytes.byteLength).toBeGreaterThan(150_000);

    const decoded = decodeZipTextEntries(zipB64);
    expect(JSON.parse(decoded["manifest.json"])).toEqual({
      format: "auradesk-backup",
      version: 2,
      count: 450,
    });
    const parsedData = JSON.parse(decoded["data.json"]) as { tasks: typeof largeTasks };
    expect(parsedData.tasks).toHaveLength(450);
    expect(parsedData.tasks[449]).toEqual(largeTasks[449]);
  });
});
