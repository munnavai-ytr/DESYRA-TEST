'use client';

import React, { useState } from 'react';
import {
  Plus,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  Star,
  RefreshCw,
  Trash2,
  Key,
  Globe,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { validateCustomBaseUrl } from '@/lib/providers';
import {
  type SafeProviderInfo,
  saveKey,
  deleteKey,
  setDefault,
} from '@/lib/keys';
import { useToast } from '@/components/ui/toast';

export interface CustomProviderCardProps {
  customProviders: SafeProviderInfo[];
  onRefresh: () => void;
  onRequireUnlock?: () => void;
}

export function CustomProviderSection({
  customProviders,
  onRefresh,
  onRequireUnlock,
}: CustomProviderCardProps) {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; baseUrl?: string; apiKey?: string; general?: string }>({});

  // Editing state for an existing custom provider
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [showEditKey, setShowEditKey] = useState(false);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Deletion modal state
  const [deletingProvider, setDeletingProvider] = useState<SafeProviderInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const resetAddForm = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setShowKey(false);
    setErrors({});
    setIsAddOpen(false);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanUrl = baseUrl.trim();
    const cleanKey = apiKey.trim();

    const newErrors: { name?: string; baseUrl?: string; apiKey?: string; general?: string } = {};

    if (!cleanName) newErrors.name = 'Provider name is required';
    const urlValidation = validateCustomBaseUrl(cleanUrl);
    if (!urlValidation.valid) newErrors.baseUrl = urlValidation.error;
    if (!cleanKey) newErrors.apiKey = 'API key is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSaving(true);
    setErrors({});
    try {
      const customId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await saveKey({
        providerId: customId,
        providerType: 'openai-compatible',
        label: cleanName,
        baseUrl: cleanUrl,
        apiKey: cleanKey,
        isCustom: true,
      });

      resetAddForm();
      toast({
        type: 'success',
        title: 'Custom Provider Added',
        message: `"${cleanName}" endpoint is ready.`,
      });
      onRefresh();
    } catch (err: unknown) {
      console.error('Save custom provider error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to save custom provider.';
      if (msg.includes('locked')) {
        onRequireUnlock?.();
      } else {
        setErrors({ general: msg });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReplaceSubmit = async (provider: SafeProviderInfo, e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = editKey.trim();
    if (!cleanKey) {
      setEditError('API key cannot be empty');
      return;
    }

    setIsEditSaving(true);
    setEditError(null);
    try {
      await saveKey({
        providerId: provider.id,
        providerType: provider.providerType,
        label: provider.label,
        baseUrl: provider.baseUrl,
        apiKey: cleanKey,
        isCustom: true,
      });

      setEditingId(null);
      setEditKey('');
      setShowEditKey(false);
      toast({
        type: 'success',
        title: 'Key Updated',
        message: `Key for "${provider.label}" updated successfully.`,
      });
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update key.';
      if (msg.includes('locked')) {
        onRequireUnlock?.();
      } else {
        setEditError(msg);
      }
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProvider) return;
    setIsDeleting(true);
    try {
      const ok = await deleteKey(deletingProvider.id);
      if (ok) {
        toast({
          type: 'info',
          title: 'Provider Removed',
          message: `"${deletingProvider.label}" was deleted.`,
        });
        setDeletingProvider(null);
        onRefresh();
      }
    } catch {
      toast({
        type: 'error',
        title: 'Error',
        message: 'Could not delete provider.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSetDefault = async (providerId: string, label: string) => {
    try {
      const ok = await setDefault(providerId);
      if (ok) {
        toast({
          type: 'success',
          title: 'Default Provider Set',
          message: `"${label}" is now the default provider.`,
        });
        onRefresh();
      }
    } catch (err) {
      console.error('Failed to set default provider:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
            Custom OpenAI-Compatible Providers
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Connect local models (Ollama, vLLM, LM Studio) or secondary gateway endpoints.
          </p>
        </div>

        {!isAddOpen && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Add Custom Provider
          </Button>
        )}
      </div>

      {/* Inline Form to Add New Custom Provider */}
      {isAddOpen && (
        <Card className="p-5 border-[var(--accent)]/40 animate-in fade-in duration-150">
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
              <h4 className="text-sm font-semibold text-[var(--text)]">
                New OpenAI-Compatible Endpoint
              </h4>
              <button
                type="button"
                onClick={resetAddForm}
                className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text)] block mb-1">
                  Provider Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  placeholder="e.g. Local Ollama, DeepSeek API"
                  disabled={isSaving}
                  error={Boolean(errors.name)}
                />
                {errors.name && (
                  <p className="text-[11px] text-[var(--error)] mt-1">{errors.name}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--text)] block mb-1">
                  Base URL
                </label>
                <Input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    if (errors.baseUrl) setErrors((prev) => ({ ...prev, baseUrl: undefined }));
                  }}
                  placeholder="e.g. http://localhost:11434/v1 or https://api.deepseek.com/v1"
                  disabled={isSaving}
                  error={Boolean(errors.baseUrl)}
                />
                {errors.baseUrl && (
                  <p className="text-[11px] text-[var(--error)] mt-1">{errors.baseUrl}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text)] block mb-1">
                API Key
              </label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (errors.apiKey) setErrors((prev) => ({ ...prev, apiKey: undefined }));
                  }}
                  placeholder="Paste API Key (or placeholder if local endpoint needs none)"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isSaving}
                  error={Boolean(errors.apiKey)}
                  className="pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] p-1"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.apiKey && (
                <p className="text-[11px] text-[var(--error)] mt-1">{errors.apiKey}</p>
              )}
            </div>

            {errors.general && (
              <p className="text-xs text-[var(--error)] flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{errors.general}</span>
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={resetAddForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isSaving}
                leftIcon={<Check className="w-3.5 h-3.5" />}
              >
                Save Custom Provider
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Render all saved custom providers */}
      {customProviders.map((cp) => {
        const isEditing = editingId === cp.id;

        return (
          <Card key={cp.id} className="p-5 transition-all">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-base font-semibold text-[var(--text)] tracking-tight">
                  {cp.label}
                </h4>
                <Badge variant="default" size="sm">
                  Custom
                </Badge>
              </div>

              <div className="flex items-center gap-1.5">
                {cp.isDefault && (
                  <Badge variant="accent" size="sm" className="font-semibold">
                    Default
                  </Badge>
                )}
                <Badge variant="success" size="sm">
                  Saved
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mb-3">
              <Globe className="w-3.5 h-3.5 shrink-0 text-[var(--disabled)]" />
              <span className="font-mono truncate">{cp.baseUrl}</span>
            </div>

            {!isEditing ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] mb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                  <span className="font-mono text-xs text-[var(--text)] tracking-wider">
                    ••••••••{cp.last4}
                  </span>
                </div>
                <span className="text-[11px] text-[var(--disabled)]">
                  Key testing arrives in Push 3.
                </span>
              </div>
            ) : (
              <form
                onSubmit={(e) => handleReplaceSubmit(cp, e)}
                className="space-y-3 pt-2 pb-1 border-t border-[var(--border)] mt-2"
              >
                <div>
                  <label className="text-xs font-medium text-[var(--text)] block mb-1">
                    Replace Key for {cp.label}
                  </label>
                  <div className="relative">
                    <Input
                      type={showEditKey ? 'text' : 'password'}
                      value={editKey}
                      onChange={(e) => {
                        setEditKey(e.target.value);
                        if (editError) setEditError(null);
                      }}
                      placeholder="Paste new API key"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={isEditSaving}
                      error={Boolean(editError)}
                      className="pr-10 font-mono text-xs"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditKey((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] p-1"
                      aria-label={showEditKey ? 'Hide key' : 'Show key'}
                    >
                      {showEditKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {editError && (
                    <p className="text-xs text-[var(--error)] mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{editError}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(null);
                      setEditKey('');
                      setShowEditKey(false);
                      setEditError(null);
                    }}
                    disabled={isEditSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={isEditSaving}
                    disabled={!editKey.trim()}
                    leftIcon={<Check className="w-3.5 h-3.5" />}
                  >
                    Save Key
                  </Button>
                </div>
              </form>
            )}

            {!isEditing && (
              <div className="flex flex-wrap items-center justify-between w-full gap-2 pt-3 border-t border-[var(--border)]/70 mt-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(cp.id);
                      setEditKey('');
                      setShowEditKey(false);
                      setEditError(null);
                    }}
                    leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                  >
                    Replace key
                  </Button>
                  {!cp.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetDefault(cp.id, cp.label)}
                      leftIcon={<Star className="w-3.5 h-3.5" />}
                    >
                      Set as default
                    </Button>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingProvider(cp)}
                  className="text-[var(--muted)] hover:text-[var(--error)]"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                >
                  Delete
                </Button>
              </div>
            )}
          </Card>
        );
      })}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingProvider)}
        onClose={() => setDeletingProvider(null)}
        title="Delete Custom Provider"
        description={
          deletingProvider
            ? `Are you sure you want to delete "${deletingProvider.label}" (${deletingProvider.baseUrl})? The encrypted key will be permanently removed.`
            : ''
        }
      >
        <div className="pt-2 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setDeletingProvider(null)}
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
            Delete Provider
          </Button>
        </div>
      </Modal>
    </div>
  );
}
