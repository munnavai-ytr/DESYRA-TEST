'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FileCode, Check, AlertCircle, Loader2, AlertTriangle, FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { updateFileContent, WARN_FILE_SIZE_BYTES } from '@/lib/files';
import type { ProjectFile } from '@/lib/db';

export interface CodeEditorProps {
  projectId: string;
  file: ProjectFile | null;
  onFileUpdated?: (updatedFile: ProjectFile) => void;
}

type SaveStatus = 'saved' | 'saving' | 'error';

export function CodeEditor({ projectId, file, onFileUpdated }: CodeEditorProps) {
  const [content, setContent] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedContent, setLastSavedContent] = useState<string>('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingContentRef = useRef<string>('');
  const currentFileRef = useRef<ProjectFile | null>(null);

  const [prevFileId, setPrevFileId] = useState<string | null>(file?.id ?? null);
  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id ?? null);
    setContent(file ? file.content : '');
    setLastSavedContent(file ? file.content : '');
    setSaveStatus('saved');
  }

  useEffect(() => {
    pendingContentRef.current = file ? file.content : '';
    currentFileRef.current = file;
  }, [file]);

  // Save worker function
  const saveContent = useCallback(
    async (textToSave: string, targetFile: ProjectFile) => {
      try {
        setSaveStatus('saving');
        await updateFileContent(projectId, targetFile.path, textToSave);
        setLastSavedContent(textToSave);
        setSaveStatus('saved');
        onFileUpdated?.({
          ...targetFile,
          content: textToSave,
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.error('Failed to autosave file:', err);
        setSaveStatus('error');
      }
    },
    [projectId, onFileUpdated]
  );

  // Autosave debounce on content change (600ms)
  const handleContentChange = (newVal: string) => {
    setContent(newVal);
    pendingContentRef.current = newVal;

    if (!file) return;

    if (newVal === lastSavedContent) {
      setSaveStatus('saved');
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      return;
    }

    setSaveStatus('saving');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveContent(newVal, file);
    }, 600);
  };

  // Immediate save on blur
  const handleBlur = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (file && pendingContentRef.current !== lastSavedContent) {
      saveContent(pendingContentRef.current, file);
    }
  };

  // Flush on unmount or beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentFileRef.current && pendingContentRef.current !== lastSavedContent) {
        updateFileContent(
          projectId,
          currentFileRef.current.path,
          pendingContentRef.current
        ).catch(console.error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (currentFileRef.current && pendingContentRef.current !== lastSavedContent) {
        updateFileContent(
          projectId,
          currentFileRef.current.path,
          pendingContentRef.current
        ).catch(console.error);
      }
    };
  }, [projectId, lastSavedContent]);

  // Handle Tab key to insert 2 spaces
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const updated = content.substring(0, start) + '  ' + content.substring(end);

      handleContentChange(updated);

      // Restore cursor position after inserted spaces
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  // Synchronize scroll between textarea and line-number gutter
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Compute line count
  const lineCount = useMemo(() => {
    const lines = content.split('\n').length;
    return Math.max(lines, 1);
  }, [content]);

  // Compute file size in KB
  const fileSizeKB = useMemo(() => {
    return Math.round(new Blob([content]).size / 1024);
  }, [content]);

  const isLargeFile = useMemo(() => {
    return new Blob([content]).size > WARN_FILE_SIZE_BYTES;
  }, [content]);

  if (!file) {
    return (
      <div className="flex-1 h-full flex items-center justify-center p-6 bg-[var(--bg)] text-center">
        <EmptyState
          icon={<FileCode className="w-8 h-8 text-[var(--disabled)]" />}
          title="No file selected"
          description="Select a file from the explorer on the left to view and edit its contents."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] overflow-hidden">
      {/* Editor Header */}
      <div className="h-9 px-3 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
          <span className="font-mono text-xs text-[var(--text)] font-medium truncate">
            {file.path}
          </span>
          <span className="text-[10px] text-[var(--disabled)] tabular-nums font-mono">
            ({fileSizeKB} KB)
          </span>
        </div>

        {/* Save Status Indicator */}
        <div className="flex items-center gap-1.5 text-xs">
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-[var(--muted)] text-[11px]">
              <Check className="w-3 h-3 text-[var(--success)]" />
              <span>Saved</span>
            </span>
          )}
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-[var(--warning)] text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Saving...</span>
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-[var(--error)] text-[11px]">
              <AlertCircle className="w-3 h-3" />
              <span>Error saving</span>
            </span>
          )}
        </div>
      </div>

      {/* Large File Warning */}
      {isLargeFile && (
        <div className="px-3 py-1.5 bg-[rgba(245,183,59,0.1)] border-b border-[rgba(245,183,59,0.25)] text-xs text-[var(--warning)] flex items-center gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Large file ({fileSizeKB} KB): text rendering and editing may experience latency.</span>
        </div>
      )}

      {/* Editor Body: Gutter + Textarea */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Line Numbers Gutter */}
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="w-12 py-3 bg-[var(--surface)] border-r border-[var(--border)] text-right pr-2.5 font-mono text-xs text-[var(--disabled)] select-none overflow-hidden shrink-0 leading-5"
        >
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i + 1}>{i + 1}</div>
          ))}
        </div>

        {/* Code Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onBlur={handleBlur}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          className="flex-1 h-full py-3 px-3 bg-transparent text-[var(--text)] font-mono text-xs sm:text-sm leading-5 resize-none outline-none border-none whitespace-pre overflow-x-auto overflow-y-auto selection:bg-[var(--accent-soft)]"
          aria-label={`Editing ${file.path}`}
        />
      </div>
    </div>
  );
}
