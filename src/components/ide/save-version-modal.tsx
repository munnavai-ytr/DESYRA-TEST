'use client';

import React, { useState } from 'react';
import { BookmarkPlus, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { saveManualCheckpoint, maybeNotifyFirstTrim } from '@/lib/history/snapshots';

export interface SaveVersionModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onSaved?: (snapshotId: string) => void;
}

export function SaveVersionModal({
  isOpen,
  onClose,
  projectId,
  onSaved,
}: SaveVersionModalProps) {
  if (!isOpen) return null;

  return (
    <SaveVersionModalInner
      key={projectId}
      onClose={onClose}
      projectId={projectId}
      onSaved={onSaved}
    />
  );
}

function SaveVersionModalInner({
  onClose,
  projectId,
  onSaved,
}: Omit<SaveVersionModalProps, 'isOpen'>) {
  const { toast } = useToast();
  const [label, setLabel] = useState('Checkpoint');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setError('Please enter a label for this version.');
      return;
    }
    if (cleanLabel.length > 80) {
      setError('Label cannot exceed 80 characters.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const result = await saveManualCheckpoint(
        projectId,
        cleanLabel,
        note.trim() || undefined
      );

      if (!result.snapshot) {
        setError('Could not save version for this project.');
        return;
      }

      if (result.trimmedCount > 0) {
        const shouldNotifyTrim = await maybeNotifyFirstTrim(result.trimmedCount);
        if (shouldNotifyTrim) {
          toast({
            type: 'info',
            title: 'Version History Limit Reached',
            message:
              'DESYRA keeps the latest 60 unpinned versions automatically. Pinned checkpoints never expire.',
            duration: 6000,
          });
        }
      }

      toast({
        type: 'success',
        title: result.createdNew ? 'Version Saved & Pinned' : 'Version Pinned',
        message: result.createdNew
          ? `Saved checkpoint "${result.snapshot.label}".`
          : `Files match the latest version — pinned "${result.snapshot.label}".`,
      });

      onSaved?.(result.snapshot.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save version.';
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Save Version Checkpoint"
      description="Pinned checkpoints are protected from automatic cleanup so you can always return to this milestone."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="checkpoint-label" className="text-xs font-medium text-[var(--text)]">
              Version label
            </label>
            <span className="text-[11px] text-[var(--disabled)] tabular-nums">
              {label.trim().length}/80
            </span>
          </div>
          <Input
            id="checkpoint-label"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
            maxLength={80}
            placeholder="e.g. Before adding checkout flow"
            autoFocus
            disabled={isSaving}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="checkpoint-note" className="text-xs font-medium text-[var(--text)]">
              Optional note
            </label>
            <span className="text-[11px] text-[var(--disabled)] tabular-nums">
              {note.trim().length}/300
            </span>
          </div>
          <Textarea
            id="checkpoint-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Describe what works well or why you saved this point..."
            disabled={isSaving}
            className="text-xs sm:text-sm min-h-[76px]"
          />
        </div>

        {error && (
          <p className="text-xs text-[var(--error)] flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={isSaving}
            disabled={!label.trim()}
            leftIcon={<BookmarkPlus className="w-3.5 h-3.5" />}
          >
            Save Checkpoint
          </Button>
        </div>
      </form>
    </Modal>
  );
}
