'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', disabled, error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        disabled={disabled}
        className={cn(
          'w-full bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm min-h-[44px]',
          'placeholder:text-[var(--disabled)] transition-all duration-150',
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

Input.displayName = 'Input';
