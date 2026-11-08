import { describe, it, expect } from 'vitest';
import {
  compactAssistantMessageContent,
  buildProjectFilesMessage,
  buildAiChatContext,
} from './context';
import { BUILD_SYSTEM_PROMPT } from './prompts/build';
import { createSpecFromClassification } from '@/lib/design/install';
import type { ProjectFile, StoredMessage } from '@/lib/db';

describe('context builder', () => {
  it('compacts past assistant messages by replacing file bodies with one-line summaries', () => {
    const rawAssistant = `I have created the files for your app.

<desyra-file path="index.html">
<!DOCTYPE html>
<html>
  <body>Hello</body>
</html>
</desyra-file>

<desyra-edit path="app.js">
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
</desyra-edit>

Let me know what you think!`;

    const compacted = compactAssistantMessageContent(rawAssistant);
    expect(compacted).toContain('I have created the files for your app.');
    expect(compacted).toContain('[wrote index.html, 4 lines]');
    expect(compacted).toContain('[edited app.js, 1 block]');
    expect(compacted).toContain('Let me know what you think!');
    // File bodies should NOT be present in compacted history
    expect(compacted).not.toContain('<!DOCTYPE html>');
  });

  it('handles empty project files message explicitly', () => {
    const msg = buildProjectFilesMessage([], []);
    expect(msg).toBe('The project currently has no files.');
  });

  it('builds context with priority given to open and touched files', () => {
    const files: ProjectFile[] = [
      {
        id: '1',
        projectId: 'p1',
        path: 'a.txt',
        content: 'Content A',
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: '2',
        projectId: 'p1',
        path: 'b.txt',
        content: 'Content B',
        createdAt: 200,
        updatedAt: 200,
      },
      {
        id: '3',
        projectId: 'p1',
        path: 'open.txt',
        content: 'Content Open',
        createdAt: 50,
        updatedAt: 50,
      },
    ];

    const msg = buildProjectFilesMessage(files, ['a.txt'], 'open.txt');
    expect(msg).toContain('## Current Project Files');
    expect(msg).toContain('### File: a.txt');
    expect(msg).toContain('### File: open.txt');
  });

  describe('Fix A: design prompt flow and consistency', () => {
    it('(1) uses design system prompt with class reference and active design section when projectDesign is provided', () => {
      const spec = createSpecFromClassification('Modern Invoice and Billing Dashboard');
      const messages = buildAiChatContext({
        projectFiles: [],
        conversationHistory: [
          {
            id: 'm1',
            projectId: 'p1',
            role: 'user',
            content: 'Build me an invoice app',
            createdAt: 1000,
          },
        ],
        projectDesign: spec,
      });

      const systemPrompt = messages[0].content;
      // System prompt sent to provider contains Design System section and class reference
      expect(systemPrompt).toContain('## ACTIVE DESIGN SYSTEM (DESYRA Design Engine)');
      expect(systemPrompt).toContain('### Mandatory HTML Head Setup');
      expect(systemPrompt).toContain('### DESYRA Component Class Reference');
      expect(systemPrompt).toContain('.btn-primary');
      expect(systemPrompt).toContain('.card');
      expect(systemPrompt).toContain(spec.archetypeId);
      expect(systemPrompt).not.toBe(BUILD_SYSTEM_PROMPT);
    });

    it('(2) auto-continue and Fix with AI rounds use the exact same design prompt', () => {
      const spec = createSpecFromClassification('Kanban Task Board');

      // Initial turn context
      const initialCtx = buildAiChatContext({
        projectFiles: [{ id: '1', projectId: 'p1', path: 'index.html', content: '<html></html>', createdAt: 1, updatedAt: 1 }],
        conversationHistory: [
          { id: 'u1', projectId: 'p1', role: 'user', content: 'Build Kanban', createdAt: 100 },
          { id: 'a1', projectId: 'p1', role: 'assistant', content: 'Done', createdAt: 200 },
        ],
        projectDesign: spec,
      });

      // Auto-continue / Fix turn context
      const continueCtx = buildAiChatContext({
        projectFiles: [{ id: '1', projectId: 'p1', path: 'index.html', content: '<html></html>', createdAt: 1, updatedAt: 2 }],
        conversationHistory: [
          { id: 'u1', projectId: 'p1', role: 'user', content: 'Build Kanban', createdAt: 100 },
          { id: 'a1', projectId: 'p1', role: 'assistant', content: 'Done', createdAt: 200 },
          { id: 'u2', projectId: 'p1', role: 'user', content: 'Continue build and fix missing files', createdAt: 300 },
        ],
        projectDesign: spec,
      });

      // Both rounds must use the identical design system prompt
      expect(initialCtx[0].content).toBe(continueCtx[0].content);
      expect(continueCtx[0].content).toContain('## ACTIVE DESIGN SYSTEM (DESYRA Design Engine)');
    });

    it('(3) projects created before 7A (no design) still use the basic BUILD_SYSTEM_PROMPT', () => {
      const legacyCtx = buildAiChatContext({
        projectFiles: [{ id: '1', projectId: 'p1', path: 'index.html', content: '<html></html>', createdAt: 1, updatedAt: 1 }],
        conversationHistory: [
          { id: 'u1', projectId: 'p1', role: 'user', content: 'Build calculator', createdAt: 100 },
        ],
        projectDesign: null,
      });

      expect(legacyCtx[0].content).toBe(BUILD_SYSTEM_PROMPT);
      expect(legacyCtx[0].content).not.toContain('ACTIVE DESIGN SYSTEM');
    });
  });
});
