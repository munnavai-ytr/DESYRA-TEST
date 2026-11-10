/**
 * Single-project ZIP export and import backed by pure TypeScript ZIP reader/writer
 * and DESYRA transactional storage.
 */

import {
  requestPersistentStorageSafe,
  type Project,
  type ProjectFile,
  type SnapshotPlanSummary,
  type BlobRecord,
} from '@/lib/db';
import type { DesignSpec, ProjectDesignData } from '@/lib/design/types';
import {
  extractDesignSpec,
  computeStringHash,
  MANAGED_DESIGN_FILES,
} from '@/lib/design/install';
import { generateTokensCss } from '@/lib/design/css/generateTokensCss';
import { generateBaseCss } from '@/lib/design/css/generateBaseCss';
import { generateComponentsCss } from '@/lib/design/css/generateComponentsCss';
import {
  buildZipBytes,
  createZipBlob,
  formatDateYyyyMmDd,
  slugifyProjectName,
  type ZipWriteEntry,
} from './writer';
import { readZipEntries } from './reader';
import { generateProjectReadme } from './readme';
import { computeContentHash, computeUtf8ByteLength } from '@/lib/history/hash';
import {
  createDexieHistoryAdapter,
  cloneData,
  type HistoryStorageAdapter,
} from '@/lib/history/storage';
import { buildSafeSnapshotMeta, sanitizePlanSummary } from '@/lib/history/snapshots';

export const PROJECT_METADATA_PATH = '.desyra/project.json';

export interface DesyraProjectMetadataFile {
  formatVersion: 1;
  title: string;
  idea: string;
  createdAt: number;
  updatedAt: number;
  design?: DesignSpec | ProjectDesignData;
  plan?: SnapshotPlanSummary;
}

export interface ExportProjectZipOptions {
  projectId: string;
  snapshotId?: string;
  includeReadme?: boolean;
  includeMetadata?: boolean;
}

export interface ExportProjectZipResult {
  blob: Blob;
  bytes: Uint8Array;
  filename: string;
  fileCount: number;
  totalUncompressedBytes: number;
  exceeds50Mb: boolean;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Exports either live project files OR a historical snapshot to a standalone ZIP bundle.
 * Never exports API keys, providers, previewStorage, passphrases, or chat messages.
 */
export async function exportProjectToZip(
  options: ExportProjectZipOptions,
  storage?: HistoryStorageAdapter
): Promise<ExportProjectZipResult> {
  const adapter = storage ?? createDexieHistoryAdapter();
  const includeReadme = options.includeReadme ?? true;
  const includeMetadata = options.includeMetadata ?? true;

  const project = await adapter.getProject(options.projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  let fileEntries: Array<{ path: string; content: string }> = [];
  let effectiveDesign: DesignSpec | ProjectDesignData | undefined = project.design;
  let effectivePlan: SnapshotPlanSummary | undefined = sanitizePlanSummary(project.plan);

  if (options.snapshotId) {
    const snap = await adapter.getSnapshot(options.snapshotId);
    if (!snap || snap.projectId !== project.id) {
      throw new Error('Selected version snapshot was not found.');
    }
    const hashes = Array.from(new Set(Object.values(snap.manifest)));
    const blobs = await adapter.getBlobs(hashes);
    const blobMap = new Map<string, string>();
    for (const b of blobs) {
      blobMap.set(b.hash, b.content);
    }

    const sortedPaths = Object.keys(snap.manifest).sort((a, b) => a.localeCompare(b));
    for (const path of sortedPaths) {
      const hash = snap.manifest[path];
      const content = blobMap.get(hash);
      if (content === undefined) {
        throw new Error(`Snapshot data missing for "${path}". Cannot export this version.`);
      }
      fileEntries.push({ path, content });
    }

    if (snap.meta?.design) {
      effectiveDesign = snap.meta.design;
    }
    if (snap.meta?.plan) {
      effectivePlan = snap.meta.plan;
    }
  } else {
    const dbFiles = await adapter.listProjectFiles(project.id);
    fileEntries = dbFiles.map((f) => ({ path: f.path, content: f.content }));
  }

  const zipEntries: ZipWriteEntry[] = [];
  let hasReadme = false;

  for (const f of fileEntries) {
    if (f.path.startsWith('.desyra/')) continue;
    if (f.path.toLowerCase() === 'readme.md') {
      hasReadme = true;
    }
    zipEntries.push({ path: f.path, content: f.content });
  }

  if (includeReadme && !hasReadme) {
    const readmeText = generateProjectReadme(
      { title: project.title, idea: project.idea },
      fileEntries
    );
    zipEntries.push({ path: 'README.md', content: readmeText });
  }

  if (includeMetadata) {
    const metaPayload: DesyraProjectMetadataFile = {
      formatVersion: 1,
      title: project.title,
      idea: project.idea,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ...(effectiveDesign ? { design: cloneData(effectiveDesign) } : {}),
      ...(effectivePlan ? { plan: cloneData(effectivePlan) } : {}),
    };
    zipEntries.push({
      path: PROJECT_METADATA_PATH,
      content: JSON.stringify(metaPayload, null, 2),
    });
  }

  const built = buildZipBytes(zipEntries);
  const slug = slugifyProjectName(project.title);
  const datePart = formatDateYyyyMmDd();
  const filename = `${slug}-${datePart}.zip`;

  return {
    blob: createZipBlob(built.bytes),
    bytes: built.bytes,
    filename,
    fileCount: built.fileCount,
    totalUncompressedBytes: built.totalUncompressedBytes,
    exceeds50Mb: built.exceeds50Mb,
  };
}

export interface ImportProjectZipResult {
  project: Project;
  importedFileCount: number;
  skippedBinaryFiles: string[];
  warnings: string[];
  regeneratedManagedFiles: string[];
}

function titleFromZipFilename(fileName: string): string {
  const base = fileName
    .replace(/\.zip$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!base) return 'Imported Project';
  return base.slice(0, 60);
}

/**
 * Imports a single project from a ZIP archive as a brand-new local project.
 * Validates all paths, ignores binary files cleanly with a report, reads `.desyra/project.json`
 * without forcing a design system on plain zips, and regenerates missing managed CSS if needed.
 */
export async function importProjectFromZip(
  buffer: ArrayBuffer | Uint8Array,
  zipFileName: string,
  storage?: HistoryStorageAdapter
): Promise<ImportProjectZipResult> {
  const adapter = storage ?? createDexieHistoryAdapter();

  const parsed = await readZipEntries(buffer, {
    maxEntries: 510,
    maxTotalBytes: 50 * 1024 * 1024,
    maxSingleFileBytes: 1024 * 1024,
  });

  const warnings = [...parsed.warnings];
  let metadataRaw: string | null = null;
  const projectFilesRaw: Array<{ path: string; content: string }> = [];

  for (const entry of parsed.files) {
    if (entry.path === PROJECT_METADATA_PATH) {
      metadataRaw = entry.content;
      continue;
    }
    if (entry.path.startsWith('.desyra/')) {
      continue;
    }
    projectFilesRaw.push({ path: entry.path, content: entry.content });
  }

  if (projectFilesRaw.length > 500) {
    throw new Error('Project exceeds the maximum of 500 files allowed per project.');
  }

  if (projectFilesRaw.length === 0) {
    if (parsed.skippedBinaryFiles.length > 0) {
      throw new Error('ZIP contains only binary files; no supported text or code files found.');
    }
    throw new Error('ZIP archive contains no importable project files.');
  }

  let parsedMeta: Partial<DesyraProjectMetadataFile> | null = null;
  if (metadataRaw !== null) {
    try {
      const candidate = JSON.parse(metadataRaw) as unknown;
      if (candidate && typeof candidate === 'object') {
        parsedMeta = candidate as Partial<DesyraProjectMetadataFile>;
      }
    } catch {
      warnings.push('Could not parse .desyra/project.json metadata; imported files cleanly without design metadata.');
    }
  }

  const rawTitle =
    typeof parsedMeta?.title === 'string' && parsedMeta.title.trim()
      ? parsedMeta.title.trim()
      : titleFromZipFilename(zipFileName);
  const title = rawTitle.slice(0, 60);

  const idea =
    typeof parsedMeta?.idea === 'string' && parsedMeta.idea.trim()
      ? parsedMeta.idea.trim()
      : `Imported from ${zipFileName || 'ZIP archive'}`;

  // Handle Design System metadata cleanly ONLY if metadata declared it
  let resolvedDesign: Project['design'] = undefined;
  const regeneratedManagedFiles: string[] = [];

  if (parsedMeta?.design) {
    const spec = extractDesignSpec(parsedMeta.design);
    if (spec) {
      const presentPaths = new Map<string, string>();
      for (const f of projectFilesRaw) {
        presentPaths.set(f.path, f.content);
      }

      const generators: Record<string, (s: DesignSpec) => string> = {
        'css/tokens.css': generateTokensCss,
        'css/base.css': generateBaseCss,
        'css/components.css': generateComponentsCss,
      };

      const managedHashes: Record<string, string> = {};
      for (const managedPath of MANAGED_DESIGN_FILES) {
        const existingContent = presentPaths.get(managedPath);
        if (existingContent !== undefined) {
          managedHashes[managedPath] = computeStringHash(existingContent);
        } else {
          const regenerated = generators[managedPath](spec);
          projectFilesRaw.push({ path: managedPath, content: regenerated });
          managedHashes[managedPath] = computeStringHash(regenerated);
          regeneratedManagedFiles.push(managedPath);
        }
      }

      if (regeneratedManagedFiles.length > 0) {
        warnings.push(
          `Regenerated missing design system file(s): ${regeneratedManagedFiles.join(', ')}`
        );
      }

      resolvedDesign = {
        spec: cloneData(spec),
        managedFiles: [...MANAGED_DESIGN_FILES],
        managedHashes,
        updatedAt: Date.now(),
      };
    }
  }

  // Sort deterministically & enforce 500 file cap cleanly after optional regeneration
  projectFilesRaw.sort((a, b) => a.path.localeCompare(b.path));
  if (projectFilesRaw.length > 500) {
    throw new Error('Imported files plus regenerated design assets exceed the 500-file project limit.');
  }

  // Precompute content hashes OUTSIDE transaction
  const manifest: Record<string, string> = {};
  const blobsMap = new Map<string, BlobRecord>();
  let totalBytes = 0;

  for (const f of projectFilesRaw) {
    const size = computeUtf8ByteLength(f.content);
    const hash = await computeContentHash(f.content);
    manifest[f.path] = hash;
    totalBytes += size;
    if (!blobsMap.has(hash)) {
      blobsMap.set(hash, { hash, content: f.content, size });
    }
  }

  const now = Date.now();
  const newProjectId = generateId('proj');
  const newProject: Project = {
    id: newProjectId,
    title,
    idea,
    createdAt: now,
    updatedAt: now,
    autoStarted: true, // Prevent auto-building over imported files
    ...(resolvedDesign ? { design: resolvedDesign } : {}),
  };

  let existingProjectCount = 0;

  await adapter.transaction(
    'rw',
    ['projects', 'files', 'snapshots', 'blobs'],
    async () => {
      const existingProjects = await adapter.listProjects();
      existingProjectCount = existingProjects.length;

      await adapter.addProject(newProject);

      const fileRecords: ProjectFile[] = projectFilesRaw.map((f) => ({
        id: generateId('file'),
        projectId: newProjectId,
        path: f.path,
        content: f.content,
        createdAt: now,
        updatedAt: now,
      }));
      await adapter.bulkPutFiles(fileRecords);

      const hashes = Array.from(blobsMap.keys());
      const existingBlobs = await adapter.getBlobs(hashes);
      const existingSet = new Set(existingBlobs.map((b) => b.hash));
      const newBlobs: BlobRecord[] = [];
      for (const [h, blob] of blobsMap.entries()) {
        if (!existingSet.has(h)) {
          newBlobs.push(blob);
        }
      }
      if (newBlobs.length > 0) {
        await adapter.putBlobs(newBlobs);
      }

      await adapter.putSnapshot({
        id: generateId('snap'),
        projectId: newProjectId,
        createdAt: now,
        label: 'Imported from ZIP',
        kind: 'import',
        fileCount: projectFilesRaw.length,
        totalBytes,
        manifest,
        meta: buildSafeSnapshotMeta(resolvedDesign, undefined),
      });
    }
  );

  if (existingProjectCount === 0 && typeof window !== 'undefined') {
    void requestPersistentStorageSafe();
  }

  return {
    project: newProject,
    importedFileCount: projectFilesRaw.length,
    skippedBinaryFiles: parsed.skippedBinaryFiles,
    warnings,
    regeneratedManagedFiles,
  };
}
