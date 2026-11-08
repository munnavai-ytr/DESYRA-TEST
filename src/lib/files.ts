import { getDb, type ProjectFile } from '@/lib/db';
import { notify } from '@/components/ui/toast';

export const MAX_FILES_PER_PROJECT = 500;
export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB
export const WARN_FILE_SIZE_BYTES = 200 * 1024; // 200 KB

export interface PathValidationResult {
  valid: boolean;
  error?: string;
  normalizedPath?: string;
}

/**
 * Validates a file path according to DESYRA specifications:
 * - POSIX-style relative path
 * - No leading slash
 * - No '..' segments
 * - No empty segments (e.g. '//') and no trailing slashes
 * - No backslashes
 * - Max length 200 characters
 * - Case-sensitive path check against existing files
 */
export function validateFilePath(
  path: string,
  existingPaths: string[] = [],
  currentPath?: string
): PathValidationResult {
  const trimmed = path.trim();

  if (!trimmed) {
    return { valid: false, error: 'File path cannot be empty' };
  }

  if (trimmed.length > 200) {
    return { valid: false, error: 'File path cannot exceed 200 characters' };
  }

  if (trimmed.startsWith('/')) {
    return { valid: false, error: 'Path must not start with a leading slash' };
  }

  if (trimmed.endsWith('/')) {
    return { valid: false, error: 'Path must include a file name, not end in a slash' };
  }

  if (trimmed.includes('\\')) {
    return { valid: false, error: 'Path cannot contain backslashes; use / instead' };
  }

  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!segment) {
      return { valid: false, error: 'Path cannot contain empty segments (e.g. //)' };
    }
    if (segment === '..') {
      return { valid: false, error: 'Path cannot contain parent traversal (..)' };
    }
    if (segment === '.') {
      return { valid: false, error: 'Path cannot contain current directory (.) segments' };
    }
    // Check for invalid filesystem characters in segment
    if (/[<>:"|?*]/.test(segment)) {
      return { valid: false, error: `Invalid character in segment "${segment}"` };
    }
  }

  // Duplicate path check (case-sensitive)
  const isDuplicate = existingPaths.some((p) => p === trimmed && p !== currentPath);
  if (isDuplicate) {
    return { valid: false, error: `A file at "${trimmed}" already exists in this project` };
  }

  return { valid: true, normalizedPath: trimmed };
}

export interface ProjectFileMeta {
  id: string;
  projectId: string;
  path: string;
  size: number;
  updatedAt: number;
}

/**
 * Lists all file metadata for a project (without loading full content into memory), sorted by path.
 */
export async function listFileMetas(projectId: string): Promise<ProjectFileMeta[]> {
  const db = getDb();
  if (!db || !projectId) return [];

  try {
    const metas: ProjectFileMeta[] = [];
    await db.files
      .where('projectId')
      .equals(projectId)
      .each((f) => {
        metas.push({
          id: f.id,
          projectId: f.projectId,
          path: f.path,
          size: typeof f.content === 'string' ? new Blob([f.content]).size : 0,
          updatedAt: f.updatedAt,
        });
      });
    metas.sort((a, b) => a.path.localeCompare(b.path));
    return metas;
  } catch (error) {
    console.error(`[DESYRA Files] Failed to list file metas for project ${projectId}:`, error);
    return [];
  }
}

/**
 * Lists all files for a project, sorted by path.
 */
export async function listFiles(projectId: string): Promise<ProjectFile[]> {
  const db = getDb();
  if (!db || !projectId) return [];

  try {
    const files = await db.files.where('projectId').equals(projectId).sortBy('path');
    return files;
  } catch (error) {
    console.error(`[DESYRA Files] Failed to list files for project ${projectId}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Failed to load project files.',
    });
    return [];
  }
}

/**
 * Retrieves a single file by path.
 */
export async function getFile(projectId: string, path: string): Promise<ProjectFile | null> {
  const db = getDb();
  if (!db || !projectId || !path) return null;

  try {
    const file = await db.files.where('[projectId+path]').equals([projectId, path]).first();
    return file ?? null;
  } catch (error) {
    console.error(`[DESYRA Files] Failed to get file ${path}:`, error);
    return null;
  }
}

/**
 * Creates a new file in the project.
 */
export async function createFile(
  projectId: string,
  path: string,
  content: string = ''
): Promise<ProjectFile> {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not initialized');
  }

  // Check total file limit
  const count = await db.files.where('projectId').equals(projectId).count();
  if (count >= MAX_FILES_PER_PROJECT) {
    throw new Error(`Project file limit reached (${MAX_FILES_PER_PROJECT} files max).`);
  }

  // Check content size
  const byteSize = new Blob([content]).size;
  if (byteSize > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size (${Math.round(byteSize / 1024)} KB) exceeds 1 MB limit.`);
  }

  // Check if file already exists
  const existing = await getFile(projectId, path);
  if (existing) {
    throw new Error(`File at "${path}" already exists.`);
  }

  const newFile: ProjectFile = {
    id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    projectId,
    path,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.files.add(newFile);
  return newFile;
}

/**
 * Updates the content of an existing file.
 */
export async function updateFileContent(
  projectId: string,
  path: string,
  content: string
): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not initialized');
  }

  const byteSize = new Blob([content]).size;
  if (byteSize > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size (${Math.round(byteSize / 1024)} KB) exceeds 1 MB limit.`);
  }

  const file = await getFile(projectId, path);
  if (!file) {
    throw new Error(`File "${path}" not found.`);
  }

  await db.files.update(file.id, {
    content,
    updatedAt: Date.now(),
  });
}

/**
 * Renames or moves a file.
 */
export async function renameFile(
  projectId: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not initialized');
  }

  if (oldPath === newPath) return;

  const file = await getFile(projectId, oldPath);
  if (!file) {
    throw new Error(`File "${oldPath}" not found.`);
  }

  const existingDest = await getFile(projectId, newPath);
  if (existingDest) {
    throw new Error(`File at "${newPath}" already exists.`);
  }

  await db.files.update(file.id, {
    path: newPath,
    updatedAt: Date.now(),
  });
}

/**
 * Deletes a single file.
 */
export async function deleteFile(projectId: string, path: string): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not initialized');
  }

  const file = await getFile(projectId, path);
  if (!file) return;

  await db.files.delete(file.id);
}

/**
 * Deletes all files under a folder path prefix.
 * e.g., folderPath = "src" or "src/"
 * Returns number of files removed.
 */
export async function deleteFolder(projectId: string, folderPath: string): Promise<number> {
  const db = getDb();
  if (!db) {
    throw new Error('Database is not initialized');
  }

  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  const allFiles = await listFiles(projectId);
  const toDelete = allFiles.filter((f) => f.path.startsWith(prefix) || f.path === folderPath);

  if (toDelete.length === 0) return 0;

  const ids = toDelete.map((f) => f.id);
  await db.files.bulkDelete(ids);
  return ids.length;
}

/**
 * Tree representation data structures for rendering.
 */
export interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: TreeNode[];
  file?: ProjectFile | ProjectFileMeta;
}

/**
 * Converts a flat array of ProjectFiles or ProjectFileMetas into a nested Tree hierarchy.
 * Folders first, sorted alphabetically.
 */
export function buildFileTree(files: Array<ProjectFile | ProjectFileMeta>): TreeNode[] {
  const rootNodes: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let currentLevel = rootNodes;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFolder = i < parts.length - 1;

      let existingNode = currentLevel.find((n) => n.name === part && n.isFolder === isFolder);

      if (!existingNode) {
        existingNode = {
          name: part,
          path: currentPath,
          isFolder,
          ...(isFolder ? { children: [] } : { file }),
        };
        currentLevel.push(existingNode);
      }

      if (isFolder) {
        if (!existingNode.children) {
          existingNode.children = [];
        }
        currentLevel = existingNode.children;
      }
    }
  }

  // Recursive sort: folders first, then alphabetical
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const node of nodes) {
      if (node.isFolder && node.children) {
        sortNodes(node.children);
      }
    }
    return nodes;
  }

  return sortNodes(rootNodes);
}
