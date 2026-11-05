'use client';

import React, { useState } from 'react';
import {
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  Star,
  RefreshCw,
  Trash2,
  Key,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  type ProviderDefinition,
  checkKeyPrefixWarning,
} from '@/lib/providers';
import {
  type SafeProviderInfo,
  saveKey,
  deleteKey,
  setDefault,
} from '@/lib/keys';
import { useToast } from '@/components/ui/toast';

export interface ProviderCardProps {
  provider: ProviderDefinition;
  savedInfo?: SafeProviderInfo;
  onRefresh: () => void;
  onRequireUnlock?: () => void;
}

export function ProviderCard({
  provider,
  savedInfo,
  onRefresh,
  onRequireUnlock,
}: ProviderCardProps) {
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  const isSaved = Boolean(savedInfo);
  const isDefault = Boolean(savedInfo?.isDefault);

  const prefixWarning = checkKeyPrefixWarning(provider.id, keyInput);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = keyInput.trim();
    if (!cleanKey) {
      setInputError('API Key is required');
      return;
    }

    setIsSaving(true);
    setInputError(null);
    try {
      await saveKey({
        providerId: provider.id,
        providerType: provider.type,
        label: provider.name,
        baseUrl: provider.defaultBaseUrl,
        apiKey: cleanKey,
      });

      // Clear the input and temporary variables immediately
      setKeyInput('');
      setShowKey(false);
      setIsFormOpen(false);

      toast({
        type: 'success',
        title: 'Key Saved',
        message: `${provider.name} key stored securely in your browser.`,
      });
      onRefresh();
    } catch (err: unknown) {
      console.error('Save key error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to save key.';
      if (msg.includes('locked')) {
        onRequireUnlock?.();
      } else {
        setInputError(msg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!savedInfo) return;
    setIsDeleting(true);
    try {
      const ok = await deleteKey(savedInfo.id);
      if (ok) {
        toast({
          type: 'info',
          title: 'Key Deleted',
          message: `${provider.name} key was removed.`,
        });
        setIsDeleteModalOpen(false);
        onRefresh();
      }
    } catch (err) {
      console.error('Delete key error:', err);
      toast({
        type: 'error',
        title: 'Error',
        message: 'Could not delete key.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSetDefault = async () => {
    if (!savedInfo) return;
    setIsSettingDefault(true);
    try {
      const ok = await setDefault(savedInfo.id);
      if (ok) {
        toast({
          type: 'success',
          title: 'Default Provider Set',
          message: `${provider.name} is now your default model provider.`,
        });
        onRefresh();
      }
    } finally {
      setIsSettingDefault(false);
    }
  };

  return (
    <>
      <Card className="p-5 flex flex-col justify-between transition-all">
        <div>
          {/* Header Row: Name & Badges */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--text)] tracking-tight">
                {provider.name}
              </h3>
              {provider.freeTier && (
                <Badge variant="accent" size="sm">
                  Free tier
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isSaved ? (
                <>
                  {isDefault && (
                    <Badge variant="accent" size="sm" className="font-semibold">
                      Default
                    </Badge>
                  )}
                  <Badge variant="success" size="sm">
                    Saved
                  </Badge>
                </>
              ) : (
                <Badge variant="default" size="sm">
                  Not added
                </Badge>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-xs text-[var(--muted)] leading-relaxed mb-3">
            {provider.description}
          </p>

          {provider.freeTier && (
            <p className="text-[11px] text-[var(--disabled)] mb-3 italic">
              Free tier limits and model availability change; check the provider&apos;s page.
            </p>
          )}

          {/* Saved Key State Display */}
          {isSaved && !isFormOpen && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] mb-3">
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                <span className="font-mono text-xs text-[var(--text)] tracking-wider">
                  ••••••••{savedInfo?.last4}
                </span>
              </div>
              <span className="text-[11px] text-[var(--disabled)]">
                Key testing and model list arrive in Push 3.
              </span>
            </div>
          )}

          {/* Inline Add/Replace Form */}
          {isFormOpen && (
            <form onSubmit={handleSave} className="space-y-3 pt-2 pb-1 border-t border-[var(--border)] mt-2">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor={`key-${provider.id}`} className="text-xs font-medium text-[var(--text)]">
                    {isSaved ? 'Replace API Key' : 'API Key'}
                  </label>
                  <a
                    href={provider.keyHelpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                  >
                    <span>Get a key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative">
                  <Input
                    id={`key-${provider.id}`}
                    type={showKey ? 'text' : 'password'}
                    value={keyInput}
                    onChange={(e) => {
                      setKeyInput(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    placeholder={`Paste ${provider.name} key`}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSaving}
                    error={Boolean(inputError)}
                    className="pr-10 font-mono text-xs"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors p-1"
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Soft prefix warning */}
                {prefixWarning && (
                  <p className="text-[11px] text-[var(--warning)] mt-1.5 flex items-start gap-1 leading-normal">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{prefixWarning}</span>
                  </p>
                )}

                {/* Error message */}
                {inputError && (
                  <p className="text-xs text-[var(--error)] mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{inputError}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsFormOpen(false);
                    setKeyInput('');
                    setShowKey(false);
                    setInputError(null);
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={isSaving}
                  disabled={!keyInput.trim()}
                  leftIcon={<Check className="w-3.5 h-3.5" />}
                >
                  Save Key
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Action Button Bar */}
        {!isFormOpen && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border)]/70 mt-2">
            {!isSaved ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsFormOpen(true)}
                className="w-full sm:w-auto"
              >
                Add key
              </Button>
            ) : (
              <div className="flex flex-wrap items-center justify-between w-full gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsFormOpen(true)}
                    leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                  >
                    Replace key
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSetDefault}
                      loading={isSettingDefault}
                      leftIcon={<Star className="w-3.5 h-3.5" />}
                    >
                      Set as default
                    </Button>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="text-[var(--muted)] hover:text-[var(--error)]"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title={`Delete ${provider.name} Key`}
        description={`Are you sure you want to delete your stored ${provider.name} API key? This action will remove the encrypted ciphertext from this browser.`}
      >
        <div className="pt-2 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setIsDeleteModalOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleDelete}
            loading={isDeleting}
            className="bg-[var(--error)] hover:bg-[#dc2626] active:bg-[#b91c1c] text-white shadow-none"
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            Delete Key
          </Button>
        </div>
      </Modal>
    </>
  );
}
