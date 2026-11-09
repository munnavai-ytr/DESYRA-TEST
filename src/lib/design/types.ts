/**
 * DESYRA Design System Types
 * Core data structures for tokens, presets, archetypes, specs, and linter results.
 */

export type DesignMode = 'dark' | 'light' | 'both';
export type DesignRadius = 'sharp' | 'soft' | 'round';
export type DesignDensity = 'compact' | 'comfortable' | 'spacious';
export type DesignMotion = 'none' | 'subtle' | 'rich';
export type DesignLanguage = 'en' | 'bn';

export interface ColorPalette {
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  text: string;
  muted: string;
  subtle: string;
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primarySoft: string;
  onPrimary: string;
  accent: string;
  link: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface DesignTokens {
  mode: 'dark' | 'light';
  palette: ColorPalette;
  darkPalette?: ColorPalette; // Used when mode === 'both'
  lightPalette?: ColorPalette; // Used when mode === 'both'
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  googleFontsHref: string;
  typeScaleRatio: number;
  radius: { sm: string; md: string; lg: string; full: string };
  shadows: { sm: string; md: string; lg: string };
  borderWidth: string;
  densityPadding: { section: string; card: string; button: string };
  motion: { fast: string; base: string; slow: string; ease: string };
  containerWidth: string;
  buttonStyle: 'solid' | 'outline' | 'pill';
  cardStyle: 'bordered' | 'elevated' | 'flat';
}

export interface DesignSpec {
  archetypeId: string;
  presetId: string;
  seedHex: string;
  mode: DesignMode;
  defaultMode: 'dark' | 'light';
  radius: DesignRadius;
  density: DesignDensity;
  fontPairId: string;
  language: DesignLanguage;
  motion: DesignMotion;
  tokens: DesignTokens;
  createdAt: number;
}

export interface FontPair {
  id: string;
  name: string;
  displayFamily: string;
  bodyFamily: string;
  monoFamily: string;
  weights: number[];
  googleFontsHref: string;
  supports: ('latin' | 'bengali')[];
  moodTags: string[];
}

export interface StylePreset {
  id: string;
  name: string;
  personality: string;
  radius: DesignRadius;
  borderWidth: string;
  shadowStyle: 'none' | 'subtle' | 'layered';
  typeScaleRatio: number;
  headingWeight: number;
  headingLetterSpacing: string;
  densityDefault: DesignDensity;
  motionDefault: DesignMotion;
  buttonStyle: 'solid' | 'outline' | 'pill';
  cardStyle: 'bordered' | 'elevated' | 'flat';
  accentRule: 'analogous' | 'complementary' | 'monochrome';
}

export interface ArchetypeSeedColor {
  hex: string;
  name: string;
}

export interface Archetype {
  id: string;
  name: string;
  keywordsEn: string[];
  keywordsBn: string[];
  typicalSections: string[];
  layoutPatterns: string[];
  signatureComponents: string[];
  recommendedPresetId: string;
  seedColors: ArchetypeSeedColor[];
  recommendedFontPairIds: string[];
  recommendedFontPairIdsBn: string[];
  defaultMode: 'dark' | 'light';
  defaultMotion: DesignMotion;
  imageryGuidance: string;
  copyGuidance: string;
  dos: string[];
  donts: string[];
}

export interface ClassificationResult {
  archetypeId: string;
  language: DesignLanguage;
  confidence: number; // 0 to 1
  alternatives: string[];
}

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintIssue {
  id: string;
  category: 'accessibility' | 'consistency' | 'responsiveness' | 'content';
  severity: LintSeverity;
  file: string;
  line?: number;
  message: string;
  fix: string;
}

export interface LintResult {
  score: number; // 0-100
  categories: {
    accessibility: number;
    consistency: number;
    responsiveness: number;
    content: number;
  };
  issues: LintIssue[];
}

export type DesignQuality = 'fast' | 'standard' | 'best';

export interface BriefScreen {
  name: string;
  purpose: string;
}

export interface BriefFeature {
  id: string;
  title: string;
  description: string;
  essential: boolean;
}

export interface BriefRecommendation {
  presetId: string;
  fontPairId: string;
  mode: DesignMode;
  defaultMode: 'dark' | 'light';
  density: DesignDensity;
  radius: DesignRadius;
  motion: DesignMotion;
  paletteSeeds: [string, string, string];
}

export interface IdeaBrief {
  appType: string;
  audience: string;
  coreProblem: string;
  vibeWords: string[];
  tone: string;
  copyLanguage: 'en' | 'bn';
  screens: BriefScreen[];
  features: BriefFeature[];
  contentNotes: string;
  directionName: string;
  recommended: BriefRecommendation;
  risks: string[];
}

export interface PlanSelections {
  presetId: string;
  fontPairId: string;
  mode: DesignMode;
  defaultMode: 'dark' | 'light';
  density: DesignDensity;
  radius: DesignRadius;
  motion: DesignMotion;
  primarySeed: string;
  accentSeed?: string;
  bgSeed?: string;
  selectedFeatureIds: string[];
  customFeatures: string[];
}

export interface ProjectPlan {
  brief: IdeaBrief;
  selections: PlanSelections;
  status: 'pending' | 'approved' | 'skipped';
  approvedAt?: number;
}

export interface CritiqueCodeEvidence {
  file: string;
  line?: number;
  snippet: string;
}

export interface CritiqueIssue {
  id: string;
  category: string;
  severity: 'high' | 'med' | 'low';
  title: string;
  description: string;
  codeEvidence?: CritiqueCodeEvidence;
  fixSuggestion: string;
}

export interface CritiqueRubric {
  antiGeneric: number;
  authenticity: number;
  hierarchy: number;
  contrast: number;
  density: number;
  motion: number;
  microInteractions: number;
  responsive: number;
}

export interface ProjectCritique {
  score: number;
  rubric: CritiqueRubric;
  summary: string;
  strengths: string[];
  issues: CritiqueIssue[];
  quickWins: string[];
  createdAt: number;
}

