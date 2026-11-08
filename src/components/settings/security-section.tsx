'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Unlock,
  KeyRound,
  Eye,
  EyeOff,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  type SecurityMode,
  enablePassphrase,
  changePassphrase,
  disablePassphrase,
} from '@/lib/keys';
import { useToast } from '@/components/ui/toast';

export interface SecuritySectionProps {
  securityMode: SecurityMode;
  onRefresh: () => void;
  onRequireUnlock?: () => void;
}

export function SecuritySection({
  securityMode,
  onRefresh,
  onRequireUnlock,
}: SecuritySectionProps) {
  const { toast } = useToast();

  // Modals
  const [isEnableModalOpen, setIsEnableModalOpen] = useState(false);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);

  // Enable form state
  const [enablePass, setEnablePass] = useState('');
  const [enableConfirm, setEnableConfirm] = useState('');
  const [showEnablePass, setShowEnablePass] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  // Change form state
  const [changeOld, setChangeOld] = useState('');
  const [changeNew, setChangeNew] = useState('');
  const [changeConfirm, setChangeConfirm] = useState('');
  const [showChangePass, setShowChangePass] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  // Disable form state
  const [disablePass, setDisablePass] = useState('');
  const [showDisablePass, setShowDisablePass] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Handlers
  const handleEnableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enablePass.trim()) {
      setEnableError('Passphrase cannot be empty');
      return;
    }
    if (enablePass.length < 6) {
      setEnableError('Passphrase must be at least 6 characters');
      return;
    }
    if (enablePass !== enableConfirm) {
      setEnableError('Passphrases do not match');
      return;
    }

    setIsEnabling(true);
    setEnableError(null);
    try {
      await enablePassphrase(enablePass);
      setEnablePass('');
      setEnableConfirm('');
      setIsEnableModalOpen(false);
      toast({
        type: 'success',
        title: 'Passphrase Mode Enabled',
        message: 'All keys have been re-encrypted with your secret passphrase.',
      });
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to enable passphrase.';
      setEnableError(msg);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeOld.trim()) {
      setChangeError('Current passphrase is required');
      return;
    }
    if (!changeNew.trim()) {
      setChangeError('New passphrase cannot be empty');
      return;
    }
    if (changeNew.length < 6) {
      setChangeError('New passphrase must be at least 6 characters');
      return;
    }
    if (changeNew !== changeConfirm) {
      setChangeError('New passphrases do not match');
      return;
    }

    setIsChanging(true);
    setChangeError(null);
    try {
      const success = await changePassphrase(changeOld, changeNew);
      if (success) {
        setChangeOld('');
        setChangeNew('');
        setChangeConfirm('');
        setIsChangeModalOpen(false);
        toast({
          type: 'success',
          title: 'Passphrase Changed',
          message: 'All keys were re-encrypted with your new passphrase.',
        });
        onRefresh();
      } else {
        setChangeError('Current passphrase was incorrect');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change passphrase.';
      setChangeError(msg);
    } finally {
      setIsChanging(false);
    }
  };

  const handleDisableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePass.trim()) {
      setDisableError('Passphrase is required to disable');
      return;
    }

    setIsDisabling(true);
    setDisableError(null);
    try {
      const success = await disablePassphrase(disablePass);
      if (success) {
        setDisablePass('');
        setIsDisableModalOpen(false);
        toast({
          type: 'info',
          title: 'Returned to Default Mode',
          message: 'Keys re-encrypted with local browser-bound key.',
        });
        onRefresh();
      } else {
        setDisableError('Incorrect passphrase. Could not decrypt keys.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to disable passphrase.';
      setDisableError(msg);
    } finally {
      setIsDisabling(false);
    }
  };

  return (
    <>
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text)] tracking-tight">
                Encryption &amp; Protection Mode
              </h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Control how encryption keys are managed and held in storage.
              </p>
            </div>
          </div>

          <Badge variant={securityMode === 'passphrase' ? 'accent' : 'default'} size="md">
            {securityMode === 'passphrase' ? 'Passphrase Mode' : 'Default Mode'}
          </Badge>
        </div>

        {/* Explanation text */}
        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed space-y-2 mb-4">
          {securityMode === 'default' ? (
            <>
              <p className="text-[var(--text)] font-medium">Default Mode (Browser-Bound Key):</p>
              <p>
                A 256-bit non-extractable AES-GCM CryptoKey is stored directly in IndexedDB. API keys are encrypted at rest and decrypted on the fly without entering a password.
              </p>
              <p>
                For higher confidentiality, you can enable Passphrase Protection below.
              </p>
            </>
          ) : (
            <>
              <p className="text-[var(--text)] font-medium">Passphrase Protection (Zero-Knowledge):</p>
              <p>
                Keys are derived with PBKDF2 (SHA-256, 600,000 rounds) from your secret passphrase. The encryption key is held strictly in memory for the active session and never stored on disk.
              </p>
              <p>
                Whenever you reopen or refresh the application, an Unlock modal requires your passphrase.
              </p>
            </>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {securityMode === 'default' ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setEnableError(null);
                setEnablePass('');
                setEnableConfirm('');
                setIsEnableModalOpen(true);
              }}
              leftIcon={<Lock className="w-4 h-4 text-[var(--accent)]" />}
            >
              Enable Passphrase Protection
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setChangeError(null);
                  setChangeOld('');
                  setChangeNew('');
                  setChangeConfirm('');
                  setIsChangeModalOpen(true);
                }}
                leftIcon={<KeyRound className="w-4 h-4" />}
              >
                Change Passphrase
              </Button>

              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setDisableError(null);
                  setDisablePass('');
                  setIsDisableModalOpen(true);
                }}
                leftIcon={<Unlock className="w-4 h-4 text-[var(--muted)]" />}
              >
                Return to Default Mode
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Enable Passphrase Modal */}
      <Modal
        isOpen={isEnableModalOpen}
        onClose={() => setIsEnableModalOpen(false)}
        title="Enable Passphrase Protection"
        description="Set a strong secret passphrase. Any existing stored keys will be decrypted and re-encrypted with a fresh PBKDF2 derived key."
      >
        <form onSubmit={handleEnableSubmit} className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              Secret Passphrase (min 6 characters)
            </label>
            <div className="relative">
              <Input
                type={showEnablePass ? 'text' : 'password'}
                value={enablePass}
                onChange={(e) => {
                  setEnablePass(e.target.value);
                  if (enableError) setEnableError(null);
                }}
                placeholder="Choose a passphrase"
                autoComplete="off"
                spellCheck={false}
                disabled={isEnabling}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowEnablePass((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] p-1"
                aria-label={showEnablePass ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showEnablePass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              Confirm Passphrase
            </label>
            <Input
              type={showEnablePass ? 'text' : 'password'}
              value={enableConfirm}
              onChange={(e) => {
                setEnableConfirm(e.target.value);
                if (enableError) setEnableError(null);
              }}
              placeholder="Re-type passphrase"
              autoComplete="off"
              spellCheck={false}
              disabled={isEnabling}
            />
          </div>

          {enableError && (
            <p className="text-xs text-[var(--error)] flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{enableError}</span>
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsEnableModalOpen(false)}
              disabled={isEnabling}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={isEnabling}
              leftIcon={<Check className="w-4 h-4" />}
            >
              Enable &amp; Re-encrypt Keys
            </Button>
          </div>
        </form>
      </Modal>

      {/* Change Passphrase Modal */}
      <Modal
        isOpen={isChangeModalOpen}
        onClose={() => setIsChangeModalOpen(false)}
        title="Change Passphrase"
        description="Enter your current passphrase and select a new one to re-encrypt your stored keys."
      >
        <form onSubmit={handleChangeSubmit} className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              Current Passphrase
            </label>
            <Input
              type={showChangePass ? 'text' : 'password'}
              value={changeOld}
              onChange={(e) => {
                setChangeOld(e.target.value);
                if (changeError) setChangeError(null);
              }}
              placeholder="Enter current passphrase"
              autoComplete="off"
              spellCheck={false}
              disabled={isChanging}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              New Passphrase (min 6 characters)
            </label>
            <div className="relative">
              <Input
                type={showChangePass ? 'text' : 'password'}
                value={changeNew}
                onChange={(e) => {
                  setChangeNew(e.target.value);
                  if (changeError) setChangeError(null);
                }}
                placeholder="Choose new passphrase"
                autoComplete="off"
                spellCheck={false}
                disabled={isChanging}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowChangePass((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] p-1"
                aria-label={showChangePass ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showChangePass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              Confirm New Passphrase
            </label>
            <Input
              type={showChangePass ? 'text' : 'password'}
              value={changeConfirm}
              onChange={(e) => {
                setChangeConfirm(e.target.value);
                if (changeError) setChangeError(null);
              }}
              placeholder="Re-type new passphrase"
              autoComplete="off"
              spellCheck={false}
              disabled={isChanging}
            />
          </div>

          {changeError && (
            <p className="text-xs text-[var(--error)] flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{changeError}</span>
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsChangeModalOpen(false)}
              disabled={isChanging}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={isChanging}
              leftIcon={<Check className="w-4 h-4" />}
            >
              Update Passphrase
            </Button>
          </div>
        </form>
      </Modal>

      {/* Disable Passphrase Modal */}
      <Modal
        isOpen={isDisableModalOpen}
        onClose={() => setIsDisableModalOpen(false)}
        title="Return to Default Encryption Mode"
        description="Enter your passphrase to confirm decrypting stored keys and re-encrypting them with a local browser-bound key."
      >
        <form onSubmit={handleDisableSubmit} className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-[var(--text)] block mb-1">
              Passphrase
            </label>
            <div className="relative">
              <Input
                type={showDisablePass ? 'text' : 'password'}
                value={disablePass}
                onChange={(e) => {
                  setDisablePass(e.target.value);
                  if (disableError) setDisableError(null);
                }}
                placeholder="Enter your current passphrase"
                autoComplete="off"
                spellCheck={false}
                disabled={isDisabling}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowDisablePass((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] p-1"
                aria-label={showDisablePass ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showDisablePass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {disableError && (
              <p className="text-xs text-[var(--error)] mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{disableError}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsDisableModalOpen(false)}
              disabled={isDisabling}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={isDisabling}
              leftIcon={<Check className="w-4 h-4" />}
            >
              Return to Default Mode
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
