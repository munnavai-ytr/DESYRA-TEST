import type {
  ProviderAdapter,
  ModelInfo,
  ChatMessage,
  StreamChunk,
  ProviderError,
} from './types';
import { geminiAdapter } from './adapters/gemini';
import { anthropicAdapter } from './adapters/anthropic';
import { createOpenAICompatibleAdapter } from './adapters/openaiCompatible';
import {
  getDecryptedKey,
  updateProviderTestStatus,
  type SafeProviderInfo,
} from '@/lib/keys';
import { getModelCache, setModelCache, getModelSetting } from '@/lib/db';

export * from './types';
export * from './utils';

/**
 * Returns the corresponding adapter for a provider.
 */
export function getAdapter(
  provider: SafeProviderInfo | { type: string; name?: string }
): ProviderAdapter {
  const type = 'providerType' in provider ? provider.providerType : provider.type;
  const label = 'label' in provider ? provider.label : provider.name || 'AI Provider';

  switch (type) {
    case 'gemini':
      return geminiAdapter;
    case 'anthropic':
      return anthropicAdapter;
    case 'openai-compatible':
    default:
      return createOpenAICompatibleAdapter(label);
  }
}

/**
 * Tests an encrypted key for a stored provider.
 * Retrieves decrypted key in memory for this call only, updates status, and returns safe result.
 */
export async function testKey(provider: SafeProviderInfo): Promise<{
  valid: boolean;
  status: 'valid' | 'invalid' | 'rate_limited' | 'unverified';
  error?: string;
}> {
  try {
    const rawKey = await getDecryptedKey(provider.id);
    const adapter = getAdapter(provider);
    const result = await adapter.testKey(rawKey, provider.baseUrl);

    let status: 'valid' | 'invalid' | 'rate_limited' | 'unverified';
    let errorMessage: string | undefined;

    if (result.valid) {
      status = 'valid';
      // Automatically load and cache model list in background
      listModels(provider, true).catch(() => {});
    } else {
      errorMessage = result.error?.message || 'Verification failed';
      if (result.error?.kind === 'rate_limit') {
        status = 'rate_limited';
      } else if (result.error?.kind === 'auth') {
        status = 'invalid';
      } else {
        status = 'unverified';
      }
    }

    await updateProviderTestStatus(provider.id, status, errorMessage);

    return {
      valid: result.valid,
      status,
      error: errorMessage,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to test key';
    const status = msg.includes('rejected') ? 'invalid' : 'unverified';
    await updateProviderTestStatus(provider.id, status, msg);
    return {
      valid: false,
      status,
      error: msg,
    };
  }
}

/**
 * Lists models for a provider with IndexedDB caching (24-hour TTL).
 */
export async function listModels(
  provider: SafeProviderInfo,
  forceRefresh = false
): Promise<ModelInfo[]> {
  // 1. Check local IndexedDB cache
  if (!forceRefresh) {
    const cached = await getModelCache(provider.id);
    if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
      const ageHours = (Date.now() - cached.fetchedAt) / (1000 * 60 * 60);
      if (ageHours < 24) {
        return cached.models as ModelInfo[];
      }
    }
  }

  // 2. Fetch fresh models via provider adapter
  const rawKey = await getDecryptedKey(provider.id);
  const adapter = getAdapter(provider);
  const freshModels = await adapter.listModels(rawKey, provider.baseUrl);

  // 3. Cache in IndexedDB
  if (freshModels.length > 0) {
    await setModelCache(provider.id, freshModels);
  }

  return freshModels;
}

/**
 * Resolves maxOutputTokens following Fix A resolution order:
 * User override (Fix A2) > model's outputTokenLimit (capped at 32,768) > provider fallback.
 */
export async function resolveMaxOutputTokens(
  provider: SafeProviderInfo,
  modelId: string,
  modelInfo?: ModelInfo
): Promise<number | undefined> {
  // 1. User override from modelSettings table
  const userSetting = await getModelSetting(provider.id, modelId);
  if (userSetting?.maxOutputTokens && userSetting.maxOutputTokens >= 1024) {
    return userSetting.maxOutputTokens;
  }

  // 2. Model's outputTokenLimit (cap at 32,768)
  let limit = modelInfo?.outputTokenLimit;
  if (!limit) {
    const cached = await getModelCache(provider.id);
    if (cached?.models && Array.isArray(cached.models)) {
      const match = cached.models.find((m: any) => m.id === modelId);
      if (match?.outputTokenLimit) {
        limit = match.outputTokenLimit;
      }
    }
  }

  if (limit && limit > 0) {
    return Math.min(limit, 32768);
  }

  // 3. Provider fallback: Anthropic requires parameter (16,384); others omit when unknown
  if (provider.providerType === 'anthropic') {
    return 16384;
  }

  return undefined;
}

/**
 * Streams chat completions using the decrypted key at call time.
 */
export async function* streamChat(params: {
  provider: SafeProviderInfo;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  maxOutputTokens?: number;
}): AsyncIterable<StreamChunk> {
  const rawKey = await getDecryptedKey(params.provider.id);
  const adapter = getAdapter(params.provider);

  const resolvedTokens =
    params.maxOutputTokens !== undefined
      ? params.maxOutputTokens
      : await resolveMaxOutputTokens(params.provider, params.model);

  yield* adapter.streamChat({
    apiKey: rawKey,
    baseUrl: params.provider.baseUrl,
    model: params.model,
    messages: params.messages,
    signal: params.signal,
    maxOutputTokens: resolvedTokens,
  });
}
