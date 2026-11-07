import {
  getFile,
  createFile,
  updateFileContent,
  deleteFile,
  validateFilePath,
  MAX_FILES_PER_PROJECT,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/files';
import { getDb, updateProject, type ProjectFile, type FileUndoEntry } from '@/lib/db';
import { aiFileStore } from './aiFileStore';
import type { SearchReplaceBlock } from './fileProtocol';

export const MAX_UNDO_PAYLOAD_BYTES = 1024 * 1024; // 1 MB cap

export interface ApplyFileResult {
  path: string;
  success: boolean;
  error?: string;
  isWarning?: boolean;
}

export interface ChangeApplierSession {
  onFileStart: (path: string) => Promise<ApplyFileResult>;
  onFileChunk: (path: string, chunk: string) => void;
  onFileEnd: (path: string) => Promise<ApplyFileResult>;
  onEdit: (path: string, blocks: SearchReplaceBlock[]) => Promise<ApplyFileResult>;
  onDelete: (path: string) => Promise<ApplyFileResult>;
  onUnterminated: (tagType: 'file' | 'edit', path: string) => void;
  finish: () => Promise<{
    undoEntries?: FileUndoEntry[];
    undoDisabledReason?: string;
    incompleteFiles: string[];
    failedEdits: Array<{ path: string; reason: string }>;
  }>;
}

/**
 * Normalizes text lines for whitespace/line-ending tolerant fallback matching
 */
function normalizeForComparison(text: string): { normalizedLines: string[]; originalLines: string[] } {
  // Normalize \r\n to \n
  const standard = text.replace(/\r\n/g, '\n');
  const originalLines = standard.split('\n');
  const normalizedLines = originalLines.map((line) => line.trimEnd());
  return { normalizedLines, originalLines };
}

/**
 * Applies search/replace blocks with exact match first, then whitespace-tolerant fallback.
 */
export function applySearchReplaceToContent(
  currentContent: string,
  blocks: SearchReplaceBlock[]
): { success: boolean; newContent?: string; failureBlockIndex?: number; reason?: string } {
  let content = currentContent;

  for (let bIndex = 0; bIndex < blocks.length; bIndex++) {
    const block = blocks[bIndex];
    if (!block.search) {
      // Empty search is invalid
      return {
        success: false,
        failureBlockIndex: bIndex,
        reason: 'Search block cannot be empty.',
      };
    }

    // 1. Try exact match
    if (content.includes(block.search)) {
      content = content.replace(block.search, block.replace);
      continue;
    }

    // 2. Try normalized fallback (ignore trailing whitespace and CRLF vs LF)
    const { normalizedLines: contentLines, originalLines: origLines } =
      normalizeForComparison(content);
    const { normalizedLines: searchLines } = normalizeForComparison(block.search);

    let matchIndex = -1;
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let matches = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j] !== searchLines[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex !== -1) {
      // Found match! Replace original lines from matchIndex to matchIndex + searchLines.length
      const beforeLines = origLines.slice(0, matchIndex);
      const afterLines = origLines.slice(matchIndex + searchLines.length);
      const replaceLines = block.replace.replace(/\r\n/g, '\n').split('\n');

      const combinedLines = [...beforeLines, ...replaceLines, ...afterLines];
      content = combinedLines.join('\n');
      continue;
    }

    // If still no match, fail this block and do not change file
    return {
      success: false,
      failureBlockIndex: bIndex,
      reason: "The original text wasn't found",
    };
  }

  return { success: true, newContent: content };
}

/**
 * Creates a stateful session to process file events for a single AI generation turn.
 */
export function createChangeApplierSession(projectId: string): ChangeApplierSession {
  const fileBuffers = new Map<string, string>();
  const flushTimers = new Map<string, NodeJS.Timeout>();
  const initialFileSnapshots = new Map<string, string | null>();
  const actionsTaken = new Map<string, 'created' | 'updated' | 'deleted'>();
  const finalFileSnapshots = new Map<string, string | null>();
  const incompleteFilesSet = new Set<string>();
  const failedEdits: Array<{ path: string; reason: string }> = [];

  // Throttled buffer flush to IndexedDB (at most once per 1000ms)
  async function flushBuffer(path: string, isFinal = false) {
    const text = fileBuffers.get(path);
    if (text === undefined) return;

    try {
      const existing = await getFile(projectId, path);
      if (existing) {
        await updateFileContent(projectId, path, text);
      } else {
        await createFile(projectId, path, text);
      }
    } catch (err) {
      console.error(`[applyChanges] Flush error for ${path}:`, err);
    }
  }

  function scheduleFlush(path: string) {
    if (flushTimers.has(path)) return;
    const timer = setTimeout(async () => {
      flushTimers.delete(path);
      await flushBuffer(path, false);
      // Fix 4: Do NOT bump revision during intermediate flushes;
      // bumpRevision only fires when file set changes (create/delete/rename) or file finishes
    }, 1000);
    flushTimers.set(path, timer);
  }

  return {
    async onFileStart(path: string): Promise<ApplyFileResult> {
      // Validate path
      const validation = validateFilePath(path);
      if (!validation.valid) {
        return {
          path,
          success: false,
          error: `Invalid path "${path}": ${validation.error}`,
          isWarning: true,
        };
      }

      const normPath = validation.normalizedPath!;

      // Capture snapshot for undo before touching
      if (!initialFileSnapshots.has(normPath)) {
        const existing = await getFile(projectId, normPath);
        initialFileSnapshots.set(normPath, existing ? existing.content : null);
        actionsTaken.set(normPath, existing ? 'updated' : 'created');
      }

      // Reset buffer
      fileBuffers.set(normPath, '');
      aiFileStore.setFileWriting(projectId, normPath, '');

      // Create or reset in DB
      try {
        const existing = await getFile(projectId, normPath);
        if (existing) {
          await updateFileContent(projectId, normPath, '');
        } else {
          await createFile(projectId, normPath, '');
        }
        await updateProject(projectId, { updatedAt: Date.now() });
        aiFileStore.bumpRevision(projectId);
      } catch (err) {
        console.error(`[applyChanges] fileStart error for ${normPath}:`, err);
      }

      return { path: normPath, success: true };
    },

    onFileChunk(path: string, chunk: string) {
      const validation = validateFilePath(path);
      if (!validation.valid) return;
      const normPath = validation.normalizedPath!;

      const current = fileBuffers.get(normPath) || '';
      const updated = current + chunk;
      fileBuffers.set(normPath, updated);

      // Update in-memory reactive store for real-time live preview/editor
      aiFileStore.appendFileContent(projectId, normPath, chunk);

      // Schedule throttled flush to IndexedDB
      scheduleFlush(normPath);
    },

    async onFileEnd(path: string): Promise<ApplyFileResult> {
      const validation = validateFilePath(path);
      if (!validation.valid) {
        return {
          path,
          success: false,
          error: `Invalid path "${path}": ${validation.error}`,
          isWarning: true,
        };
      }
      const normPath = validation.normalizedPath!;

      // Clear any pending flush timer and flush immediately
      const timer = flushTimers.get(normPath);
      if (timer) {
        clearTimeout(timer);
        flushTimers.delete(normPath);
      }

      const finalContent = fileBuffers.get(normPath) || '';
      try {
        await flushBuffer(normPath, true);
        finalFileSnapshots.set(normPath, finalContent);
      } catch (err) {
        console.error(`[applyChanges] fileEnd final flush error for ${normPath}:`, err);
      }

      // Clear writing flag and mark as changed in this turn
      aiFileStore.clearFileWriting(projectId, normPath);
      aiFileStore.markChanged(projectId, normPath);
      await updateProject(projectId, { updatedAt: Date.now() });
      aiFileStore.bumpRevision(projectId);

      return { path: normPath, success: true };
    },

    async onEdit(path: string, blocks: SearchReplaceBlock[]): Promise<ApplyFileResult> {
      const validation = validateFilePath(path);
      if (!validation.valid) {
        failedEdits.push({ path, reason: validation.error || 'Invalid path' });
        return {
          path,
          success: false,
          error: `Invalid path "${path}": ${validation.error}`,
          isWarning: true,
        };
      }
      const normPath = validation.normalizedPath!;

      const existingFile = await getFile(projectId, normPath);
      if (!existingFile) {
        const reason = `File "${normPath}" does not exist.`;
        failedEdits.push({ path: normPath, reason });
        return {
          path: normPath,
          success: false,
          error: reason,
          isWarning: true,
        };
      }

      // Capture before snapshot for undo
      if (!initialFileSnapshots.has(normPath)) {
        initialFileSnapshots.set(normPath, existingFile.content);
        actionsTaken.set(normPath, 'updated');
      }

      // Apply blocks
      const editResult = applySearchReplaceToContent(existingFile.content, blocks);
      if (!editResult.success || editResult.newContent === undefined) {
        const reason = `Could not apply an edit to ${normPath}: ${editResult.reason || "the original text wasn't found"}`;
        failedEdits.push({ path: normPath, reason });
        return {
          path: normPath,
          success: false,
          error: reason,
          isWarning: true,
        };
      }

      // Save updated content
      try {
        await updateFileContent(projectId, normPath, editResult.newContent);
        finalFileSnapshots.set(normPath, editResult.newContent);
        aiFileStore.markChanged(projectId, normPath);
        await updateProject(projectId, { updatedAt: Date.now() });
        aiFileStore.bumpRevision(projectId);
        return { path: normPath, success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failedEdits.push({ path: normPath, reason: msg });
        return {
          path: normPath,
          success: false,
          error: msg,
          isWarning: true,
        };
      }
    },

    async onDelete(path: string): Promise<ApplyFileResult> {
      const validation = validateFilePath(path);
      if (!validation.valid) {
        return {
          path,
          success: false,
          error: `Invalid path "${path}": ${validation.error}`,
          isWarning: true,
        };
      }
      const normPath = validation.normalizedPath!;

      const existing = await getFile(projectId, normPath);
      if (existing) {
        if (!initialFileSnapshots.has(normPath)) {
          initialFileSnapshots.set(normPath, existing.content);
          actionsTaken.set(normPath, 'deleted');
        }
        await deleteFile(projectId, normPath);
        finalFileSnapshots.set(normPath, null);
        aiFileStore.markChanged(projectId, normPath);
        await updateProject(projectId, { updatedAt: Date.now() });
        aiFileStore.bumpRevision(projectId);
      }

      return { path: normPath, success: true };
    },

    onUnterminated(tagType: 'file' | 'edit', path: string) {
      incompleteFilesSet.add(path);
      aiFileStore.clearFileWriting(projectId, path);
    },

    async finish() {
      // Clear any remaining timers
      for (const [p, timer] of flushTimers.entries()) {
        clearTimeout(timer);
        await flushBuffer(p, true);
      }
      flushTimers.clear();
      aiFileStore.clearAllWritingForProject(projectId);

      // Build undo entries
      const undoEntries: FileUndoEntry[] = [];
      let totalUndoBytes = 0;

      for (const [path, before] of initialFileSnapshots.entries()) {
        const action = actionsTaken.get(path) || 'updated';
        const after = finalFileSnapshots.get(path) ?? null;

        const beforeSize = before ? new Blob([before]).size : 0;
        const afterSize = after ? new Blob([after]).size : 0;
        totalUndoBytes += beforeSize + afterSize;

        undoEntries.push({
          path,
          action,
          before,
          after,
        });
      }

      let undoDisabledReason: string | undefined;
      if (totalUndoBytes > MAX_UNDO_PAYLOAD_BYTES) {
        undoDisabledReason = 'Changes exceeded 1 MB undo safety limit.';
      }

      return {
        undoEntries: totalUndoBytes <= MAX_UNDO_PAYLOAD_BYTES && undoEntries.length > 0 ? undoEntries : undefined,
        undoDisabledReason,
        incompleteFiles: Array.from(incompleteFilesSet),
        failedEdits,
      };
    },
  };
}

export interface UndoExecutionResult {
  restoredCount: number;
  skippedFiles: Array<{ path: string; reason: string }>;
}

/**
 * Restores the 'before' state for a message's undo entries, refusing any files
 * that were modified since.
 */
export async function executeUndoForMessage(
  projectId: string,
  undoEntries: FileUndoEntry[]
): Promise<UndoExecutionResult> {
  let restoredCount = 0;
  const skippedFiles: Array<{ path: string; reason: string }> = [];

  for (const entry of undoEntries) {
    const current = await getFile(projectId, entry.path);

    if (entry.action === 'created') {
      // Was created by AI: it should currently exist and match 'after'
      if (!current) {
        // Already deleted
        continue;
      }
      if (current.content !== entry.after) {
        skippedFiles.push({
          path: entry.path,
          reason: `File "${entry.path}" was edited after this message.`,
        });
        continue;
      }
      // Delete the created file
      await deleteFile(projectId, entry.path);
      restoredCount++;
    } else if (entry.action === 'updated') {
      // Was updated: current file must exist and match 'after'
      if (!current) {
        skippedFiles.push({
          path: entry.path,
          reason: `File "${entry.path}" was deleted after this message.`,
        });
        continue;
      }
      if (current.content !== entry.after) {
        skippedFiles.push({
          path: entry.path,
          reason: `File "${entry.path}" was edited after this message.`,
        });
        continue;
      }
      // Restore previous content
      if (entry.before !== null) {
        await updateFileContent(projectId, entry.path, entry.before);
        restoredCount++;
      }
    } else if (entry.action === 'deleted') {
      // Was deleted: current file should not exist
      if (current) {
        skippedFiles.push({
          path: entry.path,
          reason: `File "${entry.path}" was recreated after this message.`,
        });
        continue;
      }
      // Recreate file
      if (entry.before !== null) {
        await createFile(projectId, entry.path, entry.before);
        restoredCount++;
      }
    }
  }

  aiFileStore.bumpRevision(projectId);
  await updateProject(projectId, { updatedAt: Date.now() });

  return { restoredCount, skippedFiles };
}
