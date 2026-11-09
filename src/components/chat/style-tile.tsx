'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { DesignSpec } from '@/lib/design/types';
import { generateTokensCss } from '@/lib/design/css/generateTokensCss';
import { generateBaseCss } from '@/lib/design/css/generateBaseCss';
import { generateComponentsCss } from '@/lib/design/css/generateComponentsCss';
import { FONT_PAIRS } from '@/lib/design/fonts';
import { Sun, Moon } from 'lucide-react';

export interface StyleTileProps {
  spec: DesignSpec;
  modeToggle?: boolean;
  height?: number | string;
  className?: string;
}

function buildStyleTileHtml(spec: DesignSpec, previewMode: 'dark' | 'light'): string {
  try {
    const tokensCss = generateTokensCss(spec);
    const baseCss = generateBaseCss(spec);
    const componentsCss = generateComponentsCss(spec);
    const fontPair = FONT_PAIRS[spec.fontPairId] || FONT_PAIRS['inter-neutral'];

    const themeAttr = previewMode === 'dark' ? 'class="dark"' : '';

    return `<!DOCTYPE html>
<html lang="${spec.language || 'en'}" ${themeAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  ${fontPair?.googleFontsHref ? `<link rel="stylesheet" href="${fontPair.googleFontsHref}">` : ''}
  <style>
    ${tokensCss}
    ${baseCss}
    ${componentsCss}
    body {
      margin: 0;
      padding: 14px;
      background: var(--color-bg);
      color: var(--color-text);
      font-family: var(--font-body);
      overflow-x: hidden;
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }
    * { box-sizing: border-box; }
    .demo-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .demo-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .demo-card {
      background: var(--color-surface);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      box-shadow: var(--shadow-sm);
    }
  </style>
</head>
<body>
  <div class="demo-grid">
    <div class="demo-card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
        <span style="font-family: var(--font-display); font-size: 0.95rem; font-weight: 600; color: var(--color-text);">
          ${spec.tokens?.fontDisplay || 'Inter'} Display
        </span>
        <span class="badge badge-primary">Active</span>
      </div>
      <p style="margin: 0 0 10px 0; font-size: 0.8rem; color: var(--color-text-muted); line-height: 1.4;">
        Design tokens, buttons, inputs, and semantic badges rendered with WCAG contrast guarantees.
      </p>
      <div class="demo-row">
        <button class="btn btn-primary" type="button">Primary</button>
        <button class="btn btn-secondary" type="button">Outline</button>
        <button class="btn btn-subtle" type="button">Subtle</button>
      </div>
    </div>
    <div class="demo-row" style="padding: 0 2px;">
      <input type="text" class="input" placeholder="Type here..." value="Accessible text field" readonly style="flex: 1; min-width: 140px; font-size: 0.8rem;" />
      <span class="badge badge-success">Pass AA</span>
      <span class="badge badge-warning">Sample</span>
    </div>
  </div>
</body>
</html>`;
  } catch {
    return `<!DOCTYPE html><html><body><p style="color: red; font-size: 11px;">Error generating preview</p></body></html>`;
  }
}

export function StyleTile({
  spec,
  modeToggle = true,
  height = 240,
  className = '',
}: StyleTileProps) {
  const [userSelectedMode, setUserSelectedMode] = useState<'dark' | 'light' | null>(null);
  const activeMode: 'dark' | 'light' =
    spec.mode === 'both' ? (userSelectedMode ?? 'dark') : spec.mode === 'light' ? 'light' : 'dark';

  const rawHtml = useMemo(() => buildStyleTileHtml(spec, activeMode), [spec, activeMode]);
  const [debouncedHtml, setDebouncedHtml] = useState<string>(() => rawHtml);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce the iframe update by 250ms when rawHtml changes
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setDebouncedHtml(rawHtml);
    }, 250);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [rawHtml]);

  return (
    <div className={`relative rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--surface)] flex flex-col ${className}`}>
      {/* Mini header bar with theme switch */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--elevated)]/60 text-[11px] text-[var(--muted)]">
        <span className="font-mono text-[10px] tracking-wide uppercase">
          Style Tile • {spec.presetId}
        </span>
        {modeToggle && spec.mode === 'both' && (
          <div className="flex items-center gap-1 bg-[var(--surface)] p-0.5 rounded border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setUserSelectedMode('dark')}
              className={`p-1 rounded transition-colors ${
                activeMode === 'dark'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              title="Preview Dark Mode"
            >
              <Moon className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setUserSelectedMode('light')}
              className={`p-1 rounded transition-colors ${
                activeMode === 'light'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              title="Preview Light Mode"
            >
              <Sun className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Sandboxed iframe without allow-scripts and without allow-same-origin */}
      <iframe
        title="Style Tile Preview"
        sandbox=""
        srcDoc={debouncedHtml || rawHtml}
        style={{ height, width: '100%', border: 'none', display: 'block' }}
      />
    </div>
  );
}
