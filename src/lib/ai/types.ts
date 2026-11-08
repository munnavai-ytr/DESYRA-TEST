import type { ProviderType } from '@/lib/providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ModelTag = 'coding' | 'fast' | 'vision' | 'free';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  outputTokenLimit?: number;
  supportsVision?: boolean;
  tags: ModelTag[];
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'cors'
  | 'model_not_found'
  | 'quota'
  | 'bad_request'
  | 'unknown';

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
}

export type StreamFinishReason =
  | 'stop'
  | 'length'
  | 'safety'
  | 'interrupted'
  | 'other';

export interface StreamChunk {
  text?: string;
  done: boolean;
  finishReason?: StreamFinishReason;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ProviderAdapter {
  testKey(apiKey: string, baseUrl?: string): Promise<{ valid: boolean; error?: ProviderError }>;
  listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;
  streamChat(params: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    maxOutputTokens?: number;
  }): AsyncIterable<StreamChunk>;
}
