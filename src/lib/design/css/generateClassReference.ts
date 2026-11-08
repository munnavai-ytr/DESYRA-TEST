/**
 * DESYRA Component Class Reference Generator
 * Generates a compact Markdown reference of available CSS classes.
 */

export interface ClassDoc {
  className: string;
  usage: string;
  category: string;
}

export const CLASS_REGISTRY: ClassDoc[] = [
  // Layout
  { className: '.container', usage: 'Responsive page width wrapper with max-width 1240px and horizontal padding', category: 'Layout' },
  { className: '.section', usage: 'Vertical section container with standardized responsive density padding', category: 'Layout' },
  { className: '.stack', usage: 'Vertical flex stack with consistent token gap spacing', category: 'Layout' },
  { className: '.cluster', usage: 'Horizontal wrapping flex row for tags, buttons, or chips', category: 'Layout' },
  { className: '.split', usage: 'Flex row with space-between alignment for headers and metadata', category: 'Layout' },
  { className: '.grid', usage: 'Base responsive CSS grid container', category: 'Layout' },
  { className: '.grid-2', usage: '2-column responsive grid (1 column on mobile, 2 columns >= 768px)', category: 'Layout' },
  { className: '.grid-3', usage: '3-column responsive grid (1 col mobile, 2 cols tablet, 3 cols desktop)', category: 'Layout' },
  { className: '.grid-4', usage: '4-column responsive grid (1 col mobile, 2 cols tablet, 4 cols desktop)', category: 'Layout' },

  // Navigation
  { className: '.navbar', usage: 'Sticky top navigation bar container with bottom border', category: 'Navigation' },
  { className: '.navbar-nav', usage: 'Flex container for top bar link items', category: 'Navigation' },

  // Buttons
  { className: '.btn', usage: 'Base button with min 44px touch target, flex centering, and transition', category: 'Buttons' },
  { className: '.btn-primary', usage: 'Primary filled action button with high-contrast accent fill', category: 'Buttons' },
  { className: '.btn-secondary', usage: 'Secondary elevated button for alternative actions', category: 'Buttons' },
  { className: '.btn-ghost', usage: 'Border-less subtle hover button for secondary actions', category: 'Buttons' },
  { className: '.btn-danger', usage: 'Red destructive action button for warnings and deletes', category: 'Buttons' },
  { className: '.btn-sm', usage: 'Compact 36px button for tight table rows or toolbars', category: 'Buttons' },
  { className: '.btn-lg', usage: 'Large 52px hero call-to-action button', category: 'Buttons' },
  { className: '.btn-icon', usage: 'Square 44px icon-only button container', category: 'Buttons' },

  // Cards
  { className: '.card', usage: 'Surface container card with radius, border, and background fill', category: 'Cards' },
  { className: '.card-interactive', usage: 'Hoverable card with subtle lift and border accent highlight', category: 'Cards' },

  // Forms
  { className: '.field', usage: 'Form field wrapper grouping label, input, hint, and error', category: 'Forms' },
  { className: '.label', usage: 'Uppercase 12px form label with semibold weight', category: 'Forms' },
  { className: '.input', usage: 'Single-line text input with 44px min height and focus ring', category: 'Forms' },
  { className: '.textarea', usage: 'Multi-line text area input with 100px min height', category: 'Forms' },
  { className: '.select', usage: 'Styled dropdown select input with 44px min height', category: 'Forms' },
  { className: '.checkbox', usage: '20px checkbox input with primary accent fill', category: 'Forms' },
  { className: '.field-error', usage: 'Red validation error text below input', category: 'Forms' },
  { className: '.field-hint', usage: 'Subtle guidance note below input', category: 'Forms' },

  // Badges & Data
  { className: '.badge', usage: 'Compact inline status pill container with primary soft tint', category: 'Badges' },
  { className: '.chip', usage: 'Rounded tag pill with border and optional icon', category: 'Badges' },
  { className: '.avatar', usage: '40px circular profile image container', category: 'Badges' },
  { className: '.table', usage: 'Data table with bordered rows and sticky header support', category: 'Data' },
  { className: '.table-responsive', usage: 'Horizontally scrollable wrapper for tables', category: 'Data' },
  { className: '.stat', usage: 'Key metric display block with label and tabular numbers', category: 'Data' },

  // Feedback & Overlays
  { className: '.modal', usage: 'Native <dialog> element modal container with backdrop blur', category: 'Overlays' },
  { className: '.skeleton', usage: 'Pulsing shimmer loading placeholder for images and text', category: 'Feedback' },
  { className: '.empty-state', usage: 'Centered empty content illustration and message box', category: 'Feedback' },
  { className: '.divider', usage: 'Hairline horizontal separator line', category: 'Feedback' },
];

/**
 * Returns a formatted Markdown class reference.
 */
export function generateClassReference(): string {
  let md = '### DESYRA Component Class Reference\n\n';
  md += 'Use these pre-built classes from `css/components.css` instead of custom inline styles:\n\n';

  let currentCategory = '';
  for (const doc of CLASS_REGISTRY) {
    if (doc.category !== currentCategory) {
      currentCategory = doc.category;
      md += `\n#### ${currentCategory}\n`;
    }
    md += `- \`${doc.className}\`: ${doc.usage}\n`;
  }

  return md;
}
