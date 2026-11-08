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
  ChevronDown,
  Trash2,
  Lock,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { UnlockModal } from '@/components/settings/unlock-modal';
import {
  listProviders,
  isSessionLocked,
  setDefaultModel,
  setDefault,
  type SafeProviderInfo,
} from '@/lib/keys';
import {
  listProjectMessages,
  saveProjectMessage,
  clearProjectMessages,
  type StoredMessage,
} from '@/lib/db';
import { streamChat, type ChatMessage, type ProviderError } from '@/lib/ai';

const SYSTEM_PROMPT = "You are DESYRA's assistant. Answer helpfully and concisely.";
const MAX_CONTEXT_MESSAGES = 20;

export interface DevPreviewPanelProps {
  projectId: string;
  projectIdea: string;
}

export function DevPreviewPanel({ projectId, projectIdea }: DevPreviewPanelProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [providers, setProviders] = useState<SafeProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<SafeProviderInfo | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [lastError, setLastError] = useState<ProviderError | null>(null);
  const [isSwitchMenuOpen, setIsSwitchMenuOpen] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isUserScrolledUpRef = useRef(false);

  // Load providers and project messages on mount
  const loadData = useCallback(() => {
    Promise.all([
      listProviders(),
      listProjectMessages(projectId),
      isSessionLocked(),
    ])
      .then(([allProviders, msgs, locked]) => {
        setProviders(allProviders);
        setMessages(msgs);
        setIsLocked(locked);

        if (allProviders.length > 0) {
          const def = allProviders.find((p) => p.isDefault) || allProviders[0];
          setActiveProvider(def);
          setActiveModel(def.defaultModel || null);
        }
      })
      .catch((err) => {
        console.error('Failed to load chat data:', err);
      });
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      listProviders(),
      listProjectMessages(projectId),
      isSessionLocked(),
    ])
      .then(([allProviders, msgs, locked]) => {
        if (isMounted) {
          setProviders(allProviders);
          setMessages(msgs);
          setIsLocked(locked);

          if (allProviders.length > 0) {
            const def = allProviders.find((p) => p.isDefault) || allProviders[0];
            setActiveProvider(def);
            setActiveModel(def.defaultModel || null);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load chat data:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // Handle scroll detection: do not auto-scroll if user scrolled up
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isUserScrolledUpRef.current = distanceToBottom > 60;
  };

  const scrollToBottom = useCallback(() => {
    if (isUserScrolledUpRef.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  // Switch provider and default model
  const handleSelectProviderAndModel = async (provider: SafeProviderInfo, modelId?: string) => {
    await setDefault(provider.id);
    if (modelId) {
      await setDefaultModel(provider.id, modelId);
    }
    setActiveProvider(provider);
    setActiveModel(modelId || provider.defaultModel || null);
    setIsSwitchMenuOpen(false);
    toast({
      type: 'info',
      title: 'Provider Switched',
      message: `Active: ${provider.label} ${modelId ? `(${modelId})` : ''}`,
    });
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputText).trim();
    if (!textToSend || isStreaming) return;

    // 1. Check if session is locked
    const locked = await isSessionLocked();
    if (locked) {
      setIsLocked(true);
      setIsUnlockModalOpen(true);
      return;
    }

    // 2. Check if key is available
    if (!activeProvider) {
      toast({
        type: 'error',
        title: 'No Provider',
        message: 'Please configure an AI provider in Settings.',
      });
      return;
    }

    // 3. Check if model is selected
    if (!activeModel) {
      toast({
        type: 'warning',
        title: 'Model Not Selected',
        message: `Please select a model for ${activeProvider.label} in Settings.`,
      });
      return;
    }

    setLastError(null);
    setInputText('');

    // If this is the first message ever in this project, anchor it with the project's saved idea
    const isFirstMessage = messages.length === 0;
    const userMessageContent = isFirstMessage
      ? `[Project Idea: ${projectIdea}]\n\n${textToSend}`
      : textToSend;

    const userMessage: StoredMessage = {
      id: `msg_${Date.now()}_u`,
      projectId,
      role: 'user',
      content: userMessageContent,
      createdAt: Date.now(),
      model: activeModel,
      provider: activeProvider.label,
    };

    // Save and update user message in state
    await saveProjectMessage(userMessage);
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Build context window for API call: system prompt + last MAX_CONTEXT_MESSAGES
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

      // Completed successfully
      if (accumulatedText) {
        const assistantMessage: StoredMessage = {
          id: assistantMsgId,
          projectId,
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

      // If user manually stopped, persist partial text
      if (abortController.signal.aborted) {
        if (accumulatedText) {
          const partialMessage: StoredMessage = {
            id: assistantMsgId,
            projectId,
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
        console.error('Chat stream failure:', err);
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
            title: 'Stream Error',
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

  const handleRetryLast = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      handleSend(lastUserMsg.content);
    }
  };

  const handleClearChat = async () => {
    if (messages.length === 0) return;
    await clearProjectMessages(projectId);
    setMessages([]);
    setLastError(null);
    toast({
      type: 'info',
      title: 'Chat Cleared',
      message: 'Conversation history reset.',
    });
  };

  if (providers.length === 0) {
    return (
      <Card className="p-6 mt-6 border-[var(--border)]">
        <EmptyState
          icon={<KeyRound className="w-6 h-6 text-[var(--accent)]" />}
          title="No AI Provider Configured"
          description="To test AI synthesis and chat preview, add an API key (e.g. Gemini, Groq, OpenRouter) in Settings."
          action={
            <Link href="/settings">
              <Button variant="primary" size="md">
                Configure Keys in Settings
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card elevated className="p-5 mt-6 border-[#2a2a32] flex flex-col h-[560px]">
        {/* Panel Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text)] tracking-tight">
              AI Provider Engine
            </span>
            <Badge variant="accent" size="sm">
              Developer preview
            </Badge>
          </div>

          {/* Active Model / Switcher Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSwitchMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-[var(--radius-pill)] bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              <span className="font-medium text-[var(--text)]">{activeProvider?.label}</span>
              <span className="text-[var(--disabled)]">/</span>
              <span className="font-mono text-[var(--accent)] truncate max-w-[140px]">
                {activeModel || 'Select model'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)]" />
            </button>

            {/* Switch Menu */}
            {isSwitchMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-30 w-64 bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-xl p-2 animate-in fade-in zoom-in-95 duration-100 text-xs">
                <p className="text-[11px] font-semibold text-[var(--muted)] px-2 py-1 uppercase tracking-wider">
                  Switch Provider / Model
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto mt-1">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProviderAndModel(p, p.defaultModel)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-sm)] flex items-center justify-between transition-colors cursor-pointer ${
                        activeProvider?.id === p.id
                          ? 'bg-[var(--surface)] text-[var(--accent)] font-medium border border-[var(--border)]'
                          : 'hover:bg-[var(--surface)] text-[var(--text)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate">{p.label}</p>
                        <p className="text-[10px] text-[var(--disabled)] font-mono truncate">
                          {p.defaultModel || 'No default model'}
                        </p>
                      </div>
                      {activeProvider?.id === p.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="pt-2 mt-2 border-t border-[var(--border)] flex justify-between items-center px-1">
                  <Link
                    href="/settings"
                    className="text-[11px] text-[var(--accent)] hover:underline"
                  >
                    Manage in Settings →
                  </Link>
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSwitchMenuOpen(false);
                        handleClearChat();
                      }}
                      className="text-[11px] text-[var(--muted)] hover:text-[var(--error)]"
                    >
                      Clear chat
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Message Scroll Viewport */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 text-sm leading-relaxed"
        >
          {messages.length === 0 && !streamingText && (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--muted)]">
              <Bot className="w-8 h-8 text-[var(--disabled)] mb-2 stroke-[1.5]" />
              <p className="text-xs text-[var(--text)] font-medium">Ready to test generation</p>
              <p className="text-xs text-[var(--muted)] max-w-sm mt-1">
                Ask questions or prototype features. Your project idea will be automatically provided as initial context.
              </p>
            </div>
          )}

          {messages.map((m) => {
            const isUser = m.role === 'user';

            return (
              <div
                key={m.id}
                className={`flex gap-3 items-start ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`p-3.5 rounded-[var(--radius-md)] max-w-[85%] text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed ${
                    isUser
                      ? 'bg-[var(--surface)] border border-[#303038] text-[var(--text)]'
                      : 'bg-[var(--elevated)] border border-[var(--border)] text-[var(--text)]'
                  }`}
                >
                  {m.content}
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--muted)] shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Active Streaming Chunk Display */}
          {isStreaming && (
            <div className="flex gap-3 items-start justify-start animate-in fade-in duration-100">
              <div className="w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0 mt-0.5">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-3.5 rounded-[var(--radius-md)] max-w-[85%] text-xs sm:text-sm bg-[var(--elevated)] border border-[var(--border)] text-[var(--text)] whitespace-pre-wrap break-words leading-relaxed">
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

        {/* Input & Control Bar */}
        <div className="pt-3 border-t border-[var(--border)] shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isStreaming
                  ? 'Receiving response...'
                  : !activeModel
                  ? 'Select a model in Settings to chat'
                  : 'Ask about this project or request architecture ideas...'
              }
              disabled={isStreaming || !activeModel}
              className="text-xs sm:text-sm"
            />

            {isStreaming ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleStop}
                leftIcon={<Square className="w-3.5 h-3.5 fill-current" />}
                className="shrink-0 text-xs"
              >
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={!inputText.trim() || !activeModel}
                leftIcon={<Send className="w-3.5 h-3.5" />}
                className="shrink-0 text-xs"
              >
                Send
              </Button>
            )}
          </form>
        </div>
      </Card>

      {/* Unlock Modal for Passphrase Protected Mode */}
      <UnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onUnlocked={() => {
          setIsLocked(false);
          setIsUnlockModalOpen(false);
          loadData();
        }}
      />
    </>
  );
}
