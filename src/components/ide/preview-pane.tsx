'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Smartphone,
  Tablet,
  Monitor,
  RotateCw,
  Maximize2,
  Minimize2,
  Terminal,
  FileCode,
  AlertTriangle,
  CheckCircle2,
  MoreVertical,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { notify } from '@/components/ui/toast';
import { listFiles } from '@/lib/files';
import {
  type ProjectFile,
  listPreviewStorage,
  setPreviewStorageItem,
  removePreviewStorageItem,
  clearPreviewStorage,
  getPreviewStorageBytes,
  MAX_PREVIEW_STORAGE_TOTAL_BYTES,
} from '@/lib/db';
import { buildPreviewDocument, type PreviewWarning, type BuildPreviewResult } from '@/lib/preview/buildPreview';
import { useProjectFileRevision, useIsAnyFileWriting } from '@/lib/ai/aiFileStore';

export type DeviceMode = 'mobile' | 'tablet' | 'desktop';

export interface PreviewPaneProps {
  projectId: string;
  isVisible?: boolean;
}

interface DeviceOption {
  id: DeviceMode;
  label: string;
  targetWidth: number;
  icon: React.ComponentType<{ className?: string }>;
}

const DEVICE_OPTIONS: DeviceOption[] = [
  { id: 'mobile', label: 'Phone', targetWidth: 390, icon: Smartphone },
  { id: 'tablet', label: 'Tablet', targetWidth: 768, icon: Tablet },
  { id: 'desktop', label: 'Desktop', targetWidth: 1280, icon: Monitor },
];

export interface ConsoleLogEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: string[];
  source?: { file?: string; line?: number };
  timestamp: number;
}

export function PreviewPane({ projectId, isVisible = true }: PreviewPaneProps) {
  // Device mode
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');

  // Preview build state
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [warnings, setWarnings] = useState<PreviewWarning[]>([]);
  const [unsupportedInfo, setUnsupportedInfo] = useState<BuildPreviewResult['unsupported'] | null>(null);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [hasNoFiles, setHasNoFiles] = useState<boolean>(false);
  const [hasNoHtml, setHasNoHtml] = useState<boolean>(false);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string>('index.html');
  const [availableHtmlFiles, setAvailableHtmlFiles] = useState<string[]>([]);

  // Auto-refresh & dirty states
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const isAiWriting = useIsAnyFileWriting(projectId);

  // Nonce for validating postMessages from the currently rendered document
  const currentNonceRef = useRef<string>('');
  const previousBlobUrlsRef = useRef<string[]>([]);

  // Console Drawer
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([]);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // "..." dropdown menu & clear storage modal
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [copiedConsole, setCopiedConsole] = useState<boolean>(false);
  const [storageBytes, setStorageBytes] = useState<number>(0);

  // Virtual scaling: container measurement
  const frameContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const fileRevision = useProjectFileRevision(projectId);

  // Update container dimensions on resize
  useEffect(() => {
    if (!frameContainerRef.current) return;
    const el = frameContainerRef.current;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  // Compute scale and dimension for virtual responsive scaling
  const currentDevice = DEVICE_OPTIONS.find((d) => d.id === deviceMode) || DEVICE_OPTIONS[2];
  const { scale, frameWidth, frameHeight, marginX } = useMemo(() => {
    const containerW = containerDimensions.width || 800;
    const containerH = containerDimensions.height || 600;

    if (deviceMode === 'desktop') {
      // If desktop viewport is narrower than 1280px, scale down smoothly
      if (containerW < 1280 && containerW > 0) {
        const s = Math.max(0.2, (containerW - 16) / 1280);
        return {
          scale: s,
          frameWidth: 1280,
          frameHeight: containerH / s,
          marginX: 0,
        };
      }
      return {
        scale: 1,
        frameWidth: containerW,
        frameHeight: containerH,
        marginX: 0,
      };
    }

    // Phone (390px) or Tablet (768px)
    const targetW = currentDevice.targetWidth;
    if (containerW < targetW + 32 && containerW > 0) {
      const s = Math.max(0.2, (containerW - 16) / targetW);
      return {
        scale: s,
        frameWidth: targetW,
        frameHeight: containerH / s,
        marginX: 0,
      };
    }

    return {
      scale: 1,
      frameWidth: targetW,
      frameHeight: containerH,
      marginX: Math.max(0, (containerW - targetW) / 2),
    };
  }, [deviceMode, currentDevice.targetWidth, containerDimensions]);

  // Cleanup blob URLs on unmount or before new preview build
  const cleanupBlobs = useCallback(() => {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
      for (const url of previousBlobUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
    }
    previousBlobUrlsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      cleanupBlobs();
    };
  }, [cleanupBlobs]);

  // Refresh preview storage bytes count periodically or when modal opens
  const refreshStorageInfo = useCallback(async () => {
    if (!projectId) return;
    const bytes = await getPreviewStorageBytes(projectId);
    setStorageBytes(bytes);
  }, [projectId]);

  useEffect(() => {
    if (isMenuOpen || isClearModalOpen) {
      const timer = setTimeout(() => {
        refreshStorageInfo();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isMenuOpen, isClearModalOpen, refreshStorageInfo]);

  // Main Compile Function
  const compilePreview = useCallback(async () => {
    if (!projectId) return;
    setIsBuilding(true);

    try {
      const files: ProjectFile[] = await listFiles(projectId);

      if (files.length === 0) {
        setHasNoFiles(true);
        setHasNoHtml(false);
        setUnsupportedInfo(null);
        setHtmlContent('');
        setIsBuilding(false);
        setIsDirty(false);
        return;
      }

      setHasNoFiles(false);

      // Find HTML files
      const htmls = files
        .filter((f) => f.path.endsWith('.html') || f.path.endsWith('.htm'))
        .map((f) => f.path)
        .sort();

      setAvailableHtmlFiles(htmls);

      if (htmls.length === 0) {
        setHasNoHtml(true);
        setUnsupportedInfo(null);
        setHtmlContent('');
        setIsBuilding(false);
        setIsDirty(false);
        return;
      }

      setHasNoHtml(false);

      // Resolve which entry file to use
      let activeEntry = selectedEntryPath;
      if (!htmls.includes(activeEntry)) {
        activeEntry = htmls.includes('index.html') ? 'index.html' : htmls[0];
        setSelectedEntryPath(activeEntry);
      }

      // Cleanup prior blob URLs
      cleanupBlobs();

      // Retrieve initial storage from IndexedDB previewStorage table
      const initialStorage = await listPreviewStorage(projectId);

      // Generate per-render nonce
      const nonce = `desyra_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
      currentNonceRef.current = nonce;

      // Compile document
      const result = buildPreviewDocument(files, activeEntry, {
        nonce,
        initialStorage,
      });

      previousBlobUrlsRef.current = result.blobUrls;

      if (result.unsupported?.isUnsupported) {
        setUnsupportedInfo(result.unsupported);
        setHtmlContent('');
      } else {
        setUnsupportedInfo(null);
        setHtmlContent(result.html);
      }

      setWarnings(result.warnings);
      setIsDirty(false);
    } catch (err) {
      console.error('[DESYRA Preview] Build error:', err);
      notify({
        type: 'error',
        title: 'Preview build failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsBuilding(false);
    }
  }, [projectId, selectedEntryPath, cleanupBlobs]);

  // Trigger rebuild when fileRevision bumps, respecting autoRefresh, visibility, and AI writing state
  useEffect(() => {
    // If AI is currently streaming chunks to files, wait until stream finishes
    if (isAiWriting) {
      const timer = setTimeout(() => setIsDirty(true), 0);
      return () => clearTimeout(timer);
    }

    if (!autoRefresh) {
      const timer = setTimeout(() => setIsDirty(true), 0);
      return () => clearTimeout(timer);
    }

    if (!isVisible) {
      const timer = setTimeout(() => setIsDirty(true), 0);
      return () => clearTimeout(timer);
    }

    // Debounce slightly to allow batched writes to settle
    const timer = setTimeout(() => {
      compilePreview();
    }, fileRevision === 0 ? 0 : 150);

    return () => clearTimeout(timer);
  }, [fileRevision, autoRefresh, isVisible, isAiWriting, compilePreview]);

  // If pane was hidden and becomes visible while dirty, trigger rebuild
  useEffect(() => {
    if (isVisible && isDirty && autoRefresh && !isAiWriting) {
      const timer = setTimeout(() => {
        compilePreview();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isVisible, isDirty, autoRefresh, isAiWriting, compilePreview]);

  // Handle incoming postMessage events from iframe sandbox
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Verify origin: sandboxed iframe without allow-same-origin has origin 'null'
      // Verify target frame
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) {
        return;
      }

      const data = e.data;
      if (!data || typeof data !== 'object') return;

      // Security check: verify per-render nonce
      if (data.nonce !== currentNonceRef.current) {
        return;
      }

      if (data.type === 'console') {
        const newEntry: ConsoleLogEntry = {
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          level: data.level || 'log',
          args: Array.isArray(data.args) ? data.args : [String(data.args)],
          source: data.source,
          timestamp: Date.now(),
        };

        setConsoleLogs((prev) => {
          const next = [...prev, newEntry];
          if (next.length > 500) {
            return next.slice(next.length - 500);
          }
          return next;
        });

        // Auto-scroll console if open
        if (isConsoleOpen) {
          setTimeout(() => {
            consoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 50);
        }
      } else if (data.type === 'storage') {
        if (data.action === 'set' && data.key && data.value !== undefined) {
          setPreviewStorageItem(projectId, data.key, data.value).then((res) => {
            if (!res.success && res.error) {
              setConsoleLogs((prev) => [
                ...prev,
                {
                  id: `log_err_${Date.now()}`,
                  level: 'warn',
                  args: [`[Preview Storage] ${res.error}`],
                  timestamp: Date.now(),
                },
              ]);
            }
          });
        } else if (data.action === 'remove' && data.key) {
          removePreviewStorageItem(projectId, data.key);
        } else if (data.action === 'clear') {
          clearPreviewStorage(projectId);
        }
      } else if (data.type === 'navigate' && data.path) {
        // Local relative HTML page navigation from <a href="sub.html">
        const clean = data.path.split('?')[0].split('#')[0].replace(/^\.?\//, '');
        setSelectedEntryPath(clean);
        // Force compile new entry
        setTimeout(() => {
          compilePreview();
        }, 50);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [projectId, isConsoleOpen, compilePreview]);

  // Listen to Esc key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Console counts
  const errorCount = useMemo(
    () => consoleLogs.filter((l) => l.level === 'error').length,
    [consoleLogs]
  );
  const warnCount = useMemo(
    () => consoleLogs.filter((l) => l.level === 'warn').length,
    [consoleLogs]
  );

  // Copy entire console output to clipboard
  const handleCopyConsole = async () => {
    if (consoleLogs.length === 0) {
      notify({ type: 'info', message: 'Console is empty.' });
      return;
    }
    const text = consoleLogs
      .map((l) => {
        const time = new Date(l.timestamp).toLocaleTimeString();
        const src = l.source?.file ? ` (${l.source.file}:${l.source.line || 0})` : '';
        return `[${time}] [${l.level.toUpperCase()}]${src} ${l.args.join(' ')}`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedConsole(true);
      notify({ type: 'success', message: 'Console logs copied to clipboard.' });
      setTimeout(() => setCopiedConsole(false), 2000);
    } catch {
      notify({ type: 'error', message: 'Failed to copy console logs.' });
    }
  };

  // Clear preview storage in IndexedDB and reload iframe
  const handleConfirmClearStorage = async () => {
    setIsClearing(true);
    try {
      await clearPreviewStorage(projectId);
      setStorageBytes(0);
      setIsClearModalOpen(false);
      setIsMenuOpen(false);
      notify({ type: 'success', message: 'Preview storage cleared.' });
      compilePreview();
    } catch (err) {
      notify({ type: 'error', message: 'Failed to clear preview storage.' });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div
      className={`flex flex-col bg-[var(--bg)] text-[var(--text)] overflow-hidden select-none relative ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-screen'
          : 'h-full w-full min-h-0'
      }`}
    >
      {/* 1. Preview Toolbar (Height ~38px) */}
      <div className="h-9 px-3 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between shrink-0 gap-2 overflow-x-auto no-scrollbar">
        {/* Left: Device Mode Switcher */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-sm)] p-0.5">
            {DEVICE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = deviceMode === opt.id;
              return (
                <Tooltip key={opt.id} content={`${opt.label} (${opt.targetWidth}px)`} position="bottom">
                  <button
                    type="button"
                    onClick={() => setDeviceMode(opt.id)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[var(--surface)] text-[var(--text)] font-medium shadow-sm'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-[11px]">{opt.label}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {/* HTML Page Selector Dropdown (Shown only when multiple HTML files exist) */}
          {availableHtmlFiles.length > 1 && (
            <div className="relative flex items-center ml-1">
              <FileCode className="w-3 h-3 text-[var(--accent)] absolute left-2 pointer-events-none" />
              <select
                value={selectedEntryPath}
                onChange={(e) => {
                  setSelectedEntryPath(e.target.value);
                  setTimeout(() => compilePreview(), 50);
                }}
                className="pl-6 pr-6 py-0.5 text-xs font-mono bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] appearance-none cursor-pointer focus:outline-none focus:border-[var(--accent)]"
              >
                {availableHtmlFiles.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-[var(--muted)] absolute right-1.5 pointer-events-none" />
            </div>
          )}

          {/* Status Indicators */}
          {isAiWriting && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-[var(--accent)]/10 text-[var(--accent)] rounded-[var(--radius-sm)] animate-pulse shrink-0">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              <span>Updating...</span>
            </span>
          )}

          {!isAiWriting && isDirty && (
            <button
              type="button"
              onClick={compilePreview}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-[var(--radius-sm)] cursor-pointer hover:bg-amber-500/25 transition-colors shrink-0"
            >
              <RotateCw className="w-2.5 h-2.5" />
              <span>Changes pending · Reload</span>
            </button>
          )}
        </div>

        {/* Right: Actions (Reload, Auto-refresh, Console, Fullscreen, Menu) */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Reload Button */}
          <Tooltip content="Reload Preview" position="bottom">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Reload preview"
              onClick={compilePreview}
              disabled={isBuilding}
              className="text-[var(--muted)] hover:text-[var(--text)]"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isBuilding ? 'animate-spin text-[var(--accent)]' : ''}`} />
            </IconButton>
          </Tooltip>

          {/* Auto-Refresh Toggle */}
          <Tooltip content={autoRefresh ? 'Auto-refresh is ON' : 'Auto-refresh is OFF'} position="bottom">
            <button
              type="button"
              onClick={() => setAutoRefresh((prev) => !prev)}
              aria-pressed={autoRefresh}
              className={`hidden sm:flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                autoRefresh
                  ? 'border-[var(--accent)]/40 text-[var(--text)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] text-[var(--disabled)] bg-transparent'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  autoRefresh ? 'bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]' : 'bg-[var(--disabled)]'
                }`}
              />
              <span>Auto</span>
            </button>
          </Tooltip>

          {/* Console Toggle Button with Error/Warn Badges */}
          <Tooltip content={isConsoleOpen ? 'Hide Console' : 'Show Console'} position="bottom">
            <button
              type="button"
              onClick={() => setIsConsoleOpen((prev) => !prev)}
              aria-pressed={isConsoleOpen}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                isConsoleOpen
                  ? 'bg-[var(--elevated)] border-[var(--border)] text-[var(--text)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="text-[11px]">Console</span>
              {errorCount > 0 && (
                <span className="px-1 text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/30 rounded-full">
                  {errorCount}
                </span>
              )}
              {errorCount === 0 && warnCount > 0 && (
                <span className="px-1 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full">
                  {warnCount}
                </span>
              )}
            </button>
          </Tooltip>

          {/* Fullscreen Toggle */}
          <Tooltip content={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Preview'} position="bottom">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="text-[var(--muted)] hover:text-[var(--text)]"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </IconButton>
          </Tooltip>

          {/* More Actions Menu */}
          <div className="relative">
            <Tooltip content="More Options" position="bottom">
              <IconButton
                size="sm"
                variant="ghost"
                aria-label="More options"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className="text-[var(--muted)] hover:text-[var(--text)]"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </IconButton>
            </Tooltip>

            {isMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-52 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-xl z-40 py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 border-b border-[var(--border)] text-[10px] text-[var(--muted)] flex justify-between items-center">
                  <span>Storage Used</span>
                  <span className="font-mono text-[var(--text)]">
                    {Math.round(storageBytes / 1024)} KB / 1 MB
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    handleCopyConsole();
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--elevated)] text-[var(--text)] cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>Copy Console Output</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsClearModalOpen(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--elevated)] text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Preview Data...</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Warnings Bar (If any compiler warnings exist) */}
      {warnings.length > 0 && !unsupportedInfo && (
        <div className="px-3 py-1 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-[11px] flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">
            {warnings[0].message}
            {warnings.length > 1 && ` (+${warnings.length - 1} more)`}
          </span>
        </div>
      )}

      {/* 2. Main Frame Area */}
      <div
        ref={frameContainerRef}
        onClick={() => isMenuOpen && setIsMenuOpen(false)}
        className="flex-1 min-h-0 min-w-0 bg-[var(--bg)] relative overflow-hidden flex flex-col"
      >
        {/* State A: Unsupported Framework (React/TSX/Vue/package.json) */}
        {unsupportedInfo?.isUnsupported && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 shadow-xl text-center">
              <div className="w-12 h-12 rounded-[var(--radius-md)] bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text)] mb-2 tracking-tight">
                Preview Not Supported for this Project
              </h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">
                {unsupportedInfo.reason}
              </p>
              <div className="bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-sm)] p-3 text-left mb-4">
                <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider block mb-1.5">
                  Detected Files
                </span>
                <ul className="text-xs font-mono text-[var(--text)] space-y-1">
                  {unsupportedInfo.detectedFiles.map((file) => (
                    <li key={file} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span>{file}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] text-[var(--disabled)]">
                The free in-browser preview runs static web apps (HTML, CSS, vanilla JS, Tailwind CDN, Alpine).
              </p>
            </div>
          </div>
        )}

        {/* State B: No Project Files Yet */}
        {!unsupportedInfo && hasNoFiles && (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-sm">
              <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4 text-[var(--accent)]">
                <FileCode className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text)] mb-1 tracking-tight">
                Nothing to preview yet
              </h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Ask DESYRA in the chat to build an application, and live preview will render here automatically.
              </p>
            </div>
          </div>
        )}

        {/* State C: Files Exist But No HTML Entry Point */}
        {!unsupportedInfo && !hasNoFiles && hasNoHtml && (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-sm">
              <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4 text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text)] mb-1 tracking-tight">
                No HTML file found
              </h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">
                Add an <code className="text-[var(--accent)] font-mono">index.html</code> file to your project to render a live browser preview.
              </p>
            </div>
          </div>
        )}

        {/* State D: Normal Render with Sandboxed IFrame */}
        {!unsupportedInfo && !hasNoFiles && !hasNoHtml && (
          <div className="flex-1 w-full h-full relative overflow-hidden flex items-start justify-center">
            {/* Virtual Device Frame with Scaling */}
            <div
              style={{
                width: `${frameWidth}px`,
                height: `${frameHeight}px`,
                transform: scale !== 1 ? `scale(${scale})` : undefined,
                transformOrigin: 'top center',
                marginLeft: `${marginX}px`,
                marginRight: `${marginX}px`,
              }}
              className={`bg-white transition-transform duration-100 relative ${
                deviceMode !== 'desktop'
                  ? 'border border-[var(--border)] shadow-2xl rounded-[var(--radius-md)] overflow-hidden my-2'
                  : 'w-full h-full'
              }`}
            >
              {/* Optional simulated notch for phone mode */}
              {deviceMode === 'mobile' && scale === 1 && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-1 bg-black/20 rounded-full z-10 pointer-events-none" />
              )}

              <iframe
                ref={iframeRef}
                title="DESYRA Sandboxed App Preview"
                srcDoc={htmlContent}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock"
                referrerPolicy="no-referrer"
                allow=""
                className="w-full h-full border-0 bg-white"
              />
            </div>
          </div>
        )}

        {/* 3. Collapsible Console Drawer */}
        {isConsoleOpen && (
          <div className="h-44 sm:h-52 bg-[var(--surface)] border-t border-[var(--border)] flex flex-col shrink-0 z-30 shadow-2xl">
            {/* Console Header */}
            <div className="h-8 px-3 bg-[var(--elevated)] border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span className="text-xs font-semibold text-[var(--text)]">Console</span>
                <span className="text-[10px] text-[var(--muted)] font-mono">
                  ({consoleLogs.length} logs)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Tooltip content="Copy console output" position="top">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label="Copy console"
                    onClick={handleCopyConsole}
                    className="text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    {copiedConsole ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </IconButton>
                </Tooltip>

                <Tooltip content="Clear console logs" position="top">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label="Clear console"
                    onClick={() => setConsoleLogs([])}
                    className="text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    <Trash2 className="w-3 h-3" />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* Console Log List */}
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-1 select-text bg-[#0d0e11]">
              {consoleLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[var(--disabled)] text-xs">
                  Console output and runtime errors will appear here.
                </div>
              ) : (
                consoleLogs.map((log) => {
                  let badgeColor = 'text-[var(--muted)]';
                  let bgColor = 'hover:bg-white/5';
                  if (log.level === 'error') {
                    badgeColor = 'text-red-400 bg-red-500/10 border-red-500/30';
                    bgColor = 'bg-red-500/5 hover:bg-red-500/10 text-red-200';
                  } else if (log.level === 'warn') {
                    badgeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/30';
                    bgColor = 'bg-amber-500/5 hover:bg-amber-500/10 text-amber-200';
                  } else if (log.level === 'info') {
                    badgeColor = 'text-blue-400 bg-blue-500/10 border-blue-500/30';
                  }

                  const timeStr = new Date(log.timestamp).toLocaleTimeString();

                  return (
                    <div
                      key={log.id}
                      className={`flex items-start gap-2 p-1 rounded-[var(--radius-sm)] ${bgColor} leading-relaxed`}
                    >
                      <span className="text-[10px] text-[var(--disabled)] shrink-0 select-none">
                        {timeStr}
                      </span>
                      <span
                        className={`text-[9px] uppercase px-1 py-0.5 rounded border border-transparent font-semibold shrink-0 select-none ${badgeColor}`}
                      >
                        {log.level}
                      </span>
                      <div className="flex-1 break-all whitespace-pre-wrap text-[var(--text)]">
                        {log.args.join(' ')}
                      </div>
                      {log.source?.file && (
                        <span className="text-[10px] text-[var(--muted)] shrink-0 select-none max-w-[120px] truncate">
                          {log.source.file.split('/').pop()}:{log.source.line || 0}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={consoleBottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal: Clear Preview Storage */}
      <Modal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        title="Clear Preview Storage?"
        description="This will clear all in-memory and simulated localStorage keys stored for this project preview."
      >
        <div className="space-y-4">
          <div className="bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-md)] p-3 text-xs text-[var(--muted)]">
            Current storage used:{' '}
            <span className="font-mono text-[var(--text)] font-semibold">
              {Math.round(storageBytes / 1024)} KB
            </span>{' '}
            of {Math.round(MAX_PREVIEW_STORAGE_TOTAL_BYTES / 1024)} KB limit.
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsClearModalOpen(false)}
              disabled={isClearing}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConfirmClearStorage}
              disabled={isClearing}
              className="bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 active:bg-red-500/30"
            >
              {isClearing ? 'Clearing...' : 'Clear Storage'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
