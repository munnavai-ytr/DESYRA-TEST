/**
 * DESYRA Idea Brief Pure Parser
 * Sanitizes, parses, and validates LLM-generated brief JSON against the IdeaBrief schema.
 * Guaranteed never to throw; automatically repairs common syntax faults and falls back
 * to deterministic archetype-derived values for any missing or invalid fields.
 */

import { ARCHETYPES } from './archetypes';
import { STYLE_PRESETS } from './presets';
import { FONT_PAIRS } from './fonts';
import { classifyIdea, detectLanguage } from './classify';
import { hexToRgb, generatePalette, contrastRatio } from './color';
import type {
  IdeaBrief,
  BriefScreen,
  BriefFeature,
  BriefRecommendation,
  DesignLanguage,
  DesignMode,
  DesignDensity,
  DesignRadius,
  DesignMotion,
} from './types';

export interface BriefParseResult {
  brief: IdeaBrief;
  usedFallbackFields: string[];
}

/**
 * Generates a deterministic IdeaBrief based on idea classification.
 * Used for Fast quality mode and as a robust fallback.
 */
export function buildDeterministicBrief(
  idea: string,
  languageOverride?: DesignLanguage,
  archetypeHint?: string
): IdeaBrief {
  const classification = classifyIdea(idea);
  const lang: DesignLanguage = languageOverride || classification.language || detectLanguage(idea);
  const archId = archetypeHint && ARCHETYPES[archetypeHint] ? archetypeHint : classification.archetypeId;
  const archetype = ARCHETYPES[archId] || ARCHETYPES['general'];
  const preset = STYLE_PRESETS[archetype.recommendedPresetId] || STYLE_PRESETS['minimal'];

  const fontId =
    lang === 'bn'
      ? archetype.recommendedFontPairIdsBn?.[0] || 'hind-siliguri-bn'
      : archetype.recommendedFontPairIds?.[0] || 'inter-neutral';

  const seed1 = archetype.seedColors[0]?.hex || '#2563eb';
  const seed2 = archetype.seedColors[1]?.hex || '#06b6d4';
  const seed3 = archetype.seedColors[2]?.hex || '#f59e0b';

  const screens: BriefScreen[] = (archetype.typicalSections.slice(0, 5) || []).map((sec, idx) => ({
    name: sec,
    purpose: `Displays and handles ${sec.toLowerCase()} interactions.`,
  }));

  if (screens.length === 0) {
    screens.push(
      { name: 'Main Workspace', purpose: 'Primary dashboard and user interactions.' },
      { name: 'Analytics & Detail', purpose: 'Deep dive into metrics and records.' },
      { name: 'Settings & Config', purpose: 'User preferences and workspace configuration.' }
    );
  }

  const features: BriefFeature[] = [
    {
      id: 'core-dashboard',
      title: 'Interactive Dashboard',
      description: 'Central operational view with high-signal stats and quick actions.',
      essential: true,
    },
    {
      id: 'data-management',
      title: 'Record Management & CRUD',
      description: 'Create, search, filter, and modify items with immediate local persistence.',
      essential: true,
    },
    {
      id: 'visual-insights',
      title: 'Metrics & Visual Feedback',
      description: 'Crisp cards and status indicators with accessible contrast.',
      essential: false,
    },
    {
      id: 'responsive-controls',
      title: 'Adaptive Layout & Modals',
      description: 'Clean responsive drawer, filters, and keyboard shortcuts.',
      essential: false,
    },
  ];

  return {
    appType: archetype.name,
    audience: 'Professionals and modern web users seeking an intuitive workflow',
    coreProblem: idea.trim() || 'Providing a fast, elegant, and persistent web application interface',
    vibeWords: ['focused', 'responsive', 'tactile', 'modern'],
    tone: 'Crisp, confident, and direct',
    copyLanguage: lang,
    screens,
    features,
    contentNotes: 'Use realistic business data, realistic numbers, and meaningful action labels.',
    directionName: `${archetype.name} Direction`,
    recommended: {
      presetId: archetype.recommendedPresetId,
      fontPairId: fontId,
      mode: 'both',
      defaultMode: archetype.defaultMode || 'dark',
      density: preset.densityDefault || 'comfortable',
      radius: preset.radius || 'soft',
      motion: archetype.defaultMotion || 'subtle',
      paletteSeeds: [seed1, seed2, seed3],
    },
    risks: [
      'Overcomplicating the initial navigation structure before core data is visible',
      'Using unstyled default browser alert dialogs instead of in-page toasts',
    ],
  };
}

/**
 * Validates a single 6-digit hex color string.
 */
function isValidHex(hex: unknown): hex is string {
  if (typeof hex !== 'string') return false;
  const clean = hex.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean);
}

/**
 * Sanitizes and parses raw text from LLM into a verified IdeaBrief.
 */
export function parseBriefJson(
  rawText: string,
  fallbackIdea: string,
  languageHint?: DesignLanguage
): BriefParseResult {
  const fallback = buildDeterministicBrief(fallbackIdea, languageHint);
  const usedFallbackFields: string[] = [];

  if (!rawText || typeof rawText !== 'string') {
    return { brief: fallback, usedFallbackFields: ['all'] };
  }

  // 1. Strip markdown code fences if present
  let clean = rawText.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');

  // 2. Extract outermost JSON object if surrounded by preamble or postscript
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }

  // 3. Repair common trailing commas
  clean = clean.replace(/,\s*([}\]])/g, '$1');

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    // If parse failed, try relaxing unescaped control chars
    try {
      const sanitized = clean.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
      parsed = JSON.parse(sanitized);
    } catch {
      return { brief: fallback, usedFallbackFields: ['all_syntax_error'] };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { brief: fallback, usedFallbackFields: ['all_invalid_structure'] };
  }

  // 4. Validate and assemble each field
  const appType =
    typeof parsed.appType === 'string' && parsed.appType.trim().length > 0
      ? parsed.appType.trim()
      : (usedFallbackFields.push('appType'), fallback.appType);

  const audience =
    typeof parsed.audience === 'string' && parsed.audience.trim().length > 0
      ? parsed.audience.trim()
      : (usedFallbackFields.push('audience'), fallback.audience);

  const coreProblem =
    typeof parsed.coreProblem === 'string' && parsed.coreProblem.trim().length > 0
      ? parsed.coreProblem.trim()
      : (usedFallbackFields.push('coreProblem'), fallback.coreProblem);

  let vibeWords: string[] = [];
  if (Array.isArray(parsed.vibeWords) && parsed.vibeWords.length > 0) {
    vibeWords = parsed.vibeWords
      .filter((w: unknown) => typeof w === 'string' && w.trim().length > 0)
      .map((w: string) => w.trim().toLowerCase())
      .slice(0, 5);
  }
  if (vibeWords.length < 3) {
    usedFallbackFields.push('vibeWords');
    vibeWords = fallback.vibeWords;
  }

  const tone =
    typeof parsed.tone === 'string' && parsed.tone.trim().length > 0
      ? parsed.tone.trim()
      : (usedFallbackFields.push('tone'), fallback.tone);

  const copyLanguage: DesignLanguage =
    parsed.copyLanguage === 'bn' || parsed.copyLanguage === 'en'
      ? parsed.copyLanguage
      : (usedFallbackFields.push('copyLanguage'), fallback.copyLanguage);

  let screens: BriefScreen[] = [];
  if (Array.isArray(parsed.screens) && parsed.screens.length > 0) {
    screens = parsed.screens
      .filter(
        (s: any) =>
          s &&
          typeof s === 'object' &&
          typeof s.name === 'string' &&
          s.name.trim().length > 0
      )
      .map((s: any) => ({
        name: s.name.trim(),
        purpose:
          typeof s.purpose === 'string' && s.purpose.trim().length > 0
            ? s.purpose.trim()
            : 'Primary view and workflow for ' + s.name.trim(),
      }))
      .slice(0, 8);
  }
  if (screens.length < 3) {
    usedFallbackFields.push('screens');
    screens = fallback.screens;
  }

  let features: BriefFeature[] = [];
  if (Array.isArray(parsed.features) && parsed.features.length > 0) {
    features = parsed.features
      .filter(
        (f: any) =>
          f &&
          typeof f === 'object' &&
          typeof f.title === 'string' &&
          f.title.trim().length > 0
      )
      .map((f: any, idx: number) => {
        const title = f.title.trim();
        const id =
          typeof f.id === 'string' && f.id.trim().length > 0
            ? f.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
            : `feat-${idx + 1}`;
        return {
          id,
          title,
          description:
            typeof f.description === 'string' && f.description.trim().length > 0
              ? f.description.trim()
              : `${title} functionality and UI controls.`,
          essential: Boolean(f.essential),
        };
      })
      .slice(0, 10);
  }
  if (features.length < 4) {
    usedFallbackFields.push('features');
    features = fallback.features;
  } else {
    // Ensure at least one feature is marked essential
    if (!features.some((f) => f.essential)) {
      features[0].essential = true;
    }
  }

  const contentNotes =
    typeof parsed.contentNotes === 'string' && parsed.contentNotes.trim().length > 0
      ? parsed.contentNotes.trim()
      : (usedFallbackFields.push('contentNotes'), fallback.contentNotes);

  const directionName =
    typeof parsed.directionName === 'string' && parsed.directionName.trim().length > 0
      ? parsed.directionName.trim()
      : (usedFallbackFields.push('directionName'), fallback.directionName);

  // Validate recommended design controls
  const rawRec = parsed.recommended || {};

  const presetId =
    typeof rawRec.presetId === 'string' && STYLE_PRESETS[rawRec.presetId]
      ? rawRec.presetId
      : (usedFallbackFields.push('recommended.presetId'), fallback.recommended.presetId);

  let fontPairId =
    typeof rawRec.fontPairId === 'string' && FONT_PAIRS[rawRec.fontPairId]
      ? rawRec.fontPairId
      : (usedFallbackFields.push('recommended.fontPairId'), fallback.recommended.fontPairId);

  // Ensure font pair matches copyLanguage
  const fontPair = FONT_PAIRS[fontPairId];
  if (copyLanguage === 'bn' && (!fontPair || !fontPair.supports.includes('bengali'))) {
    fontPairId = 'hind-siliguri-bn';
    usedFallbackFields.push('recommended.fontPairId(bengali_match)');
  }

  const mode: DesignMode =
    rawRec.mode === 'dark' || rawRec.mode === 'light' || rawRec.mode === 'both'
      ? rawRec.mode
      : (usedFallbackFields.push('recommended.mode'), fallback.recommended.mode);

  const defaultMode: 'dark' | 'light' =
    rawRec.defaultMode === 'dark' || rawRec.defaultMode === 'light'
      ? rawRec.defaultMode
      : (usedFallbackFields.push('recommended.defaultMode'), fallback.recommended.defaultMode);

  const density: DesignDensity =
    rawRec.density === 'compact' ||
    rawRec.density === 'comfortable' ||
    rawRec.density === 'spacious'
      ? rawRec.density
      : (usedFallbackFields.push('recommended.density'), fallback.recommended.density);

  const radius: DesignRadius =
    rawRec.radius === 'sharp' || rawRec.radius === 'soft' || rawRec.radius === 'round'
      ? rawRec.radius
      : (usedFallbackFields.push('recommended.radius'), fallback.recommended.radius);

  const motion: DesignMotion =
    rawRec.motion === 'none' || rawRec.motion === 'subtle' || rawRec.motion === 'rich'
      ? rawRec.motion
      : (usedFallbackFields.push('recommended.motion'), fallback.recommended.motion);

  // Validate 3 distinct palette seeds and test contrast
  let paletteSeeds: [string, string, string] = [...fallback.recommended.paletteSeeds];
  if (
    Array.isArray(rawRec.paletteSeeds) &&
    rawRec.paletteSeeds.length >= 3 &&
    rawRec.paletteSeeds.slice(0, 3).every(isValidHex)
  ) {
    const rawSeeds = rawRec.paletteSeeds.slice(0, 3).map((s: string) => s.trim().toLowerCase());
    // Ensure seeds are distinct
    const unique: string[] = Array.from(new Set<string>(rawSeeds));
    if (unique.length === 3 && unique[0] && unique[1] && unique[2]) {
      // Test primary seed contrast
      try {
        const testPalette = generatePalette(unique[0], defaultMode);
        const ratio = contrastRatio(testPalette.primary, testPalette.surface);
        if (ratio >= 2.5) {
          paletteSeeds = [unique[0], unique[1], unique[2]];
        } else {
          usedFallbackFields.push('recommended.paletteSeeds(contrast_low)');
        }
      } catch {
        usedFallbackFields.push('recommended.paletteSeeds(generation_error)');
      }
    } else {
      usedFallbackFields.push('recommended.paletteSeeds(duplicates)');
    }
  } else {
    usedFallbackFields.push('recommended.paletteSeeds');
  }

  let risks: string[] = [];
  if (Array.isArray(parsed.risks) && parsed.risks.length > 0) {
    risks = parsed.risks
      .filter((r: unknown) => typeof r === 'string' && r.trim().length > 0)
      .map((r: string) => r.trim())
      .slice(0, 3);
  }
  if (risks.length === 0) {
    usedFallbackFields.push('risks');
    risks = fallback.risks;
  }

  const validatedBrief: IdeaBrief = {
    appType,
    audience,
    coreProblem,
    vibeWords,
    tone,
    copyLanguage,
    screens,
    features,
    contentNotes,
    directionName,
    recommended: {
      presetId,
      fontPairId,
      mode,
      defaultMode,
      density,
      radius,
      motion,
      paletteSeeds,
    },
    risks,
  };

  return {
    brief: validatedBrief,
    usedFallbackFields,
  };
}
