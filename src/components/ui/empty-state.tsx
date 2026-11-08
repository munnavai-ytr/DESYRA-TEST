'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center p-8 sm:p-12 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]',
        className
      )}
    >
      {icon && (
        <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--muted)] mb-4 shrink-0">
          {icon}
        </div>
      )}
      <h3 className="text-base sm:text-lg font-semibold text-[var(--text)] tracking-tight">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[var(--muted)] max-w-sm mt-1.5 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
