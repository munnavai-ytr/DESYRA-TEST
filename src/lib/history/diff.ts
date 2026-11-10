/**
 * Pure line diff engine using prefix/suffix trimming + linear-space Myers O(ND).
 * Designed cleanly for DESYRA snapshot diffing and history inspection.
 */

import { computeUtf8ByteLength } from './hash';

export const MAX_DIFF_LINES = 4000;
export const DIFF_CONTEXT_LINES = 3;
export const COLLAPSE_UNCHANGED_THRESHOLD = 7;

export type DiffLineType = 'context' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
  leadingCollapsedCount: number;
  trailingCollapsedCount: number;
}

export interface DiffDisplayItem {
  kind: 'hunk' | 'collapsed';
  hunk?: DiffHunk;
  collapsedCount?: number;
  collapsedLines?: DiffLine[];
}

export interface LineDiffResult {
  tooLarge: boolean;
  isIdentical: boolean;
  isBinary?: boolean;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  lineCountBefore: number;
  lineCountAfter: number;
  byteSizeBefore: number;
  byteSizeAfter: number;
  hunks: DiffHunk[];
  displayItems: DiffDisplayItem[];
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitLinesNormalized(text: string): string[] {
  if (text === '') return [];
  return normalizeLineEndings(text).split('\n');
}

interface EditOp {
  type: 'equal' | 'add' | 'remove';
  aIndex: number;
  bIndex: number;
}

function findMiddleSnake(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number
): { startX: number; startY: number; endX: number; endY: number } {
  const N = aEnd - aStart;
  const M = bEnd - bStart;
  const maxD = Math.ceil((N + M) / 2);
  const offset = maxD + 2;
  const delta = N - M;
  const odd = (delta & 1) !== 0;

  const vf = new Int32Array(2 * maxD + 5);
  const vb = new Int32Array(2 * maxD + 5);
  vf.fill(-1);
  vb.fill(-1);
  vf[offset + 1] = 0;
  vb[offset + 1] = 0;

  for (let d = 0; d <= maxD; d++) {
    // Forward pass
    for (let k = -d; k <= d; k += 2) {
      const idx = offset + k;
      let x: number;
      if (k === -d || (k !== d && vf[idx - 1] < vf[idx + 1])) {
        x = vf[idx + 1];
      } else {
        x = vf[idx - 1] + 1;
      }
      let y = x - k;
      const startX = x;
      const startY = y;

      while (x < N && y < M && a[aStart + x] === b[bStart + y]) {
        x++;
        y++;
      }

      vf[idx] = x;

      if (odd && k >= delta - (d - 1) && k <= delta + (d - 1)) {
        const backK = k - delta;
        const backU = vb[offset + backK];
        if (backU >= 0 && x + backU >= N) {
          return {
            startX: aStart + startX,
            startY: bStart + startY,
            endX: aStart + x,
            endY: bStart + y,
          };
        }
      }
    }

    // Backward pass
    for (let c = -d; c <= d; c += 2) {
      const backIdx = offset + c;
      let u: number;
      if (c === -d || (c !== d && vb[backIdx - 1] < vb[backIdx + 1])) {
        u = vb[backIdx + 1];
      } else {
        u = vb[backIdx - 1] + 1;
      }
      let v = u - c;
      const endU = u;
      const endV = v;

      while (u < N && v < M && a[aStart + N - 1 - u] === b[bStart + M - 1 - v]) {
        u++;
        v++;
      }

      vb[backIdx] = u;

      if (!odd) {
        const fwdK = c + delta;
        if (fwdK >= -d && fwdK <= d) {
          const fwdX = vf[offset + fwdK];
          if (fwdX >= 0 && fwdX + u >= N) {
            return {
              startX: aStart + (N - u),
              startY: bStart + (M - v),
              endX: aStart + (N - endU),
              endY: bStart + (M - endV),
            };
          }
        }
      }
    }
  }

  return {
    startX: aStart,
    startY: bStart,
    endX: aStart,
    endY: bStart,
  };
}

function myersLinearSpace(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  ops: EditOp[]
): void {
  const N = aEnd - aStart;
  const M = bEnd - bStart;

  if (N === 0) {
    for (let j = bStart; j < bEnd; j++) {
      ops.push({ type: 'add', aIndex: aStart, bIndex: j });
    }
    return;
  }

  if (M === 0) {
    for (let i = aStart; i < aEnd; i++) {
      ops.push({ type: 'remove', aIndex: i, bIndex: bStart });
    }
    return;
  }

  if (N === 1 && M === 1 && a[aStart] !== b[bStart]) {
    ops.push({ type: 'remove', aIndex: aStart, bIndex: bStart });
    ops.push({ type: 'add', aIndex: aEnd, bIndex: bStart });
    return;
  }

  const snake = findMiddleSnake(a, aStart, aEnd, b, bStart, bEnd);
  const prefixSize = snake.startX - aStart + (snake.startY - bStart);
  const suffixSize = aEnd - snake.endX + (bEnd - snake.endY);
  const totalSize = N + M;

  // Belt-and-suspenders guard against degenerate non-shrinking split
  if (prefixSize >= totalSize && suffixSize >= totalSize) {
    ops.push({ type: 'remove', aIndex: aStart, bIndex: bStart });
    myersLinearSpace(a, aStart + 1, aEnd, b, bStart, bEnd, ops);
    return;
  }

  if (prefixSize < totalSize) {
    myersLinearSpace(a, aStart, snake.startX, b, bStart, snake.startY, ops);
  } else {
    ops.push({ type: 'remove', aIndex: aStart, bIndex: bStart });
    myersLinearSpace(a, aStart + 1, snake.startX, b, bStart, snake.startY, ops);
    return;
  }

  const snakeLen = snake.endX - snake.startX;
  for (let s = 0; s < snakeLen; s++) {
    ops.push({
      type: 'equal',
      aIndex: snake.startX + s,
      bIndex: snake.startY + s,
    });
  }

  if (suffixSize < totalSize) {
    myersLinearSpace(a, snake.endX, aEnd, b, snake.endY, bEnd, ops);
  }
}

/**
 * Groups flat DiffLines into hunks with context lines and collapses long unchanged runs (>= 7 lines).
 */
export function buildDiffHunks(
  allLines: DiffLine[],
  contextLines = DIFF_CONTEXT_LINES,
  collapseThreshold = COLLAPSE_UNCHANGED_THRESHOLD
): { hunks: DiffHunk[]; displayItems: DiffDisplayItem[] } {
  if (allLines.length === 0) {
    return { hunks: [], displayItems: [] };
  }

  const hasChanges = allLines.some((l) => l.type !== 'context');
  if (!hasChanges) {
    if (allLines.length >= collapseThreshold) {
      return {
        hunks: [],
        displayItems: [
          {
            kind: 'collapsed',
            collapsedCount: allLines.length,
            collapsedLines: allLines,
          },
        ],
      };
    }
    return {
      hunks: [
        {
          oldStart: allLines[0].oldLineNumber ?? 1,
          oldCount: allLines.length,
          newStart: allLines[0].newLineNumber ?? 1,
          newCount: allLines.length,
          lines: allLines,
          leadingCollapsedCount: 0,
          trailingCollapsedCount: 0,
        },
      ],
      displayItems: [
        {
          kind: 'hunk',
          hunk: {
            oldStart: allLines[0].oldLineNumber ?? 1,
            oldCount: allLines.length,
            newStart: allLines[0].newLineNumber ?? 1,
            newCount: allLines.length,
            lines: allLines,
            leadingCollapsedCount: 0,
            trailingCollapsedCount: 0,
          },
        },
      ],
    };
  }

  // Segment lines into alternating unchanged and changed spans
  interface Span {
    isChanged: boolean;
    start: number;
    end: number; // exclusive
  }

  const spans: Span[] = [];
  let cursor = 0;
  while (cursor < allLines.length) {
    const isChanged = allLines[cursor].type !== 'context';
    let end = cursor + 1;
    while (end < allLines.length && (allLines[end].type !== 'context') === isChanged) {
      end++;
    }
    spans.push({ isChanged, start: cursor, end });
    cursor = end;
  }

  // Build visibility bitmap for whether an unchanged line is kept as context or collapsed
  const keepLine = new Uint8Array(allLines.length);

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.isChanged) {
      for (let idx = span.start; idx < span.end; idx++) {
        keepLine[idx] = 1;
      }
      continue;
    }

    const len = span.end - span.start;
    const isLeading = i === 0;
    const isTrailing = i === spans.length - 1;

    if (isLeading) {
      if (len < collapseThreshold) {
        for (let idx = span.start; idx < span.end; idx++) keepLine[idx] = 1;
      } else {
        const keepFrom = Math.max(span.start, span.end - contextLines);
        for (let idx = keepFrom; idx < span.end; idx++) keepLine[idx] = 1;
      }
    } else if (isTrailing) {
      if (len < collapseThreshold) {
        for (let idx = span.start; idx < span.end; idx++) keepLine[idx] = 1;
      } else {
        const keepUntil = Math.min(span.end, span.start + contextLines);
        for (let idx = span.start; idx < keepUntil; idx++) keepLine[idx] = 1;
      }
    } else {
      // Interior unchanged span between two change spans
      if (len < collapseThreshold) {
        for (let idx = span.start; idx < span.end; idx++) keepLine[idx] = 1;
      } else {
        const keepStartUntil = Math.min(span.end, span.start + contextLines);
        for (let idx = span.start; idx < keepStartUntil; idx++) keepLine[idx] = 1;
        const keepEndFrom = Math.max(span.start, span.end - contextLines);
        for (let idx = keepEndFrom; idx < span.end; idx++) keepLine[idx] = 1;
      }
    }
  }

  const hunks: DiffHunk[] = [];
  const displayItems: DiffDisplayItem[] = [];

  let i = 0;
  while (i < allLines.length) {
    if (keepLine[i] === 0) {
      const start = i;
      while (i < allLines.length && keepLine[i] === 0) {
        i++;
      }
      const collapsedLines = allLines.slice(start, i);
      displayItems.push({
        kind: 'collapsed',
        collapsedCount: collapsedLines.length,
        collapsedLines,
      });
    } else {
      const start = i;
      while (i < allLines.length && keepLine[i] === 1) {
        i++;
      }
      const hunkLines = allLines.slice(start, i);
      let oldStart = 0;
      let oldCount = 0;
      let newStart = 0;
      let newCount = 0;

      for (const l of hunkLines) {
        if (l.oldLineNumber !== null) {
          if (oldStart === 0) oldStart = l.oldLineNumber;
          oldCount++;
        }
        if (l.newLineNumber !== null) {
          if (newStart === 0) newStart = l.newLineNumber;
          newCount++;
        }
      }

      const prevDisplay = displayItems[displayItems.length - 1];
      const leadingCollapsed =
        prevDisplay && prevDisplay.kind === 'collapsed' ? prevDisplay.collapsedCount ?? 0 : 0;

      const hunk: DiffHunk = {
        oldStart: oldStart || 1,
        oldCount,
        newStart: newStart || 1,
        newCount,
        lines: hunkLines,
        leadingCollapsedCount: leadingCollapsed,
        trailingCollapsedCount: 0,
      };
      hunks.push(hunk);
      displayItems.push({ kind: 'hunk', hunk });
    }
  }

  // Fill trailingCollapsedCount if there is a trailing collapsed block after the last hunk
  for (let d = 0; d < displayItems.length - 1; d++) {
    const curr = displayItems[d];
    const next = displayItems[d + 1];
    if (curr.kind === 'hunk' && curr.hunk && next.kind === 'collapsed') {
      curr.hunk.trailingCollapsedCount = next.collapsedCount ?? 0;
    }
  }

  return { hunks, displayItems };
}

/**
 * Computes line-by-line diff between two strings using prefix/suffix trimming + Myers O(ND).
 * Caps diff execution at MAX_DIFF_LINES (4,000 lines).
 */
export function computeLineDiff(beforeContent: string, afterContent: string): LineDiffResult {
  const byteSizeBefore = computeUtf8ByteLength(beforeContent);
  const byteSizeAfter = computeUtf8ByteLength(afterContent);

  const a = splitLinesNormalized(beforeContent);
  const b = splitLinesNormalized(afterContent);

  const lineCountBefore = a.length;
  const lineCountAfter = b.length;

  if (normalizeLineEndings(beforeContent) === normalizeLineEndings(afterContent)) {
    return {
      tooLarge: false,
      isIdentical: true,
      addedCount: 0,
      removedCount: 0,
      unchangedCount: lineCountBefore,
      lineCountBefore,
      lineCountAfter,
      byteSizeBefore,
      byteSizeAfter,
      hunks: [],
      displayItems: [],
    };
  }

  if (lineCountBefore > MAX_DIFF_LINES || lineCountAfter > MAX_DIFF_LINES) {
    return {
      tooLarge: true,
      isIdentical: false,
      addedCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      lineCountBefore,
      lineCountAfter,
      byteSizeBefore,
      byteSizeAfter,
      hunks: [],
      displayItems: [],
    };
  }

  // Prefix trimming
  let prefixLen = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefixLen < minLen && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }

  // Suffix trimming
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const allLines: DiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  // Common prefix lines
  for (let i = 0; i < prefixLen; i++) {
    unchangedCount++;
    allLines.push({
      type: 'context',
      oldLineNumber: i + 1,
      newLineNumber: i + 1,
      content: a[i],
    });
  }

  // Middle diff via linear-space Myers O(ND)
  const ops: EditOp[] = [];
  myersLinearSpace(
    a,
    prefixLen,
    a.length - suffixLen,
    b,
    prefixLen,
    b.length - suffixLen,
    ops
  );

  for (const op of ops) {
    if (op.type === 'equal') {
      unchangedCount++;
      allLines.push({
        type: 'context',
        oldLineNumber: op.aIndex + 1,
        newLineNumber: op.bIndex + 1,
        content: a[op.aIndex],
      });
    } else if (op.type === 'remove') {
      removedCount++;
      allLines.push({
        type: 'remove',
        oldLineNumber: op.aIndex + 1,
        newLineNumber: null,
        content: a[op.aIndex],
      });
    } else {
      addedCount++;
      allLines.push({
        type: 'add',
        oldLineNumber: null,
        newLineNumber: op.bIndex + 1,
        content: b[op.bIndex],
      });
    }
  }

  // Common suffix lines
  for (let s = 0; s < suffixLen; s++) {
    const aIdx = a.length - suffixLen + s;
    const bIdx = b.length - suffixLen + s;
    unchangedCount++;
    allLines.push({
      type: 'context',
      oldLineNumber: aIdx + 1,
      newLineNumber: bIdx + 1,
      content: a[aIdx],
    });
  }

  const { hunks, displayItems } = buildDiffHunks(allLines);

  return {
    tooLarge: false,
    isIdentical: false,
    addedCount,
    removedCount,
    unchangedCount,
    lineCountBefore,
    lineCountAfter,
    byteSizeBefore,
    byteSizeAfter,
    hunks,
    displayItems,
  };
}
