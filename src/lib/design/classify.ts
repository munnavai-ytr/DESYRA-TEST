/**
 * DESYRA Design Classifier
 * Deterministic prompt classification to select archetype, language, and initial specs.
 */

import { ARCHETYPES } from './archetypes';
import type { ClassificationResult, DesignLanguage } from './types';

/**
 * Detects whether prompt text is primarily Bengali or English.
 */
export function detectLanguage(text: string): DesignLanguage {
  if (!text) return 'en';
  const bnRegex = /[\u0980-\u09FF]/g;
  const matches = text.match(bnRegex);
  if (matches && matches.length > 0) {
    const totalChars = text.replace(/\s+/g, '').length;
    if (totalChars > 0 && matches.length / totalChars > 0.03) {
      return 'bn';
    }
  }
  return 'en';
}

/**
 * Classifies an app idea / prompt to pick the best archetype and language.
 */
export function classifyIdea(text: string): ClassificationResult {
  const language = detectLanguage(text);
  const normalizedText = text.toLowerCase();

  const scores: Record<string, number> = {};

  for (const [id, archetype] of Object.entries(ARCHETYPES)) {
    if (id === 'general') continue;

    let score = 0;
    const keywords = [...archetype.keywordsEn, ...archetype.keywordsBn];

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (normalizedText.includes(kwLower)) {
        // Longer matching keywords get slightly higher weight
        score += kwLower.length > 4 ? 3 : 2;
      }
    }

    scores[id] = score;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  const topMatch = sorted[0];

  if (!topMatch || topMatch[1] === 0) {
    return {
      archetypeId: 'general',
      language,
      confidence: 0.5,
      alternatives: ['landing-marketing', 'saas-dashboard-admin'],
    };
  }

  const archetypeId = topMatch[0];
  const maxScore = topMatch[1];
  const confidence = Math.min(0.98, Math.max(0.6, 0.5 + maxScore * 0.1));

  const alternatives = sorted
    .slice(1, 4)
    .filter(([, s]) => s > 0)
    .map(([id]) => id);

  if (alternatives.length === 0) {
    alternatives.push('general');
  }

  return {
    archetypeId,
    language,
    confidence,
    alternatives,
  };
}
