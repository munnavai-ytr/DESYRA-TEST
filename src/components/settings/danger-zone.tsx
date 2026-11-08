'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { clearAllKeys, clearAllDatabaseData } from '@/lib/db';
import { useToast } from '@/components/ui/toast';

export interface DangerZoneProps {
  onRefresh: () => void;
}

export function DangerZone({ onRefresh }: DangerZoneProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteKeys = async () => {
    setIsDeleting(true);
    try {
      const ok = await clearAllKeys();
      if (ok) {
        toast({
          type: 'info',
          title: 'Keys Deleted',
          message: 'All stored provider keys have been removed.',
        });
        setIsKeysModalOpen(false);
        onRefresh();
      }
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Could not delete keys.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAllData = async () => {
    if (confirmInput.trim() !== 'DELETE') return;
    setIsDeleting(true);
    try {
      const ok = await clearAllDatabaseData();
      if (ok) {
        toast({
          type: 'info',
          title: 'All Data Deleted',
          message: 'Projects, keys, and drafts wiped successfully.',
        });
        setIsDataModalOpen(false);
        setConfirmInput('');
        router.push('/');
        onRefresh();
      }
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Could not wipe data.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card className="p-6 border-[rgba(239,68,68,0.25)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.25)] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-[var(--error)]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text)] tracking-tight">
              Danger Zone
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Destructive operations that permanently purge local browser storage.
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          {/* Action 1: Delete all keys */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)]">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text)]">
                Delete All AI Keys
              </h4>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Remove all encrypted provider credentials and reset security tokens. Your saved projects will not be touched.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsKeysModalOpen(true)}
              className="text-[var(--error)] hover:border-[var(--error)] hover:bg-[rgba(239,68,68,0.1)] shrink-0"
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              Delete Keys
            </Button>
          </div>

          {/* Action 2: Delete all data */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)]">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text)]">
                Delete All Data (Projects &amp; Keys)
              </h4>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Completely erase all projects, saved ideas, provider keys, and settings from this browser.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirmInput('');
                setIsDataModalOpen(true);
              }}
              className="text-[var(--error)] hover:border-[var(--error)] hover:bg-[rgba(239,68,68,0.1)] shrink-0"
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              Delete All Data
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete All Keys Modal */}
      <Modal
        isOpen={isKeysModalOpen}
        onClose={() => setIsKeysModalOpen(false)}
        title="Delete All AI Keys?"
        description="This will permanently delete all stored API keys and encryption tokens from your browser. Your projects and specifications will remain intact."
      >
        <div className="pt-2 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setIsKeysModalOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleDeleteKeys}
            loading={isDeleting}
            className="bg-[var(--error)] hover:bg-[#dc2626] active:bg-[#b91c1c] text-white shadow-none"
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            Delete All Keys
          </Button>
        </div>
      </Modal>

      {/* Delete All Data Modal (requires typing DELETE) */}
      <Modal
        isOpen={isDataModalOpen}
        onClose={() => {
          setIsDataModalOpen(false);
          setConfirmInput('');
        }}
        title="Delete All Data &amp; Reset App?"
        description="This will permanently delete all projects, saved ideas, provider keys, and drafts. This action is irreversible."
      >
        <div className="space-y-4 pt-2">
          <div className="p-3 bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-md)] text-xs text-[var(--muted)] leading-relaxed">
            Please type <span className="font-mono font-bold text-[var(--text)]">DELETE</span> in capital letters to confirm:
          </div>

          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="Type DELETE"
            autoComplete="off"
            spellCheck={false}
            disabled={isDeleting}
            autoFocus
          />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setIsDataModalOpen(false);
                setConfirmInput('');
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleDeleteAllData}
              disabled={confirmInput.trim() !== 'DELETE'}
              loading={isDeleting}
              className="bg-[var(--error)] hover:bg-[#dc2626] active:bg-[#b91c1c] text-white shadow-none disabled:opacity-40"
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              Wipe Everything
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
