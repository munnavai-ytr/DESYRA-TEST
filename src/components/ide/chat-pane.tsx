'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Send,
  Square,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  Bot,
  User,
  ArrowDown,
  Lock,
  Play,
  Lightbulb,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { UnlockModal } from '@/components/settings/unlock-modal';
import {
  listProviders,
  isSessionLocked,
  type SafeProviderInfo,
} from '@/lib/keys';
import {
  listProjectMessages,
  saveProjectMessage,
  updateProject,
  type StoredMessage,
  type Project,
} from '@/lib/db';
import { streamChat, type ChatMessage, type ProviderError } from '@/lib/ai';
import { formatRelativeTime } from '@/lib/utils';

const SYSTEM_PROMPT = "You are DESYRA's assistant. Answer helpfully and concisely.";
const MAX_CONTEXT_MESSAGES = 20;

export interface ChatPaneProps {
  project: Project;
  activeProvider: SafeProviderInfo | null;
  activeModel: string | null;
  onRefreshProviders?: () => void;
}

export function ChatPane({
  project,
  activeProvider,
  activeModel,
  onRefreshProviders,
}: ChatPaneProps) {
  const { toast } = useToast();

  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [lastError, setLastError] = useState<ProviderError | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const hasCheckedAutoStartRef = useRef(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isUserScrolledUpRef = useRef(false);

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

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      scrollToBottom(false);
    }
  }, [messages, streamingText, scrollToBottom]);

  // Adjust textarea height up to 8 rows (~192px)
  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, 192);
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

    setLastError(null);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }

    // Format message content
    const userMessage: StoredMessage = {
      id: `msg_${Date.now()}_u`,
      projectId: project.id,
      role: 'user',
      content: cleanText,
      createdAt: Date.now(),
      model: activeModel,
      provider: activeProvider.label,
    };

    // Save user message to IndexedDB
    await saveProjectMessage(userMessage);
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Build context
    const historySlice = updatedMessages.slice(-MAX_CONTEXT_MESSAGES);
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historySlice.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    setIsStreaming(true);
    setStreamingText('');
    isUserScrolledUpRef.current = false;
    setIsScrolledUp(false);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let accumulatedText = '';
    const assistantMsgId = `msg_${Date.now()}_a`;

    try {
      const stream = streamChat({
        provider: activeProvider,
        model: activeModel,
        messages: apiMessages,
        signal: abortController.signal,
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          accumulatedText += chunk.text;
          setStreamingText(accumulatedText);
        }
      }

      if (accumulatedText) {
        const assistantMessage: StoredMessage = {
          id: assistantMsgId,
          projectId: project.id,
          role: 'assistant',
          content: accumulatedText,
          createdAt: Date.now(),
          model: activeModel,
          provider: activeProvider.label,
        };
        await saveProjectMessage(assistantMessage);
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (abortController.signal.aborted) {
        // Saved stopped text
        if (accumulatedText) {
          const partialMessage: StoredMessage = {
            id: assistantMsgId,
            projectId: project.id,
            role: 'assistant',
            content: accumulatedText,
            createdAt: Date.now(),
            model: activeModel,
            provider: activeProvider.label,
          };
          await saveProjectMessage(partialMessage);
          setMessages((prev) => [...prev, partialMessage]);
        }
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
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortControllerRef.current = null;
    }
  };

  const executeSendRef = useRef(executeSend);
  useEffect(() => {
    executeSendRef.current = executeSend;
  });

  // First-open behavior check
  useEffect(() => {
    if (hasCheckedAutoStartRef.current) return;
    if (!activeProvider || !activeModel) return;

    // Check if ready for auto-start
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

  // Missing config condition
  const hasValidConfig = Boolean(activeProvider && activeModel && !isLocked);

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] border-r border-[var(--border)] overflow-hidden relative">
      {/* Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 text-xs sm:text-sm leading-relaxed"
      >
        {/* If no valid config & no messages, show EmptyState explaining what is missing + the saved idea */}
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

        {/* If valid config exists but 0 messages and project wasn't auto-started (e.g. user returned after adding keys) */}
        {messages.length === 0 && hasValidConfig && !isStreaming && (
          <div className="space-y-4 my-auto py-6">
            <Card elevated className="p-5 border-[var(--border)]">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[rgba(255,107,26,0.12)] border border-[rgba(255,107,26,0.25)] flex items-center justify-center shrink-0 text-[var(--accent)]">
                  <Lightbulb className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs uppercase tracking-wider font-semibold text-[var(--muted)]">
                      Your App Specification
                    </h3>
                  </div>
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

        {/* Render Messages */}
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`group flex gap-2.5 items-start ${
                isUser ? 'justify-end' : 'justify-start'
              }`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}

              <div className="max-w-[85%] flex flex-col">
                <div
                  className={`p-3.5 rounded-[var(--radius-md)] text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed ${
                    isUser
                      ? 'bg-[var(--elevated)] border border-[#303038] text-[var(--text)]'
                      : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]'
                  }`}
                >
                  {m.content}
                </div>

                {/* Timestamp & info visible on hover or mobile tap */}
                <span
                  className={`text-[10px] text-[var(--disabled)] mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                    isUser ? 'text-right' : 'text-left'
                  }`}
                >
                  {formatRelativeTime(m.createdAt)}
                  {m.model ? ` · ${m.model}` : ''}
                </span>
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--muted)] shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming Chunk */}
        {isStreaming && (
          <div className="flex gap-2.5 items-start justify-start animate-in fade-in duration-100">
            <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="max-w-[85%] p-3.5 rounded-[var(--radius-md)] text-xs sm:text-sm bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] whitespace-pre-wrap break-words leading-relaxed">
              {streamingText || <span className="text-[var(--disabled)] italic">Thinking...</span>}
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

      {/* Floating "Jump to latest" button when user scrolled up */}
      {isScrolledUp && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
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

      {/* Composer Section */}
      <div className="p-3 bg-[var(--surface)] border-t border-[var(--border)] shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSend(inputText);
          }}
          className="relative flex items-end gap-2"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || !hasValidConfig}
            placeholder={
              !hasValidConfig
                ? isLocked
                  ? 'Unlock storage to chat'
                  : 'Configure an active model in Settings'
                : isStreaming
                ? 'DESYRA is generating...'
                : 'Message DESYRA... (Enter to send, Shift+Enter for new line)'
            }
            className="flex-1 min-h-[44px] max-h-[192px] w-full bg-[var(--elevated)] text-[var(--text)] text-xs sm:text-sm rounded-[var(--radius-md)] border border-[var(--border)] p-2.5 resize-none leading-relaxed placeholder:text-[var(--disabled)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50"
          />

          {isStreaming ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleStop}
              aria-label="Stop generation"
              leftIcon={<Square className="w-3.5 h-3.5 fill-current" />}
              className="shrink-0 h-[44px] px-3.5"
            >
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!inputText.trim() || !hasValidConfig}
              aria-label="Send message"
              leftIcon={<Send className="w-3.5 h-3.5" />}
              className="shrink-0 h-[44px] px-3.5"
            >
              Send
            </Button>
          )}
        </form>
      </div>

      {/* Unlock Modal for Passphrase Protected Mode */}
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
