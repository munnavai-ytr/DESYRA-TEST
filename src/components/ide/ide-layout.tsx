'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, Code2, FolderTree, PanelLeft, X } from 'lucide-react';
import { TopBar } from './top-bar';
import { ChatPane } from './chat-pane';
import { FileTree } from './file-tree';
import { CodeEditor } from './code-editor';
import { PreviewPane } from './preview-pane';
import { MobileTabs, type MobileTab } from './mobile-tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/icon-button';
import type { Project, ProjectFile } from '@/lib/db';
import {
  listProviders,
  isSessionLocked,
  type SafeProviderInfo,
} from '@/lib/keys';
import { listFiles } from '@/lib/files';

export interface IdeLayoutProps {
  initialProject: Project;
}

export type WorkspaceTab = 'preview' | 'code';

const STORAGE_DIVIDER_KEY = 'desyra_ide_divider_ratio';
const DEFAULT_DESKTOP_RATIO = 0.35;
const DEFAULT_TABLET_RATIO = 0.40;

export function IdeLayout({ initialProject }: IdeLayoutProps) {
  const [project, setProject] = useState<Project>(initialProject);

  // Active Provider & Model state
  const [providers, setProviders] = useState<SafeProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<SafeProviderInfo | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);

  // Workspace tab: 'preview' or 'code'
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('code');

  // Mobile navigation tab: 'chat' | 'preview' | 'files' | 'code'
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  // Selected file for code editor
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [filesCount, setFilesCount] = useState<number>(0);

  // File tree visibility (desktop/tablet)
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(true);

  // Screen size flags
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  // Divider ratio (chat width percentage)
  const [dividerRatio, setDividerRatio] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_DIVIDER_KEY);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0.2 && parsed <= 0.8) {
          return parsed;
        }
      }
    }
    return DEFAULT_DESKTOP_RATIO;
  });

  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Refresh provider and file data
  const refreshIdeData = useCallback(() => {
    Promise.all([listProviders(), listFiles(project.id)])
      .then(([allProviders, files]) => {
        setProviders(allProviders);
        if (allProviders.length > 0) {
          const def = allProviders.find((p) => p.isDefault) || allProviders[0];
          setActiveProvider(def);
          setActiveModel(def.defaultModel || null);
        }
        setFilesCount(files.length);
        if (files.length > 0) {
          setSelectedFile((prev) => prev ?? files[0]);
        }
      })
      .catch((err) => {
        console.error('Failed to initialize IDE data:', err);
      });
  }, [project.id]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([listProviders(), listFiles(project.id)])
      .then(([allProviders, files]) => {
        if (!isMounted) return;
        setProviders(allProviders);
        if (allProviders.length > 0) {
          const def = allProviders.find((p) => p.isDefault) || allProviders[0];
          setActiveProvider(def);
          setActiveModel(def.defaultModel || null);
        }
        setFilesCount(files.length);
        if (files.length > 0) {
          setSelectedFile((prev) => prev ?? files[0]);
        }
      })
      .catch((err) => {
        console.error('Failed to initialize IDE data:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [project.id]);

  // Window resize listener
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const mobile = width < 768;
      const tablet = width >= 768 && width < 1024;
      setIsMobile(mobile);
      setIsTablet(tablet);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard shortcut to toggle file tree (Ctrl+B / Cmd+B)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsFileTreeOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle divider dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  const handleTouchStart = () => {
    setIsDraggingDivider(true);
  };

  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const containerWidth = rect.width;
      const mouseX = e.clientX - rect.left;

      // Min chat 300px, min workspace 480px
      const minRatio = 300 / containerWidth;
      const maxRatio = (containerWidth - 480) / containerWidth;

      if (maxRatio > minRatio) {
        const rawRatio = mouseX / containerWidth;
        const clamped = Math.max(minRatio, Math.min(maxRatio, rawRatio));
        setDividerRatio(clamped);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!containerRef.current || e.touches.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const containerWidth = rect.width;
      const touchX = e.touches[0].clientX - rect.left;

      const minRatio = 300 / containerWidth;
      const maxRatio = (containerWidth - 480) / containerWidth;

      if (maxRatio > minRatio) {
        const rawRatio = touchX / containerWidth;
        const clamped = Math.max(minRatio, Math.min(maxRatio, rawRatio));
        setDividerRatio(clamped);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      try {
        localStorage.setItem(STORAGE_DIVIDER_KEY, dividerRatio.toString());
      } catch (err) {
        console.error('Failed to save divider ratio preference:', err);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDraggingDivider, dividerRatio]);

  // Keyboard accessibility on divider
  const handleDividerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setDividerRatio((prev) => {
        const next = Math.max(0.2, prev - 0.02);
        try {
          localStorage.setItem(STORAGE_DIVIDER_KEY, next.toString());
        } catch {}
        return next;
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setDividerRatio((prev) => {
        const next = Math.min(0.65, prev + 0.02);
        try {
          localStorage.setItem(STORAGE_DIVIDER_KEY, next.toString());
        } catch {}
        return next;
      });
    } else if (e.key === 'Home') {
      e.preventDefault();
      const def = isTablet ? DEFAULT_TABLET_RATIO : DEFAULT_DESKTOP_RATIO;
      setDividerRatio(def);
      try {
        localStorage.setItem(STORAGE_DIVIDER_KEY, def.toString());
      } catch {}
    }
  };

  // Handlers for file selection
  const handleSelectFile = (file: ProjectFile) => {
    setSelectedFile(file);
    // If on mobile, switch to Code tab
    if (isMobile) {
      setMobileTab('code');
    } else {
      setWorkspaceTab('code');
    }
  };

  const handleProviderChanged = (provider: SafeProviderInfo, modelId?: string) => {
    setActiveProvider(provider);
    setActiveModel(modelId || provider.defaultModel || null);
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)] overflow-hidden select-none">
      {/* Top Bar (Height ~48px) */}
      <TopBar
        projectId={project.id}
        projectTitle={project.title}
        onTitleUpdated={(newTitle) =>
          setProject((prev) => ({ ...prev, title: newTitle, updatedAt: Date.now() }))
        }
        activeProvider={activeProvider}
        activeModel={activeModel}
        onProviderChanged={handleProviderChanged}
      />

      {/* Main Body - Viewport Area */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* ================= DESKTOP & TABLET LAYOUT (>= 768px) ================= */}
        <div className="hidden md:flex flex-1 w-full h-full overflow-hidden">
          {/* Left Pane: Chat */}
          <div
            style={{ width: `${dividerRatio * 100}%` }}
            className="h-full flex flex-col shrink-0 min-w-[300px]"
          >
            <ChatPane
              project={project}
              activeProvider={activeProvider}
              activeModel={activeModel}
              onRefreshProviders={refreshIdeData}
            />
          </div>

          {/* Draggable Vertical Divider */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(dividerRatio * 100)}
            tabIndex={0}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onKeyDown={handleDividerKeyDown}
            aria-label="Resize chat and workspace panes"
            className={`w-1 hover:w-1.5 active:w-1.5 bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-col-resize shrink-0 z-20 flex items-center justify-center relative focus:outline-none focus:ring-1 focus:ring-[var(--accent)] ${
              isDraggingDivider ? 'bg-[var(--accent)] w-1.5' : ''
            }`}
          >
            {/* Visual handle indicator */}
            <div className="w-0.5 h-6 bg-[var(--disabled)] rounded-full pointer-events-none" />
          </div>

          {/* Right Pane: IDE Workspace */}
          <div
            style={{ width: `${(1 - dividerRatio) * 100}%` }}
            className="h-full flex flex-col flex-1 min-w-[480px] bg-[var(--bg)] overflow-hidden"
          >
            {/* Workspace Top Tab Bar */}
            <div className="h-10 px-3 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between shrink-0">
              {/* Tab Navigation: Preview / Code */}
              <div className="flex items-center gap-1 h-full">
                <button
                  type="button"
                  onClick={() => setWorkspaceTab('preview')}
                  className={`flex items-center gap-1.5 px-3 h-full text-xs transition-colors cursor-pointer relative ${
                    workspaceTab === 'preview'
                      ? 'text-[var(--text)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Preview</span>
                  {workspaceTab === 'preview' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)]" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setWorkspaceTab('code')}
                  className={`flex items-center gap-1.5 px-3 h-full text-xs transition-colors cursor-pointer relative ${
                    workspaceTab === 'code'
                      ? 'text-[var(--text)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Code</span>
                  {selectedFile && (
                    <span className="font-mono text-[10px] text-[var(--muted)] max-w-[120px] truncate ml-1">
                      {selectedFile.path}
                    </span>
                  )}
                  {workspaceTab === 'code' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)]" />
                  )}
                </button>
              </div>

              {/* Right: File Tree Toggle Button */}
              <div className="flex items-center gap-1">
                <Tooltip
                  content={isFileTreeOpen ? 'Hide Files (Ctrl+B)' : 'Show Files (Ctrl+B)'}
                  position="bottom"
                >
                  <button
                    type="button"
                    onClick={() => setIsFileTreeOpen((prev) => !prev)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                      isFileTreeOpen
                        ? 'bg-[var(--elevated)] border-[var(--border)] text-[var(--text)]'
                        : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <FolderTree className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="text-[11px]">Files</span>
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Split Content: File Tree on left + (Preview or Code) on right */}
            <div className="flex-1 flex overflow-hidden relative">
              {/* File Tree Panel */}
              {isTablet ? (
                // Tablet: Overlay drawer
                isFileTreeOpen && (
                  <div className="absolute inset-y-0 left-0 z-30 w-64 bg-[var(--surface)] shadow-2xl border-r border-[var(--border)] flex flex-col animate-in slide-in-from-left-4 duration-150">
                    <div className="h-8 px-2 flex items-center justify-between border-b border-[var(--border)]">
                      <span className="text-xs font-semibold text-[var(--text)]">Explorer</span>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Close files drawer"
                        onClick={() => setIsFileTreeOpen(false)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <FileTree
                        projectId={project.id}
                        selectedFilePath={selectedFile?.path ?? null}
                        onSelectFile={(f) => {
                          handleSelectFile(f);
                          setIsFileTreeOpen(false); // Close drawer on tablet after file selection
                        }}
                      />
                    </div>
                  </div>
                )
              ) : (
                // Desktop: Inline collapsible panel (default 240px)
                isFileTreeOpen && (
                  <div className="w-60 h-full shrink-0 border-r border-[var(--border)]">
                    <FileTree
                      projectId={project.id}
                      selectedFilePath={selectedFile?.path ?? null}
                      onSelectFile={handleSelectFile}
                      onToggleCollapse={() => setIsFileTreeOpen(false)}
                      isCollapsible
                    />
                  </div>
                )
              )}

              {/* Main Workspace Area (Preview or Code) */}
              <div className="flex-1 h-full overflow-hidden">
                {workspaceTab === 'preview' ? (
                  <PreviewPane />
                ) : (
                  <CodeEditor
                    projectId={project.id}
                    file={selectedFile}
                    onFileUpdated={(updated) => setSelectedFile(updated)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ================= MOBILE LAYOUT (< 768px) ================= */}
        {/* All 4 panes are rendered and kept mounted to preserve state (scroll position, textarea, draft) */}
        <div className="flex md:hidden flex-1 w-full h-full pb-14 overflow-hidden relative">
          {/* Mobile Pane 1: Chat */}
          <div
            className={`w-full h-full flex flex-col ${
              mobileTab === 'chat' ? 'flex' : 'hidden'
            }`}
          >
            <ChatPane
              project={project}
              activeProvider={activeProvider}
              activeModel={activeModel}
              onRefreshProviders={refreshIdeData}
            />
          </div>

          {/* Mobile Pane 2: Preview */}
          <div
            className={`w-full h-full flex flex-col ${
              mobileTab === 'preview' ? 'flex' : 'hidden'
            }`}
          >
            <PreviewPane />
          </div>

          {/* Mobile Pane 3: Files */}
          <div
            className={`w-full h-full flex flex-col ${
              mobileTab === 'files' ? 'flex' : 'hidden'
            }`}
          >
            <FileTree
              projectId={project.id}
              selectedFilePath={selectedFile?.path ?? null}
              onSelectFile={(f) => {
                handleSelectFile(f);
                setMobileTab('code'); // Selecting a file switches to Code
              }}
            />
          </div>

          {/* Mobile Pane 4: Code */}
          <div
            className={`w-full h-full flex flex-col ${
              mobileTab === 'code' ? 'flex' : 'hidden'
            }`}
          >
            <CodeEditor
              projectId={project.id}
              file={selectedFile}
              onFileUpdated={(updated) => setSelectedFile(updated)}
            />
          </div>

          {/* Fixed Bottom Mobile Tabs Bar */}
          <MobileTabs
            activeTab={mobileTab}
            onTabChange={(tab) => setMobileTab(tab)}
            fileCount={filesCount}
            hasSelectedFile={Boolean(selectedFile)}
          />
        </div>
      </div>
    </div>
  );
}
