/**
 * Storage adapter abstraction for DESYRA version history and project operations.
 * Wraps Dexie IndexedDB in browser sessions and offers a rollback-safe
 * in-memory transactional adapter for unit tests.
 */

import {
  getDb,
  gcBlobsInTransaction,
  getFriendlyStorageErrorMessage,
  type DesyraDatabase,
  type Project,
  type ProjectFile,
  type SnapshotRecord,
  type BlobRecord,
  type StoredMessage,
} from '@/lib/db';

export type StorageTableScope =
  | 'projects'
  | 'files'
  | 'messages'
  | 'snapshots'
  | 'blobs'
  | 'previewStorage';

export interface HistoryStorageAdapter {
  transaction<T>(
    mode: 'r' | 'rw',
    tables: StorageTableScope[],
    fn: () => Promise<T>
  ): Promise<T>;
  getProject(id: string): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;
  addProject(project: Project): Promise<void>;
  updateProject(id: string, updates: Partial<Project>): Promise<void>;
  deleteProjectRecord(id: string): Promise<void>;

  listProjectFiles(projectId: string): Promise<ProjectFile[]>;
  putFile(file: ProjectFile): Promise<void>;
  bulkPutFiles(files: ProjectFile[]): Promise<void>;
  bulkDeleteFileIds(ids: string[]): Promise<void>;
  deleteFilesByProject(projectId: string): Promise<void>;

  listProjectMessages(projectId: string): Promise<StoredMessage[]>;
  bulkPutMessages(messages: StoredMessage[]): Promise<void>;
  deleteMessagesByProject(projectId: string): Promise<void>;
  deletePreviewStorageByProject(projectId: string): Promise<void>;
  updateMessageSnapshot(messageId: string, snapshotId: string): Promise<void>;

  listProjectSnapshots(projectId: string): Promise<SnapshotRecord[]>;
  listAllSnapshots(): Promise<SnapshotRecord[]>;
  getSnapshot(snapshotId: string): Promise<SnapshotRecord | undefined>;
  putSnapshot(snapshot: SnapshotRecord): Promise<void>;
  bulkPutSnapshots(snapshots: SnapshotRecord[]): Promise<void>;
  updateSnapshot(snapshotId: string, updates: Partial<SnapshotRecord>): Promise<void>;
  bulkDeleteSnapshots(ids: string[]): Promise<void>;
  deleteSnapshotsByProject(projectId: string): Promise<void>;

  getBlobs(hashes: string[]): Promise<BlobRecord[]>;
  putBlobs(blobs: BlobRecord[]): Promise<void>;
  listAllBlobHashes(): Promise<string[]>;
  deleteBlobs(hashes: string[]): Promise<void>;
  gcBlobs(): Promise<number>;

  runOrphanIntegrityCleanup(): Promise<{
    deletedSnapshots: number;
    deletedFiles: number;
    deletedMessages: number;
    deletedPreviewEntries: number;
    deletedBlobs: number;
  }>;
}

function getScopeTables(db: DesyraDatabase, scopes: StorageTableScope[]) {
  const map = {
    projects: db.projects,
    files: db.files,
    messages: db.messages,
    snapshots: db.snapshots,
    blobs: db.blobs,
    previewStorage: db.previewStorage,
  } as const;
  return scopes.map((s) => map[s]);
}

export function createDexieHistoryAdapter(customDb?: DesyraDatabase): HistoryStorageAdapter {
  const resolveDb = (): DesyraDatabase => {
    const db = customDb ?? getDb();
    if (!db) {
      throw new Error('IndexedDB database is unavailable.');
    }
    return db;
  };

  return {
    async transaction<T>(
      mode: 'r' | 'rw',
      tables: StorageTableScope[],
      fn: () => Promise<T>
    ): Promise<T> {
      const db = resolveDb();
      try {
        return await db.transaction(mode, getScopeTables(db, tables), fn);
      } catch (err) {
        throw new Error(getFriendlyStorageErrorMessage(err, 'Storage transaction failed.'));
      }
    },

    async getProject(id: string) {
      return resolveDb().projects.get(id);
    },

    async listProjects() {
      return resolveDb().projects.toArray();
    },

    async addProject(project: Project) {
      await resolveDb().projects.add(project);
    },

    async updateProject(id: string, updates: Partial<Project>) {
      await resolveDb().projects.update(id, updates);
    },

    async deleteProjectRecord(id: string) {
      await resolveDb().projects.delete(id);
    },

    async listProjectFiles(projectId: string) {
      return resolveDb().files.where('projectId').equals(projectId).sortBy('path');
    },

    async putFile(file: ProjectFile) {
      await resolveDb().files.put(file);
    },

    async bulkPutFiles(files: ProjectFile[]) {
      if (files.length > 0) {
        await resolveDb().files.bulkPut(files);
      }
    },

    async bulkDeleteFileIds(ids: string[]) {
      if (ids.length > 0) {
        await resolveDb().files.bulkDelete(ids);
      }
    },

    async deleteFilesByProject(projectId: string) {
      await resolveDb().files.where('projectId').equals(projectId).delete();
    },

    async listProjectMessages(projectId: string) {
      return resolveDb().messages.where('projectId').equals(projectId).sortBy('createdAt');
    },

    async bulkPutMessages(messages: StoredMessage[]) {
      if (messages.length > 0) {
        await resolveDb().messages.bulkPut(messages);
      }
    },

    async deleteMessagesByProject(projectId: string) {
      await resolveDb().messages.where('projectId').equals(projectId).delete();
    },

    async deletePreviewStorageByProject(projectId: string) {
      await resolveDb().previewStorage.where('projectId').equals(projectId).delete();
    },

    async updateMessageSnapshot(messageId: string, snapshotId: string) {
      await resolveDb().messages.update(messageId, { snapshotId });
    },

    async listProjectSnapshots(projectId: string) {
      const rows = await resolveDb().snapshots.where('projectId').equals(projectId).toArray();
      rows.sort((a, b) => b.createdAt - a.createdAt);
      return rows;
    },

    async listAllSnapshots() {
      return resolveDb().snapshots.toArray();
    },

    async getSnapshot(snapshotId: string) {
      return resolveDb().snapshots.get(snapshotId);
    },

    async putSnapshot(snapshot: SnapshotRecord) {
      await resolveDb().snapshots.put(snapshot);
    },

    async bulkPutSnapshots(snapshots: SnapshotRecord[]) {
      if (snapshots.length > 0) {
        await resolveDb().snapshots.bulkPut(snapshots);
      }
    },

    async updateSnapshot(snapshotId: string, updates: Partial<SnapshotRecord>) {
      await resolveDb().snapshots.update(snapshotId, updates);
    },

    async bulkDeleteSnapshots(ids: string[]) {
      if (ids.length > 0) {
        await resolveDb().snapshots.bulkDelete(ids);
      }
    },

    async deleteSnapshotsByProject(projectId: string) {
      await resolveDb().snapshots.where('projectId').equals(projectId).delete();
    },

    async getBlobs(hashes: string[]) {
      if (hashes.length === 0) return [];
      const rows = await resolveDb().blobs.bulkGet(hashes);
      return rows.filter((b): b is BlobRecord => Boolean(b));
    },

    async putBlobs(blobs: BlobRecord[]) {
      if (blobs.length > 0) {
        await resolveDb().blobs.bulkPut(blobs);
      }
    },

    async listAllBlobHashes() {
      return resolveDb().blobs.toCollection().primaryKeys();
    },

    async deleteBlobs(hashes: string[]) {
      if (hashes.length > 0) {
        await resolveDb().blobs.bulkDelete(hashes);
      }
    },

    async gcBlobs() {
      return gcBlobsInTransaction(resolveDb());
    },

    async runOrphanIntegrityCleanup() {
      const db = resolveDb();
      const projectIds = new Set(await db.projects.toCollection().primaryKeys());

      let deletedSnapshots = 0;
      const orphanSnapIds: string[] = [];
      await db.snapshots.each((snap) => {
        if (!projectIds.has(snap.projectId)) {
          orphanSnapIds.push(snap.id);
        }
      });
      if (orphanSnapIds.length > 0) {
        await db.snapshots.bulkDelete(orphanSnapIds);
        deletedSnapshots = orphanSnapIds.length;
      }

      const orphanFileIds: string[] = [];
      await db.files.each((file) => {
        if (!projectIds.has(file.projectId)) {
          orphanFileIds.push(file.id);
        }
      });
      if (orphanFileIds.length > 0) {
        await db.files.bulkDelete(orphanFileIds);
      }

      const orphanMessageIds: string[] = [];
      await db.messages.each((msg) => {
        if (!projectIds.has(msg.projectId)) {
          orphanMessageIds.push(msg.id);
        }
      });
      if (orphanMessageIds.length > 0) {
        await db.messages.bulkDelete(orphanMessageIds);
      }

      const orphanPreviewKeys: [string, string][] = [];
      await db.previewStorage.each((item) => {
        if (!projectIds.has(item.projectId)) {
          orphanPreviewKeys.push([item.projectId, item.key]);
        }
      });
      if (orphanPreviewKeys.length > 0) {
        await db.previewStorage.bulkDelete(orphanPreviewKeys);
      }

      const deletedBlobs = await gcBlobsInTransaction(db);

      return {
        deletedSnapshots,
        deletedFiles: orphanFileIds.length,
        deletedMessages: orphanMessageIds.length,
        deletedPreviewEntries: orphanPreviewKeys.length,
        deletedBlobs,
      };
    },
  };
}

/**
 * Safe structured deep clone utility that works across all environments.
 */
export function cloneData<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface MemoryAdapterState {
  projects: Map<string, Project>;
  files: Map<string, ProjectFile>;
  messages: Map<string, StoredMessage>;
  previewStorage: Map<string, { projectId: string; key: string; value: string }>;
  snapshots: Map<string, SnapshotRecord>;
  blobs: Map<string, BlobRecord>;
}

export interface MemoryHistoryAdapter extends HistoryStorageAdapter {
  state: MemoryAdapterState;
  setPreCommitHook(hook: ((step: string) => void) | null): void;
}

/**
 * In-memory atomic transactional adapter matching Dexie semantics for fast deterministic Vitest runs.
 * Rolls back ALL table mutations automatically if an error is thrown inside `transaction('rw', ...)`.
 */
export function createMemoryHistoryAdapter(): MemoryHistoryAdapter {
  const state: MemoryAdapterState = {
    projects: new Map(),
    files: new Map(),
    messages: new Map(),
    previewStorage: new Map(),
    snapshots: new Map(),
    blobs: new Map(),
  };

  let preCommitHook: ((step: string) => void) | null = null;

  return {
    state,
    setPreCommitHook(hook) {
      preCommitHook = hook;
    },

    async transaction<T>(
      mode: 'r' | 'rw',
      _tables: StorageTableScope[],
      fn: () => Promise<T>
    ): Promise<T> {
      if (mode === 'r') {
        return fn();
      }

      // Take full pre-transaction deep copy for true atomic rollback on failure
      const backupProjects = cloneData(Array.from(state.projects.entries()));
      const backupFiles = cloneData(Array.from(state.files.entries()));
      const backupMessages = cloneData(Array.from(state.messages.entries()));
      const backupPreview = cloneData(Array.from(state.previewStorage.entries()));
      const backupSnapshots = cloneData(Array.from(state.snapshots.entries()));
      const backupBlobs = cloneData(Array.from(state.blobs.entries()));

      try {
        const res = await fn();
        if (preCommitHook) {
          preCommitHook('before_commit');
        }
        return res;
      } catch (err) {
        state.projects = new Map(backupProjects);
        state.files = new Map(backupFiles);
        state.messages = new Map(backupMessages);
        state.previewStorage = new Map(backupPreview);
        state.snapshots = new Map(backupSnapshots);
        state.blobs = new Map(backupBlobs);
        throw err;
      }
    },

    async getProject(id: string) {
      const p = state.projects.get(id);
      return p ? cloneData(p) : undefined;
    },

    async listProjects() {
      return Array.from(state.projects.values()).map((p) => cloneData(p));
    },

    async addProject(project: Project) {
      state.projects.set(project.id, cloneData(project));
    },

    async updateProject(id: string, updates: Partial<Project>) {
      const existing = state.projects.get(id);
      if (!existing) return;
      const merged = { ...existing, ...updates };
      if ('design' in updates && updates.design === undefined) {
        delete merged.design;
      }
      state.projects.set(id, cloneData(merged));
    },

    async deleteProjectRecord(id: string) {
      state.projects.delete(id);
    },

    async listProjectFiles(projectId: string) {
      return Array.from(state.files.values())
        .filter((f) => f.projectId === projectId)
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => cloneData(f));
    },

    async putFile(file: ProjectFile) {
      state.files.set(file.id, cloneData(file));
    },

    async bulkPutFiles(files: ProjectFile[]) {
      for (const f of files) {
        state.files.set(f.id, cloneData(f));
      }
    },

    async bulkDeleteFileIds(ids: string[]) {
      for (const id of ids) {
        state.files.delete(id);
      }
    },

    async deleteFilesByProject(projectId: string) {
      for (const [id, f] of state.files.entries()) {
        if (f.projectId === projectId) {
          state.files.delete(id);
        }
      }
    },

    async listProjectMessages(projectId: string) {
      return Array.from(state.messages.values())
        .filter((m) => m.projectId === projectId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => cloneData(m));
    },

    async bulkPutMessages(messages: StoredMessage[]) {
      for (const m of messages) {
        state.messages.set(m.id, cloneData(m));
      }
    },

    async deleteMessagesByProject(projectId: string) {
      for (const [id, m] of state.messages.entries()) {
        if (m.projectId === projectId) {
          state.messages.delete(id);
        }
      }
    },

    async deletePreviewStorageByProject(projectId: string) {
      for (const [k, item] of state.previewStorage.entries()) {
        if (item.projectId === projectId) {
          state.previewStorage.delete(k);
        }
      }
    },

    async updateMessageSnapshot(messageId: string, snapshotId: string) {
      const m = state.messages.get(messageId);
      if (m) {
        m.snapshotId = snapshotId;
      }
    },

    async listProjectSnapshots(projectId: string) {
      return Array.from(state.snapshots.values())
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => cloneData(s));
    },

    async listAllSnapshots() {
      return Array.from(state.snapshots.values()).map((s) => cloneData(s));
    },

    async getSnapshot(snapshotId: string) {
      const s = state.snapshots.get(snapshotId);
      return s ? cloneData(s) : undefined;
    },

    async putSnapshot(snapshot: SnapshotRecord) {
      state.snapshots.set(snapshot.id, cloneData(snapshot));
    },

    async bulkPutSnapshots(snapshots: SnapshotRecord[]) {
      for (const s of snapshots) {
        state.snapshots.set(s.id, cloneData(s));
      }
    },

    async updateSnapshot(snapshotId: string, updates: Partial<SnapshotRecord>) {
      const s = state.snapshots.get(snapshotId);
      if (s) {
        state.snapshots.set(snapshotId, cloneData({ ...s, ...updates }));
      }
    },

    async bulkDeleteSnapshots(ids: string[]) {
      for (const id of ids) {
        state.snapshots.delete(id);
      }
    },

    async deleteSnapshotsByProject(projectId: string) {
      for (const [id, s] of state.snapshots.entries()) {
        if (s.projectId === projectId) {
          state.snapshots.delete(id);
        }
      }
    },

    async getBlobs(hashes: string[]) {
      const res: BlobRecord[] = [];
      for (const h of hashes) {
        const b = state.blobs.get(h);
        if (b) res.push(cloneData(b));
      }
      return res;
    },

    async putBlobs(blobs: BlobRecord[]) {
      for (const b of blobs) {
        state.blobs.set(b.hash, cloneData(b));
      }
    },

    async listAllBlobHashes() {
      return Array.from(state.blobs.keys());
    },

    async deleteBlobs(hashes: string[]) {
      for (const h of hashes) {
        state.blobs.delete(h);
      }
    },

    async gcBlobs() {
      const referenced = new Set<string>();
      for (const snap of state.snapshots.values()) {
        for (const hash of Object.values(snap.manifest)) {
          referenced.add(hash);
        }
      }
      let deleted = 0;
      for (const hash of Array.from(state.blobs.keys())) {
        if (!referenced.has(hash)) {
          state.blobs.delete(hash);
          deleted++;
        }
      }
      return deleted;
    },

    async runOrphanIntegrityCleanup() {
      const projectIds = new Set(state.projects.keys());
      let deletedSnapshots = 0;
      for (const [id, snap] of Array.from(state.snapshots.entries())) {
        if (!projectIds.has(snap.projectId)) {
          state.snapshots.delete(id);
          deletedSnapshots++;
        }
      }

      let deletedFiles = 0;
      for (const [id, f] of Array.from(state.files.entries())) {
        if (!projectIds.has(f.projectId)) {
          state.files.delete(id);
          deletedFiles++;
        }
      }

      let deletedMessages = 0;
      for (const [id, m] of Array.from(state.messages.entries())) {
        if (!projectIds.has(m.projectId)) {
          state.messages.delete(id);
          deletedMessages++;
        }
      }

      let deletedPreviewEntries = 0;
      for (const [k, item] of Array.from(state.previewStorage.entries())) {
        if (!projectIds.has(item.projectId)) {
          state.previewStorage.delete(k);
          deletedPreviewEntries++;
        }
      }

      const deletedBlobs = await this.gcBlobs();
      return {
        deletedSnapshots,
        deletedFiles,
        deletedMessages,
        deletedPreviewEntries,
        deletedBlobs,
      };
    },
  };
}
