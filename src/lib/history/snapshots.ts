/**
 * DESYRA Version History Engine
 * Content-addressed snapshots, manifest dedupe, FIFO 60-version retention,
 * atomic full/per-file restore, project duplication, blob GC, and integrity check.
 */

import {
  setHistoryTrimNotified,
  getHistoryTrimNotified,
  type Project,
  type ProjectFile,
  type SnapshotKind,
  type SnapshotMeta,
  type SnapshotPlanSummary,
  type SnapshotRecord,
  type BlobRecord,
} from '@/lib/db';
import type { ProjectPlan, ProjectDesignData, DesignSpec } from '@/lib/design/types';
import { aiFileStore } from '@/lib/ai/aiFileStore';
import { computeContentHash, computeUtf8ByteLength } from './hash';
import { computeLineDiff, type LineDiffResult } from './diff';
import {
  createDexieHistoryAdapter,
  cloneData,
  type HistoryStorageAdapter,
} from './storage';

export const MAX_UNPINNED_SNAPSHOTS_PER_PROJECT = 60;
export const HISTORY_PAGE_SIZE = 25;

// Lightweight client event bus so History drawer refreshes cleanly on snapshot mutations
type HistoryListener = (projectId: string) => void;
const historyListeners = new Set<HistoryListener>();

export function subscribeHistoryChanges(listener: HistoryListener): () => void {
  historyListeners.add(listener);
  return () => {
    historyListeners.delete(listener);
  };
}

function emitHistoryChange(projectId: string): void {
  for (const listener of historyListeners) {
    try {
      listener(projectId);
    } catch {
      // Ignore subscriber errors
    }
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compares two path->hash manifests for exact equality.
 */
export function manifestsEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Pure hash-based manifest comparison (+new, ~changed, -removed) without loading blob bodies.
 */
export interface ManifestDelta {
  added: string[];
  modified: Array<{ path: string; fromHash: string; toHash: string }>;
  removed: string[];
  unchanged: string[];
}

export function compareManifests(
  fromManifest: Record<string, string>,
  toManifest: Record<string, string>
): ManifestDelta {
  const added: string[] = [];
  const modified: Array<{ path: string; fromHash: string; toHash: string }> = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  const allPaths = new Set([
    ...Object.keys(fromManifest),
    ...Object.keys(toManifest),
  ]);
  const sortedPaths = Array.from(allPaths).sort((a, b) => a.localeCompare(b));

  for (const path of sortedPaths) {
    const fromHash = fromManifest[path];
    const toHash = toManifest[path];
    if (fromHash === undefined && toHash !== undefined) {
      added.push(path);
    } else if (fromHash !== undefined && toHash === undefined) {
      removed.push(path);
    } else if (fromHash !== undefined && toHash !== undefined) {
      if (fromHash !== toHash) {
        modified.push({ path, fromHash, toHash });
      } else {
        unchanged.push(path);
      }
    }
  }

  return { added, modified, removed, unchanged };
}

export function sanitizePlanSummary(plan?: ProjectPlan): SnapshotPlanSummary | undefined {
  if (!plan) return undefined;
  return {
    directionName: plan.brief?.directionName,
    appType: plan.brief?.appType,
    status: plan.status,
    presetId: plan.selections?.presetId,
    fontPairId: plan.selections?.fontPairId,
    mode: plan.selections?.mode,
    selectedFeaturesCount: plan.selections?.selectedFeatureIds?.length ?? 0,
  };
}

/**
 * Strips any non-whitelist fields so snapshots NEVER contain API keys, providers,
 * previewStorage values, passphrases, or chat messages.
 */
export function buildSafeSnapshotMeta(
  design?: DesignSpec | ProjectDesignData,
  plan?: ProjectPlan | SnapshotPlanSummary
): SnapshotMeta {
  const meta: SnapshotMeta = {};
  if (design) {
    meta.design = cloneData(design);
  }
  if (plan) {
    if ('brief' in plan || 'selections' in plan) {
      meta.plan = sanitizePlanSummary(plan as ProjectPlan);
    } else {
      const s = plan as SnapshotPlanSummary;
      meta.plan = {
        directionName: s.directionName,
        appType: s.appType,
        status: s.status,
        presetId: s.presetId,
        fontPairId: s.fontPairId,
        mode: s.mode,
        selectedFeaturesCount: s.selectedFeaturesCount,
      };
    }
  }
  return meta;
}

export interface CreateSnapshotOptions {
  label: string;
  kind: SnapshotKind;
  messageId?: string;
  note?: string;
  pinned?: boolean;
  metaOverride?: SnapshotMeta;
  createdAtOverride?: number;
}

export interface CreateSnapshotOutcome {
  snapshot: SnapshotRecord | null;
  trimmedCount: number;
  latestSnapshotId: string | null;
}

interface PrecomputedBlobInput {
  manifest: Record<string, string>;
  blobsMap: Map<string, BlobRecord>;
  fileCount: number;
  totalBytes: number;
}

async function precomputeFilesManifest(
  files: ProjectFile[]
): Promise<PrecomputedBlobInput> {
  const manifest: Record<string, string> = {};
  const blobsMap = new Map<string, BlobRecord>();
  let totalBytes = 0;

  for (const file of files) {
    const size = computeUtf8ByteLength(file.content);
    const hash = await computeContentHash(file.content);
    manifest[file.path] = hash;
    totalBytes += size;
    if (!blobsMap.has(hash)) {
      blobsMap.set(hash, {
        hash,
        content: file.content,
        size,
      });
    }
  }

  return {
    manifest,
    blobsMap,
    fileCount: files.length,
    totalBytes,
  };
}

function getAdapter(storage?: HistoryStorageAdapter): HistoryStorageAdapter {
  return storage ?? createDexieHistoryAdapter();
}

/**
 * Creates a content-addressed snapshot inside ONE atomic transaction.
 * Precomputes SHA-256 hashes outside the transaction so IDB never auto-commits mid-await.
 * Returns null if the file manifest is identical to the latest snapshot.
 */
export async function createSnapshotWithResult(
  projectId: string,
  options: CreateSnapshotOptions,
  storage?: HistoryStorageAdapter
): Promise<CreateSnapshotOutcome> {
  const adapter = getAdapter(storage);

  // 1. Read project + current files & precompute all hashes BEFORE starting rw transaction
  const project = await adapter.getProject(projectId);
  if (!project) {
    return { snapshot: null, trimmedCount: 0, latestSnapshotId: null };
  }

  const files = await adapter.listProjectFiles(projectId);
  const precomputed = await precomputeFilesManifest(files);

  const safeMeta = options.metaOverride
    ? buildSafeSnapshotMeta(options.metaOverride.design, options.metaOverride.plan)
    : buildSafeSnapshotMeta(project.design, project.plan);

  const cleanLabel = options.label.trim().slice(0, 80) || 'Version snapshot';
  const cleanNote = options.note?.trim().slice(0, 300);
  const candidateCreatedAt = options.createdAtOverride ?? Date.now();
  const newId = generateId('snap');

  // 2. Atomic write transaction across snapshots, blobs, and optionally messages
  const result = await adapter.transaction(
    'rw',
    ['projects', 'files', 'snapshots', 'blobs', 'messages'],
    async () => {
      const existingSnaps = await adapter.listProjectSnapshots(projectId);
      const latest = existingSnaps[0] ?? null;

      if (latest && manifestsEqual(latest.manifest, precomputed.manifest)) {
        return {
          snapshot: null,
          trimmedCount: 0,
          latestSnapshotId: latest.id,
        };
      }

      // Check which blobs already exist to minimize redundant puts
      const neededHashes = Array.from(precomputed.blobsMap.keys());
      const existingBlobs = await adapter.getBlobs(neededHashes);
      const existingSet = new Set(existingBlobs.map((b) => b.hash));
      const newBlobsToInsert: BlobRecord[] = [];
      for (const [hash, blob] of precomputed.blobsMap.entries()) {
        if (!existingSet.has(hash)) {
          newBlobsToInsert.push(blob);
        }
      }
      if (newBlobsToInsert.length > 0) {
        await adapter.putBlobs(newBlobsToInsert);
      }

      const createdAt =
        options.createdAtOverride !== undefined
          ? options.createdAtOverride
          : latest && latest.createdAt >= candidateCreatedAt
            ? latest.createdAt + 1
            : candidateCreatedAt;

      const newSnapshot: SnapshotRecord = {
        id: newId,
        projectId,
        createdAt,
        label: cleanLabel,
        kind: options.kind,
        ...(options.messageId ? { messageId: options.messageId } : {}),
        fileCount: precomputed.fileCount,
        totalBytes: precomputed.totalBytes,
        manifest: precomputed.manifest,
        meta: safeMeta,
        ...(options.pinned ? { pinned: true } : {}),
        ...(cleanNote ? { note: cleanNote } : {}),
      };

      await adapter.putSnapshot(newSnapshot);

      if (options.messageId) {
        await adapter.updateMessageSnapshot(options.messageId, newSnapshot.id);
      }

      // Enforce 60 non-pinned FIFO retention per project (pinned snapshots never expire)
      const allAfterInsert = [newSnapshot, ...existingSnaps];
      const unpinnedOldestFirst = allAfterInsert
        .filter((s) => !s.pinned)
        .sort((a, b) => a.createdAt - b.createdAt);

      let trimmedCount = 0;
      if (unpinnedOldestFirst.length > MAX_UNPINNED_SNAPSHOTS_PER_PROJECT) {
        const excess = unpinnedOldestFirst.length - MAX_UNPINNED_SNAPSHOTS_PER_PROJECT;
        const toDelete = unpinnedOldestFirst.slice(0, excess).map((s) => s.id);
        await adapter.bulkDeleteSnapshots(toDelete);
        trimmedCount = toDelete.length;
        await adapter.gcBlobs();
      }

      return {
        snapshot: newSnapshot,
        trimmedCount,
        latestSnapshotId: newSnapshot.id,
      };
    }
  );

  if (result.snapshot) {
    emitHistoryChange(projectId);
  }

  return result;
}

/**
 * Convenience wrapper matching standard snapshot creation contract:
 * Returns null if file state matches latest snapshot (no duplicate saved).
 */
export async function createSnapshot(
  projectId: string,
  options: CreateSnapshotOptions,
  storage?: HistoryStorageAdapter
): Promise<SnapshotRecord | null> {
  const outcome = await createSnapshotWithResult(projectId, options, storage);
  return outcome.snapshot;
}

export interface SaveCheckpointResult {
  snapshot: SnapshotRecord | null;
  createdNew: boolean;
  trimmedCount: number;
}

/**
 * Explicit user "Save version" action:
 * Creates a pinned checkpoint snapshot, or if files match the latest version,
 * pins and updates the label/note on the latest snapshot instead of duplicating.
 */
export async function saveManualCheckpoint(
  projectId: string,
  label: string,
  note?: string,
  storage?: HistoryStorageAdapter
): Promise<SaveCheckpointResult> {
  const adapter = getAdapter(storage);
  const outcome = await createSnapshotWithResult(
    projectId,
    {
      label: label.trim() || 'Saved checkpoint',
      kind: 'checkpoint',
      note,
      pinned: true,
    },
    adapter
  );

  if (outcome.snapshot) {
    return {
      snapshot: outcome.snapshot,
      createdNew: true,
      trimmedCount: outcome.trimmedCount,
    };
  }

  // If latest snapshot already has identical manifest, pin & update label/note on it
  if (outcome.latestSnapshotId) {
    const existing = await adapter.getSnapshot(outcome.latestSnapshotId);
    if (existing) {
      const updates: Partial<SnapshotRecord> = {
        pinned: true,
      };
      const cleanLabel = label.trim().slice(0, 80);
      if (cleanLabel) {
        updates.label = cleanLabel;
      }
      if (note !== undefined) {
        updates.note = note.trim().slice(0, 300) || undefined;
      }
      await adapter.updateSnapshot(existing.id, updates);
      emitHistoryChange(projectId);
      return {
        snapshot: { ...existing, ...updates },
        createdNew: false,
        trimmedCount: 0,
      };
    }
  }

  return {
    snapshot: null,
    createdNew: false,
    trimmedCount: 0,
  };
}

/**
 * Checks whether oldest snapshots were trimmed for the first time in browser and notifies once.
 */
export async function maybeNotifyFirstTrim(trimmedCount: number): Promise<boolean> {
  if (trimmedCount <= 0) return false;
  const alreadyNotified = await getHistoryTrimNotified();
  if (alreadyNotified) return false;
  await setHistoryTrimNotified(true);
  return true;
}

export interface SnapshotListItem extends SnapshotRecord {
  deltaSummary: {
    added: number;
    modified: number;
    removed: number;
  };
}

export interface ListSnapshotsResult {
  items: SnapshotListItem[];
  total: number;
  hasMore: boolean;
}

/**
 * Lists snapshots paginated newest-first, computing +X ~Y -Z summary purely from manifests.
 */
export async function listSnapshots(
  projectId: string,
  options: { offset?: number; limit?: number } = {},
  storage?: HistoryStorageAdapter
): Promise<ListSnapshotsResult> {
  const adapter = getAdapter(storage);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? HISTORY_PAGE_SIZE);

  const all = await adapter.listProjectSnapshots(projectId);
  all.sort((a, b) => b.createdAt - a.createdAt);

  const total = all.length;
  const slice = all.slice(offset, offset + limit);

  const items: SnapshotListItem[] = slice.map((snap, idx) => {
    const olderSnap = all[offset + idx + 1];
    const prevManifest = olderSnap ? olderSnap.manifest : {};
    const delta = compareManifests(prevManifest, snap.manifest);
    return {
      ...snap,
      deltaSummary: {
        added: delta.added.length,
        modified: delta.modified.length,
        removed: delta.removed.length,
      },
    };
  });

  return {
    items,
    total,
    hasMore: offset + slice.length < total,
  };
}

export async function getSnapshot(
  snapshotId: string,
  storage?: HistoryStorageAdapter
): Promise<SnapshotRecord | null> {
  const adapter = getAdapter(storage);
  const snap = await adapter.getSnapshot(snapshotId);
  return snap ?? null;
}

export type DiffSource =
  | { type: 'snapshot'; snapshotId: string }
  | { type: 'current' }
  | { type: 'empty' };

function parseDiffTarget(source: string | 'current' | 'empty' | null | undefined): DiffSource {
  if (!source || source === 'empty') return { type: 'empty' };
  if (source === 'current') return { type: 'current' };
  return { type: 'snapshot', snapshotId: source };
}

async function resolveManifestForSource(
  projectId: string,
  source: DiffSource,
  adapter: HistoryStorageAdapter
): Promise<{
  manifest: Record<string, string>;
  currentFilesByPath?: Map<string, ProjectFile>;
}> {
  if (source.type === 'empty') {
    return { manifest: {} };
  }
  if (source.type === 'current') {
    const files = await adapter.listProjectFiles(projectId);
    const byPath = new Map<string, ProjectFile>();
    const manifest: Record<string, string> = {};
    for (const f of files) {
      byPath.set(f.path, f);
      manifest[f.path] = await computeContentHash(f.content);
    }
    return { manifest, currentFilesByPath: byPath };
  }
  const snap = await adapter.getSnapshot(source.snapshotId);
  return { manifest: snap ? snap.manifest : {} };
}

/**
 * Compares two snapshot states (or 'current' project files) using manifests without loading unchanged blobs.
 */
export async function diffSnapshots(
  projectId: string,
  fromIdOrCurrent: string | 'current' | 'empty' | null,
  toIdOrCurrent: string | 'current' | 'empty' | null,
  storage?: HistoryStorageAdapter
): Promise<ManifestDelta> {
  const adapter = getAdapter(storage);
  const fromSrc = parseDiffTarget(fromIdOrCurrent);
  const toSrc = parseDiffTarget(toIdOrCurrent);

  const [fromResolved, toResolved] = await Promise.all([
    resolveManifestForSource(projectId, fromSrc, adapter),
    resolveManifestForSource(projectId, toSrc, adapter),
  ]);

  return compareManifests(fromResolved.manifest, toResolved.manifest);
}

/**
 * Loads the content of a single file path from a snapshot or current files (lazy on inspect).
 */
export async function getFileContentForSource(
  projectId: string,
  sourceIdOrCurrent: string | 'current' | 'empty' | null,
  path: string,
  storage?: HistoryStorageAdapter
): Promise<string | null> {
  const adapter = getAdapter(storage);
  const source = parseDiffTarget(sourceIdOrCurrent);

  if (source.type === 'empty') return null;
  if (source.type === 'current') {
    const files = await adapter.listProjectFiles(projectId);
    const match = files.find((f) => f.path === path);
    return match ? match.content : null;
  }

  const snap = await adapter.getSnapshot(source.snapshotId);
  if (!snap) return null;
  const hash = snap.manifest[path];
  if (!hash) return null;
  const blobs = await adapter.getBlobs([hash]);
  return blobs[0]?.content ?? null;
}

/**
 * Computes line-by-line diff for a single file path between two sources (lazy blob fetch).
 */
export async function diffSnapshotFile(
  projectId: string,
  fromIdOrCurrent: string | 'current' | 'empty' | null,
  toIdOrCurrent: string | 'current' | 'empty' | null,
  path: string,
  storage?: HistoryStorageAdapter
): Promise<LineDiffResult> {
  const [beforeContent, afterContent] = await Promise.all([
    getFileContentForSource(projectId, fromIdOrCurrent, path, storage),
    getFileContentForSource(projectId, toIdOrCurrent, path, storage),
  ]);

  return computeLineDiff(beforeContent ?? '', afterContent ?? '');
}

export interface RestoreSnapshotResult {
  restoredSnapshot: SnapshotRecord;
  undoSnapshotId: string | null;
  addedCount: number;
  changedCount: number;
  removedCount: number;
}

/**
 * Restores an entire snapshot (files + design state) OR a single file (`onlyPath`) atomically.
 * Always saves a pre-restore checkpoint first so users can Undo restore immediately.
 */
export async function restoreSnapshot(
  projectId: string,
  snapshotId: string,
  options: { onlyPath?: string } = {},
  storage?: HistoryStorageAdapter
): Promise<RestoreSnapshotResult> {
  const adapter = getAdapter(storage);
  const target = await adapter.getSnapshot(snapshotId);
  if (!target || target.projectId !== projectId) {
    throw new Error('Version snapshot not found for this project.');
  }

  const { onlyPath } = options;

  // 1. Pre-restore snapshot first so restore can always be undone
  const preRestoreOutcome = await createSnapshotWithResult(
    projectId,
    {
      label: onlyPath ? `Before restoring ${onlyPath}` : 'Before restore',
      kind: 'restore',
    },
    adapter
  );
  const undoSnapshotId = preRestoreOutcome.latestSnapshotId;

  // 2. Precompute hashes for current files outside rw tx to get accurate change counts cleanly
  const currentPreFiles = await adapter.listProjectFiles(projectId);
  const currentPreManifest: Record<string, string> = {};
  for (const f of currentPreFiles) {
    currentPreManifest[f.path] = await computeContentHash(f.content);
  }

  // 3. Atomic restore transaction: all file mutations and design update together or nothing
  const outcome = await adapter.transaction(
    'rw',
    ['projects', 'files', 'snapshots', 'blobs'],
    async () => {
      const project = await adapter.getProject(projectId);
      if (!project) {
        throw new Error('Project not found.');
      }

      const currentFiles = await adapter.listProjectFiles(projectId);
      const currentByPath = new Map<string, ProjectFile>();
      for (const f of currentFiles) {
        currentByPath.set(f.path, f);
      }

      const now = Date.now();
      let addedCount = 0;
      let changedCount = 0;
      let removedCount = 0;

      if (onlyPath) {
        const targetHash = target.manifest[onlyPath];
        const existing = currentByPath.get(onlyPath);

        if (targetHash !== undefined) {
          const [blob] = await adapter.getBlobs([targetHash]);
          if (!blob) {
            throw new Error(`Snapshot data blob missing for "${onlyPath}". Restore aborted.`);
          }
          if (existing) {
            if (currentPreManifest[onlyPath] !== targetHash) {
              changedCount = 1;
            }
            await adapter.putFile({
              ...existing,
              content: blob.content,
              updatedAt: now,
            });
          } else {
            addedCount = 1;
            await adapter.putFile({
              id: generateId('file'),
              projectId,
              path: onlyPath,
              content: blob.content,
              createdAt: now,
              updatedAt: now,
            });
          }
        } else if (existing) {
          removedCount = 1;
          await adapter.bulkDeleteFileIds([existing.id]);
        }

        await adapter.updateProject(projectId, { updatedAt: now });
      } else {
        // Full snapshot restore: verify EVERY required blob exists before mutating anything
        const targetPaths = Object.keys(target.manifest);
        const uniqueHashes = Array.from(new Set(Object.values(target.manifest)));
        const fetchedBlobs = await adapter.getBlobs(uniqueHashes);
        const blobByHash = new Map<string, BlobRecord>();
        for (const b of fetchedBlobs) {
          blobByHash.set(b.hash, b);
        }

        for (const path of targetPaths) {
          const hash = target.manifest[path];
          if (!blobByHash.has(hash)) {
            throw new Error(
              `Cannot restore: missing content blob for "${path}". No files were modified.`
            );
          }
        }

        const idsToDelete: string[] = [];
        for (const f of currentFiles) {
          if (target.manifest[f.path] === undefined) {
            idsToDelete.push(f.id);
            removedCount++;
          }
        }

        const filesToPut: ProjectFile[] = [];
        for (const path of targetPaths) {
          const hash = target.manifest[path];
          const blob = blobByHash.get(hash)!;
          const existing = currentByPath.get(path);

          if (existing) {
            if (currentPreManifest[path] !== hash) {
              changedCount++;
            }
            filesToPut.push({
              ...existing,
              content: blob.content,
              updatedAt: now,
            });
          } else {
            addedCount++;
            filesToPut.push({
              id: generateId('file'),
              projectId,
              path,
              content: blob.content,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        await adapter.bulkDeleteFileIds(idsToDelete);
        await adapter.bulkPutFiles(filesToPut);

        // Restore design state atomically along with files
        await adapter.updateProject(projectId, {
          design: target.meta?.design ? cloneData(target.meta.design) : undefined,
          updatedAt: now,
        });
      }

      return {
        restoredSnapshot: target,
        undoSnapshotId,
        addedCount,
        changedCount,
        removedCount,
      };
    }
  );

  if (typeof window !== 'undefined') {
    aiFileStore.clearAllChanged(projectId);
    aiFileStore.bumpRevision(projectId);
  }
  emitHistoryChange(projectId);

  return outcome;
}

export async function deleteSnapshot(
  snapshotId: string,
  storage?: HistoryStorageAdapter
): Promise<boolean> {
  const adapter = getAdapter(storage);
  let targetProjectId = '';

  await adapter.transaction('rw', ['snapshots', 'blobs'], async () => {
    const target = await adapter.getSnapshot(snapshotId);
    if (!target) {
      throw new Error('Snapshot not found.');
    }
    targetProjectId = target.projectId;
    const siblingSnaps = await adapter.listProjectSnapshots(target.projectId);
    if (siblingSnaps.length <= 1) {
      throw new Error('Cannot delete the only version of a project.');
    }
    await adapter.bulkDeleteSnapshots([snapshotId]);
    await adapter.gcBlobs();
  });

  if (targetProjectId) {
    emitHistoryChange(targetProjectId);
  }
  return true;
}

export async function pinSnapshot(
  snapshotId: string,
  pinned: boolean,
  storage?: HistoryStorageAdapter
): Promise<SnapshotRecord | null> {
  const adapter = getAdapter(storage);
  const existing = await adapter.getSnapshot(snapshotId);
  if (!existing) return null;
  await adapter.updateSnapshot(snapshotId, { pinned });
  const updated = { ...existing, pinned };
  emitHistoryChange(existing.projectId);
  return updated;
}

export async function renameSnapshot(
  snapshotId: string,
  label: string,
  note?: string,
  storage?: HistoryStorageAdapter
): Promise<SnapshotRecord | null> {
  const cleanLabel = label.trim();
  if (!cleanLabel) {
    throw new Error('Version label cannot be empty.');
  }
  if (cleanLabel.length > 80) {
    throw new Error('Version label cannot exceed 80 characters.');
  }

  const adapter = getAdapter(storage);
  const existing = await adapter.getSnapshot(snapshotId);
  if (!existing) return null;

  const updates: Partial<SnapshotRecord> = {
    label: cleanLabel,
  };
  if (note !== undefined) {
    updates.note = note.trim().slice(0, 300) || undefined;
  }

  await adapter.updateSnapshot(snapshotId, updates);
  emitHistoryChange(existing.projectId);
  return { ...existing, ...updates };
}

export async function gcBlobs(storage?: HistoryStorageAdapter): Promise<number> {
  const adapter = getAdapter(storage);
  return adapter.transaction('rw', ['snapshots', 'blobs'], async () => {
    return adapter.gcBlobs();
  });
}

/**
 * Trims unpinned snapshots across all projects down to `keepRecentUnpinned` (default 10)
 * while preserving every pinned snapshot, then runs blob GC.
 */
export async function cleanupOldVersionsAllProjects(
  keepRecentUnpinned = 10,
  storage?: HistoryStorageAdapter
): Promise<{ deletedSnapshots: number; deletedBlobs: number }> {
  const adapter = getAdapter(storage);
  const affectedProjects = new Set<string>();

  const result = await adapter.transaction('rw', ['snapshots', 'blobs'], async () => {
    const allSnaps = await adapter.listAllSnapshots();
    const byProject = new Map<string, SnapshotRecord[]>();
    for (const s of allSnaps) {
      const list = byProject.get(s.projectId) ?? [];
      list.push(s);
      byProject.set(s.projectId, list);
    }

    const toDelete: string[] = [];
    for (const [projectId, snaps] of byProject.entries()) {
      const unpinned = snaps
        .filter((s) => !s.pinned)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (unpinned.length > keepRecentUnpinned) {
        const older = unpinned.slice(keepRecentUnpinned);
        for (const s of older) {
          toDelete.push(s.id);
        }
        affectedProjects.add(projectId);
      }
    }

    if (toDelete.length > 0) {
      await adapter.bulkDeleteSnapshots(toDelete);
    }
    const deletedBlobs = await adapter.gcBlobs();
    return {
      deletedSnapshots: toDelete.length,
      deletedBlobs,
    };
  });

  for (const pid of affectedProjects) {
    emitHistoryChange(pid);
  }
  return result;
}

/**
 * Generates a unique safe copy title (max 60 chars).
 */
export function buildDuplicateTitle(originalTitle: string): string {
  const base = originalTitle.trim() || 'Untitled Project';
  const suffix = ' (Copy)';
  if (base.length + suffix.length <= 60) {
    return `${base}${suffix}`;
  }
  return `${base.slice(0, 60 - suffix.length).trim()}${suffix}`;
}

/**
 * Duplicates a project atomically (files + design + plan + initial snapshot).
 * Never copies chat messages, API keys, providers, or previewStorage.
 */
export async function duplicateProject(
  projectId: string,
  customTitle?: string,
  storage?: HistoryStorageAdapter
): Promise<Project> {
  const adapter = getAdapter(storage);
  const source = await adapter.getProject(projectId);
  if (!source) {
    throw new Error('Source project not found.');
  }

  const sourceFiles = await adapter.listProjectFiles(projectId);
  const precomputed = await precomputeFilesManifest(sourceFiles);

  const now = Date.now();
  const newProjectId = generateId('proj');
  const title = (customTitle?.trim() || buildDuplicateTitle(source.title)).slice(0, 60);

  const newProject: Project = {
    id: newProjectId,
    title,
    idea: source.idea,
    createdAt: now,
    updatedAt: now,
    // Keep autoStarted true when files already exist so opening the copy in IDE does not re-trigger initial AI generation
    autoStarted: Boolean(source.autoStarted || sourceFiles.length > 0),
    ...(source.design ? { design: cloneData(source.design) } : {}),
    ...(source.plan ? { plan: cloneData(source.plan) } : {}),
  };

  await adapter.transaction(
    'rw',
    ['projects', 'files', 'snapshots', 'blobs'],
    async () => {
      await adapter.addProject(newProject);

      const clonedFiles: ProjectFile[] = sourceFiles.map((f) => ({
        id: generateId('file'),
        projectId: newProjectId,
        path: f.path,
        content: f.content,
        createdAt: now,
        updatedAt: now,
      }));
      await adapter.bulkPutFiles(clonedFiles);

      // Put any missing blobs (normally already present if source has snapshots)
      const neededHashes = Array.from(precomputed.blobsMap.keys());
      const existingBlobs = await adapter.getBlobs(neededHashes);
      const existingSet = new Set(existingBlobs.map((b) => b.hash));
      const newBlobs: BlobRecord[] = [];
      for (const [h, blob] of precomputed.blobsMap.entries()) {
        if (!existingSet.has(h)) {
          newBlobs.push(blob);
        }
      }
      if (newBlobs.length > 0) {
        await adapter.putBlobs(newBlobs);
      }

      const duplicateSnap: SnapshotRecord = {
        id: generateId('snap'),
        projectId: newProjectId,
        createdAt: now,
        label: `Duplicated from "${source.title.slice(0, 40)}"`,
        kind: 'duplicate',
        fileCount: precomputed.fileCount,
        totalBytes: precomputed.totalBytes,
        manifest: precomputed.manifest,
        meta: buildSafeSnapshotMeta(newProject.design, newProject.plan),
      };
      await adapter.putSnapshot(duplicateSnap);
    }
  );

  emitHistoryChange(newProjectId);
  return newProject;
}

let sessionIntegrityChecked = false;

export function resetSessionIntegrityCheckFlag(): void {
  sessionIntegrityChecked = false;
}

/**
 * Cleans orphaned blobs, snapshots belonging to missing projects, and stale previewStorage rows.
 * Runs at most once per browser session unless `force = true`.
 */
export async function runStartupIntegrityCheck(
  options: { force?: boolean } = {},
  storage?: HistoryStorageAdapter
): Promise<{
  ran: boolean;
  deletedSnapshots: number;
  deletedFiles: number;
  deletedMessages: number;
  deletedPreviewEntries: number;
  deletedBlobs: number;
}> {
  if (sessionIntegrityChecked && !options.force) {
    return {
      ran: false,
      deletedSnapshots: 0,
      deletedFiles: 0,
      deletedMessages: 0,
      deletedPreviewEntries: 0,
      deletedBlobs: 0,
    };
  }
  sessionIntegrityChecked = true;

  const adapter = getAdapter(storage);
  try {
    const res = await adapter.transaction(
      'rw',
      ['projects', 'files', 'messages', 'snapshots', 'blobs', 'previewStorage'],
      async () => adapter.runOrphanIntegrityCleanup()
    );
    return { ran: true, ...res };
  } catch (err) {
    console.warn('[DESYRA Integrity] Cleanup check warning:', err);
    return {
      ran: false,
      deletedSnapshots: 0,
      deletedFiles: 0,
      deletedMessages: 0,
      deletedPreviewEntries: 0,
      deletedBlobs: 0,
    };
  }
}
