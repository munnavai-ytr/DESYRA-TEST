'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, FolderGit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { hasAnyKey } from '@/lib/keys';

export function Header() {
  const pathname = usePathname();
  const isProjectsActive = pathname === '/projects' || pathname.startsWith('/project/');
  const isSettingsActive = pathname === '/settings';
  const [hasKeys, setHasKeys] = useState<boolean>(true); // default true to avoid layout flicker before check

  useEffect(() => {
    let isMounted = true;
    const checkKeys = async () => {
      try {
        const has = await hasAnyKey();
        if (isMounted) {
          setHasKeys(has);
        }
      } catch {
        // Safe fallback
      }
    };

    checkKeys();
    window.addEventListener('focus', checkKeys);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', checkKeys);
    };
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 w-full bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)] transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
        {/* Left: Brand Wordmark in Space Grotesk */}
        <Link
          href="/"
          className="group flex items-center gap-1.5 text-lg sm:text-xl font-bold tracking-tight font-display text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-[var(--radius-sm)] px-1 py-0.5 select-none transition-transform active:scale-[0.98]"
          aria-label="DESYRA Home"
        >
          <span>DESYRA</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_rgba(255,107,26,0.8)] inline-block transition-transform group-hover:scale-125" />
        </Link>

        {/* Right: Projects link and Settings icon */}
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Main Navigation">
          <Link
            href="/projects"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-[var(--radius-md)] min-h-[44px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              isProjectsActive
                ? 'text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
            )}
          >
            <FolderGit2 className="w-4 h-4 text-[var(--muted)] shrink-0" />
            <span>Projects</span>
          </Link>

          <Tooltip content={!hasKeys ? 'Add an AI key' : 'Settings'} position="bottom">
            <Link
              href="/settings"
              aria-label="Settings"
              className={cn(
                'relative flex items-center justify-center w-11 h-11 sm:w-10 sm:h-10 rounded-[var(--radius-md)] min-w-[44px] min-h-[44px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                isSettingsActive
                  ? 'text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
              )}
            >
              <Settings className="w-4 h-4 shrink-0" />
              {!hasKeys && (
                <span
                  className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_rgba(255,107,26,0.9)] animate-pulse"
                  aria-hidden="true"
                />
              )}
            </Link>
          </Tooltip>
        </nav>
      </div>
    </header>
  );
}
