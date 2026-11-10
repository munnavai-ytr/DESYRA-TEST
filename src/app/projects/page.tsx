'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Trash2,
  ExternalLink,
  FolderPlus,
  ArrowLeft,
  Search,
  Copy,
  Download,
  Upload,
  Pencil,
  ShieldAlert,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  listProjects,
  deleteProject,
  updateProject,
  getAllProjectCountsMap,
  getProjectOwnedCounts,
  getLastBackupAt,
  getBackupReminderDismissedAt,
  setBackupReminderDismissedAt,
  type Project,
} from '@/lib/db';
import { duplicateProject } from '@/lib/history/snapshots';
import { extractDesignSpec } from '@/lib/design/install';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { ExportZipModal } from '@/components/ide/export-zip-modal';
import { ImportZipModal } from '@/components/projects/import-zip-modal';
import { formatRelativeTime } from '@/lib/utils';

type SortOption = 'updatedAt' | 'createdAt' | 'title';

const SEVEN_DAYS_MS = 7 * 86_400_000;
const ONE_DAY_MS = 86_400_000;

async function fetchProjectsOverviewData() {
  const [list, counts, lastBackup, dismissedAt] = await Promise.all([
    listProjects(),
    getAllProjectCountsMap(),
    getLastBackupAt(),
    getBackupReminderDismissedAt(),
  ]);
  const now = Date.now();
  const backupStaleOrMissing = !lastBackup || now - lastBackup > SEVEN_DAYS_MS;
  const notRecentlyDismissed = !dismissedAt || now - dismissedAt > ONE_DAY_MS;
  return {
    list,
    fileCounts: counts.fileCounts,
    snapshotCounts: counts.snapshotCounts,
    showBackupReminder: list.length >= 1 && backupStaleOrMissing && notRecentlyDismissed,
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [snapshotCounts, setSnapshotCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('updatedAt');

  // Backup reminder banner state
  const [showBackupReminder, setShowBackupReminder] = useState(false);

  // Import ZIP modal state
  const [isImportZipOpen, setIsImportZipOpen] = useState(false);

  // Export ZIP modal state
  const [exportTarget, setExportTarget] = useState<Project | null>(null);

  // Rename modal state
  const [projectToRename, setProjectToRename] = useState<Project | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  // Duplication busy indicator
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // Delete confirmation modal state with live owned counts
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteOwnedCounts, setDeleteOwnedCounts] = useState<{
    fileCount: number;
    snapshotCount: number;
    messageCount: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const refreshProjectsData = useCallback(async () => {
    try {
      const data = await fetchProjectsOverviewData();
      setProjects(data.list);
      setFileCounts(data.fileCounts);
      setSnapshotCounts(data.snapshotCounts);
      setShowBackupReminder(data.showBackupReminder);
    } catch (err) {
      console.error('Failed to load projects:', err);
      toast({
        type: 'error',
        title: 'Load Error',
        message: 'Could not load your projects.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let active = true;
    fetchProjectsOverviewData()
      .then((data) => {
        if (!active) return;
        setProjects(data.list);
        setFileCounts(data.fileCounts);
        setSnapshotCounts(data.snapshotCounts);
        setShowBackupReminder(data.showBackupReminder);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to load projects:', err);
        toast({
          type: 'error',
          title: 'Load Error',
          message: 'Could not load your projects.',
        });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  const handleDismissBackupReminder = async () => {
    setShowBackupReminder(false);
    await setBackupReminderDismissedAt(Date.now());
  };

  const openRenameModal = (project: Project) => {
    setProjectToRename(project);
    setRenameDraft(project.title);
    setRenameError(null);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectToRename) return;
    const clean = renameDraft.trim();
    if (!clean) {
      setRenameError('Project title cannot be empty.');
      return;
    }
    if (clean.length > 60) {
      setRenameError('Project title must be 60 characters or fewer.');
      return;
    }

    setIsRenaming(true);
    try {
      const now = Date.now();
      const ok = await updateProject(projectToRename.id, {
        title: clean,
        updatedAt: now,
      });
      if (ok) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === projectToRename.id ? { ...p, title: clean, updatedAt: now } : p
          )
        );
        toast({
          type: 'info',
          title: 'Project Renamed',
          message: `Saved as "${clean}".`,
        });
        setProjectToRename(null);
      }
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDuplicate = async (project: Project) => {
    if (duplicatingId) return;
    setDuplicatingId(project.id);
    try {
      const copy = await duplicateProject(project.id);
      await refreshProjectsData();
      toast({
        type: 'success',
        title: 'Project Duplicated',
        message: `Created "${copy.title}".`,
      });
    } catch (err) {
      toast({
        type: 'error',
        title: 'Duplicate Failed',
        message: err instanceof Error ? err.message : 'Could not duplicate project.',
      });
    } finally {
      setDuplicatingId(null);
    }
  };

  const openDeleteModal = async (project: Project) => {
    setProjectToDelete(project);
    setDeleteOwnedCounts(null);
    const counts = await getProjectOwnedCounts(project.id);
    setDeleteOwnedCounts(counts);
  };

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      const success = await deleteProject(projectToDelete.id);
      if (success) {
        toast({
          type: 'success',
          title: 'Project Deleted',
          message: `"${projectToDelete.title}" and all local data were removed.`,
        });
        await refreshProjectsData();
      }
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
      setDeleteOwnedCounts(null);
    }
  };

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? projects.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.idea.toLowerCase().includes(q)
        )
      : projects;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'createdAt') {
        return b.createdAt - a.createdAt;
      }
      return b.updatedAt - a.updatedAt;
    });
  }, [projects, searchQuery, sortBy]);

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/"
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to builder</span>
            </Link>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Projects
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            All locally stored applications built with DESYRA.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setIsImportZipOpen(true)}
            leftIcon={<Upload className="w-4 h-4" />}
          >
            Import ZIP
          </Button>
          <Link href="/">
            <Button variant="primary" size="md" leftIcon={<FolderPlus className="w-4 h-4" />}>
              New Project
            </Button>
          </Link>
        </div>
      </div>

      {/* Backup Reminder Banner */}
      {showBackupReminder && (
        <div className="mb-6 p-3.5 sm:p-4 rounded-[var(--radius-md)] bg-[var(--accent-soft)] border border-[rgba(255,107,26,0.3)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2.5 text-xs sm:text-sm text-[var(--text)]">
            <ShieldAlert className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5 sm:mt-0" />
            <span>Your projects live only in this browser. Download a backup.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <Link href="/settings#backup-section">
              <Button variant="primary" size="sm">
                Export backup
              </Button>
            </Link>
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Dismiss backup reminder"
              onClick={handleDismissBackupReminder}
              className="text-[var(--muted)] hover:text-[var(--text)]"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </div>
        </div>
      )}

      {/* Search and Sort Bar */}
      {!isLoading && projects.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[var(--disabled)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects by title or description..."
              className="pl-9 h-10 text-xs sm:text-sm"
              aria-label="Search projects"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="projects-sort" className="text-xs text-[var(--muted)] shrink-0">
              Sort by
            </label>
            <select
              id="projects-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="h-10 px-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-xs sm:text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              <option value="updatedAt">Last updated</option>
              <option value="createdAt">Newest created</option>
              <option value="title">Name (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {/* Content State */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Card key={n} className="p-5 flex flex-col justify-between h-48">
              <div>
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-4/5" />
              </div>
              <Skeleton className="h-4 w-1/2 mt-4" />
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="w-6 h-6" />}
          title="No projects yet"
          description="You haven't created any apps yet. Describe your idea on the home screen or import an existing ZIP archive."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/">
                <Button variant="primary" size="md">
                  Create First Project
                </Button>
              </Link>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setIsImportZipOpen(true)}
                leftIcon={<Upload className="w-4 h-4" />}
              >
                Import ZIP
              </Button>
            </div>
          }
        />
      ) : filteredAndSorted.length === 0 ? (
        <EmptyState
          icon={<Search className="w-6 h-6" />}
          title="No matching projects"
          description={`No projects matched "${searchQuery.trim()}".`}
          action={
            <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSorted.map((project) => {
            const spec = extractDesignSpec(project.design);
            const fCount = fileCounts[project.id] ?? 0;
            const sCount = snapshotCounts[project.id] ?? 0;

            return (
              <Card
                key={project.id}
                className="group flex flex-col justify-between p-5 hover:border-[#3c3c46] transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {spec?.seedHex && (
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/15"
                          style={{ backgroundColor: spec.seedHex }}
                          title={`Design color: ${spec.seedHex}`}
                        />
                      )}
                      <h2
                        onClick={() => router.push(`/project/${project.id}`)}
                        className="text-base font-semibold text-[var(--text)] line-clamp-1 cursor-pointer hover:text-[var(--accent)] transition-colors flex-1"
                        title={project.title}
                      >
                        {project.title}
                      </h2>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-1">
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Rename ${project.title}`}
                        title="Rename project"
                        onClick={() => openRenameModal(project)}
                        className="text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Duplicate ${project.title}`}
                        title="Duplicate project"
                        loading={duplicatingId === project.id}
                        disabled={Boolean(duplicatingId)}
                        onClick={() => handleDuplicate(project)}
                        className="text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Download ZIP for ${project.title}`}
                        title="Download ZIP"
                        onClick={() => setExportTarget(project)}
                        className="text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${project.title}`}
                        title="Delete project"
                        onClick={() => openDeleteModal(project)}
                        className="text-[var(--muted)] hover:text-[var(--error)]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  <p
                    onClick={() => router.push(`/project/${project.id}`)}
                    className="text-xs text-[var(--muted)] line-clamp-3 leading-relaxed cursor-pointer"
                  >
                    {project.idea}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[var(--border)]/70 text-[11px] text-[var(--disabled)] tabular-nums">
                  <span className="truncate">
                    {fCount} {fCount === 1 ? 'file' : 'files'} · {sCount}{' '}
                    {sCount === 1 ? 'version' : 'versions'} · {formatRelativeTime(project.updatedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => router.push(`/project/${project.id}`)}
                    className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Rename Project Modal */}
      <Modal
        isOpen={Boolean(projectToRename)}
        onClose={() => {
          if (!isRenaming) setProjectToRename(null);
        }}
        title="Rename Project"
        description="Enter a clear project name (1 to 60 characters)."
      >
        <form onSubmit={handleRenameSubmit} className="space-y-4 pt-1">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="rename-project-input" className="text-xs font-medium text-[var(--text)]">
                Project title
              </label>
              <span className="text-[11px] text-[var(--disabled)] tabular-nums">
                {renameDraft.trim().length}/60
              </span>
            </div>
            <Input
              id="rename-project-input"
              value={renameDraft}
              onChange={(e) => {
                setRenameDraft(e.target.value);
                setRenameError(null);
              }}
              maxLength={60}
              autoFocus
              disabled={isRenaming}
            />
            {renameError && (
              <p className="text-xs text-[var(--error)] mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{renameError}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setProjectToRename(null)}
              disabled={isRenaming}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={isRenaming}
              disabled={!renameDraft.trim()}
            >
              Save Title
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(projectToDelete)}
        onClose={() => {
          if (!isDeleting) {
            setProjectToDelete(null);
            setDeleteOwnedCounts(null);
          }
        }}
        title="Delete Project"
        description="Are you sure you want to delete this project? This will permanently remove all project data from local browser storage."
      >
        <div className="py-2 space-y-4">
          {projectToDelete && (
            <div className="p-3.5 bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-md)] space-y-1.5">
              <p className="text-xs sm:text-sm text-[var(--text)] font-semibold truncate">
                {projectToDelete.title}
              </p>
              {deleteOwnedCounts ? (
                <p className="text-xs text-[var(--muted)] tabular-nums">
                  This will remove {deleteOwnedCounts.fileCount}{' '}
                  {deleteOwnedCounts.fileCount === 1 ? 'file' : 'files'},{' '}
                  {deleteOwnedCounts.snapshotCount}{' '}
                  {deleteOwnedCounts.snapshotCount === 1 ? 'version' : 'versions'}, and{' '}
                  {deleteOwnedCounts.messageCount}{' '}
                  {deleteOwnedCounts.messageCount === 1 ? 'chat message' : 'chat messages'}.
                </p>
              ) : (
                <p className="text-xs text-[var(--disabled)]">Calculating project items...</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setProjectToDelete(null);
                setDeleteOwnedCounts(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleDeleteConfirm}
              loading={isDeleting}
              className="bg-[var(--error)] hover:bg-[#dc2626] active:bg-[#b91c1c] text-white shadow-none"
            >
              Delete Project
            </Button>
          </div>
        </div>
      </Modal>

      {/* Export ZIP Modal */}
      {exportTarget && (
        <ExportZipModal
          isOpen={Boolean(exportTarget)}
          onClose={() => setExportTarget(null)}
          projectId={exportTarget.id}
          projectTitle={exportTarget.title}
        />
      )}

      {/* Import ZIP Modal */}
      <ImportZipModal
        isOpen={isImportZipOpen}
        onClose={() => setIsImportZipOpen(false)}
        onImported={() => {
          void refreshProjectsData();
        }}
      />
    </div>
  );
}
