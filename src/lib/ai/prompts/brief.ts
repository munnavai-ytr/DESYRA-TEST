/**
 * DESYRA AI Design Brief System Prompt
 * Prompts the LLM to analyze the user's idea and generate a structured product & design direction.
 * Demands ONLY a raw JSON object conforming strictly to the IdeaBrief schema.
 */

import { ARCHETYPES } from '@/lib/design/archetypes';
import { STYLE_PRESETS } from '@/lib/design/presets';
import { FONT_PAIRS } from '@/lib/design/fonts';
import type { DesignLanguage } from '@/lib/design/types';

export function buildBriefPrompt(options: {
  idea: string;
  language: DesignLanguage;
  archetypeHint?: string;
  previousDirections?: string[];
}): string {
  const presetIds = Object.keys(STYLE_PRESETS).join(', ');
  const latinFontIds = Object.keys(FONT_PAIRS)
    .filter((k) => FONT_PAIRS[k].supports.includes('latin'))
    .join(', ');
  const bengaliFontIds = Object.keys(FONT_PAIRS)
    .filter((k) => FONT_PAIRS[k].supports.includes('bengali'))
    .join(', ');

  const prevText =
    options.previousDirections && options.previousDirections.length > 0
      ? `\nPREVIOUS DIRECTIONS TO AVOID (MUST create a completely distinct aesthetic angle and different directionName):\n${options.previousDirections.map((d) => `- "${d}"`).join('\n')}\n`
      : '';

  return `You are DESYRA's Product & Design Director.
Analyze the user's web app idea and produce a comprehensive product brief and visual design direction.
DESYRA builds single-page or multi-view static web applications (HTML5, modern CSS with custom properties, vanilla ES modules, Lucide icons, and browser persistence).

CRITICAL CONSTRAINTS:
1. Output MUST be ONLY a single valid JSON object.
2. Do NOT output markdown formatting, backticks, or \`\`\`json code fences.
3. Keep tokens concise and high-signal (total output under 1200 tokens).

ALLOWED ENUM VALUES:
- presetId: ${presetIds}
- fontPairId (if copyLanguage is 'en'): ${latinFontIds}
- fontPairId (if copyLanguage is 'bn'): ${bengaliFontIds}
- mode: "dark" | "light" | "both"
- defaultMode: "dark" | "light"
- density: "compact" | "comfortable" | "spacious"
- radius: "sharp" | "soft" | "round"
- motion: "none" | "subtle" | "rich"
- copyLanguage: "en" | "bn" (use "bn" if the user prompt is in Bengali or requests Bengali content)
${prevText}
SCHEMA SPECIFICATION (JSON object with exact keys):
{
  "appType": "Brief category name (e.g. Task Management Dashboard, Developer Portfolio, Boutique Storefront)",
  "audience": "Target demographic or user persona (1 short sentence)",
  "coreProblem": "The primary user need or pain point solved (1 short sentence)",
  "vibeWords": ["word1", "word2", "word3", "word4"], // 3 to 5 evocative adjectives
  "tone": "Editorial voice / copywriting tone (e.g. Crisp, confident, high-velocity)",
  "copyLanguage": "${options.language === 'bn' ? 'bn' : 'en'}",
  "screens": [ // 3 to 8 distinct views or app sections
    { "name": "Screen or section name", "purpose": "1-line purpose and primary action" }
  ],
  "features": [ // 4 to 10 key features
    {
      "id": "slug-id",
      "title": "Short feature title",
      "description": "Clear 1-line feature summary",
      "essential": true // true for 2-4 MVP features that must be built first; false for optional/advanced
    }
  ],
  "contentNotes": "Specific advice on real sample data, labels, and micro-copy (no generic lorem ipsum)",
  "directionName": "Evocative aesthetic name (e.g. 'Obsidian Pulse', 'Kinetic Studio', 'Nordic Horizon')",
  "recommended": {
    "presetId": "one of the allowed presetIds",
    "fontPairId": "one of the allowed fontPairIds matching copyLanguage",
    "mode": "dark" | "light" | "both",
    "defaultMode": "dark" | "light",
    "density": "compact" | "comfortable" | "spacious",
    "radius": "sharp" | "soft" | "round",
    "motion": "none" | "subtle" | "rich",
    "paletteSeeds": ["#hex1", "#hex2", "#hex3"] // Exactly 3 distinct 6-character hex colors: [primary, accent, background-hint]
  },
  "risks": [ // 1 to 3 domain traps to avoid for this specific concept
    "Trap 1 description"
  ]
}

Now analyze this idea and output the JSON brief:
"${options.idea}"`;
}
