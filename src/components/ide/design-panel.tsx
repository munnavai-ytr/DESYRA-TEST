'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Palette,
  Check,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Play,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import type { DesignSpec, DesignMode, DesignRadius, DesignDensity, DesignMotion, DesignLanguage, LintResult } from '@/lib/design/types';
import { STYLE_PRESETS } from '@/lib/design/presets';
import { ARCHETYPES } from '@/lib/design/archetypes';
import { FONT_PAIRS } from '@/lib/design/fonts';
import { installDesignSystem, checkManagedFilesHashes } from '@/lib/design/install';
import { contrastRatio } from '@/lib/design/color';
import { lintDesign } from '@/lib/design/lint';
import { listFiles } from '@/lib/files';
import type { ProjectFile } from '@/lib/db';

export interface DesignPanelProps {
  projectId: string;
  projectDesign?: DesignSpec | null;
  isOpen: boolean;
  onClose: () => void;
  onFixWithAi?: (fixPrompt: string) => void;
  isStreaming?: boolean;
}

export function DesignPanel({
  projectId,
  projectDesign,
  isOpen,
  onClose,
  onFixWithAi,
  isStreaming = false,
}: DesignPanelProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'theme' | 'review'>('theme');

  // Draft design spec state
  const [spec, setSpec] = useState<DesignSpec | null>(projectDesign ?? null);
  const [prevProjectDesign, setPrevProjectDesign] = useState<DesignSpec | null>(projectDesign ?? null);

  // Derived state sync
  if (projectDesign && projectDesign !== prevProjectDesign) {
    setPrevProjectDesign(projectDesign);
    setSpec(projectDesign);
  }

  // Linting state
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);

  // Load project files and run linter
  const runLinter = useCallback(async () => {
    try {
      const currentFiles = await listFiles(projectId);
      setFiles(currentFiles);
      if (currentFiles.length > 0) {
        const res = lintDesign(currentFiles, spec ?? undefined);
        setLintResult(res);
      }
    } catch (err) {
      console.error('Failed to run design linter:', err);
    }
  }, [projectId, spec]);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    listFiles(projectId).then((currentFiles) => {
      if (!isMounted) return;
      setFiles(currentFiles);
      if (currentFiles.length > 0) {
        const res = lintDesign(currentFiles, spec ?? undefined);
        setLintResult(res);
      }
    }).catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [isOpen, projectId, spec]);

  // Apply changes debounced
  const applyDesignChanges = useCallback(
    async (newSpec: DesignSpec) => {
      try {
        await installDesignSystem(projectId, newSpec, { overwrite: true });
        toast({
          type: 'success',
          title: 'Design System Updated',
          message: 'Re-themed preview files in IndexedDB.',
        });
        runLinter();
      } catch (err) {
        console.error('Failed to update design system:', err);
        toast({
          type: 'error',
          title: 'Update Error',
          message: 'Could not update design tokens.',
        });
      }
    },
    [projectId, toast, runLinter]
  );

  const updateSpecField = <K extends keyof DesignSpec>(field: K, value: DesignSpec[K]) => {
    if (!spec) return;
    const updated: DesignSpec = {
      ...spec,
      [field]: value,
    };
    setSpec(updated);
    applyDesignChanges(updated);
  };

  const handleSurpriseMe = () => {
    if (!spec) return;
    const paletteSeeds = ['#ff6b1a', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#e11d48'];
    const randomSeed = paletteSeeds[Math.floor(Math.random() * paletteSeeds.length)];
    updateSpecField('seedHex', randomSeed);
  };

  const currentArchetype = useMemo(() => {
    return ARCHETYPES[spec?.archetypeId || 'general'] || ARCHETYPES['general'];
  }, [spec?.archetypeId]);

  // WCAG contrast checks
  const contrastChecks = useMemo(() => {
    if (!spec || !spec.tokens?.palette) return null;
    const p = spec.tokens.palette;
    const textBg = contrastRatio(p.text, p.bg);
    const textSurf = contrastRatio(p.text, p.surface);
    const onPrim = contrastRatio(p.onPrimary, p.primary);
    const linkBg = contrastRatio(p.link, p.bg);

    return [
      { label: 'Text / Background', ratio: textBg.toFixed(1), pass: textBg >= 7.0 },
      { label: 'Text / Surface', ratio: textSurf.toFixed(1), pass: textSurf >= 7.0 },
      { label: 'OnPrimary / Primary', ratio: onPrim.toFixed(1), pass: onPrim >= 4.5 },
      { label: 'Link / Background', ratio: linkBg.toFixed(1), pass: linkBg >= 4.5 },
    ];
  }, [spec]);

  const handleFixIssuesWithAi = () => {
    if (!lintResult || lintResult.issues.length === 0 || !onFixWithAi) return;

    const topIssues = lintResult.issues.slice(0, 8);
    const issueLines = topIssues
      .map(
        (iss, idx) =>
          `${idx + 1}. [${iss.category.toUpperCase()}] File: ${iss.file} - ${iss.message}\n   Fix: ${iss.fix}`
      )
      .join('\n');

    const prompt = `Please fix the following design system & accessibility issues in our project code:\n\n${issueLines}\n\nIMPORTANT: Use <desyra-edit> for localized edits. Use component classes from css/components.css and CSS variables (var(--color-primary), var(--font-body), etc.) instead of hardcoded inline styles. NEVER edit css/tokens.css, css/base.css, or css/components.css.`;

    onFixWithAi(prompt);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 text-xs">
      {/* Header */}
      <div className="h-12 px-4 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[var(--accent)]" />
          <span className="font-semibold text-sm text-[var(--text)]">Design Engine</span>
          {lintResult && (
            <Badge variant={lintResult.score >= 80 ? 'accent' : 'warning'} className="text-[10px] px-1.5 py-0">
              Score: {lintResult.score}/100
            </Badge>
          )}
        </div>
        <IconButton size="sm" variant="ghost" aria-label="Close Design panel" onClick={onClose}>
          <X className="w-4 h-4" />
        </IconButton>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('theme')}
          className={`flex-1 py-2.5 font-medium text-xs border-b-2 transition-colors ${
            activeTab === 'theme'
              ? 'border-[var(--accent)] text-[var(--text)] font-semibold bg-[var(--elevated)]'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          Theme Controls
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('review');
            runLinter();
          }}
          className={`flex-1 py-2.5 font-medium text-xs border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'review'
              ? 'border-[var(--accent)] text-[var(--text)] font-semibold bg-[var(--elevated)]'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <span>Review Linter</span>
          {lintResult && lintResult.issues.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-[var(--warning)] text-black text-[10px] font-bold flex items-center justify-center">
              {lintResult.issues.length}
            </span>
          )}
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 [scrollbar-width:thin]">
        {activeTab === 'theme' ? (
          spec ? (
            <>
              {/* Preset Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Style Preset
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.values(STYLE_PRESETS).map((p) => {
                    const isSelected = spec.presetId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => updateSpecField('presetId', p.id)}
                        className={`p-2.5 rounded-[var(--radius-sm)] border text-left transition-all ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--elevated)] shadow-sm'
                            : 'border-[var(--border)] hover:border-[var(--muted)] bg-[var(--surface)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-xs text-[var(--text)]">{p.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                        </div>
                        <p className="text-[10px] text-[var(--muted)] line-clamp-2 leading-tight">{p.personality}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color Seed */}
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Color Seed
                  </label>
                  <Button variant="ghost" size="sm" onClick={handleSurpriseMe} leftIcon={<Sparkles className="w-3 h-3 text-[var(--accent)]" />} className="h-6 text-[10px] px-1.5">
                    Surprise me
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {currentArchetype.seedColors.map((sc) => (
                    <button
                      key={sc.hex}
                      type="button"
                      onClick={() => updateSpecField('seedHex', sc.hex)}
                      title={sc.name}
                      style={{ backgroundColor: sc.hex }}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        spec.seedHex.toLowerCase() === sc.hex.toLowerCase()
                          ? 'border-white scale-110 shadow-md'
                          : 'border-transparent hover:scale-105'
                      }`}
                    />
                  ))}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <input
                      type="color"
                      value={spec.seedHex}
                      onChange={(e) => updateSpecField('seedHex', e.target.value)}
                      className="w-7 h-7 rounded border border-[var(--border)] bg-transparent cursor-pointer"
                    />
                    <Input
                      value={spec.seedHex}
                      onChange={(e) => updateSpecField('seedHex', e.target.value)}
                      className="w-20 font-mono text-[11px] h-7 min-h-[28px]"
                    />
                  </div>
                </div>
              </div>

              {/* Mode & Roundness */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Mode</label>
                  <div className="flex p-0.5 bg-[var(--elevated)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                    {(['dark', 'light', 'both'] as DesignMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateSpecField('mode', m)}
                        className={`flex-1 py-1 text-[11px] capitalize rounded-[3px] transition-colors ${
                          spec.mode === m ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--muted)]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Roundness</label>
                  <div className="flex p-0.5 bg-[var(--elevated)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                    {(['sharp', 'soft', 'round'] as DesignRadius[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => updateSpecField('radius', r)}
                        className={`flex-1 py-1 text-[11px] capitalize rounded-[3px] transition-colors ${
                          spec.radius === r ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--muted)]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Font Pair Selector */}
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Font Pair
                </label>
                <select
                  value={spec.fontPairId}
                  onChange={(e) => updateSpecField('fontPairId', e.target.value)}
                  className="w-full h-8 px-2 bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-sm)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {Object.values(FONT_PAIRS).map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* WCAG Contrast Check Summary */}
              {contrastChecks && (
                <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    WCAG Contrast Guarantees
                  </span>
                  <div className="grid grid-cols-2 gap-2 p-2.5 rounded-[var(--radius-sm)] bg-[var(--elevated)] border border-[var(--border)]">
                    {contrastChecks.map((cc, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--muted)] truncate pr-1">{cc.label}</span>
                        <span className={`font-mono font-semibold shrink-0 ${cc.pass ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                          {cc.ratio}:1 {cc.pass ? '✓' : '×'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 space-y-3">
              <p className="text-xs text-[var(--muted)]">This project does not have an installed Design System yet.</p>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  const currentFiles = await listFiles(projectId);
                  const firstIdea = currentFiles.length > 0 ? currentFiles[0].content.slice(0, 100) : 'General App';
                  const newSpec = {
                    archetypeId: 'general',
                    presetId: 'minimal',
                    seedHex: '#ff6b1a',
                    mode: 'both' as DesignMode,
                    defaultMode: 'dark' as const,
                    radius: 'soft' as DesignRadius,
                    density: 'comfortable' as DesignDensity,
                    fontPairId: 'inter-neutral',
                    language: 'en' as DesignLanguage,
                    motion: 'subtle' as DesignMotion,
                    tokens: {} as any,
                    createdAt: Date.now(),
                  };
                  await installDesignSystem(projectId, newSpec, { overwrite: true });
                  setSpec(newSpec);
                  toast({
                    type: 'success',
                    title: 'Design System Added',
                    message: 'Installed css/tokens.css, base.css, components.css.',
                  });
                }}
              >
                Add Design System
              </Button>
            </div>
          )
        ) : (
          /* Tab 2: Review Linter */
          <div className="space-y-4">
            {lintResult ? (
              <>
                {/* Score Header Card */}
                <Card className="p-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text)]">Design Health Score</h3>
                    <p className="text-[11px] text-[var(--muted)] mt-0.5">
                      {lintResult.issues.length} issue(s) detected across project files
                    </p>
                  </div>
                  <div className="w-14 h-14 rounded-full border-4 border-[var(--accent)] flex items-center justify-center font-bold text-lg text-[var(--text)]">
                    {lintResult.score}
                  </div>
                </Card>

                {/* Category Breakdown */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Categories
                  </span>
                  <div className="space-y-1.5 p-3 rounded-[var(--radius-sm)] bg-[var(--elevated)] border border-[var(--border)] text-xs">
                    {Object.entries(lintResult.categories).map(([cat, val]) => (
                      <div key={cat} className="space-y-0.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="capitalize text-[var(--muted)]">{cat}</span>
                          <span className="font-mono font-medium text-[var(--text)]">{val}/100</span>
                        </div>
                        <div className="w-full h-1.5 bg-[var(--surface)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent)] transition-all"
                            style={{ width: `${val}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Issues List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      Issues List ({lintResult.issues.length})
                    </span>
                  </div>

                  {lintResult.issues.length === 0 ? (
                    <div className="p-4 rounded-[var(--radius-sm)] bg-[var(--elevated)] text-center text-[var(--color-success)] text-xs font-semibold flex items-center justify-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" />
                      <span>All design &amp; accessibility checks passed (100/100)!</span>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                      {lintResult.issues.map((iss) => (
                        <div
                          key={iss.id}
                          className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--elevated)] border border-[var(--border)] space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-[var(--accent)] truncate max-w-[200px]">
                              {iss.file}
                            </span>
                            <Badge
                              variant={iss.severity === 'error' ? 'error' : iss.severity === 'warning' ? 'warning' : 'info'}
                              className="text-[9px] px-1 py-0 uppercase"
                            >
                              {iss.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-[var(--text)] font-medium leading-snug">{iss.message}</p>
                          <p className="text-[11px] text-[var(--muted)] leading-tight italic">Fix: {iss.fix}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fix with AI Button */}
                {lintResult.issues.length > 0 && onFixWithAi && (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleFixIssuesWithAi}
                    disabled={isStreaming}
                    leftIcon={<Play className="w-4 h-4 fill-current" />}
                    className="w-full mt-2"
                  >
                    Fix design issues with AI
                  </Button>
                )}
              </>
            ) : (
              <div className="text-center py-6 text-xs text-[var(--muted)]">Loading design linter...</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
