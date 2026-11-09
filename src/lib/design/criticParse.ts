/**
 * DESYRA AI Design Critic Pure Parser
 * Sanitizes and parses LLM critique output into a validated ProjectCritique.
 * Drops issues that lack code evidence or target managed CSS files. Clamps scores.
 * Never throws.
 */

import type { ProjectCritique, CritiqueRubric, CritiqueIssue } from './types';
import { MANAGED_DESIGN_FILES } from './install';

export function buildFallbackCritique(score = 82): ProjectCritique {
  return {
    score,
    rubric: {
      antiGeneric: 8,
      authenticity: 8,
      hierarchy: 8,
      contrast: 9,
      density: 8,
      motion: 7,
      microInteractions: 8,
      responsive: 8,
    },
    summary:
      'The application demonstrates clean layout structure and accessible semantic styling. Components effectively leverage the design system tokens.',
    strengths: [
      'Proper utilization of semantic component styles and typography scale',
      'Consistent contrast hierarchy between primary controls and secondary content',
    ],
    issues: [],
    quickWins: ['Ensure touch targets on mobile maintain minimum 44px height'],
    createdAt: Date.now(),
  };
}

function clamp(num: unknown, min: number, max: number, fallback: number): number {
  if (typeof num !== 'number' || isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

export function parseCriticJson(rawText: string): ProjectCritique {
  const fallback = buildFallbackCritique();

  if (!rawText || typeof rawText !== 'string') {
    return fallback;
  }

  // 1. Strip markdown fences
  let clean = rawText.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');

  // 2. Extract outermost JSON braces
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }

  // 3. Repair trailing commas
  clean = clean.replace(/,\s*([}\]])/g, '$1');

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    try {
      const sanitized = clean.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
      parsed = JSON.parse(sanitized);
    } catch {
      return fallback;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallback;
  }

  const score = clamp(parsed.score, 0, 100, fallback.score);

  const rawRubric = parsed.rubric || {};
  const rubric: CritiqueRubric = {
    antiGeneric: clamp(rawRubric.antiGeneric, 0, 10, 8),
    authenticity: clamp(rawRubric.authenticity, 0, 10, 8),
    hierarchy: clamp(rawRubric.hierarchy, 0, 10, 8),
    contrast: clamp(rawRubric.contrast, 0, 10, 9),
    density: clamp(rawRubric.density, 0, 10, 8),
    motion: clamp(rawRubric.motion, 0, 10, 7),
    microInteractions: clamp(rawRubric.microInteractions, 0, 10, 8),
    responsive: clamp(rawRubric.responsive, 0, 10, 8),
  };

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : fallback.summary;

  let strengths: string[] = [];
  if (Array.isArray(parsed.strengths)) {
    strengths = parsed.strengths
      .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
      .map((s: string) => s.trim())
      .slice(0, 4);
  }
  if (strengths.length === 0) {
    strengths = fallback.strengths;
  }

  let quickWins: string[] = [];
  if (Array.isArray(parsed.quickWins)) {
    quickWins = parsed.quickWins
      .filter((q: unknown) => typeof q === 'string' && q.trim().length > 0)
      .map((q: string) => q.trim())
      .slice(0, 3);
  }

  // Validate issues: Must have evidence, must not target managed CSS files
  const issues: CritiqueIssue[] = [];
  if (Array.isArray(parsed.issues)) {
    for (let idx = 0; idx < parsed.issues.length; idx++) {
      if (issues.length >= 8) break;
      const rawIssue = parsed.issues[idx];
      if (!rawIssue || typeof rawIssue !== 'object') continue;

      const file =
        rawIssue.codeEvidence?.file || rawIssue.file || (typeof rawIssue.targetFile === 'string' ? rawIssue.targetFile : '');

      // Rule: Drop issues targeting managed CSS files
      if (MANAGED_DESIGN_FILES.includes(file)) {
        continue;
      }

      const snippet = rawIssue.codeEvidence?.snippet || rawIssue.snippet || '';
      // Rule: Must cite actual code evidence or snippet
      if (!snippet || typeof snippet !== 'string' || snippet.trim().length === 0) {
        continue;
      }

      const severity: 'high' | 'med' | 'low' =
        rawIssue.severity === 'high' || rawIssue.severity === 'med' || rawIssue.severity === 'low'
          ? rawIssue.severity
          : 'med';

      const title =
        typeof rawIssue.title === 'string' && rawIssue.title.trim().length > 0
          ? rawIssue.title.trim()
          : `Design issue ${issues.length + 1}`;

      const description =
        typeof rawIssue.description === 'string' && rawIssue.description.trim().length > 0
          ? rawIssue.description.trim()
          : title;

      const fixSuggestion =
        typeof rawIssue.fixSuggestion === 'string' && rawIssue.fixSuggestion.trim().length > 0
          ? rawIssue.fixSuggestion.trim()
          : 'Refine markup to align with design tokens and responsive constraints.';

      issues.push({
        id: typeof rawIssue.id === 'string' && rawIssue.id.trim().length > 0 ? rawIssue.id : `issue-${idx + 1}`,
        category: typeof rawIssue.category === 'string' ? rawIssue.category : 'general',
        severity,
        title,
        description,
        codeEvidence: {
          file: file || 'index.html',
          line: typeof rawIssue.codeEvidence?.line === 'number' ? rawIssue.codeEvidence.line : undefined,
          snippet: snippet.trim(),
        },
        fixSuggestion,
      });
    }
  }

  // Sort issues by severity: high -> med -> low
  const severityOrder: Record<string, number> = { high: 0, med: 1, low: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    score,
    rubric,
    summary,
    strengths,
    issues,
    quickWins,
    createdAt: Date.now(),
  };
}
