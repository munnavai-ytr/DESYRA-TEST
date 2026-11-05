'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function SettingsPage() {
  return (
    <div className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Top back navigation */}
      <div className="mb-6">
        <Link
          href="/"
          className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to builder</span>
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
          Settings
        </h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Configure builder preferences, integrations, and workspace parameters.
        </p>
      </div>

      {/* AI Keys (BYOK) Section Card */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--muted)] shrink-0">
              <KeyRound className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">
                AI Keys (BYOK)
              </h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Bring Your Own Key for zero-markup direct LLM provider execution.
              </p>
            </div>
          </div>
          <Badge variant="info" size="md">
            Coming next
          </Badge>
        </div>

        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)]">
          <p className="text-sm text-[var(--text)] font-medium">
            Key management arrives in Push 2.
          </p>
          <p className="text-xs text-[var(--muted)] mt-1.5 leading-relaxed">
            In the upcoming release, you will be able to store your Gemini, Anthropic, and OpenAI API keys securely in your browser to power the live agent and code synthesis engines.
          </p>
        </div>
      </Card>
    </div>
  );
}
