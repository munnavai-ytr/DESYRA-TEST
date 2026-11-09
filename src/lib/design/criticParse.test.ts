import { describe, it, expect } from 'vitest';
import { parseCriticJson, buildFallbackCritique } from './criticParse';

describe('7.3 AI Design Critic Parser (criticParse.test.ts)', () => {
  it('parses valid JSON critique cleanly', () => {
    const validJson = JSON.stringify({
      score: 88,
      rubric: {
        antiGeneric: 9,
        authenticity: 8,
        hierarchy: 9,
        contrast: 10,
        density: 8,
        motion: 8,
        microInteractions: 8,
        responsive: 9,
      },
      summary: 'Strong layout hierarchy with crisp typographic contrast.',
      strengths: ['Proper use of button classes', 'Readable typography scale'],
      issues: [
        {
          id: 'i1',
          category: 'contrast',
          severity: 'med',
          title: 'Subtle text contrast',
          description: 'Muted label might be slightly low contrast in sunlight',
          codeEvidence: {
            file: 'index.html',
            line: 45,
            snippet: '<span class="text-xs text-zinc-500">Updated 2m ago</span>',
          },
          fixSuggestion: 'Use var(--color-text-muted) instead of hardcoded zinc',
        },
        {
          id: 'i2',
          category: 'responsiveness',
          severity: 'high',
          title: 'Table overflows on mobile',
          description: 'No horizontal scroll wrapper on wide transactions table',
          codeEvidence: {
            file: 'index.html',
            line: 120,
            snippet: '<table class="table w-full">...</table>',
          },
          fixSuggestion: 'Wrap table in div with overflow-x-auto',
        },
      ],
      quickWins: ['Wrap table with overflow-x-auto container'],
    });

    const critique = parseCriticJson(validJson);
    expect(critique.score).toBe(88);
    expect(critique.rubric.contrast).toBe(10);
    expect(critique.issues.length).toBe(2);
    // Issues sorted by severity: 'high' before 'med'
    expect(critique.issues[0].severity).toBe('high');
    expect(critique.issues[1].severity).toBe('med');
  });

  it('clamps scores between 0-100 and rubric values between 0-10', () => {
    const outOfBoundsJson = JSON.stringify({
      score: 150, // Should clamp to 100
      rubric: {
        antiGeneric: 25, // Should clamp to 10
        authenticity: -5, // Should clamp to 0
      },
    });

    const critique = parseCriticJson(outOfBoundsJson);
    expect(critique.score).toBe(100);
    expect(critique.rubric.antiGeneric).toBe(10);
    expect(critique.rubric.authenticity).toBe(0);
  });

  it('drops issues targeting managed CSS files (e.g. css/tokens.css, css/base.css)', () => {
    const jsonWithManagedIssue = JSON.stringify({
      score: 80,
      issues: [
        {
          id: 'bad-issue',
          severity: 'high',
          title: 'Change token value',
          description: 'Token too dark',
          codeEvidence: {
            file: 'css/tokens.css', // MANAGED FILE!
            snippet: '--color-bg: #09090b;',
          },
          fixSuggestion: 'Edit tokens.css',
        },
        {
          id: 'valid-issue',
          severity: 'low',
          title: 'Button padding',
          description: 'Icon button slightly tight',
          codeEvidence: {
            file: 'index.html',
            snippet: '<button class="btn btn-primary p-1">Go</button>',
          },
          fixSuggestion: 'Use min 44px touch target',
        },
      ],
    });

    const critique = parseCriticJson(jsonWithManagedIssue);
    // Issue on css/tokens.css should be dropped
    expect(critique.issues.length).toBe(1);
    expect(critique.issues[0].codeEvidence?.file).toBe('index.html');
  });

  it('drops issues lacking code evidence snippet', () => {
    const jsonWithoutEvidence = JSON.stringify({
      score: 85,
      issues: [
        {
          id: 'vague-issue',
          severity: 'high',
          title: 'Vague complaint',
          description: 'I do not like the background color',
          // No codeEvidence / snippet
          fixSuggestion: 'Change something',
        },
        {
          id: 'real-issue',
          severity: 'med',
          title: 'Missing label on input',
          description: 'Search field needs aria-label',
          codeEvidence: {
            file: 'index.html',
            snippet: '<input type="text" placeholder="Search..." />',
          },
          fixSuggestion: 'Add aria-label="Search items"',
        },
      ],
    });

    const critique = parseCriticJson(jsonWithoutEvidence);
    expect(critique.issues.length).toBe(1);
    expect(critique.issues[0].id).toBe('real-issue');
  });

  it('never throws on invalid JSON or garbage input, returning fallback critique', () => {
    const garbage = 'Internal server error 500 downstream network timeout';
    const critique = parseCriticJson(garbage);
    expect(critique).toBeDefined();
    expect(critique.score).toBeGreaterThanOrEqual(0);
    expect(critique.rubric).toBeDefined();
  });
});
