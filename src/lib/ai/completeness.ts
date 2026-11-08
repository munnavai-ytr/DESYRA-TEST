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

import { MANAGED_DESIGN_FILES } from '@/lib/design/install';
import type { DesignSpec } from '@/lib/design/types';

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
  projectDesign?: DesignSpec | null;
}

/**
 * Pure completeness check called after an assistant turn completes.
 * Checks for truncated streams, incomplete files, missing referenced files,
 * and design system compliance when projectDesign is present.
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

  // 4. Design System Compliance Check (active only when projectDesign exists)
  if (params.projectDesign) {
    const spec = params.projectDesign;
    const fontHref = spec.tokens.googleFontsHref || 'https://fonts.googleapis.com';

    const htmlFiles = params.projectFiles.filter(
      (f) => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')
    );
    const cssFiles = params.projectFiles.filter((f) => f.path.toLowerCase().endsWith('.css'));

    // 4.1 HTML head links, Tailwind CDN, and emoji checks
    for (const file of htmlFiles) {
      const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(file.content);
      if (!headMatch) {
        issues.push({
          type: 'design_issue',
          path: file.path,
          details: 'Missing <head> section with design system links.',
        });
      } else {
        const headContent = headMatch[1];

        // Check required stylesheets in order:
        // Google Fonts -> css/tokens.css -> css/base.css -> css/components.css
        const idxFonts = headContent.indexOf('fonts.googleapis.com');
        const idxTokens = headContent.search(/\bhref\s*=\s*["'](?:\.\/|\/)?css\/tokens\.css["']/i);
        const idxBase = headContent.search(/\bhref\s*=\s*["'](?:\.\/|\/)?css\/base\.css["']/i);
        const idxComponents = headContent.search(/\bhref\s*=\s*["'](?:\.\/|\/)?css\/components\.css["']/i);

        const hasAllLinks = idxFonts !== -1 && idxTokens !== -1 && idxBase !== -1 && idxComponents !== -1;
        const isCorrectOrder = idxFonts < idxTokens && idxTokens < idxBase && idxBase < idxComponents;

        if (!hasAllLinks || !isCorrectOrder) {
          issues.push({
            type: 'design_issue',
            path: file.path,
            details:
              'Missing or out-of-order design system CSS links in <head>. Required in order: Google Fonts, css/tokens.css, css/base.css, css/components.css.',
          });
        }
      }

      // Flag external Tailwind CDN script
      if (
        file.content.includes('cdn.tailwindcss.com') ||
        file.content.includes('@tailwindcss/browser') ||
        /<script\b[^>]*\bsrc\s*=\s*["'][^"']*tailwind[^"']*["']/i.test(file.content)
      ) {
        issues.push({
          type: 'design_issue',
          path: file.path,
          details:
            'External Tailwind CDN script found while DESYRA Design System is active. Use DESYRA component classes instead.',
        });
      }

      // Flag emoji used as icons in buttons or navigation links
      if (
        /<(?:button|a|nav)\b[^>]*?>[\s\S]*?(?:[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[🚀⭐🔥💡🎉⚡✨])[\s\S]*?<\/(?:button|a|nav)>/u.test(
          file.content
        )
      ) {
        issues.push({
          type: 'design_issue',
          path: file.path,
          details: 'Emoji used as button or navigation icon. Use Lucide SVG icons instead.',
        });
      }

      // Flag hardcoded colors in inline styles
      if (/style\s*=\s*["'][^"']*(?:color|background)\s*:\s*(?:#(?:[0-9a-fA-F]{3,4}){1,2}\b|rgb|hsl)[^"']*["']/i.test(file.content)) {
        issues.push({
          type: 'design_issue',
          path: file.path,
          details: 'Inline style attribute contains hardcoded colors instead of design tokens.',
        });
      }
    }

    // 4.2 Non-managed CSS files hardcoded colors
    for (const file of cssFiles) {
      if (MANAGED_DESIGN_FILES.includes(file.path)) continue;

      const colorHexMatches = file.content.match(/#(?:[0-9a-fA-F]{3,4}){1,2}\b/g);
      const hardcoded = colorHexMatches
        ? colorHexMatches.filter((c) => !['#fff', '#ffffff', '#000', '#000000'].includes(c.toLowerCase()))
        : [];

      if (hardcoded.length > 0) {
        issues.push({
          type: 'design_issue',
          path: file.path,
          details: `Found ${hardcoded.length} hardcoded color hex values (e.g. ${hardcoded.slice(0, 3).join(', ')}). Use DESYRA CSS variables instead.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Builds a clear, structured continuation message for the AI model.
 */
export function buildContinueMessage(
  issues: CompletenessIssue[],
  projectFiles: Array<{ path: string }>,
  projectDesign?: DesignSpec | null
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

  const designIssues = issues.filter((i) => i.type === 'design_issue');

  const incompleteSet = new Set(incompletePaths);
  const existingFilesList =
    projectFiles
      .map((f) => f.path)
      .filter((p) => !incompleteSet.has(p))
      .join(', ') || '(none)';

  const header = 'Your previous answer was incomplete. Your previous build needs attention. Continue the build and fix the issues now.';

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

  if (designIssues.length > 0) {
    const fontsHref = projectDesign?.tokens?.googleFontsHref || 'https://fonts.googleapis.com';
    const linkTagsFullText = `<link rel="stylesheet" href="${fontsHref}">\n<link rel="stylesheet" href="css/tokens.css">\n<link rel="stylesheet" href="css/base.css">\n<link rel="stylesheet" href="css/components.css">`;

    numberedInstructions.push(
      `In every HTML page's <head>, you MUST include these exact link tags in this exact order:\n\`\`\`html\n${linkTagsFullText}\n\`\`\``
    );
    numberedInstructions.push(
      `Use <desyra-edit> blocks to update existing files instead of rewriting files from scratch.`
    );
    numberedInstructions.push(
      `Remove any Tailwind CDN or external framework scripts (e.g. cdn.tailwindcss.com). Replace all utility/Tailwind classes with DESYRA component classes (e.g. .btn, .card, .input, .badge, .navbar) and CSS variables from tokens.css.`
    );
    numberedInstructions.push(
      `Replace any emoji icons used in buttons, navigation, or UI controls with Lucide SVG icons (e.g. <i data-lucide="..."></i>).`
    );
    numberedInstructions.push(
      `Replace any hardcoded colors in custom CSS or inline styles with DESYRA CSS variables (e.g. var(--color-primary), var(--color-bg), var(--color-surface), var(--color-text)).`
    );
    numberedInstructions.push(
      `CRITICAL: Do NOT modify or recreate managed files (css/tokens.css, css/base.css, css/components.css); they are managed by the Design Engine.`
    );
  }

  // If truncated without specific incomplete, missing, or design issues
  if (incompletePaths.length === 0 && missingPaths.length === 0 && designIssues.length === 0) {
    return [
      header,
      'Continue exactly where you stopped and finish the remaining files.',
      `Do not repeat files that are already complete. Existing files: ${existingFilesList}.`,
      'Keep each file under about 250 lines; split large logic into smaller modules.',
      'End with a short Markdown summary only.',
    ].join('\n');
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
