import Dexie, { type Table } from 'dexie';
import { notify } from '@/components/ui/toast';
import type { ProviderType } from '@/lib/providers';
import type { EncryptedPayload } from '@/lib/crypto';
import type { DesignSpec } from '@/lib/design/types';

export interface Project {
  id: string;
  title: string;
  idea: string;
  createdAt: number;
  updatedAt: number;
  autoStarted?: boolean;
  design?: DesignSpec;
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
  models: any[];
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
}

export interface MetaItem {
  key: string;
  value: any;
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

export const MAX_PREVIEW_STORAGE_TOTAL_BYTES = 1024 * 1024; // 1 MB cap
export const MAX_PREVIEW_STORAGE_VALUE_BYTES = 200 * 1024; // 200 KB per value cap

export class DesyraDatabase extends Dexie {
  projects!: Table<Project, string>;
  providers!: Table<StoredProvider, string>;
  meta!: Table<MetaItem, string>;
  modelCache!: Table<StoredModelCache, string>;
  messages!: Table<StoredMessage, string>;
  files!: Table<ProjectFile, string>;
  previewStorage!: Table<PreviewStorageItem, [string, string]>;
  modelSettings!: Table<ModelSetting, number>;

  constructor() {
    super('desyra_db');
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
      projects: 'id, title, createdAt, updatedAt, autoStarted',
      providers: 'id, providerType, label, isDefault, createdAt, updatedAt, defaultModel, lastTestStatus',
      meta: 'key',
      modelCache: 'providerId, fetchedAt',
      messages: 'id, projectId, createdAt, role',
      files: 'id, projectId, path, [projectId+path], createdAt, updatedAt',
      previewStorage: '[projectId+key], projectId',
      modelSettings: '++id, [providerId+modelId], providerId, modelId',
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
    await database.projects.add(project);
    return project;
  } catch (error) {
    console.error('[DESYRA DB] Failed to create project:', error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Failed to save your project to local storage.',
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
      updatedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to update project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: `Failed to update project with ID ${id}.`,
    });
    return false;
  }
}

/**
 * Deletes a project by ID.
 */
export async function deleteProject(id: string): Promise<boolean> {
  const database = getDb();
  if (!database || !id) return false;

  try {
    await database.projects.delete(id);
    await database.files.where('projectId').equals(id).delete();
    await database.messages.where('projectId').equals(id).delete();
    await database.previewStorage.where('projectId').equals(id).delete();
    return true;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to delete project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Could not delete project from local storage.',
    });
    return false;
  }
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
    await database.projects.clear();
    await database.providers.clear();
    await database.meta.clear();
    await database.modelCache.clear();
    await database.messages.clear();
    await database.files.clear();
    await database.previewStorage.clear();
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

export async function setModelCache(providerId: string, models: any[]): Promise<void> {
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

