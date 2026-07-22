# Refine Text — AI Message Polisher

A Next.js application that rewrites "messy" user input into polished messages
using the **Gemini API**, with **real-time streaming** over
**Server-Sent Events (SSE)**. Tone is controlled by two sliders:

- **Formality** (1 = casual → 10 = formal)
- **Friendliness** (1 = direct → 10 = warm)

| Layer    | Stack                                                      |
| -------- | ---------------------------------------------------------- |
| Fullstack| Next.js 14 App Router, React, TypeScript                   |
| Backend  | Next.js Route Handlers (`app/api/draft/route.ts`)          |
| Stream   | SSE (`text/event-stream`) via Web `ReadableStream`         |
| AI       | Gemini Free Tier — `gemini-2.5-flash` (+ fallback chain)   |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vercel (Next.js)                                      │
│                                                         │
│  ┌──────────────┐   POST /api/draft (JSON)  ┌────────┐ │
│  │  React UI    │ ───────────────────────────▶│ Route  │ │
│  │  (page.tsx)  │                            │Handler │ │
│  │              │   SSE: event/chunk          │(route.│ │
│  │  fetch +     │   data: {"text":"…"}        │ ts)   │ │
│  │  getReader() │   ◀─────────────────────────│       │ │
│  └──────────────┘                             └───┬───┘ │
│                                                  │     │
│                                            Google │ GenAI│
│                                            SDK   │     │
└─────────────────────────────────────────────────────────┘
```

The Route Handler opens an SSE response, calls Gemini's streaming API, and for
each model chunk writes `event: chunk\ndata: {"text":"…"}\n\n` to the client,
flushing immediately. The frontend reads the raw `response.body` stream and
parses the SSE framing itself.

### SSE event contract

| event    | data                       | meaning                          |
| -------- | -------------------------- | -------------------------------- |
| `chunk`  | `{"text": "…"}`            | one streamed piece of the result |
| `status` | `{"message": "…"}`         | e.g. "switching to gemini-…" / "via gemini-2.5-flash" |
| `done`   | `{"ok": true}`             | stream finished successfully     |
| `error`  | `{"message": "…"}`         | terminal error (incl. 429)       |

### Model fallback chain

The backend iterates through a list of free-tier Gemini models. On a 429
(rate limit / quota) error from one model, it waits briefly and switches to
the next instead of retrying the same model.

```
gemini-2.5-flash → gemini-2.0-flash-lite → gemini-1.5-flash → gemini-1.5-flash-8b
```

Only after exhausting all models does it return a user-facing error.

---

## Project structure

```
text-refining/
├── frontend/
│   ├── app/
│   │   ├── api/
│   │   │   └── draft/
│   │   │       └── route.ts           ← backend logic (SSE + Gemini)
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx
│   │   └── RefinePanel.tsx
│   ├── lib/
│   │   ├── sseClient.ts               ← fetch-streams SSE parser
│   │   └── useClipboard.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.mjs
└── README.md
```

---

## Key files

### `app/api/draft/route.ts`

Replaces the previous Go backend. Implements:

- `POST` handler — validates input, returns 400 with `{"error":"…"}` for bad
  requests, otherwise returns an SSE stream.
- `runStreamWithFallback` — iterates through the free-tier model chain;
  retries the next model on 429 with a small backoff; relays clean errors.
- `BuildSystemPrompt` — converts the two slider scores into a deterministic,
  explicit instruction set for Gemini.

The handler reads `process.env.GEMINI_API_KEY` directly using Vercel server
environment variables (no `NEXT_PUBLIC_*` needed since this runs server-side).

### `app/RefinePanel.tsx`

Client component: textarea, two range sliders, streamed output with a blinking
caret "typing" effect, loading/disabled states, Stop (abort) button, and
Copy-to-Clipboard.

Post requests go to `/api/draft` (same-origin; no external backend URL
configured at all).

### `lib/sseClient.ts`

Typed, dependency-free SSE client over Fetch Streams (POST with JSON body).
Parses the raw `response.body` stream using the standard SSE `event:` / `data:`
frame separator.

---

## Environment variables

| Variable           | Where set       | Purpose                                  |
| ------------------ | --------------- | ---------------------------------------- |
| `GEMINI_API_KEY`   | Vercel dashboard (secret) | Your Gemini API key. Required. Required. |

Set `GEMINI_API_KEY` in the Vercel project settings under **Environment
Variables** (mark it as a secret). It is read server-side by the Route Handler
and is never exposed to the browser.

---

## Run locally

```bash
cd frontend
cp .env.example .env        # add your GEMINI_API_KEY
npm install
npm run dev                 # http://localhost:3000
```

No separate Go backend is needed — `npm run dev` serves both the page and
`/api/draft` from the same process.

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. Go to **vercel.com** → *Add New* → *Project* → import your repo.
3. Root directory: `frontend`.
4. In **Environment Variables**, add:
   - `GEMINI_API_KEY` → your key (mark as secret)
   - Keep **Production + Preview** checked.
5. Deploy.

That's it. No `vercel.json`, no `render.yaml`, no separate backend service.

---

## Error handling & UX

- **Rate limiting (429) + model fallback:** on a 429 the backend walks the
  `FREE_TIER_MODELS` list with a small backoff; each switch is surfaced as a
  `status` event in the UI. Only after exhausting all models does it send an
  `error` event.
- **Loading states:** all inputs, sliders, and the Refine button are disabled
  while a stream is active; a `Stop` button aborts via `AbortController`.
- **Copy to clipboard:** uses `navigator.clipboard` with a `document.execCommand`
  fallback for insecure contexts; shows a transient "Copied!" state.
- **Typing effect:** chunks are appended to React state as they arrive; a CSS
  caret blinks while `streaming` is true.
