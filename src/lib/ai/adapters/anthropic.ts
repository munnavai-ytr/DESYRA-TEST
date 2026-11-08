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

const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export const anthropicAdapter: ProviderAdapter = {
  async testKey(apiKey: string, baseUrl = ANTHROPIC_DEFAULT_BASE) {
    try {
      const res = await retryWithBackoff(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          return await fetch(`${baseUrl}/v1/models?limit=1`, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
              'anthropic-dangerous-direct-browser-access': 'true',
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

      const error = await parseHttpResponseError(res, 'Anthropic');
      return { valid: false, error };
    } catch (err) {
      return {
        valid: false,
        error: parseFetchException(err, 'Anthropic'),
      };
    }
  },

  async listModels(apiKey: string, baseUrl = ANTHROPIC_DEFAULT_BASE): Promise<ModelInfo[]> {
    try {
      const res = await retryWithBackoff(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          return await fetch(`${baseUrl}/v1/models`, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      });

      if (!res.ok) {
        const err = await parseHttpResponseError(res, 'Anthropic');
        throw new Error(err.message);
      }

      const data = await res.json();
      const rawModels: Array<{ id: string; display_name?: string }> = data.data || [];

      // Fallback list if provider returns empty
      const modelsList =
        rawModels.length > 0
          ? rawModels
          : [
              { id: 'claude-3-7-sonnet-20250219', display_name: 'Claude 3.7 Sonnet' },
              { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
              { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' },
            ];

      return modelsList.map((m) => {
        const id = m.id;
        const name = m.display_name || id;
        const supportsVision = true;
        const tags = inferModelTags(id, {
          supportsVision,
          isFree: false,
        });

        return {
          id,
          name,
          provider: 'Anthropic',
          contextWindow: 200000,
          supportsVision,
          tags,
        };
      });
    } catch (err: unknown) {
      if (err instanceof Error && !err.message.includes('Anthropic')) {
        const parsed = parseFetchException(err, 'Anthropic');
        throw new Error(parsed.message);
      }
      throw err;
    }
  },

  async *streamChat({
    apiKey,
    baseUrl = ANTHROPIC_DEFAULT_BASE,
    model,
    messages,
    signal,
  }): AsyncIterable<StreamChunk> {
    const url = `${baseUrl}/v1/messages`;

    // Extract system instructions and format conversational contents
    let systemText = '';
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + m.content;
      } else {
        formattedMessages.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    if (formattedMessages.length === 0 && systemText) {
      formattedMessages.push({
        role: 'user',
        content: systemText,
      });
      systemText = '';
    }

    const payload: {
      model: string;
      max_tokens: number;
      messages: typeof formattedMessages;
      system?: string;
      stream: boolean;
    } = {
      model,
      max_tokens: 4096,
      messages: formattedMessages,
      stream: true,
    };

    if (systemText) {
      payload.system = systemText;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      const parsed = parseFetchException(err, 'Anthropic');
      throw new Error(parsed.message);
    }

    if (!response.ok) {
      const err = await parseHttpResponseError(response, 'Anthropic');
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
          if (parsed.type === 'content_block_delta') {
            const textDelta = parsed.delta?.text;
            if (textDelta) {
              pushChunk({ text: textDelta, done: false });
            }
          } else if (parsed.type === 'message_delta') {
            if (parsed.usage) {
              pushChunk({
                done: false,
                usage: {
                  completionTokens: parsed.usage.output_tokens,
                },
              });
            }
          }
        } catch {
          // Ignore parse errors on other event types
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
