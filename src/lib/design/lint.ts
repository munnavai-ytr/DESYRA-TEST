/**
 * DESYRA Static Design Linter
 * Deterministic quality & accessibility inspector for project files.
 */

import type { DesignSpec, LintIssue, LintResult } from './types';
import { MANAGED_DESIGN_FILES, checkManagedFilesHashes } from './install';

export interface FileToLint {
  path: string;
  content: string;
}

/**
 * Masking helper: masks HTML comments and inline script/style contents
 * so JS/CSS strings aren't misidentified as HTML tags.
 */
function maskHtmlMarkup(htmlContent: string): { maskedHtml: string; scripts: string[]; styles: string[] } {
  const scripts: string[] = [];
  const styles: string[] = [];

  let masked = htmlContent.replace(/<!--[\s\S]*?-->/gi, '');

  masked = masked.replace(/<script\b[^>]*?>([\s\S]*?)<\/script>/gi, (match, body) => {
    scripts.push(body);
    return '<script></script>';
  });

  masked = masked.replace(/<style\b[^>]*?>([\s\S]*?)<\/style>/gi, (match, body) => {
    styles.push(body);
    return '<style></style>';
  });

  return { maskedHtml: masked, scripts, styles };
}

/**
 * Runs static design linter over all project files.
 */
export function lintDesign(files: FileToLint[], spec?: DesignSpec): LintResult {
  const issues: LintIssue[] = [];

  const htmlFiles = files.filter((f) => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm'));
  const cssFiles = files.filter((f) => f.path.toLowerCase().endsWith('.css'));
  const jsFiles = files.filter((f) => f.path.toLowerCase().endsWith('.js') || f.path.toLowerCase().endsWith('.mjs'));

  let accDeduction = 0;
  let conDeduction = 0;
  let resDeduction = 0;
  let cntDeduction = 0;

  // ------------------------------------------------------------------------
  // 1. ACCESSIBILITY CHECKS
  // ------------------------------------------------------------------------
  for (const file of htmlFiles) {
    const { maskedHtml } = maskHtmlMarkup(file.content);

    // 1.1 Missing <html lang>
    if (!/<html\b[^>]*?\blang\s*=\s*["'][^"']+["']/i.test(maskedHtml)) {
      accDeduction += 8;
      issues.push({
        id: `acc_lang_${file.path}`,
        category: 'accessibility',
        severity: 'error',
        file: file.path,
        message: 'Missing or empty <html lang="..."> attribute.',
        fix: 'Add lang="en" (or lang="bn" for Bengali) to the <html> opening tag.',
      });
    }

    // 1.2 Missing Viewport Meta
    if (!/<meta\b[^>]*?\bname\s*=\s*["']viewport["']/i.test(maskedHtml)) {
      accDeduction += 8;
      issues.push({
        id: `acc_viewport_${file.path}`,
        category: 'accessibility',
        severity: 'error',
        file: file.path,
        message: 'Missing responsive <meta name="viewport"> tag.',
        fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> inside <head>.',
      });
    }

    // 1.3 Heading <h1> Check
    const h1Matches = maskedHtml.match(/<h1\b[^>]*?>/gi);
    const h1Count = h1Matches ? h1Matches.length : 0;
    if (h1Count === 0) {
      accDeduction += 5;
      issues.push({
        id: `acc_h1_missing_${file.path}`,
        category: 'accessibility',
        severity: 'warning',
        file: file.path,
        message: 'Page has no <h1> primary heading.',
        fix: 'Add exactly one <h1> element to define the page title.',
      });
    } else if (h1Count > 1) {
      accDeduction += 4;
      issues.push({
        id: `acc_h1_multiple_${file.path}`,
        category: 'accessibility',
        severity: 'warning',
        file: file.path,
        message: `Page has ${h1Count} <h1> headings (should have exactly 1).`,
        fix: 'Use only one <h1> per page; change secondary section headings to <h2>.',
      });
    }

    // 1.4 Image alt attribute check
    const imgRegex = /<img\b([^>]*?)>/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(maskedHtml)) !== null) {
      const attrs = imgMatch[1];
      if (!/\balt\s*=/i.test(attrs)) {
        accDeduction += 4;
        issues.push({
          id: `acc_img_alt_${file.path}_${imgMatch.index}`,
          category: 'accessibility',
          severity: 'warning',
          file: file.path,
          message: '<img> tag is missing an alt attribute.',
          fix: 'Add alt="..." describing the image content.',
        });
        break; // Count once per file for conciseness
      }
    }

    // 1.5 Form Inputs without labels
    const inputRegex = /<(?:input|textarea|select)\b([^>]*?)>/gi;
    let inputMatch: RegExpExecArray | null;
    while ((inputMatch = inputRegex.exec(maskedHtml)) !== null) {
      const attrs = inputMatch[1];
      const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const inputType = typeMatch ? typeMatch[1].toLowerCase() : 'text';
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(inputType)) continue;

      const hasId = /\bid\s*=\s*["']([^"']+)["']/i.test(attrs);
      const hasAriaLabel = /\baria-label(?:by)?\s*=/i.test(attrs);

      if (!hasId && !hasAriaLabel) {
        accDeduction += 5;
        issues.push({
          id: `acc_input_label_${file.path}`,
          category: 'accessibility',
          severity: 'warning',
          file: file.path,
          message: 'Form input missing corresponding <label> or aria-label.',
          fix: 'Add an id="..." and matching <label htmlFor="..."> or aria-label attribute.',
        });
        break;
      }
    }
  }

  // 1.6 CSS outline:none without focus-visible
  for (const file of cssFiles) {
    if (file.path.endsWith('tokens.css') || file.path.endsWith('base.css')) continue;
    if (/(?:outline\s*:\s*(?:none|0)|outline\s*:\s*transparent)/i.test(file.content)) {
      if (!/:focus-visible/i.test(file.content) && !/box-shadow/i.test(file.content)) {
        accDeduction += 5;
        issues.push({
          id: `acc_outline_${file.path}`,
          category: 'accessibility',
          severity: 'error',
          file: file.path,
          message: 'CSS removes outline without providing a :focus-visible replacement.',
          fix: 'Replace outline: none with :focus-visible { box-shadow: var(--focus-ring); }.',
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 2. CONSISTENCY CHECKS
  // ------------------------------------------------------------------------
  for (const file of [...cssFiles, ...htmlFiles]) {
    // Skip tokens.css
    if (file.path.endsWith('tokens.css')) continue;

    // 2.1 Hardcoded Hex/RGB/HSL colors
    const colorHexMatches = file.content.match(/#(?:[0-9a-fA-F]{3,4}){1,2}\b/g);
    const hardcodedColors = colorHexMatches ? colorHexMatches.filter((c) => c !== '#fff' && c !== '#ffffff' && c !== '#000' && c !== '#000000') : [];

    if (hardcodedColors.length > 0) {
      conDeduction += Math.min(12, hardcodedColors.length * 3);
      issues.push({
        id: `con_hex_${file.path}`,
        category: 'consistency',
        severity: 'warning',
        file: file.path,
        message: `Found ${hardcodedColors.length} hardcoded color hex values (e.g. ${hardcodedColors.slice(0, 3).join(', ')}).`,
        fix: 'Use DESYRA CSS variables instead (e.g. var(--color-primary), var(--color-bg)).',
      });
    }

    // 2.2 Inline style attributes with colors or fonts
    if (file.path.endsWith('.html')) {
      if (/style\s*=\s*["'][^"']*(?:color|background|font-family)\s*:[^"']*["']/i.test(file.content)) {
        conDeduction += 4;
        issues.push({
          id: `con_inline_style_${file.path}`,
          category: 'consistency',
          severity: 'warning',
          file: file.path,
          message: 'Inline style attribute contains hardcoded colors or fonts.',
          fix: 'Move styles to css/app.css or use component classes like .card or .btn.',
        });
      }

      // 2.3 Tailwind CDN or external CSS frameworks when design system is active
      if (spec && (file.content.includes('cdn.tailwindcss.com') || file.content.includes('@tailwindcss/browser'))) {
        conDeduction += 8;
        issues.push({
          id: `con_tailwind_conflict_${file.path}`,
          category: 'consistency',
          severity: 'warning',
          file: file.path,
          message: 'External Tailwind CDN script found while DESYRA Design System is active.',
          fix: 'Remove Tailwind CDN script and use DESYRA tokens.css, base.css, and components.css.',
        });
      }
    }

    // 2.4 Use of !important in custom CSS
    if (file.path.endsWith('.css') && !file.path.endsWith('base.css')) {
      if (/!important/i.test(file.content)) {
        conDeduction += 3;
        issues.push({
          id: `con_important_${file.path}`,
          category: 'consistency',
          severity: 'info',
          file: file.path,
          message: 'Custom CSS uses !important declarations.',
          fix: 'Avoid !important; use standard CSS selector specificity with design tokens.',
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 3. RESPONSIVENESS CHECKS
  // ------------------------------------------------------------------------
  for (const file of cssFiles) {
    if (file.path.endsWith('tokens.css') || file.path.endsWith('base.css')) continue;

    // 3.1 Fixed pixel widths > 480px
    const widthMatch = /\bwidth\s*:\s*([5-9]\d{2}|\d{4,})px\b/i.exec(file.content);
    if (widthMatch) {
      resDeduction += 5;
      issues.push({
        id: `res_fixed_width_${file.path}`,
        category: 'responsiveness',
        severity: 'warning',
        file: file.path,
        message: `Fixed container width (${widthMatch[1]}px) risks breaking small mobile screens.`,
        fix: 'Use max-width or percentage widths (e.g. max-width: 100% or var(--container-max-width)).',
      });
    }

    // 3.2 100vw horizontal overflow risk
    if (/\bwidth\s*:\s*100vw\b/i.test(file.content)) {
      resDeduction += 4;
      issues.push({
        id: `res_100vw_${file.path}`,
        category: 'responsiveness',
        severity: 'info',
        file: file.path,
        message: 'Using width: 100vw can trigger unwanted horizontal scrollbars on desktop.',
        fix: 'Use width: 100% instead of 100vw.',
      });
    }
  }

  for (const file of htmlFiles) {
    const { maskedHtml } = maskHtmlMarkup(file.content);

    // 3.3 Navbar mobile menu check (>3 links without toggle button)
    const linkCount = (maskedHtml.match(/<a\b[^>]*?>/gi) || []).length;
    const hasToggleBtn = /<button\b[^>]*?>/i.test(maskedHtml);
    if (linkCount >= 4 && !hasToggleBtn) {
      resDeduction += 5;
      issues.push({
        id: `res_navbar_toggle_${file.path}`,
        category: 'responsiveness',
        severity: 'warning',
        file: file.path,
        message: 'Navbar has multiple navigation links but lacks a mobile hamburger menu toggle.',
        fix: 'Add a mobile toggle button using the DESYRA navbar recipe.',
      });
    }
  }

  // ------------------------------------------------------------------------
  // 4. CONTENT & ANTI-SLOP CHECKS
  // ------------------------------------------------------------------------
  for (const file of [...htmlFiles, ...jsFiles]) {
    // 4.1 Placeholder text
    if (/\b(Lorem ipsum|Your Name|Company Name|Click here)\b/i.test(file.content)) {
      cntDeduction += 5;
      issues.push({
        id: `cnt_placeholder_${file.path}`,
        category: 'content',
        severity: 'warning',
        file: file.path,
        message: 'Generic placeholder text found (e.g. "Lorem ipsum", "Your Name", "Click here").',
        fix: 'Replace generic placeholders with realistic, domain-specific copy.',
      });
    }

    // 4.2 Emoji used as UI icons inside buttons or nav links
    if (file.path.endsWith('.html')) {
      if (/<(?:button|a)\b[^>]*?>\s*(?:[🚀⭐🔥💡🎉⚡✨])\s*<\/(?:button|a)>/u.test(file.content)) {
        cntDeduction += 5;
        issues.push({
          id: `cnt_emoji_icon_${file.path}`,
          category: 'content',
          severity: 'info',
          file: file.path,
          message: 'Emoji used as button or navigation icon.',
          fix: 'Use Lucide SVG icons (e.g. <i data-lucide="..."></i>) instead of raw emojis.',
        });
      }

      // 4.3 External image URLs violating CSP
      const extImgMatch = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi.exec(file.content);
      if (extImgMatch) {
        cntDeduction += 6;
        issues.push({
          id: `cnt_ext_img_${file.path}`,
          category: 'content',
          severity: 'warning',
          file: file.path,
          message: `External image URL found (${extImgMatch[1]}). Sandboxed preview blocks external hosts.`,
          fix: 'Use CSS gradients, inline SVG patterns, or local asset SVGs.',
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // SCORE CALCULATION
  // ------------------------------------------------------------------------
  const accScore = Math.max(0, 25 - accDeduction);
  const conScore = Math.max(0, 25 - conDeduction);
  const resScore = Math.max(0, 25 - resDeduction);
  const cntScore = Math.max(0, 25 - cntDeduction);

  const totalScore = Math.min(100, Math.max(0, accScore + conScore + resScore + cntScore));

  return {
    score: totalScore,
    categories: {
      accessibility: accScore * 4, // Scale to 100 per category for display
      consistency: conScore * 4,
      responsiveness: resScore * 4,
      content: cntScore * 4,
    },
    issues,
  };
}
