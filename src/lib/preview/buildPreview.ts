/**
 * DESYRA Preview Builder
 * Pure, deterministic, testable module that compiles project files into a sandboxed HTML document.
 * Inlines local CSS, classic scripts, rewrites ES modules to blob: URLs, converts SVGs to data URIs,
 * injects Content-Security-Policy, and prepends the DESYRA sandbox runtime.
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

export interface BuildPreviewResult {
  html: string;
  warnings: PreviewWarning[];
  usedFiles: string[];
  blobUrls: string[];
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
 * Parses static and dynamic relative imports from a JS module content.
 */
export function extractRelativeImports(jsCode: string): string[] {
  const imports: string[] = [];
  const staticRegex = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = staticRegex.exec(jsCode)) !== null) {
    imports.push(match[1]);
  }

  const dynamicRegex = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = dynamicRegex.exec(jsCode)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Rewrites ES Module relative import specifiers in dependency order to blob: URLs.
 */
export function processModulesToBlobUrls(
  files: Array<{ path: string; content: string }>,
  warnings: PreviewWarning[],
  createdBlobUrls: string[]
): Map<string, string> {
  const moduleBlobMap = new Map<string, string>();

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

  const dependencyGraph = new Map<string, Set<string>>();

  for (const jsFile of jsFiles) {
    const rawImports = extractRelativeImports(jsFile.content);
    const resolvedDeps = new Set<string>();

    for (const raw of rawImports) {
      let resolved = resolveRelativePath(jsFile.path, raw);
      if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs') && !resolved.endsWith('.json')) {
        const candidate = `${resolved}.js`;
        if (files.some((f) => f.path === candidate)) {
          resolved = candidate;
        }
      }
      resolvedDeps.add(resolved);
    }
    dependencyGraph.set(jsFile.path, resolvedDeps);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const circularPairs = new Set<string>();

  function detectCycle(current: string) {
    visited.add(current);
    recursionStack.add(current);

    const deps = dependencyGraph.get(current);
    if (deps) {
      for (const dep of deps) {
        if (!visited.has(dep)) {
          detectCycle(dep);
        } else if (recursionStack.has(dep)) {
          const pairKey = [current, dep].sort().join('<->');
          if (!circularPairs.has(pairKey)) {
            circularPairs.add(pairKey);
            warnings.push({
              type: 'circular_import',
              message: `Circular import between "${current}" and "${dep}" is not supported in the preview.`,
              file: current,
            });
          }
        }
      }
    }

    recursionStack.delete(current);
  }

  for (const jsFile of jsFiles) {
    if (!visited.has(jsFile.path)) {
      detectCycle(jsFile.path);
    }
  }

  const order: string[] = [];
  const processed = new Set<string>();

  function topoVisit(file: string, stack: Set<string>) {
    if (processed.has(file)) return;
    if (stack.has(file)) return;
    stack.add(file);

    const deps = dependencyGraph.get(file);
    if (deps) {
      for (const dep of deps) {
        topoVisit(dep, stack);
      }
    }

    stack.delete(file);
    processed.add(file);
    order.push(file);
  }

  for (const jsFile of jsFiles) {
    topoVisit(jsFile.path, new Set());
  }

  for (const filePath of order) {
    const fileItem = jsFiles.find((f) => f.path === filePath);
    if (!fileItem) continue;

    let rewrittenCode = fileItem.content;
    const deps = dependencyGraph.get(filePath);

    if (deps && deps.size > 0) {
      rewrittenCode = rewrittenCode.replace(
        /((?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?)(['"])(\.[^'"]+)\2/g,
        (full: string, prefix: string, quote: string, specifier: string) => {
          let resolved = resolveRelativePath(filePath, specifier);
          if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs') && !resolved.endsWith('.json')) {
            const candidate = `${resolved}.js`;
            if (moduleBlobMap.has(candidate)) {
              resolved = candidate;
            }
          }
          const blobUrl = moduleBlobMap.get(resolved);
          if (blobUrl) {
            return `${prefix}${quote}${blobUrl}${quote}`;
          }
          return full;
        }
      );

      rewrittenCode = rewrittenCode.replace(
        /(import\s*\(\s*)(['"])(\.[^'"]+)\2(\s*\))/g,
        (full: string, prefix: string, quote: string, specifier: string, suffix: string) => {
          let resolved = resolveRelativePath(filePath, specifier);
          if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs') && !resolved.endsWith('.json')) {
            const candidate = `${resolved}.js`;
            if (moduleBlobMap.has(candidate)) {
              resolved = candidate;
            }
          }
          const blobUrl = moduleBlobMap.get(resolved);
          if (blobUrl) {
            return `${prefix}${quote}${blobUrl}${quote}${suffix}`;
          }
          return full;
        }
      );
    }

    const blobUrl = createBlobUrl(rewrittenCode);
    createdBlobUrls.push(blobUrl);
    moduleBlobMap.set(filePath, blobUrl);
  }

  return moduleBlobMap;
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
    };
  }

  usedFiles.push(entryFile.path);
  let documentHtml = entryFile.content;

  // 3. Process ES modules to blob URLs
  const moduleBlobMap = processModulesToBlobUrls(files, warnings, blobUrls);

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

  // Process and mask <script> elements
  documentHtml = documentHtml.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi,
    (fullTag: string, attrs: string, inlineContent: string) => {
      const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);

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
            const cleanedAttrs = attrs.replace(/\bsrc\s*=\s*["'][^"']+["']/i, '').trim();
            const space = cleanedAttrs ? ' ' : '';
            const tag = `<script${space}${cleanedAttrs} data-src="${found.file.path}">\n${safeJs}\n</script>`;
            return createPlaceholder(tag);
          }
          return createPlaceholder(`<!-- Missing script: ${src} -->`);
        }
      }

      if (isModule && inlineContent.trim()) {
        let rewritten = inlineContent;
        rewritten = rewritten.replace(
          /((?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?)(['"])(\.[^'"]+)\2/g,
          (full: string, prefix: string, quote: string, specifier: string) => {
            let resolved = resolveRelativePath(entryFile!.path, specifier);
            if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs')) {
              const candidate = `${resolved}.js`;
              if (moduleBlobMap.has(candidate)) {
                resolved = candidate;
              }
            }
            const blobUrl = moduleBlobMap.get(resolved);
            return blobUrl ? `${prefix}${quote}${blobUrl}${quote}` : full;
          }
        );
        const safeInline = rewritten.replace(/<\/script/gi, () => '<\\/script');
        const tag = `<script${attrs ? ' ' + attrs : ''}>\n${safeInline}\n</script>`;
        return createPlaceholder(tag);
      }

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

  const headInjections =
    `  <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">\n` +
    `  <script data-desyra-runtime="true">${safeRuntimeScript}</script>\n`;

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

  return {
    html: documentHtml,
    warnings,
    usedFiles: Array.from(new Set(usedFiles)),
    blobUrls,
  };
}
