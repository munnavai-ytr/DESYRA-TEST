'use client';

import { useSyncExternalStore, useCallback } from 'react';

type Listener = () => void;
export type ContentListener = (content: string, appendedChunk: string) => void;

interface WritingEntry {
  projectId: string;
  path: string;
  content: string;
  pendingChunk: string;
  lastEmitTime: number;
  throttleTimer: NodeJS.Timeout | null;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
export const CONTENT_THROTTLE_MS = 250;

class AiFileStore {
  private writingFiles = new Map<string, WritingEntry>();
  private latestChanged = new Map<string, Set<string>>();
  private revisions = new Map<string, number>();

  // Structure listeners: for bumpRevision, markChanged, clearChanged
  private structureListeners = new Set<Listener>();

  // Per-path writing state listeners: only triggers when isWriting changes for that specific key
  private pathWritingListeners = new Map<string, Set<Listener>>();

  // Per-path content listeners: throttled at <=250ms
  private contentListeners = new Map<string, Set<ContentListener>>();

  private makeKey(projectId: string, path: string) {
    return `${projectId}:${path}`;
  }

  // Subscribe to general structure changes (revisions, latestChanged set)
  subscribeStructure = (listener: Listener) => {
    this.structureListeners.add(listener);
    return () => {
      this.structureListeners.delete(listener);
    };
  };

  // Backwards compatibility alias for subscribeStructure
  subscribe = this.subscribeStructure;

  // Subscribe to isWriting changes for a specific path
  subscribePathWriting = (projectId: string, path: string, listener: Listener) => {
    const key = this.makeKey(projectId, path);
    let set = this.pathWritingListeners.get(key);
    if (!set) {
      set = new Set<Listener>();
      this.pathWritingListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.pathWritingListeners.delete(key);
      }
    };
  };

  // Subscribe to incremental content changes for a specific path (throttled at <=250ms)
  subscribeContent = (
    projectId: string,
    path: string,
    listener: ContentListener
  ) => {
    const key = this.makeKey(projectId, path);
    let set = this.contentListeners.get(key);
    if (!set) {
      set = new Set<ContentListener>();
      this.contentListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.contentListeners.delete(key);
      }
    };
  };

  private emitStructureChange() {
    for (const listener of this.structureListeners) {
      listener();
    }
  }

  private emitPathWritingChange(key: string) {
    const listeners = this.pathWritingListeners.get(key);
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
  }

  private emitContent(key: string, entry: WritingEntry) {
    const chunkToEmit = entry.pendingChunk;
    entry.pendingChunk = '';
    entry.lastEmitTime = Date.now();
    if (entry.throttleTimer) {
      clearTimeout(entry.throttleTimer);
      entry.throttleTimer = null;
    }

    const listeners = this.contentListeners.get(key);
    if (listeners && listeners.size > 0) {
      for (const listener of listeners) {
        listener(entry.content, chunkToEmit);
      }
    }
  }

  setFileWriting(projectId: string, path: string, initialContent: string = '') {
    const key = this.makeKey(projectId, path);
    const existing = this.writingFiles.get(key);
    if (existing?.throttleTimer) {
      clearTimeout(existing.throttleTimer);
    }

    this.writingFiles.set(key, {
      projectId,
      path,
      content: initialContent,
      pendingChunk: initialContent,
      lastEmitTime: Date.now(),
      throttleTimer: null,
    });

    this.emitPathWritingChange(key);
  }

  appendFileContent(projectId: string, path: string, chunk: string) {
    const key = this.makeKey(projectId, path);
    let entry = this.writingFiles.get(key);

    if (!entry) {
      entry = {
        projectId,
        path,
        content: chunk,
        pendingChunk: chunk,
        lastEmitTime: 0,
        throttleTimer: null,
      };
      this.writingFiles.set(key, entry);
      this.emitPathWritingChange(key);
    } else {
      entry.content += chunk;
      entry.pendingChunk += chunk;
    }

    // Throttle notifications to contentListeners: at most once every 250ms
    const now = Date.now();
    const elapsed = now - entry.lastEmitTime;

    if (elapsed >= CONTENT_THROTTLE_MS) {
      this.emitContent(key, entry);
    } else if (!entry.throttleTimer) {
      const delay = Math.max(0, CONTENT_THROTTLE_MS - elapsed);
      entry.throttleTimer = setTimeout(() => {
        const currentEntry = this.writingFiles.get(key);
        if (currentEntry) {
          this.emitContent(key, currentEntry);
        }
      }, delay);
    }
  }

  clearFileWriting(projectId: string, path: string) {
    const key = this.makeKey(projectId, path);
    const entry = this.writingFiles.get(key);
    if (entry) {
      // Flush any pending content before removing
      if (entry.pendingChunk) {
        this.emitContent(key, entry);
      }
      if (entry.throttleTimer) {
        clearTimeout(entry.throttleTimer);
      }
      this.writingFiles.delete(key);
      this.emitPathWritingChange(key);
    }
  }

  clearAllWritingForProject(projectId: string) {
    const keysToClear: string[] = [];
    for (const [key, entry] of this.writingFiles.entries()) {
      if (entry.projectId === projectId) {
        keysToClear.push(key);
      }
    }
    for (const key of keysToClear) {
      const entry = this.writingFiles.get(key);
      if (entry) {
        if (entry.pendingChunk) {
          this.emitContent(key, entry);
        }
        if (entry.throttleTimer) {
          clearTimeout(entry.throttleTimer);
        }
        this.writingFiles.delete(key);
        this.emitPathWritingChange(key);
      }
    }
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
      this.emitStructureChange();
    }
  }

  clearChanged(projectId: string, path: string) {
    const current = this.latestChanged.get(projectId);
    if (current && current.has(path)) {
      const next = new Set(current);
      next.delete(path);
      this.latestChanged.set(projectId, next.size > 0 ? next : (EMPTY_SET as Set<string>));
      this.emitStructureChange();
    }
  }

  clearAllChanged(projectId: string) {
    const current = this.latestChanged.get(projectId);
    if (current && current.size > 0) {
      this.latestChanged.set(projectId, EMPTY_SET as Set<string>);
      this.emitStructureChange();
    }
  }

  isChanged(projectId: string, path: string): boolean {
    const set = this.latestChanged.get(projectId);
    return set ? set.has(path) : false;
  }

  bumpRevision(projectId: string) {
    const current = this.revisions.get(projectId) || 0;
    this.revisions.set(projectId, current + 1);
    this.emitStructureChange();
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
const getServerSnapshotEmptySet = () => EMPTY_SET as Set<string>;
const getServerSnapshotZero = () => 0;

/**
 * Hook to subscribe ONLY to writing state of a single specific file path.
 * Other file path changes do not re-render components using this hook.
 */
export function useIsWritingFile(projectId: string, path?: string | null): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!path) return () => {};
      return aiFileStore.subscribePathWriting(projectId, path, callback);
    },
    [projectId, path]
  );

  const getSnapshot = useCallback(
    () => (path ? aiFileStore.isWriting(projectId, path) : false),
    [projectId, path]
  );

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshotFalse
  );
}

export function useLatestChangedFiles(projectId: string): Set<string> {
  const getSnapshot = useCallback(
    () => aiFileStore.getLatestChangedSet(projectId),
    [projectId]
  );
  return useSyncExternalStore(
    aiFileStore.subscribeStructure,
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
    aiFileStore.subscribeStructure,
    getSnapshot,
    getServerSnapshotZero
  );
}
