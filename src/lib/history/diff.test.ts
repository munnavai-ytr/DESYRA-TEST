import { describe, it, expect } from 'vitest';
import {
  computeLineDiff,
  MAX_DIFF_LINES,
  COLLAPSE_UNCHANGED_THRESHOLD,
} from './diff';

describe('Myers Linear-Space Line Diff Engine', () => {
  it('returns identical result when text matches', () => {
    const res = computeLineDiff('const a = 1;\nconst b = 2;\n', 'const a = 1;\nconst b = 2;\n');
    expect(res.isIdentical).toBe(true);
    expect(res.tooLarge).toBe(false);
    expect(res.addedCount).toBe(0);
    expect(res.removedCount).toBe(0);
    expect(res.hunks).toHaveLength(0);
    expect(res.displayItems).toHaveLength(0);
  });

  it('normalizes CRLF vs LF line endings cleanly without false diffs', () => {
    const res = computeLineDiff('line1\r\nline2\r\nline3', 'line1\nline2\nline3');
    expect(res.isIdentical).toBe(true);
    expect(res.addedCount).toBe(0);
    expect(res.removedCount).toBe(0);
  });

  it('handles empty-to-content and content-to-empty files cleanly', () => {
    const added = computeLineDiff('', 'first\nsecond\nthird');
    expect(added.isIdentical).toBe(false);
    expect(added.addedCount).toBe(3);
    expect(added.removedCount).toBe(0);
    expect(added.hunks).toHaveLength(1);
    expect(added.hunks[0].lines.every((l) => l.type === 'add')).toBe(true);
    expect(added.hunks[0].lines.map((l) => l.newLineNumber)).toEqual([1, 2, 3]);

    const removed = computeLineDiff('first\nsecond', '');
    expect(removed.isIdentical).toBe(false);
    expect(removed.addedCount).toBe(0);
    expect(removed.removedCount).toBe(2);
    expect(removed.hunks).toHaveLength(1);
    expect(removed.hunks[0].lines.every((l) => l.type === 'remove')).toBe(true);
    expect(removed.hunks[0].lines.map((l) => l.oldLineNumber)).toEqual([1, 2]);
  });

  it('computes accurate additions, removals, and moved lines with 3 context lines and collapsed runs', () => {
    const beforeLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const afterLines = [...beforeLines];
    // Modify line 10 and insert after line 25 (gap >= COLLAPSE_UNCHANGED_THRESHOLD of 7)
    afterLines[9] = 'modified line 10';
    afterLines.splice(25, 0, 'inserted near end');

    const res = computeLineDiff(beforeLines.join('\n'), afterLines.join('\n'));
    expect(res.isIdentical).toBe(false);
    expect(res.tooLarge).toBe(false);
    expect(res.addedCount).toBe(2);
    expect(res.removedCount).toBe(1);
    expect(res.hunks.length).toBe(2);

    // Leading, middle (>= 7 unchanged), and trailing regions should collapse
    const collapsedItems = res.displayItems.filter((item) => item.kind === 'collapsed');
    expect(collapsedItems.length).toBeGreaterThanOrEqual(2);
    for (const c of collapsedItems) {
      expect(c.collapsedCount ?? 0).toBeGreaterThan(0);
      expect(c.collapsedLines?.length).toBe(c.collapsedCount);
    }
  });

  it('keeps short unchanged spans (< 7 lines) uncollapsed inside a single hunk', () => {
    const before = [
      'line 1',
      'changed A',
      'mid 1',
      'mid 2',
      'mid 3',
      'mid 4',
      'changed B',
      'end 1',
    ].join('\n');
    const after = [
      'line 1',
      'changed A updated',
      'mid 1',
      'mid 2',
      'mid 3',
      'mid 4',
      'changed B updated',
      'end 1',
    ].join('\n');

    expect(COLLAPSE_UNCHANGED_THRESHOLD).toBe(7);
    const res = computeLineDiff(before, after);
    expect(res.hunks).toHaveLength(1);
    expect(res.displayItems.filter((d) => d.kind === 'collapsed')).toHaveLength(0);
  });

  it('guards files exceeding 4,000 lines and reports tooLarge without hanging', () => {
    const largeText = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `row ${i}`).join('\n');
    const res = computeLineDiff(largeText, `${largeText}\nextra`);
    expect(res.tooLarge).toBe(true);
    expect(res.isIdentical).toBe(false);
    expect(res.lineCountBefore).toBe(MAX_DIFF_LINES + 1);
    expect(res.lineCountAfter).toBe(MAX_DIFF_LINES + 2);
    expect(res.hunks).toHaveLength(0);
  });
});
