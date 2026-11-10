/**
 * Content-addressed hashing utilities for DESYRA version history.
 * Uses Web Crypto SHA-256 when available, with a deterministic 64-bit fallback.
 */

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/**
 * Encodes a UTF-8 string into bytes.
 */
export function encodeUtf8(content: string): Uint8Array {
  if (textEncoder) {
    return textEncoder.encode(content);
  }
  // Safe pure-JS fallback
  const utf8: number[] = [];
  for (let i = 0; i < content.length; i++) {
    let charcode = content.charCodeAt(i);
    if (charcode < 0x80) {
      utf8.push(charcode);
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (content.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

/**
 * Computes exact UTF-8 byte length for a string.
 */
export function computeUtf8ByteLength(content: string): number {
  return encodeUtf8(content).byteLength;
}

/**
 * Synchronous deterministic 64-bit dual-FNV-1a fallback hash + byte length.
 */
export function computeFallbackHash64(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= b ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `fnv64_${part1}${part2}_${bytes.byteLength}`;
}

/**
 * Computes SHA-256 hex digest via crypto.subtle, falling back cleanly if unavailable.
 */
export async function computeContentHash(content: string): Promise<string> {
  const bytes = encodeUtf8(content);
  const subtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined;

  if (subtle && typeof subtle.digest === 'function') {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await subtle.digest('SHA-256', copy.buffer);
      const view = new Uint8Array(digest);
      let hex = '';
      for (let i = 0; i < view.length; i++) {
        hex += view[i].toString(16).padStart(2, '0');
      }
      return hex;
    } catch {
      // Fallback cleanly in restricted/non-secure contexts
    }
  }

  return computeFallbackHash64(bytes);
}
