import { describe, it, expect } from 'vitest';
import { contrastRatio, relativeLuminance, ensureContrast, generatePalette, hslToHex, hexToHsl } from './color';
import { classifyIdea } from './classify';
import { createSpecFromClassification } from './install';
import { generateTokensCss } from './css/generateTokensCss';
import { generateBaseCss } from './css/generateBaseCss';
import { generateComponentsCss } from './css/generateComponentsCss';
import { computeStringHash } from './install';
import { lintDesign } from './lint';
import type { ProjectFile } from '@/lib/db';

describe('Design Engine - Color Math & WCAG Contrast', () => {
  it('correctly converts hex <-> HSL', () => {
    const hex = '#ff0000';
    const hsl = hexToHsl(hex);
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(100);
    const backHex = hslToHex(hsl.h, hsl.s, hsl.l);
    expect(backHex.toLowerCase()).toBe(hex.toLowerCase());
  });

  it('calculates relative luminance and contrast ratios correctly', () => {
    const cr = contrastRatio('#ffffff', '#000000');
    expect(cr).toBeCloseTo(21, 0);
  });

  it('guarantees WCAG 7:1 text contrast and 4.5:1 link/onPrimary contrast in generated palettes', () => {
    const seeds = ['#ff6b1a', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#e11d48'];

    for (const seed of seeds) {
      const darkPalette = generatePalette(seed, 'dark', 'analogous');
      const lightPalette = generatePalette(seed, 'light', 'monochrome');

      // Text vs BG >= 7:1 (AAA)
      expect(contrastRatio(darkPalette.text, darkPalette.bg)).toBeGreaterThanOrEqual(7.0);
      expect(contrastRatio(lightPalette.text, lightPalette.bg)).toBeGreaterThanOrEqual(7.0);

      // OnPrimary vs Primary >= 4.5:1 (AA)
      expect(contrastRatio(darkPalette.onPrimary, darkPalette.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(lightPalette.onPrimary, lightPalette.primary)).toBeGreaterThanOrEqual(4.5);

      // Link vs BG >= 4.5:1 (AA)
      expect(contrastRatio(darkPalette.link, darkPalette.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(lightPalette.link, lightPalette.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('adjusts background or foreground lightness iteratively with ensureContrast', () => {
    const initialFg = '#777777';
    const bg = '#101014';
    const adjusted = ensureContrast(initialFg, bg, 7.0);
    const cr = contrastRatio(adjusted, bg);
    expect(cr).toBeGreaterThanOrEqual(7.0);
  });
});

describe('Design Engine - Classification & Font Selection', () => {
  it('classifies English SaaS dashboard prompt correctly', () => {
    const res = classifyIdea('Build a modern SaaS admin dashboard for crypto trading analytics');
    expect(res.archetypeId).toBe('saas-dashboard-admin');
    expect(res.language).toBe('en');

    const spec = createSpecFromClassification('Build a modern SaaS admin dashboard for crypto trading analytics');
    expect(spec.defaultMode).toBe('dark');
  });

  it('classifies Bengali restaurant prompt and selects Bengali font pair', () => {
    const res = classifyIdea('একটি অনলাইন ফাস্ট ফুড রেস্টুরেন্ট এবং ফুড ডেলিভারি অ্যাপ');
    expect(res.archetypeId).toBe('food-restaurant-cafe');
    expect(res.language).toBe('bn');

    const spec = createSpecFromClassification('একটি অনলাইন ফাস্ট ফুড রেস্টুরেন্ট এবং ফুড ডেলিভারি অ্যাপ');
    expect(typeof spec.fontPairId).toBe('string');
    expect(spec.fontPairId).toContain('bn');
  });

  it('handles fallback for unknown general prompts gracefully', () => {
    const res = classifyIdea('xyz 123 random project');
    expect(res.archetypeId).toBe('general');
    const spec = createSpecFromClassification('xyz 123 random project');
    expect(spec.presetId).toBe('minimal');
  });
});

describe('Design Engine - Pure CSS String Generators', () => {
  it('generates valid tokens.css with CSS variables', () => {
    const spec = createSpecFromClassification('Portfolio website for a senior developer');
    const css = generateTokensCss(spec);
    expect(css).toContain(':root');
    expect(css).toContain('--color-primary:');
    expect(css).toContain('--font-display:');
    expect(css).toContain('--radius-md:');
  });

  it('generates valid base.css with reset and typography rules', () => {
    const spec = createSpecFromClassification('E-commerce store');
    const css = generateBaseCss(spec);
    expect(css).toContain('font-family: var(--font-body)');
    expect(css).toContain(':focus-visible');
  });

  it('generates valid components.css with responsive layout and primitive classes', () => {
    const spec = createSpecFromClassification('Saas application');
    const css = generateComponentsCss(spec);
    expect(css).toContain('.container');
    expect(css).toContain('.btn');
    expect(css).toContain('.card');
  });

  it('calculates deterministic FNV-style file hash for installer', () => {
    const content = 'body { margin: 0; }';
    const hash1 = computeStringHash(content);
    const hash2 = computeStringHash(content);
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBeGreaterThan(0);
  });
});

describe('Design Engine - Static Design Linter', () => {
  it('detects missing lang, missing alt, hardcoded inline styles, and font-family in HTML files', () => {
    const testFiles: ProjectFile[] = [
      {
        id: 'f1',
        projectId: 'p1',
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1 style="color: #ff6b1a; font-family: Inter;">Hello</h1>
  <img src="hero.jpg">
  <button style="height: 20px;">Click me</button>
</body>
</html>`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const res = lintDesign(testFiles);
    expect(res.score).toBeLessThan(100);
    expect(res.issues.some((i) => i.id.startsWith('acc_lang_'))).toBe(true);
    expect(res.issues.some((i) => i.id.startsWith('acc_img_alt_'))).toBe(true);
    expect(res.issues.some((i) => i.id.startsWith('con_hex_'))).toBe(true);
    expect(res.issues.some((i) => i.id.startsWith('con_inline_style_'))).toBe(true);
  });

  it('returns score 100 for clean accessible design engine compliant HTML markup', () => {
    const spec = createSpecFromClassification('Clean app');
    const cleanFiles: ProjectFile[] = [
      {
        id: 'f1',
        projectId: 'p1',
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clean App</title>
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components.css">
</head>
<body>
  <header className="nav-header">
    <a href="#" className="brand-logo">App</a>
  </header>
  <main className="container py-8">
    <h1>Welcome</h1>
    <img src="hero.jpg" alt="Hero image illustration">
    <button type="button" className="btn btn-primary" style="min-height: 44px; min-width: 44px;">Get Started</button>
  </main>
</body>
</html>`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const res = lintDesign(cleanFiles, spec);
    expect(res.score).toBe(100);
    expect(res.issues).toHaveLength(0);
  });
});
