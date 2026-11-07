import { describe, it, expect } from 'vitest';
import {
  buildPreviewDocument,
  resolveRelativePath,
  detectUnsupportedStack,
  PREVIEW_CSP,
} from './buildPreview';

describe('buildPreview Document Compiler', () => {
  it('correctly resolves relative paths with ./, ../, and query/hash stripping', () => {
    expect(resolveRelativePath('index.html', './style.css')).toBe('style.css');
    expect(resolveRelativePath('index.html', 'style.css?v=2#top')).toBe('style.css');
    expect(resolveRelativePath('pages/about.html', '../style.css')).toBe('style.css');
    expect(resolveRelativePath('pages/deep/item.html', '../../js/app.js')).toBe('js/app.js');
    expect(resolveRelativePath('pages/about.html', '/root.css')).toBe('root.css');
  });

  it('inlines local CSS stylesheets and preserves external CDN links', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@4/dist/tailwind.min.css"><link rel="stylesheet" href="./style.css"></head><body><h1>Hello</h1></body></html>`,
      },
      {
        path: 'style.css',
        content: `h1 { color: red; } /* </style> test */`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.html).toContain('https://cdn.jsdelivr.net/npm/tailwindcss@4/dist/tailwind.min.css');
    expect(result.html).toContain('<style data-src="style.css">');
    expect(result.html).toContain('h1 { color: red; }');
    // </style inside content must be escaped as <\/style
    expect(result.html).toContain('<\\/style> test');
  });

  it('inlines classic script tags preserving order and escaping </script', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><script src="https://unpkg.com/alpinejs" defer></script><script src="app.js"></script></head><body></body></html>`,
      },
      {
        path: 'app.js',
        content: `console.log("</script> safe");`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.html).toContain('https://unpkg.com/alpinejs');
    expect(result.html).toContain('<script data-src="app.js">');
    expect(result.html).toContain('<\\/script> safe');
  });

  it('detects missing files and emits warnings without crashing', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="missing.css"><script src="missing.js"></script></head><body><img src="missing.svg"></body></html>`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    const missingCss = result.warnings.find((w) => w.message.includes('missing.css'));
    expect(missingCss).toBeDefined();
    expect(missingCss?.type).toBe('missing_file');
    // Document is still built cleanly
    expect(result.html).toContain('<!DOCTYPE html>');
  });

  it('detects circular imports and reports warning instead of hanging', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><script type="module" src="a.js"></script></head><body></body></html>`,
      },
      {
        path: 'a.js',
        content: `import { b } from './b.js'; export const a = 'a' + b;`,
      },
      {
        path: 'b.js',
        content: `import { a } from './a.js'; export const b = 'b' + a;`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const circularWarn = result.warnings.find((w) => w.type === 'circular_import');
    expect(circularWarn).toBeDefined();
    expect(circularWarn?.message).toContain('Circular import');
  });

  it('creates head and html wrapper for fragment templates', () => {
    const files = [
      {
        path: 'index.html',
        content: `<div class="p-4"><h1>Fragment</h1></div>`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('<head>');
    expect(result.html).toContain('<body');
    expect(result.html).toContain('<div class="p-4"><h1>Fragment</h1></div>');
  });

  it('ensures CSP meta tag and runtime script are the very first children in <head>', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><title>My App</title><meta charset="utf-8"></head><body><h1>Test</h1></body></html>`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html', { nonce: 'test_nonce_123' });
    const headIndex = result.html.indexOf('<head>');
    const cspIndex = result.html.indexOf('Content-Security-Policy');
    const runtimeIndex = result.html.indexOf('data-desyra-runtime="true"');
    const titleIndex = result.html.indexOf('<title>My App</title>');

    expect(cspIndex).toBeGreaterThan(headIndex);
    expect(runtimeIndex).toBeGreaterThan(headIndex);
    expect(titleIndex).toBeGreaterThan(runtimeIndex);
    expect(result.html).toContain(PREVIEW_CSP);
    expect(result.html).toContain('test_nonce_123');
  });

  it('detects unsupported frameworks and returns honest unsupported reason', () => {
    const reactProject = [
      { path: 'package.json', content: '{}' },
      { path: 'App.tsx', content: 'export default function App() {}' },
    ];
    const check = detectUnsupportedStack(reactProject);
    expect(check.isUnsupported).toBe(true);
    expect(check.detectedFiles).toContain('package.json');
    expect(check.detectedFiles).toContain('App.tsx');

    const result = buildPreviewDocument(
      [{ path: 'package.json', content: '{}' }],
      'index.html'
    );
    expect(result.unsupported?.isUnsupported).toBe(true);
  });

  it('converts local SVG files to data URIs in img tags and CSS url()', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><img src="./icon.svg" alt="icon"></body></html>`,
      },
      {
        path: 'icon.svg',
        content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"/></svg>`,
      },
      {
        path: 'style.css',
        content: `.badge { background: url('icon.svg'); }`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.html).toContain('src="data:image/svg+xml');
    expect(result.html).toContain('url("data:image/svg+xml');
  });

  it('is idempotent: compiling same input produces deterministic output', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><title>Title</title></head><body>Content</body></html>`,
      },
    ];

    const res1 = buildPreviewDocument(files, 'index.html', { nonce: 'fixed_nonce' });
    const res2 = buildPreviewDocument(files, 'index.html', { nonce: 'fixed_nonce' });
    expect(res1.html).toBe(res2.html);
  });
});
