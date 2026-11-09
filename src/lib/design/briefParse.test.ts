import { describe, it, expect } from 'vitest';
import { parseBriefJson, buildDeterministicBrief } from './briefParse';

describe('7.1 IdeaBrief Parser (briefParse.ts)', () => {
  it('parses valid JSON brief cleanly with zero fallback fields', () => {
    const validJson = JSON.stringify({
      appType: 'Project Tracker',
      audience: 'Product teams and managers',
      coreProblem: 'Tracking sprint tasks with real-time progress',
      vibeWords: ['crisp', 'responsive', 'tactile', 'modern'],
      tone: 'Confident, precise, focused',
      copyLanguage: 'en',
      screens: [
        { name: 'Board View', purpose: 'Kanban columns with drag and drop' },
        { name: 'List View', purpose: 'Dense tabular task list with filters' },
        { name: 'Metrics', purpose: 'Velocity charts and completion progress' },
      ],
      features: [
        { id: 'kanban-board', title: 'Kanban Board', description: 'Drag tasks across columns', essential: true },
        { id: 'task-filters', title: 'Tag & Priority Filters', description: 'Filter tasks instantly', essential: true },
        { id: 'task-detail', title: 'Task Detail Drawer', description: 'Edit description and due dates', essential: false },
        { id: 'export-csv', title: 'Export to CSV', description: 'Download task data', essential: false },
      ],
      contentNotes: 'Use realistic software project data.',
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
      risks: ['Overcomplicating the drag-and-drop state before basic tasks work'],
    });

    const { brief, usedFallbackFields } = parseBriefJson(validJson, 'A project tracking app', 'en');
    expect(brief.appType).toBe('Project Tracker');
    expect(brief.directionName).toBe('Obsidian Sprint');
    expect(brief.recommended.presetId).toBe('bold-modern');
    expect(brief.recommended.paletteSeeds).toEqual(['#3b82f6', '#10b981', '#f59e0b']);
    expect(brief.features.length).toBe(4);
    expect(usedFallbackFields.length).toBe(0);
  });

  it('repairs markdown code fences, unescaped characters, and trailing commas', () => {
    const messyOutput = `Here is your product brief:
\`\`\`json
{
  "appType": "Developer Portfolio",
  "audience": "Engineering leaders and recruiters",
  "coreProblem": "Showcasing open source projects and engineering depth",
  "vibeWords": ["clean", "minimal", "sharp", "refined"],
  "tone": "Subtle and sophisticated",
  "copyLanguage": "en",
  "screens": [
    { "name": "Hero & Intro", "purpose": "High-impact bio and resume link" },
    { "name": "Featured Work", "purpose": "Detailed case study writeups" },
    { "name": "Contact", "purpose": "Direct inquiry form" },
  ],
  "features": [
    { "id": "project-gallery", "title": "Interactive Project Gallery", "description": "Filter by tech stack", "essential": true },
    { "id": "case-study-modal", "title": "Modal Case Studies", "description": "In-depth project breakdown", "essential": true },
    { "id": "skills-matrix", "title": "Skills Matrix", "description": "Interactive proficiency badges", "essential": false },
    { "id": "dark-toggle", "title": "Dark Mode Toggle", "description": "Persistent theme toggle", "essential": false },
  ],
  "contentNotes": "Real project links and architectural snippets.",
  "directionName": "Mono Studio",
  "recommended": {
    "presetId": "minimal",
    "fontPairId": "space-grotesk-tech",
    "mode": "both",
    "defaultMode": "dark",
    "density": "comfortable",
    "radius": "sharp",
    "motion": "subtle",
    "paletteSeeds": ["#0ea5e9", "#6366f1", "#10b981"],
  },
  "risks": ["Cluttering the hero section with too much narrative text"],
}
\`\`\`
Hope this helps!`;

    const { brief, usedFallbackFields } = parseBriefJson(messyOutput, 'A dev portfolio', 'en');
    expect(brief.appType).toBe('Developer Portfolio');
    expect(brief.directionName).toBe('Mono Studio');
    expect(brief.recommended.fontPairId).toBe('space-grotesk-tech');
    expect(usedFallbackFields.length).toBe(0);
  });

  it('populates missing screens or features with archetype defaults and notes fallback fields', () => {
    const incompleteJson = JSON.stringify({
      appType: 'Notes App',
      // missing audience, coreProblem, screens, features, vibeWords
      directionName: 'Quick Note',
    });

    const { brief, usedFallbackFields } = parseBriefJson(incompleteJson, 'Personal note taking app', 'en');
    expect(brief.screens.length).toBeGreaterThanOrEqual(3);
    expect(brief.features.length).toBeGreaterThanOrEqual(4);
    expect(usedFallbackFields).toContain('screens');
    expect(usedFallbackFields).toContain('features');
    expect(usedFallbackFields).toContain('audience');
  });

  it('swaps bad or low-contrast palette seeds with valid archetype seed colors', () => {
    const badSeedsJson = JSON.stringify({
      appType: 'Finance Tracker',
      audience: 'Young investors',
      coreProblem: 'Visualizing crypto and stock portfolio returns',
      vibeWords: ['crisp', 'lucid', 'modern'],
      tone: 'Direct',
      copyLanguage: 'en',
      screens: [
        { name: 'Dashboard', purpose: 'Net worth' },
        { name: 'Holdings', purpose: 'Asset list' },
        { name: 'Transactions', purpose: 'History' },
      ],
      features: [
        { id: 'f1', title: 'Asset List', description: 'View holdings', essential: true },
        { id: 'f2', title: 'Performance Chart', description: 'ROI graph', essential: true },
        { id: 'f3', title: 'Quick Buy', description: 'Mock trade', essential: false },
        { id: 'f4', title: 'CSV Import', description: 'Import file', essential: false },
      ],
      contentNotes: 'Sample numbers',
      directionName: 'Crypto Pulse',
      recommended: {
        presetId: 'neo-tech-dark',
        fontPairId: 'space-grotesk-tech',
        mode: 'dark',
        defaultMode: 'dark',
        density: 'compact',
        radius: 'soft',
        motion: 'rich',
        paletteSeeds: ['not-a-color', '#fff', '#fff'], // invalid hex & duplicate
      },
      risks: ['Fake live market tick simulation without clear disclaimer'],
    });

    const { brief, usedFallbackFields } = parseBriefJson(badSeedsJson, 'Crypto portfolio', 'en');
    expect(usedFallbackFields.some((f) => f.includes('paletteSeeds'))).toBe(true);
    expect(brief.recommended.paletteSeeds[0]).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(brief.recommended.paletteSeeds[1]).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('selects Bengali font pair automatically when copyLanguage is bn', () => {
    const bnJson = JSON.stringify({
      appType: 'বাংলা সংবাদ পোর্টাল',
      audience: 'দৈনিক সংবাদ পাঠক',
      coreProblem: 'তাজা খবর এবং ব্রেকিং নিউজ পরিবেশন',
      vibeWords: ['আধুনিক', 'স্পষ্ট', 'গতিশীল'],
      tone: 'সংবাদভিত্তিক',
      copyLanguage: 'bn',
      screens: [
        { name: 'হোম পেজ', purpose: 'প্রধান খবর' },
        { name: 'বিভাগ', purpose: 'ক্যাটাগরি' },
        { name: 'মতামত', purpose: 'কলাম' },
      ],
      features: [
        { id: 'f1', title: 'সংবাদ গ্রিড', description: 'তাজা খবর', essential: true },
        { id: 'f2', title: 'অনুসন্ধান', description: 'খবর খুঁজুন', essential: true },
        { id: 'f3', title: 'বুকমার্ক', description: 'সংরক্ষণ করুন', essential: false },
        { id: 'f4', title: 'শেয়ার', description: 'সোশ্যাল শেয়ার', essential: false },
      ],
      contentNotes: 'বাংলা কন্টেন্ট',
      directionName: 'দৈনিক দিগন্ত',
      recommended: {
        presetId: 'editorial-luxury',
        fontPairId: 'inter-neutral', // Latin font pair invalid for Bengali
        mode: 'dark',
        defaultMode: 'dark',
        density: 'comfortable',
        radius: 'soft',
        motion: 'subtle',
        paletteSeeds: ['#dc2626', '#1e293b', '#f8fafc'],
      },
      risks: ['ফন্ট রেন্ডারিং সমস্যা'],
    });

    const { brief, usedFallbackFields } = parseBriefJson(bnJson, 'বাংলা সংবাদ পোর্টাল', 'bn');
    expect(brief.copyLanguage).toBe('bn');
    // Invalid Latin font should be corrected to a Bengali font pair
    expect(brief.recommended.fontPairId).toBe('hind-siliguri-bn');
    expect(usedFallbackFields).toContain('recommended.fontPairId(bengali_match)');
  });

  it('falls back to buildDeterministicBrief and never throws on garbage text', () => {
    const garbage = 'Fatal Error: Server cannot connect to downstream model API 502';
    const { brief, usedFallbackFields } = parseBriefJson(garbage, 'E-commerce store', 'en');
    expect(brief).toBeDefined();
    expect(brief.appType).toBeDefined();
    expect(brief.screens.length).toBeGreaterThanOrEqual(3);
    expect(brief.features.length).toBeGreaterThanOrEqual(4);
    expect(usedFallbackFields.length).toBeGreaterThan(0);
  });
});
