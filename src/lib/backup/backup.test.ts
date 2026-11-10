import { describe, it, expect, beforeEach } from 'vitest';
import type { Project, StoredMessage } from '@/lib/db';
import { createMemoryHistoryAdapter, type MemoryHistoryAdapter } from '@/lib/history/storage';
import { createSnapshot } from '@/lib/history/snapshots';
import { createSpecFromClassification, MANAGED_DESIGN_FILES } from '@/lib/design/install';
import { generateTokensCss } from '@/lib/design/css/generateTokensCss';
import { readZipEntries } from '@/lib/zip/reader';
import { buildZipBytes } from '@/lib/zip/writer';
import {
  exportAllProjectsBackup,
  inspectBackupZip,
  restoreProjectsFromBackup,
  isAbortError,
} from './backup';

describe('DESYRA Full Multi-Project Backup & Restore', () => {
  let mem: MemoryHistoryAdapter;

  beforeEach(async () => {
    mem = createMemoryHistoryAdapter();

    const spec = createSpecFromClassification('Modern fintech wallet dashboard');
    const p1: Project = {
      id: 'proj_alpha',
      title: 'Fintech Wallet',
      idea: 'Personal expense dashboard',
      createdAt: 1000,
      updatedAt: 5000,
      autoStarted: true,
      design: spec,
    };
    const p2: Project = {
      id: 'proj_beta',
      title: 'Minimal Notes',
      idea: 'Quick markdown notes',
      createdAt: 2000,
      updatedAt: 4000,
      autoStarted: true,
    };

    await mem.addProject(p1);
    await mem.addProject(p2);

    await mem.bulkPutFiles([
      {
        id: 'f1',
        projectId: 'proj_alpha',
        path: 'index.html',
        content: '<!doctype html><html lang="en"><body><h1>Wallet</h1></body></html>',
        createdAt: 1000,
        updatedAt: 5000,
      },
      {
        id: 'f2',
        projectId: 'proj_alpha',
        path: 'css/tokens.css',
        content: generateTokensCss(spec),
        createdAt: 1000,
        updatedAt: 5000,
      },
      {
        id: 'f3',
        projectId: 'proj_beta',
        path: 'index.html',
        content: '<h1>Notes</h1>',
        createdAt: 2000,
        updatedAt: 4000,
      },
    ]);

    const leakedExtraField = {
      id: 'msg_1',
      projectId: 'proj_alpha',
      role: 'assistant',
      content: 'Built your wallet layout.',
      createdAt: 4500,
      // Simulate unexpected non-whitelisted secret field attached to a row
      encryptedKey: 'SENSITIVE_ENCRYPTED_KEY_DO_NOT_EXPORT',
    } as unknown as StoredMessage;

    await mem.bulkPutMessages([
      {
        id: 'msg_0',
        projectId: 'proj_alpha',
        role: 'user',
        content: 'Build a fintech wallet.',
        createdAt: 4400,
      },
      leakedExtraField,
    ]);

    await createSnapshot(
      'proj_alpha',
      { label: 'Initial build', kind: 'ai', messageId: 'msg_1' },
      mem
    );

    // Plant sensitive previewStorage that MUST NEVER enter backups
    mem.state.previewStorage.set('proj_alpha:auth_token', {
      projectId: 'proj_alpha',
      key: 'auth_token',
      value: 'PREVIEW_LOCAL_STORAGE_SECRET_VALUE',
    });
  });

  it('exports default backup without chat/snapshots and excludes all previewStorage and key data', async () => {
    const exported = await exportAllProjectsBackup(
      { includeChatHistory: false, includeSnapshots: false },
      mem
    );

    expect(exported.projectCount).toBe(2);
    expect(exported.fileCount).toBe(3);
    expect(exported.messageCount).toBe(0);
    expect(exported.snapshotCount).toBe(0);
    expect(exported.filename).toMatch(/^desyra-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    const rawEntries = await readZipEntries(exported.bytes);
    const allContents = rawEntries.files.map((f) => f.content).join('\n');
    expect(allContents).not.toContain('PREVIEW_LOCAL_STORAGE_SECRET_VALUE');
    expect(allContents).not.toContain('SENSITIVE_ENCRYPTED_KEY_DO_NOT_EXPORT');
    expect(allContents).not.toContain('Built your wallet layout.');

    const inspected = await inspectBackupZip(exported.bytes);
    expect(inspected.manifest.formatVersion).toBe(1);
    expect(inspected.manifest.includeChatHistory).toBe(false);
    expect(inspected.manifest.includeSnapshots).toBe(false);
    expect(inspected.projects).toHaveLength(2);
    // Project alpha lacks css/base.css and css/components.css so restore should regenerate them
    const alphaMeta = inspected.projects.find((p) => p.entry.originalId === 'proj_alpha');
    expect(alphaMeta?.regeneratedCssNeeded).toBe(true);
  });

  it('round-trips full backup WITH chat history and snapshots while remapping IDs cleanly without overwriting existing projects', async () => {
    const exported = await exportAllProjectsBackup(
      { includeChatHistory: true, includeSnapshots: true },
      mem
    );

    expect(exported.messageCount).toBe(2);
    expect(exported.snapshotCount).toBe(1);

    // Check strict privacy even when chat & snapshots are opted in
    const rawZip = await readZipEntries(exported.bytes);
    const joinedText = rawZip.files.map((f) => f.content).join('\n');
    expect(joinedText).not.toContain('PREVIEW_LOCAL_STORAGE_SECRET_VALUE');
    expect(joinedText).not.toContain('SENSITIVE_ENCRYPTED_KEY_DO_NOT_EXPORT');

    const inspected = await inspectBackupZip(exported.bytes);
    expect(inspected.manifest.includeChatHistory).toBe(true);
    expect(inspected.manifest.includeSnapshots).toBe(true);

    // Restore INTO the same adapter to prove non-overwriting creation of new project IDs
    const restoreRes = await restoreProjectsFromBackup(
      inspected,
      ['proj_alpha', 'proj_beta'],
      {},
      mem
    );

    expect(restoreRes.restoredCount).toBe(2);
    const allProjects = await mem.listProjects();
    expect(allProjects).toHaveLength(4);

    // Originals remain completely intact
    expect(await mem.getProject('proj_alpha')).toBeDefined();
    expect(await mem.getProject('proj_beta')).toBeDefined();

    const restoredAlpha = restoreRes.restoredProjects.find((p) => p.title === 'Fintech Wallet')!;
    expect(restoredAlpha.id).not.toBe('proj_alpha');
    expect(restoredAlpha.design).toBeDefined();

    // Missing managed CSS files regenerated cleanly
    const restoredAlphaFiles = await mem.listProjectFiles(restoredAlpha.id);
    for (const managed of MANAGED_DESIGN_FILES) {
      expect(restoredAlphaFiles.some((f) => f.path === managed)).toBe(true);
    }

    // Message <-> snapshot cross-links remapped cleanly to NEW IDs
    const restoredMessages = await mem.listProjectMessages(restoredAlpha.id);
    const restoredSnaps = await mem.listProjectSnapshots(restoredAlpha.id);
    expect(restoredMessages).toHaveLength(2);
    expect(restoredSnaps).toHaveLength(1);
    const linkedMsg = restoredMessages.find((m) => m.role === 'assistant');
    expect(linkedMsg?.snapshotId).toBe(restoredSnaps[0].id);
    expect(restoredSnaps[0].messageId).toBe(linkedMsg?.id);
  });

  it('supports AbortSignal cancellation during both backup export and restore without partial writes', async () => {
    // 1. Pre-aborted export throws AbortError
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      exportAllProjectsBackup({ signal: preAborted.signal }, mem)
    ).rejects.toSatisfy((err: unknown) => isAbortError(err));

    // 2. Abort triggered during restore progress after project 1 stops before committing project 2
    const fullExport = await exportAllProjectsBackup({}, mem);
    const inspected = await inspectBackupZip(fullExport.bytes);
    const freshMem = createMemoryHistoryAdapter();
    const midAbort = new AbortController();

    await expect(
      restoreProjectsFromBackup(
        inspected,
        ['proj_alpha', 'proj_beta'],
        {
          signal: midAbort.signal,
          onProgress(p) {
            if (p.current === 2) {
              midAbort.abort();
            }
          },
        },
        freshMem
      )
    ).rejects.toSatisfy((err: unknown) => isAbortError(err));

    // Only project 1 had committed before cancellation of project 2
    expect((await freshMem.listProjects()).length).toBe(1);
  });

  it('rejects tampered archives missing backup.json or using unsupported formatVersion', async () => {
    const missingManifestZip = buildZipBytes([{ path: 'index.html', content: '<h1>Not a backup</h1>' }]);
    await expect(inspectBackupZip(missingManifestZip.bytes)).rejects.toThrow(/backup\.json/i);

    const badVersionZip = buildZipBytes([
      {
        path: 'backup.json',
        content: JSON.stringify({ formatVersion: 99, projects: [] }),
      },
    ]);
    await expect(inspectBackupZip(badVersionZip.bytes)).rejects.toThrow(/Unsupported|incompatible/i);
  });
});
