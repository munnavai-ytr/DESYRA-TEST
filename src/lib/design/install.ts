/**
 * DESYRA Design System Installer
 * Generates and installs managed CSS files into IndexedDB projects.
 */

import type {
  DesignSpec,
  ProjectDesignData,
} from './types';
import { generateTokensCss } from './css/generateTokensCss';
import { generateBaseCss } from './css/generateBaseCss';
import { generateComponentsCss } from './css/generateComponentsCss';
import { getFile, createFile, updateFileContent } from '@/lib/files';
import { updateProject, getDb } from '@/lib/db';
import { classifyIdea } from './classify';
import { ARCHETYPES } from './archetypes';
import { STYLE_PRESETS } from './presets';
import { FONT_PAIRS } from './fonts';
import { aiFileStore } from '@/lib/ai/aiFileStore';

export const MANAGED_DESIGN_FILES = [
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
];

/**
 * Calculates a simple string hash for file contents.
 */
export function computeStringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export type { ProjectDesignData };

/**
 * Constructs a initial DesignSpec for a project prompt.
 */
export function createSpecFromClassification(
  promptText: string,
  overrides?: Partial<DesignSpec>
): DesignSpec {
  const classification = classifyIdea(promptText);
  const archetype = ARCHETYPES[classification.archetypeId] || ARCHETYPES['general'];
  const preset = STYLE_PRESETS[archetype.recommendedPresetId] || STYLE_PRESETS['minimal'];

  const isBn = classification.language === 'bn';
  const fontPairId = isBn
    ? archetype.recommendedFontPairIdsBn[0] || 'hind-siliguri-bn'
    : archetype.recommendedFontPairIds[0] || 'inter-neutral';

  const seedHex = archetype.seedColors[0]?.hex || '#ff6b1a';

  const spec: DesignSpec = {
    archetypeId: archetype.id,
    presetId: preset.id,
    seedHex,
    mode: 'both',
    defaultMode: archetype.defaultMode,
    radius: preset.radius,
    density: preset.densityDefault,
    fontPairId,
    language: classification.language,
    motion: archetype.defaultMotion,
    tokens: {
      mode: archetype.defaultMode,
      palette: undefined as unknown as DesignSpec['tokens']['palette'], // Generated during token css build
      fontDisplay: FONT_PAIRS[fontPairId]?.displayFamily || 'Inter',
      fontBody: FONT_PAIRS[fontPairId]?.bodyFamily || 'Inter',
      fontMono: 'JetBrains Mono',
      googleFontsHref: FONT_PAIRS[fontPairId]?.googleFontsHref || '',
      typeScaleRatio: preset.typeScaleRatio,
      radius: { sm: '6px', md: '10px', lg: '16px', full: '9999px' },
      shadows: { sm: 'none', md: 'none', lg: 'none' },
      borderWidth: preset.borderWidth,
      densityPadding: { section: '3.5rem 1.5rem', card: '1.25rem 1.5rem', button: '0.55rem 1.25rem' },
      motion: { fast: '100ms', base: '200ms', slow: '350ms', ease: 'ease' },
      containerWidth: '1240px',
      buttonStyle: preset.buttonStyle,
      cardStyle: preset.cardStyle,
    },
    createdAt: Date.now(),
    ...overrides,
  };

  return spec;
}

/**
 * Checks whether any managed design files were edited since last design system update.
 */
export async function checkManagedFilesHashes(
  projectId: string,
  storedHashes?: Record<string, string>
): Promise<{ modified: boolean; modifiedFiles: string[] }> {
  if (!storedHashes) {
    return { modified: false, modifiedFiles: [] };
  }

  const modifiedFiles: string[] = [];

  for (const path of MANAGED_DESIGN_FILES) {
    const file = await getFile(projectId, path);
    if (file) {
      const currentHash = computeStringHash(file.content);
      const expectedHash = storedHashes[path];
      if (expectedHash && currentHash !== expectedHash) {
        modifiedFiles.push(path);
      }
    }
  }

  return {
    modified: modifiedFiles.length > 0,
    modifiedFiles,
  };
}

/**
 * Installs or updates the Design System managed CSS files in IndexedDB for a project.
 */
export async function installDesignSystem(
  projectId: string,
  spec: DesignSpec,
  options?: { overwrite?: boolean }
): Promise<ProjectDesignData> {
  const tokensCss = generateTokensCss(spec);
  const baseCss = generateBaseCss(spec);
  const componentsCss = generateComponentsCss(spec);

  const fileContents: Record<string, string> = {
    'css/tokens.css': tokensCss,
    'css/base.css': baseCss,
    'css/components.css': componentsCss,
  };

  const managedHashes: Record<string, string> = {};

  for (const path of MANAGED_DESIGN_FILES) {
    const content = fileContents[path];
    managedHashes[path] = computeStringHash(content);

    const existing = await getFile(projectId, path);
    if (existing) {
      await updateFileContent(projectId, path, content);
    } else {
      await createFile(projectId, path, content);
    }
  }

  const designData: ProjectDesignData = {
    spec,
    managedFiles: MANAGED_DESIGN_FILES,
    managedHashes,
    updatedAt: Date.now(),
  };

  await updateProject(projectId, { design: designData });
  aiFileStore.bumpRevision(projectId);

  return designData;
}

/**
 * Normalizes a stored project design field (which might be DesignSpec or ProjectDesignData)
 * into a valid DesignSpec.
 */
export function extractDesignSpec(design: unknown): DesignSpec | null {
  if (!design || typeof design !== 'object') return null;
  const candidate = design as Partial<DesignSpec & ProjectDesignData>;
  if (candidate.archetypeId && candidate.tokens) {
    return candidate as DesignSpec;
  }
  if (candidate.spec && candidate.spec.archetypeId && candidate.spec.tokens) {
    return candidate.spec;
  }
  return null;
}

/**
 * Ensures a project has a valid DesignSpec installed and saved.
 * Guarantees execution order:
 * 1. create spec
 * 2. await installDesignSystem (writes managed CSS files to storage)
 * 3. await updateProject (saves design spec to DB)
 * 4. returns the resolved spec
 */
export async function ensureProjectDesign(
  projectId: string,
  promptOrIdea: string,
  existingDesign?: DesignSpec | null
): Promise<{ spec: DesignSpec; isNewlyCreated: boolean }> {
  const current = extractDesignSpec(existingDesign);
  if (current) {
    return { spec: current, isNewlyCreated: false };
  }

  // Check database
  const db = getDb();
  if (db) {
    const project = await db.projects.get(projectId);
    const dbSpec = extractDesignSpec(project?.design);
    if (dbSpec) {
      return { spec: dbSpec, isNewlyCreated: false };
    }
  }

  // Create, install, and save in strict sequence
  const spec = createSpecFromClassification(promptOrIdea);
  await installDesignSystem(projectId, spec, { overwrite: true });
  await updateProject(projectId, { design: spec });

  return { spec, isNewlyCreated: true };
}
