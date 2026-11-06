'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { getProject, type Project } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { IdeLayout } from '@/components/ide/ide-layout';

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
      <div className="h-[100dvh] w-full flex flex-col bg-[var(--bg)] p-4 sm:p-6 overflow-hidden">
        {/* Top bar skeleton */}
        <div className="h-12 w-full flex items-center justify-between border-b border-[var(--border)] pb-3 mb-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-32 rounded-full" />
            <Skeleton className="h-7 w-7 rounded-[var(--radius-sm)]" />
          </div>
        </div>

        {/* Workspace skeleton */}
        <div className="flex-1 flex gap-4 overflow-hidden">
          <Skeleton className="h-full w-1/3 rounded-[var(--radius-md)]" />
          <Skeleton className="h-full flex-1 rounded-[var(--radius-md)]" />
        </div>
      </div>
    );
  }

  if (hasError || !project) {
    return (
      <div className="h-[100dvh] w-full flex items-center justify-center p-4 bg-[var(--bg)]">
        <div className="max-w-md w-full">
          <EmptyState
            icon={<FileQuestion className="w-8 h-8 text-[var(--error)]" />}
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
      </div>
    );
  }

  return <IdeLayout initialProject={project} />;
}
