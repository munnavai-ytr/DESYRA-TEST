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

    const payload: {
      contents: typeof contents;
      systemInstruction?: { parts: Array<{ text: string }> };
    } = {
      contents,
    };

    if (systemText) {
      payload.systemInstruction = {
        parts: [{ text: systemText }],
      };
    }

    let response: Response;
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
      throw new Error(err.message);
    }

    // Queue chunks from SSE stream
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
          const candidate = parsed.candidates?.[0];
          const textPart = candidate?.content?.parts?.[0]?.text;

          const usage = parsed.usageMetadata
            ? {
                promptTokens: parsed.usageMetadata.promptTokenCount,
                completionTokens: parsed.usageMetadata.candidatesTokenCount,
                totalTokens: parsed.usageMetadata.totalTokenCount,
              }
            : undefined;

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
