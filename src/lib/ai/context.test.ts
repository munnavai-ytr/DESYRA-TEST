import { describe, it, expect } from 'vitest';
import {
  compactAssistantMessageContent,
  buildProjectFilesMessage,
  buildAiChatContext,
} from './context';
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
});
