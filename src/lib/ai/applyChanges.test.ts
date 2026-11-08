import { describe, it, expect } from 'vitest';
import { applySearchReplaceToContent } from './applyChanges';

describe('applySearchReplaceToContent', () => {
  it('performs exact match replacement', () => {
    const original = `function greet() {\n  console.log("hello");\n}`;
    const blocks = [
      {
        search: `  console.log("hello");`,
        replace: `  console.log("world");`,
      },
    ];

    const res = applySearchReplaceToContent(original, blocks);
    expect(res.success).toBe(true);
    expect(res.newContent).toBe(`function greet() {\n  console.log("world");\n}`);
  });

  it('performs fallback replacement ignoring trailing whitespace and CRLF vs LF', () => {
    // Original has trailing whitespace and CRLF
    const original = `function add(a, b) {   \r\n  return a + b;  \r\n}`;
    // Search has LF and no trailing spaces
    const blocks = [
      {
        search: `function add(a, b) {\n  return a + b;\n}`,
        replace: `function add(a, b) {\n  return Number(a) + Number(b);\n}`,
      },
    ];

    const res = applySearchReplaceToContent(original, blocks);
    expect(res.success).toBe(true);
    expect(res.newContent).toContain('Number(a) + Number(b)');
  });

  it('fails gracefully and does not modify text if search block cannot be matched', () => {
    const original = `const x = 10;`;
    const blocks = [
      {
        search: `const y = 20;`,
        replace: `const y = 30;`,
      },
    ];

    const res = applySearchReplaceToContent(original, blocks);
    expect(res.success).toBe(false);
    expect(res.reason).toBe("The original text wasn't found");
  });
});
