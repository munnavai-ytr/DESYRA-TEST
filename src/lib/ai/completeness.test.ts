import { describe, it, expect } from 'vitest';
import {
  findMissingReferences,
  checkCompleteness,
  buildContinueMessage,
} from './completeness';
import { resolveMaxOutputTokens } from './index';

describe('Fix Push 6.3 - Completeness Verification & Missing References', () => {
  it('detects missing files referenced in HTML and suggests similar files', () => {
    const files = [
      {
        path: 'index.html',
        content: `
          <!DOCTYPE html>
          <html>
            <head>
              <link rel="stylesheet" href="style.css">
              <script src="script.js"></script>
            </head>
            <body>
              <img src="images/logo.png">
            </body>
          </html>
        `,
      },
      {
        path: 'styles.css', // Note the 's'
        content: 'body { margin: 0; }',
      },
    ];

    const missing = findMissingReferences(files);
    expect(missing).toHaveLength(3);

    const styleIssue = missing.find((m) => m.targetPath === 'style.css');
    expect(styleIssue).toBeDefined();
    expect(styleIssue?.sourceFile).toBe('index.html');
    expect(styleIssue?.similarFileHint).toBe('styles.css');

    const scriptIssue = missing.find((m) => m.targetPath === 'script.js');
    expect(scriptIssue).toBeDefined();

    const logoIssue = missing.find((m) => m.targetPath === 'images/logo.png');
    expect(logoIssue).toBeDefined();
  });

  it('masks JS template literals in HTML so ${...} expressions are never treated as real files', () => {
    const files = [
      {
        path: 'index.html',
        content: `
          <!DOCTYPE html>
          <html>
            <head></head>
            <body>
              <script>
                const cs = { image: 'hero.png' };
                const html = \`<img src="\${cs.image}">\`;
              </script>
            </body>
          </html>
        `,
      },
    ];

    const missing = findMissingReferences(files);
    expect(missing).toHaveLength(0);
  });

  it('ignores external URLs, data URLs, blobs, hashes, and protocol-relative links', () => {
    const files = [
      {
        path: 'index.html',
        content: `
          <!DOCTYPE html>
          <html>
            <head>
              <link rel="stylesheet" href="https://cdn.tailwindcss.com">
              <script src="//unpkg.com/alpinejs"></script>
            </head>
            <body>
              <img src="data:image/svg+xml;base64,...">
              <a href="#about">About</a>
              <a href="mailto:test@example.com">Contact</a>
            </body>
          </html>
        `,
      },
    ];

    const missing = findMissingReferences(files);
    expect(missing).toHaveLength(0);
  });

  it('scans CSS @import and url() references', () => {
    const files = [
      {
        path: 'style.css',
        content: `
          @import url("components/button.css");
          .hero { background-image: url('assets/banner.jpg'); }
        `,
      },
    ];

    const missing = findMissingReferences(files);
    expect(missing.map((m) => m.targetPath).sort()).toEqual([
      'assets/banner.jpg',
      'components/button.css',
    ]);
  });

  it('scans JS ES module relative imports and export specifiers', () => {
    const files = [
      {
        path: 'main.js',
        content: `
          import { renderHeader } from './header.js';
          export * from './footer.js';
          const mod = await import('./dynamic.js');
        `,
      },
    ];

    const missing = findMissingReferences(files);
    expect(missing.map((m) => m.targetPath).sort()).toEqual([
      'dynamic.js',
      'footer.js',
      'header.js',
    ]);
  });
});

describe('checkCompleteness logic', () => {
  it('detects truncation on length or interrupted finish reasons', () => {
    const issues = checkCompleteness({
      finishReason: 'length',
      projectFiles: [{ path: 'index.html', content: '<h1>Hello</h1>' }],
    });

    expect(issues.some((i) => i.type === 'truncated')).toBe(true);
  });

  it('detects unterminated file writes', () => {
    const issues = checkCompleteness({
      operations: [
        { path: 'app.js', op: 'file', status: 'writing' },
        { path: 'index.html', op: 'file', status: 'created' },
      ],
      projectFiles: [
        { path: 'index.html', content: '<h1>Hello</h1>' },
        { path: 'app.js', content: 'const a = 1;' },
      ],
    });

    const fileIssue = issues.find(
      (i) => i.type === 'incomplete_file' && i.path === 'app.js'
    );
    expect(fileIssue).toBeDefined();
  });
});

describe('buildContinueMessage format', () => {
  it('builds numbered continuation instructions with existing files listed', () => {
    const issues = [
      {
        type: 'incomplete_file' as const,
        path: 'app.js',
        details: 'cut off',
      },
      {
        type: 'missing_reference' as const,
        path: 'style.css',
        sourceFile: 'index.html',
      },
    ];

    const projectFiles = [{ path: 'index.html' }, { path: 'app.js' }];

    const msg = buildContinueMessage(issues, projectFiles);

    expect(msg).toContain('Your previous answer was incomplete.');
    expect(msg).toContain('Re-send each incomplete file COMPLETELY with <desyra-file>');
    expect(msg).toContain('app.js');
    expect(msg).toContain('Create these missing files that are referenced but do not exist: style.css');
    expect(msg).toContain('Do not repeat files that are already complete.');
    expect(msg).toContain('Keep each file under about 250 lines');
  });

  it('builds continuation prompt for pure truncation without missing files', () => {
    const issues = [
      {
        type: 'truncated' as const,
        details: 'Output limit reached',
      },
    ];

    const projectFiles = [{ path: 'index.html' }, { path: 'style.css' }];
    const msg = buildContinueMessage(issues, projectFiles);

    expect(msg).toContain('Continue exactly where you stopped');
    expect(msg).toContain('index.html, style.css');
  });

  it('detects design issues when projectDesign is present: missing links, Tailwind CDN, emojis, hardcoded colors', () => {
    const mockSpec: any = {
      archetypeId: 'saas',
      presetId: 'minimal',
      tokens: {
        googleFontsHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      },
    };

    const files = [
      {
        path: 'index.html',
        content: `
          <!DOCTYPE html>
          <html>
            <head>
              <script src="https://cdn.tailwindcss.com"></script>
              <link rel="stylesheet" href="custom.css">
            </head>
            <body>
              <button>🚀 Launch</button>
            </body>
          </html>
        `,
      },
      {
        path: 'custom.css',
        content: `
          .custom { color: #ff5500; background: #223344; }
        `,
      },
    ];

    const issues = checkCompleteness({
      projectFiles: files,
      projectDesign: mockSpec,
    });

    const designIssues = issues.filter((i) => i.type === 'design_issue');
    expect(designIssues.length).toBeGreaterThanOrEqual(3);

    // Missing design system links in head
    const linkIssue = designIssues.find((i) => i.details?.includes('design system CSS links'));
    expect(linkIssue).toBeDefined();

    // Tailwind CDN detected
    const tailwindIssue = designIssues.find((i) => i.details?.includes('Tailwind CDN'));
    expect(tailwindIssue).toBeDefined();

    // Emoji icon detected
    const emojiIssue = designIssues.find((i) => i.details?.includes('Emoji used as button'));
    expect(emojiIssue).toBeDefined();

    // Hardcoded colors in custom.css
    const colorIssue = designIssues.find((i) => i.path === 'custom.css' && i.details?.includes('hardcoded color'));
    expect(colorIssue).toBeDefined();

    // Verify buildContinueMessage output
    const continueMsg = buildContinueMessage(designIssues, [{ path: 'index.html' }, { path: 'custom.css' }], mockSpec);
    expect(continueMsg).toContain('Your previous build needs attention');
    expect(continueMsg).toContain('<link rel="stylesheet" href="css/tokens.css">');
    expect(continueMsg).toContain('<link rel="stylesheet" href="css/base.css">');
    expect(continueMsg).toContain('<link rel="stylesheet" href="css/components.css">');
    expect(continueMsg).toContain('<desyra-edit>');
    expect(continueMsg).toContain('Replace all utility/Tailwind classes with DESYRA component classes');
    expect(continueMsg).toContain('Lucide SVG icons');
    expect(continueMsg).toContain('CRITICAL: Do NOT modify or recreate managed files');
  });
});
