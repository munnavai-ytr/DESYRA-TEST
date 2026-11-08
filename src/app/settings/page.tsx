'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  KeyRound,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ShieldAlert,
  Palette,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PRESET_PROVIDERS } from '@/lib/providers';
import {
  listProviders,
  getSecurityMode,
  isSessionLocked,
  type SafeProviderInfo,
  type SecurityMode,
} from '@/lib/keys';
import { getAutoContinueEnabled, setAutoContinueEnabled } from '@/lib/db';
import { ProviderCard } from '@/components/settings/provider-card';
import { CustomProviderSection } from '@/components/settings/custom-provider-card';
import { SecuritySection } from '@/components/settings/security-section';
import { DangerZone } from '@/components/settings/danger-zone';
import { UnlockModal } from '@/components/settings/unlock-modal';

export default function SettingsPage() {
  const [providers, setProviders] = useState<SafeProviderInfo[]>([]);
  const [securityMode, setSecurityMode] = useState<SecurityMode>('default');
  const [isLocked, setIsLocked] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [showProtectionDetails, setShowProtectionDetails] = useState(false);
  const [autoContinueEnabled, setAutoContinueEnabledState] = useState(true);

  const loadData = useCallback(() => {
    setIsLoading(true);
    setStorageError(null);
    Promise.all([
      listProviders(),
      getSecurityMode(),
      isSessionLocked(),
      getAutoContinueEnabled(),
    ])
      .then(([allProviders, mode, locked, autoContinue]) => {
        setProviders(allProviders);
        setSecurityMode(mode);
        setIsLocked(locked);
        setAutoContinueEnabledState(autoContinue);
        if (locked) {
          setIsUnlockModalOpen(true);
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Settings load error:', err);
        const msg = err instanceof Error ? err.message : 'Could not access local storage.';
        setStorageError(msg);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      listProviders(),
      getSecurityMode(),
      isSessionLocked(),
      getAutoContinueEnabled(),
    ])
      .then(([allProviders, mode, locked, autoContinue]) => {
        if (active) {
          setProviders(allProviders);
          setSecurityMode(mode);
          setIsLocked(locked);
          setAutoContinueEnabledState(autoContinue);
          if (locked) {
            setIsUnlockModalOpen(true);
          }
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        console.error('Settings load error:', err);
        if (active) {
          const msg = err instanceof Error ? err.message : 'Could not access local storage.';
          setStorageError(msg);
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const presetSavedMap = new Map<string, SafeProviderInfo>();
  const customSavedList: SafeProviderInfo[] = [];

  for (const p of providers) {
    if (p.isCustom) {
      customSavedList.push(p);
    } else {
      presetSavedMap.set(p.id, p);
    }
  }

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      {/* Top back navigation */}
      <div>
        <Link
          href="/"
          className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to builder</span>
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Settings &amp; Keys
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Manage your Bring-Your-Own-Key (BYOK) providers and local browser encryption.
          </p>
        </div>

        {/* Global Active Model Chip */}
        {providers.length > 0 && (() => {
          const defaultProvider = providers.find((p) => p.isDefault) || providers[0];
          return (
            <div className="flex items-center gap-2 p-2 px-3 rounded-[var(--radius-pill)] bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] shrink-0 self-start sm:self-auto">
              <span className="w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_8px_rgba(255,107,26,0.8)]" />
              <span className="font-medium text-[var(--text)]">{defaultProvider.label}</span>
              <span className="text-[var(--disabled)]">/</span>
              <span className="font-mono text-[var(--accent)]">
                {defaultProvider.defaultModel || 'No model selected'}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Storage Error Banner */}
      {storageError && (
        <div className="p-4 rounded-[var(--radius-md)] bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.25)] flex items-start gap-3 text-xs text-[var(--error)]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">Storage Access Failure</p>
            <p className="mt-1 leading-relaxed">{storageError}</p>
          </div>
        </div>
      )}

      {/* Locked Session Notice */}
      {isLocked && (
        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--accent-soft)] border border-[rgba(255,107,26,0.3)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-xs text-[var(--text)]">
            <ShieldAlert className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span>Passphrase mode is locked. Stored keys are encrypted until unlocked.</span>
          </div>
          <button
            type="button"
            onClick={() => setIsUnlockModalOpen(true)}
            className="text-xs font-semibold text-[var(--accent)] hover:underline whitespace-nowrap"
          >
            Unlock Now
          </button>
        </div>
      )}

      {/* Section A: AI Keys (BYOK) Intro Card */}
      <Card className="p-6">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-semibold text-[var(--text)]">
                AI Keys (BYOK)
              </h2>
              <Badge variant="accent" size="sm">
                Zero Markup
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-[var(--text)] leading-relaxed">
              Your keys are encrypted and stored only in this browser. DESYRA has no server that receives them.
            </p>

            <button
              type="button"
              onClick={() => setShowProtectionDetails((prev) => !prev)}
              className="mt-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1 transition-colors"
            >
              <span>How it&apos;s protected</span>
              {showProtectionDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {showProtectionDetails && (
              <div className="mt-3 p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed animate-in fade-in duration-150">
                <p>
                  Keys are encrypted at rest using the browser&apos;s Web Crypto API (AES-GCM, 256-bit with unique 12-byte IVs).
                </p>
                <p className="mt-2 text-[var(--disabled)]">
                  <strong>Security limits:</strong> This protects against casual access to browser storage, but cannot protect against a compromised device, malicious browser extensions or malware.
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Section B: Provider List */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
            Supported AI Model Providers
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Connect one or more provider accounts. The first saved key becomes your default.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4">
            {[1, 2, 3].map((n) => (
              <Card key={n} className="p-5">
                <Skeleton className="h-5 w-40 mb-3" />
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-8 w-24 mt-4" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {PRESET_PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                savedInfo={presetSavedMap.get(provider.id)}
                onRefresh={loadData}
                onRequireUnlock={() => setIsUnlockModalOpen(true)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Custom Providers Section */}
      {!isLoading && (
        <CustomProviderSection
          customProviders={customSavedList}
          onRefresh={loadData}
          onRequireUnlock={() => setIsUnlockModalOpen(true)}
        />
      )}

      {/* Section C: Security Section (Passphrase Controls) */}
      {!isLoading && (
        <SecuritySection
          securityMode={securityMode}
          onRefresh={loadData}
          onRequireUnlock={() => setIsUnlockModalOpen(true)}
        />
      )}

      {/* Section: AI Builder Behavior */}
      {!isLoading && (
        <Card className="p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
              AI Builder Behavior
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Configure how DESYRA handles code generation and incomplete builds.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 pt-3 border-t border-[var(--border)]">
            <div className="space-y-1">
              <label
                htmlFor="auto-continue-toggle"
                className="text-xs sm:text-sm font-medium text-[var(--text)] cursor-pointer select-none"
              >
                Auto-continue incomplete builds
              </label>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                When an AI model runs into its output token limit or leaves referenced files uncreated, DESYRA automatically prompts it up to 3 times to finish the remaining files.
              </p>
              <p className="text-[11px] text-[var(--disabled)]">
                Note: Auto-continuation sends follow-up requests which consume additional tokens from your configured provider account.
              </p>
            </div>

            <div className="pt-0.5 shrink-0">
              <input
                id="auto-continue-toggle"
                type="checkbox"
                checked={autoContinueEnabled}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setAutoContinueEnabledState(val);
                  await setAutoContinueEnabled(val);
                }}
                className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] accent-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
              />
            </div>
          </div>
        </Card>
      )}

      {/* Section: Design Engine Preferences */}
      {!isLoading && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-[var(--accent)]" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">
                Design Engine System
              </h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                DESYRA automatically generates deterministic CSS tokens, base reset, and premium component primitives for every project.
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border)] space-y-3 text-xs text-[var(--muted)]">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-[var(--text)]">Managed CSS files</span>
                <p className="text-[11px] text-[var(--disabled)]">css/tokens.css, css/base.css, css/components.css</p>
              </div>
              <Badge variant="accent" size="sm">Active</Badge>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2.5">
              <div>
                <span className="font-medium text-[var(--text)]">WCAG 2.1 AA/AAA Contrast Guarantees</span>
                <p className="text-[11px] text-[var(--disabled)]">Ensures text contrast passes 7:1 (AA) or 4.5:1 (AAA) automatically</p>
              </div>
              <Badge variant="accent" size="sm">Guaranteed</Badge>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2.5">
              <div>
                <span className="font-medium text-[var(--text)]">Bengali &amp; English Typography</span>
                <p className="text-[11px] text-[var(--disabled)]">Auto-selects Hind Siliguri / Noto Sans Bengali for Bengali prompts</p>
              </div>
              <Badge variant="accent" size="sm">Auto-Detect</Badge>
            </div>
          </div>
        </Card>
      )}

      {/* Section D: Danger Zone */}
      {!isLoading && <DangerZone onRefresh={loadData} />}

      {/* Unlock Modal for Passphrase Mode */}
      <UnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onUnlocked={() => {
          setIsLocked(false);
          loadData();
        }}
      />
    </div>
  );
}
