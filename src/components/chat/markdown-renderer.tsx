'use client';

import React, { useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatCodeBlock } from './chat-code-block';

export interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

const customComponents: Components = {
  // Pass through pre so code component handles code block rendering
  pre({ children }) {
    return <>{children}</>;
  },

  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const textContent = String(children ?? '');
    // A block code has a language match or contains newlines
    const isBlock = Boolean(match) || textContent.includes('\n');

    if (isBlock) {
      const lang = match ? match[1] : '';
      return <ChatCodeBlock code={textContent.replace(/\n$/, '')} language={lang} />;
    }

    return (
      <code
        className="font-mono text-[0.88em] bg-[var(--elevated)] border border-[var(--border)] text-[var(--text)] rounded px-1.5 py-0.5 break-all [overflow-wrap:anywhere]"
        {...props}
      >
        {children}
      </code>
    );
  },

  a({ href, children, ...props }) {
    const isSafe = href && /^(https?:\/\/|mailto:)/i.test(href);
    if (!isSafe) {
      return <span>{children}</span>;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] hover:underline inline-flex items-center gap-0.5 break-all"
        {...props}
      >
        {children}
      </a>
    );
  },

  h1({ children, ...props }) {
    return (
      <h1
        className="text-[17px] sm:text-[19px] font-semibold text-[var(--text)] mt-3.5 mb-1.5 tracking-tight"
        {...props}
      >
        {children}
      </h1>
    );
  },

  h2({ children, ...props }) {
    return (
      <h2
        className="text-[15.5px] sm:text-[17px] font-semibold text-[var(--text)] mt-3 mb-1 tracking-tight"
        {...props}
      >
        {children}
      </h2>
    );
  },

  h3({ children, ...props }) {
    return (
      <h3
        className="text-[14px] sm:text-[15px] font-semibold text-[var(--text)] mt-2.5 mb-1 tracking-tight"
        {...props}
      >
        {children}
      </h3>
    );
  },

  h4({ children, ...props }) {
    return (
      <h4
        className="text-xs sm:text-sm font-medium text-[var(--muted)] mt-2 mb-1 uppercase tracking-wider"
        {...props}
      >
        {children}
      </h4>
    );
  },

  p({ children, ...props }) {
    return (
      <p
        className="text-[14.5px] sm:text-[15px] leading-[1.6] my-2 text-[var(--text)] [overflow-wrap:anywhere]"
        {...props}
      >
        {children}
      </p>
    );
  },

  ul({ children, ...props }) {
    return (
      <ul
        className="list-disc pl-5 my-2.5 space-y-1 text-[var(--text)] text-[14.5px] sm:text-[15px] leading-[1.6]"
        {...props}
      >
        {children}
      </ul>
    );
  },

  ol({ children, ...props }) {
    return (
      <ol
        className="list-decimal pl-5 my-2.5 space-y-1 text-[var(--text)] text-[14.5px] sm:text-[15px] leading-[1.6]"
        {...props}
      >
        {children}
      </ol>
    );
  },

  li({ children, ...props }) {
    return (
      <li className="pl-1 [overflow-wrap:anywhere]" {...props}>
        {children}
      </li>
    );
  },

  blockquote({ children, ...props }) {
    return (
      <blockquote
        className="border-l-2 border-[var(--accent)] pl-3.5 my-3 text-[var(--muted)] italic bg-[var(--surface)]/50 py-1.5 rounded-r-[var(--radius-sm)]"
        {...props}
      >
        {children}
      </blockquote>
    );
  },

  table({ children, ...props }) {
    return (
      <div className="w-full my-3 overflow-x-auto overflow-y-hidden [touch-action:pan-x_pan-y] [overscroll-behavior-x:contain] [overscroll-behavior-y:auto] [-webkit-overflow-scrolling:touch] rounded-[var(--radius-sm)] border border-[var(--border)] [scrollbar-width:thin]">
        <table
          className="w-full border-collapse text-left text-xs sm:text-sm text-[var(--text)]"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },

  th({ children, ...props }) {
    return (
      <th
        className="border-b border-[var(--border)] bg-[var(--elevated)] px-3 py-2 font-semibold text-[var(--text)] whitespace-nowrap"
        {...props}
      >
        {children}
      </th>
    );
  },

  td({ children, ...props }) {
    return (
      <td className="border-b border-[var(--border)] px-3 py-2 text-[var(--text)]" {...props}>
        {children}
      </td>
    );
  },

  hr({ ...props }) {
    return <hr className="border-[var(--border)] my-3.5" {...props} />;
  },
};

function MarkdownRendererBase({ content, isStreaming = false }: MarkdownRendererProps) {
  // If streaming, handle unclosed code block fences gracefully without backtick flickering
  const processedContent = useMemo(() => {
    if (!content) return '';
    if (!isStreaming) return content;

    const fenceMatches = content.match(/```/g);
    if (fenceMatches && fenceMatches.length % 2 === 1) {
      // Append closing fence so react-markdown renders the code block immediately as it grows
      return content + '\n```';
    }
    return content;
  }, [content, isStreaming]);

  return (
    <div className="w-full text-[var(--text)] [overflow-wrap:anywhere]">
      <Markdown remarkPlugins={[remarkGfm]} components={customComponents}>
        {processedContent}
      </Markdown>
    </div>
  );
}

export const MarkdownRenderer = React.memo(MarkdownRendererBase);
