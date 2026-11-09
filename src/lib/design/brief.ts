/**
 * DESYRA Idea Brief Generator
 * Uses LLM via streamChat to generate an IdeaBrief, falling back seamlessly
 * to a deterministic archetype-derived brief if network/quota/abort issues arise.
 */

import { buildBriefPrompt } from '@/lib/ai/prompts/brief';
import { parseBriefJson, buildDeterministicBrief } from './briefParse';
import { streamChat } from '@/lib/ai';
import { detectLanguage } from './classify';
import type { SafeProviderInfo } from '@/lib/keys';
import type { IdeaBrief, DesignLanguage } from './types';

export interface GenerateBriefParams {
  idea: string;
  language?: DesignLanguage;
  archetypeHint?: string;
  previousDirections?: string[];
  provider: SafeProviderInfo;
  model: string;
  signal?: AbortSignal;
}

/**
 * Generates an IdeaBrief with LLM analysis and deterministic fallback.
 * Guaranteed never to throw; always returns a valid, verified IdeaBrief.
 */
export async function generateBrief(params: {
  idea: string;
  language?: DesignLanguage;
  archetypeHint?: string;
  previousDirections?: string[];
  provider?: SafeProviderInfo;
  model?: string;
  signal?: AbortSignal;
}): Promise<IdeaBrief> {
  const lang: DesignLanguage =
    params.language || detectLanguage(params.idea) || 'en';

  // If no provider or model provided, return deterministic brief immediately
  if (!params.provider || !params.model) {
    return buildDeterministicBrief(params.idea, lang, params.archetypeHint);
  }

  const systemPrompt = buildBriefPrompt({
    idea: params.idea,
    language: lang,
    archetypeHint: params.archetypeHint,
    previousDirections: params.previousDirections,
  });

  let rawOutput = '';
  try {
    const stream = streamChat({
      provider: params.provider,
      model: params.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate the product brief JSON for the following idea:\n"${params.idea}"`,
        },
      ],
      signal: params.signal,
      maxOutputTokens: 1500,
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        rawOutput += chunk.text;
      }
    }

    const { brief } = parseBriefJson(rawOutput, params.idea, lang);
    return brief;
  } catch (err: unknown) {
    if (params.signal?.aborted) {
      // Aborted by user - return fallback without loud error
      return buildDeterministicBrief(params.idea, lang, params.archetypeHint);
    }
    console.warn('[DESYRA Brief] LLM brief generation failed, using deterministic fallback:', err);
    return buildDeterministicBrief(params.idea, lang, params.archetypeHint);
  }
}
