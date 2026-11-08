'use client';

import React from 'react';
import {
  FileCode,
  FileJson,
  FileText,
  File,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Check,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type FileOpStatus = 'writing' | 'created' | 'updated' | 'deleted' | 'failed' | 'incomplete';

export interface FileOperationCardProps {
  op: 'file' | 'edit' | 'delete';
  path: string;
  status: FileOpStatus;
  lineCount?: number;
  errorReason?: string;
  onOpenFile?: (path: string) => void;
  onRetry?: (path: string) => void;
}

function getFileIcon(path: string, op: 'file' | 'edit' | 'delete') {
  if (op === 'delete') {
    return <Trash2 className="w-3.5 h-3.5 text-[var(--error)] shrink-0" />;
  }
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
    case 'css':
    case 'scss':
      return <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <FileCode className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
    case 'json':
      return <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'md':
    case 'txt':
      return <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    case 'svg':
    case 'png':
    case 'jpg':
    case 'webp':
      return <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />;
  }
}

export function FileOperationCard({
  op,
  path,
  status,
  lineCount,
  errorReason,
  onOpenFile,
  onRetry,
}: FileOperationCardProps) {
  const isFailed = status === 'failed';
  const isClickable = op !== 'delete' && status !== 'writing' && Boolean(onOpenFile);

  return (
    <div className="w-full my-2.5">
      <div
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={() => {
          if (isClickable && onOpenFile) {
            onOpenFile(path);
          }
        }}
        onKeyDown={(e) => {
          if (isClickable && onOpenFile && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onOpenFile(path);
          }
        }}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 rounded-[var(--radius-md)] border text-xs select-none transition-all ${
          isFailed
            ? 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)]'
            : status === 'writing'
            ? 'bg-[var(--surface)] border-[rgba(255,107,26,0.3)] shadow-xs'
            : isClickable
            ? 'bg-[var(--surface)] hover:bg-[var(--elevated)] border-[var(--border)] hover:border-[#383842] cursor-pointer shadow-xs active:scale-[0.99]'
            : 'bg-[var(--surface)] border-[var(--border)] shadow-xs'
        }`}
      >
        {/* Left: Icon + Path */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {getFileIcon(path, op)}
          <span className="font-mono text-xs text-[var(--text)] font-medium truncate">
            {path}
          </span>
        </div>

        {/* Right: Status badge & Line count */}
        <div className="flex items-center gap-2 shrink-0">
          {lineCount !== undefined && lineCount > 0 && status !== 'deleted' && (
            <span className="text-[11px] text-[var(--disabled)] font-mono tabular-nums hidden sm:inline">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          )}

          {status === 'writing' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(255,107,26,0.12)] text-[var(--accent)] text-[11px] font-medium animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span>Writing...</span>
            </span>
          )}

          {status === 'created' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(34,197,94,0.12)] text-[var(--success)] text-[11px] font-medium">
              <Check className="w-3 h-3 shrink-0" />
              <span>Created</span>
            </span>
          )}

          {status === 'updated' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(96,165,250,0.12)] text-sky-400 text-[11px] font-medium">
              <Check className="w-3 h-3 shrink-0" />
              <span>Updated</span>
            </span>
          )}

          {status === 'deleted' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(239,68,68,0.12)] text-[var(--error)] text-[11px] font-medium">
              <span>Deleted</span>
            </span>
          )}

          {status === 'incomplete' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(245,183,59,0.12)] text-[var(--warning)] text-[11px] font-medium">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>Incomplete</span>
            </span>
          )}

          {status === 'failed' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(239,68,68,0.15)] text-[var(--error)] text-[11px] font-medium">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>Failed</span>
            </span>
          )}
        </div>
      </div>

      {/* If Failed Edit, show clear warning card with Retry button */}
      {isFailed && (
        <div className="mt-1.5 p-3 rounded-[var(--radius-md)] bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-start gap-2 text-[var(--error)]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Could not apply edit to {path}</p>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">
                {errorReason || "The original text wasn't found in current file content."}
              </p>
            </div>
          </div>
          {onRetry && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(path)}
              leftIcon={<RotateCcw className="w-3 h-3" />}
              className="shrink-0 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >
              Ask DESYRA to retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
