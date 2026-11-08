'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'info' | 'success' | 'warning' | 'error' | 'accent';
  size?: 'sm' | 'md';
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'md', children, ...props }, ref) => {
    const variants = {
      default: 'bg-[var(--elevated)] text-[var(--muted)] border-[var(--border)]',
      info: 'bg-[rgba(96,165,250,0.12)] text-[var(--info)] border-[rgba(96,165,250,0.25)]',
      success: 'bg-[rgba(34,197,94,0.12)] text-[var(--success)] border-[rgba(34,197,94,0.25)]',
      warning: 'bg-[rgba(245,183,59,0.12)] text-[var(--warning)] border-[rgba(245,183,59,0.25)]',
      error: 'bg-[rgba(239,68,68,0.12)] text-[var(--error)] border-[rgba(239,68,68,0.25)]',
      accent: 'bg-[var(--accent-soft)] text-[var(--accent)] border-[rgba(255,107,26,0.25)]',
    };

    const sizes = {
      sm: 'text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)]',
      md: 'text-xs px-2.5 py-1 rounded-[var(--radius-sm)]',
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium border leading-none tracking-tight whitespace-nowrap select-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
