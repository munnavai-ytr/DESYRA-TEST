import { describe, it, expect } from 'vitest';
import {
  createStreamingProtocolParser,
  parseProtocol,
  parseSearchReplaceBlocks,
  stripProtocolNewlines,
  type ProtocolEvent,
} from './fileProtocol';

describe('fileProtocol Parser', () => {
  it('handles normal file', () => {
    const raw = `Here is your file:\n\n<desyra-file path="index.html">\n<!DOCTYPE html>\n<html>\n  <body>Hello</body>\n</html>\n</desyra-file>\nEnjoy!`;
    const events = parseProtocol(raw);

    const fileStart = events.find((e) => e.type === 'fileStart');
    const fileChunks = events.filter((e) => e.type === 'fileChunk');
    const fileEnd = events.find((e) => e.type === 'fileEnd');

    expect(fileStart).toEqual({ type: 'fileStart', path: 'index.html' });
    expect(fileEnd).toEqual({ type: 'fileEnd', path: 'index.html' });

    const totalContent = fileChunks.map((c) => (c.type === 'fileChunk' ? c.text : '')).join('');
    expect(totalContent).toBe('<!DOCTYPE html>\n<html>\n  <body>Hello</body>\n</html>');
  });

  it('handles split tags across chunks', () => {
    const events: ProtocolEvent[] = [];
    const parser = createStreamingProtocolParser((e) => events.push(e));

    // Chunk splits across <desyra-file path="..." >
    parser.feed('Here is ');
    parser.feed('<des');
    parser.feed('yra-fi');
    parser.feed('le path="s');
    parser.feed('tyle.css">');
    parser.feed('\nbody { color: red; }\n');
    parser.feed('</desy');
    parser.feed('ra-file>');
    parser.feed(' All done!');
    parser.end();

    const fileStart = events.find((e) => e.type === 'fileStart');
    const fileEnd = events.find((e) => e.type === 'fileEnd');
    const chunks = events.filter((e) => e.type === 'fileChunk');
    const texts = events.filter((e) => e.type === 'text');

    expect(fileStart).toEqual({ type: 'fileStart', path: 'style.css' });
    expect(fileEnd).toEqual({ type: 'fileEnd', path: 'style.css' });

    const totalContent = chunks.map((c) => (c.type === 'fileChunk' ? c.text : '')).join('');
    expect(totalContent).toBe('body { color: red; }');

    const totalProse = texts.map((t) => (t.type === 'text' ? t.text : '')).join('');
    expect(totalProse).toContain('Here is ');
    expect(totalProse).toContain(' All done!');
    // Partial tag characters should not leak into prose
    expect(totalProse).not.toContain('<des');
    expect(totalProse).not.toContain('yra-fi');
  });

  it('handles multiple files in one stream', () => {
    const raw = `<desyra-file path="a.txt">Content A</desyra-file>\nBetween\n<desyra-file path="b.txt">Content B</desyra-file>`;
    const events = parseProtocol(raw);

    const fileStarts = events.filter((e) => e.type === 'fileStart');
    expect(fileStarts).toHaveLength(2);
    expect(fileStarts[0]).toEqual({ type: 'fileStart', path: 'a.txt' });
    expect(fileStarts[1]).toEqual({ type: 'fileStart', path: 'b.txt' });
  });

  it('handles edit blocks with single and multiple SEARCH/REPLACE sections', () => {
    const raw = `<desyra-edit path="app.js">
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
<<<<<<< SEARCH
const b = 3;
=======
const b = 4;
>>>>>>> REPLACE
</desyra-edit>`;

    const events = parseProtocol(raw);
    const editStart = events.find((e) => e.type === 'editStart');
    const editEnd = events.find((e) => e.type === 'editEnd');

    expect(editStart).toEqual({ type: 'editStart', path: 'app.js' });
    expect(editEnd?.type).toBe('editEnd');

    if (editEnd && editEnd.type === 'editEnd') {
      expect(editEnd.blocks).toHaveLength(2);
      expect(editEnd.blocks[0]).toEqual({
        search: 'const a = 1;',
        replace: 'const a = 2;',
      });
      expect(editEnd.blocks[1]).toEqual({
        search: 'const b = 3;',
        replace: 'const b = 4;',
      });
    }
  });

  it('handles delete tags (self-closing and explicit close)', () => {
    const raw1 = `<desyra-delete path="obsolete.js" />`;
    const events1 = parseProtocol(raw1);
    expect(events1).toContainEqual({ type: 'delete', path: 'obsolete.js' });

    const raw2 = `<desyra-delete path="unused.css"></desyra-delete>`;
    const events2 = parseProtocol(raw2);
    expect(events2).toContainEqual({ type: 'delete', path: 'unused.css' });
  });

  it('handles unterminated stream when user stops or network drops mid-file', () => {
    const events: ProtocolEvent[] = [];
    const parser = createStreamingProtocolParser((e) => events.push(e));

    parser.feed('<desyra-file path="main.py">\nprint("partial code');
    // Stream ends without closing tag
    parser.end();

    const unterminated = events.find((e) => e.type === 'unterminated');
    const fileEnd = events.find((e) => e.type === 'fileEnd');

    expect(unterminated).toEqual({
      type: 'unterminated',
      tagType: 'file',
      path: 'main.py',
    });
    expect(fileEnd).toEqual({ type: 'fileEnd', path: 'main.py' });
  });

  it('preserves </div> and markdown code fences inside file content untouched', () => {
    const raw = `<desyra-file path="component.tsx">
import React from 'react';

export function Card() {
  return (
    <div className="card">
      <p>Hello world</p>
    </div>
  );
}

// Markdown in comments:
// \`\`\`tsx
// <Card />
// \`\`\`
</desyra-file>`;

    const events = parseProtocol(raw);
    const fileChunks = events.filter((e) => e.type === 'fileChunk');
    const totalContent = fileChunks.map((c) => (c.type === 'fileChunk' ? c.text : '')).join('');

    expect(totalContent).toContain('<div className="card">');
    expect(totalContent).toContain('</div>');
    expect(totalContent).toContain('```tsx');
  });

  it('handles CRLF line endings', () => {
    const raw = `<desyra-file path="crlf.txt">\r\nLine 1\r\nLine 2\r\n</desyra-file>`;
    const events = parseProtocol(raw);
    const fileChunks = events.filter((e) => e.type === 'fileChunk');
    const totalContent = fileChunks.map((c) => (c.type === 'fileChunk' ? c.text : '')).join('');

    expect(totalContent).toBe('Line 1\r\nLine 2');
  });

  it('reports unknown <desyra- tags as protocolError without crashing', () => {
    const raw = `Hello <desyra-magic foo="bar">World`;
    const events = parseProtocol(raw);
    const errorEvent = events.find((e) => e.type === 'protocolError');

    expect(errorEvent).toBeDefined();
    expect(errorEvent?.type).toBe('protocolError');
  });
});
