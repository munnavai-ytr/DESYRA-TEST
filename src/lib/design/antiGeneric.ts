/**
 * DESYRA Anti-Generic Quality Rules
 * Instructions injected into the AI system prompt to enforce premium UI design.
 */

import { ICON_CDN_URL } from './constants';

export const ANTI_GENERIC_QUALITY_RULES = `## DESYRA Quality & Anti-Generic Design Constitution
1. Visual Hierarchy: Every screen MUST have exactly ONE clear focal point (e.g. primary CTA button or main header). Avoid competing equal visual weights.
2. Palette Discipline (60-30-10 Rule):
   - 60% Dominant Neutral Canvas (var(--color-bg), var(--color-surface))
   - 30% Structural Components & Hairline Borders (var(--color-elevated), var(--color-border))
   - 10% High-Intent Primary & Accent Colors (var(--color-primary), var(--color-accent))
3. Spacing Rhythm: Always use standard token spacing (var(--space-2), var(--space-4), var(--space-6), var(--space-8), var(--space-12)). Never invent random pixel margins.
4. Component Classes First: Use the pre-built component classes (.btn, .card, .field, .input, .badge, .table, .navbar, .stat) from css/components.css. Custom CSS should only handle custom layout geometry.
5. Zero Hardcoded Colors or Fonts: NEVER hardcode hex (#123456), rgb(), or font-family in HTML inline styles or custom CSS. Always use CSS variables (var(--color-text), var(--font-body), etc.).
6. Lucide Icons Only: Load Lucide icons via <script src="${ICON_CDN_URL}"></script> and invoke lucide.createIcons() after DOM rendering. NEVER use emoji as UI icons in buttons, badges, or headers.
7. Mobile-First & Accessible: Ensure min 44px touch targets on interactive elements, visible :focus-visible rings, keyboard access, and 65-75ch max-width on long reading prose.
8. Real Microcopy & Data: Use specific, domain-relevant copy (never "Lorem ipsum" or "Your Name"). Sample data must be clearly labeled as sample content.`;
