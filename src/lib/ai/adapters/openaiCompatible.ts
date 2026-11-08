import type {
  ProviderAdapter,
  ModelInfo,
  ChatMessage,
  StreamChunk,
  ProviderError,
} from '../types';
import {
  parseHttpResponseError,
  parseFetchException,
  retryWithBackoff,
  inferModelTags,
  readSSEStream,
} from '../utils';

export function createOpenAICompatibleAdapter(providerName: string): ProviderAdapter {
  return {
    async testKey(apiKey: string, baseUrl = 'https://api.openai.com/v1') {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      try {
        const res = await retryWithBackoff(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          try {
            const headers: Record<string, string> = {
              Authorization: `Bearer ${apiKey}`,
            };
            if (cleanBase.includes('openrouter.ai')) {
              headers['HTTP-Referer'] = 'https://desyra.app';
              headers['X-Title'] = 'DESYRA';
            }

            return await fetch(`${cleanBase}/models`, {
              method: 'GET',
              headers,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
          }
        });

        if (res.ok) {
          return { valid: true };
        }

        const error = await parseHttpResponseError(res, providerName);
        return { valid: false, error };
      } catch (err) {
        return {
          valid: false,
          error: parseFetchException(err, providerName),
        };
      }
    },

    async listModels(apiKey: string, baseUrl = 'https://api.openai.com/v1'): Promise<ModelInfo[]> {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      try {
        const res = await retryWithBackoff(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);
          try {
            const headers: Record<string, string> = {
              Authorization: `Bearer ${apiKey}`,
            };
            if (cleanBase.includes('openrouter.ai')) {
              headers['HTTP-Referer'] = 'https://desyra.app';
              headers['X-Title'] = 'DESYRA';
            }

            return await fetch(`${cleanBase}/models`, {
              method: 'GET',
              headers,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
          }
        });

        if (!res.ok) {
          const err = await parseHttpResponseError(res, providerName);
          throw new Error(err.message);
        }

        const json = await res.json();
        const rawList: Array<{
          id: string;
          name?: string;
          description?: string;
          context_length?: number;
          top_provider?: { max_completion_tokens?: number };
          max_completion_tokens?: number;
          max_output_tokens?: number;
          output_token_limit?: number;
          architecture?: { modality?: string };
          pricing?: { prompt?: string; completion?: string };
        }> = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];

        return rawList.map((m) => {
          const id = m.id;
          const name = m.name || m.id;
          const supportsVision = Boolean(
            m.architecture?.modality?.includes('image') ||
              id.includes('vision') ||
              id.includes('4o') ||
              id.includes('vl')
          );

          const isFree = Boolean(
            m.pricing?.prompt === '0' && m.pricing?.completion === '0'
          );

          const reportedLimit =
            m.top_provider?.max_completion_tokens ??
            m.max_completion_tokens ??
            m.max_output_tokens ??
            m.output_token_limit;

          const outputTokenLimit =
            typeof reportedLimit === 'number' && reportedLimit > 0
              ? reportedLimit
              : undefined;

          const tags = inferModelTags(id, {
            supportsVision,
            isFree,
            pricingPrompt: m.pricing?.prompt,
            pricingCompletion: m.pricing?.completion,
          });

          return {
            id,
            name,
            provider: providerName,
            contextWindow: m.context_length,
            outputTokenLimit,
            supportsVision,
            tags,
            description: m.description,
            pricing: m.pricing,
          };
        });
      } catch (err: unknown) {
        if (err instanceof Error && !err.message.includes(providerName)) {
          const parsed = parseFetchException(err, providerName);
          throw new Error(parsed.message);
        }
        throw err;
      }
    },

    async *streamChat({
      apiKey,
      baseUrl = 'https://api.openai.com/v1',
      model,
      messages,
      signal,
      maxOutputTokens,
    }): AsyncIterable<StreamChunk> {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const url = `${cleanBase}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      if (cleanBase.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://desyra.app';
        headers['X-Title'] = 'DESYRA';
      }

      let currentLimit = maxOutputTokens;
      let retried = false;
      let response: Response;

      while (true) {
        const payload: Record<string, any> = {
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        };

        if (currentLimit && currentLimit > 0) {
          payload.max_tokens = currentLimit;
        }

        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal,
          });
        } catch (err) {
          const parsed = parseFetchException(err, providerName);
          throw new Error(parsed.message);
        }

        if (!response.ok) {
          const err = await parseHttpResponseError(response, providerName);
          // Fix A: If HTTP 400 mentions max tokens / output limit, retry ONCE with halved value (minimum 4096)
          if (
            response.status === 400 &&
            !retried &&
            /max[_\s-]?tokens|max_completion_tokens|output[_\s-]?limit/i.test(err.message)
          ) {
            retried = true;
            currentLimit = Math.max(4096, Math.floor((currentLimit || 16384) / 2));
            continue;
          }
          throw new Error(err.message);
        }
        break;
      }

      const chunksQueue: StreamChunk[] = [];
      let streamDone = false;
      let streamError: Error | null = null;
      let notifyResolver: (() => void) | null = null;
      let detectedFinishReason: StreamChunk['finishReason'] = undefined;
      let lastUsage: StreamChunk['usage'] = undefined;

      const pushChunk = (chunk: StreamChunk) => {
        chunksQueue.push(chunk);
        if (notifyResolver) {
          notifyResolver();
          notifyResolver = null;
        }
      };

      readSSEStream(
        response,
        (dataString) => {
          try {
            const parsed = JSON.parse(dataString);
            const choice = parsed.choices?.[0];
            const deltaText = choice?.delta?.content || choice?.delta?.text;

            if (choice?.finish_reason) {
              const r = choice.finish_reason;
              if (r === 'stop') {
                detectedFinishReason = 'stop';
              } else if (r === 'length') {
                detectedFinishReason = 'length';
              } else if (r === 'content_filter') {
                detectedFinishReason = 'safety';
              } else {
                detectedFinishReason = 'other';
              }
            }

            const usage = parsed.usage
              ? {
                  promptTokens: parsed.usage.prompt_tokens,
                  completionTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                }
              : undefined;

            if (usage) {
              lastUsage = usage;
            }

            if (deltaText) {
              pushChunk({ text: deltaText, done: false, usage });
            }
          } catch {
            // Ignore partial SSE parsing issues
          }
        },
        signal
      )
        .then(() => {
          streamDone = true;
          const finish = detectedFinishReason || (signal?.aborted ? 'interrupted' : 'interrupted');
          pushChunk({
            done: true,
            finishReason: finish,
            usage: lastUsage,
          });
        })
        .catch((err) => {
          streamError = err;
          streamDone = true;
          if (notifyResolver) {
            notifyResolver();
            notifyResolver = null;
          }
        });

      while (!streamDone || chunksQueue.length > 0) {
        if (chunksQueue.length > 0) {
          yield chunksQueue.shift()!;
        } else if (!streamDone) {
          await new Promise<void>((resolve) => {
            notifyResolver = resolve;
          });
        }
      }

      if (streamError) {
        throw streamError;
      }
    },
  };
}
