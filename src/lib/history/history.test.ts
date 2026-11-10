import { describe, it, expect, beforeEach } from 'vitest';
import {
  DESYRA_V6_STORES,
  DESYRA_V7_STORES,
  type Project,
} from '@/lib/db';
import { createMemoryHistoryAdapter, type MemoryHistoryAdapter } from './storage';
import {
  MAX_UNPINNED_SNAPSHOTS_PER_PROJECT,
  createSnapshot,
  createSnapshotWithResult,
  saveManualCheckpoint,
  listSnapshots,
  diffSnapshots,
  diffSnapshotFile,
  restoreSnapshot,
  deleteSnapshot,
  pinSnapshot,
  renameSnapshot,
  gcBlobs,
  cleanupOldVersionsAllProjects,
  duplicateProject,
  runStartupIntegrityCheck,
  resetSessionIntegrityCheckFlag,
} from './snapshots';
import { createSpecFromClassification } from '@/lib/design/install';

describe('DESYRA Version History Engine', () => {
  let mem: MemoryHistoryAdapter;
  const projectId = 'proj_test_1';

  beforeEach(async () => {
    mem = createMemoryHistoryAdapter();
    resetSessionIntegrityCheckFlag();

    const spec = createSpecFromClassification('SaaS team planner');
    const project: Project = {
      id: projectId,
      title: 'Team Planner',
      idea: 'Collaborative Kanban tasks',
      createdAt: 1000,
      updatedAt: 1000,
      autoStarted: true,
      design: spec,
    };
    await mem.addProject(project);
    await mem.bulkPutFiles([
      {
        id: 'file_index',
        projectId,
        path: 'index.html',
        content: '<h1>Hello V1</h1>',
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'file_app',
        projectId,
        path: 'js/app.js',
        content: 'console.log("v1");',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
  });

  it('preserves all v6 schema stores in v7 migration definition plus blobs and snapshots', () => {
    for (const [table, schema] of Object.entries(DESYRA_V6_STORES)) {
      expect((DESYRA_V7_STORES as Record<string, string>)[table]).toBe(schema);
    }
    expect(DESYRA_V7_STORES.blobs).toBe('hash, size');
    expect(DESYRA_V7_STORES.snapshots).toContain('projectId');
    expect(DESYRA_V7_STORES.snapshots).toContain('[projectId+createdAt]');
  });

  it('deduplicates snapshots when file manifest matches latest snapshot', async () => {
    const first = await createSnapshot(projectId, { label: 'Initial', kind: 'ai' }, mem);
    expect(first).not.toBeNull();

    // Exact same files -> returns null, no duplicate created
    const duplicate = await createSnapshot(projectId, { label: 'No changes', kind: 'manual' }, mem);
    expect(duplicate).toBeNull();
    const list1 = await listSnapshots(projectId, {}, mem);
    expect(list1.total).toBe(1);

    // Modify one file -> creates second snapshot sharing unchanged js/app.js blob
    await mem.putFile({
      id: 'file_index',
      projectId,
      path: 'index.html',
      content: '<h1>Hello V2</h1>',
      createdAt: 1000,
      updatedAt: 2000,
    });
    const second = await createSnapshot(projectId, { label: 'Update heading', kind: 'ai' }, mem);
    expect(second).not.toBeNull();
    const list2 = await listSnapshots(projectId, {}, mem);
    expect(list2.total).toBe(2);
    // Blobs: 3 unique contents across 2 snapshots (app.js, index V1, index V2)
    expect(mem.state.blobs.size).toBe(3);
  });

  it('retains up to 60 unpinned snapshots per project, preserves all pinned snapshots, and garbage collects orphaned blobs', async () => {
    // Create 3 pinned snapshots first
    const pinnedIds: string[] = [];
    for (let p = 0; p < 3; p++) {
      await mem.putFile({
        id: 'file_index',
        projectId,
        path: 'index.html',
        content: `<h1>Pinned ${p}</h1>`,
        createdAt: 1000,
        updatedAt: 1100 + p,
      });
      const res = await createSnapshotWithResult(
        projectId,
        { label: `Pinned ${p}`, kind: 'checkpoint', pinned: true },
        mem
      );
      pinnedIds.push(res.snapshot!.id);
    }

    // Create 65 unpinned snapshots (exceeding 60 FIFO limit by 5)
    let totalTrimmed = 0;
    for (let i = 0; i < MAX_UNPINNED_SNAPSHOTS_PER_PROJECT + 5; i++) {
      await mem.putFile({
        id: 'file_index',
        projectId,
        path: 'index.html',
        content: `<h1>Unpinned version ${i}</h1>`,
        createdAt: 1000,
        updatedAt: 2000 + i,
      });
      const out = await createSnapshotWithResult(
        projectId,
        { label: `AI turn ${i}`, kind: 'ai' },
        mem
      );
      totalTrimmed += out.trimmedCount;
    }

    expect(totalTrimmed).toBe(5);
    const remaining = await mem.listProjectSnapshots(projectId);
    expect(remaining.filter((s) => !s.pinned)).toHaveLength(MAX_UNPINNED_SNAPSHOTS_PER_PROJECT);
    expect(remaining.filter((s) => s.pinned)).toHaveLength(3);
    for (const pid of pinnedIds) {
      expect(remaining.some((s) => s.id === pid)).toBe(true);
    }

    // Verify orphaned blobs from trimmed 5 versions were cleaned up
    const gcExtra = await gcBlobs(mem);
    expect(gcExtra).toBe(0);
    // 3 pinned + 60 unpinned + 1 shared js/app.js blob = 64 unique blobs
    expect(mem.state.blobs.size).toBe(64);
  });

  it('supports manual checkpoint pinning, rename, delete restriction, and cross-project cleanup', async () => {
    const s1 = await createSnapshot(projectId, { label: 'Initial', kind: 'ai' }, mem);
    expect(s1).not.toBeNull();

    // Cannot delete sole snapshot
    await expect(deleteSnapshot(s1!.id, mem)).rejects.toThrow(/only version/i);

    // saveManualCheckpoint when matching latest pins and relabels existing snapshot
    const cpSame = await saveManualCheckpoint(projectId, 'Release RC1', 'Ready to test', mem);
    expect(cpSame.createdNew).toBe(false);
    expect(cpSame.snapshot?.pinned).toBe(true);
    expect(cpSame.snapshot?.label).toBe('Release RC1');
    expect(cpSame.snapshot?.note).toBe('Ready to test');

    // Add a second version and verify delete works + pin toggle + rename validation
    await mem.putFile({
      id: 'file_index',
      projectId,
      path: 'index.html',
      content: '<h1>Changed</h1>',
      createdAt: 1000,
      updatedAt: 3000,
    });
    const s2 = await createSnapshot(projectId, { label: 'Second', kind: 'manual' }, mem);
    expect(s2).not.toBeNull();

    const renamed = await renameSnapshot(s2!.id, 'Clean header update', undefined, mem);
    expect(renamed?.label).toBe('Clean header update');
    await expect(renameSnapshot(s2!.id, '   ', undefined, mem)).rejects.toThrow(/empty/i);

    const toggled = await pinSnapshot(s1!.id, false, mem);
    expect(toggled?.pinned).toBe(false);

    const cleanupRes = await cleanupOldVersionsAllProjects(1, mem);
    expect(cleanupRes.deletedSnapshots).toBe(1);
    expect(cleanupRes.deletedBlobs).toBeGreaterThanOrEqual(1);

    // Restore second version back so we can delete safely if two exist
    await mem.putFile({
      id: 'file_index',
      projectId,
      path: 'index.html',
      content: '<h1>Third</h1>',
      createdAt: 1000,
      updatedAt: 4000,
    });
    const s3 = await createSnapshot(projectId, { label: 'Third', kind: 'manual' }, mem);
    const deleted = await deleteSnapshot(s3!.id, mem);
    expect(deleted).toBe(true);
  });

  it('restores full snapshot atomically (files + design + pre-restore checkpoint) and rolls back completely on failure', async () => {
    const snapV1 = await createSnapshot(projectId, { label: 'V1 Stable', kind: 'ai' }, mem);
    expect(snapV1).not.toBeNull();

    // Change files, add extra file, change design preset
    const altSpec = createSpecFromClassification('Dark cyber dashboard');
    altSpec.seedHex = '#10b981';
    await mem.updateProject(projectId, { design: altSpec });
    await mem.bulkPutFiles([
      {
        id: 'file_index',
        projectId,
        path: 'index.html',
        content: '<h1>V2 Broken</h1>',
        createdAt: 1000,
        updatedAt: 3000,
      },
      {
        id: 'file_extra',
        projectId,
        path: 'js/extra.js',
        content: 'export const bug = true;',
        createdAt: 3000,
        updatedAt: 3000,
      },
    ]);

    // Check manifest diff & lazy file diff before restoring
    const manifestDiff = await diffSnapshots(projectId, snapV1!.id, 'current', mem);
    expect(manifestDiff.added).toEqual(['js/extra.js']);
    expect(manifestDiff.modified.map((m) => m.path)).toEqual(['index.html']);
    expect(manifestDiff.unchanged).toEqual(['js/app.js']);

    const fileDiff = await diffSnapshotFile(projectId, snapV1!.id, 'current', 'index.html', mem);
    expect(fileDiff.addedCount).toBe(1);
    expect(fileDiff.removedCount).toBe(1);

    // Inject transaction failure hook and verify ZERO partial mutations
    mem.setPreCommitHook(() => {
      throw new Error('Simulated transaction failure');
    });
    await expect(restoreSnapshot(projectId, snapV1!.id, {}, mem)).rejects.toThrow(
      /Simulated transaction failure/
    );
    mem.setPreCommitHook(null);

    const filesAfterAbort = await mem.listProjectFiles(projectId);
    expect(filesAfterAbort.map((f) => f.path)).toEqual(['index.html', 'js/app.js', 'js/extra.js']);
    expect(filesAfterAbort.find((f) => f.path === 'index.html')?.content).toBe('<h1>V2 Broken</h1>');

    // Now perform real atomic restore
    const restoreRes = await restoreSnapshot(projectId, snapV1!.id, {}, mem);
    expect(restoreRes.undoSnapshotId).toBeTruthy();
    expect(restoreRes.removedCount).toBe(1);
    expect(restoreRes.changedCount).toBe(1);

    const filesAfterRestore = await mem.listProjectFiles(projectId);
    expect(filesAfterRestore.map((f) => f.path)).toEqual(['index.html', 'js/app.js']);
    expect(filesAfterRestore.find((f) => f.path === 'index.html')?.content).toBe('<h1>Hello V1</h1>');

    const projAfterRestore = await mem.getProject(projectId);
    expect(projAfterRestore?.design).toEqual(snapV1!.meta.design);

    // Verify Undo of restore brings back V2 Broken + js/extra.js
    await restoreSnapshot(projectId, restoreRes.undoSnapshotId!, {}, mem);
    const filesAfterUndo = await mem.listProjectFiles(projectId);
    expect(filesAfterUndo.map((f) => f.path)).toEqual(['index.html', 'js/app.js', 'js/extra.js']);
  });

  it('restores a single file via onlyPath without touching other files or design state', async () => {
    const snapV1 = await createSnapshot(projectId, { label: 'V1', kind: 'ai' }, mem);

    const customSpec = createSpecFromClassification('Luxury portfolio');
    await mem.updateProject(projectId, { design: customSpec });
    await mem.bulkPutFiles([
      {
        id: 'file_index',
        projectId,
        path: 'index.html',
        content: '<h1>Edited Index</h1>',
        createdAt: 1000,
        updatedAt: 2500,
      },
      {
        id: 'file_app',
        projectId,
        path: 'js/app.js',
        content: 'console.log("KEEP_THIS_EDIT");',
        createdAt: 1000,
        updatedAt: 2500,
      },
    ]);

    const res = await restoreSnapshot(projectId, snapV1!.id, { onlyPath: 'index.html' }, mem);
    expect(res.changedCount).toBe(1);

    const files = await mem.listProjectFiles(projectId);
    expect(files.find((f) => f.path === 'index.html')?.content).toBe('<h1>Hello V1</h1>');
    expect(files.find((f) => f.path === 'js/app.js')?.content).toBe('console.log("KEEP_THIS_EDIT");');

    const proj = await mem.getProject(projectId);
    expect(proj?.design).toEqual(customSpec);
  });

  it('duplicates a project safely excluding messages, previewStorage, and API keys', async () => {
    await mem.bulkPutMessages([
      {
        id: 'm1',
        projectId,
        role: 'user',
        content: 'Do not copy this chat message',
        createdAt: 1200,
      },
    ]);
    mem.state.previewStorage.set(`${projectId}:session`, {
      projectId,
      key: 'session',
      value: 'secret-token',
    });

    const copy = await duplicateProject(projectId, undefined, mem);
    expect(copy.id).not.toBe(projectId);
    expect(copy.title).toBe('Team Planner (Copy)');
    expect(copy.autoStarted).toBe(true);
    expect(copy.design).toEqual((await mem.getProject(projectId))?.design);

    const copyFiles = await mem.listProjectFiles(copy.id);
    expect(copyFiles.map((f) => f.path)).toEqual(['index.html', 'js/app.js']);

    const copyMessages = await mem.listProjectMessages(copy.id);
    expect(copyMessages).toHaveLength(0);

    const copyPreviewEntries = Array.from(mem.state.previewStorage.values()).filter(
      (p) => p.projectId === copy.id
    );
    expect(copyPreviewEntries).toHaveLength(0);

    const copySnaps = await mem.listProjectSnapshots(copy.id);
    expect(copySnaps).toHaveLength(1);
    expect(copySnaps[0].kind).toBe('duplicate');
  });

  it('runs startup integrity check to remove orphan snapshots, files, messages, previewStorage, and blobs', async () => {
    await createSnapshot(projectId, { label: 'Live', kind: 'ai' }, mem);

    // Plant orphan records referencing nonexistent project
    await mem.putSnapshot({
      id: 'snap_orphan',
      projectId: 'proj_deleted',
      createdAt: 500,
      label: 'Ghost',
      kind: 'ai',
      fileCount: 1,
      totalBytes: 5,
      manifest: { 'ghost.txt': 'dead_hash_999' },
      meta: {},
    });
    await mem.putBlobs([{ hash: 'dead_hash_999', content: 'ghost', size: 5 }]);
    await mem.putFile({
      id: 'file_orphan',
      projectId: 'proj_deleted',
      path: 'ghost.txt',
      content: 'ghost',
      createdAt: 500,
      updatedAt: 500,
    });
    await mem.bulkPutMessages([
      { id: 'msg_orphan', projectId: 'proj_deleted', role: 'user', content: 'hi', createdAt: 500 },
    ]);
    mem.state.previewStorage.set('proj_deleted:k', {
      projectId: 'proj_deleted',
      key: 'k',
      value: 'v',
    });

    const summary = await runStartupIntegrityCheck({ force: true }, mem);
    expect(summary.ran).toBe(true);
    expect(summary.deletedSnapshots).toBe(1);
    expect(summary.deletedFiles).toBe(1);
    expect(summary.deletedMessages).toBe(1);
    expect(summary.deletedPreviewEntries).toBe(1);
    expect(summary.deletedBlobs).toBe(1);

    // Valid project remains untouched
    expect((await mem.listProjectFiles(projectId)).length).toBe(2);
    expect((await mem.listProjectSnapshots(projectId)).length).toBe(1);
  });
});
