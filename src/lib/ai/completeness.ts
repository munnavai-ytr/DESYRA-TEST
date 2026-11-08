/**
 * DESYRA AI Completeness Checker & Continue Message Builder
 * Fix Push 6.3: Detects incomplete builds, unterminated writes, missing references,
 * and builds targeted continuation requests.
 */

import {
  isIgnoredReference,
  resolveRelativePath,
  findSimilarFile,
} from '@/lib/preview/buildPreview';
import type { CompletenessIssue } from '@/lib/db';
import type { StreamFinishReason } from './types';

export interface MissingReference {
  targetPath: string;
  sourceFile: string;
  similarFileHint?: string;
}

/**
 * Scans HTML markup for referenced assets and scripts, masking non-markup regions
 * (comments, inline scripts, inline styles, textareas, titles) so that template
 * strings inside JS (e.g. `<img src="${cs.image}">`) are not treated as real references.
 */
function scanHtmlReferences(
  htmlContent: string,
  filePath: string,
  addReference: (ref: string) => void
): void {
  // Tokenize non-markup regions into placeholders
  const placeholders: string[] = [];
  let masked = htmlContent.replace(/<!--[\s\S]*?-->/gi, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `\u0000MASK_${idx}\u0000`;
  });

  // Extract inline module scripts to scan their relative imports separately
  masked = masked.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi,
    (fullTag, attrs, inline) => {
      const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (srcMatch) {
        addReference(srcMatch[1].trim());
      }
      const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
      if (isModule && inline.trim()) {
        scanJsReferences(inline, filePath, addReference);
      }
      const idx = placeholders.length;
      placeholders.push(fullTag);
      return `\u0000MASK_${idx}\u0000`;
    }
  );

  // Mask styles, textareas, titles
  masked = masked.replace(/<style\b[^>]*?>[\s\S]*?<\/style>/gi, (match) => {
    // Scan CSS inside inline style tag
    const inner = match.replace(/^<style\b[^>]*?>/i, '').replace(/<\/style>$/i, '');
    scanCssReferences(inner, filePath, addReference);
    const idx = placeholders.length;
    placeholders.push(match);
    return `\u0000MASK_${idx}\u0000`;
  });

  masked = masked.replace(/<textarea\b[^>]*?>[\s\S]*?<\/textarea>/gi, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `\u0000MASK_${idx}\u0000`;
  });

  masked = masked.replace(/<title\b[^>]*?>[\s\S]*?<\/title>/gi, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `\u0000MASK_${idx}\u0000`;
  });

  // Now scan remaining real HTML tags for src and href
  const linkRegex = /<link\b([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(masked)) !== null) {
    const attrs = match[1];
    const isStylesheet = /\brel\s*=\s*(?:["']stylesheet["']|stylesheet\b)/i.test(attrs);
    const isIcon = /\brel\s*=\s*(?:["'](?:shortcut\s+)?icon["']|icon\b)/i.test(attrs);
    if (isStylesheet || isIcon) {
      const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (hrefMatch) {
        addReference(hrefMatch[1].trim());
      }
    }
  }

  // Scan img, source, video, audio
  const mediaRegex = /<(?:img|source|video|audio)\b([^>]*?)>/gi;
  while ((match = mediaRegex.exec(masked)) !== null) {
    const attrs = match[1];
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (srcMatch) {
      addReference(srcMatch[1].trim());
    }
  }
}

/**
 * Scans CSS code for @import and url(...) references.
 */
function scanCssReferences(
  cssContent: string,
  filePath: string,
  addReference: (ref: string) => void
): void {
  // Mask CSS comments /* ... */
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. @import "..." or @import url(...)
  const importRegex = /@import\s+(?:url\(\s*)?['"]?([^'"()]+)['"]?\s*\)?/gi;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(cleanCss)) !== null) {
    addReference(match[1].trim());
  }

  // 2. url(...)
  const urlRegex = /url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi;
  while ((match = urlRegex.exec(cleanCss)) !== null) {
    addReference(match[2].trim());
  }
}

/**
 * Scans JavaScript / ES Module code for relative import and export-from specifiers.
 */
function scanJsReferences(
  jsContent: string,
  filePath: string,
  addReference: (ref: string) => void
): void {
  // Mask single-line and multi-line comments
  const cleanJs = jsContent
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\])\/\/.*$/gm, '$1');

  // Static imports and exports: import ... from './...' or export ... from './...'
  const staticRegex = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = staticRegex.exec(cleanJs)) !== null) {
    addReference(match[1].trim());
  }

  // Dynamic import: import('./...')
  const dynamicRegex = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(cleanJs)) !== null) {
    addReference(match[1].trim());
  }
}

/**
 * Scans project files for missing local referenced files.
 * Reuses reference rules: ignores http(s), data:, blob:, #, mailto:, tel:, protocol-relative (//),
 * and template strings (${...}).
 */
export function findMissingReferences(
  files: Array<{ path: string; content: string }>
): MissingReference[] {
  const missingMap = new Map<string, MissingReference>();
  const filePathsSet = new Set(files.map((f) => f.path));

  for (const file of files) {
    const rawRefs: string[] = [];
    const addRaw = (ref: string) => {
      if (!isIgnoredReference(ref)) {
        rawRefs.push(ref);
      }
    };

    const lowerPath = file.path.toLowerCase();
    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
      scanHtmlReferences(file.content, file.path, addRaw);
    } else if (lowerPath.endsWith('.css')) {
      scanCssReferences(file.content, file.path, addRaw);
    } else if (
      lowerPath.endsWith('.js') ||
      lowerPath.endsWith('.mjs') ||
      lowerPath.endsWith('.cjs')
    ) {
      scanJsReferences(file.content, file.path, addRaw);
    }

    for (const raw of rawRefs) {
      let resolved = resolveRelativePath(file.path, raw);
      if (!resolved) continue;

      // In JS modules, if extension was omitted, try candidate extensions (.js, .mjs, .json)
      if (
        (lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs')) &&
        !resolved.endsWith('.js') &&
        !resolved.endsWith('.mjs') &&
        !resolved.endsWith('.json')
      ) {
        if (filePathsSet.has(`${resolved}.js`)) {
          resolved = `${resolved}.js`;
        } else if (filePathsSet.has(`${resolved}.mjs`)) {
          resolved = `${resolved}.mjs`;
        } else if (filePathsSet.has(`${resolved}.json`)) {
          resolved = `${resolved}.json`;
        }
      }

      if (!filePathsSet.has(resolved)) {
        // Missing! Check for similar-name hint
        if (!missingMap.has(resolved)) {
          const similar = findSimilarFile(files, resolved);
          missingMap.set(resolved, {
            targetPath: resolved,
            sourceFile: file.path,
            similarFileHint: similar?.path,
          });
        }
      }
    }
  }

  return Array.from(missingMap.values());
}

export interface CheckCompletenessParams {
  operations?: Array<{
    path: string;
    op: 'file' | 'edit' | 'delete';
    status: string;
    lineCount?: number;
  }>;
  incompleteFiles?: string[];
  finishReason?: StreamFinishReason;
  projectFiles: Array<{ path: string; content: string }>;
}

/**
 * Pure completeness check called after an assistant turn completes.
 */
export function checkCompleteness(params: CheckCompletenessParams): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  // 1. Truncated detection
  if (params.finishReason === 'length' || params.finishReason === 'interrupted') {
    issues.push({
      type: 'truncated',
      details:
        params.finishReason === 'length'
          ? 'Output limit reached'
          : 'Connection ended early',
    });
  }

  // 2. Incomplete files (unterminated writes)
  const incompleteSet = new Set<string>();
  if (params.incompleteFiles) {
    for (const f of params.incompleteFiles) {
      incompleteSet.add(f);
    }
  }
  if (params.operations) {
    for (const op of params.operations) {
      if (op.status === 'writing' && op.path) {
        incompleteSet.add(op.path);
      }
    }
  }

  for (const path of incompleteSet) {
    issues.push({
      type: 'incomplete_file',
      path,
      details: 'File write was cut off before completion',
    });
  }

  // 3. Missing referenced files
  const missingRefs = findMissingReferences(params.projectFiles);
  for (const miss of missingRefs) {
    issues.push({
      type: 'missing_reference',
      path: miss.targetPath,
      sourceFile: miss.sourceFile,
      similarFileHint: miss.similarFileHint,
      details: `Referenced in ${miss.sourceFile}`,
    });
  }

  return issues;
}

/**
 * Builds a clear, structured continuation message for the AI model.
 */
export function buildContinueMessage(
  issues: CompletenessIssue[],
  projectFiles: Array<{ path: string }>
): string {
  const incompletePaths = Array.from(
    new Set(
      issues
        .filter((i) => i.type === 'incomplete_file' && Boolean(i.path))
        .map((i) => i.path!)
    )
  );

  const missingPaths = Array.from(
    new Set(
      issues
        .filter((i) => i.type === 'missing_reference' && Boolean(i.path))
        .map((i) => i.path!)
    )
  );

  const incompleteSet = new Set(incompletePaths);
  const existingFilesList =
    projectFiles
      .map((f) => f.path)
      .filter((p) => !incompleteSet.has(p))
      .join(', ') || '(none)';

  const header = 'Your previous answer was incomplete. Continue the build now.';

  // If truncated without specific incomplete or missing file issues
  if (incompletePaths.length === 0 && missingPaths.length === 0) {
    return [
      header,
      'Continue exactly where you stopped and finish the remaining files.',
      `Do not repeat files that are already complete. Existing files: ${existingFilesList}.`,
      'Keep each file under about 250 lines; split large logic into smaller modules.',
      'End with a short Markdown summary only.',
    ].join('\n');
  }

  const numberedInstructions: string[] = [];

  if (incompletePaths.length > 0) {
    numberedInstructions.push(
      `Re-send each incomplete file COMPLETELY with <desyra-file> (never partial or 'rest of file' placeholders): ${incompletePaths.join(', ')}.`
    );
  }

  if (missingPaths.length > 0) {
    numberedInstructions.push(
      `Create these missing files that are referenced but do not exist: ${missingPaths.join(', ')}.`
    );
  }

  numberedInstructions.push(
    `Do not repeat files that are already complete. Existing files: ${existingFilesList}.`
  );
  numberedInstructions.push(
    `Keep each file under about 250 lines; split large logic into smaller modules.`
  );
  numberedInstructions.push(`End with a short Markdown summary only.`);

  const formattedNumbered = numberedInstructions
    .map((inst, idx) => `${idx + 1}) ${inst}`)
    .join('\n');

  return `${header}\n${formattedNumbered}`;
}
