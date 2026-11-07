'use client';

import React, { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { notify } from '@/components/ui/toast';

export interface ChatCodeBlockProps {
  code: string;
  language?: string;
}

const COLLAPSE_THRESHOLD = 24;
const COLLAPSED_LINES = 16;

export function ChatCodeBlock({ code, language }: ChatCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const cleanLang = (language || 'text').trim().toLowerCase();
  const rawCode = code.replace(/\r\n/g, '\n');
  const lines = rawCode.split('\n');
  const totalLines = lines.length;
  const isLong = totalLines > COLLAPSE_THRESHOLD;

  const displayCode = isLong && !isExpanded
    ? lines.slice(0, COLLAPSED_LINES).join('\n')
    : rawCode;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(rawCode);
      } else {
        // Fallback for non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = rawCode;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy code:', err);
      notify({
        type: 'error',
        title: 'Copy Failed',
        message: 'Could not copy code to clipboard.',
      });
    }
  };

  return (
    <div className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden my-3 select-text shadow-xs flex flex-col">
      {/* Header bar (~36px) */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--elevated)]/60 select-none flex-none">
        <span className="text-[11px] font-mono lowercase text-[var(--muted)] tracking-wider">
          {cleanLang}
        </span>

        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Code copied' : 'Copy code to clipboard'}
          className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] text-[11px] font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[var(--success)]" />
              <span className="text-[var(--success)]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body - horizontal scroller with vertical swipe pass-through */}
      <div className={isLong && !isExpanded ? 'relative overflow-hidden' : 'relative'}>
        <div className="w-full overflow-x-auto overflow-y-hidden [touch-action:pan-x_pan-y] [overscroll-behavior-x:contain] [overscroll-behavior-y:auto] [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
          <pre className="font-mono text-[12.5px] sm:text-[13px] leading-[1.55] p-3 sm:p-3.5 whitespace-pre text-[var(--text)] [tab-size:2] m-0 border-0 bg-transparent">
            <code>{displayCode}</code>
          </pre>
        </div>

        {/* Gradient fade when collapsed */}
        {isLong && !isExpanded && (
          <div
            className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-[var(--surface)] via-[var(--surface)]/80 to-transparent pointer-events-none"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Expand / Collapse Toggle Bar */}
      {isLong && (
        <div className="border-t border-[var(--border)] bg-[var(--elevated)]/30 px-3 py-1.5 flex items-center justify-center flex-none">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse code block' : `Show all ${totalLines} lines`}
            className="flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--accent)] transition-colors py-0.5 px-2 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] cursor-pointer"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Show all {totalLines} lines</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
