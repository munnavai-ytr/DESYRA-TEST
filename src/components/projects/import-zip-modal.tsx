'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileArchive,
  Upload,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Info,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { Project } from '@/lib/db';
import {
  importProjectFromZip,
  type ImportProjectZipResult,
} from '@/lib/zip/projectArchive';

export interface ImportZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (project: Project) => void;
}

export function ImportZipModal({ isOpen, onClose, onImported }: ImportZipModalProps) {
  if (!isOpen) return null;

  return <ImportZipModalInner onClose={onClose} onImported={onImported} />;
}

function ImportZipModalInner({
  onClose,
  onImported,
}: Omit<ImportZipModalProps, 'isOpen'>) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportProjectZipResult | null>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a valid .zip archive.');
      return;
    }

    setSelectedFileName(file.name);
    setError(null);
    setResult(null);
    setIsImporting(true);

    try {
      const buffer = await file.arrayBuffer();
      const imported = await importProjectFromZip(buffer, file.name);
      setResult(imported);
      onImported?.(imported.project);
      toast({
        type: 'success',
        title: 'Project Imported',
        message: `Imported "${imported.project.title}" with ${imported.importedFileCount} file(s).`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not read the selected ZIP archive.';
      setError(message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isImporting) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={isImporting ? () => {} : onClose}
      title="Import Project from ZIP"
      description="Create a new local DESYRA project from a static web archive or previously exported DESYRA ZIP."
      className="max-w-lg"
    >
      <div className="space-y-4 pt-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={handleInputChange}
          className="hidden"
          aria-label="Choose a ZIP file to import"
        />

        {!result ? (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => {
                if (!isImporting) fileInputRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isImporting) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`border-2 border-dashed rounded-[var(--radius-md)] p-6 text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                isDragging
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[#3c3c46]'
              } ${isImporting ? 'pointer-events-none opacity-75' : ''}`}
            >
              {isImporting ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="w-7 h-7 animate-spin text-[var(--accent)]" />
                  <p className="text-sm font-medium text-[var(--text)]">
                    Importing {selectedFileName}...
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Validating paths, extracting text files, and creating initial version snapshot.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center">
                    <Upload className="w-5 h-5 text-[var(--accent)]" />
                  </div>
                  <p className="text-sm font-medium text-[var(--text)]">
                    Drop a .zip archive here, or click to browse
                  </p>
                  <p className="text-xs text-[var(--muted)] max-w-sm leading-relaxed">
                    Up to 500 text/code files per project (1 MB per file, 50 MB archive limit). Binary assets are safely skipped and listed cleanly.
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] flex items-start gap-2.5 text-xs text-[var(--error)]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onClose}
                disabled={isImporting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                leftIcon={<FileArchive className="w-3.5 h-3.5" />}
              >
                Choose .zip File
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text)] truncate">
                  {result.project.title}
                </p>
                <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
                  Imported {result.importedFileCount} file(s) · Initial version saved cleanly
                </p>
              </div>
            </div>

            {result.regeneratedManagedFiles.length > 0 && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] flex items-start gap-2 text-xs text-[var(--muted)]">
                <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-[var(--text)]">
                    Restored missing design engine stylesheet(s)
                  </p>
                  <p className="text-[11px] font-mono mt-0.5">
                    {result.regeneratedManagedFiles.join(', ')}
                  </p>
                </div>
              </div>
            )}

            {result.skippedBinaryFiles.length > 0 && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[rgba(245,183,59,0.08)] border border-[rgba(245,183,59,0.28)] space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-[var(--warning)]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Skipped {result.skippedBinaryFiles.length} binary file(s)
                  </span>
                </div>
                <ul className="max-h-24 overflow-y-auto space-y-0.5 font-mono text-[11px] text-[var(--muted)] pl-1">
                  {result.skippedBinaryFiles.map((path) => (
                    <li key={path} className="truncate">
                      · {path}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] space-y-1 text-xs text-[var(--muted)]">
                <p className="font-medium text-[var(--text)]">Notes</p>
                <ul className="space-y-1 max-h-28 overflow-y-auto text-[11px]">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="leading-snug">
                      · {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                Done
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  const id = result.project.id;
                  onClose();
                  router.push(`/project/${id}`);
                }}
                leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                Open Project
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
