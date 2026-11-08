'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowUp, Clock, ChevronRight, KeyRound } from 'lucide-react';
import { createProject, listProjects, type Project } from '@/lib/db';
import {
  hasAnyKey,
  isSessionLocked,
  saveDraftIdea,
  getDraftIdea,
  clearDraftIdea,
} from '@/lib/keys';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatRelativeTime } from '@/lib/utils';
import { UnlockModal } from '@/components/settings/unlock-modal';

const IDEA_CHIPS = [
  {
    label: 'Portfolio website',
    prompt:
      'A minimalist portfolio website for a product designer featuring an interactive case study grid, about section, and contact form.',
  },
  {
    label: 'Restaurant app',
    prompt:
      'A modern restaurant app with an interactive food menu, table reservation modal, customer reviews, and opening hours.',
  },
  {
    label: 'Fitness tracker',
    prompt:
      'A daily fitness and workout tracker with calorie goals, exercise log, streak counter, and weekly progress charts.',
  },
  {
    label: 'Online shop',
    prompt:
      'An artisan ceramics online store with product filtering by collection, quick view modal, cart drawer, and order summary.',
  },
  {
    label: 'Admin dashboard',
    prompt:
      'An enterprise admin dashboard with real-time revenue analytics, active user metrics, and a searchable user management table.',
  },
  {
    label: 'Learning platform',
    prompt:
      'An interactive course learning platform with modular video lesson player, quiz checkpoints, and certificate tracker.',
  },
];

const MAX_CHARS = 4000;

export default function HomePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [idea, setIdea] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [isAddKeyModalOpen, setIsAddKeyModalOpen] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Restore draft idea and load recent projects from IndexedDB on mount
  useEffect(() => {
    let active = true;

    getDraftIdea()
      .then((draft) => {
        if (active && draft && !idea) {
          setIdea(draft);
        }
      })
      .catch(() => {});

    listProjects()
      .then((all) => {
        if (active) {
          setRecentProjects(all.slice(0, 4));
        }
      })
      .catch((err) => {
        console.error('Failed to load recent projects:', err);
      });

    return () => {
      active = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea: min 3 rows (approx 80px), max ~10 rows (approx 260px)
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, 84), 260);
    el.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [idea, adjustTextareaHeight]);

  // Keep draft updated in meta storage
  const handleIdeaChange = (val: string) => {
    if (val.length <= MAX_CHARS) {
      setIdea(val);
      saveDraftIdea(val).catch(() => {});
    }
  };

  const handleChipClick = (prompt: string) => {
    handleIdeaChange(prompt);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        adjustTextareaHeight();
      }
    }, 20);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = idea.trim();
    if (!trimmed || isSubmitting) return;

    // 1. Check if session is locked under Passphrase Mode
    const locked = await isSessionLocked();
    if (locked) {
      setIsUnlockModalOpen(true);
      return;
    }

    // 2. Check if user has configured any AI provider key
    const hasKey = await hasAnyKey();
    if (!hasKey) {
      await saveDraftIdea(trimmed);
      setIsAddKeyModalOpen(true);
      return;
    }

    // 3. Key exists: proceed with project creation
    setIsSubmitting(true);
    try {
      const newProject = await createProject(trimmed);
      if (newProject) {
        await clearDraftIdea();
        toast({
          type: 'success',
          title: 'Project Initialized',
          message: `Created "${newProject.title}"`,
        });
        router.push(`/project/${newProject.id}`);
      } else {
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error('Failed to create project:', err);
      toast({
        type: 'error',
        title: 'Creation Failed',
        message: 'Could not create project. Please try again.',
      });
      setIsSubmitting(false);
    }
  };

  const isSendDisabled = !idea.trim() || isSubmitting;
  const charsRemaining = MAX_CHARS - idea.length;

  return (
    <div className="flex-1 flex flex-col justify-center max-w-4xl w-full mx-auto px-4 sm:px-6 py-12 sm:py-20">
      {/* Hero Headline Section */}
      <section className="text-center mb-8 sm:mb-10">
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[var(--text)] text-balance">
          What do you want to build?
        </h1>
        <p className="text-sm sm:text-base text-[var(--muted)] mt-2.5 max-w-lg mx-auto">
          Describe your idea. DESYRA designs and builds it.
        </p>
      </section>

      {/* BIG Hero Chat Box */}
      <section className="w-full">
        <form
          onSubmit={handleSubmit}
          className="relative bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-3 sm:p-4 transition-all duration-150 focus-within:border-[var(--accent)] focus-within:shadow-[var(--glow-input)] focus-within:ring-1 focus-within:ring-[var(--accent)]"
        >
          <label htmlFor="idea-input" className="sr-only">
            Describe your application idea
          </label>
          <textarea
            id="idea-input"
            ref={textareaRef}
            value={idea}
            onChange={(e) => handleIdeaChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Build an inventory management app for a specialty coffee roaster with roast profile logs, stock alerts, and batch scheduling..."
            rows={3}
            maxLength={MAX_CHARS}
            disabled={isSubmitting}
            className="w-full bg-transparent text-[var(--text)] placeholder:text-[var(--disabled)] text-sm sm:text-base leading-relaxed resize-none focus:outline-none pr-14 pb-8 overflow-y-auto"
            aria-label="App idea description"
          />

          {/* Bottom Bar inside the box: Character counter on left, Send button on right */}
          <div className="absolute bottom-3 left-4 right-3 flex items-center justify-between pointer-events-none">
            <span
              className={`text-xs tabular-nums select-none ${
                charsRemaining < 200 ? 'text-[var(--warning)] font-medium' : 'text-[var(--disabled)]'
              }`}
            >
              {idea.length} / {MAX_CHARS}
            </span>

            <button
              type="submit"
              disabled={isSendDisabled}
              aria-label="Send idea and build project"
              className="pointer-events-auto w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)] text-black shadow-[var(--glow-accent)] flex items-center justify-center transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-[var(--surface)]"
            >
              <ArrowUp className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </form>

        {/* 6 Idea Chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {IDEA_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => handleChipClick(chip.prompt)}
              className="px-3.5 py-1.5 text-xs sm:text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] bg-[var(--surface)] hover:bg-[var(--elevated)] active:bg-[#202026] border border-[var(--border)] hover:border-[#383842] rounded-[var(--radius-pill)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-pointer"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      {/* Recent Projects (last 4, from IndexedDB) */}
      {recentProjects.length > 0 && (
        <section className="mt-12 sm:mt-16 pt-8 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-[var(--muted)] uppercase tracking-wider">
              Recent Projects
            </h2>
            <Link
              href="/projects"
              className="text-xs text-[var(--muted)] hover:text-[var(--accent)] flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] rounded-[var(--radius-sm)] px-1 py-0.5"
            >
              <span>View all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="group block focus-visible:outline-none"
              >
                <Card
                  interactive
                  className="h-full flex flex-col justify-between p-4 group-hover:border-[#3c3c46]"
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--text)] truncate group-hover:text-white transition-colors">
                      {project.title}
                    </h3>
                    <p className="text-xs text-[var(--muted)] mt-1.5 line-clamp-2 leading-relaxed">
                      {project.idea}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 pt-2 text-[11px] text-[var(--disabled)] border-t border-[var(--border)]/60 tabular-nums">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{formatRelativeTime(project.createdAt)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Gating Modal: Add an AI key first */}
      <Modal
        isOpen={isAddKeyModalOpen}
        onClose={() => setIsAddKeyModalOpen(false)}
        title="Add an AI key first"
        description="DESYRA is a Bring-Your-Own-Key (BYOK) builder. You need at least one API key to synthesize code and scaffold your application."
      >
        <div className="space-y-4 pt-2">
          <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed">
            <p>
              Your idea has been safely saved in this box and will not be lost. We support free-tier options like Google Gemini and Groq, as well as OpenRouter, OpenAI, Anthropic, or any custom local endpoint.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsAddKeyModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setIsAddKeyModalOpen(false);
                router.push('/settings');
              }}
              leftIcon={<KeyRound className="w-4 h-4" />}
            >
              Go to Settings
            </Button>
          </div>
        </div>
      </Modal>

      {/* Unlock Modal for Passphrase Mode */}
      <UnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        onUnlocked={() => {
          setIsUnlockModalOpen(false);
          handleSubmit();
        }}
      />
    </div>
  );
}
