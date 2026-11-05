import Dexie, { type Table } from 'dexie';
import { notify } from '@/components/ui/toast';

export interface Project {
  id: string;
  title: string;
  idea: string;
  createdAt: number;
  updatedAt: number;
}

export class DesyraDatabase extends Dexie {
  projects!: Table<Project, string>;

  constructor() {
    super('desyra_db');
    this.version(1).stores({
      projects: 'id, title, createdAt, updatedAt',
    });
  }
}

// Lazy/singleton instance
let dbInstance: DesyraDatabase | null = null;

export function getDb(): DesyraDatabase | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!dbInstance) {
    try {
      dbInstance = new DesyraDatabase();
    } catch (err) {
      console.error('[DESYRA DB] Initialization error:', err);
      notify({
        type: 'error',
        title: 'Storage Unavailable',
        message: 'Could not initialize IndexedDB storage.',
      });
      return null;
    }
  }
  return dbInstance;
}

/**
 * Creates a project record in IndexedDB.
 * Title is derived from the first ~40 characters of the idea.
 */
export async function createProject(idea: string, customTitle?: string): Promise<Project | null> {
  const trimmedIdea = idea.trim();
  if (!trimmedIdea) {
    notify({
      type: 'error',
      title: 'Invalid Input',
      message: 'App idea cannot be empty.',
    });
    return null;
  }

  const database = getDb();
  if (!database) {
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'IndexedDB is not supported or accessible in this environment.',
    });
    return null;
  }

  // Derive title from first ~40 chars
  let derivedTitle = customTitle?.trim();
  if (!derivedTitle) {
    if (trimmedIdea.length <= 40) {
      derivedTitle = trimmedIdea;
    } else {
      const cut = trimmedIdea.slice(0, 40);
      const lastSpace = cut.lastIndexOf(' ');
      derivedTitle = (lastSpace > 25 ? cut.slice(0, lastSpace) : cut).trim() + '...';
    }
  }

  const project: Project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    title: derivedTitle,
    idea: trimmedIdea,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    await database.projects.add(project);
    return project;
  } catch (error) {
    console.error('[DESYRA DB] Failed to create project:', error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Failed to save your project to local storage.',
    });
    return null;
  }
}

/**
 * Lists all projects ordered by newest first.
 */
export async function listProjects(): Promise<Project[]> {
  const database = getDb();
  if (!database) return [];

  try {
    const list = await database.projects.orderBy('createdAt').reverse().toArray();
    return list;
  } catch (error) {
    console.error('[DESYRA DB] Failed to list projects:', error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Could not load projects from local storage.',
    });
    return [];
  }
}

/**
 * Retrieves a single project by ID.
 */
export async function getProject(id: string): Promise<Project | null> {
  const database = getDb();
  if (!database || !id) return null;

  try {
    const item = await database.projects.get(id);
    return item ?? null;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to get project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: `Failed to load project with ID ${id}.`,
    });
    return null;
  }
}

/**
 * Deletes a project by ID.
 */
export async function deleteProject(id: string): Promise<boolean> {
  const database = getDb();
  if (!database || !id) return false;

  try {
    await database.projects.delete(id);
    return true;
  } catch (error) {
    console.error(`[DESYRA DB] Failed to delete project ${id}:`, error);
    notify({
      type: 'error',
      title: 'Storage Error',
      message: 'Could not delete project from local storage.',
    });
    return false;
  }
}
