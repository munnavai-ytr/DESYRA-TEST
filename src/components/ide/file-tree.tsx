'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  Plus,
  Trash2,
  Edit2,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  PanelLeftClose,
  FileQuestion,
  AlertTriangle,
} from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import {
  listFiles,
  createFile,
  renameFile,
  deleteFile,
  deleteFolder,
  validateFilePath,
  buildFileTree,
  type TreeNode,
} from '@/lib/files';
import type { ProjectFile } from '@/lib/db';

export interface FileTreeProps {
  projectId: string;
  selectedFilePath: string | null;
  onSelectFile: (file: ProjectFile) => void;
  onToggleCollapse?: () => void;
  isCollapsible?: boolean;
}

export function FileTree({
  projectId,
  selectedFilePath,
  onSelectFile,
  onToggleCollapse,
  isCollapsible = false,
}: FileTreeProps) {
  const { toast } = useToast();

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(['src', 'components', 'lib', 'app', 'public'])
  );

  // Modals state
  const [isNewFileModalOpen, setIsNewFileModalOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileError, setNewFileError] = useState<string | null>(null);

  const [fileToRename, setFileToRename] = useState<ProjectFile | null>(null);
  const [renamePath, setRenamePath] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [fileToDelete, setFileToDelete] = useState<ProjectFile | null>(null);

  const [folderToDelete, setFolderToDelete] = useState<{ path: string; count: number } | null>(
    null
  );

  // Focused node path for keyboard navigation
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load files
  const refreshFiles = useCallback(async () => {
    try {
      const list = await listFiles(projectId);
      setFiles(list);
      return list;
    } catch (err) {
      console.error('Failed to load files:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;
    listFiles(projectId)
      .then((list) => {
        if (isMounted) {
          setFiles(list);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load files:', err);
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // Build tree hierarchy
  const treeNodes = useMemo(() => buildFileTree(files), [files]);

  // List of all file paths for duplicate checking
  const allPaths = useMemo(() => files.map((f) => f.path), [files]);

  // Flat list of visible nodes for keyboard navigation
  const visibleNodes = useMemo(() => {
    const list: TreeNode[] = [];
    function traverse(nodes: TreeNode[]) {
      for (const node of nodes) {
        list.push(node);
        if (node.isFolder && expandedFolders.has(node.path) && node.children) {
          traverse(node.children);
        }
      }
    }
    traverse(treeNodes);
    return list;
  }, [treeNodes, expandedFolders]);

  // Toggle folder expansion
  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (visibleNodes.length === 0) return;

    const currentIndex = visibleNodes.findIndex((n) => n.path === focusedPath);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < visibleNodes.length - 1 ? currentIndex + 1 : 0;
      setFocusedPath(visibleNodes[nextIndex].path);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : visibleNodes.length - 1;
      setFocusedPath(visibleNodes[prevIndex].path);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const node = visibleNodes.find((n) => n.path === focusedPath);
      if (node) {
        if (node.isFolder) {
          toggleFolder(node.path);
        } else if (node.file) {
          onSelectFile(node.file);
        }
      }
    } else if (e.key === 'F2') {
      e.preventDefault();
      const node = visibleNodes.find((n) => n.path === focusedPath);
      if (node && !node.isFolder && node.file) {
        setFileToRename(node.file);
        setRenamePath(node.file.path);
        setRenameError(null);
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const node = visibleNodes.find((n) => n.path === focusedPath);
      if (node) {
        if (node.isFolder) {
          const count = files.filter(
            (f) => f.path.startsWith(`${node.path}/`) || f.path === node.path
          ).length;
          setFolderToDelete({ path: node.path, count });
        } else if (node.file) {
          setFileToDelete(node.file);
        }
      }
    }
  };

  // Create file handler
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateFilePath(newFilePath, allPaths);
    if (!validation.valid) {
      setNewFileError(validation.error || 'Invalid file path');
      return;
    }

    try {
      const created = await createFile(projectId, validation.normalizedPath!);
      toast({
        type: 'success',
        title: 'File Created',
        message: `Created "${created.path}".`,
      });

      // Expand parent folders
      const parts = created.path.split('/');
      if (parts.length > 1) {
        let accumulated = '';
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          for (let i = 0; i < parts.length - 1; i++) {
            accumulated = accumulated ? `${accumulated}/${parts[i]}` : parts[i];
            next.add(accumulated);
          }
          return next;
        });
      }

      await refreshFiles();
      onSelectFile(created);
      setIsNewFileModalOpen(false);
      setNewFilePath('');
      setNewFileError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setNewFileError(msg);
    }
  };

  // Rename file handler
  const handleRenameFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileToRename) return;

    const validation = validateFilePath(renamePath, allPaths, fileToRename.path);
    if (!validation.valid) {
      setRenameError(validation.error || 'Invalid file path');
      return;
    }

    try {
      await renameFile(projectId, fileToRename.path, validation.normalizedPath!);
      toast({
        type: 'info',
        title: 'File Renamed',
        message: `Renamed to "${validation.normalizedPath}".`,
      });

      const updatedList = await refreshFiles();
      const renamed = updatedList.find((f) => f.path === validation.normalizedPath);
      if (renamed && selectedFilePath === fileToRename.path) {
        onSelectFile(renamed);
      }

      setFileToRename(null);
      setRenamePath('');
      setRenameError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenameError(msg);
    }
  };

  // Delete file handler
  const handleDeleteFile = async () => {
    if (!fileToDelete) return;
    try {
      await deleteFile(projectId, fileToDelete.path);
      toast({
        type: 'info',
        title: 'File Deleted',
        message: `Deleted "${fileToDelete.path}".`,
      });

      await refreshFiles();
      setFileToDelete(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        type: 'error',
        title: 'Deletion Failed',
        message: msg,
      });
    }
  };

  // Delete folder handler
  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;
    try {
      const count = await deleteFolder(projectId, folderToDelete.path);
      toast({
        type: 'info',
        title: 'Folder Deleted',
        message: `Deleted folder "${folderToDelete.path}" and ${count} file(s).`,
      });

      await refreshFiles();
      setFolderToDelete(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        type: 'error',
        title: 'Deletion Failed',
        message: msg,
      });
    }
  };

  // Helper for selecting icon based on filename
  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'html':
      case 'htm':
        return <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
      case 'css':
      case 'scss':
        return <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        return <FileCode className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
      case 'json':
        return <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'md':
      case 'txt':
        return <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
      case 'svg':
      case 'png':
      case 'jpg':
      case 'webp':
        return <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      default:
        return <File className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />;
    }
  };

  // Render tree node recursively
  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isFolder = node.isFolder;
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = !isFolder && selectedFilePath === node.path;
    const isFocused = focusedPath === node.path;

    return (
      <div key={node.path} className="select-none">
        <div
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={isFolder ? isExpanded : undefined}
          tabIndex={-1}
          onClick={() => {
            setFocusedPath(node.path);
            if (isFolder) {
              toggleFolder(node.path);
            } else if (node.file) {
              onSelectFile(node.file);
            }
          }}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`group flex items-center justify-between h-7 pr-2 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
            isSelected
              ? 'bg-[var(--accent-soft)] text-[var(--text)] font-medium border-l-2 border-[var(--accent)]'
              : isFocused
              ? 'bg-[var(--surface)] text-[var(--text)]'
              : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
          }`}
        >
          {/* Node Label */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
            {isFolder ? (
              <span className="text-[var(--disabled)] shrink-0">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}

            {isFolder ? (
              isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
              )
            ) : (
              getFileIcon(node.name)
            )}

            <span className="truncate">{node.name}</span>
          </div>

          {/* Action Buttons: Rename & Delete */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            {isFolder ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const count = files.filter(
                    (f) => f.path.startsWith(`${node.path}/`) || f.path === node.path
                  ).length;
                  setFolderToDelete({ path: node.path, count });
                }}
                title="Delete folder"
                className="p-1 text-[var(--muted)] hover:text-[var(--error)] rounded hover:bg-[var(--elevated)]"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (node.file) {
                      setFileToRename(node.file);
                      setRenamePath(node.file.path);
                      setRenameError(null);
                    }
                  }}
                  title="Rename (F2)"
                  className="p-1 text-[var(--muted)] hover:text-[var(--text)] rounded hover:bg-[var(--elevated)]"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (node.file) {
                      setFileToDelete(node.file);
                    }
                  }}
                  title="Delete (Del)"
                  className="p-1 text-[var(--muted)] hover:text-[var(--error)] rounded hover:bg-[var(--elevated)]"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Render Folder Children */}
        {isFolder && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)] overflow-hidden focus:outline-none select-none"
    >
      {/* Header */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-[var(--border)] shrink-0 bg-[var(--surface)]">
        <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
          Explorer ({files.length})
        </span>

        <div className="flex items-center gap-1">
          <Tooltip content="New file" position="bottom">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="Create new file"
              onClick={() => {
                setNewFilePath('');
                setNewFileError(null);
                setIsNewFileModalOpen(true);
              }}
              className="w-6 h-6 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)]"
            >
              <Plus className="w-3.5 h-3.5" />
            </IconButton>
          </Tooltip>

          {isCollapsible && onToggleCollapse && (
            <Tooltip content="Toggle panel" position="bottom">
              <IconButton
                size="sm"
                variant="ghost"
                aria-label="Toggle panel"
                onClick={onToggleCollapse}
                className="w-6 h-6 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)]"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-2 pr-1">
        {isLoading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2 ml-4" />
            <Skeleton className="h-5 w-2/3 ml-4" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center">
            <EmptyState
              icon={<FileQuestion className="w-5 h-5 text-[var(--muted)]" />}
              title="No files yet"
              description="Files appear here when DESYRA builds your app, or add one manually."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setNewFilePath('');
                    setNewFileError(null);
                    setIsNewFileModalOpen(true);
                  }}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  New file
                </Button>
              }
            />
          </div>
        ) : (
          <div role="tree" aria-label="Project files">
            {treeNodes.map((node) => renderNode(node, 0))}
          </div>
        )}
      </div>

      {/* New File Modal */}
      <Modal
        isOpen={isNewFileModalOpen}
        onClose={() => setIsNewFileModalOpen(false)}
        title="Create New File"
        description="Enter a relative file path (e.g., src/index.js, index.html, styles/app.css)."
      >
        <form onSubmit={handleCreateFile} className="space-y-4 pt-2">
          <div>
            <Input
              value={newFilePath}
              onChange={(e) => {
                setNewFilePath(e.target.value);
                setNewFileError(null);
              }}
              placeholder="e.g. src/components/button.tsx"
              autoFocus
              className="text-xs sm:text-sm font-mono"
            />
            {newFileError && (
              <p className="text-xs text-[var(--error)] mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{newFileError}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsNewFileModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!newFilePath.trim()}>
              Create File
            </Button>
          </div>
        </form>
      </Modal>

      {/* Rename File Modal */}
      <Modal
        isOpen={Boolean(fileToRename)}
        onClose={() => setFileToRename(null)}
        title="Rename File"
        description={`Rename or move "${fileToRename?.path}".`}
      >
        <form onSubmit={handleRenameFile} className="space-y-4 pt-2">
          <div>
            <Input
              value={renamePath}
              onChange={(e) => {
                setRenamePath(e.target.value);
                setRenameError(null);
              }}
              autoFocus
              className="text-xs sm:text-sm font-mono"
            />
            {renameError && (
              <p className="text-xs text-[var(--error)] mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{renameError}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setFileToRename(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!renamePath.trim() || renamePath.trim() === fileToRename?.path}
            >
              Rename
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete File Confirmation Modal */}
      <Modal
        isOpen={Boolean(fileToDelete)}
        onClose={() => setFileToDelete(null)}
        title="Delete File"
        description={`Are you sure you want to permanently delete "${fileToDelete?.path}"? This cannot be undone.`}
      >
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setFileToDelete(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleDeleteFile}
            className="bg-[var(--error)] hover:bg-[#dc2626] border-none"
          >
            Delete File
          </Button>
        </div>
      </Modal>

      {/* Delete Folder Confirmation Modal */}
      <Modal
        isOpen={Boolean(folderToDelete)}
        onClose={() => setFolderToDelete(null)}
        title="Delete Folder"
        description={
          folderToDelete
            ? `Are you sure you want to delete folder "${folderToDelete.path}"? This will remove ${folderToDelete.count} file(s).`
            : ''
        }
      >
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setFolderToDelete(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleDeleteFolder}
            className="bg-[var(--error)] hover:bg-[#dc2626] border-none"
          >
            Delete Folder
          </Button>
        </div>
      </Modal>
    </div>
  );
}
