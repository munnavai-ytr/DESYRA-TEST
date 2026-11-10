/**
 * Full multi-project Backup Export & Restore Engine for DESYRA.
 *
 * Security & Privacy guarantees:
 * - Strictly whitelists project, file, design, plan, sanitized message, and snapshot/blob fields.
 * - NEVER exports or reads AI provider records, encrypted keys, passphrases, meta keys, or previewStorage.
 * - Restores always create brand-new project IDs so existing local projects are never overwritten.
 * - Per-project restore runs inside one atomic transaction and yields between projects for Cancel / AbortSignal.
 */

import {
  setLastBackupAt,
  requestPersistentStorageSafe,
  type Project,
  type ProjectFile,
  type StoredMessage,
  type SnapshotRecord,
  type BlobRecord,
} from '@/lib/db';
import type { DesignSpec, ProjectDesignData, ProjectPlan } from '@/lib/design/types';
import {
  extractDesignSpec,
  computeStringHash,
  MANAGED_DESIGN_FILES,
} from '@/lib/design/install';
import { generateTokensCss } from '@/lib/design/css/generateTokensCss';
import { generateBaseCss } from '@/lib/design/css/generateBaseCss';
import { generateComponentsCss } from '@/lib/design/css/generateComponentsCss';
import {
  MAX_FILES_PER_PROJECT,
  MAX_FILE_SIZE_BYTES,
  validateFilePath,
} from '@/lib/files';
import {
  buildZipBytes,
  createZipBlob,
  formatDateYyyyMmDd,
  slugifyProjectName,
  type ZipWriteEntry,
} from '@/lib/zip/writer';
import { readZipEntries } from '@/lib/zip/reader';
import type { DesyraProjectMetadataFile } from '@/lib/zip/projectArchive';
import { computeContentHash, computeUtf8ByteLength } from '@/lib/history/hash';
import {
  createDexieHistoryAdapter,
  cloneData,
  type HistoryStorageAdapter,
} from '@/lib/history/storage';
import {
  buildSafeSnapshotMeta,
  sanitizePlanSummary,
} from '@/lib/history/snapshots';

export const BACKUP_FORMAT_VERSION = 1 as const;
export const DESYRA_APP_VERSION = '0.8.0';
export const MAX_BACKUP_ARCHIVE_BYTES = 200 * 1024 * 1024; // 200 MB raw archive limit

export interface BackupProjectEntry {
  originalId: string;
  folderName: string;
  title: string;
  idea: string;
  createdAt: number;
  updatedAt: number;
  autoStarted?: boolean;
  fileCount: number;
  messageCount?: number;
  snapshotCount?: number;
  design?: DesignSpec | ProjectDesignData;
  plan?: ProjectPlan;
}

export interface BackupManifest {
  formatVersion: 1;
  createdAt: number;
  desyraAppVersion: string;
  includeChatHistory: boolean;
  includeSnapshots: boolean;
  projects: BackupProjectEntry[];
}

export interface BackupProgress {
  phase: 'reading' | 'packaging' | 'restoring';
  current: number;
  total: number;
  currentTitle?: string;
}

export interface ExportBackupOptions {
  includeChatHistory?: boolean;
  includeSnapshots?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: BackupProgress) => void;
}

export interface ExportBackupResult {
  blob: Blob;
  bytes: Uint8Array;
  filename: string;
  projectCount: number;
  fileCount: number;
  messageCount: number;
  snapshotCount: number;
  exceeds50Mb: boolean;
}

export interface ParsedBackupProject {
  entry: BackupProjectEntry;
  files: Array<{ path: string; content: string }>;
  messages: StoredMessage[];
  snapshots: SnapshotRecord[];
  blobs: BlobRecord[];
  regeneratedCssNeeded: boolean;
}

export interface ParsedBackupArchive {
  manifest: BackupManifest;
  projects: ParsedBackupProject[];
  warnings: string[];
  skippedBinaryFiles: string[];
}

export interface RestoreBackupOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BackupProgress) => void;
}

export interface RestoreBackupResult {
  restoredProjects: Project[];
  restoredCount: number;
  warnings: string[];
}

function createAbortError(message = 'Operation was cancelled.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Explicitly whitelists StoredMessage fields so no extraneous/sensitive keys ever leak into backups.
 */
function sanitizeMessageForBackup(msg: StoredMessage, projectIdOverride?: string): StoredMessage {
  return {
    id: String(msg.id),
    projectId: projectIdOverride ?? String(msg.projectId),
    role: msg.role === 'user' || msg.role === 'system' ? msg.role : 'assistant',
    content: typeof msg.content === 'string' ? msg.content : '',
    createdAt: typeof msg.createdAt === 'number' ? msg.createdAt : Date.now(),
    ...(msg.kind ? { kind: msg.kind } : {}),
    ...(typeof msg.model === 'string' ? { model: msg.model } : {}),
    ...(typeof msg.provider === 'string' ? { provider: msg.provider } : {}),
    ...(Array.isArray(msg.undoEntries) ? { undoEntries: cloneData(msg.undoEntries) } : {}),
    ...(typeof msg.undoDisabledReason === 'string'
      ? { undoDisabledReason: msg.undoDisabledReason }
      : {}),
    ...(Array.isArray(msg.incompleteFiles)
      ? { incompleteFiles: [...msg.incompleteFiles] }
      : {}),
    ...(Array.isArray(msg.failedEdits) ? { failedEdits: cloneData(msg.failedEdits) } : {}),
    ...(msg.finishReason ? { finishReason: msg.finishReason } : {}),
    ...(typeof msg.completionTokens === 'number'
      ? { completionTokens: msg.completionTokens }
      : {}),
    ...(typeof msg.maxOutputTokens === 'number'
      ? { maxOutputTokens: msg.maxOutputTokens }
      : {}),
    ...(Array.isArray(msg.completenessIssues)
      ? { completenessIssues: cloneData(msg.completenessIssues) }
      : {}),
    ...(msg.promptKind ? { promptKind: msg.promptKind } : {}),
    ...(typeof msg.designSpecId === 'string' ? { designSpecId: msg.designSpecId } : {}),
    ...(typeof msg.snapshotId === 'string' ? { snapshotId: msg.snapshotId } : {}),
  };
}

function sanitizeSnapshotForBackup(snap: SnapshotRecord): SnapshotRecord {
  const safeManifest: Record<string, string> = {};
  if (snap.manifest && typeof snap.manifest === 'object') {
    for (const [k, v] of Object.entries(snap.manifest)) {
      if (typeof v === 'string') {
        safeManifest[k] = v;
      }
    }
  }
  return {
    id: String(snap.id),
    projectId: String(snap.projectId),
    createdAt: typeof snap.createdAt === 'number' ? snap.createdAt : Date.now(),
    label: typeof snap.label === 'string' ? snap.label.slice(0, 80) : 'Version snapshot',
    kind: snap.kind ?? 'checkpoint',
    ...(typeof snap.messageId === 'string' ? { messageId: snap.messageId } : {}),
    fileCount: Object.keys(safeManifest).length,
    totalBytes: typeof snap.totalBytes === 'number' ? snap.totalBytes : 0,
    manifest: safeManifest,
    meta: buildSafeSnapshotMeta(snap.meta?.design, snap.meta?.plan),
    ...(snap.pinned ? { pinned: true } : {}),
    ...(typeof snap.note === 'string' ? { note: snap.note.slice(0, 300) } : {}),
  };
}

function buildUniqueFolderName(
  title: string,
  id: string,
  usedFolders: Set<string>
): string {
  const slug = slugifyProjectName(title, 'project');
  const shortSuffix = id.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || '1';
  let candidate = `${slug}-${shortSuffix}`;
  let counter = 2;
  while (usedFolders.has(candidate)) {
    candidate = `${slug}-${shortSuffix}-${counter}`;
    counter++;
  }
  usedFolders.add(candidate);
  return candidate;
}

/**
 * Exports all local projects into one structured ZIP archive (`desyra-backup-YYYY-MM-DD.zip`).
 * Never exports API keys, provider configurations, passphrases, or previewStorage data.
 */
export async function exportAllProjectsBackup(
  options: ExportBackupOptions = {},
  storage?: HistoryStorageAdapter
): Promise<ExportBackupResult> {
  const adapter = storage ?? createDexieHistoryAdapter();
  const includeChatHistory = Boolean(options.includeChatHistory);
  const includeSnapshots = Boolean(options.includeSnapshots);
  const { signal, onProgress } = options;

  throwIfAborted(signal);
  const allProjects = await adapter.listProjects();
  allProjects.sort((a, b) => b.updatedAt - a.updatedAt);

  if (allProjects.length === 0) {
    throw new Error('There are no projects in local storage to back up.');
  }

  const usedFolders = new Set<string>();
  const zipEntries: ZipWriteEntry[] = [];
  const manifestProjects: BackupProjectEntry[] = [];

  let totalFileCount = 0;
  let totalMessageCount = 0;
  let totalSnapshotCount = 0;

  for (let i = 0; i < allProjects.length; i++) {
    throwIfAborted(signal);

    const project = allProjects[i];
    onProgress?.({
      phase: 'packaging',
      current: i + 1,
      total: allProjects.length,
      currentTitle: project.title,
    });

    const folderName = buildUniqueFolderName(project.title, project.id, usedFolders);
    const files = await adapter.listProjectFiles(project.id);

    for (const file of files) {
      if (file.path.startsWith('.desyra/')) continue;
      zipEntries.push({
        path: `${folderName}/files/${file.path}`,
        content: file.content,
      });
      totalFileCount++;
    }

    const sanitizedPlanSummary = sanitizePlanSummary(project.plan);
    const projectMetaFile: DesyraProjectMetadataFile = {
      formatVersion: 1,
      title: project.title,
      idea: project.idea,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ...(project.design ? { design: cloneData(project.design) } : {}),
      ...(sanitizedPlanSummary ? { plan: sanitizedPlanSummary } : {}),
    };
    zipEntries.push({
      path: `${folderName}/.desyra/project.json`,
      content: JSON.stringify(projectMetaFile, null, 2),
    });

    let exportedMessageCount: number | undefined;
    if (includeChatHistory) {
      const rawMessages = await adapter.listProjectMessages(project.id);
      const safeMessages = rawMessages.map((m) => sanitizeMessageForBackup(m));
      exportedMessageCount = safeMessages.length;
      totalMessageCount += safeMessages.length;
      zipEntries.push({
        path: `${folderName}/.desyra/messages.json`,
        content: JSON.stringify(safeMessages),
      });
    }

    let exportedSnapshotCount: number | undefined;
    if (includeSnapshots) {
      const rawSnaps = await adapter.listProjectSnapshots(project.id);
      const safeSnaps = rawSnaps.map((s) => sanitizeSnapshotForBackup(s));
      exportedSnapshotCount = safeSnaps.length;
      totalSnapshotCount += safeSnaps.length;

      const hashSet = new Set<string>();
      for (const snap of safeSnaps) {
        for (const hash of Object.values(snap.manifest)) {
          hashSet.add(hash);
        }
      }
      const blobs = await adapter.getBlobs(Array.from(hashSet));
      const safeBlobs: BlobRecord[] = blobs.map((b) => ({
        hash: b.hash,
        content: b.content,
        size: b.size,
      }));

      zipEntries.push({
        path: `${folderName}/.desyra/snapshots.json`,
        content: JSON.stringify(safeSnaps),
      });
      zipEntries.push({
        path: `${folderName}/.desyra/blobs.json`,
        content: JSON.stringify(safeBlobs),
      });
    }

    manifestProjects.push({
      originalId: project.id,
      folderName,
      title: project.title,
      idea: project.idea,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      autoStarted: Boolean(project.autoStarted || files.length > 0),
      fileCount: files.length,
      ...(exportedMessageCount !== undefined ? { messageCount: exportedMessageCount } : {}),
      ...(exportedSnapshotCount !== undefined ? { snapshotCount: exportedSnapshotCount } : {}),
      ...(project.design ? { design: cloneData(project.design) } : {}),
      ...(project.plan ? { plan: cloneData(project.plan) } : {}),
    });

    if (i < allProjects.length - 1) {
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  const now = Date.now();
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now,
    desyraAppVersion: DESYRA_APP_VERSION,
    includeChatHistory,
    includeSnapshots,
    projects: manifestProjects,
  };

  zipEntries.push({
    path: 'backup.json',
    content: JSON.stringify(manifest, null, 2),
  });

  throwIfAborted(signal);
  const built = buildZipBytes(zipEntries, { modifiedAt: new Date(now) });
  throwIfAborted(signal);

  const blob = createZipBlob(built.bytes);
  const filename = `desyra-backup-${formatDateYyyyMmDd(now)}.zip`;

  if (typeof window !== 'undefined') {
    await setLastBackupAt(now);
  }

  return {
    blob,
    bytes: built.bytes,
    filename,
    projectCount: manifestProjects.length,
    fileCount: totalFileCount,
    messageCount: totalMessageCount,
    snapshotCount: totalSnapshotCount,
    exceeds50Mb: built.exceeds50Mb,
  };
}

/**
 * Inspects and validates a multi-project backup ZIP archive cleanly before restoring anything.
 * Rejects Zip-Slip, symlinks, encrypted archives, Zip64, corrupt CRC-32, or missing/invalid backup.json.
 */
export async function inspectBackupZip(
  input: ArrayBuffer | Uint8Array
): Promise<ParsedBackupArchive> {
  const byteLength = input instanceof Uint8Array ? input.byteLength : input.byteLength;
  if (byteLength > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new Error(
      `Backup archive (${Math.round(byteLength / (1024 * 1024))} MB) exceeds the 200 MB limit.`
    );
  }

  const parsed = await readZipEntries(input, {
    maxTotalBytes: 250 * 1024 * 1024,
    maxEntries: 20_000,
    maxSingleFileBytes: 25 * 1024 * 1024,
  });

  const entriesByPath = new Map<string, { content: string; size: number }>();
  for (const f of parsed.files) {
    entriesByPath.set(f.path, { content: f.content, size: f.size });
  }

  const rootManifestFile = entriesByPath.get('backup.json');
  if (!rootManifestFile) {
    throw new Error(
      'Invalid DESYRA backup archive: missing "backup.json" at the archive root.'
    );
  }

  let parsedManifestRaw: unknown;
  try {
    parsedManifestRaw = JSON.parse(rootManifestFile.content);
  } catch {
    throw new Error('Corrupted DESYRA backup archive: "backup.json" is not valid JSON.');
  }

  if (!parsedManifestRaw || typeof parsedManifestRaw !== 'object') {
    throw new Error('Invalid DESYRA backup archive: malformed "backup.json" structure.');
  }

  const manifestCandidate = parsedManifestRaw as Partial<BackupManifest>;
  if (manifestCandidate.formatVersion !== 1 || !Array.isArray(manifestCandidate.projects)) {
    throw new Error('Unsupported or incompatible DESYRA backup archive version.');
  }

  const warnings = [...parsed.warnings];
  const parsedProjects: ParsedBackupProject[] = [];

  for (const rawProj of manifestCandidate.projects) {
    if (!rawProj || typeof rawProj !== 'object') continue;
    const entry = rawProj as Partial<BackupProjectEntry>;
    if (!entry.folderName || !entry.title || typeof entry.folderName !== 'string') {
      continue;
    }

    const folderPrefix = `${entry.folderName.replace(/\/+$/, '')}/`;
    const filesPrefix = `${folderPrefix}files/`;
    const projectFiles: Array<{ path: string; content: string }> = [];

    for (const zipEntry of parsed.files) {
      if (!zipEntry.path.startsWith(filesPrefix)) continue;
      const relativePath = zipEntry.path.slice(filesPrefix.length);
      if (!relativePath) continue;

      const validation = validateFilePath(relativePath);
      if (!validation.valid || !validation.normalizedPath) {
        warnings.push(`Skipped invalid file path in "${entry.title}": ${relativePath}`);
        continue;
      }

      if (zipEntry.size > MAX_FILE_SIZE_BYTES) {
        warnings.push(
          `Skipped oversized file "${relativePath}" in "${entry.title}" (${Math.round(
            zipEntry.size / 1024
          )} KB > 1024 KB limit).`
        );
        continue;
      }

      if (projectFiles.length >= MAX_FILES_PER_PROJECT) {
        warnings.push(
          `Truncated "${entry.title}" at ${MAX_FILES_PER_PROJECT} file maximum.`
        );
        break;
      }

      projectFiles.push({
        path: validation.normalizedPath,
        content: zipEntry.content,
      });
    }

    let messages: StoredMessage[] = [];
    const messagesEntry = entriesByPath.get(`${folderPrefix}.desyra/messages.json`);
    if (messagesEntry) {
      try {
        const arr = JSON.parse(messagesEntry.content) as unknown;
        if (Array.isArray(arr)) {
          messages = arr
            .filter((item): item is StoredMessage => Boolean(item && typeof item === 'object'))
            .map((m) => sanitizeMessageForBackup(m));
        }
      } catch {
        warnings.push(`Could not parse saved chat history for "${entry.title}".`);
      }
    }

    let snapshots: SnapshotRecord[] = [];
    const snapsEntry = entriesByPath.get(`${folderPrefix}.desyra/snapshots.json`);
    if (snapsEntry) {
      try {
        const arr = JSON.parse(snapsEntry.content) as unknown;
        if (Array.isArray(arr)) {
          snapshots = arr
            .filter((item): item is SnapshotRecord => Boolean(item && typeof item === 'object'))
            .map((s) => sanitizeSnapshotForBackup(s));
        }
      } catch {
        warnings.push(`Could not parse version history for "${entry.title}".`);
      }
    }

    let blobs: BlobRecord[] = [];
    const blobsEntry = entriesByPath.get(`${folderPrefix}.desyra/blobs.json`);
    if (blobsEntry) {
      try {
        const arr = JSON.parse(blobsEntry.content) as unknown;
        if (Array.isArray(arr)) {
          blobs = arr
            .filter((item): item is BlobRecord => {
              if (!item || typeof item !== 'object') return false;
              const rec = item as Partial<BlobRecord>;
              return typeof rec.hash === 'string' && typeof rec.content === 'string';
            })
            .map((b) => ({
              hash: b.hash,
              content: b.content,
              size: typeof b.size === 'number' ? b.size : computeUtf8ByteLength(b.content),
            }));
        }
      } catch {
        warnings.push(`Could not parse stored history blobs for "${entry.title}".`);
      }
    }

    // Check design metadata fallback inside folder .desyra/project.json
    let designData = entry.design;
    let planData = entry.plan;
    const projectJsonEntry = entriesByPath.get(`${folderPrefix}.desyra/project.json`);
    if ((!designData || !planData) && projectJsonEntry) {
      try {
        const meta = JSON.parse(projectJsonEntry.content) as Partial<DesyraProjectMetadataFile>;
        if (!designData && meta.design) {
          designData = meta.design;
        }
      } catch {
        // Ignore
      }
    }

    const spec = extractDesignSpec(designData);
    const presentSet = new Set(projectFiles.map((f) => f.path));
    const regeneratedCssNeeded = Boolean(
      spec && MANAGED_DESIGN_FILES.some((managed) => !presentSet.has(managed))
    );

    const normalizedEntry: BackupProjectEntry = {
      originalId:
        typeof entry.originalId === 'string' && entry.originalId
          ? entry.originalId
          : entry.folderName,
      folderName: entry.folderName,
      title: String(entry.title).slice(0, 60),
      idea: typeof entry.idea === 'string' ? entry.idea : `Restored backup (${entry.title})`,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      autoStarted: entry.autoStarted,
      fileCount: projectFiles.length,
      messageCount: messagesEntry ? messages.length : entry.messageCount,
      snapshotCount: snapsEntry ? snapshots.length : entry.snapshotCount,
      ...(designData ? { design: designData } : {}),
      ...(planData ? { plan: planData } : {}),
    };

    parsedProjects.push({
      entry: normalizedEntry,
      files: projectFiles,
      messages,
      snapshots,
      blobs,
      regeneratedCssNeeded,
    });
  }

  const manifest: BackupManifest = {
    formatVersion: 1,
    createdAt:
      typeof manifestCandidate.createdAt === 'number'
        ? manifestCandidate.createdAt
        : Date.now(),
    desyraAppVersion:
      typeof manifestCandidate.desyraAppVersion === 'string'
        ? manifestCandidate.desyraAppVersion
        : 'unknown',
    includeChatHistory: Boolean(manifestCandidate.includeChatHistory),
    includeSnapshots: Boolean(manifestCandidate.includeSnapshots),
    projects: parsedProjects.map((p) => p.entry),
  };

  return {
    manifest,
    projects: parsedProjects,
    warnings,
    skippedBinaryFiles: parsed.skippedBinaryFiles,
  };
}

/**
 * Restores selected projects from a parsed backup archive.
 * Always allocates brand-new project IDs so existing projects are never overwritten.
 * Commits each project atomically and checks AbortSignal between projects.
 */
export async function restoreProjectsFromBackup(
  parsedBackup: ParsedBackupArchive,
  selectedOriginalIds: string[],
  options: RestoreBackupOptions = {},
  storage?: HistoryStorageAdapter
): Promise<RestoreBackupResult> {
  const adapter = storage ?? createDexieHistoryAdapter();
  const { signal, onProgress } = options;

  throwIfAborted(signal);

  const selectedSet = new Set(selectedOriginalIds);
  const selectedProjects = parsedBackup.projects.filter((p) =>
    selectedSet.has(p.entry.originalId)
  );

  if (selectedProjects.length === 0) {
    throw new Error('Select at least one project to restore.');
  }

  const existingProjectsBefore = await adapter.listProjects();
  const existingCountBefore = existingProjectsBefore.length;

  const restoredProjects: Project[] = [];
  const warnings = [...parsedBackup.warnings];

  for (let i = 0; i < selectedProjects.length; i++) {
    throwIfAborted(signal);
    const item = selectedProjects[i];

    onProgress?.({
      phase: 'restoring',
      current: i + 1,
      total: selectedProjects.length,
      currentTitle: item.entry.title,
    });

    const now = Date.now();
    const newProjectId = generateId('proj');

    // Prepare files (preserving existing files and regenerating missing managed CSS if design spec exists)
    const workingFiles = item.files.map((f) => ({ ...f }));
    const spec = extractDesignSpec(item.entry.design);
    let resolvedDesign: Project['design'] = item.entry.design
      ? cloneData(item.entry.design)
      : undefined;

    if (spec) {
      const fileContentMap = new Map<string, string>();
      for (const f of workingFiles) {
        fileContentMap.set(f.path, f.content);
      }

      const generators: Record<string, (s: DesignSpec) => string> = {
        'css/tokens.css': generateTokensCss,
        'css/base.css': generateBaseCss,
        'css/components.css': generateComponentsCss,
      };

      const managedHashes: Record<string, string> = {};
      for (const managedPath of MANAGED_DESIGN_FILES) {
        const existing = fileContentMap.get(managedPath);
        if (existing !== undefined) {
          managedHashes[managedPath] = computeStringHash(existing);
        } else if (workingFiles.length < MAX_FILES_PER_PROJECT) {
          const css = generators[managedPath](spec);
          workingFiles.push({ path: managedPath, content: css });
          managedHashes[managedPath] = computeStringHash(css);
        }
      }

      resolvedDesign = {
        spec: cloneData(spec),
        managedFiles: [...MANAGED_DESIGN_FILES],
        managedHashes,
        updatedAt: now,
      };
    }

    workingFiles.sort((a, b) => a.path.localeCompare(b.path));

    const newProject: Project = {
      id: newProjectId,
      title: item.entry.title.slice(0, 60),
      idea: item.entry.idea,
      createdAt: item.entry.createdAt || now,
      updatedAt: now,
      autoStarted: Boolean(item.entry.autoStarted || workingFiles.length > 0),
      ...(resolvedDesign ? { design: resolvedDesign } : {}),
      ...(item.entry.plan ? { plan: cloneData(item.entry.plan) } : {}),
    };

    const fileRecords: ProjectFile[] = workingFiles.map((f) => ({
      id: generateId('file'),
      projectId: newProjectId,
      path: f.path,
      content: f.content,
      createdAt: now,
      updatedAt: now,
    }));

    // Remap snapshot IDs and message IDs while preserving cross-links
    const messageIdMap = new Map<string, string>();
    for (const m of item.messages) {
      messageIdMap.set(m.id, generateId('msg'));
    }

    const snapshotIdMap = new Map<string, string>();
    for (const s of item.snapshots) {
      snapshotIdMap.set(s.id, generateId('snap'));
    }

    const remappedMessages: StoredMessage[] = item.messages.map((m) => {
      const sanitized = sanitizeMessageForBackup(m, newProjectId);
      const newMsgId = messageIdMap.get(m.id) ?? generateId('msg');
      const mappedSnapshotId =
        sanitized.snapshotId && snapshotIdMap.has(sanitized.snapshotId)
          ? snapshotIdMap.get(sanitized.snapshotId)
          : undefined;
      return {
        ...sanitized,
        id: newMsgId,
        projectId: newProjectId,
        ...(mappedSnapshotId ? { snapshotId: mappedSnapshotId } : {}),
      };
    });

    // Build blob map & snapshots OUTSIDE transaction
    const blobsMap = new Map<string, BlobRecord>();
    for (const b of item.blobs) {
      blobsMap.set(b.hash, b);
    }

    const remappedSnapshots: SnapshotRecord[] = [];
    if (item.snapshots.length > 0) {
      for (const s of item.snapshots) {
        const mappedSnapId = snapshotIdMap.get(s.id) ?? generateId('snap');
        const mappedMsgId =
          s.messageId && messageIdMap.has(s.messageId)
            ? messageIdMap.get(s.messageId)
            : undefined;
        // Verify all manifest hashes have a backing blob
        const validManifest: Record<string, string> = {};
        let totalSnapBytes = 0;
        for (const [path, hash] of Object.entries(s.manifest)) {
          const blob = blobsMap.get(hash);
          if (blob) {
            validManifest[path] = hash;
            totalSnapBytes += blob.size;
          }
        }
        remappedSnapshots.push({
          ...s,
          id: mappedSnapId,
          projectId: newProjectId,
          ...(mappedMsgId ? { messageId: mappedMsgId } : { messageId: undefined }),
          fileCount: Object.keys(validManifest).length,
          totalBytes: totalSnapBytes,
          manifest: validManifest,
          meta: buildSafeSnapshotMeta(s.meta?.design ?? resolvedDesign, s.meta?.plan ?? newProject.plan),
        });
      }
    }

    if (remappedSnapshots.length === 0) {
      // Create an initial 'import' snapshot matching current files
      const initManifest: Record<string, string> = {};
      let initTotalBytes = 0;
      for (const f of workingFiles) {
        const size = computeUtf8ByteLength(f.content);
        const hash = await computeContentHash(f.content);
        initManifest[f.path] = hash;
        initTotalBytes += size;
        if (!blobsMap.has(hash)) {
          blobsMap.set(hash, { hash, content: f.content, size });
        }
      }
      remappedSnapshots.push({
        id: generateId('snap'),
        projectId: newProjectId,
        createdAt: now,
        label: 'Restored from backup',
        kind: 'import',
        fileCount: workingFiles.length,
        totalBytes: initTotalBytes,
        manifest: initManifest,
        meta: buildSafeSnapshotMeta(resolvedDesign, newProject.plan),
      });
    }

    // Re-check abort signal immediately prior to committing transaction
    throwIfAborted(signal);

    await adapter.transaction(
      'rw',
      ['projects', 'files', 'messages', 'snapshots', 'blobs'],
      async () => {
        await adapter.addProject(newProject);
        await adapter.bulkPutFiles(fileRecords);

        if (remappedMessages.length > 0) {
          await adapter.bulkPutMessages(remappedMessages);
        }

        const neededHashes = Array.from(blobsMap.keys());
        const existingBlobs = await adapter.getBlobs(neededHashes);
        const existingSet = new Set(existingBlobs.map((b) => b.hash));
        const newBlobs: BlobRecord[] = [];
        for (const [hash, blob] of blobsMap.entries()) {
          if (!existingSet.has(hash)) {
            newBlobs.push(blob);
          }
        }
        if (newBlobs.length > 0) {
          await adapter.putBlobs(newBlobs);
        }

        await adapter.bulkPutSnapshots(remappedSnapshots);
      }
    );

    restoredProjects.push(newProject);

    if (i < selectedProjects.length - 1) {
      await yieldToEventLoop();
    }
  }

  if (existingCountBefore === 0 && restoredProjects.length > 0 && typeof window !== 'undefined') {
    void requestPersistentStorageSafe();
  }

  return {
    restoredProjects,
    restoredCount: restoredProjects.length,
    warnings,
  };
}
