'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseClasses =
      'inline-flex items-center justify-center font-medium transition-all duration-150 select-none cursor-pointer disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none';

    const variantClasses = {
      primary:
        'bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)] text-black font-semibold shadow-[var(--glow-accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
      secondary:
        'bg-[var(--surface)] hover:bg-[var(--elevated)] active:bg-[#222228] text-[var(--text)] border border-[var(--border)] hover:border-[#3c3c46] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]',
      ghost:
        'bg-transparent hover:bg-[var(--elevated)] active:bg-[#222228] text-[var(--muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
    };

    // Mobile min 44px touch targets
    const sizeClasses = {
      sm: 'text-xs h-9 sm:h-8 px-3 rounded-[var(--radius-sm)] min-h-[44px] sm:min-h-0 gap-1.5',
      md: 'text-sm h-11 sm:h-10 px-4 rounded-[var(--radius-md)] min-h-[44px] gap-2',
      lg: 'text-base h-12 px-6 rounded-[var(--radius-md)] min-h-[48px] gap-2.5',
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading}
        className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
        {!loading && leftIcon && <span className="shrink-0">{leftIcon}</span>}
        <span className="truncate">{children}</span>
        {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
