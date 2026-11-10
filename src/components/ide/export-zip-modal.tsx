'use client';

import React, { useState } from 'react';
import { Download, AlertTriangle, ShieldCheck, FileArchive } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { exportProjectToZip } from '@/lib/zip/projectArchive';
import { triggerZipDownload } from '@/lib/zip/writer';

export interface ExportZipModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
  snapshotId?: string;
  snapshotLabel?: string;
}

export function ExportZipModal({
  isOpen,
  onClose,
  projectId,
  projectTitle,
  snapshotId,
  snapshotLabel,
}: ExportZipModalProps) {
  const { toast } = useToast();
  const [includeReadme, setIncludeReadme] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const result = await exportProjectToZip({
        projectId,
        snapshotId,
        includeReadme,
        includeMetadata,
      });

      triggerZipDownload(result.blob, result.filename);

      if (result.exceeds50Mb) {
        toast({
          type: 'warning',
          title: 'Large ZIP Exported',
          message: `"${result.filename}" exceeds 50 MB (${Math.round(
            result.bytes.byteLength / (1024 * 1024)
          )} MB).`,
          duration: 6000,
        });
      } else {
        toast({
          type: 'success',
          title: 'ZIP Downloaded',
          message: `Exported ${result.fileCount} file(s) to ${result.filename}.`,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build ZIP archive.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Download Project ZIP"
      description={
        snapshotId
          ? `Export files from saved version "${snapshotLabel || 'Selected version'}".`
          : `Export all current files for "${projectTitle}" as a portable static web bundle.`
      }
    >
      <div className="space-y-4 pt-1">
        <div className="p-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-start gap-2.5 text-xs">
          <FileArchive className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-[var(--text)] truncate">
              {snapshotId ? `Snapshot: ${snapshotLabel || snapshotId}` : projectTitle}
            </p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              Self-contained static HTML/CSS/JS archive ready for local testing or static hosting.
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <label className="flex items-start gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] hover:border-[#34343d] transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={includeReadme}
              onChange={(e) => setIncludeReadme(e.target.checked)}
              disabled={isExporting}
              className="mt-0.5 w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer shrink-0"
            />
            <div className="min-w-0">
              <span className="text-xs font-medium text-[var(--text)] block">
                Include generated README.md
              </span>
              <span className="text-[11px] text-[var(--muted)] leading-relaxed block mt-0.5">
                Documents project structure, local HTTP server commands when ES modules are detected, and CDN scripts (skipped if your project already has a README.md).
              </span>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] hover:border-[#34343d] transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              disabled={isExporting}
              className="mt-0.5 w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer shrink-0"
            />
            <div className="min-w-0">
              <span className="text-xs font-medium text-[var(--text)] block">
                Include DESYRA metadata (.desyra/project.json)
              </span>
              <span className="text-[11px] text-[var(--muted)] leading-relaxed block mt-0.5">
                Preserves design system tokens and plan settings if you import this ZIP back into DESYRA later.
              </span>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] px-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--success)] shrink-0" />
          <span>API keys, provider configs, chat history, and preview storage are never included.</span>
        </div>

        {error && (
          <p className="text-xs text-[var(--error)] flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={isExporting}
            onClick={handleExport}
            leftIcon={<Download className="w-3.5 h-3.5" />}
          >
            Download .zip
          </Button>
        </div>
      </div>
    </Modal>
  );
}
