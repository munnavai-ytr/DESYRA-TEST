/**
 * DESYRA CSS Generator - components.css
 * Production-grade UI component classes built exclusively from tokens.
 */

import type { DesignSpec } from '../types';
import { getStylePreset } from '../presets';

export function generateComponentsCss(spec: DesignSpec): string {
  const preset = getStylePreset(spec.presetId);

  return `/* Managed by DESYRA Design. Components Library */

/* ==========================================================================
   1. LAYOUT & CONTAINERS
   ========================================================================== */
.container {
  width: 100%;
  max-width: var(--container-max-width);
  margin-left: auto;
  margin-right: auto;
  padding-left: var(--space-4);
  padding-right: var(--space-4);
}

.section {
  padding: var(--padding-section);
}

.stack {
  display: flex;
  flex-direction: column;
}

.stack > * + * {
  margin-top: var(--space-4);
}

.cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.split {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.grid {
  display: grid;
  gap: var(--space-6);
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}
@media (min-width: 768px) {
  .grid-2 { grid-template-columns: repeat(2, 1fr); }
}

.grid-3 {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}
@media (min-width: 640px) {
  .grid-3 { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
}

.grid-4 {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}
@media (min-width: 640px) {
  .grid-4 { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1024px) {
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
}

/* ==========================================================================
   2. NAVBAR & NAVIGATION
   ========================================================================== */
.navbar {
  height: var(--header-height);
  background-color: var(--color-surface);
  border-bottom: var(--border-width) solid var(--color-border);
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
}

.navbar-nav {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/* ==========================================================================
   3. HERO
   ========================================================================== */
.hero {
  padding: var(--space-16) 0;
  background-color: var(--color-bg);
}

/* ==========================================================================
   4. BUTTONS & ACTIONS (Min 44px touch target)
   ========================================================================== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: var(--padding-button);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 600;
  border-radius: ${preset.buttonStyle === 'pill' ? 'var(--radius-full)' : 'var(--radius-md)'};
  border: var(--border-width) solid transparent;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease),
              border-color var(--duration-fast) var(--ease),
              box-shadow var(--duration-fast) var(--ease),
              transform var(--duration-fast) var(--ease);
}

.btn:hover {
  transform: translateY(-1px);
}

.btn:active {
  transform: translateY(0);
}

.btn:disabled, .btn[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}
.btn-primary:hover {
  background-color: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
}
.btn-primary:active {
  background-color: var(--color-primary-active);
}

.btn-secondary {
  background-color: var(--color-elevated);
  color: var(--color-text);
  border-color: var(--color-border);
}
.btn-secondary:hover {
  background-color: var(--color-surface);
  border-color: var(--color-text-subtle);
}

.btn-ghost {
  background-color: transparent;
  color: var(--color-text-muted);
}
.btn-ghost:hover {
  background-color: var(--color-primary-soft);
  color: var(--color-text);
}

.btn-danger {
  background-color: var(--color-error);
  color: #ffffff;
}
.btn-danger:hover {
  opacity: 0.9;
}

.btn-sm {
  min-height: 36px;
  padding: 0.35rem 0.85rem;
  font-size: var(--text-xs);
}

.btn-lg {
  min-height: 52px;
  padding: 0.75rem 1.75rem;
  font-size: var(--text-base);
}

.btn-icon {
  width: 44px;
  min-width: 44px;
  padding: 0;
}

.btn[aria-busy="true"] {
  position: relative;
  color: transparent !important;
  pointer-events: none;
}
.btn[aria-busy="true"]::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  top: calc(50% - 9px);
  left: calc(50% - 9px);
  border: 2px solid var(--color-on-primary);
  border-right-color: transparent;
  border-radius: 50%;
  animation: desyra-spin 0.6s linear infinite;
}
@keyframes desyra-spin {
  to { transform: rotate(360deg); }
}

/* ==========================================================================
   5. CARDS & CONTAINERS
   ========================================================================== */
.card {
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--padding-card);
  border: var(--border-width) solid var(--color-border);
  box-shadow: ${preset.cardStyle === 'elevated' ? 'var(--shadow-md)' : 'var(--shadow-sm)'};
}

.card-interactive {
  transition: transform var(--duration-fast) var(--ease),
              box-shadow var(--duration-fast) var(--ease),
              border-color var(--duration-fast) var(--ease);
  cursor: pointer;
}
.card-interactive:hover {
  transform: translateY(-2px);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-lg);
}

/* ==========================================================================
   6. FORM INPUTS & FIELDS (Min 44px target)
   ========================================================================== */
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.input, .textarea, .select {
  width: 100%;
  min-height: 44px;
  padding: 0.6rem 0.85rem;
  background-color: var(--color-elevated);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--text-sm);
  transition: border-color var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease);
}

.input:focus, .textarea:focus, .select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring);
}

.textarea {
  min-height: 100px;
  resize: vertical;
}

.field-error {
  font-size: var(--text-xs);
  color: var(--color-error);
}

.field-hint {
  font-size: var(--text-xs);
  color: var(--color-text-subtle);
}

.checkbox {
  width: 20px;
  height: 20px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

/* ==========================================================================
   7. BADGES, CHIPS & AVATARS
   ========================================================================== */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.6rem;
  font-size: var(--text-xs);
  font-weight: 600;
  border-radius: var(--radius-sm);
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
  border: var(--border-width) solid var(--color-border);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.3rem 0.75rem;
  font-size: var(--text-xs);
  border-radius: var(--radius-full);
  background-color: var(--color-elevated);
  border: var(--border-width) solid var(--color-border);
  color: var(--color-text);
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  object-fit: cover;
  background-color: var(--color-elevated);
  border: var(--border-width) solid var(--color-border);
}

/* ==========================================================================
   8. TABS & ACCORDION
   ========================================================================== */
.tabs {
  display: flex;
  border-bottom: var(--border-width) solid var(--color-border);
  gap: var(--space-2);
}

.tab {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  cursor: pointer;
}

.tab[aria-selected="true"], .tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.accordion details {
  border-bottom: var(--border-width) solid var(--color-border);
  padding: var(--space-3) 0;
}
.accordion summary {
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.accordion summary::-webkit-details-marker { display: none; }

/* ==========================================================================
   9. MODALS & OVERLAYS
   ========================================================================== */
dialog.modal {
  margin: auto;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-lg);
  max-width: 500px;
  width: 90%;
}
dialog.modal::backdrop {
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}

/* ==========================================================================
   10. DATA & STATS
   ========================================================================== */
.table-responsive {
  width: 100%;
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.table th, .table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width) solid var(--color-border);
}

.table th {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--color-text-muted);
  background-color: var(--color-elevated);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.stat-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
}
.stat-value {
  font-size: var(--text-3xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ==========================================================================
   11. FEEDBACK & HELPERS
   ========================================================================== */
.skeleton {
  background-color: var(--color-elevated);
  border-radius: var(--radius-sm);
  animation: desyra-shimmer 1.5s infinite ease-in-out;
}
@keyframes desyra-shimmer {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

.empty-state {
  text-center;
  padding: var(--space-12) var(--space-6);
}

.divider {
  height: var(--border-width);
  background-color: var(--color-border);
  width: 100%;
  margin: var(--space-4) 0;
}
`;
}
