'use client';

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertTriangle, KeyRound, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { unlockSession } from '@/lib/keys';
import { clearAllKeys } from '@/lib/db';
import { useToast } from '@/components/ui/toast';

export interface UnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}

export function UnlockModal({ isOpen, onClose, onUnlocked }: UnlockModalProps) {
  const { toast } = useToast();
  const [passphrase, setPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) {
      setError('Please enter your passphrase');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const success = await unlockSession(passphrase);
      if (success) {
        setPassphrase('');
        toast({
          type: 'success',
          title: 'Session Unlocked',
          message: 'Your encryption session is active.',
        });
        onUnlocked();
        onClose();
      } else {
        setError('Incorrect passphrase. Double check your input and try again.');
      }
    } catch (err: unknown) {
      console.error('Failed to unlock session:', err);
      const msg = err instanceof Error ? err.message : 'Unlock verification failed.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetKeys = async () => {
    setIsDeleting(true);
    try {
      const ok = await clearAllKeys();
      if (ok) {
        toast({
          type: 'info',
          title: 'Keys Deleted',
          message: 'All keys were deleted. You can now configure fresh keys.',
        });
        setPassphrase('');
        setShowForgot(false);
        onClose();
        // Trigger page refresh or state reload
        window.location.reload();
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={showForgot ? 'Reset Lost Passphrase' : 'Unlock DESYRA'}
      description={
        showForgot
          ? 'Because your keys are encrypted with zero-knowledge AES-GCM derived from your passphrase, they cannot be recovered without it.'
          : 'Passphrase protection is active. Enter your passphrase to unlock your stored AI keys for this session.'
      }
    >
      {!showForgot ? (
        <form onSubmit={handleUnlock} className="space-y-4 pt-2">
          <div>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Enter your security passphrase"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={isLoading}
                error={Boolean(error)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors p-1"
                aria-label={showPassword ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && (
              <p className="text-xs text-[var(--error)] mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-4 transition-colors"
            >
              Forgot passphrase?
            </button>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="md" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={isLoading}
                leftIcon={<Lock className="w-4 h-4" />}
              >
                Unlock
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-4 pt-2">
          <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed space-y-2">
            <p className="text-[var(--text)] font-medium">Important Security Notice:</p>
            <p>
              DESYRA stores zero plaintext keys and has no central recovery server. If you do not remember your passphrase, the only path forward is to wipe all locally stored encrypted keys and start over.
            </p>
            <p>Your saved projects will remain untouched.</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setShowForgot(false)}
              disabled={isDeleting}
            >
              Back to Unlock
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleResetKeys}
              loading={isDeleting}
              className="bg-[var(--error)] hover:bg-[#dc2626] active:bg-[#b91c1c] text-white shadow-none"
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              Delete All Keys &amp; Reset
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
