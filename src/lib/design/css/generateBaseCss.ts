/**
 * DESYRA CSS Generator - base.css
 * Modern reset, typography defaults, accessibility, and utility helpers.
 */

import type { DesignSpec } from '../types';
import { getStylePreset } from '../presets';

export function generateBaseCss(spec: DesignSpec): string {
  const preset = getStylePreset(spec.presetId);
  const isBengali = spec.language === 'bn';

  return `/* Managed by DESYRA Design. Base Reset & Defaults */

/* 1. Modern Reset & Box Sizing */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: ${isBengali ? '1.65' : '1.5'};
  -webkit-text-size-adjust: 100%;
  tab-size: 4;
  scroll-behavior: smooth;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  min-height: 100vh;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 2. Headings Scale */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-display);
  font-weight: ${preset.headingWeight};
  line-height: 1.2;
  letter-spacing: ${isBengali ? '0' : preset.headingLetterSpacing};
  color: var(--color-text);
  overflow-wrap: break-word;
}

h1 { font-size: var(--text-4xl); }
h2 { font-size: var(--text-3xl); }
h3 { font-size: var(--text-2xl); }
h4 { font-size: var(--text-xl); }
h5 { font-size: var(--text-lg); }
h6 { font-size: var(--text-base); }

/* 3. Links & Interactive Focus */
a {
  color: var(--color-link);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease);
}

a:hover {
  text-decoration: underline;
}

button, input, select, textarea {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius-sm);
}

/* 4. Selection & Scrollbars */
::selection {
  background-color: var(--color-primary-soft);
  color: var(--color-text);
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--color-bg);
}
::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: var(--radius-full);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-subtle);
}

/* 5. Media & Assets */
img, svg, video, canvas, audio {
  display: block;
  max-width: 100%;
  height: auto;
}

/* 6. Accessibility & Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.skip-link {
  position: absolute;
  top: -100px;
  left: 1rem;
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  z-index: 9999;
}
.skip-link:focus {
  top: 1rem;
}

[hidden] {
  display: none !important;
}
`;
}
