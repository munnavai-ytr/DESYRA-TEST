/**
 * DESYRA Preview Builder
 * Pure, deterministic, testable module that compiles project files into a sandboxed HTML document.
 * Inlines local CSS, classic scripts, rewrites ES modules to blob: URLs, converts SVGs to data URIs,
 * injects Content-Security-Policy, and prepends the DESYRA sandbox runtime.
 * Preserves script defer/async semantics by relocating deferred scripts before </body>.
 */

import { generatePreviewRuntime } from './runtime';

export interface PreviewWarning {
  type:
    | 'missing_file'
    | 'circular_import'
    | 'case_mismatch'
    | 'csp_violation'
    | 'unsupported_stack'
    | 'parse_error';
  message: string;
  file?: string;
  line?: number;
}

export interface BuildPreviewOptions {
  nonce?: string;
  initialStorage?: Record<string, string>;
  baseUrl?: string;
}

export interface SourceMapEntry {
  path: string;
  startLine: number;
  endLine: number;
  type: 'script' | 'style';
}

export interface BuildPreviewSourceMap {
  entries: SourceMapEntry[];
  blobToPath: Record<string, string>;
}

export interface BuildPreviewResult {
  html: string;
  warnings: PreviewWarning[];
  usedFiles: string[];
  blobUrls: string[];
  sourceMap: BuildPreviewSourceMap;
  unsupported?: {
    isUnsupported: boolean;
    reason: string;
    detectedFiles: string[];
  };
}

export const PREVIEW_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; " +
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; " +
  "font-src https://fonts.gstatic.com data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
  "img-src data: blob: https:; " +
  "media-src data: blob: https:; " +
  "connect-src https:; " +
  "frame-src 'none'; " +
  "form-action 'none'; " +
  "base-uri 'none';";

/**
 * Checks whether a URL or attribute reference should be ignored for missing file warnings.
 */
export function isIgnoredReference(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('http:') ||
    lower.startsWith('https:') ||
    lower.startsWith('//') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('#') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('javascript:')
  ) {
    return true;
  }
  if (
    trimmed.includes('${') ||
    trimmed.includes('{{') ||
    trimmed.includes('{%') ||
    trimmed.includes('<%')
  ) {
    return true;
  }
  return false;
}

/**
 * Checks whether a project contains unsupported frameworks or configs (React/TSX/Vue/package.json).
 */
export function detectUnsupportedStack(files: Array<{ path: string }>): {
  isUnsupported: boolean;
  reason: string;
  detectedFiles: string[];
} {
  const detectedFiles: string[] = [];

  for (const f of files) {
    const p = f.path.toLowerCase();
    if (p === 'package.json') {
      detectedFiles.push(f.path);
    } else if (
      p.endsWith('.tsx') ||
      p.endsWith('.jsx') ||
      p.endsWith('.vue') ||
      p.endsWith('.svelte')
    ) {
      detectedFiles.push(f.path);
    } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) {
      // TypeScript files that need compilation
      detectedFiles.push(f.path);
    }
  }

  if (detectedFiles.length > 0) {
    const extSet = new Set(
      detectedFiles.map((f) => {
        const parts = f.split('.');
        return parts.length > 1 ? `.${parts.pop()}` : f;
      })
    );
    const extList = Array.from(extSet).join(', ');
    return {
      isUnsupported: true,
      reason: `This project uses ${extList}, which the free preview doesn't run yet.`,
      detectedFiles,
    };
  }

  return {
    isUnsupported: false,
    reason: '',
    detectedFiles: [],
  };
}

/**
 * Resolves a reference path relative to the directory of a base file path.
 * Handles './', '../', leading '/', query strings and hash anchors.
 */
export function resolveRelativePath(baseFilePath: string, reference: string): string {
  // Strip query string and hash
  const cleanRef = reference.split('?')[0].split('#')[0].trim();

  // If path starts with root '/', treat as relative to project root
  if (cleanRef.startsWith('/')) {
    return cleanRef.slice(1);
  }

  // Get base directory
  const baseParts = baseFilePath.split('/');
  baseParts.pop(); // remove filename

  const refParts = cleanRef.split('/');
  const resolvedParts = [...baseParts];

  for (const part of refParts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
    } else {
      resolvedParts.push(part);
    }
  }

  return resolvedParts.join('/');
}

/**
 * Detects if a referenced file path is missing but a clearly similar file exists in the project.
 */
export function findSimilarFile(
  files: Array<{ path: string; content: string }>,
  targetPath: string
): { path: string } | null {
  const cleanRef = targetPath.split('?')[0].split('#')[0].trim();
  const parts = cleanRef.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop()!.toLowerCase();
  const targetFilename = cleanRef.split('/').pop()!.toLowerCase();
  const targetStem = targetFilename.slice(0, targetFilename.length - ext.length - 1);

  // Find candidates with the same extension
  const candidates = files.filter((f) => {
    const fClean = f.path.trim();
    if (fClean === cleanRef) return false;
    const fParts = fClean.split('.');
    if (fParts.length < 2) return false;
    const fExt = fParts.pop()!.toLowerCase();
    return fExt === ext;
  });

  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const cFilename = candidate.path.split('/').pop()!.toLowerCase();
    const cStem = cFilename.slice(0, cFilename.length - ext.length - 1);

    if (
      (targetStem === 'styles' && cStem === 'style') ||
      (targetStem === 'style' && cStem === 'styles') ||
      (targetStem === 'scripts' && cStem === 'script') ||
      (targetStem === 'script' && cStem === 'scripts') ||
      (targetStem === 'app' && (cStem === 'script' || cStem === 'main' || cStem === 'index')) ||
      (targetStem === 'script' && (cStem === 'app' || cStem === 'main' || cStem === 'index'))
    ) {
      return candidate;
    }
    if (targetStem && cStem && (targetStem.includes(cStem) || cStem.includes(targetStem))) {
      return candidate;
    }
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
}

/**
 * Finds a file in the project by normalized path.
 * Checks exact match first, then case-insensitive match, then similar file warning.
 */
export function lookupFile(
  files: Array<{ path: string; content: string }>,
  targetPath: string,
  sourceFile: string,
  warnings: PreviewWarning[]
): { file: { path: string; content: string } | null; warning?: PreviewWarning } {
  if (isIgnoredReference(targetPath)) {
    return { file: null };
  }

  // 1. Exact match
  const exact = files.find((f) => f.path === targetPath);
  if (exact) {
    return { file: exact };
  }

  // 2. Case-insensitive fallback
  const lowerTarget = targetPath.toLowerCase();
  const caseInsensitive = files.find((f) => f.path.toLowerCase() === lowerTarget);
  if (caseInsensitive) {
    const warn: PreviewWarning = {
      type: 'case_mismatch',
      message: `Case mismatch: referenced "${targetPath}" resolved to "${caseInsensitive.path}" in ${sourceFile}`,
      file: sourceFile,
    };
    warnings.push(warn);
    return { file: caseInsensitive, warning: warn };
  }

  // 3. Similar file warning (e.g. styles.css vs style.css)
  const similar = findSimilarFile(files, targetPath);
  if (similar) {
    const warn: PreviewWarning = {
      type: 'missing_file',
      message: `${sourceFile} links to ${targetPath}, but only ${similar.path} exists`,
      file: sourceFile,
    };
    warnings.push(warn);
    return { file: null, warning: warn };
  }

  // 4. Missing file
  const warn: PreviewWarning = {
    type: 'missing_file',
    message: `File "${targetPath}" referenced from "${sourceFile}" was not found.`,
    file: sourceFile,
  };
  warnings.push(warn);
  return { file: null, warning: warn };
}

/**
 * Converts text asset (like SVG) to a data URI.
 */
export function fileToDataUri(path: string, content: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'svg') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
  }
  return `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
}

/**
 * Masks comments, template literals, and non-import string literals in JavaScript code,
 * leaving only static and dynamic import module specifiers unmasked so they can be rewritten.
 * Respects escape characters and ${ ... } expression nesting inside template literals.
 */
export function maskNonImportLiteralsAndComments(code: string): {
  maskedCode: string;
  restore: (text: string) => string;
} {
  const masks: string[] = [];
  let result = '';
  const len = code.length;
  let i = 0;

  // Helper to get last non-whitespace word or token before index `start`
  const getPrecedingToken = (start: number): string => {
    let p = start - 1;
    while (p >= 0 && /\s/.test(code[p])) {
      p--;
    }
    if (p < 0) return '';
    if (code[p] === '(') {
      let b = p - 1;
      while (b >= 0 && /\s/.test(code[b])) {
        b--;
      }
      let wordStart = b;
      while (wordStart >= 0 && /[a-zA-Z0-9_$]/.test(code[wordStart])) {
        wordStart--;
      }
      const word = code.slice(wordStart + 1, b + 1);
      if (word === 'import') {
        return 'import(';
      }
      return '(';
    }
    const end = p;
    while (p >= 0 && /[a-zA-Z0-9_$]/.test(code[p])) {
      p--;
    }
    return code.slice(p + 1, end + 1);
  };

  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : '';

    // 1. Single-line comment: // ...
    if (ch === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < len && code[i] !== '\n') {
        i++;
      }
      const comment = code.slice(start, i);
      const token = `__DESYRA_MASK_${masks.length}__`;
      masks.push(comment);
      result += token;
      continue;
    }

    // 2. Multi-line comment: /* ... */
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === '*' && i + 1 < len && code[i + 1] === '/')) {
        i++;
      }
      if (i < len) {
        i += 2; // consume */
      }
      const comment = code.slice(start, i);
      const token = `__DESYRA_MASK_${masks.length}__`;
      masks.push(comment);
      result += token;
      continue;
    }

    // 3. Template literal: `...`
    if (ch === '`') {
      const start = i;
      i++; // consume opening `
      let exprDepth = 0;
      while (i < len) {
        if (code[i] === '\\') {
          i += 2; // skip escape
          continue;
        }
        if (exprDepth === 0 && code[i] === '`') {
          i++; // consume closing `
          break;
        }
        if (code[i] === '$' && i + 1 < len && code[i + 1] === '{') {
          exprDepth++;
          i += 2;
          continue;
        }
        if (exprDepth > 0 && code[i] === '}') {
          exprDepth--;
          i++;
          continue;
        }
        i++;
      }
      const tpl = code.slice(start, i);
      const token = `__DESYRA_MASK_${masks.length}__`;
      masks.push(tpl);
      result += token;
      continue;
    }

    // 4. String literal: '...' or "..."
    if (ch === "'" || ch === '"') {
      const prevToken = getPrecedingToken(i);
      const isImportSpecifier =
        prevToken === 'from' || prevToken === 'import' || prevToken === 'import(';

      if (isImportSpecifier) {
        // Keep import specifiers unmasked so regexes can rewrite them
        const start = i;
        const quote = ch;
        i++; // consume opening quote
        while (i < len) {
          if (code[i] === '\\') {
            i += 2;
            continue;
          }
          if (code[i] === quote) {
            i++; // consume closing quote
            break;
          }
          i++;
        }
        result += code.slice(start, i);
        continue;
      }

      // Non-import string literal -> mask it!
      const start = i;
      const quote = ch;
      i++; // consume quote
      while (i < len) {
        if (code[i] === '\\') {
          i += 2; // skip escape
          continue;
        }
        if (code[i] === quote) {
          i++; // consume closing quote
          break;
        }
        i++;
      }
      const str = code.slice(start, i);
      const token = `__DESYRA_MASK_${masks.length}__`;
      masks.push(str);
      result += token;
      continue;
    }

    // Normal character
    result += ch;
    i++;
  }

  return {
    maskedCode: result,
    restore: (text: string) => {
      let restored = text;
      for (let idx = 0; idx < masks.length; idx++) {
        restored = restored.replace(`__DESYRA_MASK_${idx}__`, () => masks[idx]);
      }
      return restored;
    },
  };
}

/**
 * Rewrites relative and project imports/exports in JavaScript module code to virtual specifiers (@desyra/...).
 * Handles static import/export ... from, side-effect imports, and string-literal dynamic imports.
 * Leaves bare package specifiers and https:// imports untouched.
 * Only rewrites specifiers that resolve to an EXISTING project file; leaves missing targets untouched
 * and emits a clear warning so the console and completeness check report it.
 * Masks non-import strings, template literals, and comments to prevent false-positive rewrites.
 * Warns on dynamic import() with non-literal argument and on import.meta.url.
 */
export function rewriteModuleSpecifiers(
  jsCode: string,
  filePath: string,
  allFiles: Array<{ path: string; content: string }>,
  warnings: PreviewWarning[]
): string {
  // Warn on dynamic import with non-literal argument
  // e.g. import(foo) or import('prefix/' + bar)
  const nonLiteralDynamicRegex = /\bimport\s*\(\s*(?!['"`])([a-zA-Z0-9_$.+([\]\s]+)\)/g;
  let nonLitMatch: RegExpExecArray | null;
  while ((nonLitMatch = nonLiteralDynamicRegex.exec(jsCode)) !== null) {
    warnings.push({
      type: 'parse_error',
      message: `Dynamic import() with non-literal argument in "${filePath}" cannot be rewritten.`,
      file: filePath,
    });
  }

  // Warn on import.meta.url usage
  if (/\bimport\.meta\.url\b/.test(jsCode)) {
    warnings.push({
      type: 'parse_error',
      message: `import.meta.url used in "${filePath}". Note that modules run from blob: URLs in preview.`,
      file: filePath,
    });
  }

  const resolveToVirtual = (specifier: string): string => {
    const trimmed = specifier.trim();
    // Only rewrite relative or root-relative project paths
    if (!trimmed.startsWith('.') && !trimmed.startsWith('/')) {
      return specifier; // Bare specifier or external URL, leave untouched
    }

    let resolved = resolveRelativePath(filePath, trimmed);
    if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs') && !resolved.endsWith('.json')) {
      const candidates = [`${resolved}.js`, `${resolved}.mjs`, `${resolved}.json`];
      for (const cand of candidates) {
        if (allFiles.some((f) => f.path === cand)) {
          resolved = cand;
          break;
        }
      }
    }

    const cleanResolved = resolved.replace(/^\/+/, '');
    const exists = allFiles.some((f) => f.path === cleanResolved);

    if (!exists) {
      warnings.push({
        type: 'missing_file',
        message: `${filePath} imports '${trimmed}' but the file does not exist`,
        file: filePath,
      });
      return specifier; // Leave unchanged!
    }

    return `@desyra/${cleanResolved}`;
  };

  const { maskedCode, restore } = maskNonImportLiteralsAndComments(jsCode);
  let rewritten = maskedCode;

  // 1. Static imports / exports with from:
  // e.g. import { x } from './ui.js' or export * from './sub.js'
  rewritten = rewritten.replace(
    /((?:import|export)\s+(?:[\w*\s{},]*\s+from\s+))(['"])([^'"]+)\2/g,
    (full, prefix, quote, spec) => {
      const virtual = resolveToVirtual(spec);
      return `${prefix}${quote}${virtual}${quote}`;
    }
  );

  // 2. Side-effect imports:
  // e.g. import './setup.js' or import "./setup.js";
  rewritten = rewritten.replace(
    /(\bimport\s+)(['"])([^'"]+)\2(\s*;?)/g,
    (full, prefix, quote, spec, suffix) => {
      const virtual = resolveToVirtual(spec);
      return `${prefix}${quote}${virtual}${quote}${suffix}`;
    }
  );

  // 3. String-literal dynamic imports:
  // e.g. import('./sub.js') or import("./sub.js")
  rewritten = rewritten.replace(
    /(\bimport\s*\(\s*)(['"])([^'"]+)\2(\s*\))/g,
    (full, prefix, quote, spec, suffix) => {
      const virtual = resolveToVirtual(spec);
      return `${prefix}${quote}${virtual}${quote}${suffix}`;
    }
  );

  return restore(rewritten);
}

export interface ProcessModulesResult {
  moduleBlobMap: Map<string, string>;
  importMap: { imports: Record<string, string> };
  importMapJson: string;
}

/**
 * Rewrites each local ES module into virtual bare specifiers (@desyra/...)
 * and generates ONE blob URL per module mapped in a <script type="importmap">.
 * Resolves circular imports natively in the browser without dependency ordering.
 */
export function processModulesWithImportMap(
  files: Array<{ path: string; content: string }>,
  warnings: PreviewWarning[],
  createdBlobUrls: string[]
): ProcessModulesResult {
  const moduleBlobMap = new Map<string, string>();
  const importsRecord: Record<string, string> = {};

  const createBlobUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? (code: string) => URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
      : (code: string) => `blob:mock-url-${Math.random().toString(36).slice(2)}`;

  const jsFiles = files.filter(
    (f) =>
      f.path.endsWith('.js') ||
      f.path.endsWith('.mjs') ||
      f.path.endsWith('.cjs')
  );

  for (const jsFile of jsFiles) {
    const rewrittenCode = rewriteModuleSpecifiers(jsFile.content, jsFile.path, files, warnings);
    const blobUrl = createBlobUrl(rewrittenCode);
    createdBlobUrls.push(blobUrl);

    moduleBlobMap.set(jsFile.path, blobUrl);

    const cleanPath = jsFile.path.replace(/^\/+/, '');
    const virtualSpecifier = `@desyra/${cleanPath}`;
    importsRecord[virtualSpecifier] = blobUrl;
  }

  const importMap = { imports: importsRecord };
  const importMapJson = Object.keys(importsRecord).length > 0 ? JSON.stringify(importMap, null, 2) : '';

  return {
    moduleBlobMap,
    importMap,
    importMapJson,
  };
}

/**
 * Legacy wrapper: Rewrites ES Module relative import specifiers to blob URLs.
 */
export function processModulesToBlobUrls(
  files: Array<{ path: string; content: string }>,
  warnings: PreviewWarning[],
  createdBlobUrls: string[]
): Map<string, string> {
  const result = processModulesWithImportMap(files, warnings, createdBlobUrls);
  return result.moduleBlobMap;
}

/**
 * Builds a complete standalone, sandboxed HTML document from the project files.
 */
export function buildPreviewDocument(
  files: Array<{ path: string; content: string }>,
  entryPath: string = '',
  options: BuildPreviewOptions = {}
): BuildPreviewResult {
  const warnings: PreviewWarning[] = [];
  const usedFiles: string[] = [];
  const blobUrls: string[] = [];
  const nonce = options.nonce || `desyra_nonce_${Math.random().toString(36).slice(2, 10)}`;

  // 1. Check for unsupported frameworks/files (React, TSX, Vue, package.json)
  const unsupportedCheck = detectUnsupportedStack(files);
  if (unsupportedCheck.isUnsupported) {
    warnings.push({
      type: 'unsupported_stack',
      message: unsupportedCheck.reason,
    });
    return {
      html: '',
      warnings,
      usedFiles: [],
      blobUrls: [],
      sourceMap: { entries: [], blobToPath: {} },
      unsupported: unsupportedCheck,
    };
  }

  // 2. Resolve entry HTML file
  let entryFile: { path: string; content: string } | null = null;

  if (entryPath) {
    const cleanEntry = entryPath.startsWith('/') ? entryPath.slice(1) : entryPath;
    entryFile = files.find((f) => f.path === cleanEntry) || null;
  }

  if (!entryFile) {
    entryFile =
      files.find((f) => f.path === 'index.html' || f.path === './index.html') || null;
  }

  if (!entryFile) {
    const htmlFiles = files
      .filter((f) => f.path.endsWith('.html') || f.path.endsWith('.htm'))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (htmlFiles.length > 0) {
      entryFile = htmlFiles[0];
    }
  }

  if (!entryFile) {
    return {
      html: '',
      warnings,
      usedFiles: [],
      blobUrls: [],
      sourceMap: { entries: [], blobToPath: {} },
    };
  }

  usedFiles.push(entryFile.path);
  let documentHtml = entryFile.content;

  // 3. Process ES modules to blob URLs with import map
  const { moduleBlobMap, importMap, importMapJson } = processModulesWithImportMap(files, warnings, blobUrls);

  // 4. Tokenize non-markup regions into placeholders
  // Regions to protect: comments, <script>, <style>, <textarea>, <title>
  const placeholders: string[] = [];
  const createPlaceholder = (content: string): string => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\u0000DESYRA_${idx}\u0000`;
  };

  // Mask HTML comments <!-- ... -->
  documentHtml = documentHtml.replace(/<!--[\s\S]*?-->/gi, (match: string) =>
    createPlaceholder(match)
  );

  // Deferred scripts collection (classic scripts with defer attribute)
  // Preserves original relative order and moves them immediately before closing </body>
  const deferredScriptsToInsert: string[] = [];

  // Process and mask <script> elements
  documentHtml = documentHtml.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi,
    (fullTag: string, attrs: string, inlineContent: string) => {
      const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
      const hasDefer = /\bdefer\b/i.test(attrs);

      // A. Deferred classic script (both local and external)
      if (hasDefer && !isModule && srcMatch) {
        const src = srcMatch[1].trim();

        if (isIgnoredReference(src)) {
          // External deferred script (e.g. CDN) - strip defer and retain other attributes
          const cleanedAttrs = attrs
            .replace(/\bdefer\b(=["'][^"']*["'])?/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          const tag = `<script ${cleanedAttrs}>${inlineContent}</script>`;
          deferredScriptsToInsert.push(tag);
          return ''; // Removed from original spot in head/body
        }

        const resolved = resolveRelativePath(entryFile!.path, src);
        const found = lookupFile(files, resolved, entryFile!.path, warnings);

        if (found.file) {
          usedFiles.push(found.file.path);
          const safeJs = found.file.content.replace(/<\/script/gi, () => '<\\/script');
          const cleanedAttrs = attrs
            .replace(/\bdefer\b(=["'][^"']*["'])?/gi, '')
            .replace(/\bsrc\s*=\s*["'][^"']+["']/i, '')
            .replace(/\s+/g, ' ')
            .trim();
          const space = cleanedAttrs ? ' ' : '';
          const tag = `<script${space}${cleanedAttrs} data-src="${found.file.path}">\n${safeJs}\n</script>`;
          deferredScriptsToInsert.push(tag);
          return ''; // Removed from original spot
        }

        deferredScriptsToInsert.push(`<!-- Missing script: ${src} -->`);
        return '';
      }

      // B. Classic scripts without defer
      if (srcMatch) {
        const src = srcMatch[1].trim();
        if (isIgnoredReference(src)) {
          return createPlaceholder(fullTag);
        }

        const resolved = resolveRelativePath(entryFile!.path, src);

        if (isModule) {
          const blobUrl = moduleBlobMap.get(resolved);
          if (blobUrl) {
            usedFiles.push(resolved);
            const tag = `<script type="module" src="${blobUrl}" data-src="${resolved}"></script>`;
            return createPlaceholder(tag);
          } else {
            lookupFile(files, resolved, entryFile!.path, warnings);
            return createPlaceholder(`<!-- Missing module script: ${src} -->`);
          }
        } else {
          const found = lookupFile(files, resolved, entryFile!.path, warnings);
          if (found.file) {
            usedFiles.push(found.file.path);
            const safeJs = found.file.content.replace(/<\/script/gi, () => '<\\/script');
            const cleanedAttrs = attrs
              .replace(/\bsrc\s*=\s*["'][^"']+["']/i, '')
              .replace(/\s+/g, ' ')
              .trim();
            const space = cleanedAttrs ? ' ' : '';
            const tag = `<script${space}${cleanedAttrs} data-src="${found.file.path}">\n${safeJs}\n</script>`;
            return createPlaceholder(tag);
          }
          return createPlaceholder(`<!-- Missing script: ${src} -->`);
        }
      }

      // C. Inline module script
      if (isModule && inlineContent.trim()) {
        const rewritten = rewriteModuleSpecifiers(inlineContent, entryFile!.path, files, warnings);
        const safeInline = rewritten.replace(/<\/script/gi, () => '<\\/script');
        const tag = `<script${attrs ? ' ' + attrs : ''}>\n${safeInline}\n</script>`;
        return createPlaceholder(tag);
      }

      // D. Inline classic script (defer without src is ignored per browser spec)
      const safeInline = inlineContent.replace(/<\/script/gi, () => '<\\/script');
      const tag = `<script${attrs ? ' ' + attrs : ''}>${safeInline}</script>`;
      return createPlaceholder(tag);
    }
  );

  // Mask <style> elements
  documentHtml = documentHtml.replace(/<style\b[^>]*?>[\s\S]*?<\/style>/gi, (match: string) =>
    createPlaceholder(match)
  );

  // Mask <textarea> elements
  documentHtml = documentHtml.replace(/<textarea\b[^>]*?>[\s\S]*?<\/textarea>/gi, (match: string) =>
    createPlaceholder(match)
  );

  // Mask <title> elements
  documentHtml = documentHtml.replace(/<title\b[^>]*?>[\s\S]*?<\/title>/gi, (match: string) =>
    createPlaceholder(match)
  );

  // 5. Perform Link, Stylesheet, Image, and Asset Rewrites on Markup Only
  documentHtml = documentHtml.replace(
    /<link\b([^>]*?)>/gi,
    (fullTag: string, attrs: string) => {
      const isStylesheet = /\brel\s*=\s*(?:["']stylesheet["']|stylesheet\b)/i.test(attrs);
      if (!isStylesheet) {
        const isIcon = /\brel\s*=\s*(?:["'](?:shortcut\s+)?icon["']|icon\b)/i.test(attrs);
        const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
        if (isIcon && hrefMatch) {
          const href = hrefMatch[1].trim();
          if (!isIgnoredReference(href)) {
            const resolved = resolveRelativePath(entryFile!.path, href);
            const found = lookupFile(files, resolved, entryFile!.path, warnings);
            if (found.file) {
              usedFiles.push(found.file.path);
              const dataUri = fileToDataUri(found.file.path, found.file.content);
              return fullTag.replace(hrefMatch[0], () => `href="${dataUri}"`);
            }
          }
        }
        return fullTag;
      }

      const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!hrefMatch) return fullTag;

      const href = hrefMatch[1].trim();
      if (isIgnoredReference(href)) {
        return fullTag;
      }

      const resolved = resolveRelativePath(entryFile!.path, href);
      const found = lookupFile(files, resolved, entryFile!.path, warnings);

      if (found.file) {
        usedFiles.push(found.file.path);
        let cssContent = found.file.content;

        cssContent = cssContent.replace(
          /url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi,
          (urlMatch: string, q: string, assetRef: string) => {
            const trimmedRef = assetRef.trim();
            if (isIgnoredReference(trimmedRef)) {
              return urlMatch;
            }
            const resolvedAsset = resolveRelativePath(found.file!.path, trimmedRef);
            const assetFound = lookupFile(files, resolvedAsset, found.file!.path, warnings);
            if (assetFound.file) {
              usedFiles.push(assetFound.file.path);
              const uri = fileToDataUri(assetFound.file.path, assetFound.file.content);
              return `url("${uri}")`;
            }
            return urlMatch;
          }
        );

        const safeCss = cssContent.replace(/<\/style/gi, () => '<\\/style');
        return `<style data-src="${found.file.path}">\n${safeCss}\n</style>`;
      }

      return `<!-- Missing stylesheet: ${href} -->`;
    }
  );

  // Inline local images, source, video, audio assets
  documentHtml = documentHtml.replace(
    /<(img|source|video|audio)\b([^>]*?)>/gi,
    (fullTag: string, tag: string, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!srcMatch) return fullTag;

      const src = srcMatch[1].trim();
      if (isIgnoredReference(src)) {
        return fullTag;
      }

      const resolved = resolveRelativePath(entryFile!.path, src);
      const found = lookupFile(files, resolved, entryFile!.path, warnings);
      if (found.file) {
        usedFiles.push(found.file.path);
        const dataUri = fileToDataUri(found.file.path, found.file.content);
        return fullTag.replace(srcMatch[0], () => `src="${dataUri}"`);
      }

      return fullTag;
    }
  );

  // 6. Structure Normalization (doctype, <html>, <head>)
  let hasDoctype = /<!doctype\s+html/i.test(documentHtml);
  let hasHtmlTag = /<html\b/i.test(documentHtml);
  let hasHeadTag = /<head\b/i.test(documentHtml);

  if (!hasHtmlTag) {
    const prefix = hasDoctype ? '' : '<!DOCTYPE html>\n';
    documentHtml = `${prefix}<html lang="en">\n<head></head>\n<body>\n${documentHtml}\n</body>\n</html>`;
    hasDoctype = true;
    hasHtmlTag = true;
    hasHeadTag = true;
  } else if (!hasDoctype) {
    documentHtml = `<!DOCTYPE html>\n${documentHtml}`;
  }

  if (!hasHeadTag) {
    const htmlMatch = /<html\b[^>]*>/i.exec(documentHtml);
    if (htmlMatch) {
      const insertIdx = htmlMatch.index + htmlMatch[0].length;
      documentHtml =
        documentHtml.slice(0, insertIdx) +
        '\n<head></head>' +
        documentHtml.slice(insertIdx);
      hasHeadTag = true;
    }
  }

  // 7. Inject CSP and Runtime script as VERY FIRST children of <head>
  const runtimeCode = generatePreviewRuntime(nonce, options.initialStorage || {});
  const safeRuntimeScript = runtimeCode.replace(/<\/script/gi, () => '<\\/script');

  const importMapTag = importMapJson
    ? `  <script type="importmap">\n${importMapJson}\n  </script>\n`
    : '';

  const headInjections =
    `  <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">\n` +
    `  <script data-desyra-runtime="true">${safeRuntimeScript}</script>\n` +
    importMapTag;

  const headMatch = /<head\b[^>]*>/i.exec(documentHtml);
  if (headMatch) {
    const insertIdx = headMatch.index + headMatch[0].length;
    documentHtml =
      documentHtml.slice(0, insertIdx) +
      '\n' +
      headInjections +
      documentHtml.slice(insertIdx);
  }

  // 8. Restore all masked non-markup placeholders in reverse order
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const ph = `\u0000DESYRA_${i}\u0000`;
    const content = placeholders[i];
    documentHtml = documentHtml.replace(ph, () => content);
  }

  // 9. Re-insert deferred scripts immediately before closing </body>
  // in their original relative order, with defer attribute stripped
  if (deferredScriptsToInsert.length > 0) {
    const deferredBlock = deferredScriptsToInsert.join('\n');
    const lastBodyIdx = documentHtml.toLowerCase().lastIndexOf('</body>');
    if (lastBodyIdx !== -1) {
      documentHtml =
        documentHtml.slice(0, lastBodyIdx) +
        deferredBlock +
        '\n' +
        documentHtml.slice(lastBodyIdx);
    } else {
      const lastHtmlIdx = documentHtml.toLowerCase().lastIndexOf('</html>');
      if (lastHtmlIdx !== -1) {
        documentHtml =
          documentHtml.slice(0, lastHtmlIdx) +
          deferredBlock +
          '\n' +
          documentHtml.slice(lastHtmlIdx);
      } else {
        documentHtml += '\n' + deferredBlock;
      }
    }
  }

  // 10. Generate SourceMap for inlined scripts and styles
  const sourceMapEntries: SourceMapEntry[] = [];
  const inlinedRegex = /<(script|style)\b([^>]*?)\bdata-src="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/gi;
  let inlinedMatch: RegExpExecArray | null;

  while ((inlinedMatch = inlinedRegex.exec(documentHtml)) !== null) {
    const tagType = inlinedMatch[1].toLowerCase() as 'script' | 'style';
    const filePath = inlinedMatch[3];
    const fullMatch = inlinedMatch[0];
    const openTagMatch = /^(<(script|style)\b[^>]*>)/i.exec(fullMatch);
    if (!openTagMatch) continue;

    const beforeMatch = documentHtml.slice(0, inlinedMatch.index);
    const openTagLine = beforeMatch.split('\n').length;
    // Inlined content starts on the line immediately following the opening tag
    const startLine = openTagLine + 1;

    let innerContent = inlinedMatch[5];
    if (innerContent.startsWith('\n')) {
      innerContent = innerContent.slice(1);
    }
    if (innerContent.endsWith('\n')) {
      innerContent = innerContent.slice(0, -1);
    }

    const lineCount = innerContent.length > 0 ? innerContent.split('\n').length : 0;
    const endLine = lineCount > 0 ? startLine + lineCount - 1 : startLine;

    sourceMapEntries.push({
      path: filePath,
      startLine,
      endLine,
      type: tagType,
    });
  }

  const blobToPath: Record<string, string> = {};
  for (const [filePath, blobUrl] of moduleBlobMap.entries()) {
    blobToPath[blobUrl] = filePath;
  }

  return {
    html: documentHtml,
    warnings,
    usedFiles: Array.from(new Set(usedFiles)),
    blobUrls,
    sourceMap: {
      entries: sourceMapEntries,
      blobToPath,
    },
  };
}
