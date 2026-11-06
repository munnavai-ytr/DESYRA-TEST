'use client';

import React from 'react';
import { MessageSquare, Eye, FolderTree, Code2 } from 'lucide-react';

export type MobileTab = 'chat' | 'preview' | 'files' | 'code';

export interface MobileTabsProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  fileCount?: number;
  hasSelectedFile?: boolean;
}

export function MobileTabs({
  activeTab,
  onTabChange,
  fileCount = 0,
  hasSelectedFile = false,
}: MobileTabsProps) {
  const tabs: { id: MobileTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string | number }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'files', label: 'Files', icon: FolderTree, badge: fileCount > 0 ? fileCount : undefined },
    { id: 'code', label: 'Code', icon: Code2, badge: hasSelectedFile ? '•' : undefined },
  ];

  return (
    <nav
      aria-label="Mobile workspace navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-[var(--surface)] border-t border-[var(--border)] px-2 flex items-center justify-around z-40 select-none pb-[env(safe-area-inset-bottom,0px)]"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            aria-selected={isActive}
            role="tab"
            className={`flex-1 h-full flex flex-col items-center justify-center gap-1 transition-colors relative cursor-pointer min-h-[48px] ${
              isActive
                ? 'text-[var(--accent)] font-medium'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <div className="relative">
              <Icon className="w-4 h-4" />
              {tab.badge !== undefined && (
                <span className="absolute -top-1.5 -right-3 text-[9px] font-mono px-1 rounded-full bg-[var(--elevated)] border border-[var(--border)] text-[var(--accent)] leading-none py-0.5">
                  {tab.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] leading-tight">{tab.label}</span>

            {/* Active top indicator bar */}
            {isActive && (
              <span className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-[var(--accent)] rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
