'use client';

import React, { useState, useMemo } from 'react';
import type {
  ProjectPlan,
  PlanSelections,
  DesignSpec,
  DesignMode,
  DesignRadius,
  DesignDensity,
  DesignMotion,
} from '@/lib/design/types';
import { STYLE_PRESETS } from '@/lib/design/presets';
import { FONT_PAIRS } from '@/lib/design/fonts';
import { ARCHETYPES } from '@/lib/design/archetypes';
import { generatePalette, contrastRatio } from '@/lib/design/color';
import { StyleTile } from './style-tile';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Plus,
  Play,
  Settings2,
  Wand2,
} from 'lucide-react';

export interface PlanCardProps {
  plan: ProjectPlan;
  onApprove: (updatedPlan: ProjectPlan, spec: DesignSpec) => void;
  onRegenerate: () => void;
  onSkipReview: () => void;
  onAlwaysSkipReview: () => void;
  isRegenerating?: boolean;
}

/**
 * Builds a live DesignSpec from current PlanSelections for the StyleTile and project.
 */
export function buildSpecFromSelections(
  selections: PlanSelections,
  briefLanguage: 'en' | 'bn',
  archetypeId: string = 'general'
): DesignSpec {
  const preset = STYLE_PRESETS[selections.presetId] || STYLE_PRESETS['minimal'];
  const fontPair = FONT_PAIRS[selections.fontPairId] || FONT_PAIRS['inter-neutral'];
  const mode = selections.mode;
  const defaultMode = selections.defaultMode;

  const darkPalette = generatePalette(selections.primarySeed, 'dark', preset.accentRule);
  const lightPalette = generatePalette(selections.primarySeed, 'light', preset.accentRule);
  const activePalette = defaultMode === 'light' ? lightPalette : darkPalette;

  return {
    archetypeId,
    presetId: selections.presetId,
    seedHex: selections.primarySeed,
    mode,
    defaultMode,
    radius: selections.radius,
    density: selections.density,
    fontPairId: selections.fontPairId,
    language: briefLanguage,
    motion: selections.motion,
    tokens: {
      mode: defaultMode,
      palette: activePalette,
      darkPalette,
      lightPalette,
      fontDisplay: fontPair.displayFamily,
      fontBody: fontPair.bodyFamily,
      fontMono: fontPair.monoFamily || 'JetBrains Mono',
      googleFontsHref: fontPair.googleFontsHref,
      typeScaleRatio: preset.typeScaleRatio,
      radius: {
        sm: selections.radius === 'sharp' ? '2px' : selections.radius === 'round' ? '8px' : '4px',
        md: selections.radius === 'sharp' ? '4px' : selections.radius === 'round' ? '14px' : '8px',
        lg: selections.radius === 'sharp' ? '6px' : selections.radius === 'round' ? '24px' : '12px',
        full: '9999px',
      },
      shadows: {
        sm: preset.shadowStyle === 'none' ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
        md: preset.shadowStyle === 'none' ? 'none' : '0 4px 6px -1px rgba(0,0,0,0.1)',
        lg: preset.shadowStyle === 'layered' ? '0 10px 15px -3px rgba(0,0,0,0.1)' : 'none',
      },
      borderWidth: preset.borderWidth,
      densityPadding: {
        section: selections.density === 'compact' ? '2rem 1rem' : selections.density === 'spacious' ? '5rem 2rem' : '3.5rem 1.5rem',
        card: selections.density === 'compact' ? '0.75rem 1rem' : selections.density === 'spacious' ? '1.75rem 2rem' : '1.25rem 1.5rem',
        button: selections.density === 'compact' ? '0.4rem 0.85rem' : selections.density === 'spacious' ? '0.75rem 1.5rem' : '0.55rem 1.25rem',
      },
      motion: {
        fast: selections.motion === 'none' ? '0ms' : '100ms',
        base: selections.motion === 'none' ? '0ms' : '200ms',
        slow: selections.motion === 'none' ? '0ms' : '350ms',
        ease: 'ease',
      },
      containerWidth: '1240px',
      buttonStyle: preset.buttonStyle,
      cardStyle: preset.cardStyle,
    },
    createdAt: Date.now(),
  };
}

export function PlanCard({
  plan,
  onApprove,
  onRegenerate,
  onSkipReview,
  onAlwaysSkipReview,
  isRegenerating = false,
}: PlanCardProps) {
  const isApproved = plan.status === 'approved' || plan.status === 'skipped';
  const [isExpanded, setIsExpanded] = useState(!isApproved);

  // Local interactive selections initialized from plan
  const [selections, setSelections] = useState<PlanSelections>(() => {
    if (plan.selections) return plan.selections;
    const rec = plan.brief.recommended;
    return {
      presetId: rec.presetId,
      fontPairId: rec.fontPairId,
      mode: rec.mode,
      defaultMode: rec.defaultMode,
      density: rec.density,
      radius: rec.radius,
      motion: rec.motion,
      primarySeed: rec.paletteSeeds[0] || '#2563eb',
      accentSeed: rec.paletteSeeds[1] || '#06b6d4',
      bgSeed: rec.paletteSeeds[2] || '#f59e0b',
      selectedFeatureIds: plan.brief.features.map((f) => f.id),
      customFeatures: [],
    };
  });

  const [newFeatureText, setNewFeatureText] = useState('');

  // Live compiled spec for Style Tile
  const liveSpec = useMemo(() => {
    return buildSpecFromSelections(selections, plan.brief.copyLanguage, 'general');
  }, [selections, plan.brief.copyLanguage]);

  // Contrast ratio check of primary on surface
  const contrastInfo = useMemo(() => {
    try {
      const palette = generatePalette(selections.primarySeed, selections.defaultMode);
      const ratio = contrastRatio(palette.primary, palette.surface);
      return {
        ratio: Number(ratio.toFixed(2)),
        passesAA: ratio >= 3.0,
      };
    } catch {
      return { ratio: 4.5, passesAA: true };
    }
  }, [selections.primarySeed, selections.defaultMode]);

  // Available fonts for the brief copy language
  const availableFonts = useMemo(() => {
    const isBn = plan.brief.copyLanguage === 'bn';
    return Object.values(FONT_PAIRS).filter((fp) =>
      isBn ? fp.supports.includes('bengali') : fp.supports.includes('latin')
    );
  }, [plan.brief.copyLanguage]);

  const handleToggleFeature = (featId: string) => {
    setSelections((prev) => {
      const exists = prev.selectedFeatureIds.includes(featId);
      const next = exists
        ? prev.selectedFeatureIds.filter((id) => id !== featId)
        : [...prev.selectedFeatureIds, featId];
      return { ...prev, selectedFeatureIds: next };
    });
  };

  const handleAddCustomFeature = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeatureText.trim()) return;
    setSelections((prev) => ({
      ...prev,
      customFeatures: [...prev.customFeatures, newFeatureText.trim()],
    }));
    setNewFeatureText('');
  };

  const handleRandomizeColor = () => {
    // Pick from archetype seed pool
    const allSeeds: string[] = [];
    Object.values(ARCHETYPES).forEach((a) => {
      a.seedColors.forEach((sc) => allSeeds.push(sc.hex));
    });
    if (allSeeds.length > 0) {
      const randSeed = allSeeds[Math.floor(Math.random() * allSeeds.length)];
      setSelections((prev) => ({ ...prev, primarySeed: randSeed }));
    }
  };

  const handleBuild = () => {
    const updatedPlan: ProjectPlan = {
      ...plan,
      selections,
      status: 'approved',
      approvedAt: Date.now(),
    };
    onApprove(updatedPlan, liveSpec);
  };

  // Collapsed View (shown after approval or when collapsed by user)
  if (!isExpanded) {
    const featureCount =
      selections.selectedFeatureIds.length + (selections.customFeatures?.length || 0);
    return (
      <div className="my-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs flex items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-4 h-4 rounded-full shrink-0 border border-white/20 shadow-xs"
            style={{ backgroundColor: selections.primarySeed }}
          />
          <div className="truncate">
            <span className="font-semibold text-[var(--text)]">
              {plan.brief.directionName}
            </span>
            <span className="text-[var(--muted)] ml-2">
              • {STYLE_PRESETS[selections.presetId]?.name || selections.presetId} • {plan.brief.screens.length} screens • {featureCount} features
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="text-[11px] text-[var(--accent)] hover:underline shrink-0 font-medium flex items-center gap-1 cursor-pointer"
        >
          Change design
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Expanded Interactive Plan Card
  return (
    <div className="my-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 space-y-5 shadow-sm text-xs">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded">
              {plan.brief.appType}
            </span>
            <h3 className="text-sm sm:text-base font-semibold text-[var(--text)]">
              {plan.brief.directionName}
            </h3>
          </div>
          <p className="text-[var(--muted)] mt-1 leading-relaxed">
            {plan.brief.audience} • <span className="text-[var(--text)] italic">{plan.brief.tone}</span>
          </p>
          {/* Vibe words chips */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {plan.brief.vibeWords.map((word) => (
              <span
                key={word}
                className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--elevated)] text-[var(--muted)] border border-[var(--border)]"
              >
                #{word}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 self-start">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--elevated)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            title="Generate a completely different aesthetic direction"
          >
            <RotateCcw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
            <span>{isRegenerating ? 'Regenerating...' : 'Regenerate direction'}</span>
          </button>
          {isApproved && (
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="p-1.5 rounded-md hover:bg-[var(--elevated)] text-[var(--muted)]"
              title="Collapse"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left = Screens & Features, Right = Live Style Tile & Design Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (5 cols): Architecture & Features */}
        <div className="lg:col-span-6 space-y-4">
          {/* Screens & Views list */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
              Screens &amp; Navigation ({plan.brief.screens.length})
            </h4>
            <div className="space-y-1.5 bg-[var(--elevated)]/50 p-2.5 rounded-lg border border-[var(--border)]">
              {plan.brief.screens.map((screen, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="font-mono text-[10px] text-[var(--disabled)] shrink-0 mt-0.5">
                    {idx + 1}.
                  </span>
                  <div>
                    <span className="font-medium text-[var(--text)]">{screen.name}</span>
                    <p className="text-[11px] text-[var(--muted)] leading-tight">{screen.purpose}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Features Checklist */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
              Feature Checklist
            </h4>
            <div className="space-y-2 bg-[var(--elevated)]/50 p-2.5 rounded-lg border border-[var(--border)]">
              {plan.brief.features.map((feat) => {
                const isChecked = selections.selectedFeatureIds.includes(feat.id);
                return (
                  <label
                    key={feat.id}
                    className="flex items-start gap-2.5 cursor-pointer select-none group"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleFeature(feat.id)}
                      className="mt-0.5 w-3.5 h-3.5 rounded border-[var(--border)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-medium ${
                            isChecked ? 'text-[var(--text)]' : 'text-[var(--disabled)] line-through'
                          }`}
                        >
                          {feat.title}
                        </span>
                        {feat.essential && (
                          <span className="text-[9px] font-mono uppercase bg-[var(--accent)]/15 text-[var(--accent)] px-1.5 py-0.2 rounded">
                            essential
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--muted)] leading-tight mt-0.5">
                        {feat.description}
                      </p>
                    </div>
                  </label>
                );
              })}

              {/* Custom features added by user */}
              {selections.customFeatures.map((cf, idx) => (
                <div key={idx} className="flex items-center justify-between text-[11px] text-[var(--text)] pl-6 py-0.5">
                  <span>• {cf}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelections((prev) => ({
                        ...prev,
                        customFeatures: prev.customFeatures.filter((_, i) => i !== idx),
                      }))
                    }
                    className="text-[10px] text-[var(--muted)] hover:text-red-400"
                  >
                    remove
                  </button>
                </div>
              ))}

              {/* Add custom feature inline */}
              <form onSubmit={handleAddCustomFeature} className="flex items-center gap-1.5 pt-2 border-t border-[var(--border)]">
                <input
                  type="text"
                  placeholder="Add custom feature requirement..."
                  value={newFeatureText}
                  onChange={(e) => setNewFeatureText(e.target.value)}
                  className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)] placeholder-[var(--disabled)] focus:outline-hidden focus:border-[var(--accent)]"
                />
                <button
                  type="submit"
                  disabled={!newFeatureText.trim()}
                  className="px-2 py-1 rounded bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--border)] text-[var(--text)] disabled:opacity-40 cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add</span>
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column (6 cols): Live Style Tile & Design Controls */}
        <div className="lg:col-span-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Live Style Tile
              </h4>
              {/* Contrast badge */}
              <div
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  contrastInfo.passesAA
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}
              >
                {contrastInfo.passesAA ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
                <span>Contrast {contrastInfo.ratio}:1 {contrastInfo.passesAA ? 'AA Pass' : 'Low'}</span>
              </div>
            </div>

            {/* Sandboxed Style Tile */}
            <StyleTile spec={liveSpec} height={200} />
          </div>

          {/* Interactive Design Controls */}
          <div className="space-y-3 bg-[var(--elevated)]/40 p-3 rounded-lg border border-[var(--border)]">
            {/* Color Palette Seeds */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-[var(--text)]">Primary Seed Color</span>
                <button
                  type="button"
                  onClick={handleRandomizeColor}
                  className="text-[10px] text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Wand2 className="w-2.5 h-2.5" />
                  <span>Surprise me</span>
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {plan.brief.recommended.paletteSeeds.map((seedHex, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelections((prev) => ({ ...prev, primarySeed: seedHex }))}
                    className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer ${
                      selections.primarySeed.toLowerCase() === seedHex.toLowerCase()
                        ? 'border-white scale-110 shadow-sm'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: seedHex }}
                    title={`AI Seed ${idx + 1}: ${seedHex}`}
                  />
                ))}
                {/* Custom Color input */}
                <div className="relative flex items-center">
                  <input
                    type="color"
                    value={selections.primarySeed}
                    onChange={(e) =>
                      setSelections((prev) => ({ ...prev, primarySeed: e.target.value }))
                    }
                    className="w-7 h-7 rounded-full p-0 border border-[var(--border)] cursor-pointer bg-transparent"
                    title="Pick custom hex color"
                  />
                  <span className="ml-1.5 font-mono text-[10px] text-[var(--muted)]">
                    {selections.primarySeed.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Style Preset Selector */}
            <div>
              <span className="text-[11px] font-medium text-[var(--text)] block mb-1">
                Style Preset
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {Object.values(STYLE_PRESETS).slice(0, 8).map((preset) => {
                  const isSelected = selections.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setSelections((prev) => ({
                          ...prev,
                          presetId: preset.id,
                          radius: preset.radius,
                          density: preset.densityDefault,
                        }))
                      }
                      className={`p-2 rounded border text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text)]'
                          : 'border-[var(--border)] hover:bg-[var(--elevated)] text-[var(--muted)]'
                      }`}
                    >
                      <div className="font-semibold text-[11px] truncate">{preset.name}</div>
                      <div className="text-[9px] text-[var(--disabled)] capitalize mt-0.5">
                        {preset.radius} • {preset.densityDefault}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Typography Pairing */}
            <div>
              <span className="text-[11px] font-medium text-[var(--text)] block mb-1">
                Typography ({plan.brief.copyLanguage === 'bn' ? 'Bengali' : 'Latin'})
              </span>
              <select
                value={selections.fontPairId}
                onChange={(e) =>
                  setSelections((prev) => ({ ...prev, fontPairId: e.target.value }))
                }
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2.5 py-1.5 text-xs text-[var(--text)] focus:outline-hidden focus:border-[var(--accent)]"
              >
                {availableFonts.map((fp) => (
                  <option key={fp.id} value={fp.id}>
                    {fp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Mode, Roundness & Motion Pills */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <span className="text-[10px] text-[var(--muted)] block mb-1">Theme Mode</span>
                <div className="flex rounded border border-[var(--border)] overflow-hidden">
                  {(['dark', 'light', 'both'] as DesignMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setSelections((prev) => ({
                          ...prev,
                          mode: m,
                          defaultMode: m === 'light' ? 'light' : 'dark',
                        }))
                      }
                      className={`flex-1 py-1 text-[10px] capitalize transition-colors ${
                        selections.mode === m
                          ? 'bg-[var(--accent)] text-white font-medium'
                          : 'hover:bg-[var(--surface)] text-[var(--muted)]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-[var(--muted)] block mb-1">Roundness</span>
                <div className="flex rounded border border-[var(--border)] overflow-hidden">
                  {(['sharp', 'soft', 'round'] as DesignRadius[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelections((prev) => ({ ...prev, radius: r }))}
                      className={`flex-1 py-1 text-[10px] capitalize transition-colors ${
                        selections.radius === r
                          ? 'bg-[var(--accent)] text-white font-medium'
                          : 'hover:bg-[var(--surface)] text-[var(--muted)]'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-[var(--muted)] block mb-1">Motion</span>
                <div className="flex rounded border border-[var(--border)] overflow-hidden">
                  {(['none', 'subtle', 'rich'] as DesignMotion[]).map((mo) => (
                    <button
                      key={mo}
                      type="button"
                      onClick={() => setSelections((prev) => ({ ...prev, motion: mo }))}
                      className={`flex-1 py-1 text-[10px] capitalize transition-colors ${
                        selections.motion === mo
                          ? 'bg-[var(--accent)] text-white font-medium'
                          : 'hover:bg-[var(--surface)] text-[var(--muted)]'
                      }`}
                    >
                      {mo}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleBuild}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-[var(--accent)] hover:opacity-90 text-white font-semibold text-xs shadow-xs transition-opacity cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Build with this design</span>
          </button>

          {!isApproved && (
            <button
              type="button"
              onClick={onSkipReview}
              className="px-3.5 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--elevated)] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer text-xs"
            >
              Skip review
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onAlwaysSkipReview}
          className="text-[11px] text-[var(--disabled)] hover:text-[var(--muted)] underline cursor-pointer"
        >
          Always skip review (can change in Settings)
        </button>
      </div>
    </div>
  );
}
