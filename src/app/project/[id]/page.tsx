'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Code2, AlertTriangle, FileQuestion } from 'lucide-react';
import { getProject, type Project } from '@/lib/db';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/utils';

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }

    let isMounted = true;
    getProject(id)
      .then((item) => {
        if (isMounted) {
          if (item) {
            setProject(item);
          } else {
            setHasError(true);
          }
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching project:', err);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Skeleton className="h-4 w-32 mb-6" />
        <Skeleton className="h-9 w-2/3 mb-2" />
        <Skeleton className="h-4 w-40 mb-8" />
        <Skeleton className="h-44 w-full mb-6" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (hasError || !project) {
    return (
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-16 flex items-center justify-center">
        <EmptyState
          icon={<FileQuestion className="w-6 h-6 text-[var(--error)]" />}
          title="Project not found"
          description={`We couldn't locate a project with ID "${id}" in your local IndexedDB storage. It may have been deleted or the link is invalid.`}
          action={
            <Link href="/">
              <Button variant="primary" size="md">
                Return to Home
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const formattedDate = new Date(project.createdAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <Link
          href="/projects"
          className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] rounded-[var(--radius-sm)] px-1 py-0.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Projects</span>
        </Link>
        <Badge variant="default" size="sm">
          Push 1 · Specification
        </Badge>
      </div>

      {/* Project Title & Metadata Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-[var(--text)] break-words">
          {project.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)] mt-2.5">
          <span className="flex items-center gap-1.5 tabular-nums">
            <Clock className="w-3.5 h-3.5 text-[var(--disabled)]" />
            <span>Created {formatRelativeTime(project.createdAt)}</span>
          </span>
          <span className="text-[var(--disabled)]" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums text-[var(--disabled)]">{formattedDate}</span>
          <span className="text-[var(--disabled)]" aria-hidden="true">
            ·
          </span>
          <span className="font-mono text-[11px] text-[var(--disabled)]">{project.id}</span>
        </div>
      </div>

      {/* Main Content: Saved Idea Card */}
      <div className="space-y-6">
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4 pb-4 mb-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
              Application Specification
            </h2>
            <span className="text-xs text-[var(--disabled)] tabular-nums">
              {project.idea.length} characters
            </span>
          </div>

          <div className="text-sm sm:text-base text-[var(--text)] leading-relaxed whitespace-pre-wrap font-sans">
            {project.idea}
          </div>
        </Card>

        {/* Info Card: IDE Coming in Push 4 */}
        <Card elevated className="p-6 border-[#303038]">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0">
              <Code2 className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-[var(--text)]">
                  Interactive Workspace
                </h3>
                <Badge variant="info" size="sm">
                  Roadmap
                </Badge>
              </div>
              <p className="text-sm font-medium text-[var(--text)] mt-1">
                The IDE (chat, preview, file tree) arrives in Push 4.
              </p>
              <p className="text-xs text-[var(--muted)] mt-1.5 leading-relaxed">
                In Push 1, your project brief and specifications are safely captured and stored in your browser&apos;s IndexedDB database. Full-stack scaffolding, interactive multi-file code editing, and live sandbox execution will activate once the IDE push is rolled out.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
