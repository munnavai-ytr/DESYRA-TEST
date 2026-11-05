'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  'aria-label': string; // Enforce accessible label
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant = 'ghost',
      size = 'md',
      loading = false,
      disabled = false,
      children,
      type = 'button',
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      'inline-flex items-center justify-center font-medium transition-all duration-150 select-none cursor-pointer disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none';

    const variantClasses = {
      primary:
        'bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)] text-black shadow-[var(--glow-accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
      secondary:
        'bg-[var(--surface)] hover:bg-[var(--elevated)] active:bg-[#222228] text-[var(--text)] border border-[var(--border)] hover:border-[#3c3c46] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]',
      ghost:
        'bg-transparent hover:bg-[var(--elevated)] active:bg-[#222228] text-[var(--muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
    };

    // Ensure min 44px touch target on mobile
    const sizeClasses = {
      sm: 'w-9 h-9 sm:w-8 sm:h-8 p-1.5 rounded-[var(--radius-sm)] min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0',
      md: 'w-11 h-11 sm:w-10 sm:h-10 p-2 rounded-[var(--radius-md)] min-w-[44px] min-h-[44px]',
      lg: 'w-12 h-12 p-2.5 rounded-[var(--radius-md)] min-w-[48px] min-h-[48px]',
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading}
        aria-label={ariaLabel}
        className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        {...props}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
