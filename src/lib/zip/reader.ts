/**
 * Pure TypeScript ZIP reader (Store method 0 + Deflate method 8 via DecompressionStream('deflate-raw')).
 * Enforces strict Zip-Slip, symlink, Zip64, encryption, CRC-32, binary, and size/count limits.
 */

import { crc32 } from './crc32';
import { validateFilePath } from '@/lib/files';

export const MAX_ZIP_READ_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_ZIP_READ_ENTRIES = 500;
export const MAX_ZIP_READ_FILE_BYTES = 1024 * 1024; // 1 MB

export interface ParsedZipFile {
  path: string;
  content: string;
  size: number;
}

export interface ZipReadResult {
  files: ParsedZipFile[];
  skippedBinaryFiles: string[];
  warnings: string[];
  totalBytes: number;
}

export interface ZipReadOptions {
  maxTotalBytes?: number;
  maxEntries?: number;
  maxSingleFileBytes?: number;
  maxCentralDirEntries?: number;
}

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });
const latin1Decoder = new TextDecoder('latin1');

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function isIgnoredZipPath(path: string): boolean {
  if (path === '.DS_Store' || path.endsWith('/.DS_Store')) return true;
  if (path.startsWith('__MACOSX/')) return true;
  if (path === '.git' || path.startsWith('.git/') || path.includes('/.git/')) return true;
  if (path === 'node_modules' || path.startsWith('node_modules/') || path.includes('/node_modules/')) {
    return true;
  }
  return false;
}

/**
 * Checks raw path strictly against Zip-Slip traversal, backslashes, leading slashes,
 * drive letters, and NUL bytes before normalizing directory trailing slashes.
 */
function assertSafeRawZipPath(rawName: string): { isDirectory: boolean; cleanPath: string } {
  if (!rawName || rawName.includes('\0')) {
    throw new Error('ZIP archive contains an empty or malformed entry path.');
  }
  if (rawName.includes('\\')) {
    throw new Error(`Unsafe ZIP entry path (backslash not allowed): "${rawName}"`);
  }
  if (rawName.startsWith('/')) {
    throw new Error(`Unsafe ZIP entry path (absolute path not allowed): "${rawName}"`);
  }
  if (/^[A-Za-z]:/.test(rawName)) {
    throw new Error(`Unsafe ZIP entry path (drive letter not allowed): "${rawName}"`);
  }

  const isDirectory = rawName.endsWith('/');
  const cleanPath = isDirectory ? rawName.replace(/\/+$/, '') : rawName;
  const segments = cleanPath.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error(`Unsafe ZIP entry path (parent directory traversal ".."): "${rawName}"`);
    }
    if (seg === '.') {
      throw new Error(`Unsafe ZIP entry path (dot segment "."): "${rawName}"`);
    }
    if (!seg && cleanPath.length > 0) {
      throw new Error(`Unsafe ZIP entry path (empty segment): "${rawName}"`);
    }
  }

  return { isDirectory, cleanPath };
}

function isUnixSymlink(versionMadeBy: number, externalAttrs: number): boolean {
  const creatorOs = (versionMadeBy >>> 8) & 0xff;
  // 3 = Unix, 19 = macOS (Darwin)
  if (creatorOs === 3 || creatorOs === 19) {
    const mode = (externalAttrs >>> 16) & 0o170000;
    if (mode === 0o120000) {
      return true;
    }
  }
  return false;
}

function isBinaryContent(bytes: Uint8Array): { binary: boolean; text?: string } {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      return { binary: true };
    }
  }
  try {
    const text = strictUtf8Decoder.decode(bytes);
    return { binary: false, text };
  } catch {
    return { binary: true };
  }
}

async function inflateDeflateRawWithLimit(
  compressed: Uint8Array,
  maxBytes: number,
  entryPath: string
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'This browser cannot read deflated ZIP archives (DecompressionStream is unsupported). Please re-export using Store mode or a modern browser.'
    );
  }

  let decompressor: DecompressionStream;
  try {
    decompressor = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error(
      'This browser does not support "deflate-raw" decompression needed for compressed ZIP entries.'
    );
  }

  const writer = decompressor.writable.getWriter();
  const reader = decompressor.readable.getReader();

  const writePromise = (async () => {
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    await writer.write(copy);
    await writer.close();
  })();

  const chunks: Uint8Array[] = [];
  let totalRead = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        totalRead += value.byteLength;
        if (totalRead > maxBytes) {
          await reader.cancel('Size limit exceeded').catch(() => {});
          throw new Error(
            `ZIP entry "${entryPath}" exceeds maximum allowed file size (${Math.round(
              maxBytes / 1024
            )} KB).`
          );
        }
        chunks.push(value);
      }
    }
    await writePromise;
  } catch (err) {
    await writer.abort().catch(() => {});
    if (err instanceof Error && err.message.includes('exceeds maximum')) {
      throw err;
    }
    throw new Error(
      `Failed to decompress ZIP entry "${entryPath}": ${
        err instanceof Error ? err.message : 'Corrupt deflate stream'
      }`
    );
  }

  const result = new Uint8Array(totalRead);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return result;
}

/**
 * Finds the End of Central Directory (EOCD) offset in ZIP bytes.
 */
function findEocdOffset(bytes: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === bytes.byteLength) {
        return i;
      }
    }
  }
  throw new Error('Invalid or corrupted ZIP archive (End of Central Directory not found).');
}

/**
 * Reads and validates all entries from a ZIP buffer.
 */
export async function readZipEntries(
  input: ArrayBuffer | Uint8Array,
  options: ZipReadOptions = {}
): Promise<ZipReadResult> {
  const maxTotalBytes = options.maxTotalBytes ?? MAX_ZIP_READ_TOTAL_BYTES;
  const maxEntries = options.maxEntries ?? MAX_ZIP_READ_ENTRIES;
  const maxSingleFileBytes = options.maxSingleFileBytes ?? MAX_ZIP_READ_FILE_BYTES;
  const maxCdEntries = options.maxCentralDirEntries ?? Math.max(maxEntries * 4, 2500);

  const bytes = toUint8Array(input);
  if (bytes.byteLength < 22) {
    throw new Error('File is too small to be a valid ZIP archive.');
  }
  if (bytes.byteLength > maxTotalBytes) {
    throw new Error(
      `ZIP archive (${Math.round(bytes.byteLength / (1024 * 1024))} MB) exceeds the ${Math.round(
        maxTotalBytes / (1024 * 1024)
      )} MB safety limit.`
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(bytes, view);

  // Reject ZIP64 Locator immediately before EOCD if present
  if (eocdOffset >= 20 && view.getUint32(eocdOffset - 20, true) === 0x07064b50) {
    throw new Error('Zip64 archives are not supported.');
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const cdStartDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (
    diskNumber === 0xffff ||
    cdStartDisk === 0xffff ||
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new Error('Zip64 archives are not supported.');
  }

  if (diskNumber !== cdStartDisk || entriesOnDisk !== totalEntries) {
    throw new Error('Multi-disk spanned ZIP archives are not supported.');
  }

  if (totalEntries > maxCdEntries) {
    throw new Error(`ZIP archive has too many entries (${totalEntries} > ${maxCdEntries} limit).`);
  }

  if (cdOffset + cdSize > eocdOffset) {
    throw new Error('Corrupted ZIP archive (Central Directory extends past EOCD).');
  }

  const files: ParsedZipFile[] = [];
  const skippedBinaryFiles: string[] = [];
  const warnings: string[] = [];
  const seenPaths = new Set<string>();

  let totalUncompressedBytes = 0;
  let cdCursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cdCursor + 46 > eocdOffset) {
      throw new Error('Corrupted ZIP archive (truncated Central Directory header).');
    }
    const sig = view.getUint32(cdCursor, true);
    if (sig !== 0x02014b50) {
      throw new Error('Corrupted ZIP archive (unexpected Central Directory signature).');
    }

    const versionMadeBy = view.getUint16(cdCursor + 4, true);
    const flags = view.getUint16(cdCursor + 8, true);
    const compressionMethod = view.getUint16(cdCursor + 10, true);
    const expectedCrc = view.getUint32(cdCursor + 16, true);
    const compressedSize = view.getUint32(cdCursor + 20, true);
    const uncompressedSize = view.getUint32(cdCursor + 24, true);
    const nameLen = view.getUint16(cdCursor + 28, true);
    const extraLen = view.getUint16(cdCursor + 30, true);
    const commentLen = view.getUint16(cdCursor + 32, true);
    const externalAttrs = view.getUint32(cdCursor + 38, true);
    const localHeaderOffset = view.getUint32(cdCursor + 42, true);

    const headerEnd = cdCursor + 46 + nameLen + extraLen + commentLen;
    if (headerEnd > eocdOffset) {
      throw new Error('Corrupted ZIP archive (Central Directory entry overflows archive bounds).');
    }

    const nameBytes = bytes.subarray(cdCursor + 46, cdCursor + 46 + nameLen);
    const isUtf8 = (flags & 0x0800) !== 0;
    let rawName: string;
    if (isUtf8) {
      try {
        rawName = strictUtf8Decoder.decode(nameBytes);
      } catch {
        rawName = latin1Decoder.decode(nameBytes);
      }
    } else {
      // Try UTF-8 first cleanly, fall back to Latin-1 if invalid
      try {
        rawName = strictUtf8Decoder.decode(nameBytes);
      } catch {
        rawName = latin1Decoder.decode(nameBytes);
      }
    }

    cdCursor = headerEnd;

    // 1. Security checks (encryption, symlink, traversal/unsafe paths) BEFORE skipping ignored entries
    if ((flags & 0x0001) !== 0) {
      throw new Error('Encrypted ZIP archives are not supported.');
    }

    if (isUnixSymlink(versionMadeBy, externalAttrs)) {
      throw new Error(
        `ZIP archive rejected for security: symbolic link "${rawName}" is not allowed.`
      );
    }

    const { isDirectory, cleanPath } = assertSafeRawZipPath(rawName);

    // Ignore explicit directory entries and common OS/bundler noise
    if (isDirectory || !cleanPath) {
      continue;
    }
    if (isIgnoredZipPath(cleanPath)) {
      continue;
    }

    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(
        `Unsupported ZIP compression method (${compressionMethod}) for "${cleanPath}". Only Store and Deflate are supported.`
      );
    }

    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) {
      throw new Error('Zip64 entry sizes are not supported.');
    }

    if (uncompressedSize > maxSingleFileBytes) {
      throw new Error(
        `File "${cleanPath}" (${Math.round(uncompressedSize / 1024)} KB) exceeds the ${Math.round(
          maxSingleFileBytes / 1024
        )} KB per-file limit.`
      );
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > maxTotalBytes) {
      throw new Error(
        `ZIP uncompressed size exceeds the ${Math.round(maxTotalBytes / (1024 * 1024))} MB limit.`
      );
    }

    // Validate POSIX path rules cleanly
    const pathValidation = validateFilePath(cleanPath);
    if (!pathValidation.valid || !pathValidation.normalizedPath) {
      throw new Error(
        `Invalid file path "${cleanPath}": ${pathValidation.error || 'Unsupported characters'}`
      );
    }
    const safePath = pathValidation.normalizedPath;

    if (seenPaths.has(safePath)) {
      warnings.push(`Duplicate archive entry ignored: "${safePath}"`);
      continue;
    }

    if (files.length + skippedBinaryFiles.length >= maxEntries) {
      throw new Error(
        `ZIP archive contains more than ${maxEntries} files (maximum limit reached).`
      );
    }

    // Locate Local File Header and compressed payload
    if (localHeaderOffset + 30 > cdOffset) {
      throw new Error(`Corrupted ZIP local header for "${safePath}".`);
    }
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header signature for "${safePath}".`);
    }

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > cdOffset) {
      throw new Error(`ZIP entry payload truncated for "${safePath}".`);
    }

    const rawPayload = bytes.subarray(dataStart, dataEnd);
    let fileBytes: Uint8Array;

    if (compressionMethod === 0) {
      if (rawPayload.byteLength > maxSingleFileBytes) {
        throw new Error(
          `File "${safePath}" exceeds the ${Math.round(maxSingleFileBytes / 1024)} KB limit.`
        );
      }
      fileBytes = rawPayload;
    } else {
      fileBytes = await inflateDeflateRawWithLimit(rawPayload, maxSingleFileBytes, safePath);
    }

    // Verify true decompressed size against cumulative limit (guards against forged headers)
    if (fileBytes.byteLength !== uncompressedSize) {
      totalUncompressedBytes = totalUncompressedBytes - uncompressedSize + fileBytes.byteLength;
      if (totalUncompressedBytes > maxTotalBytes) {
        throw new Error(
          `ZIP decompressed total exceeds the ${Math.round(maxTotalBytes / (1024 * 1024))} MB limit.`
        );
      }
    }

    const actualCrc = crc32(fileBytes);
    if (actualCrc !== expectedCrc) {
      throw new Error(`Corrupted ZIP entry "${safePath}" (CRC-32 mismatch).`);
    }

    seenPaths.add(safePath);

    // Binary check (NUL byte or invalid strict UTF-8)
    const binaryCheck = isBinaryContent(fileBytes);
    if (binaryCheck.binary || binaryCheck.text === undefined) {
      skippedBinaryFiles.push(safePath);
      continue;
    }

    files.push({
      path: safePath,
      content: binaryCheck.text,
      size: fileBytes.byteLength,
    });
  }

  return {
    files,
    skippedBinaryFiles,
    warnings,
    totalBytes: totalUncompressedBytes,
  };
}
