import Dexie, { type Table } from 'dexie';
import { notify } from '@/components/ui/toast';
import type { ProviderType } from '@/lib/providers';
import type { EncryptedPayload } from '@/lib/crypto';
import type {
  DesignSpec,
  ProjectPlan,
  ProjectCritique,
  DesignQuality,
  ProjectDesignData,
  DesignMode,
} from '@/lib/design/types';

export interface Project {
  id: string;
  title: string;
  idea: string;
  createdAt: number;
  updatedAt: number;
  autoStarted?: boolean;
  design?: DesignSpec | ProjectDesignData;
  plan?: ProjectPlan;
  critique?: ProjectCritique;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredProvider {
  id: string;
  providerType: ProviderType;
  label: string;
  baseUrl?: string;
  encryptedKey: EncryptedPayload;
  last4: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  isCustom?: boolean;
  defaultModel?: string;
  lastTestStatus?: 'valid' | 'invalid' | 'rate_limited' | 'unverified';
  lastTestedAt?: number;
  lastTestError?: string;
}

export interface StoredModelCache {
  providerId: string;
  models: unknown[];
  fetchedAt: number;
}

export interface FileUndoEntry {
  path: string;
  action: 'created' | 'updated' | 'deleted';
  before: string | null;
  after: string | null;
}

export interface CompletenessIssue {
  type: 'truncated' | 'incomplete_file' | 'missing_reference' | 'design_issue';
  path?: string;
  sourceFile?: string;
  details?: string;
  similarFileHint?: string;
}

export interface StoredMessage {
  id: string;
  projectId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
  kind?: 'normal' | 'plan_card';
  model?: string;
  provider?: string;
  undoEntries?: FileUndoEntry[];
  undoDisabledReason?: string;
  incompleteFiles?: string[];
  failedEdits?: Array<{ path: string; reason: string }>;
  finishReason?: 'stop' | 'length' | 'safety' | 'interrupted' | 'other';
  completionTokens?: number;
  maxOutputTokens?: number;
  completenessIssues?: CompletenessIssue[];
  promptKind?: 'design' | 'basic';
  designSpecId?: string;
  snapshotId?: string;
}

export interface MetaItem {
  key: string;
  value: unknown;
}

export interface PreviewStorageItem {
  projectId: string;
  key: string;
  value: string;
}

export interface ModelSetting {
  id?: number;
  providerId: string;
  modelId: string;
  maxOutputTokens?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface BlobRecord {
  hash: string;
  content: string;
  size: number;
}

export type SnapshotKind =
  | 'ai'
  | 'manual'
  | 'design'
  | 'restore'
  | 'checkpoint'
  | 'import'
  | 'duplicate';

export interface SnapshotPlanSummary {
  directionName?: string;
  appType?: string;
  status?: 'pending' | 'approved' | 'skipped';
  presetId?: string;
  fontPairId?: string;
  mode?: DesignMode;
  selectedFeaturesCount?: number;
}

export interface SnapshotMeta {
  design?: ProjectDesignData | DesignSpec;
  plan?: SnapshotPlanSummary;
}

export interface SnapshotRecord {
  id: string;
  projectId: string;
  createdAt: number;
  label: string;
  kind: SnapshotKind;
  messageId?: string;
  fileCount: number;
  totalBytes: number;
  manifest: Record<string, string>;
  meta: SnapshotMeta;
  pinned?: boolean;
  note?: string;
}

export const MAX_PREVIEW_STORAGE_TOTAL_BYTES = 1024 * 1024; // 1 MB cap
export const MAX_PREVIEW_STORAGE_VALUE_BYTES = 200 * 1024; // 200 KB per value cap

export const STORAGE_QUOTA_ERROR_MESSAGE =
  'Not enough browser storage. Delete old versions or export a backup.';

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as {
    name?: string;
    code?: number;
    message?: string;
    inner?: unknown;
  };
  if (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  ) {
    return true;
  }
  if (candidate.inner && isQuotaExceededError(candidate.inner)) {
    return true;
  }
  if (
    typeof candidate.message === 'string' &&
    /quota|storage full|disk full/i.test(candidate.message)
  ) {
    return true;
  }
  return false;
}

export function getFriendlyStorageErrorMessage(err: unknown, fallback: string): string {
  if (isQuotaExceededError(err)) {
    return STORAGE_QUOTA_ERROR_MESSAGE;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export const DESYRA_V6_STORES = {
  projects: 'id, title, createdAt, updatedAt, autoStarted',
  providers: 'id, providerType, label, isDefault, createdAt, updatedAt, defaultModel, lastTestStatus',
  meta: 'key',
  modelCache: 'providerId, fetchedAt',
  messages: 'id, projectId, createdAt, role',
  files: 'id, projectId, path, [projectId+path], createdAt, updatedAt',
  previewStorage: '[projectId+key], projectId',
  modelSettings: '++id, [providerId+modelId], providerId, modelId',
} as const;

export const DESYRA_V7_STORES = {
  ...DESYRA_V6_STORES,
  blobs: 'hash, size',
  snapshots: 'id, projectId, [projectId+createdAt], messageId, createdAt',
} as const;

export class DesyraDatabase extends Dexie {
  projects!: Table<Project, string>;
  providers!: Table<StoredProvider, string>;
  meta!: Table<MetaItem, string>;
  modelCache!: Table<StoredModelCache, string>;
  messages!: Table<StoredMessage, string>;
  files!: Table<ProjectFile, string>;
  previewStorage!: Table<PreviewStorageItem, [string, string]>;
  modelSettings!: Table<ModelSetting, number>;
  blobs!: Table<BlobRecord, string>;
  snapshots!: Table<SnapshotRecord, string>;

  constructor(dbName = 'desyra_db') {
    super(dbName);
    this.version(1).stores({
      projects: 'id, title, createdAt, updatedAt',
    });
    this.version(2).stores({
      projects: 'id, title, createdAt, updatedAt',
      providers: 'id, providerType, label, isDefault, createdAt, updatedAt',
      meta: 'key',
    });
    this.version(3).stores({
      projects: 'id, title, createdAt, updatedAt',
      providers: 'id, providerType, label, isDefault, createdAt, updatedAt, defaultModel, lastTestStatus',
      meta: 'key',
      modelCache: 'providerId, fetchedAt',
      messages: 'id, projectId, createdAt, role',
    });
    this.version(4).stores({
      projects: 'id, title, createdAt, updatedAt, autoStarted',
      providers: 'id, providerType, label, isDefault, createdAt, updatedAt, defaultModel, lastTestStatus',
      meta: 'key',
      modelCache: 'providerId, fetchedAt',
      messages: 'id, projectId, createdAt, role',
      files: 'id, projectId, path, [projectId+path], createdAt, updatedAt',
    });
    this.version(5).stores({
      projects: 'id, title, createdAt, updatedAt, autoStarted',
      providers: 'id, providerType, label, isDefault, createdAt, updatedAt, defaultModel, lastTestStatus',
      meta: 'key',
      modelCache: 'providerId, fetchedAt',
      messages: 'id, projectId, createdAt, role',
      files: 'id, projectId, path, [projectId+path], createdAt, updatedAt',
      previewStorage: '[projectId+key], projectId',
    });
    this.version(6).stores({
      ...DESYRA_V6_STORES,
    });
    this.version(7)
      .stores({
        ...DESYRA_V7_STORES,
      })
      .upgrade(() => {
        // Preserves all v1-v6 projects, files, messages, providers, previewStorage, meta, modelSettings
      });
  }
}

// Lazy/singleton instance
let dbInstance: DesyraDatabase | null = null;

export function getDb(): DesyraDatabase | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!dbInstance) {
    try {
      dbInstance = new DesyraDatabase();
    } catch (err) {
      console.error('[DESYRA DB] Initialization error:', err);
      notify({
        type: 'error',
        title: 'Storage Unavailable',
        message: 'Could not initialize IndexedDB storage.',
      });
      return null;
    }
  }
  return dbInstance;
}

/**
 * Creates a project record in IndexedDB.
 * Title is derived from the first ~40 characters of the idea.
 */
export async function createProject(idea: string, customTitle?: string): Promise<Project | null> {
  const trimmedIdea = idea.trim();
  if (!trimmedIdea) {
    notify({
      type: 'error',
      title: 'Invalid Input',
      message: 'App idea cannot be empty.',
    });
    return null;
  }

  const database = getDb();
  if (!database) {
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'IndexedDB is not supported or accessible in this environment.',
    });
    return null;
  }

  // Derive title from first ~40 chars
  let derivedTitle = customTitle?.trim();
  if (!derivedTitle) {
    if (trimmedIdea.length <= 40) {
      derivedTitle = trimmedIdea;
    } else {
      const cut = trimmedIdea.slice(0, 40);
      const lastSpace = cut.lastIndexOf(' ');
      derivedTitle = (lastSpace > 25 ? cut.slice(0, lastSpace) : cut).trim() + '...';
    }
  }

  const project: Project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    title: derivedTitle,
    idea: trimmedIdea,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const existingCount = await database.projects.count();
    await database.projects.add(project);
    if (existingCount === 0) {
      void requestPersistentStorageSafe();
    }
    return project;
  } catch (error) {
    console.error('[DESYRA DB] Failed to create project:', error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: getFriendlyStorageErrorMessage(
        error,
        'Failed to save your project to local storage.'
      ),
    });
    return null;
  }
}

/**
 * Lists all projects ordered by newest first.
 */
export async function listProjects(): Promise<Project[]> {
  const database = getDb();
  if (!database) return [];

  try {
    const list = await database.projects.orderBy('createdAt').reverse().toArray();
    return list;
  } catch (error) {
    console.error('[DESYRA DB] Failed to list projects:', error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Could not load projects from local storage.',
    });
    return [];
  }
}

/**
 * Retrieves a single project by ID.
 */
export async function getProject(id: string): Promise<Project | null> {
  const database = getDb();
  if (!database || !id) return null;

  try {
    const item = await database.projects.get(id);
    return item ?? null;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to get project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: `Failed to load project with ID ${id}.`,
    });
    return null;
  }
}

/**
 * Updates a project record in IndexedDB (title, autoStarted, updatedAt).
 */
export async function updateProject(id: string, updates: Partial<Project>): Promise<boolean> {
  const database = getDb();
  if (!database || !id) return false;

  try {
    await database.projects.update(id, {
      ...updates,
      updatedAt: updates.updatedAt ?? Date.now(),
    });
    return true;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to update project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: getFriendlyStorageErrorMessage(
        error,
        `Failed to update project with ID ${id}.`
      ),
    });
    return false;
  }
}

/**
 * Deletes unreferenced blobs inside an active Dexie rw transaction that includes snapshots and blobs.
 */
export async function gcBlobsInTransaction(database: DesyraDatabase): Promise<number> {
  const referencedHashes = new Set<string>();
  await database.snapshots.each((snap) => {
    if (snap.manifest) {
      for (const hash of Object.values(snap.manifest)) {
        referencedHashes.add(hash);
      }
    }
  });
  const allKeys = await database.blobs.toCollection().primaryKeys();
  const orphanKeys = allKeys.filter((hash) => !referencedHashes.has(hash));
  if (orphanKeys.length > 0) {
    await database.blobs.bulkDelete(orphanKeys);
  }
  return orphanKeys.length;
}

/**
 * Deletes a project and all owned data atomically inside ONE transaction, then runs inline blob GC.
 */
export async function deleteProject(
  id: string,
  customDb?: DesyraDatabase
): Promise<boolean> {
  const database = customDb ?? getDb();
  if (!database || !id) return false;

  try {
    await database.transaction(
      'rw',
      [
        database.projects,
        database.files,
        database.messages,
        database.snapshots,
        database.blobs,
        database.previewStorage,
      ],
      async () => {
        await database.files.where('projectId').equals(id).delete();
        await database.messages.where('projectId').equals(id).delete();
        await database.snapshots.where('projectId').equals(id).delete();
        await database.previewStorage.where('projectId').equals(id).delete();
        await database.projects.delete(id);
        await gcBlobsInTransaction(database);
      }
    );
    return true;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to delete project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: getFriendlyStorageErrorMessage(
        error,
        'Could not delete project from local storage.'
      ),
    });
    return false;
  }
}

/**
 * Counts files, versions, and messages owned by a single project without reading file content.
 */
export async function getProjectOwnedCounts(
  id: string,
  customDb?: DesyraDatabase
): Promise<{ fileCount: number; snapshotCount: number; messageCount: number }> {
  const database = customDb ?? getDb();
  if (!database || !id) {
    return { fileCount: 0, snapshotCount: 0, messageCount: 0 };
  }
  try {
    const [fileCount, snapshotCount, messageCount] = await Promise.all([
      database.files.where('projectId').equals(id).count(),
      database.snapshots.where('projectId').equals(id).count(),
      database.messages.where('projectId').equals(id).count(),
    ]);
    return { fileCount, snapshotCount, messageCount };
  } catch {
    return { fileCount: 0, snapshotCount: 0, messageCount: 0 };
  }
}

/**
 * Returns file counts and snapshot counts for all projects using index keys only
 * so /projects never loads full file contents or snapshot manifests.
 */
export async function getAllProjectCountsMap(
  customDb?: DesyraDatabase
): Promise<{
  fileCounts: Record<string, number>;
  snapshotCounts: Record<string, number>;
}> {
  const database = customDb ?? getDb();
  const fileCounts: Record<string, number> = {};
  const snapshotCounts: Record<string, number> = {};
  if (!database) {
    return { fileCounts, snapshotCounts };
  }
  try {
    await database.files.orderBy('projectId').eachKey((key) => {
      if (typeof key === 'string') {
        fileCounts[key] = (fileCounts[key] ?? 0) + 1;
      }
    });
    await database.snapshots.orderBy('projectId').eachKey((key) => {
      if (typeof key === 'string') {
        snapshotCounts[key] = (snapshotCounts[key] ?? 0) + 1;
      }
    });
  } catch (error) {
    console.error('[DESYRA DB] Failed to compute project counts via index keys:', error);
  }
  return { fileCounts, snapshotCounts };
}

/**
 * Meta table helpers for persistent configuration, keys, and drafts.
 */
export async function getMetaValue<T>(key: string): Promise<T | null> {
  const database = getDb();
  if (!database) return null;
  try {
    const record = await database.meta.get(key);
    return record ? (record.value as T) : null;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to read meta key ${key}:`, error);
    return null;
  }
}

export async function setMetaValue<T>(key: string, value: T): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.meta.put({ key, value });
  } catch (error) {
    console.error(`[DESYRA DB] Failed to write meta key ${key}:`, error);
  }
}

export async function deleteMetaValue(key: string): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.meta.delete(key);
  } catch (error) {
    console.error(`[DESYRA DB] Failed to delete meta key ${key}:`, error);
  }
}

/**
 * Clears all stored keys and passphrase credentials (keeps projects intact).
 */
export async function clearAllKeys(): Promise<boolean> {
  const database = getDb();
  if (!database) return false;
  try {
    await database.providers.clear();
    await database.meta.delete('default_crypto_key');
    await database.meta.delete('passphrase_salt');
    await database.meta.delete('passphrase_check');
    await database.meta.delete('security_mode');
    return true;
  } catch (error) {
    console.error('[DESYRA DB] Failed to clear keys:', error);
    return false;
  }
}

/**
 * Clears all data (projects, providers, meta, modelCache, messages, files) from IndexedDB.
 */
export async function clearAllDatabaseData(): Promise<boolean> {
  const database = getDb();
  if (!database) return false;
  try {
    await database.transaction(
      'rw',
      [
        database.projects,
        database.providers,
        database.meta,
        database.modelCache,
        database.messages,
        database.files,
        database.previewStorage,
        database.modelSettings,
        database.snapshots,
        database.blobs,
      ],
      async () => {
        await database.projects.clear();
        await database.providers.clear();
        await database.meta.clear();
        await database.modelCache.clear();
        await database.messages.clear();
        await database.files.clear();
        await database.previewStorage.clear();
        await database.modelSettings.clear();
        await database.snapshots.clear();
        await database.blobs.clear();
      }
    );
    return true;
  } catch (error) {
    console.error('[DESYRA DB] Failed to clear all database data:', error);
    return false;
  }
}

/**
 * Updates metadata on an existing provider (status, default model, etc).
 */
export async function updateProviderRecord(
  providerId: string,
  updates: Partial<StoredProvider>
): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.providers.update(providerId, {
      ...updates,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error(`[DESYRA DB] Failed to update provider ${providerId}:`, error);
  }
}

/**
 * Model cache helpers.
 */
export async function getModelCache(providerId: string): Promise<StoredModelCache | null> {
  const database = getDb();
  if (!database) return null;
  try {
    const item = await database.modelCache.get(providerId);
    return item ?? null;
  } catch {
    return null;
  }
}

export async function setModelCache(providerId: string, models: unknown[]): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.modelCache.put({
      providerId,
      models,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    console.error(`[DESYRA DB] Failed to cache models for ${providerId}:`, error);
  }
}

/**
 * Project conversation messages helpers.
 */
export async function listProjectMessages(projectId: string): Promise<StoredMessage[]> {
  const database = getDb();
  if (!database) return [];
  try {
    const list = await database.messages
      .where('projectId')
      .equals(projectId)
      .sortBy('createdAt');
    return list;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to list messages for project ${projectId}:`, error);
    return [];
  }
}

export async function saveProjectMessage(msg: StoredMessage): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.messages.put(msg);
  } catch (error) {
    console.error('[DESYRA DB] Failed to save message:', error);
  }
}

export async function updateProjectMessageContent(id: string, content: string): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.messages.update(id, { content });
  } catch (error) {
    console.error(`[DESYRA DB] Failed to update message ${id}:`, error);
  }
}

export async function linkMessageSnapshot(messageId: string, snapshotId: string): Promise<void> {
  const database = getDb();
  if (!database || !messageId || !snapshotId) return;
  try {
    await database.messages.update(messageId, { snapshotId });
  } catch (error) {
    console.error(`[DESYRA DB] Failed to link snapshot ${snapshotId} to message ${messageId}:`, error);
  }
}

export async function clearProjectMessages(projectId: string): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    await database.messages.where('projectId').equals(projectId).delete();
  } catch (error) {
    console.error(`[DESYRA DB] Failed to clear messages for project ${projectId}:`, error);
  }
}

/**
 * Lists all stored localStorage shim entries for a project.
 */
export async function listPreviewStorage(projectId: string): Promise<Record<string, string>> {
  const database = getDb();
  if (!database || !projectId) return {};
  try {
    const items = await database.previewStorage.where('projectId').equals(projectId).toArray();
    const result: Record<string, string> = {};
    for (const item of items) {
      result[item.key] = item.value;
    }
    return result;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to list preview storage for project ${projectId}:`, error);
    return {};
  }
}

/**
 * Calculates total bytes currently stored in previewStorage for a project.
 */
export async function getPreviewStorageBytes(projectId: string): Promise<number> {
  const database = getDb();
  if (!database || !projectId) return 0;
  try {
    const items = await database.previewStorage.where('projectId').equals(projectId).toArray();
    let total = 0;
    for (const item of items) {
      total += new Blob([item.key, item.value]).size;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Sets an item in preview storage, enforcing 200 KB per value and 1 MB total per project.
 */
export async function setPreviewStorageItem(
  projectId: string,
  key: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  const database = getDb();
  if (!database || !projectId) return { success: false, error: 'Database unavailable' };

  const valueBytes = new Blob([value]).size;
  if (valueBytes > MAX_PREVIEW_STORAGE_VALUE_BYTES) {
    return {
      success: false,
      error: `Value size (${Math.round(valueBytes / 1024)} KB) exceeds the 200 KB preview limit.`,
    };
  }

  try {
    const currentItems = await database.previewStorage.where('projectId').equals(projectId).toArray();
    let totalBytes = 0;
    for (const item of currentItems) {
      if (item.key !== key) {
        totalBytes += new Blob([item.key, item.value]).size;
      }
    }
    totalBytes += new Blob([key, value]).size;

    if (totalBytes > MAX_PREVIEW_STORAGE_TOTAL_BYTES) {
      return {
        success: false,
        error: `Total project preview storage limit (1 MB) exceeded.`,
      };
    }

    await database.previewStorage.put({
      projectId,
      key,
      value,
    });
    return { success: true };
  } catch (error) {
    console.error(`[DESYRA DB] Failed to set preview storage item ${key}:`, error);
    return { success: false, error: 'Failed to write to preview storage.' };
  }
}

/**
 * Removes a key from preview storage.
 */
export async function removePreviewStorageItem(projectId: string, key: string): Promise<void> {
  const database = getDb();
  if (!database || !projectId) return;
  try {
    await database.previewStorage.delete([projectId, key]);
  } catch (error) {
    console.error(`[DESYRA DB] Failed to remove preview storage item ${key}:`, error);
  }
}

/**
 * Clears all preview storage data for a project.
 */
export async function clearPreviewStorage(projectId: string): Promise<void> {
  const database = getDb();
  if (!database || !projectId) return;
  try {
    await database.previewStorage.where('projectId').equals(projectId).delete();
  } catch (error) {
    console.error(`[DESYRA DB] Failed to clear preview storage for project ${projectId}:`, error);
  }
}

/**
 * Retrieves custom model setting (e.g. maxOutputTokens) for a provider and model.
 */
export async function getModelSetting(
  providerId: string,
  modelId: string
): Promise<ModelSetting | undefined> {
  const database = getDb();
  if (!database) return undefined;
  try {
    return await database.modelSettings
      .where('[providerId+modelId]')
      .equals([providerId, modelId])
      .first();
  } catch (error) {
    console.error(`[DESYRA DB] Failed to get model setting for ${providerId}/${modelId}:`, error);
    return undefined;
  }
}

/**
 * Saves or updates custom model setting (maxOutputTokens) for a provider and model.
 * If maxOutputTokens is undefined or empty, clears the setting.
 */
export async function setModelSetting(
  providerId: string,
  modelId: string,
  maxOutputTokens?: number
): Promise<void> {
  const database = getDb();
  if (!database) return;
  try {
    const existing = await database.modelSettings
      .where('[providerId+modelId]')
      .equals([providerId, modelId])
      .first();

    if (maxOutputTokens === undefined || maxOutputTokens === null || isNaN(maxOutputTokens)) {
      if (existing?.id) {
        await database.modelSettings.delete(existing.id);
      }
      return;
    }

    const now = Date.now();
    if (existing?.id) {
      await database.modelSettings.update(existing.id, {
        maxOutputTokens,
        updatedAt: now,
      });
    } else {
      await database.modelSettings.add({
        providerId,
        modelId,
        maxOutputTokens,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    console.error(`[DESYRA DB] Failed to set model setting for ${providerId}/${modelId}:`, error);
  }
}

const AUTO_CONTINUE_KEY = 'desyra_auto_continue_incomplete';

/**
 * Checks whether auto-continue is enabled for incomplete builds (defaults to true).
 */
export async function getAutoContinueEnabled(): Promise<boolean> {
  const database = getDb();
  if (!database) {
    if (typeof window !== 'undefined') {
      const val = localStorage.getItem(AUTO_CONTINUE_KEY);
      return val === null ? true : val === 'true';
    }
    return true;
  }
  try {
    const item = await database.meta.get(AUTO_CONTINUE_KEY);
    if (!item) return true;
    return Boolean(item.value);
  } catch {
    return true;
  }
}

/**
 * Updates auto-continue setting.
 */
export async function setAutoContinueEnabled(enabled: boolean): Promise<void> {
  const database = getDb();
  if (typeof window !== 'undefined') {
    localStorage.setItem(AUTO_CONTINUE_KEY, String(enabled));
  }
  if (!database) return;
  try {
    await database.meta.put({
      key: AUTO_CONTINUE_KEY,
      value: enabled,
    });
  } catch (error) {
    console.error('[DESYRA DB] Failed to set auto-continue setting:', error);
  }
}

const DESIGN_QUALITY_KEY = 'desyra_design_quality';
const REVIEW_BEFORE_BUILD_KEY = 'desyra_review_design_before_build';
const RUN_CRITIC_AUTO_KEY = 'desyra_run_critic_automatically';

/**
 * Gets design quality setting ('fast' | 'standard' | 'best'). Defaults to 'standard'.
 */
export async function getDesignQualitySetting(): Promise<DesignQuality> {
  const database = getDb();
  if (!database) {
    if (typeof window !== 'undefined') {
      const val = localStorage.getItem(DESIGN_QUALITY_KEY);
      if (val === 'fast' || val === 'standard' || val === 'best') return val;
    }
    return 'standard';
  }
  try {
    const item = await database.meta.get(DESIGN_QUALITY_KEY);
    if (item && (item.value === 'fast' || item.value === 'standard' || item.value === 'best')) {
      return item.value;
    }
    return 'standard';
  } catch {
    return 'standard';
  }
}

/**
 * Updates design quality setting.
 */
export async function setDesignQualitySetting(quality: DesignQuality): Promise<void> {
  const database = getDb();
  if (typeof window !== 'undefined') {
    localStorage.setItem(DESIGN_QUALITY_KEY, quality);
  }
  if (!database) return;
  try {
    await database.meta.put({
      key: DESIGN_QUALITY_KEY,
      value: quality,
    });
  } catch (error) {
    console.error('[DESYRA DB] Failed to set design quality setting:', error);
  }
}

/**
 * Checks whether user wants to review design before building (defaults to true).
 */
export async function getReviewDesignBeforeBuild(): Promise<boolean> {
  const database = getDb();
  if (!database) {
    if (typeof window !== 'undefined') {
      const val = localStorage.getItem(REVIEW_BEFORE_BUILD_KEY);
      return val === null ? true : val === 'true';
    }
    return true;
  }
  try {
    const item = await database.meta.get(REVIEW_BEFORE_BUILD_KEY);
    if (!item) return true;
    return Boolean(item.value);
  } catch {
    return true;
  }
}

/**
 * Updates review design before building setting.
 */
export async function setReviewDesignBeforeBuild(enabled: boolean): Promise<void> {
  const database = getDb();
  if (typeof window !== 'undefined') {
    localStorage.setItem(REVIEW_BEFORE_BUILD_KEY, String(enabled));
  }
  if (!database) return;
  try {
    await database.meta.put({
      key: REVIEW_BEFORE_BUILD_KEY,
      value: enabled,
    });
  } catch (error) {
    console.error('[DESYRA DB] Failed to set review design before build setting:', error);
  }
}

/**
 * Checks whether AI design critic runs automatically after first build.
 * Default ON only for 'best' quality if not explicitly set.
 */
export async function getRunCriticAutomatically(): Promise<boolean> {
  const database = getDb();
  let explicitValue: boolean | null = null;

  if (database) {
    try {
      const item = await database.meta.get(RUN_CRITIC_AUTO_KEY);
      if (item && item.value !== undefined) {
        explicitValue = Boolean(item.value);
      }
    } catch {
      // Fallback
    }
  } else if (typeof window !== 'undefined') {
    const val = localStorage.getItem(RUN_CRITIC_AUTO_KEY);
    if (val !== null) {
      explicitValue = val === 'true';
    }
  }

  if (explicitValue !== null) {
    return explicitValue;
  }

  // Default ON only for 'best'
  const quality = await getDesignQualitySetting();
  return quality === 'best';
}

/**
 * Updates run critic automatically setting.
 */
export async function setRunCriticAutomatically(enabled: boolean): Promise<void> {
  const database = getDb();
  if (typeof window !== 'undefined') {
    localStorage.setItem(RUN_CRITIC_AUTO_KEY, String(enabled));
  }
  if (!database) return;
  try {
    await database.meta.put({
      key: RUN_CRITIC_AUTO_KEY,
      value: enabled,
    });
  } catch (error) {
    console.error('[DESYRA DB] Failed to set run critic automatically setting:', error);
  }
}

const LAST_BACKUP_AT_KEY = 'desyra_last_backup_at';
const BACKUP_REMINDER_DISMISSED_AT_KEY = 'desyra_backup_reminder_dismissed_at';
const HISTORY_TRIM_NOTIFIED_KEY = 'desyra_history_trim_notified';

export async function getLastBackupAt(): Promise<number | null> {
  return getMetaValue<number>(LAST_BACKUP_AT_KEY);
}

export async function setLastBackupAt(timestamp = Date.now()): Promise<void> {
  await setMetaValue(LAST_BACKUP_AT_KEY, timestamp);
}

export async function getBackupReminderDismissedAt(): Promise<number | null> {
  return getMetaValue<number>(BACKUP_REMINDER_DISMISSED_AT_KEY);
}

export async function setBackupReminderDismissedAt(timestamp = Date.now()): Promise<void> {
  await setMetaValue(BACKUP_REMINDER_DISMISSED_AT_KEY, timestamp);
}

export async function getHistoryTrimNotified(): Promise<boolean> {
  const val = await getMetaValue<boolean>(HISTORY_TRIM_NOTIFIED_KEY);
  return Boolean(val);
}

export async function setHistoryTrimNotified(val = true): Promise<void> {
  await setMetaValue(HISTORY_TRIM_NOTIFIED_KEY, val);
}

export type PersistentStorageStatus = 'granted' | 'denied' | 'unsupported';

export async function getPersistentStorageStatus(): Promise<PersistentStorageStatus> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.persisted !== 'function'
  ) {
    return 'unsupported';
  }
  try {
    const persisted = await navigator.storage.persisted();
    return persisted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestPersistentStorageSafe(): Promise<PersistentStorageStatus> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return 'unsupported';
  }
  try {
    const granted = await navigator.storage.persist();
    return granted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}
