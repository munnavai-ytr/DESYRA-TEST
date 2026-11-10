'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  X,
  BookmarkPlus,
  Bookmark,
  Sparkles,
  Pencil,
  Palette,
  RotateCcw,
  FileArchive,
  Copy,
  Star,
  Trash2,
  ArrowLeft,
  Download,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Check,
  Loader2,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  listSnapshots,
  getSnapshot,
  diffSnapshots,
  diffSnapshotFile,
  restoreSnapshot,
  deleteSnapshot,
  pinSnapshot,
  renameSnapshot,
  subscribeHistoryChanges,
  HISTORY_PAGE_SIZE,
  type SnapshotListItem,
  type ManifestDelta,
} from '@/lib/history/snapshots';
import type { LineDiffResult, DiffLine } from '@/lib/history/diff';
import type { SnapshotKind, SnapshotRecord } from '@/lib/db';
import { extractDesignSpec } from '@/lib/design/install';

export interface HistoryPanelProps {
  projectId: string;
  projectTitle: string;
  isOpen: boolean;
  onClose: () => void;
  initialSnapshotId?: string | null;
  onOpenSaveVersion: () => void;
  onOpenExportSnapshot: (snapshotId: string, snapshotLabel: string) => void;
  onProjectRestored?: () => void;
  onOpenFile?: (path: string) => void;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getDayGroupLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (targetStart === todayStart) return 'Today';
  if (targetStart === yesterdayStart) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getKindIcon(kind: SnapshotKind): React.ReactNode {
  switch (kind) {
    case 'ai':
      return <Sparkles className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
    case 'manual':
      return <Pencil className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'design':
      return <Palette className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
    case 'restore':
      return <RotateCcw className="w-3.5 h-3.5 text-[var(--warning)] shrink-0" />;
    case 'checkpoint':
      return <Bookmark className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
    case 'import':
      return <FileArchive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'duplicate':
      return <Copy className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />;
  }
}

function getKindName(kind: SnapshotKind): string {
  switch (kind) {
    case 'ai':
      return 'AI Build';
    case 'manual':
      return 'Manual Edit';
    case 'design':
      return 'Design Update';
    case 'restore':
      return 'Restore Point';
    case 'checkpoint':
      return 'Checkpoint';
    case 'import':
      return 'Imported';
    case 'duplicate':
      return 'Duplicated';
  }
}

async function loadSnapshotDetailRecord(
  projectId: string,
  snapshotId: string,
  loadedList: SnapshotListItem[]
): Promise<{ snapshot: SnapshotRecord; prevId: string | null } | null> {
  const idx = loadedList.findIndex((s) => s.id === snapshotId);
  let target: SnapshotRecord | null =
    idx >= 0 ? loadedList[idx] : await getSnapshot(snapshotId);
  if (!target || target.projectId !== projectId) return null;

  let prevId: string | null = null;
  if (idx >= 0 && idx + 1 < loadedList.length) {
    prevId = loadedList[idx + 1].id;
  } else {
    const allRes = await listSnapshots(projectId, { offset: 0, limit: 200 });
    const foundIdx = allRes.items.findIndex((s) => s.id === target!.id);
    if (foundIdx >= 0 && foundIdx + 1 < allRes.items.length) {
      prevId = allRes.items[foundIdx + 1].id;
    }
    target = allRes.items[foundIdx] ?? target;
  }

  return { snapshot: target, prevId };
}

export function HistoryPanel(props: HistoryPanelProps) {
  if (!props.isOpen) return null;
  return <HistoryPanelInner key={props.projectId} {...props} />;
}

function HistoryPanelInner({
  projectId,
  projectTitle,
  onClose,
  initialSnapshotId,
  onOpenSaveVersion,
  onOpenExportSnapshot,
  onProjectRestored,
  onOpenFile,
}: HistoryPanelProps) {
  const { toast } = useToast();

  // Timeline list state
  const [items, setItems] = useState<SnapshotListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const [isLoadingList, setIsLoadingList] = useState(true);

  // Selected snapshot detail view state
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotRecord | null>(null);
  const [previousSnapshotId, setPreviousSnapshotId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'previous' | 'current'>('previous');
  const [delta, setDelta] = useState<ManifestDelta | null>(null);
  const [isLoadingDelta, setIsLoadingDelta] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);

  // Lazy per-file diff state
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<LineDiffResult | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [expandedSpans, setExpandedSpans] = useState<Set<number>>(new Set());

  // Inline rename / Delete / Restore confirmation states
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SnapshotListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [restoreConfirm, setRestoreConfirm] = useState<{
    snapshot: SnapshotRecord;
    onlyPath?: string;
    added: number;
    modified: number;
    removed: number;
  } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const loadTimeline = useCallback(
    async (pageLimit: number) => {
      try {
        const res = await listSnapshots(projectId, { offset: 0, limit: pageLimit });
        setItems(res.items);
        setTotalCount(res.total);
        setHasMore(res.hasMore);
      } catch (err) {
        console.error('Failed to load version history:', err);
      } finally {
        setIsLoadingList(false);
      }
    },
    [projectId]
  );

  // Initial load & pagination updates
  useEffect(() => {
    let active = true;
    listSnapshots(projectId, { offset: 0, limit })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setTotalCount(res.total);
        setHasMore(res.hasMore);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to load version history:', err);
      })
      .finally(() => {
        if (active) setIsLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, limit]);

  // Subscribe to snapshot mutations while drawer is mounted
  useEffect(() => {
    return subscribeHistoryChanges((changedProjectId) => {
      if (changedProjectId === projectId) {
        void loadTimeline(limit);
      }
    });
  }, [projectId, limit, loadTimeline]);

  const applyOpenedSnapshot = useCallback(
    (snapshot: SnapshotRecord, prevId: string | null) => {
      setSelectedSnapshot(snapshot);
      setPreviousSnapshotId(prevId);
      setCompareMode('previous');
      setIsLoadingDelta(true);
      setDelta(null);
      setSelectedFilePath(null);
      setFileDiff(null);
      setIsLoadingDiff(false);
      setExpandedSpans(new Set());
      setShowUnchanged(false);
    },
    []
  );

  // Helper to open detail view for a snapshot ID
  const openSnapshotDetail = useCallback(
    async (snapshotId: string, loadedList?: SnapshotListItem[]) => {
      const resolved = await loadSnapshotDetailRecord(
        projectId,
        snapshotId,
        loadedList ?? items
      );
      if (resolved) {
        applyOpenedSnapshot(resolved.snapshot, resolved.prevId);
      }
    },
    [items, projectId, applyOpenedSnapshot]
  );

  // Handle deep-link initialSnapshotId when mounted
  useEffect(() => {
    if (!initialSnapshotId) return;
    let active = true;
    loadSnapshotDetailRecord(projectId, initialSnapshotId, [])
      .then((resolved) => {
        if (active && resolved) {
          applyOpenedSnapshot(resolved.snapshot, resolved.prevId);
        }
      })
      .catch((err) => {
        console.error('Failed to load linked snapshot:', err);
      });
    return () => {
      active = false;
    };
  }, [projectId, initialSnapshotId, applyOpenedSnapshot]);

  // Escape key closes modal/drawer cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteTarget && !restoreConfirm && !renamingId) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, deleteTarget, restoreConfirm, renamingId]);

  const handleChangeCompareMode = (nextMode: 'previous' | 'current') => {
    if (nextMode === compareMode) return;
    setCompareMode(nextMode);
    setIsLoadingDelta(true);
    setDelta(null);
    setSelectedFilePath(null);
    setFileDiff(null);
    setIsLoadingDiff(false);
    setExpandedSpans(new Set());
  };

  const handleSelectDiffFile = (path: string) => {
    setSelectedFilePath(path);
    setFileDiff(null);
    setIsLoadingDiff(true);
    setExpandedSpans(new Set());
  };

  // Compute manifest delta whenever selectedSnapshot or compareMode changes
  useEffect(() => {
    if (!selectedSnapshot) return;
    let active = true;
    const fromSource =
      compareMode === 'current' ? 'current' : previousSnapshotId ?? 'empty';

    diffSnapshots(projectId, fromSource, selectedSnapshot.id)
      .then((res) => {
        if (!active) return;
        setDelta(res);
        // Auto-select the first changed file so user sees immediate diff
        const firstChanged =
          res.modified[0]?.path ?? res.added[0] ?? res.removed[0] ?? null;
        if (firstChanged) {
          setSelectedFilePath(firstChanged);
          setIsLoadingDiff(true);
        }
      })
      .catch((err) => {
        console.error('Failed to diff snapshots:', err);
      })
      .finally(() => {
        if (active) setIsLoadingDelta(false);
      });

    return () => {
      active = false;
    };
  }, [selectedSnapshot, compareMode, previousSnapshotId, projectId]);

  // Lazily load line-by-line diff ONLY when user selects a changed file
  useEffect(() => {
    if (!selectedSnapshot || !selectedFilePath) return;
    let active = true;
    const fromSource =
      compareMode === 'current' ? 'current' : previousSnapshotId ?? 'empty';

    diffSnapshotFile(projectId, fromSource, selectedSnapshot.id, selectedFilePath)
      .then((res) => {
        if (active) {
          setFileDiff(res);
        }
      })
      .catch((err) => {
        console.error('Failed to diff file:', err);
      })
      .finally(() => {
        if (active) setIsLoadingDiff(false);
      });

    return () => {
      active = false;
    };
  }, [selectedSnapshot, selectedFilePath, compareMode, previousSnapshotId, projectId]);

  // Group timeline items by day label
  const groupedTimeline = useMemo(() => {
    const groups: Array<{ label: string; entries: SnapshotListItem[] }> = [];
    for (const item of items) {
      const dayLabel = getDayGroupLabel(item.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.label === dayLabel) {
        lastGroup.entries.push(item);
      } else {
        groups.push({ label: dayLabel, entries: [item] });
      }
    }
    return groups;
  }, [items]);

  const handleTogglePin = async (
    e: React.MouseEvent,
    snap: SnapshotRecord
  ) => {
    e.stopPropagation();
    const nextPinned = !snap.pinned;
    try {
      const updated = await pinSnapshot(snap.id, nextPinned);
      if (updated) {
        setItems((prev) =>
          prev.map((it) => (it.id === snap.id ? { ...it, pinned: nextPinned } : it))
        );
        if (selectedSnapshot?.id === snap.id) {
          setSelectedSnapshot({ ...selectedSnapshot, pinned: nextPinned });
        }
        toast({
          type: 'info',
          title: nextPinned ? 'Version Pinned' : 'Version Unpinned',
          message: nextPinned
            ? `"${snap.label}" will never be deleted by automatic cleanup.`
            : `"${snap.label}" unpinned.`,
        });
      }
    } catch {
      toast({
        type: 'error',
        title: 'Pin Failed',
        message: 'Could not update pin state.',
      });
    }
  };

  const handleSaveRename = async (snapId: string) => {
    const clean = renameDraft.trim();
    if (!clean) {
      toast({
        type: 'error',
        title: 'Invalid Label',
        message: 'Version label cannot be empty.',
      });
      return;
    }
    try {
      const updated = await renameSnapshot(snapId, clean);
      if (updated) {
        setItems((prev) =>
          prev.map((it) => (it.id === snapId ? { ...it, label: updated.label } : it))
        );
        if (selectedSnapshot?.id === snapId) {
          setSelectedSnapshot({ ...selectedSnapshot, label: updated.label });
        }
      }
      setRenamingId(null);
    } catch (err) {
      toast({
        type: 'error',
        title: 'Rename Failed',
        message: err instanceof Error ? err.message : 'Could not rename version.',
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteSnapshot(deleteTarget.id);
      if (selectedSnapshot?.id === deleteTarget.id) {
        setSelectedSnapshot(null);
      }
      toast({
        type: 'info',
        title: 'Version Deleted',
        message: `Removed "${deleteTarget.label}" and freed unused file blobs.`,
      });
      setDeleteTarget(null);
      await loadTimeline(limit);
    } catch (err) {
      toast({
        type: 'error',
        title: 'Delete Failed',
        message: err instanceof Error ? err.message : 'Could not delete version.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePrepareRestore = async (snap: SnapshotRecord, onlyPath?: string) => {
    try {
      const currentDelta = await diffSnapshots(projectId, 'current', snap.id);
      if (onlyPath) {
        const isAdded = currentDelta.added.includes(onlyPath);
        const isModified = currentDelta.modified.some((m) => m.path === onlyPath);
        const isRemoved = currentDelta.removed.includes(onlyPath);
        setRestoreConfirm({
          snapshot: snap,
          onlyPath,
          added: isAdded ? 1 : 0,
          modified: isModified ? 1 : 0,
          removed: isRemoved ? 1 : 0,
        });
      } else {
        setRestoreConfirm({
          snapshot: snap,
          added: currentDelta.added.length,
          modified: currentDelta.modified.length,
          removed: currentDelta.removed.length,
        });
      }
    } catch (err) {
      toast({
        type: 'error',
        title: 'Restore Check Failed',
        message: err instanceof Error ? err.message : 'Could not inspect restore changes.',
      });
    }
  };

  const handleUndoRestore = async (undoSnapshotId: string) => {
    try {
      await restoreSnapshot(projectId, undoSnapshotId);
      onProjectRestored?.();
      await loadTimeline(limit);
      toast({
        type: 'success',
        title: 'Restore Undone',
        message: 'Reverted back to your state prior to restoring.',
      });
    } catch (err) {
      toast({
        type: 'error',
        title: 'Undo Restore Failed',
        message: err instanceof Error ? err.message : 'Could not undo restore.',
      });
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreConfirm) return;
    setIsRestoring(true);
    const { snapshot, onlyPath } = restoreConfirm;
    try {
      const res = await restoreSnapshot(
        projectId,
        snapshot.id,
        onlyPath ? { onlyPath } : {}
      );
      setRestoreConfirm(null);
      onProjectRestored?.();
      await loadTimeline(limit);

      toast({
        type: 'success',
        title: onlyPath ? 'File Restored' : 'Version Restored',
        message: onlyPath
          ? `Restored "${onlyPath}" from "${snapshot.label}".`
          : `Restored "${snapshot.label}" (+${res.addedCount} ~${res.changedCount} -${res.removedCount}).`,
        duration: 8000,
        action: res.undoSnapshotId
          ? {
              label: 'Undo restore',
              onClick: () => {
                void handleUndoRestore(res.undoSnapshotId!);
              },
            }
          : undefined,
      });
    } catch (err) {
      toast({
        type: 'error',
        title: 'Restore Failed',
        message: err instanceof Error ? err.message : 'Restore transaction was aborted cleanly.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const toggleExpandCollapsedSpan = (index: number) => {
    setExpandedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const renderDiffLineRow = (line: DiffLine, key: string) => {
    const bgClass =
      line.type === 'add'
        ? 'bg-emerald-500/12 text-emerald-200'
        : line.type === 'remove'
          ? 'bg-red-500/12 text-red-200'
          : 'text-[var(--text)]';
    const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
    const prefixColor =
      line.type === 'add'
        ? 'text-emerald-400'
        : line.type === 'remove'
          ? 'text-red-400'
          : 'text-[var(--disabled)]';

    return (
      <div
        key={key}
        className={`flex items-stretch font-mono text-[11px] leading-[1.6] tabular-nums whitespace-pre ${bgClass}`}
      >
        <span className="w-10 shrink-0 px-1.5 text-right text-[var(--disabled)] select-none border-r border-[var(--border)]/50">
          {line.oldLineNumber ?? ''}
        </span>
        <span className="w-10 shrink-0 px-1.5 text-right text-[var(--disabled)] select-none border-r border-[var(--border)]/50">
          {line.newLineNumber ?? ''}
        </span>
        <span className={`w-5 shrink-0 text-center select-none font-semibold ${prefixColor}`}>
          {prefix}
        </span>
        <span className="pr-4 select-text">{line.content || ' '}</span>
      </div>
    );
  };

  const selectedDesignSpec = selectedSnapshot
    ? extractDesignSpec(selectedSnapshot.meta?.design)
    : null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[1px] flex justify-end items-end md:items-stretch animate-in fade-in duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        role="presentation"
      >
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={`Version history for ${projectTitle}`}
          className="w-full h-[88dvh] md:h-full md:w-[580px] lg:w-[680px] bg-[var(--surface)] border-t md:border-t-0 md:border-l border-[var(--border)] rounded-t-2xl md:rounded-none shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom md:slide-in-from-right duration-200"
        >
          {/* Mobile bottom-sheet handle */}
          <div className="md:hidden pt-2 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
          </div>

          {/* Fixed Header */}
          <div className="h-12 px-4 border-b border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-2 shrink-0">
            {selectedSnapshot ? (
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedSnapshot(null)}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] transition-colors cursor-pointer shrink-0 min-h-[36px]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Timeline</span>
                </button>
                <span className="text-[var(--border)] shrink-0">/</span>
                <span className="text-xs sm:text-sm font-semibold text-[var(--text)] truncate">
                  {selectedSnapshot.label}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <History className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <h2 className="text-sm font-semibold text-[var(--text)] truncate">
                  Version History
                </h2>
                <span className="text-xs text-[var(--muted)] tabular-nums shrink-0">
                  ({totalCount})
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 shrink-0">
              {!selectedSnapshot && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={onOpenSaveVersion}
                  leftIcon={<BookmarkPlus className="w-3.5 h-3.5" />}
                  className="text-xs whitespace-nowrap"
                >
                  Save version
                </Button>
              )}
              <IconButton
                size="sm"
                variant="ghost"
                aria-label="Close history panel"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          </div>

          {/* Scrollable Body (Fixed-shell flex containment) */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [overscroll-behavior-y:contain] [scrollbar-width:thin]">
            {!selectedSnapshot ? (
              /* ================= TIMELINE LIST VIEW ================= */
              <div className="p-4 space-y-5">
                {isLoadingList ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className="p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] space-y-2"
                      >
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-10">
                    <EmptyState
                      icon={<History className="w-6 h-6 text-[var(--accent)]" />}
                      title="No saved versions yet"
                      description="Versions are saved automatically after AI builds, theme edits, and manual checkpoints."
                      action={
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={onOpenSaveVersion}
                          leftIcon={<BookmarkPlus className="w-3.5 h-3.5" />}
                        >
                          Save first version
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <>
                    {groupedTimeline.map((group) => (
                      <section key={group.label} className="space-y-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] px-1">
                          {group.label}
                        </h3>
                        <div className="space-y-2">
                          {group.entries.map((snap) => {
                            const isRenaming = renamingId === snap.id;
                            const isSoleSnapshot = totalCount <= 1;

                            return (
                              <div
                                key={snap.id}
                                onClick={() => {
                                  if (!isRenaming) {
                                    void openSnapshotDetail(snap.id);
                                  }
                                }}
                                className="group p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)]/70 hover:bg-[var(--elevated)] border border-[var(--border)] hover:border-[#383842] transition-colors cursor-pointer"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <div className="mt-0.5">{getKindIcon(snap.kind)}</div>
                                    <div className="min-w-0 flex-1">
                                      {isRenaming ? (
                                        <form
                                          onSubmit={(e) => {
                                            e.preventDefault();
                                            void handleSaveRename(snap.id);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="flex items-center gap-1.5"
                                        >
                                          <Input
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            maxLength={80}
                                            autoFocus
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape') {
                                                e.stopPropagation();
                                                setRenamingId(null);
                                              }
                                            }}
                                            className="h-7 text-xs px-2"
                                          />
                                          <Button type="submit" size="sm" variant="primary" className="h-7 px-2 text-xs">
                                            Save
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setRenamingId(null)}
                                            className="h-7 px-2 text-xs"
                                          >
                                            Cancel
                                          </Button>
                                        </form>
                                      ) : (
                                        <p className="text-xs sm:text-sm font-medium text-[var(--text)] truncate">
                                          {snap.label}
                                        </p>
                                      )}

                                      {snap.note && !isRenaming && (
                                        <p className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-2 leading-relaxed">
                                          {snap.note}
                                        </p>
                                      )}

                                      {/* Clean unboxed metadata row */}
                                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[11px] text-[var(--muted)] tabular-nums">
                                        <span>{getKindName(snap.kind)}</span>
                                        <span aria-hidden="true" className="text-[var(--disabled)]">
                                          ·
                                        </span>
                                        <span>{formatClockTime(snap.createdAt)}</span>
                                        <span aria-hidden="true" className="text-[var(--disabled)]">
                                          ·
                                        </span>
                                        <span>
                                          {snap.fileCount} {snap.fileCount === 1 ? 'file' : 'files'} (
                                          {formatByteSize(snap.totalBytes)})
                                        </span>
                                        {(snap.deltaSummary.added > 0 ||
                                          snap.deltaSummary.modified > 0 ||
                                          snap.deltaSummary.removed > 0) && (
                                          <>
                                            <span
                                              aria-hidden="true"
                                              className="text-[var(--disabled)]"
                                            >
                                              ·
                                            </span>
                                            <span className="font-mono text-[11px] inline-flex items-center gap-1.5">
                                              {snap.deltaSummary.added > 0 && (
                                                <span className="text-emerald-400">
                                                  +{snap.deltaSummary.added}
                                                </span>
                                              )}
                                              {snap.deltaSummary.modified > 0 && (
                                                <span className="text-amber-400">
                                                  ~{snap.deltaSummary.modified}
                                                </span>
                                              )}
                                              {snap.deltaSummary.removed > 0 && (
                                                <span className="text-red-400">
                                                  -{snap.deltaSummary.removed}
                                                </span>
                                              )}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Quick row controls */}
                                  {!isRenaming && (
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={(e) => void handleTogglePin(e, snap)}
                                        aria-label={
                                          snap.pinned ? 'Unpin version' : 'Pin version'
                                        }
                                        title={
                                          snap.pinned
                                            ? 'Pinned (kept forever)'
                                            : 'Pin version to prevent auto-cleanup'
                                        }
                                        className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center ${
                                          snap.pinned
                                            ? 'text-[var(--accent)] hover:bg-[var(--surface)]'
                                            : 'text-[var(--disabled)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                        }`}
                                      >
                                        <Star
                                          className={`w-3.5 h-3.5 ${
                                            snap.pinned ? 'fill-current' : ''
                                          }`}
                                        />
                                      </button>

                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRenamingId(snap.id);
                                          setRenameDraft(snap.label);
                                        }}
                                        aria-label={`Rename version ${snap.label}`}
                                        title="Rename version"
                                        className="p-1.5 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isSoleSnapshot}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!isSoleSnapshot) {
                                            setDeleteTarget(snap);
                                          }
                                        }}
                                        aria-label={`Delete version ${snap.label}`}
                                        title={
                                          isSoleSnapshot
                                            ? 'Cannot delete the only version'
                                            : 'Delete version'
                                        }
                                        className="p-1.5 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--surface)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-w-[32px] min-h-[32px] flex items-center justify-center"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>

                                      <ChevronRight className="w-4 h-4 text-[var(--disabled)] group-hover:text-[var(--text)] ml-0.5 shrink-0" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}

                    {hasMore && (
                      <div className="pt-2 flex justify-center">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setIsLoadingList(true);
                            setLimit((prev) => prev + HISTORY_PAGE_SIZE);
                          }}
                        >
                          Load older versions
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              /* ================= SNAPSHOT DETAIL & LAZY DIFF VIEW ================= */
              <div className="p-4 space-y-4">
                {/* Summary Header Card */}
                <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                        {getKindIcon(selectedSnapshot.kind)}
                        <span>{getKindName(selectedSnapshot.kind)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(selectedSnapshot.createdAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-[var(--text)] break-words">
                        {selectedSnapshot.label}
                      </h3>
                      {selectedSnapshot.note && (
                        <p className="text-xs text-[var(--muted)] leading-relaxed">
                          {selectedSnapshot.note}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => void handleTogglePin(e, selectedSnapshot)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                        selectedSnapshot.pinned
                          ? 'bg-[var(--accent-soft)] border-[var(--accent)]/40 text-[var(--accent)]'
                          : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          selectedSnapshot.pinned ? 'fill-current' : ''
                        }`}
                      />
                      <span>{selectedSnapshot.pinned ? 'Pinned' : 'Pin'}</span>
                    </button>
                  </div>

                  {/* Metadata details (clean unboxed row) */}
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--muted)] tabular-nums pt-1 border-t border-[var(--border)]/70">
                    <span>
                      {selectedSnapshot.fileCount} files (
                      {formatByteSize(selectedSnapshot.totalBytes)})
                    </span>
                    {selectedDesignSpec && (
                      <>
                        <span aria-hidden="true" className="text-[var(--disabled)]">
                          ·
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block border border-white/20"
                            style={{ backgroundColor: selectedDesignSpec.seedHex }}
                          />
                          <span>
                            Theme: {selectedDesignSpec.presetId} ({selectedDesignSpec.mode})
                          </span>
                        </span>
                      </>
                    )}
                    {selectedSnapshot.meta?.plan?.directionName && (
                      <>
                        <span aria-hidden="true" className="text-[var(--disabled)]">
                          ·
                        </span>
                        <span>Direction: {selectedSnapshot.meta.plan.directionName}</span>
                      </>
                    )}
                  </div>

                  {/* Restore & Download Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void handlePrepareRestore(selectedSnapshot)}
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    >
                      Restore this version
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        onOpenExportSnapshot(selectedSnapshot.id, selectedSnapshot.label)
                      }
                      leftIcon={<Download className="w-3.5 h-3.5" />}
                    >
                      Download .zip
                    </Button>
                  </div>
                </div>

                {/* Comparison Baseline Tabs */}
                <div className="space-y-2">
                  <div
                    role="tablist"
                    aria-label="Diff comparison mode"
                    className="flex items-center gap-1 p-1 bg-[var(--elevated)] rounded-[var(--radius-md)] border border-[var(--border)]"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={compareMode === 'previous'}
                      onClick={() => handleChangeCompareMode('previous')}
                      className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer whitespace-nowrap ${
                        compareMode === 'previous'
                          ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Compare with previous version
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={compareMode === 'current'}
                      onClick={() => handleChangeCompareMode('current')}
                      className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer whitespace-nowrap ${
                        compareMode === 'current'
                          ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Compare with current files
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--muted)] px-0.5">
                    {compareMode === 'previous'
                      ? previousSnapshotId
                        ? 'Showing changes introduced in this version relative to the preceding version.'
                        : 'Showing initial files included in this baseline version.'
                      : 'Showing what restoring this version would add, update, or remove compared to your live workspace.'}
                  </p>
                </div>

                {/* Changed Files + Lazy Line Diff */}
                {isLoadingDelta ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-xs text-[var(--muted)]">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                    <span>Comparing file manifests...</span>
                  </div>
                ) : delta ? (
                  <div className="space-y-3">
                    {delta.added.length === 0 &&
                    delta.modified.length === 0 &&
                    delta.removed.length === 0 ? (
                      <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
                        <Check className="w-4 h-4 text-[var(--success)]" />
                        <span>
                          No file differences{' '}
                          {compareMode === 'current'
                            ? 'between this snapshot and current files'
                            : 'from previous version'}
                          .
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
                        <div className="px-3 py-2 bg-[var(--elevated)] border-b border-[var(--border)] flex items-center justify-between text-[11px] font-medium text-[var(--muted)]">
                          <span>Changed Files</span>
                          <span className="font-mono tabular-nums space-x-2">
                            {delta.added.length > 0 && (
                              <span className="text-emerald-400">+{delta.added.length}</span>
                            )}
                            {delta.modified.length > 0 && (
                              <span className="text-amber-400">~{delta.modified.length}</span>
                            )}
                            {delta.removed.length > 0 && (
                              <span className="text-red-400">-{delta.removed.length}</span>
                            )}
                          </span>
                        </div>

                        <div className="divide-y divide-[var(--border)]/60 max-h-56 overflow-y-auto [scrollbar-width:thin]">
                          {delta.added.map((path) => {
                            const isSelected = selectedFilePath === path;
                            return (
                              <div
                                key={`add-${path}`}
                                onClick={() => handleSelectDiffFile(path)}
                                className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                                    : 'hover:bg-[var(--elevated)] text-[var(--muted)] hover:text-[var(--text)]'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-emerald-400 font-semibold shrink-0">
                                    + Added
                                  </span>
                                  <span className="font-mono truncate">{path}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handlePrepareRestore(selectedSnapshot, path);
                                  }}
                                  className="text-[11px] font-medium text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
                                >
                                  Restore file
                                </button>
                              </div>
                            );
                          })}

                          {delta.modified.map(({ path }) => {
                            const isSelected = selectedFilePath === path;
                            return (
                              <div
                                key={`mod-${path}`}
                                onClick={() => handleSelectDiffFile(path)}
                                className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                                    : 'hover:bg-[var(--elevated)] text-[var(--muted)] hover:text-[var(--text)]'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-amber-400 font-semibold shrink-0">
                                    ~ Modified
                                  </span>
                                  <span className="font-mono truncate">{path}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handlePrepareRestore(selectedSnapshot, path);
                                  }}
                                  className="text-[11px] font-medium text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
                                >
                                  Restore file
                                </button>
                              </div>
                            );
                          })}

                          {delta.removed.map((path) => {
                            const isSelected = selectedFilePath === path;
                            return (
                              <div
                                key={`rem-${path}`}
                                onClick={() => handleSelectDiffFile(path)}
                                className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                                    : 'hover:bg-[var(--elevated)] text-[var(--muted)] hover:text-[var(--text)]'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-red-400 font-semibold shrink-0">
                                    - Removed
                                  </span>
                                  <span className="font-mono truncate">{path}</span>
                                </div>
                                {compareMode === 'current' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handlePrepareRestore(selectedSnapshot, path);
                                    }}
                                    className="text-[11px] font-medium text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
                                  >
                                    Remove file
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Lazy Line-by-Line Diff Code Pane (horizontal scroll contained strictly inside) */}
                    {selectedFilePath && (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[#0c0c10] overflow-hidden">
                        <div className="px-3 py-2 bg-[var(--elevated)] border-b border-[var(--border)] flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                            <span className="font-mono text-xs font-medium text-[var(--text)] truncate">
                              {selectedFilePath}
                            </span>
                            {fileDiff && !fileDiff.tooLarge && (
                              <span className="font-mono text-[11px] tabular-nums shrink-0 space-x-1.5">
                                <span className="text-emerald-400">+{fileDiff.addedCount}</span>
                                <span className="text-red-400">-{fileDiff.removedCount}</span>
                              </span>
                            )}
                          </div>

                          {selectedSnapshot.manifest[selectedFilePath] !== undefined && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                void handlePrepareRestore(selectedSnapshot, selectedFilePath)
                              }
                              className="h-7 px-2.5 text-[11px] shrink-0"
                            >
                              Restore this file
                            </Button>
                          )}
                        </div>

                        {isLoadingDiff ? (
                          <div className="p-6 flex items-center justify-center gap-2 text-xs text-[var(--muted)]">
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                            <span>Computing line diff...</span>
                          </div>
                        ) : fileDiff ? (
                          fileDiff.tooLarge ? (
                            <div className="p-5 text-center space-y-3">
                              <AlertTriangle className="w-5 h-5 text-[var(--warning)] mx-auto" />
                              <p className="text-xs text-[var(--muted)] leading-relaxed">
                                File too large to diff ({fileDiff.lineCountBefore.toLocaleString()} /{' '}
                                {fileDiff.lineCountAfter.toLocaleString()} lines exceeds the 4,000-line
                                diff limit); view in editor.
                              </p>
                              {onOpenFile && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    onOpenFile(selectedFilePath);
                                    onClose();
                                  }}
                                  leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
                                >
                                  Open in editor
                                </Button>
                              )}
                            </div>
                          ) : fileDiff.isIdentical ? (
                            <div className="p-4 text-center text-xs text-[var(--muted)]">
                              File contents are identical.
                            </div>
                          ) : (
                            <div className="overflow-x-auto max-h-[380px] overflow-y-auto [scrollbar-width:thin]">
                              <div className="min-w-full w-max">
                                {fileDiff.displayItems.map((block, idx) => {
                                  if (block.kind === 'collapsed') {
                                    const lines = block.collapsedLines ?? [];
                                    const isExpanded = expandedSpans.has(idx);
                                    if (isExpanded) {
                                      return (
                                        <div key={`exp-${idx}`}>
                                          {lines.map((line, lIdx) =>
                                            renderDiffLineRow(line, `exp-${idx}-${lIdx}`)
                                          )}
                                        </div>
                                      );
                                    }
                                    return (
                                      <button
                                        key={`col-${idx}`}
                                        type="button"
                                        onClick={() => toggleExpandCollapsedSpan(idx)}
                                        className="w-full py-1 px-3 bg-[var(--surface)]/80 hover:bg-[var(--elevated)] border-y border-[var(--border)]/60 text-left text-[11px] text-[var(--accent)] font-mono cursor-pointer transition-colors"
                                      >
                                        Show {block.collapsedCount ?? lines.length} unchanged line(s)
                                      </button>
                                    );
                                  }

                                  if (block.kind === 'hunk' && block.hunk) {
                                    return (
                                      <div key={`hunk-${idx}`}>
                                        <div className="px-3 py-1 bg-[var(--elevated)]/60 border-y border-[var(--border)]/40 font-mono text-[10px] text-[var(--muted)] select-none">
                                          @@ -{block.hunk.oldStart},{block.hunk.oldCount} +
                                          {block.hunk.newStart},{block.hunk.newCount} @@
                                        </div>
                                        {block.hunk.lines.map((line, lIdx) =>
                                          renderDiffLineRow(line, `hunk-${idx}-${lIdx}`)
                                        )}
                                      </div>
                                    );
                                  }
                                  return null;
                                })}
                              </div>
                            </div>
                          )
                        ) : null}
                      </div>
                    )}

                    {/* Collapsible Unchanged Files */}
                    {delta.unchanged.length > 0 && (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                        <button
                          type="button"
                          onClick={() => setShowUnchanged((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between text-xs text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                        >
                          <span>Unchanged files ({delta.unchanged.length})</span>
                          {showUnchanged ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {showUnchanged && (
                          <div className="px-3 pb-2.5 pt-1 border-t border-[var(--border)]/60 space-y-1 max-h-40 overflow-y-auto">
                            {delta.unchanged.map((path) => (
                              <div
                                key={`unchanged-${path}`}
                                className="flex items-center justify-between text-[11px] font-mono text-[var(--muted)] py-0.5"
                              >
                                <span className="truncate pr-2">{path}</span>
                                <span className="text-[var(--disabled)] shrink-0">Unchanged</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Delete Snapshot Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Version"
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.label}"? Any unreferenced file content blobs will be cleaned up automatically.`
            : ''
        }
      >
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setDeleteTarget(null)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={isDeleting}
            onClick={() => void handleConfirmDelete()}
            className="bg-[var(--error)] hover:bg-[#dc2626] border-none"
          >
            Delete Version
          </Button>
        </div>
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal
        isOpen={Boolean(restoreConfirm)}
        onClose={() => setRestoreConfirm(null)}
        title={restoreConfirm?.onlyPath ? 'Restore Single File' : 'Restore Version'}
        description={
          restoreConfirm?.onlyPath
            ? `Replace "${restoreConfirm.onlyPath}" with the content from "${restoreConfirm.snapshot.label}"?`
            : `Restore "${restoreConfirm?.snapshot.label}" to your live workspace?`
        }
      >
        {restoreConfirm && (
          <div className="space-y-4 pt-1">
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--text)] space-y-1.5">
              {restoreConfirm.onlyPath ? (
                <p>
                  This will restore only{' '}
                  <code className="font-mono text-[var(--accent)]">
                    {restoreConfirm.onlyPath}
                  </code>
                  {restoreConfirm.removed > 0
                    ? ' (removes file missing in that version).'
                    : '.'}
                </p>
              ) : (
                <p>
                  This will add{' '}
                  <strong className="text-emerald-400">{restoreConfirm.added}</strong> file(s),
                  update{' '}
                  <strong className="text-amber-400">{restoreConfirm.modified}</strong> file(s),
                  and remove{' '}
                  <strong className="text-red-400">{restoreConfirm.removed}</strong> file(s),
                  along with the design theme state from that point.
                </p>
              )}
              <p className="text-[11px] text-[var(--muted)]">
                A &quot;Before restore&quot; checkpoint is saved automatically so you can undo this
                restore in one click.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setRestoreConfirm(null)}
                disabled={isRestoring}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isRestoring}
                onClick={() => void handleConfirmRestore()}
                leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              >
                {restoreConfirm.onlyPath ? 'Restore File' : 'Restore Version'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
