import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildPreviewDocument,
  resolveRelativePath,
  detectUnsupportedStack,
  PREVIEW_CSP,
  rewriteModuleSpecifiers,
  PreviewWarning,
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
    // Circular imports should produce NO warning with import maps
    const circularWarn = result.warnings.find((w) => w.type === 'circular_import');
    expect(circularWarn).toBeUndefined();

    // Verify import map is generated in head covering all modules
    expect(result.html).toContain('<script type="importmap">');
    const importMapMatch = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/i.exec(result.html);
    expect(importMapMatch).not.toBeNull();

    const parsedMap = JSON.parse(importMapMatch![1]);
    expect(parsedMap.imports).toBeDefined();
    expect(parsedMap.imports['@desyra/a.js']).toBeDefined();
    expect(parsedMap.imports['@desyra/b.js']).toBeDefined();
    expect(parsedMap.imports['@desyra/a.js']).toMatch(/^blob:/);
    expect(parsedMap.imports['@desyra/b.js']).toMatch(/^blob:/);
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

describe('Fix Push 6.2: Defer Semantics, SourceMap & Script Execution', () => {
  it('deferred classic script attaching click handler to button works in JSDOM', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <script defer src="app.js"></script>
</head>
<body>
  <button id="btn">Click me</button>
  <div id="out">initial</div>
</body>
</html>`,
      },
      {
        path: 'app.js',
        content: `const btn = document.getElementById('btn');
const out = document.getElementById('out');
btn.addEventListener('click', () => {
  out.textContent = 'clicked';
});`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const dom = new JSDOM(result.html, { runScripts: 'dangerously' });
    const doc = dom.window.document;
    const btn = doc.getElementById('btn') as HTMLButtonElement;
    const out = doc.getElementById('out');

    expect(btn).not.toBeNull();
    expect(out?.textContent).toBe('initial');
    btn.click();
    expect(out?.textContent).toBe('clicked');
  });

  it('two deferred local scripts and one external deferred script keep original relative order', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <script defer src="a.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/dummy@1/dummy.js"></script>
  <script defer src="b.js"></script>
</head>
<body>
  <h1>Order Test</h1>
</body>
</html>`,
      },
      { path: 'a.js', content: `window.order = (window.order || '') + 'A';` },
      { path: 'b.js', content: `window.order = (window.order || '') + 'B';` },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const aIdx = result.html.indexOf('data-src="a.js"');
    const cdnIdx = result.html.indexOf('src="https://cdn.jsdelivr.net/npm/dummy@1/dummy.js"');
    const bIdx = result.html.indexOf('data-src="b.js"');
    const bodyCloseIdx = result.html.indexOf('</body>');

    expect(aIdx).toBeGreaterThan(-1);
    expect(cdnIdx).toBeGreaterThan(aIdx);
    expect(bIdx).toBeGreaterThan(cdnIdx);
    expect(bIdx).toBeLessThan(bodyCloseIdx);

    const dom = new JSDOM(result.html, { runScripts: 'dangerously' });
    expect((dom.window as unknown as { order: string }).order).toBe('AB');
  });

  it('script placed at end of body without defer runs in place', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <div id="target">before</div>
  <script src="script.js"></script>
</body>
</html>`,
      },
      {
        path: 'script.js',
        content: `document.getElementById('target').textContent = 'after';`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const dom = new JSDOM(result.html, { runScripts: 'dangerously' });
    expect(dom.window.document.getElementById('target')?.textContent).toBe('after');
  });

  it('non-deferred classic script in head touching DOM produces null-reference error', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <script src="early.js"></script>
</head>
<body>
  <div id="elem">Hello</div>
</body>
</html>`,
      },
      {
        path: 'early.js',
        content: `try {
  document.getElementById('elem').textContent = 'early';
} catch (e) {
  window.earlyError = e.message;
}`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const headCloseIdx = result.html.indexOf('</head>');
    const scriptIdx = result.html.indexOf('data-src="early.js"');
    expect(scriptIdx).toBeLessThan(headCloseIdx);

    const dom = new JSDOM(result.html, { runScripts: 'dangerously' });
    expect((dom.window as unknown as { earlyError?: string }).earlyError).toBeDefined();
    expect(dom.window.document.getElementById('elem')?.textContent).toBe('Hello');
  });

  it('DOMContentLoaded listeners registered by deferred scripts fire correctly', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <script defer src="main.js"></script>
</head>
<body>
  <span id="status">pending</span>
</body>
</html>`,
      },
      {
        path: 'main.js',
        content: `document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('status').textContent = 'dom-ready';
});`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const dom = new JSDOM(result.html, { runScripts: 'dangerously' });
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    expect(dom.window.document.getElementById('status')?.textContent).toBe('dom-ready');
  });

  it('deferred scripts in resulting HTML have defer attribute stripped', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <script defer src="app.js"></script>
  <script defer src="https://cdn.example.com/lib.js"></script>
</head>
<body></body>
</html>`,
      },
      { path: 'app.js', content: `console.log('app');` },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    const dom = new JSDOM(result.html);
    const scripts = Array.from(dom.window.document.querySelectorAll('script'));
    for (const s of scripts) {
      if (s.getAttribute('data-src') === 'app.js' || s.getAttribute('src')?.includes('lib.js')) {
        expect(s.hasAttribute('defer')).toBe(false);
      }
    }
  });

  it('generated sourceMap has accurate line numbers matching inlined file contents', () => {
    const files = [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="style.css">
  <script defer src="app.js"></script>
</head>
<body>
  <h1>Test</h1>
</body>
</html>`,
      },
      {
        path: 'style.css',
        content: `h1 {\n  color: purple;\n}`,
      },
      {
        path: 'app.js',
        content: `const a = 1;\nconst b = 2;\nconsole.log(a + b);`,
      },
    ];

    const result = buildPreviewDocument(files, 'index.html');
    expect(result.sourceMap).toBeDefined();
    expect(result.sourceMap.entries.length).toBe(2);

    const styleEntry = result.sourceMap.entries.find((e) => e.path === 'style.css');
    const scriptEntry = result.sourceMap.entries.find((e) => e.path === 'app.js');

    expect(styleEntry).toBeDefined();
    expect(scriptEntry).toBeDefined();

    const lines = result.html.split('\n');
    const styleFirstLine = lines[styleEntry!.startLine - 1];
    expect(styleFirstLine).toBe('h1 {');

    const scriptFirstLine = lines[scriptEntry!.startLine - 1];
    expect(scriptFirstLine).toBe('const a = 1;');
  });
});

describe('0.1 rewriteModuleSpecifiers: masking, non-import strings & missing file warnings', () => {
  const existingFiles = [
    { path: 'js/main.js', content: '' },
    { path: 'js/ui.js', content: 'export const render = () => {};' },
    { path: 'js/setup.js', content: 'console.log("setup");' },
  ];

  it('keeps import text inside normal strings unchanged while rewriting real import next to it', () => {
    const warnings: PreviewWarning[] = [];
    const code = `
const exampleSnippet = "import { x } from './ui.js'";
import { render } from './ui.js';
const anotherString = 'export * from "./ui.js"';
`;
    const res = rewriteModuleSpecifiers(code, 'js/main.js', existingFiles, warnings);
    expect(res).toContain('const exampleSnippet = "import { x } from \'./ui.js\'";');
    expect(res).toContain("import { render } from '@desyra/js/ui.js';");
    expect(res).toContain('const anotherString = \'export * from "./ui.js"\';');
    expect(warnings.length).toBe(0);
  });

  it('keeps template literals containing import-like code untouched', () => {
    const warnings: PreviewWarning[] = [];
    const code = 'const doc = `import(\'./a.js\') inside template`;\nimport "./setup.js";';
    const res = rewriteModuleSpecifiers(code, 'js/main.js', existingFiles, warnings);
    expect(res).toContain("const doc = `import('./a.js') inside template`;");
    expect(res).toContain('import "@desyra/js/setup.js";');
    expect(warnings.length).toBe(0);
  });

  it('leaves specifier unchanged and produces clear warning when target file is missing', () => {
    const warnings: PreviewWarning[] = [];
    const code = `import { missingThing } from './missing.js';`;
    const res = rewriteModuleSpecifiers(code, 'js/main.js', existingFiles, warnings);
    expect(res).toContain(`import { missingThing } from './missing.js';`);
    expect(warnings.length).toBe(1);
    expect(warnings[0].type).toBe('missing_file');
    expect(warnings[0].message).toBe("js/main.js imports './missing.js' but the file does not exist");
  });
});
