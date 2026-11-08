import type { ProjectFile, StoredMessage } from '@/lib/db';
import type { ChatMessage } from './types';
import { BUILD_SYSTEM_PROMPT } from './prompts/build';
import { parseProtocol } from './fileProtocol';

export const FILE_CONTENT_CHAR_BUDGET = 60000;

export interface BuildContextParams {
  projectFiles: ProjectFile[];
  conversationHistory: StoredMessage[];
  openFilePath?: string | null;
}

/**
 * Compacts assistant message for context by replacing file bodies
 * with compact one-line summary notes.
 */
export function compactAssistantMessageContent(rawContent: string): string {
  const events = parseProtocol(rawContent);
  let result = '';
  let currentFilePath = '';
  let currentFileContent = '';

  for (const event of events) {
    if (event.type === 'text') {
      result += event.text;
    } else if (event.type === 'fileStart') {
      currentFilePath = event.path;
      currentFileContent = '';
    } else if (event.type === 'fileChunk') {
      currentFileContent += event.text;
    } else if (event.type === 'fileEnd') {
      const lineCount = currentFileContent ? currentFileContent.split('\n').length : 0;
      result += `\n[wrote ${currentFilePath}, ${lineCount} lines]\n`;
      currentFilePath = '';
      currentFileContent = '';
    } else if (event.type === 'editEnd') {
      result += `\n[edited ${event.path}, ${event.blocks.length} block${event.blocks.length === 1 ? '' : 's'}]\n`;
    } else if (event.type === 'delete') {
      result += `\n[deleted ${event.path}]\n`;
    }
  }

  return result.trim();
}

/**
 * Extracts paths touched in the last assistant message.
 */
function getFilesTouchedInLastAssistantMessage(messages: StoredMessage[]): string[] {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return [];

  if (lastAssistant.undoEntries && lastAssistant.undoEntries.length > 0) {
    return lastAssistant.undoEntries.map((e) => e.path);
  }

  const events = parseProtocol(lastAssistant.content);
  const paths: string[] = [];
  for (const ev of events) {
    if (ev.type === 'fileStart' || ev.type === 'editStart' || ev.type === 'delete') {
      paths.push(ev.path);
    }
  }
  return Array.from(new Set(paths));
}

/**
 * Formats a byte size into a readable string (e.g. "2.4 KB" or "500 B").
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Builds the "Project files" context message with prioritized full file contents
 * up to the 60,000 character budget.
 */
export function buildProjectFilesMessage(
  files: ProjectFile[],
  touchedPaths: string[],
  openFilePath?: string | null
): string {
  if (files.length === 0) {
    return 'The project currently has no files.';
  }

  // 1. Manifest of all files
  const manifestLines = files.map((f) => {
    const byteSize = new Blob([f.content]).size;
    return `- ${f.path} (${formatFileSize(byteSize)}, ${f.content.split('\n').length} lines)`;
  });

  let message = `## Current Project Files (Check this list and folder structure before adding or modifying files; never create duplicate/similar files like style.css vs styles.css or app.js vs script.js; update existing files in place):\n${manifestLines.join('\n')}\n\n`;

  // 2. Sort files by priority:
  // Priority 1: Files touched in last assistant message
  // Priority 2: Currently open file
  // Priority 3: Most recently updated files
  const priorityMap = new Map<string, number>();

  files.forEach((f) => {
    let score = f.updatedAt; // Base recency
    if (openFilePath && f.path === openFilePath) {
      score += 10_000_000_000;
    }
    if (touchedPaths.includes(f.path)) {
      score += 20_000_000_000;
    }
    priorityMap.set(f.path, score);
  });

  const prioritizedFiles = [...files].sort((a, b) => {
    return (priorityMap.get(b.path) || 0) - (priorityMap.get(a.path) || 0);
  });

  let remainingChars = FILE_CONTENT_CHAR_BUDGET;
  const includedFiles: string[] = [];
  const omittedFiles: string[] = [];

  for (const file of prioritizedFiles) {
    const fileHeader = `### File: ${file.path}\n\`\`\`\n`;
    const fileFooter = `\n\`\`\`\n\n`;
    const needed = fileHeader.length + file.content.length + fileFooter.length;

    if (needed <= remainingChars) {
      message += `${fileHeader}${file.content}${fileFooter}`;
      remainingChars -= needed;
      includedFiles.push(file.path);
    } else {
      omittedFiles.push(file.path);
    }
  }

  if (omittedFiles.length > 0) {
    message += `### Note on Omitted Files:\n`;
    message += `The full content of the following ${omittedFiles.length} file(s) was omitted to preserve context window: ${omittedFiles.join(', ')} (content omitted: ask to see it).\n`;
  }

  return message.trim();
}

/**
 * Builds the complete list of ChatMessages to send to the provider adapter:
 * - System prompt
 * - "Project files" message
 * - Last 20 conversation messages (assistant messages compacted)
 */
export function buildAiChatContext({
  projectFiles,
  conversationHistory,
  openFilePath,
}: BuildContextParams): ChatMessage[] {
  const touchedInLast = getFilesTouchedInLastAssistantMessage(conversationHistory);
  const projectFilesContent = buildProjectFilesMessage(projectFiles, touchedInLast, openFilePath);

  // Take the last 20 conversation messages
  const recentHistory = conversationHistory.slice(-20);

  const compactedMessages: ChatMessage[] = recentHistory.map((msg) => {
    if (msg.role === 'assistant') {
      return {
        role: 'assistant',
        content: compactAssistantMessageContent(msg.content),
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  });

  return [
    {
      role: 'system',
      content: BUILD_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: projectFilesContent,
    },
    ...compactedMessages,
  ];
}
