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

      const payload = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
      };

      let response: Response;
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
        throw new Error(err.message);
      }

      const chunksQueue: StreamChunk[] = [];
      let streamDone = false;
      let streamError: Error | null = null;
      let notifyResolver: (() => void) | null = null;

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

            const usage = parsed.usage
              ? {
                  promptTokens: parsed.usage.prompt_tokens,
                  completionTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                }
              : undefined;

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
          pushChunk({ done: true });
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
