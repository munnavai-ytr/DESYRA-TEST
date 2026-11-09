/**
 * DESYRA AI Design Critic System Prompt
 * Evaluates generated web app code against DESYRA's 8 core design principles:
 * 1. Anti-generic personality
 * 2. Aesthetic authenticity & typography
 * 3. Information hierarchy & focal points
 * 4. Contrast & WCAG compliance
 * 5. Layout density & rhythm
 * 6. Intentional motion & transitions
 * 7. Tactile micro-interactions
 * 8. Responsive touch & viewport resilience
 */

import type { DesignSpec, IdeaBrief } from '@/lib/design/types';

export function buildCriticPrompt(params: {
  spec: DesignSpec;
  brief?: IdeaBrief | null;
  lintIssueSummaries?: string[];
  projectFilesText: string;
}): string {
  const briefSummary = params.brief
    ? `App Concept: "${params.brief.appType}" - ${params.brief.coreProblem}
Target Audience: ${params.brief.audience}
Intended Tone & Vibe: ${params.brief.vibeWords.join(', ')} (${params.brief.tone})
Direction: ${params.brief.directionName}`
    : `Archetype: ${params.spec.archetypeId}, Preset: ${params.spec.presetId}`;

  const lintText =
    params.lintIssueSummaries && params.lintIssueSummaries.length > 0
      ? `Existing Linter Findings:\n${params.lintIssueSummaries.map((i) => `- ${i}`).join('\n')}`
      : 'Existing Linter: No deterministic accessibility/contrast violations flagged.';

  return `You are DESYRA's Lead Design Critic.
Evaluate the following web application code against the 8 DESYRA Design Principles.

${briefSummary}
Design Preset: ${params.spec.presetId}
Theme Mode: ${params.spec.mode}
Language: ${params.spec.language === 'bn' ? 'Bengali' : 'English'}

${lintText}

THE 8 DESIGN PRINCIPLES:
1. Anti-Generic: Avoid generic placeholder layout, unstyled browser dialogs (alert/confirm), or boring centered card syndrome.
2. Aesthetic Authenticity: Typography, colors, and layout reflect the distinct personality of the archetype.
3. Hierarchy: Crisp visual contrast between primary actions, secondary items, and tertiary metadata.
4. Contrast: High readability, legible text, accessible touch states.
5. Density: Intentional spacing, no awkward vast empty spaces or suffocating clusters.
6. Motion: Purposeful transitions on hover, open, and interactive state changes.
7. Micro-Interactions: Tactile feedback on buttons, inputs, toggles, badges, and status pills.
8. Responsive: Mobile touch-targets (min 44px), flexible flex/grid wrapping, clean layout at any width.

RULES FOR CRITIQUE:
1. Output MUST be ONLY a single valid JSON object. Do NOT use markdown code fences.
2. Every critique issue MUST cite actual code evidence (file and exact snippet) from the user's files.
3. DO NOT complain about managed files (css/tokens.css, css/base.css, css/components.css). Evaluate only the user-authored HTML and JS.
4. Maximum 8 issues, sorted strictly from highest severity ('high' -> 'med' -> 'low').

SCHEMA SPECIFICATION:
{
  "score": 85, // Integer 0 to 100 overall design score
  "rubric": {
    "antiGeneric": 8, // 0 to 10
    "authenticity": 9,
    "hierarchy": 8,
    "contrast": 9,
    "density": 8,
    "motion": 7,
    "microInteractions": 8,
    "responsive": 8
  },
  "summary": "2-3 concise sentences reviewing the overall aesthetic coherence and user experience.",
  "strengths": [
    "2 to 4 bullet points highlighting what the implementation did particularly well"
  ],
  "issues": [
    {
      "id": "unique-slug-id",
      "category": "hierarchy | contrast | responsiveness | microInteractions | motion | antiGeneric",
      "severity": "high" | "med" | "low",
      "title": "Short issue title",
      "description": "Clear explanation of why this hurts the user experience",
      "codeEvidence": {
        "file": "index.html",
        "snippet": "exact snippet from the file"
      },
      "fixSuggestion": "Concrete instruction on what markup or class to change"
    }
  ],
  "quickWins": [
    "1 to 3 fast, high-impact edits that immediately elevate the visual quality"
  ]
}

PROJECT CODE TO EVALUATE:
${params.projectFilesText}`;
}
