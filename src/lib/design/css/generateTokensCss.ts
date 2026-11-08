/**
 * DESYRA CSS Generator - tokens.css
 * Generates pure CSS custom properties based on a DesignSpec.
 */

import type { DesignSpec } from '../types';
import { generatePalette } from '../color';
import { getRadiusScale, getShadowScale, getDensityScale, getMotionScale } from '../scales';
import { getFontPair } from '../fonts';
import { getStylePreset } from '../presets';

export function generateTokensCss(spec: DesignSpec): string {
  const preset = getStylePreset(spec.presetId);
  const fontPair = getFontPair(spec.fontPairId, spec.language === 'bn');

  const mainPalette = generatePalette(
    spec.seedHex,
    spec.mode === 'both' ? spec.defaultMode : spec.mode,
    preset.accentRule
  );

  const radiusScale = getRadiusScale(spec.radius);
  const densityScale = getDensityScale(spec.density);
  const motionScale = getMotionScale(spec.motion);

  let darkPalette = mainPalette;
  let lightPalette = mainPalette;

  if (spec.mode === 'both') {
    darkPalette = generatePalette(spec.seedHex, 'dark', preset.accentRule);
    lightPalette = generatePalette(spec.seedHex, 'light', preset.accentRule);
  } else if (spec.mode === 'dark') {
    darkPalette = mainPalette;
  } else {
    lightPalette = mainPalette;
  }

  const renderPaletteVars = (p: typeof mainPalette, indent = '  ') => `
${indent}--color-bg: ${p.bg};
${indent}--color-surface: ${p.surface};
${indent}--color-elevated: ${p.elevated};
${indent}--color-border: ${p.border};
${indent}--color-text: ${p.text};
${indent}--color-text-muted: ${p.muted};
${indent}--color-text-subtle: ${p.subtle};
${indent}--color-primary: ${p.primary};
${indent}--color-primary-hover: ${p.primaryHover};
${indent}--color-primary-active: ${p.primaryActive};
${indent}--color-primary-soft: ${p.primarySoft};
${indent}--color-on-primary: ${p.onPrimary};
${indent}--color-accent: ${p.accent};
${indent}--color-link: ${p.link};
${indent}--color-success: ${p.success};
${indent}--color-warning: ${p.warning};
${indent}--color-error: ${p.error};
${indent}--color-info: ${p.info};`;

  const shadowScale = getShadowScale(preset.shadowStyle, spec.mode === 'both' ? spec.defaultMode : spec.mode);

  return `/* Managed by DESYRA Design. Change the theme with the Design panel. */

:root {
  /* Color Scheme Declaration */
  color-scheme: ${spec.mode === 'both' ? 'dark light' : spec.mode};

  /* Default Color Palette */${renderPaletteVars(mainPalette, '  ')}

  /* Typography Fonts */
  --font-display: '${fontPair.displayFamily}', sans-serif;
  --font-body: '${fontFamilyName(fontPair.bodyFamily)}', sans-serif;
  --font-mono: '${fontPair.monoFamily}', monospace;

  /* Typography Fluid Scale */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: clamp(1.25rem, 2.5vw, 1.5rem);
  --text-2xl: clamp(1.5rem, 3vw, 2rem);
  --text-3xl: clamp(1.875rem, 4vw, 2.5rem);
  --text-4xl: clamp(2.25rem, 5vw, 3rem);
  --text-5xl: clamp(2.75rem, 6vw, 3.75rem);

  /* Spacing Scale (4px base) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
  --space-24: 6rem;

  /* Radii & Borders */
  --radius-sm: ${radiusScale.sm};
  --radius-md: ${radiusScale.md};
  --radius-lg: ${radiusScale.lg};
  --radius-full: ${radiusScale.full};
  --border-width: ${preset.borderWidth};

  /* Shadows */
  --shadow-sm: ${shadowScale.sm};
  --shadow-md: ${shadowScale.md};
  --shadow-lg: ${shadowScale.lg};

  /* Density Padding */
  --padding-section: ${densityScale.section};
  --padding-card: ${densityScale.card};
  --padding-button: ${densityScale.button};

  /* Motion & Transitions */
  --duration-fast: ${motionScale.fast};
  --duration-base: ${motionScale.base};
  --duration-slow: ${motionScale.slow};
  --ease: ${motionScale.ease};

  /* Layout Geometry */
  --container-max-width: 1240px;
  --header-height: 60px;
  --focus-ring: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-primary);
}

${
  spec.mode === 'both'
    ? `/* Dual Mode Support (dark/light toggles and system preference) */
:root[data-theme="dark"] {${renderPaletteVars(darkPalette, '  ')}
  --shadow-sm: ${getShadowScale(preset.shadowStyle, 'dark').sm};
  --shadow-md: ${getShadowScale(preset.shadowStyle, 'dark').md};
  --shadow-lg: ${getShadowScale(preset.shadowStyle, 'dark').lg};
}

:root[data-theme="light"] {${renderPaletteVars(lightPalette, '  ')}
  --shadow-sm: ${getShadowScale(preset.shadowStyle, 'light').sm};
  --shadow-md: ${getShadowScale(preset.shadowStyle, 'light').md};
  --shadow-lg: ${getShadowScale(preset.shadowStyle, 'light').lg};
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {${renderPaletteVars(darkPalette, '    ')}
    --shadow-sm: ${getShadowScale(preset.shadowStyle, 'dark').sm};
    --shadow-md: ${getShadowScale(preset.shadowStyle, 'dark').md};
    --shadow-lg: ${getShadowScale(preset.shadowStyle, 'dark').lg};
  }
}
`
    : ''
}
`;
}

function fontFamilyName(name: string): string {
  if (name.includes(' ')) {
    return name;
  }
  return name;
}
