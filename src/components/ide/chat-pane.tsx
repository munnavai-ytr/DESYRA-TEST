'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import Link from 'next/link';
import {
  Send,
  Square,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  ArrowDown,
  Lock,
  Play,
  Lightbulb,
  RotateCcw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { UnlockModal } from '@/components/settings/unlock-modal';
import {
  isSessionLocked,
  type SafeProviderInfo,
} from '@/lib/keys';
import {
  listProjectMessages,
  saveProjectMessage,
  updateProject,
  getProject,
  getAutoContinueEnabled,
  getDesignQualitySetting,
  getReviewDesignBeforeBuild,
  setReviewDesignBeforeBuild,
  getRunCriticAutomatically,
  type StoredMessage,
  type Project,
  type CompletenessIssue,
} from '@/lib/db';
import {
  markStreamingActive,
  isStreamingActive,
  scheduleIdleWork,
} from '@/lib/history/idle';
import {
  createSnapshot,
  createSnapshotWithResult,
  maybeNotifyFirstTrim,
} from '@/lib/history/snapshots';
import type { DesignSpec, ProjectPlan } from '@/lib/design/types';
import { PlanCard, buildSpecFromSelections } from '@/components/chat/plan-card';
import { generateBrief } from '@/lib/design/brief';
import { runDesignCritic } from '@/lib/design/critic';
import { listFiles } from '@/lib/files';
import {
  streamChat,
  resolveMaxOutputTokens,
  type ProviderError,
  type StreamFinishReason,
} from '@/lib/ai';
import { checkCompleteness, buildContinueMessage } from '@/lib/ai/completeness';
import { buildAiChatContext } from '@/lib/ai/context';
import { createStreamingProtocolParser, countNewlines } from '@/lib/ai/fileProtocol';
import {
  createChangeApplierSession,
  executeUndoForMessage,
} from '@/lib/ai/applyChanges';
import { aiFileStore } from '@/lib/ai/aiFileStore';
import { formatRelativeTime } from '@/lib/utils';
import { ParsedMessageRenderer } from '@/components/chat/parsed-message-renderer';
import { FileOperationCard, type FileOpStatus } from '@/components/chat/file-operation-card';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import {
  installDesignSystem,
  createSpecFromClassification,
  ensureProjectDesign,
  extractDesignSpec,
  MANAGED_DESIGN_FILES,
} from '@/lib/design/install';

export interface ChatPaneProps {
  project: Project;
  activeProvider: SafeProviderInfo | null;
  activeModel: string | null;
  openFilePath?: string | null;
  onOpenFile?: (path: string) => void;
  onRefreshProviders?: () => void;
  onRegisterSendHandler?: (handler: (prompt: string) => Promise<void>) => void;
  projectDesign?: DesignSpec | null;
  onDesignUpdated?: (spec: DesignSpec) => void;
  onOpenHistory?: (snapshotId?: string) => void;
}

interface MessageItemProps {
  message: StoredMessage;
  onOpenFile?: (path: string) => void;
  onRetryEdit?: (path: string) => void;
  onUndo?: (message: StoredMessage) => void;
  onContinueBuild?: (message: StoredMessage) => void;
  onApprovePlan?: (updatedPlan: ProjectPlan, spec: DesignSpec) => void;
  onRegeneratePlan?: (message: StoredMessage) => void;
  onSkipPlanReview?: (planData: ProjectPlan) => void;
  onAlwaysSkipPlanReview?: (planData: ProjectPlan) => void;
  onOpenHistory?: (snapshotId?: string) => void;
  isPlanRegenerating?: boolean;
}

// Fix 1: Memoize MessageItem so stored messages never re-render during streaming
const MessageItem = React.memo(
  function MessageItem({
    message,
    onOpenFile,
    onRetryEdit,
    onUndo,
    onContinueBuild,
    onApprovePlan,
    onRegeneratePlan,
    onSkipPlanReview,
    onAlwaysSkipPlanReview,
    onOpenHistory,
    isPlanRegenerating,
  }: MessageItemProps) {
    const [isDismissed, setIsDismissed] = useState(false);

    // If message is an interactive Plan Card, render dedicated PlanCard component
    if (message.kind === 'plan_card') {
      let planData: ProjectPlan | null = null;
      try {
        planData = JSON.parse(message.content);
      } catch {
        // invalid JSON
      }
      if (!planData) return null;

      return (
        <PlanCard
          plan={planData}
          onApprove={(updatedPlan, spec) => onApprovePlan?.(updatedPlan, spec)}
          onRegenerate={() => onRegeneratePlan?.(message)}
          onSkipReview={() => onSkipPlanReview?.(planData!)}
          onAlwaysSkipReview={() => onAlwaysSkipPlanReview?.(planData!)}
          isRegenerating={isPlanRegenerating}
        />
      );
    }

    const isUser = message.role === 'user';

    if (isUser) {
      return (
        <div className="flex justify-end w-full group">
          <div className="max-w-[85%] flex flex-col items-end">
            <div className="bg-[var(--elevated)] border border-[#303038] text-[var(--text)] rounded-[16px] rounded-br-[4px] px-3.5 py-2.5 text-[15px] sm:text-[14.5px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere] select-text shadow-xs">
              {message.content}
            </div>
            <span className="text-[10px] text-[var(--disabled)] mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity text-right select-none">
              {formatRelativeTime(message.createdAt)}
            </span>
          </div>
        </div>
      );
    }

    const hasUndo = Boolean(message.undoEntries && message.undoEntries.length > 0);
    const undoDisabled = message.undoDisabledReason;

    return (
      <div className="w-full flex flex-col text-left group">
        {/* Header bar with brand, model, and per-message undo */}
        <div className="flex items-center justify-between mb-1 select-none">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--muted)]">DESYRA</span>
            {message.model && (
              <span className="text-[10px] text-[var(--disabled)] font-mono">
                · {message.model}
              </span>
            )}
          </div>

          {/* Per-message Undo safety net */}
          {hasUndo && onUndo && (
            <button
              type="button"
              onClick={() => onUndo(message)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[#3a3a44] bg-[var(--surface)] hover:bg-[var(--elevated)] text-[10px] font-medium text-[var(--muted)] hover:text-[var(--text)] transition-all cursor-pointer shadow-xs active:scale-95"
              title="Undo file changes made by this message"
            >
              <RotateCcw className="w-3 h-3 text-[var(--accent)]" />
              <span>Undo changes</span>
            </button>
          )}

          {undoDisabled && (
            <Tooltip content={undoDisabled} position="left">
              <span className="text-[10px] text-[var(--disabled)] italic cursor-help">
                Undo unavailable
              </span>
            </Tooltip>
          )}
        </div>

        {/* Render Markdown prose + compact File Cards */}
        <div className="w-full text-[15px] sm:text-[14.5px] leading-[1.6] text-[var(--text)] [overflow-wrap:anywhere]">
          <ParsedMessageRenderer
            content={message.content}
            undoEntries={message.undoEntries}
            incompleteFiles={message.incompleteFiles}
            failedEdits={message.failedEdits}
            onOpenFile={onOpenFile}
            onRetryEdit={onRetryEdit}
          />
        </div>

        {/* Incomplete Build / Needs Attention Warning Card */}
        {!isDismissed && message.completenessIssues && message.completenessIssues.length > 0 && (
          <div className="mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[rgba(245,158,11,0.3)] shadow-xs">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--warning)] mb-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Needs attention</span>
            </div>
            <ul className="space-y-1 text-xs text-[var(--muted)] mb-3 pl-1">
              {message.completenessIssues.slice(0, 6).map((issue, idx) => {
                if (issue.type === 'truncated') {
                  return (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-[var(--warning)] leading-none mt-1">•</span>
                      <span>Answer was cut off by output limit</span>
                    </li>
                  );
                }
                if (issue.type === 'incomplete_file') {
                  return (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-[var(--warning)] leading-none mt-1">•</span>
                      <span>
                        <code className="font-mono text-[var(--text)]">{issue.path}</code> (cut off during write)
                      </span>
                    </li>
                  );
                }
                if (issue.type === 'design_issue') {
                  return (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-[var(--warning)] leading-none mt-1">•</span>
                      <span>
                        {issue.path && <code className="font-mono text-[var(--text)] mr-1">{issue.path}</code>}
                        {issue.details || 'Design system issue detected'}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-[var(--warning)] leading-none mt-1">•</span>
                    <span>
                      <code className="font-mono text-[var(--text)]">{issue.path}</code> (referenced in {issue.sourceFile || 'code'} but not created
                      {issue.similarFileHint ? (
                        <> — did you mean <code className="font-mono text-[var(--text)]">{issue.similarFileHint}</code>?</>
                      ) : null}
                      )
                    </span>
                  </li>
                );
              })}
              {message.completenessIssues.length > 6 && (
                <li className="text-[11px] text-[var(--disabled)] pt-0.5">
                  + {message.completenessIssues.length - 6} more issue(s)
                </li>
              )}
            </ul>
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => onContinueBuild?.(message)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium text-xs transition-colors cursor-pointer active:scale-95 shadow-xs"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Continue build</span>
              </button>
              <button
                type="button"
                onClick={() => setIsDismissed(true)}
                className="px-2.5 py-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] font-medium text-xs transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Message Footer with Timestamp, Design Chip, Tokens, and Finish Reason Notes */}
        <div className="flex items-center flex-wrap gap-2 mt-1.5 px-0.5 text-[10px] text-[var(--disabled)] select-none">
          <span>{formatRelativeTime(message.createdAt)}</span>
          {message.promptKind === 'design' && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] font-mono">
              Design: {message.designSpecId ? message.designSpecId.replace('/', ' / ') : 'active'}
            </span>
          )}
          {message.completionTokens !== undefined && (
            <span>· {message.completionTokens.toLocaleString()} tokens</span>
          )}
          {message.snapshotId && onOpenHistory && (
            <button
              type="button"
              onClick={() => onOpenHistory(message.snapshotId)}
              className="text-[var(--accent)] hover:underline cursor-pointer font-medium"
            >
              · View in history
            </button>
          )}
          {message.finishReason === 'length' && (
            <span className="text-[var(--warning)] font-medium">
              · Output limit reached{message.completionTokens ? ` (about ${message.completionTokens.toLocaleString()} tokens)` : ''}. The answer was cut off.
            </span>
          )}
          {message.finishReason === 'safety' && (
            <span className="text-[var(--muted)]">
              · Content filtered by provider safety system.
            </span>
          )}
          {message.finishReason === 'interrupted' && (
            <span className="text-[var(--warning)]">
              · The connection ended early.
            </span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.undoEntries === next.message.undoEntries &&
    prev.message.completenessIssues === next.message.completenessIssues &&
    prev.message.finishReason === next.message.finishReason &&
    prev.message.promptKind === next.message.promptKind &&
    prev.message.designSpecId === next.message.designSpecId &&
    prev.message.snapshotId === next.message.snapshotId &&
    prev.onOpenHistory === next.onOpenHistory
);

export interface StreamingFileOperation {
  path: string;
  op: 'file' | 'edit' | 'delete';
  status: FileOpStatus;
  lineCount?: number;
  errorReason?: string;
}

interface StreamingUiState {
  prose: string;
  operations: StreamingFileOperation[];
}

/**
 * Fix 1: Memoized prose block component.
 * Completed blocks are frozen; only the last active growing block re-renders.
 */
interface ProseBlockProps {
  blockText: string;
  isComplete: boolean;
}

const MemoizedProseBlock = React.memo(
  function MemoizedProseBlock({ blockText }: ProseBlockProps) {
    return <MarkdownRenderer content={blockText} isStreaming={true} />;
  },
  (prev, next) => prev.blockText === next.blockText && prev.isComplete === next.isComplete
);

function splitProseIntoBlocks(prose: string): { completedBlocks: string[]; growingBlock: string } {
  if (!prose) return { completedBlocks: [], growingBlock: '' };

  // Check if an unclosed code block fence exists
  const fenceMatches = prose.match(/```/g);
  const hasUnclosedFence = fenceMatches && fenceMatches.length % 2 === 1;

  if (hasUnclosedFence) {
    // Find the last opening fence: everything inside and after it is part of the growing block
    const lastFenceIdx = prose.lastIndexOf('```');
    const beforeFence = prose.slice(0, lastFenceIdx);
    const codeBlockAndAfter = prose.slice(lastFenceIdx);

    const rawBlocks = beforeFence.split(/\n\s*\n+/);
    const completedBlocks = rawBlocks.filter((b) => b.trim().length > 0);
    return {
      completedBlocks,
      growingBlock: codeBlockAndAfter,
    };
  }

  const rawBlocks = prose.split(/\n\s*\n+/);
  if (rawBlocks.length <= 1) {
    return { completedBlocks: [], growingBlock: rawBlocks[0] || '' };
  }

  const completedBlocks = rawBlocks.slice(0, -1).filter((b) => b.trim().length > 0);
  const growingBlock = rawBlocks[rawBlocks.length - 1];

  return { completedBlocks, growingBlock };
}

function StreamingProseRenderer({ prose }: { prose: string }) {
  const { completedBlocks, growingBlock } = useMemo(() => splitProseIntoBlocks(prose), [prose]);

  return (
    <div className="w-full space-y-2">
      {completedBlocks.map((block, i) => (
        <MemoizedProseBlock key={`completed-${i}`} blockText={block} isComplete={true} />
      ))}
      {growingBlock ? (
        <MemoizedProseBlock key="active-growing" blockText={growingBlock} isComplete={false} />
      ) : null}
    </div>
  );
}

/**
 * Fix 1: Chunk coalescer for incoming provider chunks.
 * If chunks arrive faster than 50ms apart, coalesce them before feeding the parser.
 */
function createChunkCoalescer(onChunk: (text: string) => void, minDelayMs = 50) {
  let buffer = '';
  let lastTime = 0;
  let timer: NodeJS.Timeout | null = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer) {
      const toEmit = buffer;
      buffer = '';
      lastTime = performance.now();
      onChunk(toEmit);
    }
  }

  return {
    push(text: string) {
      buffer += text;
      const now = performance.now();
      const elapsed = now - lastTime;
      if (elapsed >= minDelayMs) {
        flush();
      } else if (!timer) {
        timer = setTimeout(flush, minDelayMs - elapsed);
      }
    },
    flush,
  };
}

export function ChatPane({
  project,
  activeProvider,
  activeModel,
  openFilePath,
  onOpenFile,
  onRefreshProviders,
  onRegisterSendHandler,
  projectDesign,
  onDesignUpdated,
  onOpenHistory,
}: ChatPaneProps) {
  const { toast } = useToast();

  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingUi, setStreamingUi] = useState<StreamingUiState>({ prose: '', operations: [] });
  const [isLocked, setIsLocked] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [lastError, setLastError] = useState<ProviderError | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [autoContinueStatus, setAutoContinueStatus] = useState<string | null>(null);
  const [isPlanRegenerating, setIsPlanRegenerating] = useState(false);

  const hasCheckedAutoStartRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isUserScrolledUpRef = useRef(false);

  // Streaming refs (kept out of React state during generation)
  const rawTextRef = useRef('');
  const streamingProseRef = useRef('');
  const operationsRef = useRef<StreamingFileOperation[]>([]);
  const currentFileLineCountRef = useRef<number>(0);

  // Throttled UI flush controls (at most once every 120ms with timer + rAF)
  const uiFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const uiFlushRafRef = useRef<number | null>(null);
  const lastUiFlushTimeRef = useRef<number>(0);

  // Deferred post-AI turn snapshot tracking (runs in browser idle time)
  const pendingSnapshotCancelRef = useRef<(() => void) | null>(null);
  const pendingSnapshotArgsRef = useRef<{ messageId: string; label: string } | null>(null);
  const isMountedRef = useRef(true);

  const commitPostTurnSnapshot = useCallback(
    async (messageId: string, label: string) => {
      if (isStreamingActive(project.id) || aiFileStore.isAnyFileWriting(project.id)) {
        return;
      }
      pendingSnapshotArgsRef.current = null;
      try {
        const outcome = await createSnapshotWithResult(project.id, {
          label,
          kind: 'ai',
          messageId,
        });
        if (outcome.snapshot && isMountedRef.current) {
          const snapId = outcome.snapshot.id;
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, snapshotId: snapId } : m))
          );
        }
        if (outcome.trimmedCount > 0) {
          const shouldNotify = await maybeNotifyFirstTrim(outcome.trimmedCount);
          if (shouldNotify) {
            toast({
              type: 'info',
              title: 'Version History Limit Reached',
              message:
                'DESYRA keeps the latest 60 unpinned versions automatically. Pinned checkpoints never expire.',
              duration: 6000,
            });
          }
        }
      } catch (err) {
        console.warn('[DESYRA] Post-turn snapshot failed:', err);
      }
    },
    [project.id, toast]
  );

  const schedulePostTurnSnapshot = useCallback(
    (messageId: string, promptLabel: string) => {
      if (pendingSnapshotCancelRef.current) {
        pendingSnapshotCancelRef.current();
        pendingSnapshotCancelRef.current = null;
      }
      const cleanLabel = promptLabel.replace(/\s+/g, ' ').trim();
      const label = cleanLabel ? `AI: ${cleanLabel.slice(0, 44)}` : 'AI build changes';
      pendingSnapshotArgsRef.current = { messageId, label };
      pendingSnapshotCancelRef.current = scheduleIdleWork(async () => {
        pendingSnapshotCancelRef.current = null;
        await commitPostTurnSnapshot(messageId, label);
      });
    },
    [commitPostTurnSnapshot]
  );

  const flushPendingPostTurnSnapshot = useCallback(async () => {
    if (pendingSnapshotCancelRef.current) {
      pendingSnapshotCancelRef.current();
      pendingSnapshotCancelRef.current = null;
    }
    const pending = pendingSnapshotArgsRef.current;
    if (pending) {
      await commitPostTurnSnapshot(pending.messageId, pending.label);
    }
  }, [commitPostTurnSnapshot]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pendingSnapshotCancelRef.current) {
        pendingSnapshotCancelRef.current();
        pendingSnapshotCancelRef.current = null;
      }
      const pending = pendingSnapshotArgsRef.current;
      if (pending && !isStreamingActive(project.id) && !aiFileStore.isAnyFileWriting(project.id)) {
        pendingSnapshotArgsRef.current = null;
        void createSnapshotWithResult(project.id, {
          label: pending.label,
          kind: 'ai',
          messageId: pending.messageId,
        });
      }
    };
  }, [project.id]);

  // Load project messages from IndexedDB
  const loadMessages = useCallback(async () => {
    try {
      const msgs = await listProjectMessages(project.id);
      setMessages(msgs);
      return msgs;
    } catch (err) {
      console.error('Failed to load project messages:', err);
      return [];
    }
  }, [project.id]);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    Promise.all([listProjectMessages(project.id), isSessionLocked()]).then(
      ([msgs, locked]) => {
        if (!isMounted) return;
        setMessages(msgs);
        setIsLocked(locked);
      }
    );
    return () => {
      isMounted = false;
    };
  }, [project.id]);

  // Auto-scroll handler
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceToBottom > 60;
    isUserScrolledUpRef.current = scrolledUp;
    setIsScrolledUp(scrolledUp);
  };

  // Fix 2: Auto-scroll helper (single rAF, instant behavior 'auto', only near bottom)
  const triggerAutoScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || isUserScrolledUpRef.current) return;
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container && !isUserScrolledUpRef.current) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'auto',
        });
      }
    });
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Scroll on messages change (initial or finished message)
  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      scrollToBottom(false);
    }
  }, [messages, scrollToBottom]);

  // Schedule throttled UI flush (at most once every 120ms)
  const scheduleUiFlush = useCallback(() => {
    if (uiFlushTimerRef.current !== null || uiFlushRafRef.current !== null) return;

    const now = performance.now();
    const elapsed = now - lastUiFlushTimeRef.current;
    const delay = Math.max(0, 120 - elapsed);

    uiFlushTimerRef.current = setTimeout(() => {
      uiFlushTimerRef.current = null;
      uiFlushRafRef.current = requestAnimationFrame(() => {
        uiFlushRafRef.current = null;
        lastUiFlushTimeRef.current = performance.now();
        startTransition(() => {
          setStreamingUi({
            prose: streamingProseRef.current,
            operations: [...operationsRef.current],
          });
        });
        triggerAutoScroll();
      });
    }, delay);
  }, [triggerAutoScroll]);

  const flushUiNow = useCallback(() => {
    if (uiFlushTimerRef.current !== null) {
      clearTimeout(uiFlushTimerRef.current);
      uiFlushTimerRef.current = null;
    }
    if (uiFlushRafRef.current !== null) {
      cancelAnimationFrame(uiFlushRafRef.current);
      uiFlushRafRef.current = null;
    }
    setStreamingUi({
      prose: streamingProseRef.current,
      operations: [...operationsRef.current],
    });
    triggerAutoScroll();
  }, [triggerAutoScroll]);

  // Adjust textarea height
  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 640;
    const maxHeight = isMobileViewport ? 144 : 192;
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(newHeight, 44)}px`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    adjustTextareaHeight();
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // Undo execution handler
  const handleUndo = async (msg: StoredMessage) => {
    if (!msg.undoEntries || msg.undoEntries.length === 0) return;

    try {
      await createSnapshot(project.id, {
        label: 'Before undo',
        kind: 'restore',
      });
      const result = await executeUndoForMessage(project.id, msg.undoEntries);

      if (result.skippedFiles.length > 0) {
        const reasons = result.skippedFiles.map((s) => s.reason).join(' ');
        toast({
          type: 'warning',
          title: `Restored ${result.restoredCount} file(s)`,
          message: `Some files were skipped: ${reasons}`,
        });
      } else {
        toast({
          type: 'success',
          title: 'Changes Undone',
          message: `Restored previous file state (${result.restoredCount} file(s) restored).`,
        });
      }

      // Clear undo entries on message after successful undo
      const updatedMessage: StoredMessage = {
        ...msg,
        undoEntries: undefined,
      };
      await saveProjectMessage(updatedMessage);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? updatedMessage : m)));
    } catch (err) {
      console.error('Failed to execute undo:', err);
      toast({
        type: 'error',
        title: 'Undo Failed',
        message: 'Could not restore file state.',
      });
    }
  };

  /**
   * Computes a canonical signature for completeness issues to detect lack of progress.
   */
  const computeIssuesSignature = (issues: CompletenessIssue[]): string => {
    return issues
      .map((i) => `${i.type}:${i.path || ''}:${i.sourceFile || ''}`)
      .sort()
      .join('|');
  };

  /**
   * Executes a single chat turn (user prompt -> streaming assistant response -> completeness check).
   */
  const runTurn = async (
    userPrompt: string,
    historyMessages: StoredMessage[],
    signal: AbortSignal,
    designSpec?: DesignSpec | null,
    plan?: ProjectPlan | null
  ): Promise<{
    success: boolean;
    assistantMessage?: StoredMessage;
    issues: CompletenessIssue[];
    aborted: boolean;
  }> => {
    // Resolve design & plan explicitly: passed values, or fallback to database lookup
    const dbProj = await getProject(project.id);
    let resolvedDesign: DesignSpec | null = designSpec ? extractDesignSpec(designSpec) : null;
    if (!resolvedDesign) {
      resolvedDesign = extractDesignSpec(dbProj?.design);
    }
    const resolvedPlan: ProjectPlan | null = plan || dbProj?.plan || null;

    const promptKind: 'design' | 'basic' = resolvedDesign ? 'design' : 'basic';
    const designSpecId = resolvedDesign
      ? `${resolvedDesign.archetypeId}/${resolvedDesign.presetId}`
      : undefined;

    // 1. Format and save user message
    const userMessage: StoredMessage = {
      id: `msg_${Date.now()}_u`,
      projectId: project.id,
      role: 'user',
      content: userPrompt,
      createdAt: Date.now(),
      model: activeModel || undefined,
      provider: activeProvider?.label,
    };

    await saveProjectMessage(userMessage);
    const updatedMessages = [...historyMessages, userMessage];
    setMessages(updatedMessages);

    // 2. Fetch current project files for context
    const currentFiles = await listFiles(project.id);

    // Ensure any un-snapshotted user/previous changes are captured before AI streams over files
    if (currentFiles.length > 0) {
      try {
        const cleanPrompt = userPrompt.replace(/\s+/g, ' ').trim();
        await createSnapshot(project.id, {
          label: cleanPrompt ? `Before: ${cleanPrompt.slice(0, 42)}` : 'Before AI changes',
          kind: 'ai',
        });
      } catch (err) {
        console.warn('[DESYRA] Pre-AI snapshot warning:', err);
      }
    }

    // 3. Build context with System Prompt + Project Files + Compact History
    const apiMessages = buildAiChatContext({
      projectFiles: currentFiles,
      conversationHistory: updatedMessages,
      openFilePath,
      projectDesign: resolvedDesign,
      projectPlan: resolvedPlan,
    });

    // 4. Reset streaming state
    rawTextRef.current = '';
    streamingProseRef.current = '';
    operationsRef.current = [];
    currentFileLineCountRef.current = 0;
    setStreamingUi({ prose: '', operations: [] });
    isUserScrolledUpRef.current = false;
    setIsScrolledUp(false);

    const assistantMsgId = `msg_${Date.now()}_a`;
    const session = createChangeApplierSession(project.id);

    // Protocol parser callback
    const protocolParser = createStreamingProtocolParser(async (event) => {
      switch (event.type) {
        case 'text':
          streamingProseRef.current += event.text;
          scheduleUiFlush();
          break;

        case 'fileStart': {
          currentFileLineCountRef.current = 1;
          const existingOpIdx = operationsRef.current.findIndex(
            (o) => o.path === event.path && o.op === 'file'
          );
          if (existingOpIdx >= 0) {
            operationsRef.current[existingOpIdx] = {
              path: event.path,
              op: 'file',
              status: 'writing',
              lineCount: 1,
            };
          } else {
            operationsRef.current.push({
              path: event.path,
              op: 'file',
              status: 'writing',
              lineCount: 1,
            });
          }
          scheduleUiFlush();
          await session.onFileStart(event.path);
          break;
        }

        case 'fileChunk': {
          session.onFileChunk(event.path, event.text);
          currentFileLineCountRef.current += countNewlines(event.text);
          const op = operationsRef.current.find((o) => o.path === event.path && o.op === 'file');
          if (op) {
            op.lineCount = currentFileLineCountRef.current;
          }
          scheduleUiFlush();
          break;
        }

        case 'fileEnd': {
          const op = operationsRef.current.find((o) => o.path === event.path && o.op === 'file');
          if (op) {
            op.status = 'created';
          }
          scheduleUiFlush();
          await session.onFileEnd(event.path);
          break;
        }

        case 'editStart': {
          const existingOpIdx = operationsRef.current.findIndex(
            (o) => o.path === event.path && o.op === 'edit'
          );
          if (existingOpIdx >= 0) {
            operationsRef.current[existingOpIdx] = {
              path: event.path,
              op: 'edit',
              status: 'writing',
            };
          } else {
            operationsRef.current.push({
              path: event.path,
              op: 'edit',
              status: 'writing',
            });
          }
          scheduleUiFlush();
          break;
        }

        case 'editEnd': {
          const op = operationsRef.current.find((o) => o.path === event.path && o.op === 'edit');
          if (op) {
            op.status = 'updated';
          }
          scheduleUiFlush();
          const result = await session.onEdit(event.path, event.blocks);
          if (!result.success && op) {
            op.status = 'failed';
            op.errorReason = result.error;
            scheduleUiFlush();
          }
          break;
        }

        case 'delete': {
          operationsRef.current.push({
            path: event.path,
            op: 'delete',
            status: 'deleted',
          });
          scheduleUiFlush();
          await session.onDelete(event.path);
          break;
        }

        case 'unterminated': {
          const op = operationsRef.current.find(
            (o) => o.path === event.path && o.op === event.tagType
          );
          if (op) {
            op.status = 'incomplete';
          }
          scheduleUiFlush();
          session.onUnterminated(event.tagType, event.path);
          break;
        }
      }
    });

    const coalescer = createChunkCoalescer((chunkText) => {
      protocolParser.feed(chunkText);
    }, 50);

    let lastFinishReason: StreamFinishReason | undefined = undefined;
    let lastUsage: { completionTokens?: number; totalTokens?: number } | undefined = undefined;
    let resolvedMaxTokens: number | undefined = undefined;

    markStreamingActive(project.id, true);
    try {
      if (activeProvider && activeModel) {
        resolvedMaxTokens = await resolveMaxOutputTokens(activeProvider, activeModel);
      }

      const stream = streamChat({
        provider: activeProvider!,
        model: activeModel!,
        messages: apiMessages,
        signal,
        maxOutputTokens: resolvedMaxTokens,
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          rawTextRef.current += chunk.text;
          coalescer.push(chunk.text);
        }
        if (chunk.finishReason) {
          lastFinishReason = chunk.finishReason;
        }
        if (chunk.usage) {
          lastUsage = chunk.usage;
        }
      }

      coalescer.flush();
      protocolParser.end();
      const sessionResult = await session.finish();
      flushUiNow();

      if (rawTextRef.current) {
        const latestFiles = await listFiles(project.id);
        const issues = checkCompleteness({
          operations: operationsRef.current,
          incompleteFiles: sessionResult.incompleteFiles,
          finishReason: lastFinishReason,
          projectFiles: latestFiles,
          projectDesign: resolvedDesign,
        });

        const assistantMessage: StoredMessage = {
          id: assistantMsgId,
          projectId: project.id,
          role: 'assistant',
          content: rawTextRef.current,
          createdAt: Date.now(),
          model: activeModel || undefined,
          provider: activeProvider?.label,
          promptKind,
          designSpecId,
          undoEntries: sessionResult.undoEntries,
          undoDisabledReason: sessionResult.undoDisabledReason,
          incompleteFiles: sessionResult.incompleteFiles.length > 0 ? sessionResult.incompleteFiles : undefined,
          failedEdits: sessionResult.failedEdits.length > 0 ? sessionResult.failedEdits : undefined,
          finishReason: lastFinishReason,
          completionTokens: lastUsage?.completionTokens,
          maxOutputTokens: resolvedMaxTokens,
          completenessIssues: issues.length > 0 ? issues : undefined,
        };

        await saveProjectMessage(assistantMessage);
        setMessages((prev) => [...prev, assistantMessage]);

        // Clear active streaming marker before scheduling deferred post-AI snapshot
        markStreamingActive(project.id, false);
        schedulePostTurnSnapshot(assistantMsgId, userPrompt);

        // Auto-run AI design critic in the background if enabled and first successful build
        if (lastFinishReason === 'stop' && issues.length === 0 && resolvedDesign && activeProvider && activeModel) {
          getRunCriticAutomatically().then((shouldRun) => {
            if (shouldRun) {
              getProject(project.id).then((freshProj) => {
                if (!freshProj?.critique) {
                  runDesignCritic({
                    projectId: project.id,
                    files: latestFiles,
                    spec: resolvedDesign!,
                    brief: freshProj?.plan?.brief,
                    lintResult: null,
                    provider: activeProvider,
                    model: activeModel,
                  }).catch((err) => console.warn('[DESYRA] Auto-critic background error:', err));
                }
              });
            }
          });
        }

        return {
          success: true,
          assistantMessage,
          issues,
          aborted: false,
        };
      }

      return { success: true, issues: [], aborted: false };
    } catch (err: unknown) {
      coalescer.flush();
      protocolParser.end();
      const sessionResult = await session.finish();
      flushUiNow();
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (signal.aborted) {
        if (rawTextRef.current) {
          const latestFiles = await listFiles(project.id);
          const issues = checkCompleteness({
            operations: operationsRef.current,
            incompleteFiles: sessionResult.incompleteFiles,
            finishReason: 'interrupted',
            projectFiles: latestFiles,
            projectDesign: resolvedDesign,
          });

          const partialMessage: StoredMessage = {
            id: assistantMsgId,
            projectId: project.id,
            role: 'assistant',
            content: rawTextRef.current,
            createdAt: Date.now(),
            model: activeModel || undefined,
            provider: activeProvider?.label,
            promptKind,
            designSpecId,
            undoEntries: sessionResult.undoEntries,
            undoDisabledReason: sessionResult.undoDisabledReason,
            incompleteFiles: sessionResult.incompleteFiles.length > 0 ? sessionResult.incompleteFiles : undefined,
            failedEdits: sessionResult.failedEdits.length > 0 ? sessionResult.failedEdits : undefined,
            finishReason: 'interrupted',
            maxOutputTokens: resolvedMaxTokens,
            completenessIssues: issues.length > 0 ? issues : undefined,
          };
          await saveProjectMessage(partialMessage);
          setMessages((prev) => [...prev, partialMessage]);
          markStreamingActive(project.id, false);
          schedulePostTurnSnapshot(assistantMsgId, userPrompt);
        }
        return { success: false, issues: [], aborted: true };
      } else {
        console.error('Chat error:', err);
        const isRateLimit = errorMsg.includes('429') || errorMsg.includes('Rate limit');
        const errObj: ProviderError = {
          kind: isRateLimit ? 'rate_limit' : 'unknown',
          message: errorMsg,
          status: isRateLimit ? 429 : 500,
        };
        setLastError(errObj);

        if (isRateLimit) {
          toast({
            type: 'warning',
            title: 'Rate Limit Reached',
            message: 'Provider rate limit reached. Consider switching provider or model.',
          });
        } else {
          toast({
            type: 'error',
            title: 'Generation Failed',
            message: errorMsg,
          });
        }
        return { success: false, issues: [], aborted: false };
      }
    } finally {
      markStreamingActive(project.id, false);
    }
  };

  const handleApprovePlan = async (updatedPlan: ProjectPlan, spec: DesignSpec) => {
    setIsStreaming(true);
    setAutoContinueStatus('Starting build...');
    try {
      const preFiles = await listFiles(project.id);
      if (preFiles.length > 0) {
        await createSnapshot(project.id, {
          label: 'Before design plan apply',
          kind: 'design',
        });
      }
      await updateProject(project.id, { plan: updatedPlan, design: spec });
      await installDesignSystem(project.id, spec);
      if (onDesignUpdated) {
        onDesignUpdated(spec);
      }

      // Update stored plan_card message in state & IndexedDB
      const currentMsgs = await listProjectMessages(project.id);
      const planMsg = currentMsgs.find((m) => m.kind === 'plan_card');
      if (planMsg) {
        const updatedMsg: StoredMessage = {
          ...planMsg,
          content: JSON.stringify(updatedPlan),
        };
        await saveProjectMessage(updatedMsg);
        setMessages((prev) => prev.map((m) => (m.id === planMsg.id ? updatedMsg : m)));
      }

      // Start the build turn with runTurn
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const history = await listProjectMessages(project.id);
      const buildPrompt =
        project.idea || 'Build the web application matching the approved design brief and selected features.';

      const buildTurn = await runTurn(
        buildPrompt,
        history,
        abortController.signal,
        spec,
        updatedPlan
      );

      // Check auto-continue if needed
      if (buildTurn.success && buildTurn.assistantMessage && buildTurn.issues.length > 0) {
        const autoContinueEnabled = await getAutoContinueEnabled();
        if (
          autoContinueEnabled &&
          buildTurn.assistantMessage.finishReason !== 'safety' &&
          !abortController.signal.aborted
        ) {
          let currentIssues = buildTurn.issues;
          let previousSignature = computeIssuesSignature(currentIssues);

          for (let round = 1; round <= 3; round++) {
            if (abortController.signal.aborted) break;
            await flushPendingPostTurnSnapshot();
            setAutoContinueStatus(`Auto-continue ${round}/3`);
            const currentFiles = await listFiles(project.id);
            const continuePrompt = buildContinueMessage(currentIssues, currentFiles, spec);
            const historyForRound = await listProjectMessages(project.id);

            const roundTurn = await runTurn(
              continuePrompt,
              historyForRound,
              abortController.signal,
              spec,
              updatedPlan
            );

            if (!roundTurn.success || roundTurn.aborted || !roundTurn.assistantMessage) break;
            if (roundTurn.assistantMessage.finishReason === 'safety') break;
            if (roundTurn.issues.length === 0) break;
            const newSig = computeIssuesSignature(roundTurn.issues);
            if (newSig === previousSignature) break;
            currentIssues = roundTurn.issues;
            previousSignature = newSig;
          }
        }
      }
    } catch (err) {
      console.error('Plan approval build error:', err);
      toast({
        type: 'error',
        title: 'Build Failed',
        message: err instanceof Error ? err.message : 'Could not start build.',
      });
    } finally {
      setIsStreaming(false);
      setAutoContinueStatus(null);
    }
  };

  const handleRegeneratePlan = async (msg: StoredMessage) => {
    if (isPlanRegenerating || !activeProvider || !activeModel) return;
    setIsPlanRegenerating(true);
    try {
      let currentPlan: ProjectPlan | null = null;
      try {
        currentPlan = JSON.parse(msg.content);
      } catch {}
      const prevDirections = currentPlan?.brief?.directionName
        ? [currentPlan.brief.directionName]
        : [];

      const newBrief = await generateBrief({
        idea: project.idea || msg.content,
        previousDirections: prevDirections,
        provider: activeProvider,
        model: activeModel,
      });

      const newPlan: ProjectPlan = {
        brief: newBrief,
        selections: {
          presetId: newBrief.recommended.presetId,
          fontPairId: newBrief.recommended.fontPairId,
          mode: newBrief.recommended.mode,
          defaultMode: newBrief.recommended.defaultMode,
          density: newBrief.recommended.density,
          radius: newBrief.recommended.radius,
          motion: newBrief.recommended.motion,
          primarySeed: newBrief.recommended.paletteSeeds[0] || '#2563eb',
          accentSeed: newBrief.recommended.paletteSeeds[1] || '#06b6d4',
          bgSeed: newBrief.recommended.paletteSeeds[2] || '#f59e0b',
          selectedFeatureIds: newBrief.features.map((f) => f.id),
          customFeatures: [],
        },
        status: 'pending',
      };

      await updateProject(project.id, { plan: newPlan });
      const updatedMsg: StoredMessage = {
        ...msg,
        content: JSON.stringify(newPlan),
      };
      await saveProjectMessage(updatedMsg);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? updatedMsg : m)));
    } catch (err) {
      console.error('Failed to regenerate plan:', err);
      toast({
        type: 'error',
        title: 'Regeneration Failed',
        message: 'Could not generate a new design direction.',
      });
    } finally {
      setIsPlanRegenerating(false);
    }
  };

  const handleSkipPlanReview = async (planData: ProjectPlan) => {
    const approvedPlan: ProjectPlan = {
      ...planData,
      status: 'skipped',
      approvedAt: Date.now(),
    };
    const spec = buildSpecFromSelections(approvedPlan.selections, approvedPlan.brief.copyLanguage);
    await handleApprovePlan(approvedPlan, spec);
  };

  const handleAlwaysSkipPlanReview = async (planData: ProjectPlan) => {
    await setReviewDesignBeforeBuild(false);
    toast({
      type: 'info',
      title: 'Review Skipped',
      message: 'Future builds will skip design review. You can re-enable this in Settings.',
    });
    await handleSkipPlanReview(planData);
  };

  const executeSend = async (textToSend: string, isAutoStart = false) => {
    const cleanText = textToSend.trim();
    if (!cleanText || isStreaming) return;

    // Check if session is locked
    const locked = await isSessionLocked();
    if (locked) {
      setIsLocked(true);
      setIsUnlockModalOpen(true);
      return;
    }

    // Check if provider is available
    if (!activeProvider) {
      toast({
        type: 'error',
        title: 'No AI Provider',
        message: 'Please configure an AI provider with an API key in Settings.',
      });
      return;
    }

    // Check if model is selected
    if (!activeModel) {
      toast({
        type: 'warning',
        title: 'Model Not Selected',
        message: `Please select a default model for ${activeProvider.label} in Settings.`,
      });
      return;
    }

    // Clear changed files indicator in tree on new prompt
    aiFileStore.clearAllChanged(project.id);

    // Resolve designForTurn ONCE:
    // Existing project.design from database, or freshly created and installed spec
    const dbProj = await getProject(project.id);
    let designForTurn: DesignSpec | null =
      extractDesignSpec(dbProj?.design) ||
      extractDesignSpec(projectDesign) ||
      extractDesignSpec(project.design);
    let planForTurn: ProjectPlan | null = dbProj?.plan || null;

    if (!designForTurn) {
      const existingHistory = await listProjectMessages(project.id);
      const existingFiles = await listFiles(project.id);
      const isPre7AProject =
        existingHistory.some((m) => m.kind !== 'plan_card') ||
        existingFiles.some((f) => !MANAGED_DESIGN_FILES.includes(f.path));

      if (!isPre7AProject) {
        const quality = await getDesignQualitySetting();

        if (quality !== 'fast' && !planForTurn) {
          // Standard or Best quality -> generate Idea Brief & Plan Card!
          setIsStreaming(true);
          setAutoContinueStatus('Analyzing your idea...');

          // Save user prompt message
          const userMessage: StoredMessage = {
            id: `msg_${Date.now()}_u`,
            projectId: project.id,
            role: 'user',
            content: cleanText,
            createdAt: Date.now(),
            model: activeModel || undefined,
            provider: activeProvider?.label,
          };
          await saveProjectMessage(userMessage);
          setMessages((prev) => [...prev, userMessage]);

          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          const brief = await generateBrief({
            idea: cleanText || project.idea,
            provider: activeProvider,
            model: activeModel,
            signal: abortController.signal,
          });

          const pendingPlan: ProjectPlan = {
            brief,
            selections: {
              presetId: brief.recommended.presetId,
              fontPairId: brief.recommended.fontPairId,
              mode: brief.recommended.mode,
              defaultMode: brief.recommended.defaultMode,
              density: brief.recommended.density,
              radius: brief.recommended.radius,
              motion: brief.recommended.motion,
              primarySeed: brief.recommended.paletteSeeds[0] || '#2563eb',
              accentSeed: brief.recommended.paletteSeeds[1] || '#06b6d4',
              bgSeed: brief.recommended.paletteSeeds[2] || '#f59e0b',
              selectedFeatureIds: brief.features.map((f) => f.id),
              customFeatures: [],
            },
            status: 'pending',
          };
          await updateProject(project.id, { plan: pendingPlan });
          planForTurn = pendingPlan;

          const reviewBeforeBuild = await getReviewDesignBeforeBuild();
          if (reviewBeforeBuild) {
            // Post Plan Card message into chat
            const planMsg: StoredMessage = {
              id: `plan_${Date.now()}`,
              projectId: project.id,
              role: 'assistant',
              content: JSON.stringify(pendingPlan),
              kind: 'plan_card',
              createdAt: Date.now(),
            };
            await saveProjectMessage(planMsg);
            setMessages((prev) => [...prev, planMsg]);
            setIsStreaming(false);
            setAutoContinueStatus(null);
            return; // Conversation STOPS here and waits for the user to review the Plan Card
          }

          // If review toggle is OFF, auto-approve and proceed to build immediately
          const approvedPlan: ProjectPlan = {
            ...pendingPlan,
            status: 'approved',
            approvedAt: Date.now(),
          };
          await updateProject(project.id, { plan: approvedPlan });
          planForTurn = approvedPlan;
          const liveSpec = buildSpecFromSelections(approvedPlan.selections, approvedPlan.brief.copyLanguage);
          await installDesignSystem(project.id, liveSpec);
          designForTurn = liveSpec;
          if (onDesignUpdated) {
            onDesignUpdated(liveSpec);
          }
          setAutoContinueStatus(null);
        } else {
          // Fast mode or fallback: deterministic 7A flow
          const { spec } = await ensureProjectDesign(
            project.id,
            cleanText || project.idea || 'General App'
          );
          designForTurn = spec;
          if (onDesignUpdated) {
            onDesignUpdated(spec);
          }
        }
      }
    }

    setLastError(null);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }

    setIsStreaming(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const currentHistory = await listProjectMessages(project.id);
      const initialTurn = await runTurn(
        cleanText,
        currentHistory,
        abortController.signal,
        designForTurn,
        planForTurn
      );

      if (!initialTurn.success || initialTurn.aborted || !initialTurn.assistantMessage) {
        return;
      }

      // Check auto-continue conditions:
      // Enabled in settings, has completeness issues, finishReason wasn't safety, not aborted
      const autoContinueEnabled = await getAutoContinueEnabled();
      if (
        autoContinueEnabled &&
        initialTurn.issues.length > 0 &&
        initialTurn.assistantMessage.finishReason !== 'safety' &&
        !abortController.signal.aborted
      ) {
        let currentIssues = initialTurn.issues;
        let previousSignature = computeIssuesSignature(currentIssues);

        for (let round = 1; round <= 3; round++) {
          if (abortController.signal.aborted) break;

          await flushPendingPostTurnSnapshot();
          setAutoContinueStatus(`Auto-continue ${round}/3`);

          const currentFiles = await listFiles(project.id);
          const continuePrompt = buildContinueMessage(currentIssues, currentFiles, designForTurn);
          const historyForRound = await listProjectMessages(project.id);

          const roundTurn = await runTurn(
            continuePrompt,
            historyForRound,
            abortController.signal,
            designForTurn
          );

          if (!roundTurn.success || roundTurn.aborted || !roundTurn.assistantMessage) {
            break;
          }

          if (roundTurn.assistantMessage.finishReason === 'safety') {
            break;
          }

          if (roundTurn.issues.length === 0) {
            // All missing items completed!
            break;
          }

          const newSignature = computeIssuesSignature(roundTurn.issues);
          if (newSignature === previousSignature) {
            // No progress made on unresolved files; break to prevent looping
            break;
          }

          previousSignature = newSignature;
          currentIssues = roundTurn.issues;
        }
      }
    } finally {
      setIsStreaming(false);
      setAutoContinueStatus(null);
      setStreamingUi({ prose: '', operations: [] });
      rawTextRef.current = '';
      streamingProseRef.current = '';
      operationsRef.current = [];
      abortControllerRef.current = null;
    }
  };

  const handleContinueBuild = async (msg: StoredMessage) => {
    if (!msg.completenessIssues || msg.completenessIssues.length === 0) return;
    const currentFiles = await listFiles(project.id);
    const dbProj = await getProject(project.id);
    const design =
      extractDesignSpec(dbProj?.design) ||
      extractDesignSpec(projectDesign) ||
      extractDesignSpec(project.design);
    const continuePrompt = buildContinueMessage(msg.completenessIssues, currentFiles, design);
    executeSend(continuePrompt);
  };

  const executeSendRef = useRef(executeSend);
  useEffect(() => {
    executeSendRef.current = executeSend;
  });

  useEffect(() => {
    if (onRegisterSendHandler) {
      onRegisterSendHandler(async (prompt: string) => {
        await executeSendRef.current(prompt, false);
      });
    }
  }, [onRegisterSendHandler]);

  // First-open auto-start behavior check
  useEffect(() => {
    if (hasCheckedAutoStartRef.current) return;
    if (!activeProvider || !activeModel) return;

    const checkAutoStart = async () => {
      hasCheckedAutoStartRef.current = true;
      const msgs = await listProjectMessages(project.id);
      const locked = await isSessionLocked();

      if (
        msgs.length === 0 &&
        !project.autoStarted &&
        !locked &&
        project.idea.trim()
      ) {
        // Mark autoStarted=true immediately in IndexedDB
        await updateProject(project.id, { autoStarted: true });
        // Automatically send the saved idea as the first message
        executeSendRef.current(project.idea, true);
      }
    };

    checkAutoStart();
  }, [project.id, project.autoStarted, project.idea, activeProvider, activeModel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeSend(inputText);
    }
  };

  const handleRetryLast = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      executeSend(lastUserMsg.content);
    }
  };

  const handleRetryFailedEdit = (path: string) => {
    executeSend(
      `Please resend the changes to ${path} as a full file using <desyra-file path="${path}"> instead of an edit.`
    );
  };

  const hasValidConfig = Boolean(activeProvider && activeModel && !isLocked);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 w-full bg-[var(--bg)] border-r border-[var(--border)] overflow-hidden relative">
      {/* Message List Area */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 w-full overflow-x-hidden overflow-y-auto px-3.5 sm:px-4 py-4 space-y-4 sm:space-y-5 text-left [overscroll-behavior-y:contain] [-webkit-overflow-scrolling:touch] [overflow-anchor:auto]"
        >
          {/* Missing config state */}
          {messages.length === 0 && !hasValidConfig && (
            <div className="space-y-4 my-auto py-6">
              <Card elevated className="p-5 border-[var(--border)]">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[rgba(255,107,26,0.12)] border border-[rgba(255,107,26,0.25)] flex items-center justify-center shrink-0 text-[var(--accent)]">
                    <Lightbulb className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs uppercase tracking-wider font-semibold text-[var(--muted)] mb-1">
                      Your Saved App Idea
                    </h3>
                    <p className="text-xs sm:text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                      {project.idea}
                    </p>
                  </div>
                </div>
              </Card>

              {isLocked ? (
                <Card className="p-5 border-[var(--border)] text-center">
                  <EmptyState
                    icon={<Lock className="w-6 h-6 text-[var(--warning)]" />}
                    title="Storage is Locked"
                    description="Unlock with your passphrase to use your saved AI provider keys and start generating."
                    action={
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setIsUnlockModalOpen(true)}
                      >
                        Unlock with Passphrase
                      </Button>
                    }
                  />
                </Card>
              ) : (
                <Card className="p-5 border-[var(--border)] text-center">
                  <EmptyState
                    icon={<KeyRound className="w-6 h-6 text-[var(--accent)]" />}
                    title={!activeProvider ? 'No AI Provider Configured' : 'No Model Selected'}
                    description={
                      !activeProvider
                        ? 'Add an API key for Google Gemini, Groq, OpenRouter, or OpenAI in Settings to begin.'
                        : `Select an active default model for ${activeProvider.label} in Settings.`
                    }
                    action={
                      <Link href="/settings">
                        <Button variant="primary" size="sm">
                           Configure in Settings
                        </Button>
                      </Link>
                    }
                  />
                </Card>
              )}
            </div>
          )}

          {/* Valid config but 0 messages */}
          {messages.length === 0 && hasValidConfig && !isStreaming && (
            <div className="space-y-4 my-auto py-6">
              <Card elevated className="p-5 border-[var(--border)]">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[rgba(255,107,26,0.12)] border border-[rgba(255,107,26,0.25)] flex items-center justify-center shrink-0 text-[var(--accent)]">
                    <Lightbulb className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs uppercase tracking-wider font-semibold text-[var(--muted)] mb-1">
                      Your App Specification
                    </h3>
                    <p className="text-xs sm:text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed mb-4">
                      {project.idea}
                    </p>
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => executeSend(project.idea)}
                      leftIcon={<Play className="w-4 h-4 fill-current" />}
                    >
                      Start with my idea
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Render Saved Messages (memoized per message item) */}
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              onOpenFile={onOpenFile}
              onRetryEdit={handleRetryFailedEdit}
              onUndo={handleUndo}
              onContinueBuild={handleContinueBuild}
              onApprovePlan={handleApprovePlan}
              onRegeneratePlan={handleRegeneratePlan}
              onSkipPlanReview={handleSkipPlanReview}
              onAlwaysSkipPlanReview={handleAlwaysSkipPlanReview}
              onOpenHistory={onOpenHistory}
              isPlanRegenerating={isPlanRegenerating}
            />
          ))}

          {/* Fix 1: Active Streaming Message - renders lightweight prose blocks + operation cards without raw file content */}
          {isStreaming && (
            <div className="w-full flex flex-col text-left animate-in fade-in duration-100">
              <div className="flex items-center gap-1.5 mb-1 select-none">
                <span className="text-[12px] font-semibold text-[var(--muted)]">DESYRA</span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                {autoContinueStatus && (
                  <span className="ml-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[rgba(255,107,26,0.12)] border border-[rgba(255,107,26,0.25)] text-[10px] text-[var(--accent)] font-medium flex items-center gap-1 animate-in fade-in">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>{autoContinueStatus}</span>
                  </span>
                )}
              </div>
              <div className="w-full text-[15px] sm:text-[14.5px] leading-[1.6] text-[var(--text)] [overflow-wrap:anywhere]">
                {streamingUi.prose ? (
                  <StreamingProseRenderer prose={streamingUi.prose} />
                ) : streamingUi.operations.length === 0 ? (
                  <span className="text-[var(--disabled)] italic text-sm">Thinking...</span>
                ) : null}

                {streamingUi.operations.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {streamingUi.operations.map((op, idx) => (
                      <FileOperationCard
                        key={`stream-op-${op.path}-${idx}`}
                        op={op.op}
                        path={op.path}
                        status={op.status}
                        lineCount={op.lineCount}
                        errorReason={op.errorReason}
                        onOpenFile={onOpenFile}
                        onRetry={handleRetryFailedEdit}
                      />
                    ))}
                  </div>
                )}
                <span className="inline-block w-1.5 h-3.5 ml-1 bg-[var(--accent)] animate-pulse align-middle" />
              </div>
            </div>
          )}

          {/* Error Banner with Retry */}
          {lastError && (
            <div className="p-3.5 rounded-[var(--radius-md)] bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-xs text-[var(--error)] flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Generation stopped</p>
                  <p className="mt-0.5 leading-relaxed">{lastError.message}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetryLast}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                className="shrink-0 text-xs"
              >
                Retry
              </Button>
            </div>
          )}
        </div>

        {/* Floating "Jump to latest" button */}
        {isScrolledUp && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-pill)] bg-[var(--elevated)] hover:bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] shadow-lg transition-all hover:scale-105 cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Jump to latest</span>
            </button>
          </div>
        )}
      </div>

      {/* Composer Section */}
      <div className="p-2.5 sm:p-3 bg-[var(--surface)] border-t border-[var(--border)] flex-none w-full">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSend(inputText);
          }}
          className="flex flex-col gap-1"
        >
          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isStreaming || !hasValidConfig}
              placeholder="Message DESYRA..."
              className="flex-1 min-h-[44px] max-h-[144px] sm:max-h-[192px] w-full bg-[var(--elevated)] text-[var(--text)] text-[16px] sm:text-[14px] leading-[1.5] rounded-[12px] border border-[var(--border)] px-3.5 py-2.5 resize-none placeholder:text-[var(--disabled)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50 overflow-y-auto [scrollbar-width:thin]"
            />

            {isStreaming ? (
              <Button
                type="button"
                variant="secondary"
                onClick={handleStop}
                aria-label="Stop generation"
                className="w-11 h-11 sm:h-10 sm:w-auto sm:px-3 sm:py-2 shrink-0 rounded-[12px] flex items-center justify-center p-0"
              >
                <Square className="w-4 h-4 fill-current shrink-0" />
                <span className="hidden sm:inline ml-1.5 text-xs font-medium">Stop</span>
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!inputText.trim() || !hasValidConfig}
                aria-label="Send message"
                className="w-11 h-11 sm:h-10 sm:w-auto sm:px-3.5 sm:py-2 shrink-0 rounded-[12px] flex items-center justify-center p-0"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline ml-1.5 text-xs font-medium">Send</span>
              </Button>
            )}
          </div>

          <p className="hidden sm:block text-[11px] text-[var(--disabled)] select-none px-1">
            Enter to send, Shift+Enter for a new line
          </p>
        </form>
      </div>

      {/* Unlock Modal */}
      <UnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onUnlocked={() => {
          setIsLocked(false);
          setIsUnlockModalOpen(false);
          loadMessages();
          onRefreshProviders?.();
        }}
      />
    </div>
  );
}
