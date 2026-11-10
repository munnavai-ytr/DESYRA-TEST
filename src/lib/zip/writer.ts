/**
 * Pure TypeScript ZIP writer (Store method 0, CRC-32, UTF-8 filename flag,
 * Central Directory + EOCD, single fixed DOS timestamp across all entries).
 */

import { crc32 } from './crc32';
import { encodeUtf8 } from '@/lib/history/hash';

export const MAX_ZIP_EXPORT_WARN_BYTES = 50 * 1024 * 1024; // 50 MB

export interface ZipWriteEntry {
  path: string;
  content: string | Uint8Array;
}

export interface ZipBuildOptions {
  modifiedAt?: Date;
}

export interface ZipBuildResult {
  bytes: Uint8Array;
  fileCount: number;
  totalUncompressedBytes: number;
  exceeds50Mb: boolean;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function normalizeZipEntryPath(rawPath: string): string {
  const cleaned = rawPath.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned || cleaned.includes('\\') || cleaned.includes('\0')) {
    throw new Error(`Invalid ZIP entry path: "${rawPath}"`);
  }
  const segments = cleaned.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new Error(`Unsafe ZIP entry path segment in "${rawPath}"`);
    }
  }
  if (/^[A-Za-z]:/.test(cleaned)) {
    throw new Error(`Drive letter not allowed in ZIP entry path: "${rawPath}"`);
  }
  return cleaned;
}

/**
 * Writes valid PKWARE ZIP bytes with UTF-8 flag (bit 11 = 0x0800) and Store compression (0).
 * Empty folders are omitted cleanly.
 */
export function buildZipBytes(
  entries: ZipWriteEntry[],
  options: ZipBuildOptions = {}
): ZipBuildResult {
  const modifiedAt = options.modifiedAt ?? new Date();
  const { dosTime, dosDate } = toDosDateTime(modifiedAt);

  // Normalize, deduplicate by path (last entry wins cleanly), and sort stably
  const uniqueMap = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const normalizedPath = normalizeZipEntryPath(entry.path);
    const dataBytes =
      typeof entry.content === 'string' ? encodeUtf8(entry.content) : entry.content;
    uniqueMap.set(normalizedPath, dataBytes);
  }

  const sortedPaths = Array.from(uniqueMap.keys()).sort((a, b) => a.localeCompare(b));
  if (sortedPaths.length > 0xffff) {
    throw new Error('Too many entries for standard ZIP format (max 65,535).');
  }

  interface PreparedEntry {
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }

  const prepared: PreparedEntry[] = [];
  let totalDataBytes = 0;
  let totalLocalSize = 0;
  let totalCentralDirSize = 0;

  for (const path of sortedPaths) {
    const nameBytes = encodeUtf8(path);
    const dataBytes = uniqueMap.get(path)!;
    const entryCrc = crc32(dataBytes);
    const localHeaderOffset = totalLocalSize;

    prepared.push({
      nameBytes,
      dataBytes,
      crc: entryCrc,
      localHeaderOffset,
    });

    totalDataBytes += dataBytes.byteLength;
    totalLocalSize += 30 + nameBytes.byteLength + dataBytes.byteLength;
    totalCentralDirSize += 46 + nameBytes.byteLength;
  }

  const eocdSize = 22;
  const totalArchiveSize = totalLocalSize + totalCentralDirSize + eocdSize;
  const output = new Uint8Array(totalArchiveSize);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  let offset = 0;

  // 1. Local File Headers + File Data (Store method 0)
  for (const item of prepared) {
    const size = item.dataBytes.byteLength;
    const nameLen = item.nameBytes.byteLength;

    view.setUint32(offset, 0x04034b50, true); // Local file header signature
    view.setUint16(offset + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(offset + 6, 0x0800, true); // Bit 11: UTF-8 filename encoding
    view.setUint16(offset + 8, 0, true); // Compression method: 0 (Store)
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, item.crc, true);
    view.setUint32(offset + 18, size, true); // Compressed size
    view.setUint32(offset + 22, size, true); // Uncompressed size
    view.setUint16(offset + 26, nameLen, true);
    view.setUint16(offset + 28, 0, true); // Extra field length
    output.set(item.nameBytes, offset + 30);
    output.set(item.dataBytes, offset + 30 + nameLen);

    offset += 30 + nameLen + size;
  }

  const centralDirOffset = offset;

  // 2. Central Directory File Headers
  for (const item of prepared) {
    const size = item.dataBytes.byteLength;
    const nameLen = item.nameBytes.byteLength;

    view.setUint32(offset, 0x02014b50, true); // Central directory header signature
    view.setUint16(offset + 4, 20, true); // Version made by
    view.setUint16(offset + 6, 20, true); // Version needed to extract
    view.setUint16(offset + 8, 0x0800, true); // Bit 11: UTF-8 filename encoding
    view.setUint16(offset + 10, 0, true); // Compression method: 0 (Store)
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, item.crc, true);
    view.setUint32(offset + 20, size, true);
    view.setUint32(offset + 24, size, true);
    view.setUint16(offset + 28, nameLen, true);
    view.setUint16(offset + 30, 0, true); // Extra field length
    view.setUint16(offset + 32, 0, true); // File comment length
    view.setUint16(offset + 34, 0, true); // Disk number start
    view.setUint16(offset + 36, 0, true); // Internal file attributes
    view.setUint32(offset + 38, 0, true); // External file attributes
    view.setUint32(offset + 42, item.localHeaderOffset, true);
    output.set(item.nameBytes, offset + 46);

    offset += 46 + nameLen;
  }

  // 3. End of Central Directory Record (EOCD)
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true); // Number of this disk
  view.setUint16(offset + 6, 0, true); // Disk where central directory starts
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, totalCentralDirSize, true);
  view.setUint32(offset + 16, centralDirOffset, true);
  view.setUint16(offset + 20, 0, true); // Comment length

  return {
    bytes: output,
    fileCount: prepared.length,
    totalUncompressedBytes: totalDataBytes,
    exceeds50Mb: output.byteLength > MAX_ZIP_EXPORT_WARN_BYTES,
  };
}

export function createZipBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

export function slugifyProjectName(title: string, fallback = 'desyra-project'): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return ascii || fallback;
}

export function formatDateYyyyMmDd(timestamp = Date.now()): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Triggers browser file download and delays URL revocation by 10 seconds for mobile/Safari safety.
 */
export function triggerZipDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore cleanup failures
    }
  }, 10000);
}
