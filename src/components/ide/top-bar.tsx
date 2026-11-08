'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Settings, ChevronDown, Check, Sparkles } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import {
  listProviders,
  setDefault,
  setDefaultModel,
  type SafeProviderInfo,
} from '@/lib/keys';
import { updateProject } from '@/lib/db';

export interface TopBarProps {
  projectId: string;
  projectTitle: string;
  onTitleUpdated: (newTitle: string) => void;
  activeProvider: SafeProviderInfo | null;
  activeModel: string | null;
  onProviderChanged: (provider: SafeProviderInfo, modelId?: string) => void;
}

export function TopBar({
  projectId,
  projectTitle,
  onTitleUpdated,
  activeProvider,
  activeModel,
  onProviderChanged,
}: TopBarProps) {
  const { toast } = useToast();

  // Inline rename state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(projectTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Model switcher popover state
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [allProviders, setAllProviders] = useState<SafeProviderInfo[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  // Load providers when popover opens
  useEffect(() => {
    if (isPopoverOpen) {
      listProviders().then(setAllProviders).catch(console.error);
    }
  }, [isPopoverOpen]);

  // Close popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsPopoverOpen(false);
      }
    };
    if (isPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPopoverOpen]);

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      toast({
        type: 'error',
        title: 'Invalid Title',
        message: 'Project title cannot be empty.',
      });
      setTitleDraft(projectTitle);
      setIsEditingTitle(false);
      return;
    }

    if (trimmed.length > 60) {
      toast({
        type: 'error',
        title: 'Title Too Long',
        message: 'Project title must be between 1 and 60 characters.',
      });
      return;
    }

    if (trimmed !== projectTitle) {
      const success = await updateProject(projectId, { title: trimmed });
      if (success) {
        onTitleUpdated(trimmed);
        toast({
          type: 'info',
          title: 'Project Renamed',
          message: `Saved as "${trimmed}".`,
        });
      }
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setTitleDraft(projectTitle);
      setIsEditingTitle(false);
    }
  };

  const handleSelectProvider = async (provider: SafeProviderInfo, modelId?: string) => {
    await setDefault(provider.id);
    if (modelId) {
      await setDefaultModel(provider.id, modelId);
    }
    onProviderChanged(provider, modelId || provider.defaultModel);
    setIsPopoverOpen(false);
    toast({
      type: 'info',
      title: 'Active Model Switched',
      message: `${provider.label} · ${modelId || provider.defaultModel || 'No default model'}`,
    });
  };

  return (
    <header className="h-12 w-full bg-[var(--surface)] border-b border-[var(--border)] px-3 sm:px-4 flex items-center justify-between gap-2 shrink-0 z-30 select-none">
      {/* Left: Back Link & Editable Title */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 overflow-hidden">
        <Link href="/projects" tabIndex={-1} className="shrink-0 flex items-center justify-center min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px]">
          <Tooltip content="All Projects" position="bottom">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Back to all projects"
              className="text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] min-w-[36px] min-h-[36px]"
            >
              <ArrowLeft className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        </Link>

        <span className="text-[var(--border)] hidden sm:inline shrink-0" aria-hidden="true">
          /
        </span>

        {/* Project Title (Inline edit, flex-1 min-w-0 with ellipsis) */}
        <div className="flex-1 min-w-0 overflow-hidden pr-2">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={handleTitleKeyDown}
              maxLength={60}
              className="w-full bg-[var(--elevated)] text-[var(--text)] text-xs sm:text-sm font-semibold px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] truncate"
              aria-label="Rename project"
            />
          ) : (
            <Tooltip content="Click to rename project" position="bottom">
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(projectTitle);
                  setIsEditingTitle(true);
                }}
                className="text-xs sm:text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] hover:bg-[var(--elevated)] px-2 py-1 -mx-2 rounded-[var(--radius-sm)] transition-colors truncate block text-left w-full cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
              >
                {projectTitle}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Right: Active Model Chip Popover & Settings */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setIsPopoverOpen((prev) => !prev)}
            aria-expanded={isPopoverOpen}
            aria-haspopup="true"
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--elevated)] hover:bg-[#202026] border border-[var(--border)] text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer max-w-[160px] sm:max-w-[240px] shrink-0 min-h-[36px] sm:min-h-[32px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                activeProvider ? 'bg-[var(--accent)]' : 'bg-[var(--disabled)]'
              }`}
            />
            <span className="font-medium text-[var(--text)] truncate">
              {activeProvider?.label || 'No provider'}
            </span>
            <span className="text-[var(--disabled)] hidden sm:inline shrink-0">/</span>
            <span className="font-mono text-[var(--accent)] truncate hidden sm:inline">
              {activeModel || 'Select model'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 ml-auto" />
          </button>

          {/* Quick Model Switcher Popover */}
          {isPopoverOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-100 text-xs">
              <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--border)] pb-1.5 mb-1.5">
                <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                  Active Provider & Model
                </span>
                <Sparkles className="w-3 h-3 text-[var(--accent)]" />
              </div>

              {allProviders.length === 0 ? (
                <div className="p-3 text-center text-[var(--muted)]">
                  <p className="text-xs">No providers configured</p>
                  <Link
                    href="/settings"
                    className="inline-block mt-2 text-[var(--accent)] hover:underline font-medium text-[11px]"
                    onClick={() => setIsPopoverOpen(false)}
                  >
                    Add API Key in Settings →
                  </Link>
                </div>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
                  {allProviders.map((p) => {
                    const isSelected = activeProvider?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectProvider(p, p.defaultModel)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-sm)] flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--elevated)] text-[var(--accent)] font-medium border border-[var(--border)]'
                            : 'hover:bg-[var(--elevated)] text-[var(--text)]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="truncate text-xs">{p.label}</p>
                          <p className="text-[10px] text-[var(--muted)] font-mono truncate">
                            {p.defaultModel || 'No default model'}
                          </p>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 mt-1.5 border-t border-[var(--border)] flex items-center justify-between px-2">
                <Link
                  href="/settings"
                  onClick={() => setIsPopoverOpen(false)}
                  className="text-[11px] text-[var(--accent)] hover:underline flex items-center gap-1 font-medium"
                >
                  Configure in Settings →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Settings Icon Link */}
        <Link href="/settings" tabIndex={-1}>
          <Tooltip content="Settings" position="bottom">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Settings"
              className="text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)]"
            >
              <Settings className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        </Link>
      </div>
    </header>
  );
}
