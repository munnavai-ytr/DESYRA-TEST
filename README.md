# DESYRA — Premium AI App Builder (Push 1 of 10)

DESYRA is a premium, precise, dark-themed AI application builder interface.

## Tech Stack
- **Framework**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS v4 + Design Tokens (`src/styles/tokens.css`)
- **Icons**: `lucide-react`
- **Client Database**: Dexie (IndexedDB) for client-side persistence
- **Typography**: Inter (Body), Space Grotesk (Display Headlines), Hind Siliguri (Bengali), JetBrains Mono (Code)

## Design System Tokens
- **Canvas / Surfaces**:
  - `bg`: `#09090B`
  - `surface`: `#111114`
  - `elevated`: `#18181C`
  - `border`: `#26262C`
- **Typography**:
  - `text`: `#F4F4F5`
  - `muted`: `#A1A1AA`
  - `disabled`: `#5B5B63`
- **Accent (Orange — strictly ~10% budget)**:
  - `accent`: `#FF6B1A`
  - `accent-hover`: `#FF8240`
  - `accent-pressed`: `#E85A0C`
  - `accent-soft`: `rgba(255, 107, 26, 0.12)`
- **Semantic**:
  - `success`: `#22C55E`, `warning`: `#F5B73B`, `error`: `#EF4444`, `info`: `#60A5FA`
- **Radii**: 8px (`sm`), 12px (`md`), 20px (`lg`), 9999px (`pill`).

## Pages Implemented in Push 1
- `/`: Home hero with headline, auto-growing chat box (min 3 to ~10 rows), 6 starter prompt chips, round orange send button, character counter, and real recent projects list from IndexedDB.
- `/projects`: Grid of saved projects from Dexie IndexedDB with open and delete actions (with accessible confirmation modal and toast notifications).
- `/settings`: AI Keys (BYOK) status card ("Key management arrives in Push 2") with "Coming next" badge.
- `/project/[id]`: Project specification viewer with saved prompt and the "IDE arrives in Push 4" status card.

## How to Run

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Open in browser:
   Navigate to [http://localhost:3000](http://localhost:3000).

4. Production build:
   ```bash
   npm run build
   npm start
   ```
