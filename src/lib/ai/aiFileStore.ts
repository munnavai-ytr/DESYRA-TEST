'use client';

import { useSyncExternalStore, useCallback } from 'react';

type Listener = () => void;

interface WritingEntry {
  projectId: string;
  path: string;
  content: string;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

class AiFileStore {
  private writingFiles = new Map<string, WritingEntry>();
  private latestChanged = new Map<string, Set<string>>();
  private revisions = new Map<string, number>();
  private listeners = new Set<Listener>();

  private emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private makeKey(projectId: string, path: string) {
    return `${projectId}:${path}`;
  }

  setFileWriting(projectId: string, path: string, initialContent: string = '') {
    const key = this.makeKey(projectId, path);
    this.writingFiles.set(key, { projectId, path, content: initialContent });
    this.emitChange();
  }

  appendFileContent(projectId: string, path: string, chunk: string) {
    const key = this.makeKey(projectId, path);
    const existing = this.writingFiles.get(key);
    if (existing) {
      existing.content += chunk;
      this.emitChange();
    } else {
      this.writingFiles.set(key, { projectId, path, content: chunk });
      this.emitChange();
    }
  }

  clearFileWriting(projectId: string, path: string) {
    const key = this.makeKey(projectId, path);
    if (this.writingFiles.has(key)) {
      this.writingFiles.delete(key);
      this.emitChange();
    }
  }

  clearAllWritingForProject(projectId: string) {
    let changed = false;
    for (const [key, entry] of this.writingFiles.entries()) {
      if (entry.projectId === projectId) {
        this.writingFiles.delete(key);
        changed = true;
      }
    }
    if (changed) this.emitChange();
  }

  isWriting(projectId: string, path: string): boolean {
    return this.writingFiles.has(this.makeKey(projectId, path));
  }

  getWritingContent(projectId: string, path: string): string | null {
    const entry = this.writingFiles.get(this.makeKey(projectId, path));
    return entry ? entry.content : null;
  }

  markChanged(projectId: string, path: string) {
    const current = this.latestChanged.get(projectId) || (EMPTY_SET as Set<string>);
    if (!current.has(path)) {
      const next = new Set(current);
      next.add(path);
      this.latestChanged.set(projectId, next);
      this.emitChange();
    }
  }

  clearChanged(projectId: string, path: string) {
    const current = this.latestChanged.get(projectId);
    if (current && current.has(path)) {
      const next = new Set(current);
      next.delete(path);
      this.latestChanged.set(projectId, next.size > 0 ? next : (EMPTY_SET as Set<string>));
      this.emitChange();
    }
  }

  clearAllChanged(projectId: string) {
    const current = this.latestChanged.get(projectId);
    if (current && current.size > 0) {
      this.latestChanged.set(projectId, EMPTY_SET as Set<string>);
      this.emitChange();
    }
  }

  isChanged(projectId: string, path: string): boolean {
    const set = this.latestChanged.get(projectId);
    return set ? set.has(path) : false;
  }

  bumpRevision(projectId: string) {
    const current = this.revisions.get(projectId) || 0;
    this.revisions.set(projectId, current + 1);
    this.emitChange();
  }

  getRevision(projectId: string): number {
    return this.revisions.get(projectId) || 0;
  }

  getLatestChangedSet(projectId: string): Set<string> {
    return this.latestChanged.get(projectId) || (EMPTY_SET as Set<string>);
  }
}

export const aiFileStore = new AiFileStore();

const getServerSnapshotFalse = () => false;
const getServerSnapshotNull = () => null;
const getServerSnapshotEmptySet = () => EMPTY_SET as Set<string>;
const getServerSnapshotZero = () => 0;

export function useIsWritingFile(projectId: string, path?: string | null): boolean {
  const getSnapshot = useCallback(
    () => (path ? aiFileStore.isWriting(projectId, path) : false),
    [projectId, path]
  );
  return useSyncExternalStore(
    aiFileStore.subscribe,
    getSnapshot,
    getServerSnapshotFalse
  );
}

export function useWritingContent(projectId: string, path?: string | null): string | null {
  const getSnapshot = useCallback(
    () => (path ? aiFileStore.getWritingContent(projectId, path) : null),
    [projectId, path]
  );
  return useSyncExternalStore(
    aiFileStore.subscribe,
    getSnapshot,
    getServerSnapshotNull
  );
}

export function useLatestChangedFiles(projectId: string): Set<string> {
  const getSnapshot = useCallback(
    () => aiFileStore.getLatestChangedSet(projectId),
    [projectId]
  );
  return useSyncExternalStore(
    aiFileStore.subscribe,
    getSnapshot,
    getServerSnapshotEmptySet
  );
}

export function useProjectFileRevision(projectId: string): number {
  const getSnapshot = useCallback(
    () => aiFileStore.getRevision(projectId),
    [projectId]
  );
  return useSyncExternalStore(
    aiFileStore.subscribe,
    getSnapshot,
    getServerSnapshotZero
  );
}
