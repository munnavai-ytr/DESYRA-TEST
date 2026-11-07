# DESYRA — Premium AI App Builder (Push 6 of 10)

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

## Pages Implemented in Pushes 1 to 5
- `/`: Home hero with headline, auto-growing chat box (min 3 to ~10 rows), 6 starter prompt chips, round orange send button, character counter, recent projects list from IndexedDB, and BYOK gating modal preserving drafts when no key is configured.
- `/projects`: Grid of saved projects from Dexie IndexedDB with open, rename, and delete actions (with accessible confirmation modal and toast notifications).
- `/settings`: Full Bring-Your-Own-Key management (Google Gemini, Groq, OpenRouter, OpenAI, Anthropic, and custom endpoints) with AES-GCM encryption, passphrase protection controls, danger zone data wipe options, live "Test key" verification, and searchable Model Pickers.
- `/project/[id]`: Full-viewport (`100dvh`) IDE workspace with slim TopBar, chat pane, hierarchical file explorer, code editor, and live sandboxed preview frame.

## Live Preview Engine (Push 6)

Push 6 delivers a free, 100% in-browser, zero-backend live preview engine:

1. **Static Web Stack Execution**:
   - Runs HTML + CSS + JavaScript (classic scripts and ES modules with relative imports) and CDN libraries (Tailwind CDN, Alpine.js, Google Fonts, etc.).
   - Transparent, honest unsupported stack detection: If a project contains React/JSX/TSX/Vue/Svelte or `package.json`, DESYRA displays a clear notice with the list of detected files instead of broken rendering.

2. **Security & Sandboxing**:
   - Executes inside an `<iframe>` with strict sandbox attributes: `sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock"`.
   - Never enables `allow-same-origin` or `allow-top-navigation`, isolating preview code from the host application's DOM, cookies, and secrets.
   - Strict `Content-Security-Policy` meta tag injected at the very top of `<head>` allowing designated CDNs (jsdelivr, tailwindcss, unpkg, cdnjs, esm.sh, google fonts) while blocking frame embeds and unauthorized origins.
   - Per-render cryptographic `nonce` ensures that parent/iframe `postMessage` channels validate message provenance.

3. **Injected Runtime & Storage Shims**:
   - **Console Interception**: Overrides `console.log/info/warn/error/debug` with circular-reference safe serialization, line numbers, and auto-scrolling console drawer.
   - **Persistent Preview Storage**: Shims `localStorage` and `sessionStorage` in the sandbox, backed by Dexie IndexedDB (`previewStorage` table, schema v5) with safety quotas: 200 KB per value, 1 MB total per project.
   - **Link Interception**: External links open safely in a new tab (`window.open(..., '_blank', 'noopener')`), hash anchors scroll smoothly into view, and relative `.html` links post navigation events to switch pages within the IDE.

4. **Virtual Responsive Scaling**:
   - Phone (`390px`), Tablet (`768px`), and Desktop (`1280px`).
   - Automatically detects container bounds using `ResizeObserver` and applies smooth CSS transform scaling when the preview container is narrower than the target device, eliminating horizontal scrollbars.

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

5. Run test suite:
   ```bash
   npm test
   ```

## File Protocol

DESYRA establishes a strict streaming contract between the AI model and the application. The model writes real project files using semantic protocol tags instead of markdown code fences:

1. **Create or Replace File (`<desyra-file>`)**:
   ```xml
   <desyra-file path="index.html">
   <!DOCTYPE html>
   <html>
     <body>...</body>
   </html>
   </desyra-file>
   ```
   - Creates a new file or completely replaces an existing one.
   - The streaming parser strips exactly one leading and one trailing newline, preserving all inner content, indentation, and nested HTML tags (`</div>`, code fences, scripts) untouched.

2. **Partial Edit (`<desyra-edit>`)**:
   ```xml
   <desyra-edit path="js/app.js">
   <<<<<<< SEARCH
   const oldCode = true;
   =======
   const newCode = true;
   >>>>>>> REPLACE
   </desyra-edit>
   ```
   - Used for localized modifications (when less than ~30% of a file changes).
   - Contains one or more sequential `SEARCH/REPLACE` blocks.
   - Matches against current stored content: first attempts an exact match, then falls back to whitespace- and newline-tolerant matching. If still unmatched, the file is untouched and a clear retry card is presented to the user.

3. **Delete File (`<desyra-delete>`)**:
   ```xml
   <desyra-delete path="obsolete.js" />
   ```
   - Removes obsolete or replaced files from the project's IndexedDB files store.

Prose outside protocol tags is rendered as Markdown in chat. Protocol tags and file bodies are never displayed as raw prose in chat; instead, compact interactive **File Cards** are rendered.

## How AI Changes Are Applied

1. **Incremental Streaming Parser (`src/lib/ai/fileProtocol.ts`)**:
   - Parses chunks as they arrive over HTTP/SSE.
   - Buffers candidate tag delimiters (`<desyra-...`) so incomplete tag fragments never leak as raw prose.
   - Emits granular lifecycle events: `fileStart`, `fileChunk`, `fileEnd`, `editStart`, `editEnd`, `delete`, `unterminated`, and `protocolError`.

2. **Real-Time Reactive Store & Safe Disk Writes (`src/lib/ai/applyChanges.ts`)**:
   - Every file path is strictly validated against POSIX relative path rules (no leading slash, no traversal `..`, no backslashes, max 200 chars, max 500 files, max 1 MB per file).
   - An in-memory store (`aiFileStore`) tracks files currently "being written by AI" with live buffer updates.
   - Disk writes to IndexedDB are throttled to ~300ms intervals during streaming and flushed definitively on `fileEnd` or stream termination.
   - The CodeEditor upgrades to CodeMirror 6 with the DESYRA dark theme and becomes read-only with a live indicator while DESYRA is writing the active file.
   - In the FileTree, active files display a pulsing orange dot, and modified files show an updated indicator until opened.

3. **Per-Message Undo Safety Net**:
   - Each assistant message records a snapshot of changes: `{ path, action: "created" | "updated" | "deleted", before, after }`.
   - Capped at 1 MB per message to prevent storage exhaustion.
   - Clicking **"Undo changes"** verifies that the current disk content still matches the message's `after` state, restores the `before` version, or skips already-modified files with a descriptive toast explanation.

## Streaming Performance Notes (Push 5.1 Optimization)

In Push 5.1, the streaming execution pipeline was re-architected to be strictly O(new data) rather than O(total message length), eliminating UI lag, stutter, and unresponsive taps on mobile devices:

1. **Ref-Based Raw Stream Storage**:
   - The accumulating raw message stream is kept in a mutable `useRef`, not in React state.
   - React state only holds small, lightweight presentation data: prose text outside tags, and a compact list of operation cards `[{ path, op, status, lineCount }]`.
   - File bodies are never stored in chat React state or re-tokenized during streaming.

2. **Throttled UI Flushes & Provider Chunk Coalescing**:
   - Provider chunks arriving closer than 50ms apart are coalesced in a buffer before reaching the protocol parser.
   - UI state updates are throttled to at most once per 120ms using a combined timer and `requestAnimationFrame`.
   - All streaming UI updates are wrapped in `React.startTransition` so user interactions (scrolling, taps, tab switches) maintain priority.

3. **Incremental Line Counting & Linear Scanning**:
   - Line counts for streaming files are calculated incrementally by counting `\n` characters directly in new chunk slices via `countNewlines`, avoiding `split('\n')` array allocations.
   - The protocol parser operates in linear time over 1 MB+ streams without backtracking or quadratic buffer growth.

4. **Memoized Streaming Prose Blocks**:
   - Completed Markdown prose paragraphs are split and memoized with `React.memo`.
   - Only the active, still-growing paragraph block re-renders as new tokens arrive.

5. **CodeMirror Transaction-Based Incremental Appending**:
   - When the Code tab is visible and the active file is being streamed, CodeMirror receives incremental text appends via `view.dispatch({ changes: { from: doc.length, insert: chunk } })`, throttled to <= 250ms.
   - Full document re-parsing is avoided; if the Code tab is hidden, streaming events are ignored and the complete document is loaded upon opening.

6. **Lightweight File Explorer Metadata**:
   - The file explorer queries `listFileMetas()` which omits full file bodies from memory.
   - In-progress writes to IndexedDB are throttled to 1000ms (with final flush at `fileEnd`).
   - Revision bumps only trigger when the project's file structure (paths) changes, preventing unnecessary tree re-renders.

7. **Defensive HTML-to-Markdown Converter**:
   - Stray HTML tags output by models in explanations are converted into clean Markdown before rendering, while preserving code inside markdown fences.



