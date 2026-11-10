import { describe, it, expect } from 'vitest';
import { crc32 } from './crc32';
import { buildZipBytes } from './writer';
import { readZipEntries } from './reader';
import {
  detectEsModules,
  extractCdnDependencies,
  generateProjectReadme,
} from './readme';
import {
  exportProjectToZip,
  importProjectFromZip,
  PROJECT_METADATA_PATH,
} from './projectArchive';
import { createMemoryHistoryAdapter } from '@/lib/history/storage';
import { createSnapshot } from '@/lib/history/snapshots';
import { createSpecFromClassification, MANAGED_DESIGN_FILES } from '@/lib/design/install';
import { generateTokensCss } from '@/lib/design/css/generateTokensCss';
import { generateBaseCss } from '@/lib/design/css/generateBaseCss';
import { generateComponentsCss } from '@/lib/design/css/generateComponentsCss';
import { encodeUtf8 } from '@/lib/history/hash';

interface CustomRawZipEntry {
  rawName: string;
  payload: Uint8Array;
  compressionMethod?: number;
  uncompressedSizeOverride?: number;
  crcOverride?: number;
  flags?: number;
  versionMadeBy?: number;
  externalAttrs?: number;
  addZip64Locator?: boolean;
  eocdTotalEntriesOverride?: number;
}

function buildCustomRawZip(entries: CustomRawZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.rawName);
    const payload = entry.payload;
    const method = entry.compressionMethod ?? 0;
    const uncompressedSize = entry.uncompressedSizeOverride ?? payload.byteLength;
    const compressedSize = payload.byteLength;
    const entryCrc = entry.crcOverride ?? crc32(payload);
    const flags = entry.flags ?? 0x0800;
    const versionMadeBy = entry.versionMadeBy ?? 20;
    const externalAttrs = entry.externalAttrs ?? 0;

    const lfh = new Uint8Array(30 + nameBytes.byteLength + payload.byteLength);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, entryCrc, true);
    lv.setUint32(18, compressedSize, true);
    lv.setUint32(22, uncompressedSize, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);
    lfh.set(payload, 30 + nameBytes.byteLength);
    localParts.push(lfh);

    const cdh = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, versionMadeBy, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, entryCrc, true);
    cv.setUint32(20, compressedSize, true);
    cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, externalAttrs, true);
    cv.setUint32(42, localOffset, true);
    cdh.set(nameBytes, 46);
    cdParts.push(cdh);

    localOffset += lfh.byteLength;
  }

  const cdOffset = localOffset;
  const cdSize = cdParts.reduce((sum, p) => sum + p.byteLength, 0);
  const hasZip64Locator = entries.some((e) => e.addZip64Locator);
  const zip64LocatorBytes = hasZip64Locator ? 20 : 0;
  const totalBytes = cdOffset + cdSize + zip64LocatorBytes + 22;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  for (const part of cdParts) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  if (hasZip64Locator) {
    view.setUint32(pos, 0x07064b50, true);
    pos += 20;
  }

  const eocdCount = entries[0]?.eocdTotalEntriesOverride ?? entries.length;
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, eocdCount, true);
  view.setUint16(pos + 10, eocdCount, true);
  view.setUint32(pos + 12, cdSize, true);
  view.setUint32(pos + 16, cdOffset, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

async function compressDeflateRaw(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const input = encodeUtf8(text);
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  void writer.write(copy).then(() => writer.close());

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

describe('ZIP Writer & Reader', () => {
  it('round-trips Store entries with UTF-8/Bengali filenames, UTF-8 flag bit 11, empty files, and uniform DOS timestamp', async () => {
    const fixedDate = new Date('2026-05-01T14:22:10Z');
    const built = buildZipBytes(
      [
        { path: 'src/বাংলা.js', content: 'export const msg = "হ্যালো বিশ্ব";' },
        { path: 'index.html', content: '<!doctype html><html><body>Hi</body></html>' },
        { path: 'empty.txt', content: '' },
      ],
      { modifiedAt: fixedDate }
    );

    const view = new DataView(built.bytes.buffer, built.bytes.byteOffset, built.bytes.byteLength);
    // Walk EOCD & verify every Central Directory header has bit 11 (0x0800) + matching DOS time/date
    const eocdOffset = built.bytes.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdCount = view.getUint16(eocdOffset + 10, true);
    expect(cdCount).toBe(3);

    const dosTimestamps = new Set<string>();
    let cursor = cdOffset;
    for (let i = 0; i < cdCount; i++) {
      expect(view.getUint32(cursor, true)).toBe(0x02014b50);
      const flags = view.getUint16(cursor + 8, true);
      expect(flags & 0x0800).toBe(0x0800);
      const dosTime = view.getUint16(cursor + 12, true);
      const dosDate = view.getUint16(cursor + 14, true);
      dosTimestamps.add(`${dosDate}:${dosTime}`);
      const nameLen = view.getUint16(cursor + 28, true);
      cursor += 46 + nameLen;
    }
    expect(dosTimestamps.size).toBe(1);

    const read = await readZipEntries(built.bytes);
    expect(read.skippedBinaryFiles).toHaveLength(0);
    expect(read.files.map((f) => f.path)).toEqual(['empty.txt', 'index.html', 'src/বাংলা.js']);
    expect(read.files.find((f) => f.path === 'src/বাংলা.js')?.content).toBe(
      'export const msg = "হ্যালো বিশ্ব";'
    );
    expect(read.files.find((f) => f.path === 'empty.txt')?.content).toBe('');
  });

  it('decompresses Deflate (method 8) ZIP entries using DecompressionStream', async () => {
    const sourceText = 'export function greet(name) { return `Hello, ${name}!`; }\n'.repeat(25);
    const rawBytes = encodeUtf8(sourceText);
    const deflated = await compressDeflateRaw(sourceText);

    const archive = buildCustomRawZip([
      {
        rawName: 'js/greet.js',
        payload: deflated,
        compressionMethod: 8,
        uncompressedSizeOverride: rawBytes.byteLength,
        crcOverride: crc32(rawBytes),
      },
    ]);

    const parsed = await readZipEntries(archive);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('js/greet.js');
    expect(parsed.files[0].content).toBe(sourceText);
  });

  it('rejects corrupted CRC-32 checksums cleanly', async () => {
    const built = buildZipBytes([{ path: 'app.js', content: 'console.log("ok");' }]);
    const corrupted = new Uint8Array(built.bytes);
    // Flip a byte inside the local file data (30 + 'app.js'.length = 36)
    corrupted[37] ^= 0xff;

    await expect(readZipEntries(corrupted)).rejects.toThrow(/CRC-32 mismatch/i);
  });

  it('rejects Zip-Slip traversal, backslashes, absolute paths, and drive letters in both writer and reader', async () => {
    expect(() => buildZipBytes([{ path: '../secret.txt', content: 'x' }])).toThrow();
    expect(() => buildZipBytes([{ path: 'sub\\file.txt', content: 'x' }])).toThrow();
    expect(() => buildZipBytes([{ path: 'C:file.txt', content: 'x' }])).toThrow();

    const unsafeRawNames = ['../escape.txt', '/etc/passwd', 'sub\\win.js', 'C:\\boot.ini'];
    for (const badPath of unsafeRawNames) {
      const badZip = buildCustomRawZip([
        { rawName: badPath, payload: encodeUtf8('bad') },
      ]);
      await expect(readZipEntries(badZip)).rejects.toThrow(/Unsafe ZIP entry path/i);
    }
  });

  it('rejects Unix symlinks, encrypted archives, Zip64 archives, oversized files, and >500 entries', async () => {
    // 1. Unix symlink (creator OS 3, st_mode 0120777)
    const symlinkZip = buildCustomRawZip([
      {
        rawName: 'link.txt',
        payload: encodeUtf8('/etc/passwd'),
        versionMadeBy: (3 << 8) | 20,
        externalAttrs: (0o120777 << 16) >>> 0,
      },
    ]);
    await expect(readZipEntries(symlinkZip)).rejects.toThrow(/symbolic link/i);

    // 2. Encrypted entry flag bit 0
    const encryptedZip = buildCustomRawZip([
      {
        rawName: 'secret.txt',
        payload: encodeUtf8('encrypted'),
        flags: 0x0801,
      },
    ]);
    await expect(readZipEntries(encryptedZip)).rejects.toThrow(/Encrypted ZIP archives/i);

    // 3. Zip64 locator / 0xffff entry count marker
    const zip64ByLocator = buildCustomRawZip([
      {
        rawName: 'index.html',
        payload: encodeUtf8('<h1>hi</h1>'),
        addZip64Locator: true,
      },
    ]);
    await expect(readZipEntries(zip64ByLocator)).rejects.toThrow(/Zip64/i);

    const zip64ByMarker = buildCustomRawZip([
      {
        rawName: 'index.html',
        payload: encodeUtf8('<h1>hi</h1>'),
        eocdTotalEntriesOverride: 0xffff,
      },
    ]);
    await expect(readZipEntries(zip64ByMarker)).rejects.toThrow(/Zip64/i);

    // 4. Declared single file > 1 MB rejected before inflating
    const bigFileZip = buildCustomRawZip([
      {
        rawName: 'huge.js',
        payload: encodeUtf8('x'),
        uncompressedSizeOverride: 1025 * 1024,
      },
    ]);
    await expect(readZipEntries(bigFileZip)).rejects.toThrow(/per-file limit/i);

    // 5. > 50 MB cumulative decompressed limit (zip-bomb protection)
    const almostOneMbText = 'a'.repeat(1000 * 1024);
    const compressedNearlyOneMb = await compressDeflateRaw(almostOneMbText);
    const nearlyOneMbCrc = crc32(encodeUtf8(almostOneMbText));
    const manyNearlyOneMb: CustomRawZipEntry[] = Array.from({ length: 53 }, (_, idx) => ({
      rawName: `chunk_${idx}.txt`,
      payload: compressedNearlyOneMb,
      compressionMethod: 8,
      uncompressedSizeOverride: almostOneMbText.length,
      crcOverride: nearlyOneMbCrc,
    }));
    const over50MbZip = buildCustomRawZip(manyNearlyOneMb);
    await expect(readZipEntries(over50MbZip)).rejects.toThrow(/50 MB limit/i);

    // 6. > 500 entries rejected
    const over500Entries = Array.from({ length: 505 }, (_, i) => ({
      path: `f/file_${i}.txt`,
      content: 'a',
    }));
    const over500Zip = buildZipBytes(over500Entries);
    await expect(readZipEntries(over500Zip.bytes)).rejects.toThrow(/more than 500 files/i);
  });

  it('skips OS noise directories (.DS_Store, __MACOSX, node_modules, .git) and reports skipped binary files', async () => {
    const zip = buildCustomRawZip([
      { rawName: '.DS_Store', payload: new Uint8Array([1, 2, 3]) },
      { rawName: '__MACOSX/._index.html', payload: new Uint8Array([0, 1, 2]) },
      { rawName: 'node_modules/lodash/index.js', payload: encodeUtf8('module.exports = {}') },
      { rawName: '.git/HEAD', payload: encodeUtf8('ref: refs/heads/main') },
      {
        rawName: 'assets/logo.png',
        payload: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      },
      {
        rawName: 'assets/bad-utf8.dat',
        payload: new Uint8Array([0xff, 0xfe, 0xfd, 0x80]),
      },
      { rawName: 'index.html', payload: encodeUtf8('<!doctype html><title>Clean</title>') },
    ]);

    const res = await readZipEntries(zip);
    expect(res.files.map((f) => f.path)).toEqual(['index.html']);
    expect(res.skippedBinaryFiles.sort()).toEqual(['assets/bad-utf8.dat', 'assets/logo.png']);
  });
});

describe('README Generator & Project Export/Import', () => {
  it('detects ES modules, extracts CDN links, and formats local HTTP server note', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
          <script type="module" src="js/main.js"></script>
        </head><body></body></html>`,
      },
      {
        path: 'css/extra.css',
        content: `@import url("https://cdn.jsdelivr.net/npm/normalize.css/normalize.css");`,
      },
      {
        path: 'js/main.js',
        content: `import { init } from './ui.js'; init();`,
      },
      {
        path: '.desyra/project.json',
        content: `{"title":"Secret"}`,
      },
    ];

    expect(detectEsModules(files)).toBe(true);
    expect(extractCdnDependencies(files)).toEqual([
      'https://cdn.jsdelivr.net/npm/normalize.css/normalize.css',
      'https://fonts.googleapis.com/css2?family=Inter',
    ]);

    const readme = generateProjectReadme({ title: 'Analytics Pro', idea: 'Track metrics' }, files);
    expect(readme).toContain('# Analytics Pro');
    expect(readme).toContain('type="module"');
    expect(readme).toContain('npx serve .');
    expect(readme).toContain('python3 -m http.server');
    expect(readme).toContain('https://fonts.googleapis.com/css2?family=Inter');
    expect(readme).not.toContain('.desyra/project.json');
  });

  it('exports specific snapshots without overwriting existing README and excludes secrets/chat/previewStorage', async () => {
    const mem = createMemoryHistoryAdapter();
    const spec = createSpecFromClassification('Fitness tracker dashboard');

    await mem.addProject({
      id: 'proj_1',
      title: 'Fit Pulse App',
      idea: 'Track daily runs',
      createdAt: 1000,
      updatedAt: 2000,
      autoStarted: true,
      design: spec,
    });

    await mem.bulkPutFiles([
      { id: 'f1', projectId: 'proj_1', path: 'index.html', content: '<h1>V1</h1>', createdAt: 1000, updatedAt: 1000 },
    ]);
    const snapV1 = await createSnapshot('proj_1', { label: 'V1 build', kind: 'ai' }, mem);
    expect(snapV1).not.toBeNull();

    // Update live project to V2 + insert private storage + chat message with API-key lookalike
    await mem.putFile({
      id: 'f1',
      projectId: 'proj_1',
      path: 'index.html',
      content: '<h1>V2 LIVE</h1>',
      createdAt: 1000,
      updatedAt: 2000,
    });
    await mem.bulkPutMessages([
      {
        id: 'm1',
        projectId: 'proj_1',
        role: 'user',
        content: 'SECRET_CHAT_PHRASE_NEVER_EXPORT',
        createdAt: 1500,
      },
    ]);
    mem.state.previewStorage.set('proj_1:token', {
      projectId: 'proj_1',
      key: 'token',
      value: 'PREVIEW_STORAGE_SECRET_XYZ',
    });

    // Export historical V1 snapshot
    const zipV1 = await exportProjectToZip({ projectId: 'proj_1', snapshotId: snapV1!.id }, mem);
    const parsedV1 = await readZipEntries(zipV1.bytes);
    const pathsV1 = parsedV1.files.map((f) => f.path);

    expect(pathsV1).toContain('index.html');
    expect(pathsV1).toContain('README.md');
    expect(pathsV1).toContain(PROJECT_METADATA_PATH);
    expect(parsedV1.files.find((f) => f.path === 'index.html')?.content).toBe('<h1>V1</h1>');

    // Verify zero leaks
    const joined = parsedV1.files.map((f) => f.content).join('\n');
    expect(joined).not.toContain('SECRET_CHAT_PHRASE_NEVER_EXPORT');
    expect(joined).not.toContain('PREVIEW_STORAGE_SECRET_XYZ');

    // Existing user README is preserved instead of overwritten
    await mem.putFile({
      id: 'f2',
      projectId: 'proj_1',
      path: 'README.md',
      content: '# Custom Author README\nKeep me intact.',
      createdAt: 2100,
      updatedAt: 2100,
    });
    const zipLive = await exportProjectToZip({ projectId: 'proj_1' }, mem);
    const parsedLive = await readZipEntries(zipLive.bytes);
    expect(parsedLive.files.find((f) => f.path === 'README.md')?.content).toBe(
      '# Custom Author README\nKeep me intact.'
    );
  });

  it('imports plain ZIPs without forcing DesignSpec, and regenerates missing managed CSS when .desyra/project.json declares a design spec', async () => {
    const mem = createMemoryHistoryAdapter();

    // 1. Plain third-party ZIP (no .desyra/project.json)
    const plainZip = buildCustomRawZip([
      { rawName: 'index.html', payload: encodeUtf8('<h1>Plain HTML</h1>') },
      { rawName: 'logo.png', payload: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]) },
    ]);
    const plainRes = await importProjectFromZip(plainZip, 'my-plain-site.zip', mem);
    expect(plainRes.project.title).toBe('my plain site');
    expect(plainRes.project.autoStarted).toBe(true);
    expect(plainRes.project.design).toBeUndefined();
    expect(plainRes.importedFileCount).toBe(1);
    expect(plainRes.skippedBinaryFiles).toEqual(['logo.png']);
    expect(plainRes.regeneratedManagedFiles).toEqual([]);

    const snapsPlain = await mem.listProjectSnapshots(plainRes.project.id);
    expect(snapsPlain).toHaveLength(1);
    expect(snapsPlain[0].kind).toBe('import');

    // 2. DESYRA ZIP with design spec inside .desyra/project.json, missing css/components.css
    const spec = createSpecFromClassification('Coffee roastery store');
    const desyraPartialZip = buildZipBytes([
      { path: 'index.html', content: '<!doctype html><html><body>Coffee</body></html>' },
      { path: 'css/tokens.css', content: generateTokensCss(spec) },
      { path: 'css/base.css', content: generateBaseCss(spec) },
      // Notice css/components.css is intentionally omitted
      {
        path: PROJECT_METADATA_PATH,
        content: JSON.stringify({
          formatVersion: 1,
          title: 'Roast House',
          idea: 'Coffee shop website',
          createdAt: 1000,
          updatedAt: 2000,
          design: spec,
        }),
      },
    ]);

    const desyraRes = await importProjectFromZip(desyraPartialZip.bytes, 'backup.zip', mem);
    expect(desyraRes.project.title).toBe('Roast House');
    expect(desyraRes.project.design).toBeDefined();
    expect(desyraRes.regeneratedManagedFiles).toEqual(['css/components.css']);

    const importedFiles = await mem.listProjectFiles(desyraRes.project.id);
    for (const managed of MANAGED_DESIGN_FILES) {
      expect(importedFiles.some((f) => f.path === managed)).toBe(true);
    }
    expect(importedFiles.find((f) => f.path === 'css/components.css')?.content).toBe(
      generateComponentsCss(spec)
    );
  });
});
