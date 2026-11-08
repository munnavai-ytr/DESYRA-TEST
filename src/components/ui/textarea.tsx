'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, disabled, error, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        disabled={disabled}
        className={cn(
          'w-full bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-md)] p-3.5 text-sm leading-relaxed',
          'placeholder:text-[var(--disabled)] transition-all duration-150 resize-none',
          'hover:border-[#383842]',
          'focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] focus-visible:shadow-[var(--glow-input)]',
          'disabled:opacity-45 disabled:pointer-events-none',
          error && 'border-[var(--error)] focus-visible:border-[var(--error)] focus-visible:ring-[var(--error)]',
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
