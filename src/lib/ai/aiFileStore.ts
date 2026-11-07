'use client';

import { useSyncExternalStore } from 'react';

type Listener = () => void;

interface WritingEntry {
  projectId: string;
  path: string;
  content: string;
}

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
    let set = this.latestChanged.get(projectId);
    if (!set) {
      set = new Set();
      this.latestChanged.set(projectId, set);
    }
    set.add(path);
    this.emitChange();
  }

  clearChanged(projectId: string, path: string) {
    const set = this.latestChanged.get(projectId);
    if (set && set.has(path)) {
      set.delete(path);
      this.emitChange();
    }
  }

  clearAllChanged(projectId: string) {
    const set = this.latestChanged.get(projectId);
    if (set && set.size > 0) {
      set.clear();
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
    return this.latestChanged.get(projectId) || new Set();
  }

  getSnapshot = () => {
    // Version token for useSyncExternalStore
    return Array.from(this.writingFiles.keys()).join(',') +
      '|' +
      Array.from(this.revisions.entries()).map(([k, v]) => `${k}:${v}`).join(',') +
      '|' +
      Array.from(this.latestChanged.entries()).map(([k, set]) => `${k}:${Array.from(set).join(';')}`).join(',');
  };
}

export const aiFileStore = new AiFileStore();

export function useIsWritingFile(projectId: string, path?: string | null): boolean {
  return useSyncExternalStore(
    aiFileStore.subscribe,
    () => (path ? aiFileStore.isWriting(projectId, path) : false),
    () => false
  );
}

export function useWritingContent(projectId: string, path?: string | null): string | null {
  return useSyncExternalStore(
    aiFileStore.subscribe,
    () => (path ? aiFileStore.getWritingContent(projectId, path) : null),
    () => null
  );
}

export function useLatestChangedFiles(projectId: string): Set<string> {
  return useSyncExternalStore(
    aiFileStore.subscribe,
    () => aiFileStore.getLatestChangedSet(projectId),
    () => new Set<string>()
  );
}

export function useProjectFileRevision(projectId: string): number {
  return useSyncExternalStore(
    aiFileStore.subscribe,
    () => aiFileStore.getRevision(projectId),
    () => 0
  );
}
