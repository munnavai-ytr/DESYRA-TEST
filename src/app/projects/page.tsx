'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, ExternalLink, Clock, FolderPlus, ArrowLeft } from 'lucide-react';
import { listProjects, deleteProject, type Project } from '@/lib/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { formatRelativeTime } from '@/lib/utils';

export default function ProjectsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    listProjects()
      .then((data) => {
        if (active) {
          setProjects(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load projects:', err);
        if (active) {
          toast({
            type: 'error',
            title: 'Load Error',
            message: 'Could not load your projects.',
          });
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [toast]);

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      const success = await deleteProject(projectToDelete.id);
      if (success) {
        toast({
          type: 'success',
          title: 'Project Deleted',
          message: `"${projectToDelete.title}" was removed.`,
        });
        setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      }
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  };

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
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

        <Link href="/">
          <Button variant="primary" size="md" leftIcon={<FolderPlus className="w-4 h-4" />}>
            New Project
          </Button>
        </Link>
      </div>

      {/* Content State */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Card key={n} className="p-5 flex flex-col justify-between h-44">
              <div>
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-4/5" />
              </div>
              <Skeleton className="h-4 w-1/3 mt-4" />
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="w-6 h-6" />}
          title="No projects yet"
          description="You haven't created any apps yet. Describe your idea on the home screen to build your first project."
          action={
            <Link href="/">
              <Button variant="primary" size="md">
                Create First Project
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="group flex flex-col justify-between p-5 hover:border-[#3c3c46] transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2
                    onClick={() => router.push(`/project/${project.id}`)}
                    className="text-base font-semibold text-[var(--text)] line-clamp-1 cursor-pointer hover:text-[var(--accent)] transition-colors flex-1"
                    title={project.title}
                  >
                    {project.title}
                  </h2>
                  <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-1">
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Open ${project.title}`}
                      onClick={() => router.push(`/project/${project.id}`)}
                      className="text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${project.title}`}
                      onClick={() => setProjectToDelete(project)}
                      className="text-[var(--muted)] hover:text-[var(--error)]"
                    >
                      <Trash2 className="w-4 h-4" />
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

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border)]/70 text-[11px] text-[var(--disabled)] tabular-nums">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatRelativeTime(project.createdAt)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/project/${project.id}`)}
                  className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors font-medium flex items-center gap-1"
                >
                  Open
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(projectToDelete)}
        onClose={() => setProjectToDelete(null)}
        title="Delete Project"
        description="Are you sure you want to delete this project? This will remove it permanently from local storage."
      >
        <div className="py-2">
          {projectToDelete && (
            <div className="p-3 bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-md)] text-xs text-[var(--text)] font-medium mb-4 truncate">
              {projectToDelete.title}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 mt-4">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setProjectToDelete(null)}
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
    </div>
  );
}
