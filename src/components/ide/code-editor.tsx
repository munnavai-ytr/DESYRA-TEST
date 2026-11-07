'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  FileCode,
  Check,
  AlertCircle,
  Loader2,
  AlertTriangle,
  FileText,
  Sparkles,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { updateFileContent, WARN_FILE_SIZE_BYTES } from '@/lib/files';
import type { ProjectFile } from '@/lib/db';
import { useIsWritingFile, useWritingContent } from '@/lib/ai/aiFileStore';

const CodeMirrorWrapper = dynamic(
  () => import('./codemirror-wrapper').then((mod) => mod.CodeMirrorWrapper),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 h-full flex items-center justify-center text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)] mr-2" />
        <span>Loading editor...</span>
      </div>
    ),
  }
);

export interface CodeEditorProps {
  projectId: string;
  file: ProjectFile | null;
  onFileUpdated?: (updatedFile: ProjectFile) => void;
}

type SaveStatus = 'saved' | 'saving' | 'error';

interface ActiveCodeEditorProps {
  projectId: string;
  file: ProjectFile;
  onFileUpdated?: (updatedFile: ProjectFile) => void;
}

function ActiveCodeEditor({ projectId, file, onFileUpdated }: ActiveCodeEditorProps) {
  const [content, setContent] = useState<string>(file.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedContent, setLastSavedContent] = useState<string>(file.content);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingContentRef = useRef<string>(file.content);
  const currentFileRef = useRef<ProjectFile>(file);

  // Subscribe to AI live writing state for this file
  const isAiWriting = useIsWritingFile(projectId, file.path);
  const liveAiContent = useWritingContent(projectId, file.path);

  useEffect(() => {
    currentFileRef.current = file;
  }, [file]);

  // When external file.content updates (e.g. from AI or undo), keep state in sync
  const [prevFileContent, setPrevFileContent] = useState(file.content);
  if (file.content !== prevFileContent) {
    setPrevFileContent(file.content);
    setContent(file.content);
    setLastSavedContent(file.content);
  }

  // Active value to display in editor (live stream content if AI is writing this file)
  const activeValue = isAiWriting && liveAiContent !== null ? liveAiContent : content;

  // Save worker function
  const saveContent = useCallback(
    async (textToSave: string, targetFile: ProjectFile) => {
      if (isAiWriting) return; // Never overwrite while AI is actively streaming to this file
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
    [projectId, isAiWriting, onFileUpdated]
  );

  // Autosave debounce on content change (600ms)
  const handleContentChange = (newVal: string) => {
    if (isAiWriting) return;
    setContent(newVal);
    pendingContentRef.current = newVal;

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
      saveContent(newVal, currentFileRef.current);
    }, 600);
  };

  // Immediate save on blur
  const handleBlur = () => {
    if (isAiWriting) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (pendingContentRef.current !== lastSavedContent) {
      saveContent(pendingContentRef.current, currentFileRef.current);
    }
  };

  // Flush on unmount or beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isAiWriting && pendingContentRef.current !== lastSavedContent) {
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
      if (!isAiWriting && pendingContentRef.current !== lastSavedContent) {
        updateFileContent(
          projectId,
          currentFileRef.current.path,
          pendingContentRef.current
        ).catch(console.error);
      }
    };
  }, [projectId, isAiWriting, lastSavedContent]);

  // Compute file size in KB
  const fileSizeKB = useMemo(() => {
    return Math.round(new Blob([content]).size / 1024);
  }, [content]);

  const isLargeFile = useMemo(() => {
    return new Blob([content]).size > WARN_FILE_SIZE_BYTES;
  }, [content]);

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
          {isAiWriting ? (
            <span className="flex items-center gap-1 text-[var(--accent)] text-[11px] font-medium animate-pulse">
              <Sparkles className="w-3 h-3 text-[var(--accent)]" />
              <span>AI Writing...</span>
            </span>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* AI Writing Live Banner */}
      {isAiWriting && (
        <div className="px-3 py-1.5 bg-[rgba(255,107,26,0.12)] border-b border-[rgba(255,107,26,0.25)] text-xs text-[var(--accent)] flex items-center gap-2 shrink-0 select-none animate-in fade-in duration-150">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="font-medium">DESYRA is writing this file...</span>
          <span className="text-[11px] opacity-75 hidden sm:inline">(Read-only during generation)</span>
        </div>
      )}

      {/* Large File Warning */}
      {isLargeFile && !isAiWriting && (
        <div className="px-3 py-1.5 bg-[rgba(245,183,59,0.1)] border-b border-[rgba(245,183,59,0.25)] text-xs text-[var(--warning)] flex items-center gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Large file ({fileSizeKB} KB): text rendering and editing may experience latency.</span>
        </div>
      )}

      {/* CodeMirror Editor Area */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative">
        <CodeMirrorWrapper
          value={activeValue}
          onChange={handleContentChange}
          onBlur={handleBlur}
          readOnly={isAiWriting}
          filePath={file.path}
        />
      </div>
    </div>
  );
}

export function CodeEditor({ projectId, file, onFileUpdated }: CodeEditorProps) {
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
    <ActiveCodeEditor
      key={file.id}
      projectId={projectId}
      file={file}
      onFileUpdated={onFileUpdated}
    />
  );
}
