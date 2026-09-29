# CLAUDE.md: Rules for building MontageAI

You are building a Next.js web app that turns gameplay videos into edited vertical montages using **Engine X** pipelines. `PLAN.md` holds the scope, data model, flows and milestones. This file holds the rules. If the two conflict, **this file wins**. Ask before breaking a rule.

## 1. Product principles

- **Simple first.** The target user is a YouTuber with no editing skills. One main page, at most three inputs visible at once, and plain words ("Your in-game name", not "playerName").
- **No dead ends.** Every error tells the user what to do next. Every empty state has one clear action.
- **The server does the work.** The user can close the tab; jobs continue and can be resumed at `/jobs/:id`.
- Don't add features, pages or settings that aren't in `PLAN.md` without asking.

## 2. Stack (don't swap without asking)

Next.js 15 App Router · TypeScript `strict` · Tailwind v4 · shadcn/ui · Drizzle ORM + PostgreSQL · Better Auth (anonymous, email+password, email OTP) · BullMQ + Redis · Nodemailer (SMTP) + React Email · zod · @xyflow/react · Vitest · pnpm. (No automated e2e; the user tests flows manually.)

## 3. Commands

```bash
pnpm dev            # web
pnpm worker:dev     # worker (BullMQ processors + health sweep)
pnpm db:generate    # drizzle migration from schema changes
pnpm db:migrate
pnpm db:seed        # catalog items + settings defaults
pnpm lint && pnpm typecheck && pnpm test   # must pass before you say a task is done
pnpm enginex:smoke  # checks Engine X connectivity and prints pipeline inputs
pnpm admin:create you@example.com   # create/reset an admin account (prints a generated password once)
pnpm catalog:sync   # point catalog items at the pipeline ids in src/db/catalog-seed.ts, creating new styles (validated, audited); run after every publish
```

Run `pnpm lint && pnpm typecheck && pnpm test` after every meaningful change, and fix the failures you caused before moving on.

## 4. Secrets and Engine X (hard rules)

1. `ENGINEX_API_KEY` (an `ek_live_…` production key) and `ENGINEX_BASE_URL` are **server-only**. Read them only in `src/config/env.ts` (zod-parsed) and use them only in `src/server/enginex/client.ts`.
2. Never import `src/server/**` from a client component. Put `import 'server-only'` at the top of every file in `src/server/`.
3. Never log secrets, full signed URLs, or request headers. Redact before logging.
4. **All Engine X calls go through `src/server/enginex/client.ts`**, with typed methods only: `runPipeline`, `getRun`, `cancelRun`, `signOutput`, `createUploadUrl`, `getPipeline`, `fleetStatus`. No `fetch` to Engine X anywhere else. The API is REST at `ENGINEX_BASE_URL` (`https://enginex.run`; the reference is `/v1/api.md`, and `/v1/openapi.json` needs no auth). `enginex.fapi.run` is its MinIO object store, not the API. `runPipeline` sends the job id as `Idempotency-Key`, and timeouts and cancels call `cancelRun` so compute stops.
5. The client wraps every call with a timeout (default 30 s), up to 3 retries with exponential backoff on network or 5xx errors (the client never retries `runPipeline`), and typed errors (`EngineXError { code, message, retryable }`). Only the worker may re-send `runPipeline`, only after a network/5xx error, and only with the same `Idempotency-Key` (the job id), so Engine X returns the existing run instead of starting a second one.
6. **Never hardcode template IDs** in app code. They live in `catalog_items.templateId` (seeded in `src/db/seed.ts`). The app resolves the template ID from the catalog **at job start** and snapshots it on the job row.
7. Never store signed URLs. Call `signOutput` whenever a download or preview is requested (expiry ≤ 1 h).
8. Engine X step names, raw errors and pipeline internals are **admin-only**. Users see friendly stage labels from `stageMap` and a friendly error.
9. The app never modifies Engine X pipelines. Pipeline edits go through the dev tool `pnpm enginex:pipeline` (get → edit the JSON in `.pipelines/` → validate → save → publish), run deliberately with the user's approval of each change; record what changed in `docs/enginex-requests.md`. This script is the only code outside `client.ts` that calls Engine X. It can also read runs and jobs, start a run of a published pipeline (`start`, for analysis such as edit-analyzer on a reference edit) and download an output (`fetch`, never printing the signed URL). Edit styles are specified in `docs/edit-styles/` (read those before building or changing a style pipeline). Pipeline definitions live in `pipelines/` (built by `pipelines/build.py`, checked by `pipelines/check.py`); change them there, never by hand-editing a copy.

## 5. Money, credits and time

- Money is an **integer number of paise** (`amountPaise`). Time is an **integer number of milliseconds** (`runMs`). No floats for money or credits, ever.
- Credits are integers. Each catalog item has a **fixed price per length** (`catalog_items.prices`, e.g. `{"30": 300, "60": 450}`), set by admins. Users always see the exact price before they start.
- `credit_ledger` is **append-only**. Never `UPDATE` or `DELETE` ledger rows. Corrections are new rows.
- Change balances only through `src/server/credits/*`, which, in **one DB transaction**, locks the user's balance row (`SELECT … FOR UPDATE`), inserts the ledger row, and updates `user_balances`.
- The job lifecycle is **charge the fixed price when the job is created → keep it on success → refund it in full on failure, cancel or timeout**. Each step must be idempotent: check for an existing ledger row with the same `jobId` and `kind` first (a unique index backs this up).
- Every job stores `computeCostPaise = ceil(runMs/1000) × settings.costPaisePerSecond` (default 30 = ₹0.30/s), even when it fails.
- Unit tests for credits are required: charge and refund, double-refund protection, concurrent charges, and refusal when the balance is too low.

## 6. Auth and access

- `AUTH_MODE` env: `anonymous` (default now) or `full`. Build every auth page, email template and server path now. When `anonymous`, **hide** the sign-in and sign-up entry points, but keep the routes working behind the flag in tests.
- Anonymous users are real Better Auth users (`isAnonymous = true`). On later sign-up or sign-in, **link** the account so jobs and credits move over.
- Email OTP rules: 6 digits, 10-minute expiry, a maximum of 5 attempts, a 60 s resend cooldown, hashed at rest, and single use.
- Passwords follow Better Auth defaults (hashed, minimum 8 characters). Never write your own crypto.
- **Every `/admin` route and admin server action calls `requireAdmin()`**, in both auth modes. Admin means a real, non-anonymous user with `role = 'admin'`. Bootstrap admins with `ADMIN_EMAILS`.
- Every admin mutation writes `admin_audit_log` (who, what, target, before, after).
- Suspended users can't start jobs; show a friendly message.
- Rate-limit through Redis: anonymous user creation per IP, job starts per user, OTP sends per email and IP, and admin login attempts.
- Every auth flow is a server action (`src/app/(auth)/actions.ts`, admin sign-in in `src/app/admin/actions.ts`) that applies these limits, then calls `auth.api.*`. The Better Auth HTTP endpoints stay closed except `POST /sign-out`; don't open more. (Google sign-in was dropped by the user on 2026-09-26: email + password only.)
- The worker runs under `tsx`, which compiles JSX the classic way; keep `.tsx` files (e.g. email templates) off its import path, or load them with `await import()` only where they're used.

## 7. Server code conventions

- Mutations are server actions or route handlers, and every input is parsed with a **zod** schema first. Reject unknown keys.
- Server actions return `{ ok: true, data } | { ok: false, error: { code, message } }`. Don't throw raw errors to the client.
- Long work belongs in the **worker**, never in a request. Requests enqueue and return within 2 s.
- The worker is restart-safe. Write `runId` to the job row immediately after `runPipeline`, never start a second run for a job that already has one, and on boot resume polling all `running` jobs.
- Poll Engine X every 5 s, backing off to 10 s after 5 min. Write `job_events` only on stage changes or milestones, not every poll.
- Validate uploads by MIME type and extension (mp4/mov/mkv/webm), with the size limit taken from `settings.maxUploadMb`.
- Validate URLs with zod: `https` only, and an allowlist of hosts (YouTube by default). Never fetch user-supplied URLs from the web server.
- Catalog `inputMap` supports only `$source.url`, `$fields.<name>[.<sub>]`, `$durationSec`, and literals. **Never use `eval`, `new Function`, or template-string code execution.**
- Use `snake_case` in the DB and `camelCase` in TypeScript (Drizzle handles the mapping). Every schema change is a migration.

## 8. UI rules

- **Look:** match the reference health screenshot. A near-black background (`#0a0a0a`), panels one step lighter (`#111`), 1px borders `#1f1f1f`, white primary text, grey secondary text `#8a8a8a`, **red accent** for primary actions and "down" (`#e5484d`), green for "up" (`#2f9e44`), amber for "degraded" (`#f5a524`). Use Inter for UI text and a monospace font for numbers and latencies. Define these as CSS variables in `globals.css` and use the tokens, never raw hex, in components.
- Dark theme by default. Keep contrast at WCAG AA or better.
- Use shadcn/ui components before building custom ones.
- Mobile-first: the Create, Progress and Result pages must work at 360 px wide with no horizontal scroll.
- One primary button per screen. The user flow is Create → Progress → Result, and the URL is the source of truth (`/jobs/:id`).
- Show numbers the user cares about (kills found, video length, credits). Hide internal terms (template, pipeline, step, runId) from users.
- Every async action has a loading state, a disabled state and an error state.
- Accessibility: labels on every input, visible focus rings, keyboard-reachable controls, and `aria-live` for progress updates.
- **Premium comes from restraint:** one memorable element per screen (on the user side, the 9:16 preview frame and the live stage readout), with everything around it quiet. No gradient washes, no identical card grids, no entrance animation on every section, and no all-caps eyebrow labels. Sentence-case copy, and buttons named for what they do ("Make my montage", then "Download").
- **Motion:** only in response to the user or to show progress changing. Use CSS transitions on `transform`/`opacity` only (the progress bar uses `scaleX`, not `width`), 150–250 ms, and turn it off under `prefers-reduced-motion`. No animation library.

### 8.1 Speed budgets (checked with `next build` output and Lighthouse mobile)

- User routes (`/`, `/jobs/[id]`, `/library`): first-load JS ≤ 135 KB gzip (React 19 + Next 15 baseline is ~115 KB), LCP < 2.0 s, CLS < 0.05, INP < 200 ms on a mid-range phone over 4G.
- Server Components by default. Put `'use client'` only on interactive leaves (the create form, progress stream, video player). Never make a whole page a client component.
- Load fonts with `next/font` (self-hosted, `display: swap`, subset). No font or CSS requests to third parties.
- React Flow and admin charts load through `next/dynamic`, only on `/admin` routes. They must never appear in a user-route bundle.
- Every route segment gets a `loading.tsx` skeleton with the same dimensions as the final layout, so there's no layout shift.
- The Generate button responds instantly: a React form action (`useActionState` + server action) shows the pending state, works before hydration, and redirects to `/jobs/:id`, which renders its first frame on the server from the DB (no client fetch waterfall).
- Video: `preload="metadata"`, a fixed 9:16 aspect box before load, and no autoplay with sound.
- Images use `next/image` with explicit sizes. No hero images on the user side; the product is the form.

## 9. Service health

- Put each probe in its own file in `src/server/health/probes/`, exporting `{ id, name, tier, critical, run(): Promise<ProbeResult> }`.
- A probe must finish within 5 s (a timeout means `down`) and must not send real emails, create real payments or start pipelines.
- A missing configuration returns `not_configured`, not `down`. Fleet uptime is worst-of across `critical` probes only.
- Only probe what the app uses. Engine worker probes come from the engines in enabled catalog pipelines (read from their graphs). Add SMTP and Razorpay probes when those features ship (M10, M12).
- The worker runs the sweep every 30 s and keeps a heartbeat key in Redis (`worker:heartbeat`, 60 s TTL).

## 10. Testing

- **Unit (Vitest):** credits, catalog `mapInput`, `stageFor`, progress math, uptime bucketing, OTP rules, and the zod schemas.
- **Integration:** a mock Engine X adapter (`src/server/enginex/mock.ts`, selected by `ENGINEX_MODE=mock`) that simulates run progress, success, failure and timeout. CI never calls the real Engine X.
- **E2E:** none automated. The user tests flows manually. At the end of each milestone, list the manual checks in `docs/progress.md`: the happy path in anonymous mode (mock Engine X), a failed job with refund, an admin credit adjustment, a catalog template swap, and full-auth sign-up with OTP.
- Add a build check that fails if `ENGINEX_API_KEY`, `ek_live` or `RAZORPAY_KEY_SECRET` appears in `.next/static`.

## 11. Working style

- Work milestone by milestone as ordered in `PLAN.md` §8. At the end of each one, update `docs/progress.md`: what was done, how to demo it, and open issues.
- Keep changes small and focused, and don't mix refactors with features.
- If something in `PLAN.md` is unclear or seems wrong (for example, an Engine X API path you can't confirm), **stop and ask** instead of guessing. Never invent Engine X endpoints, and confirm them with `pnpm enginex:smoke` or the docs.
- Don't add dependencies beyond the stack without saying why in the PR or commit message.
- Never commit `.env*` files except `.env.example`, which must list every variable with a comment.

## 12. Skills to use (load them before the work, not after)

| When | Skill | What it's for |
|---|---|---|
| Starting any milestone | `feature-dev:feature-dev` | Explore, plan the architecture, then build |
| Before writing tokens (M1) or any new screen (M6–M9, auth pages) | `frontend-design:frontend-design` | Design plan (tokens, type scale, layout wireframe), checked against the rules in §8 before coding |
| Admin Overview KPIs, cost report, uptime bar strip, health graph (M7–M9) | `dataviz` | Stat tiles, chart colors that fit the status tokens, legends and tooltips |
| After each UI change | none (manual) | Tell the user what to check at 360 px and 1280 px; they test in the browser |
| Before calling a milestone done | `code-review`, then `simplify` | Correctness first, then cleanup |
| Milestones touching secrets, auth, credits or uploads (M2, M4, M6, M10, M12) | `security-review` | Verifies the §4 and §6 rules hold |
| End of each milestone | `claude-md-management:revise-claude-md` | Record new learnings here |
| Only if designs exist in Figma | `figma:figma-design-to-code` | Needs the Figma connector authorized first |

## 13. Environment variables (`.env.example`)

```bash
# App
APP_URL=http://localhost:3000
AUTH_MODE=anonymous            # anonymous | full
ADMIN_EMAILS=you@example.com
BETTER_AUTH_SECRET=
DATABASE_URL=postgres://...
REDIS_URL=redis://...
TRUSTED_PROXY_HOPS=1           # proxies in front of the app; client IP = Nth entry from the right of X-Forwarded-For

# Engine X (server-only)
ENGINEX_MODE=live              # live | mock
ENGINEX_BASE_URL=https://enginex.run
ENGINEX_API_KEY=               # ek_live_... never expose to the client
ENGINEX_STORAGE_URL=           # Engine X object store (MinIO), used by the health check

# SMTP (OTP + notifications)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=                     # SMTP_PASSWORD also accepted
SMTP_FROM="MontageAI <no-reply@example.com>"

# Payments (later)
PAYMENTS_ENABLED=false
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```
