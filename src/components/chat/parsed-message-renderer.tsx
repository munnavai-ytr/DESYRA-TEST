'use client';

import React, { useMemo } from 'react';
import { parseMessageSections, type ParsedMessageSection } from '@/lib/ai/fileProtocol';
import { MarkdownRenderer } from './markdown-renderer';
import { FileOperationCard, type FileOpStatus } from './file-operation-card';
import type { FileUndoEntry } from '@/lib/db';

export interface ParsedMessageRendererProps {
  content: string;
  isStreaming?: boolean;
  activeStreamingPath?: string | null;
  activeStreamingLineCount?: number;
  undoEntries?: FileUndoEntry[];
  incompleteFiles?: string[];
  failedEdits?: Array<{ path: string; reason: string }>;
  onOpenFile?: (path: string) => void;
  onRetryEdit?: (path: string) => void;
}

export function ParsedMessageRenderer({
  content,
  isStreaming = false,
  activeStreamingPath,
  activeStreamingLineCount,
  undoEntries = [],
  incompleteFiles = [],
  failedEdits = [],
  onOpenFile,
  onRetryEdit,
}: ParsedMessageRendererProps) {
  const sections = useMemo(() => {
    return parseMessageSections(content);
  }, [content]);

  // If there are no file protocol operations, render standard markdown directly
  const hasOperations = sections.some((s) => s.type === 'operation');
  if (!hasOperations) {
    return <MarkdownRenderer content={content} isStreaming={isStreaming} />;
  }

  return (
    <div className="w-full flex flex-col space-y-1">
      {sections.map((section, idx) => {
        if (section.type === 'prose') {
          if (!section.text.trim()) return null;
          return (
            <div key={`prose-${idx}`} className="w-full">
              <MarkdownRenderer content={section.text} isStreaming={isStreaming} />
            </div>
          );
        }

        const op = section.operation;
        const failedEdit = failedEdits.find((f) => f.path === op.path);
        const undoEntry = undoEntries.find((u) => u.path === op.path);
        const isIncomplete =
          op.isUnterminated || incompleteFiles.includes(op.path);

        let status: FileOpStatus = 'created';
        if (failedEdit) {
          status = 'failed';
        } else if (isIncomplete) {
          status = 'incomplete';
        } else if (op.op === 'delete') {
          status = 'deleted';
        } else if (undoEntry) {
          status = undoEntry.action === 'created' ? 'created' : 'updated';
        } else if (isStreaming && activeStreamingPath === op.path) {
          status = 'writing';
        } else if (op.op === 'edit') {
          status = 'updated';
        } else {
          status = 'created';
        }

        let lineCount: number | undefined;
        if (isStreaming && activeStreamingPath === op.path && activeStreamingLineCount !== undefined) {
          lineCount = activeStreamingLineCount;
        } else if (op.content) {
          lineCount = op.content.split('\n').length;
        }

        return (
          <FileOperationCard
            key={`op-${op.path}-${idx}`}
            op={op.op}
            path={op.path}
            status={status}
            lineCount={lineCount}
            errorReason={failedEdit?.reason}
            onOpenFile={onOpenFile}
            onRetry={onRetryEdit}
          />
        );
      })}
    </div>
  );
}
