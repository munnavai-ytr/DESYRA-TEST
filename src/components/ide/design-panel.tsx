'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  FileCode,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import type {
  DesignSpec,
  DesignMode,
  DesignRadius,
  DesignDensity,
  DesignMotion,
  DesignLanguage,
  LintResult,
  ProjectCritique,
  ProjectPlan,
} from '@/lib/design/types';
import { STYLE_PRESETS } from '@/lib/design/presets';
import { ARCHETYPES } from '@/lib/design/archetypes';
import { FONT_PAIRS } from '@/lib/design/fonts';
import { installDesignSystem } from '@/lib/design/install';
import { contrastRatio } from '@/lib/design/color';
import { lintDesign } from '@/lib/design/lint';
import { listFiles } from '@/lib/files';
import { getProject, type ProjectFile } from '@/lib/db';
import type { SafeProviderInfo } from '@/lib/keys';
import { StyleTile } from '@/components/chat/style-tile';
import { runDesignCritic } from '@/lib/design/critic';
import { isStreamingActive } from '@/lib/history/idle';
import {
  createSnapshot,
  createSnapshotWithResult,
  maybeNotifyFirstTrim,
} from '@/lib/history/snapshots';

export interface DesignPanelProps {
  projectId: string;
  projectDesign?: DesignSpec | null;
  isOpen: boolean;
  onClose: () => void;
  onFixWithAi?: (fixPrompt: string) => void;
  isStreaming?: boolean;
  activeProvider?: SafeProviderInfo | null;
  activeModel?: string | null;
  onReopenPlan?: () => void;
  onDesignChanged?: (spec: DesignSpec) => void;
}

export function DesignPanel({
  projectId,
  projectDesign,
  isOpen,
  onClose,
  onFixWithAi,
  isStreaming = false,
  activeProvider,
  activeModel,
  onReopenPlan,
  onDesignChanged,
}: DesignPanelProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'theme' | 'review'>('theme');

  // Draft design spec state
  const [spec, setSpec] = useState<DesignSpec | null>(projectDesign ?? null);
  const [prevProjectDesign, setPrevProjectDesign] = useState<DesignSpec | null>(projectDesign ?? null);

  // Sync spec with props
  if (projectDesign && projectDesign !== prevProjectDesign) {
    setPrevProjectDesign(projectDesign);
    setSpec(projectDesign);
  }

  // Loaded project metadata & files
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [critique, setCritique] = useState<ProjectCritique | null>(null);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [isRunningCritic, setIsRunningCritic] = useState(false);

  // Load project files, linter, and critique
  const loadData = useCallback(async () => {
    try {
      const [currentFiles, proj] = await Promise.all([
        listFiles(projectId),
        getProject(projectId),
      ]);
      setFiles(currentFiles);
      if (proj?.critique) {
        setCritique(proj.critique);
      }
      if (proj?.plan) {
        setPlan(proj.plan);
      }
      if (currentFiles.length > 0) {
        const res = lintDesign(currentFiles, spec ?? undefined);
        setLintResult(res);
      }
    } catch (err) {
      console.error('Failed to load design panel data:', err);
    }
  }, [projectId, spec]);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    void (async () => {
      try {
        const [currentFiles, proj] = await Promise.all([
          listFiles(projectId),
          getProject(projectId),
        ]);
        if (isCancelled) return;
        setFiles(currentFiles);
        if (proj?.critique) {
          setCritique(proj.critique);
        }
        if (proj?.plan) {
          setPlan(proj.plan);
        }
        if (currentFiles.length > 0) {
          const res = lintDesign(currentFiles, spec ?? undefined);
          setLintResult(res);
        }
      } catch (err) {
        console.error('Failed to load design panel data:', err);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, projectId, spec]);

  const designSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDesignLabelRef = useRef<string | null>(null);
  const capturedPreDesignBaselineRef = useRef(false);

  const scheduleDesignSnapshot = useCallback(
    (newSpec: DesignSpec) => {
      const presetName = STYLE_PRESETS[newSpec.presetId]?.name || newSpec.presetId;
      const snapLabel = `Theme: ${presetName}`;
      pendingDesignLabelRef.current = snapLabel;

      if (designSnapshotTimerRef.current) {
        clearTimeout(designSnapshotTimerRef.current);
      }

      designSnapshotTimerRef.current = setTimeout(async () => {
        designSnapshotTimerRef.current = null;
        const labelToSave = pendingDesignLabelRef.current;
        pendingDesignLabelRef.current = null;
        capturedPreDesignBaselineRef.current = false;

        if (!labelToSave || isStreamingActive(projectId)) return;
        try {
          const outcome = await createSnapshotWithResult(projectId, {
            label: labelToSave,
            kind: 'design',
          });
          if (outcome.trimmedCount > 0) {
            const shouldNotify = await maybeNotifyFirstTrim(outcome.trimmedCount);
            if (shouldNotify) {
              toast({
                type: 'info',
                title: 'Version History Limit Reached',
                message:
                  'DESYRA keeps the latest 60 unpinned versions automatically. Pinned checkpoints never expire.',
                duration: 6000,
              });
            }
          }
        } catch (err) {
          console.warn('[DESYRA] Failed debounced design snapshot:', err);
        }
      }, 1200);
    },
    [projectId, toast]
  );

  // Flush any pending design snapshot on unmount or project switch
  useEffect(() => {
    return () => {
      if (designSnapshotTimerRef.current) {
        clearTimeout(designSnapshotTimerRef.current);
        designSnapshotTimerRef.current = null;
      }
      const pendingLabel = pendingDesignLabelRef.current;
      pendingDesignLabelRef.current = null;
      capturedPreDesignBaselineRef.current = false;
      if (pendingLabel && !isStreamingActive(projectId)) {
        void createSnapshot(projectId, {
          label: pendingLabel,
          kind: 'design',
        });
      }
    };
  }, [projectId]);

  // Apply design changes
  const applyDesignChanges = useCallback(
    async (newSpec: DesignSpec) => {
      try {
        if (!capturedPreDesignBaselineRef.current && !isStreamingActive(projectId)) {
          capturedPreDesignBaselineRef.current = true;
          const existingFiles = await listFiles(projectId);
          if (existingFiles.length > 0) {
            await createSnapshot(projectId, {
              label: 'Before design update',
              kind: 'design',
            });
          }
        }

        await installDesignSystem(projectId, newSpec, { overwrite: true });
        onDesignChanged?.(newSpec);
        scheduleDesignSnapshot(newSpec);
        toast({
          type: 'success',
          title: 'Design System Updated',
          message: 'Re-themed preview files in IndexedDB.',
        });
        loadData();
      } catch (err) {
        console.error('Failed to update design system:', err);
        toast({
          type: 'error',
          title: 'Update Error',
          message: 'Could not update design tokens.',
        });
      }
    },
    [projectId, toast, loadData, onDesignChanged, scheduleDesignSnapshot]
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

  // Run AI Critic on demand
  const handleRunCriticOnDemand = async () => {
    if (!spec || !activeProvider || !activeModel || isRunningCritic) return;
    setIsRunningCritic(true);
    try {
      const res = await runDesignCritic({
        projectId,
        files,
        spec,
        brief: plan?.brief,
        lintResult,
        provider: activeProvider,
        model: activeModel,
      });
      setCritique(res);
      toast({
        type: 'success',
        title: 'Critic Completed',
        message: `Design evaluated with overall score ${res.score}/100.`,
      });
    } catch (err) {
      console.error('Failed to run AI design critic:', err);
      toast({
        type: 'error',
        title: 'Critic Failed',
        message: 'Could not run AI critique.',
      });
    } finally {
      setIsRunningCritic(false);
    }
  };

  // Apply top fixes from critique
  const handleApplyTopCriticFixes = () => {
    if (!critique || critique.issues.length === 0 || !onFixWithAi) return;

    const topIssues = critique.issues.slice(0, 6);
    const issuesText = topIssues
      .map(
        (iss, idx) =>
          `Issue ${idx + 1}: [${iss.severity.toUpperCase()}] ${iss.title}\n` +
          `File: ${iss.codeEvidence?.file || 'index.html'}${iss.codeEvidence?.line ? ` (line ${iss.codeEvidence.line})` : ''}\n` +
          `Evidence:\n${iss.codeEvidence?.snippet || ''}\n` +
          `Problem: ${iss.description}\n` +
          `Fix: ${iss.fixSuggestion}`
      )
      .join('\n\n');

    const prompt = `Please fix the following AI Design Critic issues in our code:\n\n${issuesText}\n\nIMPORTANT RULES:\n- Use minimal <desyra-edit> blocks to patch the specific lines.\n- Use component classes from css/components.css and CSS variables (e.g. var(--color-primary), var(--radius-md)) instead of hardcoded hex or custom utilities.\n- DO NOT edit css/tokens.css, css/base.css, or css/components.css (they are managed by the Design Engine).`;

    onFixWithAi(prompt);
    onClose();
  };

  // Fix 7A linter issues with AI
  const handleFixIssuesWithAi = () => {
    if (!lintResult || lintResult.issues.length === 0 || !onFixWithAi) return;

    const topIssues = lintResult.issues.slice(0, 8);
    const issueLines = topIssues
      .map(
        (iss, idx) =>
          `${idx + 1}. [${iss.category.toUpperCase()}] File: ${iss.file} - ${iss.message}\n   Fix: ${iss.fix}`
      )
      .join('\n');

    const prompt = `Please fix the following design system & accessibility issues in our project code:\n\n${issueLines}\n\nIMPORTANT: Use <desyra-edit> for localized edits. Use component classes from css/components.css and CSS variables instead of hardcoded inline styles. NEVER edit css/tokens.css, css/base.css, or css/components.css.`;

    onFixWithAi(prompt);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 text-xs">
      {/* Header */}
      <div className="h-12 px-4 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-2 min-w-0">
          <Palette className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="font-semibold text-sm text-[var(--text)] truncate">
            {plan?.brief ? plan.brief.directionName : 'Design Engine'}
          </span>
          {critique ? (
            <Badge variant={critique.score >= 80 ? 'accent' : 'warning'} className="text-[10px] px-1.5 py-0 shrink-0">
              Critic: {critique.score}/100
            </Badge>
          ) : lintResult ? (
            <Badge variant={lintResult.score >= 80 ? 'accent' : 'warning'} className="text-[10px] px-1.5 py-0 shrink-0">
              Linter: {lintResult.score}/100
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {plan && onReopenPlan && (
            <button
              type="button"
              onClick={() => {
                onReopenPlan();
                onClose();
              }}
              className="px-2 py-1 rounded bg-[var(--elevated)] hover:bg-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] text-[10px] flex items-center gap-1 cursor-pointer"
              title="Re-open interactive Plan Card in chat"
            >
              <span>Re-open plan</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <IconButton size="sm" variant="ghost" aria-label="Close Design panel" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
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
            loadData();
          }}
          className={`flex-1 py-2.5 font-medium text-xs border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'review'
              ? 'border-[var(--accent)] text-[var(--text)] font-semibold bg-[var(--elevated)]'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <span>Review &amp; Critique</span>
          {lintResult && lintResult.issues.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-[var(--warning)] text-black text-[10px] font-bold flex items-center justify-center">
              {lintResult.issues.length}
            </span>
          )}
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 [scrollbar-width:thin]">
        {activeTab === 'theme' ? (
          spec ? (
            <>
              {/* Style Tile Preview */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Live Style Tile Preview
                </label>
                <StyleTile spec={spec} height={190} />
              </div>

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
                        className={`p-2.5 rounded-[var(--radius-sm)] border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--elevated)] shadow-sm'
                            : 'border-[var(--border)] hover:border-[var(--muted)] bg-[var(--surface)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[11px] text-[var(--text)] truncate">
                            {p.name}
                          </span>
                          {isSelected && <Check className="w-3 h-3 text-[var(--accent)] shrink-0" />}
                        </div>
                        <p className="text-[10px] text-[var(--muted)] line-clamp-1 mt-0.5">
                          {p.personality}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Seed Color & Surprise Me */}
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Primary Brand Color
                  </label>
                  <button
                    type="button"
                    onClick={handleSurpriseMe}
                    className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Surprise Me</span>
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={spec.seedHex}
                    onChange={(e) => updateSpecField('seedHex', e.target.value)}
                    className="w-8 h-8 rounded-[var(--radius-sm)] cursor-pointer bg-transparent border border-[var(--border)] p-0"
                  />
                  <span className="font-mono text-xs text-[var(--text)]">{spec.seedHex.toUpperCase()}</span>
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
                        className={`flex-1 py-1 text-[11px] capitalize rounded-[3px] transition-colors cursor-pointer ${
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
                        className={`flex-1 py-1 text-[11px] capitalize rounded-[3px] transition-colors cursor-pointer ${
                          spec.radius === r ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--muted)]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Density & Motion */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Density</label>
                  <div className="flex p-0.5 bg-[var(--elevated)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                    {(['compact', 'comfortable', 'spacious'] as DesignDensity[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updateSpecField('density', d)}
                        className={`flex-1 py-1 text-[11px] capitalize rounded-[3px] transition-colors cursor-pointer ${
                          spec.density === d ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--muted)]'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Motion</label>
                  <div className="flex p-0.5 bg-[var(--elevated)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                    {(['none', 'subtle', 'rich'] as DesignMotion[]).map((mo) => (
                      <button
                        key={mo}
                        type="button"
                        onClick={() => updateSpecField('motion', mo)}
                        className={`flex-1 py-1 text-[11px] capitalize rounded-[3px] transition-colors cursor-pointer ${
                          spec.motion === mo ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--muted)]'
                        }`}
                      >
                        {mo}
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
                  className="w-full h-8 px-2 bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-sm)] text-xs text-[var(--text)] focus:outline-hidden focus:border-[var(--accent)]"
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
                        <span className={`font-mono font-semibold shrink-0 ${cc.pass ? 'text-emerald-400' : 'text-amber-400'}`}>
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
            </div>
          )
        ) : (
          /* Tab 2: Review Linter & AI Critique */
          <div className="space-y-5">
            {/* AI Design Critic Card */}
            <Card className="p-4 space-y-3 border-[var(--border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">
                    AI Design Critic
                  </h3>
                </div>
                {critique && (
                  <Badge variant={critique.score >= 80 ? 'accent' : 'warning'} className="text-[10px] px-1.5 py-0 font-bold">
                    Score: {critique.score}/100
                  </Badge>
                )}
              </div>

              {critique ? (
                <div className="space-y-3 text-xs">
                  <p className="text-[var(--text)] leading-relaxed italic bg-[var(--elevated)]/50 p-2.5 rounded border border-[var(--border)]">
                    &quot;{critique.summary}&quot;
                  </p>

                  {/* 8-category Rubric Bar Chart */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      8 Principles Rubric
                    </span>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-2.5 rounded bg-[var(--elevated)] border border-[var(--border)]">
                      {Object.entries(critique.rubric).map(([cat, val]) => (
                        <div key={cat} className="space-y-0.5">
                          <div className="flex justify-between text-[10px]">
                            <span className="capitalize text-[var(--muted)]">{cat}</span>
                            <span className="font-mono font-medium text-[var(--text)]">{val}/10</span>
                          </div>
                          <div className="w-full h-1 bg-[var(--surface)] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[var(--accent)] transition-all"
                              style={{ width: `${(val / 10) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Critique Issues with Code Evidence Quotes */}
                  {critique.issues && critique.issues.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                        Critique Findings ({critique.issues.length})
                      </span>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                        {critique.issues.map((iss) => (
                          <div
                            key={iss.id}
                            className="p-2.5 rounded bg-[var(--elevated)] border border-[var(--border)] space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[11px] text-[var(--text)] truncate pr-1">
                                {iss.title}
                              </span>
                              <Badge
                                variant={iss.severity === 'high' ? 'error' : iss.severity === 'med' ? 'warning' : 'info'}
                                className="text-[9px] px-1 py-0 uppercase"
                              >
                                {iss.severity}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-[var(--muted)] leading-snug">
                              {iss.description}
                            </p>
                            {iss.codeEvidence && iss.codeEvidence.snippet && (
                              <div className="bg-[var(--surface)] p-2 rounded border border-[var(--border)] font-mono text-[10px] text-[var(--text)] whitespace-pre-wrap overflow-x-auto">
                                <span className="text-[var(--disabled)] block text-[9px] mb-0.5">
                                  Evidence ({iss.codeEvidence.file}):
                                </span>
                                {iss.codeEvidence.snippet}
                              </div>
                            )}
                            <p className="text-[11px] text-[var(--accent)] italic">
                              Fix: {iss.fixSuggestion}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action: Apply Top Fixes */}
                  {critique.issues && critique.issues.length > 0 && onFixWithAi && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleApplyTopCriticFixes}
                      disabled={isStreaming}
                      leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
                      className="w-full mt-2"
                    >
                      Apply top fixes with AI
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-3 space-y-2">
                  <p className="text-[11px] text-[var(--muted)]">
                    No critique evaluated yet. Run the AI critic to review code against the 8 design principles.
                  </p>
                  <p className="text-[10px] text-[var(--disabled)] font-mono">
                    Estimated tokens: ~3k input tokens
                  </p>
                </div>
              )}

              {/* Run Critic Button */}
              <Button
                variant={critique ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleRunCriticOnDemand}
                disabled={isRunningCritic || isStreaming || !activeProvider || !activeModel}
                leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isRunningCritic ? 'animate-spin' : ''}`} />}
                className="w-full"
              >
                {isRunningCritic ? 'Analyzing code...' : critique ? 'Re-run AI critic' : 'Run AI design critic'}
              </Button>
            </Card>

            {/* Existing 7A Deterministic Linter */}
            {lintResult && (
              <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                    Deterministic Linter
                  </h3>
                  <Badge variant={lintResult.score >= 80 ? 'accent' : 'warning'} className="text-[10px] px-1.5 py-0 font-bold">
                    Score: {lintResult.score}/100
                  </Badge>
                </div>

                {lintResult.issues.length === 0 ? (
                  <div className="p-3 rounded bg-[var(--elevated)] text-center text-emerald-400 text-xs font-medium flex items-center justify-center gap-1.5 border border-emerald-500/20">
                    <ShieldCheck className="w-4 h-4" />
                    <span>All accessibility &amp; contrast checks passed!</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                    {lintResult.issues.map((iss) => (
                      <div
                        key={iss.id}
                        className="p-2.5 rounded bg-[var(--elevated)] border border-[var(--border)] space-y-1"
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

                {lintResult.issues.length > 0 && onFixWithAi && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleFixIssuesWithAi}
                    disabled={isStreaming}
                    leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
                    className="w-full"
                  >
                    Fix linter issues with AI
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
