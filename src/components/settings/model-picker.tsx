'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Check,
  AlertTriangle,
  Sparkles,
  Eye,
  Zap,
  Code,
  Tag,
  ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { listModels, type ModelInfo, type ModelTag } from '@/lib/ai';
import { setDefaultModel, type SafeProviderInfo } from '@/lib/keys';
import { getModelSetting, setModelSetting } from '@/lib/db';
import { useToast } from '@/components/ui/toast';

export interface ModelPickerProps {
  provider: SafeProviderInfo;
  onModelSelected?: (modelId: string) => void;
  onRequireUnlock?: () => void;
}

export function ModelPicker({
  provider,
  onModelSelected,
  onRequireUnlock,
}: ModelPickerProps) {
  const { toast } = useToast();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualModelInput, setManualModelInput] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [maxTokensInput, setMaxTokensInput] = useState<string>('');
  const [maxTokensError, setMaxTokensError] = useState<string | null>(null);
  const [isSavingMaxTokens, setIsSavingMaxTokens] = useState(false);

  const selectedModelId = provider.defaultModel;

  useEffect(() => {
    let active = true;
    if (selectedModelId) {
      getModelSetting(provider.id, selectedModelId).then((setting) => {
        if (active) {
          setMaxTokensInput(setting?.maxOutputTokens ? String(setting.maxOutputTokens) : '');
          setMaxTokensError(null);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [provider.id, selectedModelId]);

  const fetchModels = useCallback(
    async (force = false) => {
      if (force) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const fetched = await listModels(provider, force);
        setModels(fetched);

        // If no default model is currently set and models are returned, pick the first one or a recommended one
        if (!provider.defaultModel && fetched.length > 0) {
          const first = fetched[0].id;
          await setDefaultModel(provider.id, first);
          onModelSelected?.(first);
        }
      } catch (err: unknown) {
        console.error('Failed to load models:', err);
        const msg = err instanceof Error ? err.message : 'Could not fetch models.';
        if (msg.includes('locked')) {
          onRequireUnlock?.();
        } else {
          setError(msg);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [provider, onModelSelected, onRequireUnlock]
  );

  useEffect(() => {
    let isMounted = true;

    listModels(provider, false)
      .then((fetched) => {
        if (isMounted) {
          setModels(fetched);
          if (!provider.defaultModel && fetched.length > 0) {
            const first = fetched[0].id;
            setDefaultModel(provider.id, first).catch(() => {});
            onModelSelected?.(first);
          }
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          console.error('Failed to load models:', err);
          const msg = err instanceof Error ? err.message : 'Could not fetch models.';
          if (msg.includes('locked')) {
            onRequireUnlock?.();
          } else {
            setError(msg);
          }
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [provider.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectModel = async (modelId: string) => {
    try {
      await setDefaultModel(provider.id, modelId);
      toast({
        type: 'success',
        title: 'Default Model Updated',
        message: `Set "${modelId}" as default for ${provider.label}.`,
      });
      onModelSelected?.(modelId);
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Could not update default model.',
      });
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualModelInput.trim();
    if (!clean) return;

    setIsSavingManual(true);
    try {
      await setDefaultModel(provider.id, clean);
      toast({
        type: 'success',
        title: 'Model Selected',
        message: `Set custom model "${clean}".`,
      });
      setManualModelInput('');
      onModelSelected?.(clean);
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleSaveMaxTokens = async () => {
    if (!selectedModelId) return;
    const raw = maxTokensInput.trim();
    if (!raw) {
      setMaxTokensError(null);
      await setModelSetting(provider.id, selectedModelId, undefined);
      toast({
        type: 'info',
        title: 'Automatic output limit',
        message: `Max output tokens reset to automatic for ${selectedModelId}.`,
      });
      return;
    }

    const num = parseInt(raw, 10);
    if (isNaN(num) || num < 1024 || num > 200000) {
      setMaxTokensError('Must be between 1,024 and 200,000 (or empty for automatic).');
      return;
    }

    setMaxTokensError(null);
    setIsSavingMaxTokens(true);
    try {
      await setModelSetting(provider.id, selectedModelId, num);
      toast({
        type: 'success',
        title: 'Max output tokens saved',
        message: `Limit set to ${num.toLocaleString()} tokens for ${selectedModelId}.`,
      });
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Failed to save token limit.',
      });
    } finally {
      setIsSavingMaxTokens(false);
    }
  };

  const filteredModels = models.filter((m) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mt-3 pt-3 border-t border-[var(--border)]/70 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text)] uppercase tracking-wider">
            Model Selection
          </span>
          {selectedModelId && (
            <Badge variant="accent" size="sm">
              Active: {selectedModelId}
            </Badge>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchModels(true)}
          disabled={isRefreshing || isLoading}
          loading={isRefreshing}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          className="text-xs"
        >
          Refresh models
        </Button>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {/* Error state with Retry & Manual fallback input */}
      {!isLoading && error && (
        <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[rgba(239,68,68,0.3)] space-y-3">
          <div className="flex items-start gap-2.5 text-xs text-[var(--error)]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Unable to load models automatically</p>
              <p className="text-[var(--muted)] mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchModels(true)}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Retry Loading
            </Button>
          </div>

          <form onSubmit={handleManualSubmit} className="pt-2 border-t border-[var(--border)]">
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              Enter Model ID Manually
            </label>
            <div className="flex gap-2">
              <Input
                value={manualModelInput}
                onChange={(e) => setManualModelInput(e.target.value)}
                placeholder="e.g. gpt-4o, claude-3-7-sonnet, llama-3.3-70b-versatile"
                disabled={isSavingManual}
                className="text-xs font-mono"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!manualModelInput.trim()}
                loading={isSavingManual}
              >
                Set
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Populated Searchable Model List */}
      {!isLoading && !error && (
        <div className="space-y-2.5">
          {models.length > 5 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${models.length} models by name or tag...`}
                className="pl-8 text-xs h-8 min-h-[36px]"
              />
            </div>
          )}

          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 focus-visible:outline-none">
            {filteredModels.length === 0 ? (
              <p className="text-xs text-[var(--muted)] py-2 text-center">
                No models match &ldquo;{searchQuery}&rdquo;
              </p>
            ) : (
              filteredModels.map((m) => {
                const isSelected = selectedModelId === m.id;

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectModel(m.id)}
                    className={`w-full text-left p-2.5 rounded-[var(--radius-sm)] border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--elevated)] border-[var(--accent)] text-[var(--text)]'
                        : 'bg-[var(--surface)] hover:bg-[var(--elevated)] border-[var(--border)] hover:border-[#383842] text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold truncate text-[var(--text)]">
                          {m.id}
                        </span>
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                        )}
                      </div>

                      {m.name && m.name !== m.id && (
                        <p className="text-[11px] text-[var(--muted)] truncate mt-0.5">
                          {m.name}
                        </p>
                      )}

                      {/* Honest Tags */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {m.tags.map((tag) => (
                          <TagBadge key={tag} tag={tag} />
                        ))}
                        {m.contextWindow && (
                          <span className="text-[10px] text-[var(--disabled)] font-mono">
                            {Math.round(m.contextWindow / 1024)}k ctx
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center">
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-black flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border border-[var(--border)] hover:border-[var(--accent)]" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Manual Model Override Option */}
          <details className="text-xs text-[var(--muted)] pt-1">
            <summary className="cursor-pointer hover:text-[var(--text)] select-none">
              Or specify an unlisted / custom model ID
            </summary>
            <form onSubmit={handleManualSubmit} className="flex gap-2 mt-2">
              <Input
                value={manualModelInput}
                onChange={(e) => setManualModelInput(e.target.value)}
                placeholder="Enter exact model ID string"
                className="text-xs font-mono h-8 min-h-[36px]"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!manualModelInput.trim()}
                loading={isSavingManual}
              >
                Set
              </Button>
            </form>
          </details>

          {/* Advanced: Max Output Tokens override */}
          {selectedModelId && (
            <div className="pt-2 border-t border-[var(--border)]/70">
              <details className="text-xs text-[var(--muted)]">
                <summary className="cursor-pointer hover:text-[var(--text)] select-none text-[11px] font-medium">
                  Advanced: max output tokens for <span className="font-mono text-[var(--accent)]">{selectedModelId}</span>
                </summary>
                <div className="mt-2 space-y-2 p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1024}
                      max={200000}
                      step={512}
                      value={maxTokensInput}
                      onChange={(e) => {
                        setMaxTokensInput(e.target.value);
                        setMaxTokensError(null);
                      }}
                      placeholder="Automatic (recommended)"
                      className="text-xs font-mono h-8 min-h-[36px] flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleSaveMaxTokens}
                      loading={isSavingMaxTokens}
                    >
                      Save limit
                    </Button>
                  </div>
                  {maxTokensError && (
                    <p className="text-[11px] text-[var(--error)]">{maxTokensError}</p>
                  )}
                  <p className="text-[11px] text-[var(--disabled)] leading-normal">
                    Empty = automatic provider limit. Sets the maximum tokens the model can generate per response (1,024 to 200,000). Thinking/reasoning models use output tokens for internal reasoning before generating code.
                  </p>
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Honest tag renderer.
 * Suggested tags ("coding", "fast") show a tooltip: "Based on the model name, not a benchmark".
 */
function TagBadge({ tag }: { tag: ModelTag }) {
  if (tag === 'free') {
    return (
      <Badge variant="accent" size="sm" className="text-[10px] py-0 px-1.5">
        free
      </Badge>
    );
  }

  if (tag === 'vision') {
    return (
      <Badge variant="info" size="sm" className="text-[10px] py-0 px-1.5">
        vision
      </Badge>
    );
  }

  // "coding" and "fast" are marked as suggested
  return (
    <Tooltip content="Based on the model name, not a benchmark" position="top">
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--elevated)] text-[var(--muted)] cursor-help">
        {tag === 'coding' && <Code className="w-2.5 h-2.5 text-[var(--accent)]" />}
        {tag === 'fast' && <Zap className="w-2.5 h-2.5 text-[var(--warning)]" />}
        <span>{tag}*</span>
      </span>
    </Tooltip>
  );
}
