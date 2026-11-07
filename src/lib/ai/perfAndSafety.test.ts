import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  countNewlines,
  createStreamingProtocolParser,
  parseProtocol,
  type ProtocolEvent,
} from './fileProtocol';
import { aiFileStore, CONTENT_THROTTLE_MS } from './aiFileStore';
import { safeHtmlToMarkdown } from './safeHtmlToMarkdown';

describe('Fix Push 5.1 Test Suite', () => {
  describe('1. Incremental Line Counter (countNewlines)', () => {
    it('counts newlines correctly without array allocations', () => {
      expect(countNewlines('')).toBe(0);
      expect(countNewlines('hello world')).toBe(0);
      expect(countNewlines('hello\nworld')).toBe(1);
      expect(countNewlines('one\ntwo\nthree\n')).toBe(3);
      expect(countNewlines('\n\n\n')).toBe(3);
    });

    it('handles CRLF and LF consistently across chunks', () => {
      const chunks = ['line 1\r\n', 'line 2\n', 'line 3\r\nline 4\n'];
      let totalLines = 0;
      for (const chunk of chunks) {
        totalLines += countNewlines(chunk);
      }
      expect(totalLines).toBe(4);
    });
  });

  describe('2. Throttled Store Notifications (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      aiFileStore.clearAllWritingForProject('proj_test');
    });

    afterEach(() => {
      vi.useRealTimers();
      aiFileStore.clearAllWritingForProject('proj_test');
    });

    it('throttles content notifications to at most once per 250ms', () => {
      const contentEvents: Array<{ content: string; chunk: string }> = [];
      const projectId = 'proj_test';
      const path = 'app.js';

      aiFileStore.setFileWriting(projectId, path, '');

      const unsubscribe = aiFileStore.subscribeContent(
        projectId,
        path,
        (content, chunk) => {
          contentEvents.push({ content, chunk });
        }
      );

      // Rapidly append 5 chunks within 100ms
      aiFileStore.appendFileContent(projectId, path, 'const a = 1;\n');
      vi.advanceTimersByTime(20);
      aiFileStore.appendFileContent(projectId, path, 'const b = 2;\n');
      vi.advanceTimersByTime(20);
      aiFileStore.appendFileContent(projectId, path, 'const c = 3;\n');

      // First batch is scheduled for CONTENT_THROTTLE_MS
      expect(contentEvents.length).toBeLessThanOrEqual(1);

      // Advance by full throttle window
      vi.advanceTimersByTime(CONTENT_THROTTLE_MS);

      // Should have emitted coalesced chunks
      expect(contentEvents.length).toBe(1);
      expect(contentEvents[0].content).toBe('const a = 1;\nconst b = 2;\nconst c = 3;\n');

      // Append another chunk and advance
      aiFileStore.appendFileContent(projectId, path, 'const d = 4;\n');
      vi.advanceTimersByTime(CONTENT_THROTTLE_MS);

      expect(contentEvents.length).toBe(2);
      expect(contentEvents[1].content).toContain('const d = 4;\n');

      unsubscribe();
    });

    it('flushes pending content immediately on clearFileWriting', () => {
      const contentEvents: Array<{ content: string; chunk: string }> = [];
      const projectId = 'proj_test';
      const path = 'index.html';

      aiFileStore.setFileWriting(projectId, path, '');
      const unsubscribe = aiFileStore.subscribeContent(projectId, path, (content, chunk) => {
        contentEvents.push({ content, chunk });
      });

      aiFileStore.appendFileContent(projectId, path, '<div>Hello</div>');
      expect(contentEvents.length).toBe(0);

      // Calling clearFileWriting must flush immediately without waiting for timer
      aiFileStore.clearFileWriting(projectId, path);
      expect(contentEvents.length).toBe(1);
      expect(contentEvents[0].chunk).toBe('<div>Hello</div>');

      unsubscribe();
    });
  });

  describe('3. HTML-to-Markdown Defensive Converter (safeHtmlToMarkdown)', () => {
    it('translates common block HTML tags to Markdown', () => {
      const input = `<div><h3>Project Overview</h3><p>Here is <strong>important</strong> info and <em>emphasis</em>.</p><ul><li>Item 1</li><li>Item 2</li></ul><br><a href="https://example.com">Visit site</a></div>`;
      const output = safeHtmlToMarkdown(input);

      expect(output).toContain('### Project Overview');
      expect(output).toContain('**important**');
      expect(output).toContain('*emphasis*');
      expect(output).toContain('- Item 1');
      expect(output).toContain('- Item 2');
      expect(output).toContain('[Visit site](https://example.com)');
      expect(output).not.toContain('<div>');
      expect(output).not.toContain('</div>');
      expect(output).not.toContain('<p>');
      expect(output).not.toContain('</p>');
    });

    it('strips dangerous script and style tags', () => {
      const dangerous = `Hello <script>alert("hack")</script><style>body { display: none; }</style>World`;
      const clean = safeHtmlToMarkdown(dangerous);
      expect(clean).toBe('Hello World');
      expect(clean).not.toContain('alert');
      expect(clean).not.toContain('display: none');
    });

    it('preserves fenced code blocks untouched without altering HTML inside', () => {
      const raw = `Here is a code snippet:
\`\`\`html
<div class="card">
  <p>Do not alter this HTML!</p>
</div>
\`\`\`
And here is regular explanation with <strong>bold</strong> text.`;

      const converted = safeHtmlToMarkdown(raw);
      expect(converted).toContain('<div class="card">');
      expect(converted).toContain('<p>Do not alter this HTML!</p>');
      expect(converted).toContain('**bold**');
    });
  });

  describe('4. Parser Linearity (1 MB input in chunks < 500ms)', () => {
    it('processes a 1 MB stream in chunks in well under 500ms with linear time complexity', () => {
      const oneKbLine = 'A'.repeat(99) + '\n'; // 100 bytes per line
      const totalLines = 10490; // ~1.05 MB of text
      const fullBody = oneKbLine.repeat(totalLines);
      const totalBytes = fullBody.length;
      expect(totalBytes).toBeGreaterThanOrEqual(1024 * 1024); // >= 1 MB

      const chunkSize = 2048; // 2 KB chunks
      const events: ProtocolEvent[] = [];
      const parser = createStreamingProtocolParser((event) => {
        events.push(event);
      });

      const startTime = performance.now();

      parser.feed('<desyra-file path="large-file.txt">\n');

      for (let offset = 0; offset < fullBody.length; offset += chunkSize) {
        const slice = fullBody.slice(offset, offset + chunkSize);
        parser.feed(slice);
      }

      parser.feed('\n</desyra-file>');
      parser.end();

      const elapsedMs = performance.now() - startTime;

      // Verification
      const fileStart = events.find((e) => e.type === 'fileStart');
      const fileEnd = events.find((e) => e.type === 'fileEnd');
      const fileChunks = events.filter((e) => e.type === 'fileChunk');

      expect(fileStart).toEqual({ type: 'fileStart', path: 'large-file.txt' });
      expect(fileEnd).toEqual({ type: 'fileEnd', path: 'large-file.txt' });

      const totalReceived = fileChunks.reduce(
        (sum, c) => sum + (c.type === 'fileChunk' ? c.text.length : 0),
        0
      );
      expect(totalReceived).toBe(totalBytes);

      // Must complete in well under 500ms
      expect(elapsedMs).toBeLessThan(500);
    });
  });
});
