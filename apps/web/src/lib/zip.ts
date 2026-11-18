const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "");
  if (!clean) {
    throw new Error("corrupt base64 archive");
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function writeUint16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Encodes a map of filename -> string/Uint8Array into a genuine PKZIP archive
 * (Store method 0, IEEE 802.3 CRC-32, UTF-8 filename flag) and returns Base64.
 */
export function encodeZipBase64(
  files: Record<string, string | Uint8Array>
): string {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([name, raw]) => {
    const nameBytes = encoder.encode(name);
    const data = typeof raw === "string" ? encoder.encode(raw) : raw;
    return {
      nameBytes,
      data,
      crc: crc32(data),
    };
  });

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    writeUint32LE(lv, 0, LOCAL_FILE_HEADER_SIG);
    writeUint16LE(lv, 4, 20);
    writeUint16LE(lv, 6, UTF8_FLAG);
    writeUint16LE(lv, 8, METHOD_STORE);
    writeUint16LE(lv, 10, 0);
    writeUint16LE(lv, 12, 0x5421);
    writeUint32LE(lv, 14, entry.crc);
    writeUint32LE(lv, 18, entry.data.length);
    writeUint32LE(lv, 22, entry.data.length);
    writeUint16LE(lv, 26, entry.nameBytes.length);
    writeUint16LE(lv, 28, 0);
    localHeader.set(entry.nameBytes, 30);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    writeUint32LE(cv, 0, CENTRAL_DIR_HEADER_SIG);
    writeUint16LE(cv, 4, 20);
    writeUint16LE(cv, 6, 20);
    writeUint16LE(cv, 8, UTF8_FLAG);
    writeUint16LE(cv, 10, METHOD_STORE);
    writeUint16LE(cv, 12, 0);
    writeUint16LE(cv, 14, 0x5421);
    writeUint32LE(cv, 16, entry.crc);
    writeUint32LE(cv, 20, entry.data.length);
    writeUint32LE(cv, 24, entry.data.length);
    writeUint16LE(cv, 28, entry.nameBytes.length);
    writeUint16LE(cv, 30, 0);
    writeUint16LE(cv, 32, 0);
    writeUint16LE(cv, 34, 0);
    writeUint16LE(cv, 36, 0);
    writeUint32LE(cv, 38, 0);
    writeUint32LE(cv, 42, offset);
    centralHeader.set(entry.nameBytes, 46);

    localParts.push(localHeader, entry.data);
    centralParts.push(centralHeader);

    offset += localHeader.length + entry.data.length;
    centralSize += centralHeader.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  writeUint32LE(ev, 0, EOCD_SIG);
  writeUint16LE(ev, 4, 0);
  writeUint16LE(ev, 6, 0);
  writeUint16LE(ev, 8, entries.length);
  writeUint16LE(ev, 10, entries.length);
  writeUint32LE(ev, 12, centralSize);
  writeUint32LE(ev, 16, offset);
  writeUint16LE(ev, 20, 0);

  const totalLength = offset + centralSize + eocd.length;
  const archive = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of localParts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  archive.set(eocd, cursor);

  return bytesToBase64(archive);
}

interface ParsedZipEntry {
  name: string;
  method: number;
  expectedCrc: number;
  uncompressedSize: number;
  compressedSlice: Uint8Array;
}

function parseCentralDirectory(bytes: Uint8Array): ParsedZipEntry[] {
  if (bytes.length < 22) {
    throw new Error("invalid zip archive");
  }
  const minOffset = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (readUint32LE(bytes, i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("invalid zip archive");
  }

  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  const centralSize = readUint32LE(bytes, eocdOffset + 12);
  const centralOffset = readUint32LE(bytes, eocdOffset + 16);
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error("invalid central directory");
  }

  const decoder = new TextDecoder();
  const entries: ParsedZipEntry[] = [];
  let ptr = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (ptr + 46 > centralOffset + centralSize) {
      throw new Error("invalid central directory");
    }
    if (readUint32LE(bytes, ptr) !== CENTRAL_DIR_HEADER_SIG) {
      throw new Error("invalid central directory");
    }
    const method = readUint16LE(bytes, ptr + 10);
    const expectedCrc = readUint32LE(bytes, ptr + 16);
    const compressedSize = readUint32LE(bytes, ptr + 20);
    const uncompressedSize = readUint32LE(bytes, ptr + 24);
    const nameLen = readUint16LE(bytes, ptr + 28);
    const extraLen = readUint16LE(bytes, ptr + 30);
    const commentLen = readUint16LE(bytes, ptr + 32);
    const localHeaderOffset = readUint32LE(bytes, ptr + 42);

    const nameStart = ptr + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    ptr = nameStart + nameLen + extraLen + commentLen;

    if (
      localHeaderOffset + 30 > centralOffset ||
      readUint32LE(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER_SIG
    ) {
      throw new Error("invalid local header");
    }
    const localNameLen = readUint16LE(bytes, localHeaderOffset + 26);
    const localExtraLen = readUint16LE(bytes, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) {
      throw new Error("invalid entry bounds");
    }

    entries.push({
      name,
      method,
      expectedCrc,
      uncompressedSize,
      compressedSlice: bytes.subarray(dataStart, dataEnd),
    });
  }

  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("unsupported zip compression method");
  }
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  await writer.write(new Uint8Array(data));
  await writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function isPkzipPrefix(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && readUint32LE(bytes, 0) === LOCAL_FILE_HEADER_SIG;
}

function tryLegacyJsonBackup(bytes: Uint8Array): Record<string, string> | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as {
      format?: string;
      files?: Record<string, string>;
    };
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.format === "auradesk-browser-backup" &&
      parsed.files &&
      typeof parsed.files === "object"
    ) {
      return parsed.files;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decodes a Base64 PKZIP (Store method 0) archive synchronously and validates CRC-32.
 */
export function decodeZipBase64(zipBase64: string): Record<string, Uint8Array> {
  const bytes = base64ToBytes(zipBase64);
  const parsedEntries = parseCentralDirectory(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const entry of parsedEntries) {
    if (entry.method !== METHOD_STORE) {
      throw new Error("unsupported zip compression method");
    }
    if (entry.compressedSlice.length !== entry.uncompressedSize) {
      throw new Error("invalid zip entry length");
    }
    const copy = new Uint8Array(entry.compressedSlice);
    if (crc32(copy) !== entry.expectedCrc) {
      throw new Error("zip crc mismatch");
    }
    out[entry.name] = copy;
  }
  return out;
}

/**
 * Decodes text entries from a Base64 PKZIP archive (supports Store method 0,
 * skips compressed binary entries like `auradesk.db` when Stored JSON entries
 * such as `bundle.json` exist, and supports legacy browser JSON archives).
 */
export function decodeZipTextEntries(zipBase64: string): Record<string, string> {
  const bytes = base64ToBytes(zipBase64);
  if (!isPkzipPrefix(bytes)) {
    const legacy = tryLegacyJsonBackup(bytes);
    if (legacy) return legacy;
  }
  const parsedEntries = parseCentralDirectory(bytes);
  const decoder = new TextDecoder();
  const out: Record<string, string> = {};
  let skippedDeflated = 0;

  for (const entry of parsedEntries) {
    if (entry.method === METHOD_STORE) {
      if (entry.compressedSlice.length !== entry.uncompressedSize) {
        throw new Error("invalid zip entry length");
      }
      const copy = new Uint8Array(entry.compressedSlice);
      if (crc32(copy) !== entry.expectedCrc) {
        throw new Error("zip crc mismatch");
      }
      out[entry.name] = decoder.decode(copy);
    } else if (entry.method === METHOD_DEFLATE) {
      skippedDeflated += 1;
    } else {
      throw new Error("unsupported zip compression method");
    }
  }

  if (Object.keys(out).length === 0 && skippedDeflated > 0) {
    throw new Error("unsupported zip compression method");
  }
  return out;
}

/**
 * Async variant supporting both Store (method 0) and Deflate (method 8) ZIP
 * archives created by desktop exports, plus legacy browser JSON archives.
 */
export async function decodeZipTextEntriesAsync(
  zipBase64: string
): Promise<Record<string, string>> {
  const bytes = base64ToBytes(zipBase64);
  if (!isPkzipPrefix(bytes)) {
    const legacy = tryLegacyJsonBackup(bytes);
    if (legacy) return legacy;
  }
  const parsedEntries = parseCentralDirectory(bytes);
  const decoder = new TextDecoder();
  const out: Record<string, string> = {};
  for (const entry of parsedEntries) {
    if (entry.method === METHOD_STORE) {
      if (crc32(entry.compressedSlice) !== entry.expectedCrc) {
        throw new Error("zip crc mismatch");
      }
      out[entry.name] = decoder.decode(entry.compressedSlice);
    } else if (entry.method === METHOD_DEFLATE) {
      if (!entry.name.endsWith(".json")) {
        // Binary entries (e.g. auradesk.db) are ignored by browser JSON restore.
        continue;
      }
      const inflated = await inflateRaw(entry.compressedSlice);
      if (crc32(inflated) !== entry.expectedCrc) {
        throw new Error("zip crc mismatch");
      }
      out[entry.name] = decoder.decode(inflated);
    } else {
      throw new Error("unsupported zip compression method");
    }
  }
  return out;
}
