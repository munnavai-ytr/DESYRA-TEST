/**
 * DESYRA Design System Component Recipes
 * High-quality HTML snippets using DESYRA component classes.
 */

export interface ComponentRecipe {
  id: string;
  title: string;
  category: string;
  snippet: string;
}

export const RECIPES: Record<string, ComponentRecipe> = {
  navbar: {
    id: 'navbar',
    title: 'Navbar with Mobile Menu Toggle',
    category: 'layout',
    snippet: `<header className="navbar">
  <div className="container flex items-center justify-between">
    <a href="index.html" className="font-bold text-lg text-[var(--color-text)]">
      BrandName
    </a>
    <nav className="navbar-nav hidden md:flex items-center gap-6" id="navMenu">
      <a href="#features" className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Features</a>
      <a href="#pricing" className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Pricing</a>
      <a href="#about" className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">About</a>
      <a href="#contact" className="btn btn-primary btn-sm">Get Started</a>
    </nav>
    <button type="button" className="md:hidden btn btn-ghost btn-sm" aria-label="Toggle Menu" onclick="document.getElementById('navMenu').classList.toggle('hidden')">
      ☰
    </button>
  </div>
</header>`,
  },

  hero: {
    id: 'hero',
    title: 'Hero Section',
    category: 'hero',
    snippet: `<section className="section hero text-center md:text-left">
  <div className="container grid md:grid-2 items-center gap-12">
    <div className="stack gap-6">
      <span className="badge">New Release v2.0</span>
      <h1 className="text-4xl md:text-5xl font-bold leading-tight">
        Build Exceptional Web Products Faster
      </h1>
      <p className="text-lg text-[var(--color-text-muted)]">
        A deterministic, production-ready design foundation for modern web applications.
      </p>
      <div className="cluster gap-4">
        <a href="#start" className="btn btn-primary btn-lg">Start Free Trial</a>
        <a href="#demo" className="btn btn-secondary btn-lg">Watch Demo</a>
      </div>
    </div>
    <div className="card p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-md">
      <div className="aspect-video bg-[var(--color-elevated)] rounded-[var(--radius-md)] flex items-center justify-center text-[var(--color-text-muted)]">
        [ Interactive App Preview ]
      </div>
    </div>
  </div>
</section>`,
  },

  features: {
    id: 'features',
    title: 'Feature Grid',
    category: 'features',
    snippet: `<section className="section bg-[var(--color-surface)]">
  <div className="container stack gap-12">
    <div className="text-center max-w-2xl mx-auto stack gap-3">
      <h2 className="text-3xl font-bold">Powerful Core Features</h2>
      <p className="text-[var(--color-text-muted)]">Everything you need to ship high-quality apps without complexity.</p>
    </div>
    <div className="grid grid-3 gap-6">
      <div className="card stack gap-3">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center font-bold">01</div>
        <h3 className="text-lg font-semibold">Deterministic Styling</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Tokens and component specs guarantee WCAG 7:1 contrast ratios on every theme.</p>
      </div>
      <div className="card stack gap-3">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center font-bold">02</div>
        <h3 className="text-lg font-semibold">Zero Dependencies</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Pure CSS and vanilla JS modules execute reliably inside sandboxed previews.</p>
      </div>
      <div className="card stack gap-3">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center font-bold">03</div>
        <h3 className="text-lg font-semibold">Instant Re-Theming</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Hot swap presets, fonts, radii, and color seeds without touching HTML files.</p>
      </div>
    </div>
  </div>
</section>`,
  },

  pricing: {
    id: 'pricing',
    title: 'Pricing Cards',
    category: 'pricing',
    snippet: `<section className="section">
  <div className="container stack gap-12">
    <div className="text-center max-w-xl mx-auto">
      <h2 className="text-3xl font-bold">Simple, Transparent Pricing</h2>
      <p className="text-[var(--color-text-muted)] mt-2">Choose the plan that best fits your workflow.</p>
    </div>
    <div className="grid grid-3 gap-8 items-stretch">
      <div className="card stack justify-between gap-6">
        <div className="stack gap-4">
          <h3 className="text-xl font-bold">Starter</h3>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold">$0</span>
            <span className="text-sm text-[var(--color-text-muted)]">/month</span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">Perfect for personal side projects.</p>
          <ul className="stack gap-2 text-sm text-[var(--color-text-muted)]">
            <li>✓ Up to 3 active projects</li>
            <li>✓ Standard design tokens</li>
            <li>✓ In-browser preview</li>
          </ul>
        </div>
        <button type="button" className="btn btn-secondary w-full">Get Started</button>
      </div>
      <div className="card border-2 border-[var(--color-primary)] stack justify-between gap-6 relative shadow-lg">
        <span className="badge absolute -top-3 right-6 bg-[var(--color-primary)] text-[var(--color-on-primary)]">Popular</span>
        <div className="stack gap-4">
          <h3 className="text-xl font-bold">Pro</h3>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold">$29</span>
            <span className="text-sm text-[var(--color-text-muted)]">/month</span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">For developers and small teams.</p>
          <ul className="stack gap-2 text-sm text-[var(--color-text-muted)]">
            <li>✓ Unlimited projects</li>
            <li>✓ Custom color seeds & presets</li>
            <li>✓ Design Linter & Auto-fix</li>
            <li>✓ Priority export</li>
          </ul>
        </div>
        <button type="button" className="btn btn-primary w-full">Start Free Trial</button>
      </div>
      <div className="card stack justify-between gap-6">
        <div className="stack gap-4">
          <h3 className="text-xl font-bold">Enterprise</h3>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold">$99</span>
            <span className="text-sm text-[var(--color-text-muted)]">/month</span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">For organizations needing custom rules.</p>
          <ul className="stack gap-2 text-sm text-[var(--color-text-muted)]">
            <li>✓ Dedicated design token server</li>
            <li>✓ Custom brand font pairs</li>
            <li>✓ Team collaboration</li>
          </ul>
        </div>
        <button type="button" className="btn btn-secondary w-full">Contact Sales</button>
      </div>
    </div>
  </div>
</section>`,
  },

  stats: {
    id: 'stats',
    title: 'Stats Row',
    category: 'stats',
    snippet: `<div className="grid grid-4 gap-4">
  <div className="stat card">
    <span className="stat-label">Active Users</span>
    <span className="stat-value">12,450</span>
    <span className="stat-change text-[var(--color-success)]">↑ +14% this month</span>
  </div>
  <div className="stat card">
    <span className="stat-label">Avg. Render Time</span>
    <span className="stat-value">18ms</span>
    <span className="stat-change text-[var(--color-success)]">↑ 4ms faster</span>
  </div>
  <div className="stat card">
    <span className="stat-label">WCAG Ratios</span>
    <span className="stat-value">100%</span>
    <span className="stat-change text-[var(--color-text-muted)]">AAA Guaranteed</span>
  </div>
  <div className="stat card">
    <span className="stat-label">System Status</span>
    <span className="stat-value">Healthy</span>
    <span className="stat-change text-[var(--color-success)]">● 99.9% Uptime</span>
  </div>
</div>`,
  },

  form: {
    id: 'form',
    title: 'Form with Field Validation',
    category: 'forms',
    snippet: `<form className="card max-w-md mx-auto stack gap-4" onsubmit="event.preventDefault();">
  <h2 className="text-xl font-bold">Create Your Account</h2>
  <div className="field">
    <label htmlFor="fullName" className="label">Full Name</label>
    <input type="text" id="fullName" className="input" placeholder="Sarah Connor" required />
  </div>
  <div className="field">
    <label htmlFor="userEmail" className="label">Email Address</label>
    <input type="email" id="userEmail" className="input" placeholder="sarah@example.com" required />
    <span className="field-hint">We will send confirmation to this email.</span>
  </div>
  <div className="field">
    <label htmlFor="userRole" className="label">Primary Role</label>
    <select id="userRole" className="select">
      <option value="developer">Developer</option>
      <option value="designer">Designer</option>
      <option value="manager">Product Manager</option>
    </select>
  </div>
  <div className="cluster gap-2">
    <input type="checkbox" id="terms" className="checkbox" required />
    <label htmlFor="terms" className="text-sm">I agree to Terms & Conditions</label>
  </div>
  <button type="submit" className="btn btn-primary w-full mt-2">Complete Registration</button>
</form>`,
  },

  table: {
    id: 'table',
    title: 'Data Table with Pagination',
    category: 'data',
    snippet: `<div className="card p-0 overflow-hidden">
  <div className="table-responsive">
    <table className="table">
      <thead>
        <tr>
          <th>Project Name</th>
          <th>Status</th>
          <th>Created</th>
          <th className="text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="font-medium">Portfolio v2</td>
          <td><span className="badge bg-[var(--color-success)] text-white">Active</span></td>
          <td className="text-sm text-[var(--color-text-muted)]">2 hours ago</td>
          <td className="text-right">
            <button type="button" className="btn btn-ghost btn-sm">Edit</button>
          </td>
        </tr>
        <tr>
          <td className="font-medium">E-Commerce Store</td>
          <td><span className="badge bg-[var(--color-warning)] text-white">Building</span></td>
          <td className="text-sm text-[var(--color-text-muted)]">Yesterday</td>
          <td className="text-right">
            <button type="button" className="btn btn-ghost btn-sm">View</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>`,
  },

  modal: {
    id: 'modal',
    title: 'Modal via Native Dialog',
    category: 'overlays',
    snippet: `<dialog id="sampleModal" className="modal card p-6 max-w-lg w-full">
  <div className="stack gap-4">
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-bold">Confirm Action</h3>
      <button type="button" className="btn btn-ghost btn-sm" onclick="document.getElementById('sampleModal').close()">✕</button>
    </div>
    <p className="text-sm text-[var(--color-text-muted)]">
      Are you sure you want to proceed? This action cannot be undone.
    </p>
    <div className="cluster justify-end gap-3 mt-4">
      <button type="button" className="btn btn-secondary" onclick="document.getElementById('sampleModal').close()">Cancel</button>
      <button type="button" className="btn btn-danger" onclick="document.getElementById('sampleModal').close()">Confirm</button>
    </div>
  </div>
</dialog>`,
  },

  emptyState: {
    id: 'emptyState',
    title: 'Empty State Placeholder',
    category: 'feedback',
    snippet: `<div className="empty-state card text-center p-12 stack items-center gap-4">
  <div className="w-12 h-12 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center text-xl font-bold">
    ∅
  </div>
  <h3 className="text-lg font-bold">No Projects Found</h3>
  <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
    You haven't created any projects yet. Start by generating your first web application.
  </p>
  <button type="button" className="btn btn-primary mt-2">Create Project</button>
</div>`,
  },
};

/**
 * Returns 3 to 6 relevant component recipes for an archetype.
 */
export function getRecipesForArchetype(archetypeId: string): ComponentRecipe[] {
  switch (archetypeId) {
    case 'landing-marketing':
      return [RECIPES.navbar, RECIPES.hero, RECIPES.features, RECIPES.pricing, RECIPES.form];
    case 'saas-dashboard-admin':
      return [RECIPES.stats, RECIPES.table, RECIPES.form, RECIPES.emptyState, RECIPES.modal];
    case 'ecommerce-store':
      return [RECIPES.navbar, RECIPES.features, RECIPES.pricing, RECIPES.table, RECIPES.modal];
    case 'food-restaurant-cafe':
      return [RECIPES.navbar, RECIPES.hero, RECIPES.features, RECIPES.form, RECIPES.modal];
    case 'fintech-finance':
      return [RECIPES.stats, RECIPES.table, RECIPES.form, RECIPES.modal];
    case 'education-quiz-learning':
      return [RECIPES.navbar, RECIPES.features, RECIPES.form, RECIPES.emptyState];
    case 'productivity-tools':
      return [RECIPES.navbar, RECIPES.stats, RECIPES.form, RECIPES.emptyState];
    default:
      return [RECIPES.navbar, RECIPES.hero, RECIPES.features, RECIPES.form, RECIPES.emptyState];
  }
}
