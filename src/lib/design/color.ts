/**
 * DESYRA Design System - Color & WCAG Contrast Engine
 * Handles HSL conversions, relative luminance, contrast calculation,
 * contrast adjustment, and palette generation.
 */

import type { ColorPalette } from './types';

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

/**
 * Parses hex color (3, 4, 6, 8 digit) into RGB.
 */
export function hexToRgb(hex: string): RGB {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return { r, g, b };
  }
  return { r: 0, g: 0, b: 0 };
}

/**
 * Converts RGB to Hex.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Converts RGB to HSL.
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case rf:
        h = (gf - bf) / delta + (gf < bf ? 6 : 0);
        break;
      case gf:
        h = (bf - rf) / delta + 2;
        break;
      case bf:
        h = (rf - gf) / delta + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Converts HSL to RGB.
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hNormalized = ((h % 360) + 360) % 360 / 360;
  const sNormalized = Math.max(0, Math.min(100, s)) / 100;
  const lNormalized = Math.max(0, Math.min(100, l)) / 100;

  if (sNormalized === 0) {
    const gray = Math.round(lNormalized * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tNorm = t;
    if (tNorm < 0) tNorm += 1;
    if (tNorm > 1) tNorm -= 1;
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
    if (tNorm < 1 / 2) return q;
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
    return p;
  };

  const q =
    lNormalized < 0.5
      ? lNormalized * (1 + sNormalized)
      : lNormalized + sNormalized - lNormalized * sNormalized;
  const p = 2 * lNormalized - q;

  const r = Math.round(hue2rgb(p, q, hNormalized + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNormalized) * 255);
  const b = Math.round(hue2rgb(p, q, hNormalized - 1 / 3) * 255);

  return { r, g, b };
}

export function hexToHsl(hex: string): HSL {
  const rgb = hexToRgb(hex);
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

export function hslToHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/**
 * Calculates WCAG 2.1 relative luminance for a color.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const cal = (val: number) => {
    const c = val / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * cal(r) + 0.7152 * cal(g) + 0.0722 * cal(b);
}

/**
 * Calculates WCAG 2.1 contrast ratio between foreground and background.
 * Returns value between 1 and 21.
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Adjusts foreground lightness minimally until contrast ratio with bgHex meets minRatio.
 */
export function ensureContrast(fgHex: string, bgHex: string, minRatio: number): string {
  const currentRatio = contrastRatio(fgHex, bgHex);
  if (currentRatio >= minRatio) return fgHex;

  const bgLum = relativeLuminance(bgHex);
  const isBgDark = bgLum < 0.5;
  const hsl = hexToHsl(fgHex);

  // Direction: if bg is dark, make fg lighter (increase L); if bg is light, make fg darker (decrease L)
  const step = isBgDark ? 1 : -1;
  let currentL = hsl.l;
  let bestHex = fgHex;

  for (let i = 0; i < 100; i++) {
    currentL += step;
    if (currentL < 0 || currentL > 100) break;
    const testHex = hslToHex(hsl.h, hsl.s, currentL);
    const ratio = contrastRatio(testHex, bgHex);
    bestHex = testHex;
    if (ratio >= minRatio) return testHex;
  }

  return bestHex;
}

/**
 * Generates a complete ColorPalette for a seed color and mode.
 * Enforces all contrast guarantees.
 */
export function generatePalette(
  seedHex: string,
  mode: 'dark' | 'light',
  accentRule: 'analogous' | 'complementary' | 'monochrome' = 'analogous'
): ColorPalette {
  const seedHsl = hexToHsl(seedHex);
  const hue = seedHsl.h;

  const isDark = mode === 'dark';

  // 1. Tinted Neutrals (2-6% saturation derived from seed hue)
  const neutralSat = Math.min(6, Math.max(2, Math.round(seedHsl.s * 0.1)));

  let bg: string;
  let surface: string;
  let elevated: string;
  let border: string;
  let text: string;
  let muted: string;
  let subtle: string;

  if (isDark) {
    bg = hslToHex(hue, neutralSat, 7);
    surface = hslToHex(hue, neutralSat, 11);
    elevated = hslToHex(hue, neutralSat, 15);
    border = hslToHex(hue, neutralSat, 22);
    text = hslToHex(hue, neutralSat, 96);
    muted = hslToHex(hue, neutralSat, 70);
    subtle = hslToHex(hue, neutralSat, 50);
  } else {
    bg = hslToHex(hue, neutralSat, 99);
    surface = hslToHex(hue, neutralSat, 100);
    elevated = hslToHex(hue, neutralSat, 97);
    border = hslToHex(hue, neutralSat, 88);
    text = hslToHex(hue, neutralSat, 10);
    muted = hslToHex(hue, neutralSat, 40);
    subtle = hslToHex(hue, neutralSat, 60);
  }

  // Ensure neutral contrast guarantees
  text = ensureContrast(text, bg, 7.0);
  text = ensureContrast(text, surface, 7.0);
  muted = ensureContrast(muted, bg, 4.5);
  muted = ensureContrast(muted, surface, 4.5);

  // Border vs bg visibility
  if (contrastRatio(border, bg) < 1.3) {
    const borderL = isDark ? 26 : 82;
    border = hslToHex(hue, neutralSat, borderL);
  }

  // 2. Primary Color from seed (clamped saturation & lightness)
  const primarySat = Math.min(90, Math.max(45, seedHsl.s));
  const primaryLight = isDark
    ? Math.min(72, Math.max(52, seedHsl.l))
    : Math.min(60, Math.max(40, seedHsl.l));

  let primary = hslToHex(hue, primarySat, primaryLight);
  primary = ensureContrast(primary, surface, 3.0);

  const primaryHoverL = isDark
    ? Math.min(82, primaryLight + 8)
    : Math.max(28, primaryLight - 8);
  const primaryActiveL = isDark
    ? Math.max(40, primaryLight - 6)
    : Math.min(70, primaryLight + 6);

  const primaryHover = hslToHex(hue, primarySat, primaryHoverL);
  const primaryActive = hslToHex(hue, primarySat, primaryActiveL);

  // Primary soft background (12% alpha tint over surface)
  const primaryRgb = hexToRgb(primary);
  const primarySoft = `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.12)`;

  // OnPrimary choice
  const whiteContrast = contrastRatio('#ffffff', primary);
  const blackContrast = contrastRatio('#000000', primary);
  const onPrimary = whiteContrast >= blackContrast ? '#ffffff' : '#000000';

  // Accent Color calculation
  let accentHue = (hue + 30) % 360;
  if (accentRule === 'complementary') {
    accentHue = (hue + 180) % 360;
  } else if (accentRule === 'monochrome') {
    accentHue = hue;
  }
  let accent = hslToHex(accentHue, Math.min(95, primarySat + 5), isDark ? 65 : 48);
  accent = ensureContrast(accent, surface, 3.0);

  // Link Color (primary as text, adjusted for >= 4.5:1 on bg)
  let link = primary;
  link = ensureContrast(link, bg, 4.5);

  // Semantic Colors
  let success = hslToHex(145, 75, isDark ? 60 : 42);
  let warning = hslToHex(38, 92, isDark ? 62 : 45);
  let error = hslToHex(0, 84, isDark ? 66 : 48);
  let info = hslToHex(212, 90, isDark ? 66 : 48);

  success = ensureContrast(success, surface, 3.0);
  warning = ensureContrast(warning, surface, 3.0);
  error = ensureContrast(error, surface, 3.0);
  info = ensureContrast(info, surface, 3.0);

  return {
    bg,
    surface,
    elevated,
    border,
    text,
    muted,
    subtle,
    primary,
    primaryHover,
    primaryActive,
    primarySoft,
    onPrimary,
    accent,
    link,
    success,
    warning,
    error,
    info,
  };
}
