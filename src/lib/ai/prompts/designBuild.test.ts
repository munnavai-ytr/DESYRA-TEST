import { describe, it, expect } from 'vitest';
import { buildDesignSystemPrompt } from './designBuild';
import { createSpecFromClassification } from '@/lib/design/install';
import { ICON_CDN_URL } from '@/lib/design/constants';
import type { ProjectPlan } from '@/lib/design/types';

describe('7.4 Design Build Prompt & Product Brief Section (designBuild.test.ts)', () => {
  const spec = createSpecFromClassification('Task management dashboard');

  const approvedPlan: ProjectPlan = {
    brief: {
      appType: 'Task Manager',
      audience: 'Product teams',
      coreProblem: 'Tracking team velocity and backlog items',
      vibeWords: ['crisp', 'responsive', 'tactile'],
      tone: 'Confident, direct',
      copyLanguage: 'en',
      screens: [
        { name: 'Sprint Board', purpose: 'Drag and drop cards across stages' },
        { name: 'Backlog List', purpose: 'Priority ordering table' },
        { name: 'Analytics', purpose: 'Burn-down velocity graph' },
      ],
      features: [
        { id: 'f-board', title: 'Kanban Stage Columns', description: 'Visual pipeline', essential: true },
        { id: 'f-filter', title: 'Instant Tag Search', description: 'Fast client filter', essential: true },
        { id: 'f-unselected', title: 'Export to XML', description: 'Export legacy file', essential: false },
      ],
      contentNotes: 'Use real software tickets.',
      directionName: 'Obsidian Sprint',
      recommended: {
        presetId: 'bold-modern',
        fontPairId: 'bricolage-bold',
        mode: 'dark',
        defaultMode: 'dark',
        density: 'comfortable',
        radius: 'sharp',
        motion: 'rich',
        paletteSeeds: ['#3b82f6', '#10b981', '#f59e0b'],
      },
      risks: ['Overcomplicating ticket modal layout'],
    },
    selections: {
      presetId: 'bold-modern',
      fontPairId: 'bricolage-bold',
      mode: 'dark',
      defaultMode: 'dark',
      density: 'comfortable',
      radius: 'sharp',
      motion: 'rich',
      primarySeed: '#3b82f6',
      selectedFeatureIds: ['f-board', 'f-filter'], // 'f-unselected' is omitted
      customFeatures: ['CSV ticket importer'],
    },
    status: 'approved',
    approvedAt: 12345678,
  };

  it('includes the Product Brief section when plan is approved', () => {
    const prompt = buildDesignSystemPrompt(spec, approvedPlan);
    expect(prompt).toContain('## APPROVED PRODUCT BRIEF & DIRECTION: "Obsidian Sprint"');
    expect(prompt).toContain('- App Type: Task Manager');
    expect(prompt).toContain('- Core Need: Tracking team velocity and backlog items');
    expect(prompt).toContain('Sprint Board: Drag and drop cards across stages');
    expect(prompt).toContain(ICON_CDN_URL);
  });

  it('only includes features selected by the user in the Plan Card', () => {
    const prompt = buildDesignSystemPrompt(spec, approvedPlan);
    // Checked features must be present
    expect(prompt).toContain('Kanban Stage Columns');
    expect(prompt).toContain('Instant Tag Search');
    // Custom feature must be present
    expect(prompt).toContain('CSV ticket importer');
    // Unchecked feature MUST NOT be in the approved feature list
    expect(prompt).not.toContain('Export to XML');
  });

  it('omits Product Brief section when plan is null or still pending', () => {
    const promptWithoutPlan = buildDesignSystemPrompt(spec, null);
    expect(promptWithoutPlan).not.toContain('APPROVED PRODUCT BRIEF');

    const pendingPlan: ProjectPlan = {
      ...approvedPlan,
      status: 'pending',
    };
    const promptWithPendingPlan = buildDesignSystemPrompt(spec, pendingPlan);
    expect(promptWithPendingPlan).not.toContain('APPROVED PRODUCT BRIEF');
  });
});
