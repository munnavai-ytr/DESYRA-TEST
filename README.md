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

## Pages Implemented in Push 1 & 2
- `/`: Home hero with headline, auto-growing chat box (min 3 to ~10 rows), 6 starter prompt chips, round orange send button, character counter, recent projects list from IndexedDB, and BYOK gating modal preserving drafts when no key is configured.
- `/projects`: Grid of saved projects from Dexie IndexedDB with open and delete actions (with accessible confirmation modal and toast notifications).
- `/settings`: Full Bring-Your-Own-Key management (Google Gemini, Groq, OpenRouter, OpenAI, Anthropic, and custom endpoints) with AES-GCM encryption, passphrase protection controls, and danger zone data wipe options.
- `/project/[id]`: Project specification viewer with saved prompt and the "IDE arrives in Push 4" status card.

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

