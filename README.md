# Refine Text — AI Message Polisher

A full-stack portfolio project that rewrites "messy" user input into polished
messages using the **Gemini API**, with **real-time streaming** over
**Server-Sent Events (SSE)**. Tone is controlled by two sliders:

- **Formality** (1 = casual → 10 = formal)
- **Friendliness** (1 = direct → 10 = warm)

| Layer    | Stack                                              |
| -------- | -------------------------------------------------- |
| Backend  | Go, Chi router, Google GenAI SDK (`genai`)         |
| Frontend | Next.js 14 (App Router), React, TypeScript         |
| Stream   | SSE (`text/event-stream`) via `http.Flusher`       |
| AI       | Gemini Free Tier — `gemini-2.0-flash` (+ fallback) |

---

## Architecture

```
┌──────────────┐   POST /draft (JSON)    ┌──────────────────┐
│  Next.js UI  │ ──────────────────────▶ │  Go (Chi)        │
│  (React)     │                         │  /draft handler  │
│              │ ◀────────────────────── │                  │
│  fetch +     │   SSE: event/chunk      │  Gemini SDK      │
│  getReader() │   data: {"text":"…"}    │  GenerateContent │
└──────────────┘                         └──────────────────┘
```

The backend opens an SSE response, calls Gemini's **streaming** API, and for
each model chunk writes `event: chunk\ndata: {"text":"…"}\n\n` to the client,
flushing immediately. The frontend reads the raw `response.body` stream and
parses the SSE framing itself (the native `EventSource` API only supports GET).

### SSE event contract

| event    | data                       | meaning                          |
| -------- | -------------------------- | -------------------------------- |
| `chunk`  | `{"text": "…"}`            | one streamed piece of the result |
| `status` | `{"message": "…"}`         | e.g. "switching to gemini-…" / "via gemini-2.0-flash" |
| `done`   | `{"ok": true}`             | stream finished successfully     |
| `error`  | `{"message": "…"}`         | terminal error (incl. 429)       |

Pre-stream validation errors (400) are returned as a plain JSON
`{"error":"…"}` because SSE headers are not yet committed.

---

## Backend (`/backend`)

Key files:

- `main.go`
  - `freeTierModels` — ordered fallback chain of free-tier Gemini models
    (`gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-1.5-flash`,
    `gemini-1.5-flash-8b`). On a 429 the handler switches to the next model
    instead of retrying the same one.
  - `draftHandler` — SSE engine. Validates input, sets SSE headers, asserts
    `http.Flusher`, streams Gemini chunks, falls back across models on 429,
    relays clean errors.
  - `BuildSystemPrompt` — converts the two scores into an explicit,
    deterministic instruction set with guard-rails (preserve meaning, fix
    grammar, no invented facts).
  - CORS via `github.com/go-chi/cors`: always allows `localhost:3000` and
    appends any origins from `CORS_ORIGINS` (your deployed frontend URL).
  - `.env` is loaded automatically via `github.com/joho/godotenv` (real env
    vars / deployment secrets take precedence).
  - `middleware.Recoverer` + `RequestID` for production hygiene.

### Run

```bash
cd backend
cp .env.example .env        # add your GEMINI_API_KEY
go mod tidy
go run .                    # listens on :8080 (or $PORT)
```

---

## Frontend (`/frontend`)

Key files:

- `lib/sseClient.ts` — typed, dependency-free SSE client over Fetch Streams
  (POST + JSON body, which `EventSource` cannot do).
- `lib/useClipboard.ts` — secure-context clipboard hook with fallback.
- `app/RefinePanel.tsx` — main component: textarea, two range sliders,
  streaming output with a blinking caret "typing" effect, loading/disabled
  states, Stop (abort) button, and Copy-to-Clipboard.
- `app/globals.css` — dark, responsive two-column layout.

### Run

```bash
cd frontend
cp .env.example .env        # NEXT_PUBLIC_API_URL (defaults to :8080/draft)
npm install
npm run dev                 # http://localhost:3000
```

---

## Error handling & UX highlights

- **Rate limiting (429) + model fallback:** the backend inspects the SDK error
  string for `429` / `rate limit` / `quota` / `exhausted`. On a rate limit it
  advances to the next model in `freeTierModels` (with a short backoff and a
  `status` event naming the switch) rather than retrying the same model. Only
  after exhausting the whole chain does it send a friendly `error` event. The
  frontend surfaces status/errors in banners; a successful stream reports which
  model answered via a `status: "via <model>"` event.
- **Loading states:** all inputs, sliders, and the Refine button are disabled
  (`disabled={streaming}`) while a stream is active; a `Stop` button aborts via
  `AbortController`.
- **Copy to clipboard:** uses `navigator.clipboard` with a `document.execCommand`
  fallback for insecure contexts; shows a transient "Copied!" state.
- **Typing effect:** chunks are appended to React state as they arrive; a CSS
  caret blinks while `streaming` is true.

---

## Deployment

This is a monorepo deployed as two services (full steps in [`DEPLOY.md`](./DEPLOY.md)):

| Service  | Platform | Config file     | Notes                                        |
| -------- | -------- | --------------- | -------------------------------------------- |
| Backend  | Render   | `render.yaml`   | Go web service, free tier, `rootDir: backend` |
| Frontend | Vercel   | `vercel.json`   | Next.js, `rootDirectory: frontend`           |

**Backend (Render):** connect the GitHub repo as a Blueprint; Render builds
`go build -o refine-text .` and runs `./refine-text`. Set `GEMINI_API_KEY`
(secret) and `CORS_ORIGINS` (your Vercel URL) in the dashboard. `PORT` is
provided by Render; `GO_VERSION` is pinned to `1.23`. Health check at `/health`.

**Frontend (Vercel):** import the repo, set root directory `frontend`, and set
`NEXT_PUBLIC_API_URL` to `https://<your-render-url>/draft`. This variable is
inlined at build time, so a change requires a redeploy.

Local dev is unchanged: `cp .env.example .env` in each folder, then
`go run .` (`:8080`) and `npm run dev` (`:3000`).

---

## Notes for recruiters

- Backend compiles with `go build` / `go vet` clean; frontend passes
  `tsc --noEmit` and `next build`.
- Ships to production via IaC: `render.yaml` (Render) + `vercel.json` (Vercel).
- No secrets are committed; configuration is environment-driven (`.env` loaded
  via godotenv locally, dashboard env vars in production).
- Resilient to free-tier limits: automatic model fallback across a chain of
  Gemini free-tier models on 429.
- The SSE framing is standards-compliant (`event:`/`data:` + blank line) and
  survives proxy buffering (`X-Accel-Buffering: no`).
