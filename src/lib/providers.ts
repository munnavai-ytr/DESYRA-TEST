export type ProviderType = 'gemini' | 'anthropic' | 'openai-compatible';

export interface ProviderDefinition {
  id: string;
  name: string;
  type: ProviderType;
  defaultBaseUrl?: string;
  keyHelpUrl: string;
  freeTier: boolean;
  description: string;
  keyPrefixHint?: string;
  isCustom?: boolean;
}

export const PRESET_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyHelpUrl: 'https://aistudio.google.com/apikey',
    freeTier: true,
    description: 'High-speed reasoning and massive context window models by Google DeepMind.',
    keyPrefixHint: 'AIza',
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyHelpUrl: 'https://console.groq.com/keys',
    freeTier: true,
    description: 'Ultra-low latency LPU inference for open-weight models including Llama 3.',
    keyPrefixHint: 'gsk_',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHelpUrl: 'https://openrouter.ai/keys',
    freeTier: true, // Some free models
    description: 'Unified gateway providing access to dozens of leading open and proprietary LLMs.',
    keyPrefixHint: 'sk-or-',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    freeTier: false,
    description: 'Industry-standard GPT-4o, GPT-4o-mini, and reasoning models via official API.',
    keyPrefixHint: 'sk-',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    freeTier: false,
    description: 'Claude 3.7 Sonnet, Claude 3.5 Haiku, and Opus models with advanced coding prowess.',
    keyPrefixHint: 'sk-ant-',
  },
];

/**
 * Validates whether a key prefix matches the provider's typical format.
 * Returns null if matching or not applicable; returns a warning message string if it differs.
 * Soft warnings only: never blocks submission!
 */
export function checkKeyPrefixWarning(providerId: string, key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const provider = PRESET_PROVIDERS.find((p) => p.id === providerId);
  if (!provider || !provider.keyPrefixHint) return null;

  if (!trimmed.startsWith(provider.keyPrefixHint)) {
    return `This doesn't look like a typical ${provider.name} key (usually starts with "${provider.keyPrefixHint}"), double-check.`;
  }

  return null;
}

/**
 * Validates custom provider Base URL.
 * Must be https:// or http://localhost or http://127.0.0.1 (local development/Ollama/vLLM).
 */
export function validateCustomBaseUrl(url: string): { valid: boolean; error?: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, error: 'Base URL is required' };
  }

  try {
    const parsed = new URL(trimmed);
    const isHttps = parsed.protocol === 'https:';
    const isLocalhost =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.startsWith('127.'));

    if (!isHttps && !isLocalhost) {
      return {
        valid: false,
        error: 'Base URL must use https:// (or http:// for localhost/127.0.0.1)',
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format (e.g. https://api.example.com/v1)' };
  }
}
