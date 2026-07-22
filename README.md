# Refine Text — AI Message Polisher

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=nextdotjs&logoColor=white)](
https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](
https://www.typescriptlang.org/)
[![Gemini API](https://img.shields.io/badge/Gemini-API-green?logo=google&logoColor=white)](
https://ai.google.dev/)
[![SSE Streaming](https://img.shields.io/badge/SSE-Streaming-orange?logo=server&logoColor=white)](
https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
[![Vercel Ready](https://img.shields.io/badge/Vercel-Ready-black?logo=vercel&logoColor=white)](
https://vercel.com/)

**Refine Text** turns rough, messy messages into polished prose — in real time. Pick a tone, send your text, and watch the refined version stream word-by-word directly from the model.

---

## What it does

Most writing assistants ask you to prompt, retry, and copy-paste. Refine Text removes that friction:

- **Type your draft.** Paste or type messy text in the input panel.
- **Tune the tone.** Slide formality and friendliness to get exactly the voice you need.
- **Watch it refine.** The polished message streams in token-by-token — no waiting for the full response.
- **Copy and go.** One click to copy the result to your clipboard.

It works entirely client-to-server with a single `POST /api/draft` call. No database, no auth, no separate backend service.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.5 |
| AI | Google Gemini API (`@google/generative-ai`) |
| Transport | Server-Sent Events (SSE) over Fetch Streams |
| Styling | Tailwind CSS 4 with CSS custom properties |
| Deployment | Vercel-ready |

---

## Features

### Real-time streaming output

Instead of waiting for the full generation, tokens arrive one-by-one. The UI appends them as they stream, with a blinking caret to reinforce the live feel.

### Adjustable tone

Two range sliders control the rewrite behavior:

- **Formality** — from casual slang to formal business writing (1–10)
- **Friendliness** — from direct and terse to warm and empathetic (1–10)

The backend converts these scores into a deterministic system prompt for every generation.

### Model fallback with graceful degradation

The backend tries free-tier Gemini models in sequence:

```
gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.5-pro → gemini-1.5-flash → gemini-1.5-flash-8b
```

If one model hits a quota limit (429), it backs off and retries the next. Each switch is surfaced in the UI so you know what happened — only after exhausting every option does it show an error.

### Abort support

Streaming can be stopped mid-generation with the **Stop** button, which uses `AbortController` to cancel the in-flight request cleanly.

### Copy to clipboard

A **Copy** button copies the refined text to the clipboard with a transient "Copied!" confirmation.

### Fully responsive

The two-panel layout stacks vertically on mobile, with touch-friendly slider thumbs and full-width buttons.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Vercel (Next.js)                                       │
│                                                          │
│  ┌──────────────┐  POST /api/draft (JSON)  ┌──────────┐ │
│  │  React UI    │ ────────────────────────▶│ Route    │ │
│  │  (page.tsx)  │   SSE: chunk / status    │ Handler  │ │
│  │              │   ◀──────────────────────│ (route.  │ │
│  │  fetch +     │                          │   ts)    │ │
│  │  getReader() │                          └────┬─────┘ │
│  └──────────────┘                               │       │
│                                                  │       │
│                                            Google Gemini
│                                            SDK / API
└──────────────────────────────────────────────────────────┘
```

1. The client sends `POST /api/draft` with the input text and slider scores.
2. The Route Handler validates the request, then opens a `text/event-stream` response.
3. For every token the model generates, the handler writes `event: chunk\ndata: {"text":"…"}\n\n`.
4. The client parses the raw `response.body` stream and appends chunks to React state.

### SSE event contract

| event | data | meaning |
|---|---|---|
| `chunk` | `{"text":"…"}` | A streamed piece of the result |
| `status` | `{"message":"…"}` | e.g., "switching to gemini-2.5-flash-lite…" |
| `done` | `{"ok":true}` | Stream finished successfully |
| `error` | `{"message":"…"}` | Terminal error (including quota exhaustion) |

---

## Project structure

```
text-refining/
├── README.md
└── frontend/
    ├── app/
    │   ├── api/
    │   │   └── draft/
    │   │       └── route.ts           ← Backend: SSE + Gemini streaming
    │   ├── layout.tsx                 ← HTML shell + metadata
    │   ├── page.tsx                   ← Root page
    │   ├── globals.css                ← Tailwind + CSS custom properties
    │   ├── RefinePanel.tsx            ← Main client orchestrator
    │   └── components/
    │       ├── InputPanel.tsx         ← Textarea, sliders, submit/stop
    │       ├── ToneSlider.tsx         ← Reusable formality/friendliness slider
    │       └── OutputPanel.tsx        ← Streaming output, copy, meta
    ├── lib/
    │   ├── sseClient.ts               ← Fetch-streams SSE parser
    │   └── useClipboard.ts            ← Copy helper with fallback
    ├── package.json
    ├── tsconfig.json
    ├── next.config.mjs
    └── postcss.config.mjs
```

---

## Key files

### `app/api/draft/route.ts`

The single API route that powers the whole app. It:

- Accepts `POST` with JSON body `{ text, formality, friendliness }`.
- Validates input (returns `400` with `{"error":"…"}` for bad requests).
- Builds a system prompt from the slider scores via `buildSystemPrompt`.
- Streams output by iterating `GoogleGenerativeAI` model calls with fallback.
- Returns a `ReadableStream` that emits framed SSE events.

### `lib/sseClient.ts`

A lightweight, dependency-free SSE client built on Fetch Streams. It handles:

- `POST` requests with JSON bodies.
- Parsing raw `response.body` using the standard `event:` / `data:` framing.
- Re-aggregating partial frames across chunked reads.
- Non-2xx responses (e.g., `400` validation errors).

### `components/ToneSlider.tsx`

A reusable slider component that couples the `<input type="range">` with a numeric badge and semantic description text that updates based on score range.

### `app/globals.css`

Imports Tailwind CSS v4 and defines the design-system tokens (colors, fonts, caret animation) as CSS custom properties. Tailwind utilities map directly to these tokens.

---

## Development

### Prerequisites

- Node.js 18.17+
- npm
- A Google Gemini API key ([get one here](https://aistudio.google.com/app/apikey))

### Install

```bash
cd frontend
cp .env.example .env
```

Add your key:

```env
GEMINI_API_KEY=your-key-here
```

### Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server on `localhost:3000` |
| `npm run build` | Production build (also runs lint + typecheck) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (noEmit) |

---

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Vercel Environment Variables (Secret) | Your Gemini API key. Read server-side by the Route Handler and never exposed to the browser. |

Set it locally in `.env` (never commit this file). For production, add it in the Vercel dashboard.

---

## Deploy to Vercel

1. Push the repository to GitHub.
2. Go to [Vercel](https://vercel.com) → **Add New** → **Project** → import your repo.
3. Set **Root Directory** to `frontend`.
4. In **Environment Variables**, add:
   - `GEMINI_API_KEY` → your API key (mark as **Secret**)
   - Toggle **Production + Preview** on so it propagates to both environments.
5. Click **Deploy**.

No `vercel.json`, no separate backend service, no Dockerfile. One command and you're live.

---

## Error handling & UX

- **Rate limiting (429) + fallback:** When a free-tier model hits its quota, the backend surfaces a `status` event describing the switch, waits briefly, and retries the next model. The user sees this as a soft notice, not a hard failure.
- **Loading states:** The input, sliders, and main action button are disabled during streaming. A **Stop** button replaces **Refine** so you can abort at any time.
- **Copy feedback:** The copy button shows a transient "Copied!" label after a successful write.
- **Typing effect:** Streamed chunks append to the React state as they arrive. A CSS-animated caret blinks while the stream is active.

---

## Contributing

Issues and pull requests are welcome.

1. Fork the repo.
2. Create a feature branch: `git checkout -b feature/my-change`
3. Commit your changes: `git commit -m "Add my change"`
4. Push to your fork: `git push origin feature/my-change`
5. Open a pull request.

Please keep the existing code style (two-space indentation, named exports for components), and make sure `npm run typecheck` passes before submitting.

---

## Roadmap

- ✨ **History panel** — show recent refinement runs in-session.
- ✨ **Prompt presets** — let users save and re-use slider configurations.
- ✨ **Diff view** — highlight exactly what changed between input and output.
- ✨ **Multi-model comparison** — show side-by-side results from different models.
- ✨ **Export** — download refined text as Markdown or plain text.

---

## License

MIT
