'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  HardDrive,
  Download,
  Upload,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Info,
  CheckCircle2,
  X,
  ExternalLink,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  getLastBackupAt,
  getPersistentStorageStatus,
  requestPersistentStorageSafe,
  type PersistentStorageStatus,
} from '@/lib/db';
import { cleanupOldVersionsAllProjects } from '@/lib/history/snapshots';
import { triggerZipDownload } from '@/lib/zip/writer';
import {
  exportAllProjectsBackup,
  inspectBackupZip,
  restoreProjectsFromBackup,
  isAbortError,
  type BackupProgress,
  type ParsedBackupArchive,
  type RestoreBackupResult,
} from '@/lib/backup/backup';
import { formatRelativeTime } from '@/lib/utils';

interface StorageUsageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
  supported: boolean;
}

function formatBytesHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

async function fetchStorageOverview(): Promise<{
  persistState: PersistentStorageStatus;
  backupTime: number | null;
  estimate: StorageUsageEstimate;
}> {
  const [persistState, backupTime] = await Promise.all([
    getPersistentStorageStatus(),
    getLastBackupAt(),
  ]);

  let estimate: StorageUsageEstimate = {
    usageBytes: null,
    quotaBytes: null,
    supported: false,
  };

  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.estimate === 'function'
  ) {
    const est = await navigator.storage.estimate();
    estimate = {
      usageBytes: typeof est.usage === 'number' ? est.usage : null,
      quotaBytes: typeof est.quota === 'number' ? est.quota : null,
      supported: true,
    };
  }

  return { persistState, backupTime, estimate };
}

export function DataAndBackupSection({ onRefresh }: { onRefresh?: () => void }) {
  const { toast } = useToast();
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const [persistentStatus, setPersistentStatus] =
    useState<PersistentStorageStatus>('unsupported');
  const [isRequestingPersist, setIsRequestingPersist] = useState(false);

  const [storageEstimate, setStorageEstimate] = useState<StorageUsageEstimate>({
    usageBytes: null,
    quotaBytes: null,
    supported: false,
  });
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  const [lastBackupAt, setLastBackupAtState] = useState<number | null>(null);
  const [includeChatHistory, setIncludeChatHistory] = useState(false);
  const [includeSnapshots, setIncludeSnapshots] = useState(false);

  // Export progress & abort control
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<BackupProgress | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Restore inspection modal state
  const [isInspectingBackup, setIsInspectingBackup] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [parsedBackup, setParsedBackup] = useState<ParsedBackupArchive | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<BackupProgress | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreBackupResult | null>(null);
  const restoreAbortRef = useRef<AbortController | null>(null);

  const loadStorageInfo = useCallback(async () => {
    try {
      const info = await fetchStorageOverview();
      setPersistentStatus(info.persistState);
      setLastBackupAtState(info.backupTime);
      setStorageEstimate(info.estimate);
    } catch {
      // Non-fatal fallback
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchStorageOverview()
      .then((info) => {
        if (!active) return;
        setPersistentStatus(info.persistState);
        setLastBackupAtState(info.backupTime);
        setStorageEstimate(info.estimate);
      })
      .catch(() => {
        // Non-fatal fallback
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRequestPersistent = async () => {
    setIsRequestingPersist(true);
    try {
      const status = await requestPersistentStorageSafe();
      setPersistentStatus(status);
      if (status === 'granted') {
        toast({
          type: 'success',
          title: 'Persistent Storage Granted',
          message: 'Your browser will preserve DESYRA projects against automatic disk eviction.',
        });
      } else if (status === 'denied') {
        toast({
          type: 'info',
          title: 'Permission Not Granted',
          message:
            'Your browser chose not to guarantee persistent storage right now. Download regular backups for safety.',
        });
      } else {
        toast({
          type: 'info',
          title: 'Unsupported Browser Feature',
          message: 'This browser does not support persistent storage requests.',
        });
      }
    } finally {
      setIsRequestingPersist(false);
    }
  };

  const handleCleanupVersions = async () => {
    setIsCleaningUp(true);
    try {
      const result = await cleanupOldVersionsAllProjects(10);
      await loadStorageInfo();
      onRefresh?.();
      if (result.deletedSnapshots === 0 && result.deletedBlobs === 0) {
        toast({
          type: 'info',
          title: 'Nothing to Clean Up',
          message: 'All projects are already at or below 10 recent unpinned versions.',
        });
      } else {
        toast({
          type: 'success',
          title: 'Old Versions Cleaned Up',
          message: `Removed ${result.deletedSnapshots} unpinned snapshot(s) and reclaimed ${result.deletedBlobs} unused blob(s).`,
        });
      }
    } catch (err) {
      toast({
        type: 'error',
        title: 'Cleanup Failed',
        message: err instanceof Error ? err.message : 'Could not clean up old snapshots.',
      });
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleExportBackup = async () => {
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    setExportProgress(null);

    try {
      const result = await exportAllProjectsBackup({
        includeChatHistory,
        includeSnapshots,
        signal: controller.signal,
        onProgress: (p) => setExportProgress(p),
      });

      triggerZipDownload(result.blob, result.filename);
      await loadStorageInfo();

      if (result.exceeds50Mb) {
        toast({
          type: 'warning',
          title: 'Large Backup Downloaded',
          message: `Exported ${result.projectCount} project(s) (${formatBytesHuman(
            result.bytes.byteLength
          )}). Consider keeping archive files safely backed up off-device.`,
          duration: 6000,
        });
      } else {
        toast({
          type: 'success',
          title: 'Backup Downloaded',
          message: `Backed up ${result.projectCount} project(s) and ${result.fileCount} file(s) to ${result.filename}.`,
        });
      }
    } catch (err) {
      if (isAbortError(err)) {
        toast({
          type: 'info',
          title: 'Backup Export Cancelled',
          message: 'No backup file was downloaded.',
        });
      } else {
        toast({
          type: 'error',
          title: 'Backup Failed',
          message: err instanceof Error ? err.message : 'Failed to create backup archive.',
        });
      }
    } finally {
      setIsExporting(false);
      setExportProgress(null);
      exportAbortRef.current = null;
    }
  };

  const handleChooseRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setInspectError(null);
    setRestoreResult(null);
    setParsedBackup(null);
    setIsInspectingBackup(true);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = await inspectBackupZip(buffer);
      setParsedBackup(parsed);
      setSelectedIds(new Set(parsed.projects.map((p) => p.entry.originalId)));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Selected ZIP is not a valid DESYRA backup.';
      setInspectError(msg);
      toast({
        type: 'error',
        title: 'Invalid Backup File',
        message: msg,
      });
    } finally {
      setIsInspectingBackup(false);
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = '';
      }
    }
  };

  const handleToggleProject = (originalId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(originalId)) {
        next.delete(originalId);
      } else {
        next.add(originalId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!parsedBackup) return;
    setSelectedIds(new Set(parsedBackup.projects.map((p) => p.entry.originalId)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleRestoreConfirm = async () => {
    if (!parsedBackup || selectedIds.size === 0) return;

    const controller = new AbortController();
    restoreAbortRef.current = controller;
    setIsRestoring(true);
    setRestoreProgress(null);

    try {
      const res = await restoreProjectsFromBackup(parsedBackup, Array.from(selectedIds), {
        signal: controller.signal,
        onProgress: (p) => setRestoreProgress(p),
      });
      setRestoreResult(res);
      await loadStorageInfo();
      onRefresh?.();
      toast({
        type: 'success',
        title: 'Projects Restored',
        message: `Restored ${res.restoredCount} project(s) cleanly as new local projects.`,
      });
    } catch (err) {
      if (isAbortError(err)) {
        toast({
          type: 'info',
          title: 'Restore Cancelled',
          message: 'Stopped restoring remaining backup projects.',
        });
      } else {
        toast({
          type: 'error',
          title: 'Restore Failed',
          message: err instanceof Error ? err.message : 'Could not restore from backup archive.',
        });
      }
    } finally {
      setIsRestoring(false);
      setRestoreProgress(null);
      restoreAbortRef.current = null;
    }
  };

  const closeRestoreModal = () => {
    if (isRestoring) return;
    setParsedBackup(null);
    setRestoreResult(null);
    setSelectedIds(new Set());
    setInspectError(null);
  };

  const usagePercent =
    storageEstimate.supported &&
    storageEstimate.usageBytes !== null &&
    storageEstimate.quotaBytes &&
    storageEstimate.quotaBytes > 0
      ? Math.min(100, Math.round((storageEstimate.usageBytes / storageEstimate.quotaBytes) * 100))
      : null;

  return (
    <>
      <Card id="backup-section" className="p-6 space-y-6 scroll-mt-20">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text)] tracking-tight">
              Storage &amp; Backups
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
              Manage local browser storage quota, prune older snapshots, and download full multi-project backup archives.
            </p>
          </div>
        </div>

        {/* Browser Persistence & Quota Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-[var(--border)]">
          {/* Persistent Storage Status */}
          <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text)]">
                  Persistent Storage
                </span>
                <Badge
                  variant={
                    persistentStatus === 'granted'
                      ? 'success'
                      : persistentStatus === 'denied'
                        ? 'warning'
                        : 'default'
                  }
                  size="sm"
                >
                  {persistentStatus === 'granted'
                    ? 'Granted'
                    : persistentStatus === 'denied'
                      ? 'Not guaranteed'
                      : 'Unsupported'}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-1.5 leading-relaxed">
                {persistentStatus === 'granted'
                  ? 'Your browser keeps IndexedDB data protected from automatic cleanup under disk pressure.'
                  : persistentStatus === 'denied'
                    ? 'Without persistent storage permission, the browser may evict site data when local disk space gets tight.'
                    : 'This browser does not expose StorageManager.persisted() persistence controls.'}
              </p>
            </div>

            {persistentStatus === 'denied' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isRequestingPersist}
                onClick={handleRequestPersistent}
                className="self-start"
              >
                Request persistent storage
              </Button>
            )}
          </div>

          {/* Storage Usage & Pruning */}
          <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text)]">Browser Quota Usage</span>
                {usagePercent !== null && (
                  <span className="text-[11px] font-mono text-[var(--muted)] tabular-nums">
                    {usagePercent}%
                  </span>
                )}
              </div>

              {storageEstimate.supported && storageEstimate.usageBytes !== null ? (
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] transition-all"
                      style={{ width: `${Math.max(2, usagePercent ?? 2)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted)] tabular-nums font-mono">
                    {formatBytesHuman(storageEstimate.usageBytes)} used
                    {storageEstimate.quotaBytes
                      ? ` of ${formatBytesHuman(storageEstimate.quotaBytes)} available`
                      : ''}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--muted)] mt-1.5">
                  Storage usage estimation is unavailable in this browser.
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isCleaningUp}
              onClick={handleCleanupVersions}
              leftIcon={<Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />}
              className="self-start"
            >
              Clean up old versions
            </Button>
          </div>
        </div>

        {/* Full Backup Export & Restore */}
        <div className="pt-4 border-t border-[var(--border)] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text)]">
                Full Multi-Project Backup
              </h4>
              <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
                {lastBackupAt
                  ? `Last backup downloaded ${formatRelativeTime(lastBackupAt)} (${new Date(
                      lastBackupAt
                    ).toLocaleDateString()})`
                  : 'Never backed up yet — all projects currently exist only inside this browser.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2.5 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] hover:border-[#34343d] transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={includeChatHistory}
                onChange={(e) => setIncludeChatHistory(e.target.checked)}
                disabled={isExporting}
                className="mt-0.5 w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer shrink-0"
              />
              <div>
                <span className="text-xs font-medium text-[var(--text)] block">
                  Include chat history
                </span>
                <span className="text-[11px] text-[var(--muted)] block mt-0.5">
                  Saves sanitized user prompts and AI messages without sensitive keys.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] hover:border-[#34343d] transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={includeSnapshots}
                onChange={(e) => setIncludeSnapshots(e.target.checked)}
                disabled={isExporting}
                className="mt-0.5 w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer shrink-0"
              />
              <div>
                <span className="text-xs font-medium text-[var(--text)] block">
                  Include version history snapshots
                </span>
                <span className="text-[11px] text-[var(--muted)] block mt-0.5">
                  Preserves full content-addressed version checkpoints (larger archive).
                </span>
              </div>
            </label>
          </div>

          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--elevated)]/60 border border-[var(--border)] flex items-start gap-2 text-xs text-[var(--muted)]">
            <ShieldCheck className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
            <span>
              API keys, AI provider credentials, passphrases, and sandboxed preview storage values are <strong>never</strong> exported inside backups.
            </span>
          </div>

          {inspectError && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] flex items-start gap-2 text-xs text-[var(--error)]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{inspectError}</span>
            </div>
          )}

          {/* Export Live Progress */}
          {isExporting && (
            <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--text)] truncate pr-2">
                  {exportProgress?.currentTitle
                    ? `Packaging "${exportProgress.currentTitle}"...`
                    : 'Preparing backup archive...'}
                </span>
                {exportProgress && (
                  <span className="font-mono text-[11px] text-[var(--muted)] tabular-nums shrink-0">
                    {exportProgress.current}/{exportProgress.total}
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] transition-all"
                  style={{
                    width: exportProgress
                      ? `${Math.max(5, Math.round((exportProgress.current / exportProgress.total) * 100))}%`
                      : '12%',
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {isExporting ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => exportAbortRef.current?.abort()}
                leftIcon={<X className="w-3.5 h-3.5" />}
              >
                Cancel Export
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleExportBackup}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                Export all projects
              </Button>
            )}

            <input
              ref={restoreFileInputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={handleChooseRestoreFile}
              className="hidden"
              aria-label="Restore backup ZIP"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isInspectingBackup}
              disabled={isExporting || isRestoring}
              onClick={() => restoreFileInputRef.current?.click()}
              leftIcon={<Upload className="w-3.5 h-3.5" />}
            >
              Restore from backup...
            </Button>
          </div>
        </div>
      </Card>

      {/* Restore Backup Selection & Progress Modal */}
      <Modal
        isOpen={Boolean(parsedBackup)}
        onClose={closeRestoreModal}
        title="Restore from Backup"
        description={
          parsedBackup
            ? `Backup from ${new Date(parsedBackup.manifest.createdAt).toLocaleString()} · ${
                parsedBackup.projects.length
              } project(s) found`
            : undefined
        }
        className="max-w-xl"
      >
        {parsedBackup && !restoreResult && (
          <div className="space-y-4 pt-1">
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-start gap-2.5 text-xs text-[var(--muted)]">
              <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
              <span>
                Restored projects are created with <strong>new project IDs</strong> so they never overwrite your existing local projects.
              </span>
            </div>

            {parsedBackup.warnings.length > 0 && (
              <div className="p-2.5 rounded-[var(--radius-md)] bg-[rgba(245,183,59,0.08)] border border-[rgba(245,183,59,0.28)] text-[11px] text-[var(--warning)] max-h-24 overflow-y-auto space-y-0.5">
                {parsedBackup.warnings.map((w, idx) => (
                  <p key={idx}>· {w}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)] tabular-nums">
                {selectedIds.size} of {parsedBackup.projects.length} selected
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={isRestoring}
                  className="text-[var(--accent)] hover:underline font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>Select all</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  disabled={isRestoring}
                  className="text-[var(--muted)] hover:text-[var(--text)] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Deselect all</span>
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {parsedBackup.projects.map((p) => {
                const isChecked = selectedIds.has(p.entry.originalId);
                return (
                  <label
                    key={p.entry.originalId}
                    className={`flex items-start gap-3 p-3 rounded-[var(--radius-md)] border transition-colors cursor-pointer ${
                      isChecked
                        ? 'bg-[var(--elevated)] border-[var(--accent)]/60'
                        : 'bg-[var(--surface)] border-[var(--border)] hover:border-[#34343d]'
                    } ${isRestoring ? 'pointer-events-none opacity-75' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleProject(p.entry.originalId)}
                      disabled={isRestoring}
                      className="mt-1 w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-semibold text-[var(--text)] truncate">
                        {p.entry.title}
                      </p>
                      <p className="text-[11px] text-[var(--muted)] line-clamp-1 mt-0.5">
                        {p.entry.idea}
                      </p>
                      <p className="text-[11px] text-[var(--disabled)] mt-1 tabular-nums">
                        {p.files.length} files
                        {p.snapshots.length > 0 ? ` · ${p.snapshots.length} versions` : ''}
                        {p.messages.length > 0 ? ` · ${p.messages.length} messages` : ''}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {isRestoring && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text)] truncate pr-2">
                    {restoreProgress?.currentTitle
                      ? `Restoring "${restoreProgress.currentTitle}"...`
                      : 'Restoring projects...'}
                  </span>
                  {restoreProgress && (
                    <span className="font-mono text-[11px] text-[var(--muted)] tabular-nums shrink-0">
                      {restoreProgress.current}/{restoreProgress.total}
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all"
                    style={{
                      width: restoreProgress
                        ? `${Math.max(
                            5,
                            Math.round((restoreProgress.current / restoreProgress.total) * 100)
                          )}%`
                        : '10%',
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
              {isRestoring ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => restoreAbortRef.current?.abort()}
                  leftIcon={<X className="w-3.5 h-3.5" />}
                >
                  Cancel Restore
                </Button>
              ) : (
                <>
                  <Button type="button" variant="secondary" size="sm" onClick={closeRestoreModal}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={selectedIds.size === 0}
                    onClick={handleRestoreConfirm}
                    leftIcon={<Upload className="w-3.5 h-3.5" />}
                  >
                    Restore {selectedIds.size} project{selectedIds.size === 1 ? '' : 's'}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {parsedBackup && restoreResult && (
          <div className="space-y-4 pt-1">
            <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">
                  Restored {restoreResult.restoredCount} project(s)
                </p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  All selected files, designs, and saved metadata are ready in your local workspace.
                </p>
              </div>
            </div>

            {restoreResult.warnings.length > 0 && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] max-h-28 overflow-y-auto space-y-1">
                {restoreResult.warnings.map((w, i) => (
                  <p key={i}>· {w}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <Button type="button" variant="secondary" size="sm" onClick={closeRestoreModal}>
                Close
              </Button>
              <Link href="/projects" onClick={closeRestoreModal}>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
                >
                  Open Projects
                </Button>
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
