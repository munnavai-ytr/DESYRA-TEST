import type { ProviderError, ModelTag } from './types';

/**
 * Local hint lists for suggested tags based on model name only.
 * Tooltips must display: "Based on the model name, not a benchmark".
 */
const CODING_HINT_PATTERNS = [
  'coder',
  'codestral',
  'code',
  'qwen-coder',
  'deepseek-coder',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
];

const FAST_HINT_PATTERNS = [
  'flash',
  'instant',
  'haiku',
  'mini',
  'turbo',
  'fast',
  '8b',
  '7b',
  'small',
];

/**
 * Infers tags honestly according to Push 3 rules.
 */
export function inferModelTags(
  modelId: string,
  options?: {
    supportsVision?: boolean;
    isFree?: boolean;
    pricingPrompt?: string;
    pricingCompletion?: string;
  }
): ModelTag[] {
  const tags: ModelTag[] = [];
  const lowerId = modelId.toLowerCase();

  // 1. Free tag: only when explicitly confirmed by provider or id suffix
  if (
    options?.isFree ||
    lowerId.endsWith(':free') ||
    lowerId.includes('/free') ||
    (options?.pricingPrompt === '0' && options?.pricingCompletion === '0')
  ) {
    tags.push('free');
  }

  // 2. Vision tag: only when metadata confirms vision capability
  if (options?.supportsVision) {
    tags.push('vision');
  }

  // 3. Coding tag: from clearly marked name pattern
  const isCoding = CODING_HINT_PATTERNS.some((pat) => lowerId.includes(pat));
  if (isCoding) {
    tags.push('coding');
  }

  // 4. Fast tag: from clearly marked name pattern
  const isFast = FAST_HINT_PATTERNS.some((pat) => lowerId.includes(pat));
  if (isFast) {
    tags.push('fast');
  }

  return tags;
}

/**
 * Parses HTTP response error and extracts a clean ProviderError.
 * Never includes raw keys or request headers in the message.
 */
export async function parseHttpResponseError(
  res: Response,
  providerLabel: string
): Promise<ProviderError> {
  let errorDetail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        errorDetail =
          json?.error?.message ||
          json?.message ||
          (typeof json?.error === 'string' ? json.error : '');
      } catch {
        errorDetail = text.slice(0, 160);
      }
    }
  } catch {
    // text extraction failed
  }

  const status = res.status;

  // Rate limit
  if (status === 429) {
    const retryHeader = res.headers.get('retry-after');
    let retryAfterSeconds: number | undefined;
    if (retryHeader) {
      const parsed = parseInt(retryHeader, 10);
      if (!isNaN(parsed)) {
        retryAfterSeconds = parsed;
      }
    }

    return {
      kind: 'rate_limit',
      status: 429,
      retryAfterSeconds,
      message: retryAfterSeconds
        ? `Rate limit reached on ${providerLabel}. Retry after ${retryAfterSeconds}s (free-tier limits may apply).`
        : `Rate limit reached on ${providerLabel}. Free-tier limits and concurrency may apply.`,
    };
  }

  // Authentication
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      status,
      message: 'This key was rejected. Check that it is correct and active.',
    };
  }

  // Model not found
  if (status === 404) {
    return {
      kind: 'model_not_found',
      status: 404,
      message: errorDetail || 'Model not found or your key does not have access to it.',
    };
  }

  // Quota / Billing
  const lowerDetail = errorDetail.toLowerCase();
  if (
    status === 402 ||
    lowerDetail.includes('quota') ||
    lowerDetail.includes('credit') ||
    lowerDetail.includes('billing')
  ) {
    return {
      kind: 'quota',
      status,
      message: 'Provider quota or credit balance exceeded. Check your billing dashboard.',
    };
  }

  // Bad Request
  if (status === 400) {
    return {
      kind: 'bad_request',
      status: 400,
      message: errorDetail ? `Request error: ${errorDetail}` : 'Bad request sent to provider.',
    };
  }

  // General server/provider failure
  return {
    kind: 'unknown',
    status,
    message: errorDetail || `${providerLabel} API returned error code ${status}.`,
  };
}

/**
 * Parses fetch exceptions (network drops, CORS blocks, offline).
 */
export function parseFetchException(err: unknown, providerLabel: string): ProviderError {
  if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
    return {
      kind: 'unknown',
      message: 'Request was cancelled.',
    };
  }

  const msg = err instanceof Error ? err.message : String(err);
  const isCorsOrNetwork =
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('CORS') ||
    msg.includes('Load failed');

  if (isCorsOrNetwork) {
    return {
      kind: 'cors',
      message: `Could not connect to ${providerLabel}. This may be a network interruption or the provider may block direct browser calls (CORS). A proxy option is planned.`,
    };
  }

  return {
    kind: 'unknown',
    message: msg || `Failed to connect to ${providerLabel}.`,
  };
}

/**
 * Retries an idempotent async call (like testKey or listModels) with exponential backoff.
 * Max 2 retries (total 3 attempts).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        throw error;
      }
      // Wait 400ms * attempt
      const delay = 400 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Robust Server-Sent Events (SSE) reader.
 * Handles partial chunks, multi-line data, comments, and [DONE].
 */
export async function readSSEStream(
  response: Response,
  onData: (data: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep last incomplete piece in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // Empty line or SSE comment (: ping)
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const dataContent = trimmed.slice(5).trim();
          if (dataContent === '[DONE]') {
            return;
          }
          if (dataContent) {
            onData(dataContent);
          }
        }
      }
    }

    // Flush any remaining line
    if (buffer.trim().startsWith('data:')) {
      const dataContent = buffer.trim().slice(5).trim();
      if (dataContent && dataContent !== '[DONE]') {
        onData(dataContent);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
