import { describe, it, expect } from 'vitest';
import { buildSpecFromSelections } from '@/components/chat/plan-card';
import { buildDeterministicBrief } from './briefParse';
import { contrastRatio } from './color';
import type { PlanSelections, ProjectPlan } from './types';

describe('7.2 Plan Card & Plan Selections (plan.test.ts)', () => {
  const sampleSelections: PlanSelections = {
    presetId: 'bold-modern',
    fontPairId: 'bricolage-bold',
    mode: 'both',
    defaultMode: 'dark',
    density: 'comfortable',
    radius: 'sharp',
    motion: 'rich',
    primarySeed: '#ff6b1a',
    accentSeed: '#3b82f6',
    bgSeed: '#18181b',
    selectedFeatureIds: ['f1', 'f2'],
    customFeatures: ['Dark mode switch'],
  };

  it('buildSpecFromSelections generates valid tokens, palettes, and correct radii', () => {
    const spec = buildSpecFromSelections(sampleSelections, 'en', 'landing-marketing');
    expect(spec.archetypeId).toBe('landing-marketing');
    expect(spec.presetId).toBe('bold-modern');
    expect(spec.mode).toBe('both');
    expect(spec.defaultMode).toBe('dark');
    expect(spec.radius).toBe('sharp');
    expect(spec.tokens.radius.sm).toBe('2px');
    expect(spec.tokens.radius.md).toBe('4px');
    expect(spec.tokens.palette).toBeDefined();
    expect(spec.tokens.darkPalette).toBeDefined();
    expect(spec.tokens.lightPalette).toBeDefined();
    expect(spec.tokens.fontDisplay).toBe('Bricolage Grotesque');
  });

  it('contrastRatio validates accessible ratios between primary and background', () => {
    const spec = buildSpecFromSelections(sampleSelections, 'en');
    const p = spec.tokens.darkPalette!;
    const ratio = contrastRatio(p.text, p.bg);
    expect(ratio).toBeGreaterThanOrEqual(7.0); // WCAG AAA for normal body text
  });

  it('plan status transitions cleanly from pending to approved', () => {
    const brief = buildDeterministicBrief('SaaS Dashboard', 'en');
    const plan: ProjectPlan = {
      brief,
      selections: sampleSelections,
      status: 'pending',
    };

    expect(plan.status).toBe('pending');
    expect(plan.approvedAt).toBeUndefined();

    // Transition to approved
    const approvedPlan: ProjectPlan = {
      ...plan,
      status: 'approved',
      approvedAt: Date.now(),
    };

    expect(approvedPlan.status).toBe('approved');
    expect(approvedPlan.approvedAt).toBeGreaterThan(0);
    expect(approvedPlan.selections.selectedFeatureIds).toEqual(['f1', 'f2']);
  });
});
