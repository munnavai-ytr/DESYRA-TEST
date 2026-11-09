/**
 * DESYRA AI Design Critic Engine
 * Runs AI-assisted qualitative critique on user-authored project code,
 * evaluating against the 8 DESYRA design principles.
 */

import { buildCriticPrompt } from '@/lib/ai/prompts/critic';
import { parseCriticJson, buildFallbackCritique } from './criticParse';
import { MANAGED_DESIGN_FILES } from './install';
import { streamChat } from '@/lib/ai';
import { updateProject, type ProjectFile } from '@/lib/db';
import type { SafeProviderInfo } from '@/lib/keys';
import type { DesignSpec, IdeaBrief, LintResult, ProjectCritique } from './types';

export const MAX_CRITIC_CODE_CHARS = 40000;

export interface RunCriticParams {
  projectId: string;
  files: ProjectFile[];
  spec: DesignSpec;
  brief?: IdeaBrief | null;
  lintResult?: LintResult | null;
  provider: SafeProviderInfo;
  model: string;
  signal?: AbortSignal;
}

/**
 * Runs the AI design critic and persists critique to the database.
 */
export async function runDesignCritic(params: RunCriticParams): Promise<ProjectCritique> {
  // 1. Gather non-managed files up to 40k chars
  const nonManagedFiles = params.files.filter(
    (f) => !MANAGED_DESIGN_FILES.includes(f.path)
  );

  let currentChars = 0;
  const fileBlocks: string[] = [];

  for (const f of nonManagedFiles) {
    if (currentChars >= MAX_CRITIC_CODE_CHARS) break;
    const remaining = MAX_CRITIC_CODE_CHARS - currentChars;
    let content = f.content;
    if (content.length > remaining) {
      content = content.slice(0, remaining) + '\n... [truncated for critic evaluation]';
    }
    currentChars += content.length;
    fileBlocks.push(`--- File: ${f.path} ---\n${content}\n`);
  }

  const projectFilesText =
    fileBlocks.length > 0 ? fileBlocks.join('\n') : 'No user-authored files found.';

  // 2. Format existing lint findings
  const lintSummaries = (params.lintResult?.issues || []).map(
    (issue) => `[${issue.severity.toUpperCase()}] ${issue.file}: ${issue.message}`
  );

  // 3. Construct prompt
  const systemPrompt = buildCriticPrompt({
    spec: params.spec,
    brief: params.brief,
    lintIssueSummaries: lintSummaries,
    projectFilesText,
  });

  let rawOutput = '';
  try {
    const stream = streamChat({
      provider: params.provider,
      model: params.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: 'Evaluate this codebase against the 8 design principles and return the JSON critique.',
        },
      ],
      signal: params.signal,
      maxOutputTokens: 2000,
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        rawOutput += chunk.text;
      }
    }

    const critique = parseCriticJson(rawOutput);

    // Save critique to project in database
    await updateProject(params.projectId, { critique });

    return critique;
  } catch (err: unknown) {
    if (params.signal?.aborted) {
      const fallback = buildFallbackCritique();
      return fallback;
    }
    console.warn('[DESYRA Critic] Critic call failed, using fallback critique:', err);
    const fallback = buildFallbackCritique();
    await updateProject(params.projectId, { critique: fallback });
    return fallback;
  }
}
