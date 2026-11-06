# DESYRA — Premium AI App Builder (Push 4 of 10)

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

## Pages Implemented in Pushes 1 to 4
- `/`: Home hero with headline, auto-growing chat box (min 3 to ~10 rows), 6 starter prompt chips, round orange send button, character counter, recent projects list from IndexedDB, and BYOK gating modal preserving drafts when no key is configured.
- `/projects`: Grid of saved projects from Dexie IndexedDB with open, rename, and delete actions (with accessible confirmation modal and toast notifications).
- `/settings`: Full Bring-Your-Own-Key management (Google Gemini, Groq, OpenRouter, OpenAI, Anthropic, and custom endpoints) with AES-GCM encryption, passphrase protection controls, danger zone data wipe options, live "Test key" verification, and searchable Model Pickers.
- `/project/[id]`: Full-viewport (`100dvh`) IDE workspace with slim TopBar, chat pane, hierarchical file explorer, code editor, and responsive preview frame.

## The IDE Page (`/project/[id]`)

Push 4 establishes the core workspace layout:
1. **Slim TopBar (~48px)**:
   - Direct back navigation to `/projects`.
   - Inline project renaming with `1-60` character validation (Enter saves, Esc cancels, updates `updatedAt` in IndexedDB).
   - Live Active Provider & Model chip: clicking opens a quick popover to hot-swap among saved providers and models.
   - Settings shortcut icon.
2. **Desktop & Tablet Layouts**:
   - **Split Workspace**: Left chat pane and right IDE workspace separated by a draggable vertical divider (default 35% / 65% on desktop, 40% / 60% on tablet).
   - **Keyboard & Preference Persistence**: Focus the divider and adjust width using `ArrowLeft` / `ArrowRight` (Home key resets); ratio is saved in `localStorage`.
   - **Workspace Tabs**: "Preview" and "Code" with active orange underline.
   - **File Tree**: Collapsible panel on desktop (toggle with button or `Ctrl+B` / `Cmd+B`) and overlay drawer on tablet.
3. **Mobile Layout (< 768px)**:
   - Fixed bottom tab bar (4 tabs: Chat, Preview, Files, Code) with minimum 48px touch targets and safe-area padding.
   - State preservation: all 4 panes remain mounted in the DOM to preserve textarea drafts, scroll offsets, and editor state.
   - Selecting any file in the Files tab automatically transitions to the Code editor.
4. **Chat Pane**:
   - Continuous first-open flow: if a project has zero messages and an active key/model is unlocked, it flags `autoStarted = true` and automatically submits the app idea as the initial message.
   - Gated fallback: if no key or storage is locked, it presents an explanatory card with a direct "Start with my idea" button once configured.
   - Message bubble styling: surface cards for assistant, elevated cards for user (no solid orange fills), relative timestamps on hover, autoscroll with scroll-up detection, and floating "Jump to latest" button.
   - Auto-growing composer up to 8 rows, `Enter` to send, `Shift+Enter` for new lines, streaming stop button, and retry on error.
5. **IndexedDB File Tree (`src/lib/files.ts`)**:
   - IndexedDB `files` table (schema v4) with compound index `[projectId+path]`.
   - Relative POSIX paths with strict validation (no leading slash, no `..`, no backslashes, max 200 chars, max 500 files, max 1 MB per file).
   - Recursive tree visualization with folder expand/collapse state, file-type icons, row action buttons (Rename, Delete), and Delete Folder confirmation detailing affected file count.
6. **Code Editor**:
   - Monospace editor using JetBrains Mono with line-number gutter.
   - Autosave with 600ms debounce to IndexedDB, saving on blur, unmount, and `beforeunload`.
   - Tab key inserts 2 spaces, spellcheck disabled, horizontal scrolling for long lines.
   - File size monitoring with warning banner for files exceeding 200 KB.
7. **Preview Pane**:
   - Frame toolbar with responsive device toggles: Phone (`390px`), Tablet (`768px`), and Desktop (`100%`).
   - Frame container resizes smoothly with subtle border simulation.
   - Clearly labeled empty state: "Live preview arrives in Push 6."

## Providers and Known Limitations

1. **Direct Browser Execution (Client-Side Calls)**:
   - All AI API calls execute directly from your web browser using your decrypted local keys at request time.
   - **CORS Constraints**: Providers like Google Gemini and OpenRouter natively support browser origins. Anthropic calls use the official `anthropic-dangerous-direct-browser-access: true` header. Some strict OpenAI or corporate custom gateway endpoints may enforce strict CORS policies that disallow direct origin requests. A local/proxy relay feature is scheduled for a subsequent release.
2. **Dynamic Free-Tier Limits**:
   - Free-tier quotas, requests-per-minute (RPM), and token concurrency limits are governed entirely by each upstream provider (e.g., Google AI Studio, Groq Cloud, OpenRouter free models).
   - If a provider reports HTTP 429, DESYRA notifies you with the suggested retry-after window and allows you to hot-swap to another configured provider immediately.

## Key Storage and Security

DESYRA operates as a client-side BYOK (Bring Your Own Key) architecture:
1. **Zero Central Servers**: Your keys are encrypted and stored solely inside your browser's IndexedDB storage. DESYRA runs no telemetry or backend relay server that receives your keys.
2. **Web Crypto AES-GCM (256-bit)**:
   - **Default Mode**: A non-extractable 256-bit AES-GCM `CryptoKey` is generated via the Web Crypto API and held in the browser's database. Keys are encrypted with a random 12-byte initialization vector (IV) per entry.
   - **Passphrase Mode**: Keys are encrypted using a key derived on the fly via PBKDF2 (SHA-256, 600,000 iterations, 16-byte random salt). The derived key resides strictly in memory for the active session. If you close or reload the browser, an Unlock modal requires your passphrase.
3. **Honest Security Limits**:
   - AES-GCM encryption at rest protects your keys against casual inspection or offline extraction of browser storage files.
   - It **cannot** protect against a physically compromised device, malicious third-party browser extensions with DOM access, or active host malware/keyloggers.

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

