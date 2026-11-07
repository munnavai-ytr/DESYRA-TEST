/**
 * DESYRA File Protocol Parser
 * Contract:
 * - <desyra-file path="file.ext">content</desyra-file>
 * - <desyra-edit path="file.ext"><<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE</desyra-edit>
 * - <desyra-delete path="file.ext" /> or <desyra-delete path="file.ext"></desyra-delete>
 */

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export type ProtocolEvent =
  | { type: 'text'; text: string }
  | { type: 'fileStart'; path: string }
  | { type: 'fileChunk'; path: string; text: string }
  | { type: 'fileEnd'; path: string }
  | { type: 'editStart'; path: string }
  | { type: 'editEnd'; path: string; blocks: SearchReplaceBlock[] }
  | { type: 'delete'; path: string }
  | { type: 'protocolError'; message: string }
  | { type: 'unterminated'; tagType: 'file' | 'edit'; path: string };

export interface StreamingProtocolParser {
  feed: (chunk: string) => void;
  end: () => void;
}

type ParserState = 'OUTSIDE' | 'IN_FILE' | 'IN_EDIT';

/**
 * Extracts attribute value (e.g. path="foo" or path='foo')
 */
export function extractPathAttribute(tagText: string): string | null {
  const match = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Parses search/replace blocks from edit body text
 */
export function parseSearchReplaceBlocks(body: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  // Standard aider SEARCH/REPLACE format:
  // <<<<<<< SEARCH
  // ...
  // =======
  // ...
  // >>>>>>> REPLACE
  const blockRegex = /<{7}\s*SEARCH[\r\n]+([\s\S]*?)[\r\n]+={7}[\r\n]+([\s\S]*?)[\r\n]+>{7}\s*REPLACE/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(body)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
  }

  return blocks;
}

/**
 * Strips exactly one leading and one trailing newline from file content.
 * Preserves all other whitespace, indentation, and newlines.
 */
export function stripProtocolNewlines(text: string): string {
  let result = text;
  if (result.startsWith('\r\n')) {
    result = result.slice(2);
  } else if (result.startsWith('\n')) {
    result = result.slice(1);
  }

  if (result.endsWith('\r\n')) {
    result = result.slice(0, -2);
  } else if (result.endsWith('\n')) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Creates an incremental streaming parser.
 */
export function createStreamingProtocolParser(
  onEvent: (event: ProtocolEvent) => void
): StreamingProtocolParser {
  let state: ParserState = 'OUTSIDE';
  let buffer = '';
  let currentPath = '';
  let editAccumulated = '';
  let fileHasEmittedChunk = false;
  let pendingFileContent = '';

  const DESYRA_PREFIX = '<desyra-';
  const FILE_CLOSE = '</desyra-file>';
  const EDIT_CLOSE = '</desyra-edit>';

  function processOutside() {
    while (buffer.length > 0) {
      const tagIndex = buffer.indexOf('<');

      if (tagIndex === -1) {
        // No tag opening found, emit entire buffer as text
        const textToEmit = buffer;
        buffer = '';
        if (textToEmit) {
          onEvent({ type: 'text', text: textToEmit });
        }
        return;
      }

      // If there's text before '<', emit it
      if (tagIndex > 0) {
        const textBefore = buffer.slice(0, tagIndex);
        buffer = buffer.slice(tagIndex);
        onEvent({ type: 'text', text: textBefore });
      }

      // Now buffer starts with '<'
      // Check if it could be a desyra tag
      // If buffer is shorter than '<desyra-', check if it's a prefix
      if (buffer.length < DESYRA_PREFIX.length) {
        if (DESYRA_PREFIX.startsWith(buffer)) {
          // Incomplete prefix, wait for more chunks
          return;
        } else {
          // Not a desyra tag (e.g. '<div>', '<p', '<span')
          onEvent({ type: 'text', text: buffer.slice(0, 1) });
          buffer = buffer.slice(1);
          continue;
        }
      }

      // Buffer has at least '<desyra-'. Does it actually start with '<desyra-'?
      if (!buffer.startsWith(DESYRA_PREFIX)) {
        // Not a desyra tag, emit '<' and continue
        onEvent({ type: 'text', text: buffer.slice(0, 1) });
        buffer = buffer.slice(1);
        continue;
      }

      // It starts with '<desyra-'. Look for closing '>' of the tag
      const closingBracket = buffer.indexOf('>');
      if (closingBracket === -1) {
        // Tag is incomplete, wait for more chunks (unless absurdly long)
        if (buffer.length > 1000) {
          // Treat as protocol error and discard
          onEvent({
            type: 'protocolError',
            message: 'Malformed or overly long tag opening',
          });
          buffer = '';
        }
        return;
      }

      const fullTag = buffer.slice(0, closingBracket + 1);
      buffer = buffer.slice(closingBracket + 1);

      // Determine tag type
      const isFile = /^<desyra-file\b/i.test(fullTag);
      const isEdit = /^<desyra-edit\b/i.test(fullTag);
      const isDelete = /^<desyra-delete\b/i.test(fullTag);

      if (isFile) {
        const path = extractPathAttribute(fullTag);
        if (!path) {
          onEvent({
            type: 'protocolError',
            message: `Missing path attribute in file tag: ${fullTag}`,
          });
        } else {
          currentPath = path;
          state = 'IN_FILE';
          fileHasEmittedChunk = false;
          pendingFileContent = '';
          onEvent({ type: 'fileStart', path });
          // Strip one leading newline if buffer starts with it
          if (buffer.startsWith('\r\n')) {
            buffer = buffer.slice(2);
          } else if (buffer.startsWith('\n')) {
            buffer = buffer.slice(1);
          }
          processInFile();
          return;
        }
      } else if (isEdit) {
        const path = extractPathAttribute(fullTag);
        if (!path) {
          onEvent({
            type: 'protocolError',
            message: `Missing path attribute in edit tag: ${fullTag}`,
          });
        } else {
          currentPath = path;
          state = 'IN_EDIT';
          editAccumulated = '';
          onEvent({ type: 'editStart', path });
          if (buffer.startsWith('\r\n')) {
            buffer = buffer.slice(2);
          } else if (buffer.startsWith('\n')) {
            buffer = buffer.slice(1);
          }
          processInEdit();
          return;
        }
      } else if (isDelete) {
        const path = extractPathAttribute(fullTag);
        if (!path) {
          onEvent({
            type: 'protocolError',
            message: `Missing path attribute in delete tag: ${fullTag}`,
          });
        } else {
          onEvent({ type: 'delete', path });
          // If followed by </desyra-delete>, skip it
          if (buffer.startsWith('</desyra-delete>')) {
            buffer = buffer.slice('</desyra-delete>'.length);
          }
        }
      } else {
        // Unknown desyra tag
        onEvent({
          type: 'protocolError',
          message: `Unknown DESYRA tag: ${fullTag}`,
        });
      }
    }
  }

  function processInFile() {
    while (buffer.length > 0) {
      // If we haven't emitted any chunk yet, check if we need to strip one leading newline
      if (!fileHasEmittedChunk) {
        if (buffer === '\r') {
          // Wait for next chunk to see if it's \r\n
          return;
        }
        if (buffer.startsWith('\r\n')) {
          buffer = buffer.slice(2);
          fileHasEmittedChunk = true;
        } else if (buffer.startsWith('\n')) {
          buffer = buffer.slice(1);
          fileHasEmittedChunk = true;
        } else if (buffer.length > 0) {
          fileHasEmittedChunk = true;
        }
      }

      const closeIdx = buffer.indexOf(FILE_CLOSE);

      if (closeIdx !== -1) {
        // We found </desyra-file>
        let contentBefore = buffer.slice(0, closeIdx);
        buffer = buffer.slice(closeIdx + FILE_CLOSE.length);

        // Strip exactly one trailing newline from contentBefore
        if (contentBefore.endsWith('\r\n')) {
          contentBefore = contentBefore.slice(0, -2);
        } else if (contentBefore.endsWith('\n')) {
          contentBefore = contentBefore.slice(0, -1);
        }

        if (contentBefore) {
          onEvent({ type: 'fileChunk', path: currentPath, text: contentBefore });
        }
        onEvent({ type: 'fileEnd', path: currentPath });

        state = 'OUTSIDE';
        currentPath = '';
        fileHasEmittedChunk = false;
        processOutside();
        return;
      }

      // Check for partial close tag at the end of buffer (e.g. '</desyra-f')
      let maxPrefixLen = 0;
      for (let i = 1; i < FILE_CLOSE.length; i++) {
        const suffix = buffer.slice(-i);
        if (FILE_CLOSE.startsWith(suffix)) {
          maxPrefixLen = i;
        }
      }

      // Also hold back any newline immediately preceding the potential close tag prefix
      let holdBack = maxPrefixLen;
      const textBeforePrefix = buffer.slice(0, buffer.length - holdBack);
      if (textBeforePrefix.endsWith('\r\n')) {
        holdBack += 2;
      } else if (textBeforePrefix.endsWith('\n')) {
        holdBack += 1;
      }

      const safeLength = buffer.length - holdBack;

      if (safeLength > 0) {
        const candidateToEmit = buffer.slice(0, safeLength);
        buffer = buffer.slice(safeLength);

        if (candidateToEmit) {
          onEvent({
            type: 'fileChunk',
            path: currentPath,
            text: candidateToEmit,
          });
          fileHasEmittedChunk = true;
        }
      }

      // Wait for more chunks to resolve partial tag or trailing newline
      return;
    }
  }

  function processInEdit() {
    while (buffer.length > 0) {
      const closeIdx = buffer.indexOf(EDIT_CLOSE);

      if (closeIdx !== -1) {
        const contentBefore = buffer.slice(0, closeIdx);
        buffer = buffer.slice(closeIdx + EDIT_CLOSE.length);

        editAccumulated += contentBefore;
        const blocks = parseSearchReplaceBlocks(editAccumulated);

        onEvent({
          type: 'editEnd',
          path: currentPath,
          blocks,
        });

        state = 'OUTSIDE';
        currentPath = '';
        editAccumulated = '';
        processOutside();
        return;
      }

      // Check if end of buffer might be a partial </desyra-edit>
      let maxPrefixLen = 0;
      for (let i = 1; i < EDIT_CLOSE.length; i++) {
        const suffix = buffer.slice(-i);
        if (EDIT_CLOSE.startsWith(suffix)) {
          maxPrefixLen = i;
        }
      }

      const safeLength = buffer.length - maxPrefixLen;
      if (safeLength > 0) {
        editAccumulated += buffer.slice(0, safeLength);
        buffer = buffer.slice(safeLength);
      }
      return;
    }
  }

  return {
    feed(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      if (state === 'OUTSIDE') {
        processOutside();
      } else if (state === 'IN_FILE') {
        processInFile();
      } else if (state === 'IN_EDIT') {
        processInEdit();
      }
    },
    end() {
      // Stream ended
      if (state === 'IN_FILE') {
        // Emit whatever was pending
        if (buffer) {
          onEvent({ type: 'fileChunk', path: currentPath, text: buffer });
          buffer = '';
        }
        onEvent({
          type: 'unterminated',
          tagType: 'file',
          path: currentPath,
        });
        onEvent({ type: 'fileEnd', path: currentPath });
        state = 'OUTSIDE';
      } else if (state === 'IN_EDIT') {
        editAccumulated += buffer;
        buffer = '';
        const blocks = parseSearchReplaceBlocks(editAccumulated);
        onEvent({
          type: 'unterminated',
          tagType: 'edit',
          path: currentPath,
        });
        onEvent({
          type: 'editEnd',
          path: currentPath,
          blocks,
        });
        state = 'OUTSIDE';
      } else if (state === 'OUTSIDE') {
        if (buffer) {
          onEvent({ type: 'text', text: buffer });
          buffer = '';
        }
      }
    },
  };
}

/**
 * Synchronous parser that runs the streaming parser over a complete string
 * and returns all emitted events.
 */
export function parseProtocol(rawText: string): ProtocolEvent[] {
  const events: ProtocolEvent[] = [];
  const parser = createStreamingProtocolParser((event) => {
    events.push(event);
  });
  parser.feed(rawText);
  parser.end();
  return events;
}

export interface ParsedProtocolFileOperation {
  op: 'file' | 'edit' | 'delete';
  path: string;
  content?: string;
  blocks?: SearchReplaceBlock[];
  isUnterminated?: boolean;
}

export type ParsedMessageSection =
  | { type: 'prose'; text: string }
  | { type: 'operation'; operation: ParsedProtocolFileOperation };

/**
 * Parses raw message text into an ordered list of prose sections and file operations
 * for clean UI rendering.
 */
export function parseMessageSections(rawText: string): ParsedMessageSection[] {
  const events = parseProtocol(rawText);
  const sections: ParsedMessageSection[] = [];

  let currentOp: ParsedProtocolFileOperation | null = null;
  let accumulatedProse = '';

  function flushProse() {
    if (accumulatedProse) {
      sections.push({ type: 'prose', text: accumulatedProse });
      accumulatedProse = '';
    }
  }

  for (const event of events) {
    switch (event.type) {
      case 'text':
        accumulatedProse += event.text;
        break;

      case 'fileStart':
        flushProse();
        currentOp = {
          op: 'file',
          path: event.path,
          content: '',
        };
        break;

      case 'fileChunk':
        if (currentOp && currentOp.op === 'file') {
          currentOp.content = (currentOp.content || '') + event.text;
        }
        break;

      case 'fileEnd':
        if (currentOp) {
          sections.push({ type: 'operation', operation: currentOp });
          currentOp = null;
        }
        break;

      case 'editStart':
        flushProse();
        currentOp = {
          op: 'edit',
          path: event.path,
          blocks: [],
        };
        break;

      case 'editEnd':
        if (currentOp && currentOp.op === 'edit') {
          currentOp.blocks = event.blocks;
          sections.push({ type: 'operation', operation: currentOp });
          currentOp = null;
        }
        break;

      case 'delete':
        flushProse();
        sections.push({
          type: 'operation',
          operation: {
            op: 'delete',
            path: event.path,
          },
        });
        break;

      case 'unterminated':
        if (currentOp) {
          currentOp.isUnterminated = true;
        }
        break;

      case 'protocolError':
        // Log/keep as text warning in prose
        accumulatedProse += `\n> *Protocol notice: ${event.message}*\n`;
        break;
    }
  }

  flushProse();
  return sections;
}
