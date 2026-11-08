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

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com';

export const geminiAdapter: ProviderAdapter = {
  async testKey(apiKey: string, baseUrl = GEMINI_DEFAULT_BASE) {
    try {
      const res = await retryWithBackoff(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          return await fetch(`${baseUrl}/v1beta/models?pageSize=1`, {
            method: 'GET',
            headers: {
              'x-goog-api-key': apiKey,
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      });

      if (res.ok) {
        return { valid: true };
      }

      const error = await parseHttpResponseError(res, 'Google Gemini');
      return { valid: false, error };
    } catch (err) {
      return {
        valid: false,
        error: parseFetchException(err, 'Google Gemini'),
      };
    }
  },

  async listModels(apiKey: string, baseUrl = GEMINI_DEFAULT_BASE): Promise<ModelInfo[]> {
    try {
      const res = await retryWithBackoff(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          return await fetch(`${baseUrl}/v1beta/models`, {
            method: 'GET',
            headers: {
              'x-goog-api-key': apiKey,
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      });

      if (!res.ok) {
        const err = await parseHttpResponseError(res, 'Google Gemini');
        throw new Error(err.message);
      }

      const data = await res.json();
      const rawModels: Array<{
        name: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
        inputTokenLimit?: number;
        outputTokenLimit?: number;
      }> = data.models || [];

      // Filter only models that support content generation
      const filtered = rawModels.filter(
        (m) =>
          !m.supportedGenerationMethods ||
          m.supportedGenerationMethods.includes('generateContent')
      );

      return filtered.map((m) => {
        const id = m.name.replace(/^models\//, '');
        const name = m.displayName || id;
        const supportsVision = true; // Modern Gemini models are multimodal
        const tags = inferModelTags(id, {
          supportsVision,
          isFree: true,
        });

        return {
          id,
          name,
          provider: 'Google Gemini',
          contextWindow: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit && m.outputTokenLimit > 0 ? m.outputTokenLimit : undefined,
          supportsVision,
          tags,
          description: m.description,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Error && !err.message.includes('Google Gemini')) {
        const parsed = parseFetchException(err, 'Google Gemini');
        throw new Error(parsed.message);
      }
      throw err;
    }
  },

  async *streamChat({
    apiKey,
    baseUrl = GEMINI_DEFAULT_BASE,
    model,
    messages,
    signal,
    maxOutputTokens,
  }): AsyncIterable<StreamChunk> {
    const cleanModel = model.replace(/^models\//, '');
    const url = `${baseUrl}/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;

    // Extract system instructions and format conversational contents
    let systemText = '';
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + m.content;
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }

    // Fallback: If only system was provided, provide a prompt
    if (contents.length === 0 && systemText) {
      contents.push({
        role: 'user',
        parts: [{ text: systemText }],
      });
      systemText = '';
    }

    let currentLimit = maxOutputTokens;
    let retried = false;
    let response: Response;

    while (true) {
      const payload: {
        contents: typeof contents;
        systemInstruction?: { parts: Array<{ text: string }> };
        generationConfig?: { maxOutputTokens: number };
      } = {
        contents,
      };

      if (systemText) {
        payload.systemInstruction = {
          parts: [{ text: systemText }],
        };
      }

      if (currentLimit && currentLimit > 0) {
        payload.generationConfig = {
          maxOutputTokens: currentLimit,
        };
      }

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(payload),
          signal,
        });
      } catch (err) {
        const parsed = parseFetchException(err, 'Google Gemini');
        throw new Error(parsed.message);
      }

      if (!response.ok) {
        const err = await parseHttpResponseError(response, 'Google Gemini');
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

    // Queue chunks from SSE stream
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
          const candidate = parsed.candidates?.[0];
          const textPart = candidate?.content?.parts?.[0]?.text;

          if (candidate?.finishReason) {
            const r = candidate.finishReason;
            if (r === 'STOP') {
              detectedFinishReason = 'stop';
            } else if (r === 'MAX_TOKENS') {
              detectedFinishReason = 'length';
            } else if (
              ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(r)
            ) {
              detectedFinishReason = 'safety';
            } else {
              detectedFinishReason = 'other';
            }
          }

          const usage = parsed.usageMetadata
            ? {
                promptTokens: parsed.usageMetadata.promptTokenCount,
                completionTokens: parsed.usageMetadata.candidatesTokenCount,
                totalTokens: parsed.usageMetadata.totalTokenCount,
              }
            : undefined;

          if (usage) {
            lastUsage = usage;
          }

          if (textPart) {
            pushChunk({ text: textPart, done: false, usage });
          }
        } catch {
          // Ignore SSE chunk parsing error
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
