# Deployment

This monorepo deploys as two services:

- **Backend** → [Render](https://render.com) (Go web service, free tier)
- **Frontend** → [Vercel](https://vercel.com) (Next.js, free tier)

```
fullstack-projects/
├── backend/      → Render (Go, serves /draft SSE)
├── frontend/     → Vercel (Next.js, calls the Render URL)
├── render.yaml   → Render Blueprint (IaC)
└── vercel.json   → Vercel project config
```

> Both hosts build from Git. Initialize a Git repo, push to GitHub, then connect
> each platform to that repo (monorepo subfolder per service).

---

## 0. Git setup (one-time)

```bash
cd fullstack-projects
git init
git add .
git commit -m "Initial commit"
gh repo create refine-text --private --source=. --push   # or push to your own remote
```

---

## 1. Backend → Render

1. Go to **render.com** → *New* → *Blueprint*.
2. Connect the GitHub repo. Render reads `render.yaml` and creates the
   `refine-text-backend` web service (rootDir `backend`, free plan).
3. In the service **Environment** tab, set:
   - `GEMINI_API_KEY` — your Gemini API key (mark as secret). **Required.**
   - `CORS_ORIGINS` — your Vercel URL, e.g.
     `https://refine-text-frontend.vercel.app`. Comma-separated for multiple.
   - `GO_VERSION` is pinned to `1.23` in `render.yaml` (must be ≥ `go.mod`).
   - `PORT` is set automatically by Render; the server reads it via
     `os.Getenv("PORT")`.
4. Deploy. Note the generated URL, e.g.
   `https://refine-text-backend.onrender.com`.

Render notes:
- `healthCheckPath: /health` keeps the free instance alive-ish and reports status.
- `startCommand: ./refine-text` runs the binary built by
  `buildCommand: go build -o refine-text .`.
- Free tier spins down after inactivity (~15 min); the first request after that
  is slow. The frontend shows a clean error if the backend is unreachable.

---

## 2. Frontend → Vercel

1. Go to **vercel.com** → *Add New* → *Project* → import the GitHub repo.
2. Configure:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Next.js (auto-detected via `vercel.json`)
   - **Build Command:** `npm run build` (default)
   - **Install Command:** `npm install` (default)
3. Add Environment Variable (Production + Preview):
   - `NEXT_PUBLIC_API_URL` = `https://refine-text-backend.onrender.com/draft`
     (use your real Render URL from step 1).
   - This is inlined at **build time**, so changing it requires a redeploy.
4. Deploy. Vercel gives you a URL like
   `https://refine-text-frontend.vercel.app`.

> `NEXT_PUBLIC_API_URL` is consumed in `frontend/lib/sseClient.ts` and
> `frontend/app/RefinePanel.tsx`. The `.env.example` default
> (`http://localhost:8080/draft`) is only used for local dev.

---

## 3. Wire them together

1. Copy the Vercel URL.
2. In Render, set `CORS_ORIGINS` to that URL (the backend already allows
   `localhost:3000` in code). Redeploy the backend.
3. Open the Vercel URL, type a message, move the sliders, click **Refine**.
   Output streams from Gemini via the Render backend.

---

## 4. Local vs deployed env summary

| Variable              | Backend (Render)        | Frontend (Vercel)              |
| --------------------- | ----------------------- | ------------------------------ |
| `GEMINI_API_KEY`      | required (secret)       | —                              |
| `CORS_ORIGINS`        | Vercel URL (comma list) | —                              |
| `PORT`                | auto (Render)           | —                              |
| `NEXT_PUBLIC_API_URL` | —                       | Render `/draft` URL (build-time)|
| `GO_VERSION`          | `1.23` (pinned)         | —                              |

Local dev: copy `backend/.env.example` → `backend/.env` (add key) and
`frontend/.env.example` → `frontend/.env`. Run `go run .` (`:8080`) and
`npm run dev` (`:3000`).

---

## Troubleshooting

- **CORS error in browser console** → the Vercel origin isn't in Render's
  `CORS_ORIGINS`. Add it and redeploy the backend.
- **`API_KEY_INVALID`** → `GEMINI_API_KEY` on Render is wrong/placeholder.
  Set the real AI Studio key and redeploy.
- **Stream never starts / timeout** → Render free instance spun down. First
  call wakes it; retry after ~30s.
- **Frontend calls localhost in production** → `NEXT_PUBLIC_API_URL` wasn't set
  before build, or you changed it without redeploying (it's build-time inlined).
