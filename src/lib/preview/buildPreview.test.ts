import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildPreviewDocument,
  resolveRelativePath,
  detectUnsupportedStack,
  PREVIEW_CSP,
} from './buildPreview';
import { escapeScriptJson } from './runtime';
import { applySearchReplaceToContent } from '../ai/applyChanges';

describe('buildPreview Document Compiler & Fix Push 6.1 Regression Suite', () => {
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
    expect(result.html).toContain('<\\/style> test');
  });

  it('does not touch tag-like strings inside inline scripts and produces valid DOM', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html lang="en"><head><title>Portfolio</title><link rel="stylesheet" href="style.css"></head><body><div id="app">Skip to main content</div><script>const cs = { image: "hero.png" }; const html = \`<img src="\${cs.image}">\`; const l = \`<link rel="stylesheet" href="styles.css">\`;</script></body></html>`,
      },
      {
        path: 'style.css',
        content: `body { background: #000; }`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.warnings.length).toBe(0);

    const dom = new JSDOM(result.html);
    const doc = dom.window.document;

    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.head.firstElementChild?.tagName.toLowerCase()).toBe('meta');
    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');

    const styleEl = doc.querySelector('style[data-src="style.css"]');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('background: #000');

    expect(doc.body.textContent).not.toContain('<html');
    expect(doc.body.textContent).not.toContain('lang=');
    expect(doc.body.textContent).toContain('Skip to main content');
  });

  it('safely embeds initial storage values containing $, quotes, </script>, <!-- and U+2028', () => {
    const trickyStorage = {
      price: "Price $& and $' and $$ and $1",
      scriptTag: "</script><script>alert(1)</script>",
      commentTag: "<!-- <head> test -->",
      lineSeparator: "Line 1\u2028Line 2\u2029End",
    };

    const escaped = escapeScriptJson(trickyStorage);
    expect(escaped).not.toContain('</script>');
    expect(escaped).not.toContain('<!--');

    const unescaped = JSON.parse(escaped);
    expect(unescaped.price).toBe("Price $& and $' and $$ and $1");
    expect(unescaped.scriptTag).toBe("</script><script>alert(1)</script>");
    expect(unescaped.commentTag).toBe("<!-- <head> test -->");
    expect(unescaped.lineSeparator).toBe("Line 1\u2028Line 2\u2029End");

    const files = [{ path: 'index.html', content: '<h1>Test Storage</h1>' }];
    const result = buildPreviewDocument(files, 'index.html', {
      initialStorage: trickyStorage,
    });

    const dom = new JSDOM(result.html);
    expect(dom.window.document.querySelector('h1')?.textContent).toBe('Test Storage');
  });

  it('applySearchReplaceToContent handles $ replacement sequences literally in exact and fallback paths', () => {
    const content = `function getPrice() {\n  return 100;\n}`;
    const blocks = [
      {
        search: `return 100;`,
        replace: `return "Price $& and $' and $$ and $1";`,
      },
    ];

    const exactRes = applySearchReplaceToContent(content, blocks);
    expect(exactRes.success).toBe(true);
    expect(exactRes.newContent).toContain(`return "Price $& and $' and $$ and $1";`);

    // Fallback match with trailing whitespace
    const contentWithSpace = `function getPrice() {\n  return 100;   \n}`;
    const fallbackRes = applySearchReplaceToContent(contentWithSpace, blocks);
    expect(fallbackRes.success).toBe(true);
    expect(fallbackRes.newContent).toContain(`return "Price $& and $' and $$ and $1";`);
  });

  it('handles uppercase tags, missing <head>, missing <html>, comments with <head>, <style> with </, <title> with <, and stray text before doctype', () => {
    const rawHtml = `Stray Text Before Doctype
<!DOCTYPE HTML>
<HTML LANG="en">
<!-- <HEAD> comment inside head </HEAD> -->
<BODY>
  <TITLE>Title < with bracket</TITLE>
  <STYLE> p { content: "</style>"; } </STYLE>
  <P>Hello World</P>
</BODY>
</HTML>`;

    const result = buildPreviewDocument([{ path: 'index.html', content: rawHtml }], 'index.html');
    const dom = new JSDOM(result.html);
    const doc = dom.window.document;

    expect(doc.querySelector('p')?.textContent).toBe('Hello World');
    expect(doc.head).not.toBeNull();
    expect(result.html).toContain('Content-Security-Policy');
  });

  it('emits a clear similar-file warning when index.html links to styles.css but only style.css exists', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body></body></html>`,
      },
      {
        path: 'style.css',
        content: `body { color: blue; }`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const similarWarn = result.warnings.find((w) => w.message.includes('links to styles.css, but only style.css exists'));
    expect(similarWarn).toBeDefined();
    expect(similarWarn?.type).toBe('missing_file');
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
