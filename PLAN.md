# MontageAI: Build Plan

> Working name only. Rename it anywhere, since the brand lives in one config file (`src/config/brand.ts`).

A simple web app for YouTubers who can't afford an editor. They paste a gameplay URL (or upload a file), pick an edit style, and get a finished vertical montage they can download. Engine X pipelines do all the editing. This app handles the flow, the credits, and the admin side.

Read `CLAUDE.md` first. It holds the rules this plan assumes.

---

## 0. What is already built (outside this repo)

The editing runs on **Engine X**, a pipeline engine with ytdlp, ffmpeg, OCR, WhisperX, vLLM and other workers. Pipelines are saved as templates with IDs:

| Catalog item | Template ID | Status | Inputs today | Outputs |
|---|---|---|---|---|
| Kill Montage | `tpl_QUL4sc1xbOWL` | Stable | `youtubeUrl`, `playerName` (confirm the full list with `get_pipeline`) | `montage` (object key), `clips`, `totalKills`, `title` |
| Lyrical Kill Montage | `tpl_fgi2j31DHK_M` | Beta | `youtubeUrl`, `playerName`, `songUrl`, `songStart`, `songEnd`, `lyricsLrc` (optional) | `montage`, `plan`, `clips`, `totalKills`, `lyricWords`, `title` |

These Engine X operations are used, all server-side:

- `run_pipeline(id, input)` returns a `runId`.
- `get_run(runId)` returns `status`, `steps[] {step, engine, status, error}`, `output`, `error` and `runMs`.
- `sign_output(keys[], expiresSec)` returns short-lived download URLs.
- `create_upload_url()` returns a presigned URL and object key for uploads.
- `get_pipeline(id)` returns the graph, its input nodes, and whether it compiles. Use it to validate template IDs in the admin.
- `fleet_status()` returns which engines have live workers, for the health page.

> **Transport:** Engine X is reachable today as an MCP server (the `.mcpb` extension). Build one adapter, `src/server/enginex/client.ts`, that exposes the operations above. If Engine X documents a REST API, call it with `fetch`. If not, use `@modelcontextprotocol/sdk`'s HTTP client to call the same tools. The rest of the app must only use the adapter. Credentials come from `ENGINEX_BASE_URL` and `ENGINEX_API_KEY`.

---

## 1. Product scope

### 1.1 User side (one main page, three states)

**State A: Create**

1. **Source:** a single field that takes a YouTube URL, with an "or upload a file" drop zone (mp4/mov/mkv, max size set in config).
2. **Edit style:** cards from the catalog (Kill Montage, Lyrical Kill Montage). Only `enabled` items show, and a small "Beta" tag appears where it's set.
3. **Options** (they change with the chosen card, driven by the catalog's `fields` definition):
   - Kill Montage: output length **30 / 60 / 90 s** and in-game player name.
   - Lyrical Kill Montage: player name, song URL, song start and end (a range slider capped at 30/60/90 s), and optional LRC lyrics behind an "Advanced" toggle.
4. **Price:** "Costs N credits · you have M" (fixed per style and length). The button is disabled if the balance is too low.
5. **Generate** button.

**State B: Progress**

- A progress bar based on the share of steps completed.
- 4–6 friendly stages, e.g. *Downloading → Reading kill feed → Finding your kills → Planning the edit → Rendering → Done*. They come from the catalog item's `stageMap`, which maps Engine X step-name prefixes to a stage label.
- A collapsible **"Show logs"** panel with timestamped lines ("Rendering started", "Found 35 kills"). Never show raw Engine X errors to users; show a friendly message and keep the raw error for the admin.
- Elapsed time, plus "You can close this tab. We'll keep working." The job keeps going on the server.

**State C: Result**

- A 9:16 video preview player, a **Download** button, and "Make another".
- Stats line: kills found, length, credits charged.
- **My videos:** a simple list of past jobs (per anonymous or signed-in user) with status and a download link while it's valid. Links are re-signed on demand.

### 1.2 Admin side (`/admin`, always requires sign-in with `role = admin`)

| Page | What it does |
|---|---|
| **Overview** | Jobs today, success rate, average generation time, credits used, estimated compute cost (₹), health summary. |
| **Users** | Search and list users; view a user's jobs, credit ledger and balance; suspend or unsuspend; change role. |
| **Credits** | Add or remove credits for a user with a required reason. It writes a ledger entry and never edits a balance directly. |
| **Billing** | Pricing settings (cost per second, sell price per credit, free starter credits); transactions list (Razorpay later); a cost report comparing compute seconds × ₹0.30 against credits charged. |
| **Jobs** | All jobs, filterable by status or catalog item; the raw Engine X steps and errors; actions: refund, retry (creates a new job). |
| **Catalog** | CRUD for catalog items: slug, title, description, template ID, enabled, beta, sort order, allowed durations, `fields`, `inputMap`, `stageMap`. There's a **Validate** button that calls `get_pipeline` and shows the pipeline's inputs and whether it compiles. The change history is kept. |
| **Service health** | A node graph like the reference screenshot (see §6). |

### 1.3 Out of scope for v1

Payments checkout, teams, custom branding per user, and editing pipelines from this app (that's done in Engine X). Build the hooks for payments, not the flow.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript (strict)** | Requested. Server actions and route handlers keep secrets server-side. |
| UI | **Tailwind CSS v4 + shadcn/ui** | Fast and consistent; easy to match the dark look in the screenshot. |
| DB | **PostgreSQL + Drizzle ORM** | Postgres is already in the stack. Drizzle is typed and its migrations are simple. |
| Auth | **Better Auth** | Has Google OAuth, email+password, an **email OTP** plugin, and an **anonymous** plugin, so guests can later link to a real account with their history and credits intact. |
| Jobs / queue | **BullMQ on Redis** | Redis is already running. A separate worker process polls Engine X runs. |
| Email | **Nodemailer over SMTP + React Email templates** | SMTP is already in the stack. |
| Storage | Engine X object store (`create_upload_url`, `sign_output`) | Nothing needs to be stored in this app. |
| Node graph | **@xyflow/react (React Flow)** | Good fit for the health topology. |
| Validation | **zod** | Every server input. |
| Payments (later) | **Razorpay** | Already in the health screenshot. Integrate behind a `PaymentsProvider` interface. |
| Tests | **Vitest** (unit); e2e is manual | |
| Deploy | Docker images, one for `web` and one for `worker`, on the existing cluster | Long polling doesn't suit serverless hosting. |

---

## 3. Architecture

```
Browser ──► Next.js (web)
             ├─ Server Actions / Route Handlers (zod-validated)
             ├─ Better Auth (anonymous now; Google / email+password / OTP ready)
             ├─ SSE endpoint /api/jobs/:id/events  ◄── Redis pub/sub
             └─ Postgres (Drizzle)
                   ▲
Worker (Node) ─────┘
  ├─ queue "job.start"   → (job row + charge created by web) → run_pipeline
  ├─ queue "job.poll"    → get_run every 5–10 s → update steps/progress → publish event
  ├─ on success          → store output key and compute cost
  ├─ on failure          → refund the price → store raw error → friendly message
  └─ cron "health.sweep" every 30 s → run probes → store probe_results
```

**Why a worker:** a run takes minutes, sometimes over 30. The web process only enqueues work and streams status. The worker owns everything that talks to Engine X over time.

**Idempotency:** the worker writes the Engine X `runId` to the job row before doing anything else. On restart it resumes polling any `running` job that has a `runId`. It never starts a second run for the same job.

---

## 4. Data model (Drizzle, Postgres)

Money is always an **integer in paise**. Time is always an **integer in milliseconds**. No floats for either.

```
users                (Better Auth: id, email, name, image, emailVerified, isAnonymous, role['user'|'admin'], suspendedAt, createdAt)
sessions / accounts / verifications   (Better Auth managed)

catalog_items
  id, slug (unique, e.g. 'kill-montage'), title, description,
  templateId, enabled, beta, sortOrder,
  durations int[]            -- e.g. {30,60,90}
  fields jsonb               -- UI form definition (see §5.2)
  inputMap jsonb             -- form field → pipeline input name / transform
  stageMap jsonb             -- [{match:'download', label:'Downloading'}, ...]
  outputKey text             -- output field holding the video key, default 'montage'
  createdAt, updatedAt

catalog_revisions            -- append-only history of catalog edits
  id, catalogItemId, snapshot jsonb, changedBy, createdAt

jobs
  id, userId, catalogItemId,
  catalogSlug, templateId, templateVersion   -- SNAPSHOT at start; never re-read later
  input jsonb                -- exact input sent to run_pipeline
  source ('url'|'upload'), sourceUrl, uploadKey,
  durationSec int,
  status ('queued'|'starting'|'running'|'succeeded'|'failed'|'canceled'),
  runId, stepsTotal, stepsDone, currentStage,
  outputKey, outputMeta jsonb   -- totalKills, title, clips…
  errorPublic text, errorRaw text,
  runMs int, chargedCredits int, computeCostPaise int,
  createdAt, startedAt, finishedAt

job_events                   -- the user-visible log
  id, jobId, level ('info'|'warn'|'error'), message, createdAt

credit_ledger                -- append-only; balance = SUM(delta)
  id, userId, delta int, kind ('grant'|'admin_add'|'admin_remove'|'reserve'|'release'|'charge'|'purchase'|'refund'),
  jobId?, adminId?, reason text, createdAt
user_balances                -- cached balance, updated in the SAME transaction as ledger inserts
  userId pk, balance int, updatedAt

settings                     -- single row or key/value
  costPaisePerSecond int  default 30      -- your Engine X cost (₹0.30/s)
  sellPaisePerCredit int  default null     -- for later checkout
  starterCredits int     default e.g. 600
  maxUploadMb int, maxConcurrentJobsPerUser int

payments (later)             -- id, userId, provider 'razorpay', providerOrderId, amountPaise, credits, status, raw jsonb
probes / probe_results       -- see §6
admin_audit_log              -- every admin mutation: adminId, action, target, before, after, createdAt
```

---

## 5. Core flows

### 5.1 Starting a job

1. Client submits `{ catalogSlug, source, url|uploadKey, durationSec, fields }`.
2. The server action runs these checks:
   - zod validation;
   - the user exists (anonymous is fine) and isn't suspended;
   - the catalog item is enabled and `durationSec` is in `durations`;
   - the user has fewer than `maxConcurrentJobsPerUser` active jobs;
   - the balance covers the estimate.
3. **Charge credits** (one transaction): insert the job with `status='queued'` and a snapshot of `catalogSlug` and `templateId`, insert a ledger row `charge -price`, and update `user_balances`.
4. Enqueue `job.start`. Return `jobId` and redirect to `/jobs/:id`.
5. The worker builds the pipeline input from `inputMap`, calls `run_pipeline`, stores `runId`, sets `running`, and enqueues `job.poll`.

**Uploads:** the browser gets a presigned URL from `create_upload_url` (through a server action) and PUTs the file directly. The current pipelines start with a ytdlp download node, so pass a **signed URL of the uploaded object** as `youtubeUrl`; yt-dlp's generic extractor handles direct mp4 links. **Test this first.** If it fails, add a `videoKey` input to the pipelines, which is Engine X work and not this repo's.

### 5.2 Catalog-driven form (so template swaps need no deploy)

`fields` example for Lyrical Kill Montage:

```json
[
  {"name":"playerName","label":"Your in-game name","type":"text","required":true,"max":32},
  {"name":"songUrl","label":"Song (YouTube link)","type":"url","required":true},
  {"name":"songRange","label":"Part of the song","type":"range","maxFrom":"durationSec"},
  {"name":"lyricsLrc","label":"Lyrics with timestamps (LRC)","type":"textarea","advanced":true}
]
```

`inputMap` example:

```json
{
  "youtubeUrl": "$source.url",
  "playerName": "$fields.playerName",
  "songUrl": "$fields.songUrl",
  "songStart": "$fields.songRange.start",
  "songEnd": "$fields.songRange.end",
  "lyricsLrc": "$fields.lyricsLrc"
}
```

Support a small, explicit set of mapping expressions only: `$source.url`, `$fields.x`, `$fields.x.y`, `$durationSec`, and literals. Don't allow `eval`.

**Changing the template:** an admin edits `templateId` on a catalog item and clicks **Validate**. That calls `get_pipeline`, checks it compiles and is published, and warns if any `inputMap` target is not an input of that pipeline. On save, write a `catalog_revisions` row. New jobs use the new ID immediately. Running jobs keep their snapshot.

> ⚠ **Pipeline gap to close in Engine X:** the Kill Montage pipeline must accept a target length (30/60/90) as an input, e.g. `durationSec`. Confirm with `get_pipeline`. If it isn't there, add it on the Engine X side, then map `"durationSec": "$durationSec"`. Lyrical length is `songEnd - songStart`, so clamp the range to the chosen length in the UI and again on the server.

### 5.3 Progress, logs and results

- The worker polls `get_run` every 5 s (back off to 10 s after 5 minutes).
- Progress = `succeeded + skipped` steps ÷ total steps. Fan-out steps (e.g. `read_feed#123`) count individually, so the bar moves smoothly during OCR.
- Stage = the first `stageMap` entry whose `match` prefix matches the earliest step that is still running.
- On every change, the worker writes `job_events` (only when the stage changes or at milestones, not every poll) and publishes to Redis `job:{id}`. `/api/jobs/:id/events` (SSE) relays it. The client falls back to polling `/api/jobs/:id` every 5 s.
- On success, store `outputKey` and `outputMeta`. The result page calls a server action that runs `sign_output([outputKey], 3600)` **each time**; don't store signed URLs.
- **Timeouts:** if a run exceeds `maxRunMinutes` (setting, default 60), mark the job failed and release the credits.

### 5.4 Credits and pricing

- **Price:** fixed per catalog item and length (`catalog_items.prices`), set in the admin. Shown exactly on the Create page ("Costs 450 credits · you have 600").
- **Charge** when the job is created, in the same transaction as the job row. The button is disabled when the balance is too low.
- **Success:** nothing more to do; the charge stands.
- **Failure, cancel or timeout:** refund the full price. Track `computeCostPaise` for the cost report either way.
- **Your cost:** `computeCostPaise = ceil(runMs/1000) × costPaisePerSecond` (default 30, i.e. ₹0.30/s). Store it per job; the cost report compares it with credits charged to tune prices.
- **Starter credits:** the first time an anonymous user is created, grant `starterCredits`. To reduce abuse, rate-limit anonymous user creation per IP and cap starter grants per IP per day.
- Show users **credits**, not raw seconds or ₹.

> ⚠ **Pricing reality check:** a 12 s Lyrical test run took about 31 min (~1,880 s ≈ **₹564** of compute at ₹0.30/s). Part of that was an extra run sharing the OCR workers, but OCR on the kill feed is the main cost. Before commercial launch, measure `runMs` per catalog item and length, and tune the pipelines (frame sampling every 10 s, fewer OCR calls, GPU OCR). Otherwise a 90 s edit will cost more than users will pay. The cost report in §1.2 exists to track this.

### 5.5 Auth (ready but switched off)

- `AUTH_MODE=anonymous` (now): every visitor silently gets a Better Auth **anonymous** user through a cookie session. Credits and jobs attach to that user.
- `AUTH_MODE=full` (later) turns on:
  - Google sign-in and sign-up;
  - email + password sign-up with **email OTP verification** (a 6-digit code over SMTP, 10-minute expiry, 5 attempts, resend cooldown of 60 s);
  - email + password sign-in and a password reset OTP.
  - On sign-up or sign-in from an anonymous session, **link** the account (the anonymous plugin's `onLinkAccount`) so jobs and credits move over.
- Build all the auth pages and emails now (`/sign-in`, `/sign-up`, `/verify`, `/forgot-password`) and hide the entry points while `AUTH_MODE=anonymous`.
- **Admin always requires a real signed-in account with `role='admin'`**, in any mode. Bootstrap the first admin with `ADMIN_EMAILS` (comma-separated); those emails get `role='admin'` on sign-up or sign-in.

---

## 6. Service health (admin)

A copy of the reference screenshot: a header with the fleet uptime %, a 24 h / 7 d / 90 d toggle, a bar strip of buckets, a node graph, and a side panel with counts.

**Nodes (tiers):**

| Tier | Nodes | Probe |
|---|---|---|
| App | Web console (Next.js), Worker | `/api/health` self-check; worker heartbeat key in Redis (stale after 60 s = down) |
| Data | PostgreSQL, Redis | `SELECT 1`; `PING` |
| Messaging | RabbitMQ (if used) / BullMQ queue | management API or connection check; queue depth |
| Storage | MinIO / S3 (Engine X object store) | HEAD on a canary object, or `create_upload_url` success |
| Mail | SMTP | `transporter.verify()` (no email sent) |
| Engine | Engine X gateway | `fleet_status()` latency and success |
| Engine workers | ytdlp, ffmpeg, OCR, WhisperX, vLLM | from `fleet_status()`: a worker present per engine and tier = up; missing = down |
| Payments | Razorpay | API auth check; **"Not configured"** when keys are absent, and it doesn't count as down |

**Sweep:** every 30 s in the worker. Store `probe_results(probeId, status 'up'|'degraded'|'down'|'not_configured', latencyMs, message, checkedAt)`. Latency above a per-probe threshold counts as `degraded`.

**Uptime:** per bucket (24 h → 96 × 15 min, 7 d → 84 × 2 h, 90 d → 90 × 1 day), a probe is up if at least 99% of checks in the bucket were up. Fleet uptime is worst-of across **critical** probes only; mark each probe `critical: boolean`. That stops a non-critical upstream such as payments from showing the whole fleet at 0.00%, which the current screenshot does.

**UI:** React Flow with custom node components: a status dot, name, tier label and latency. Edges are solid green when healthy and dashed red when the target is down. Clicking a node shows its last 50 checks and error messages in the side panel. It refreshes every 30 s. Keep the retention at 90 days, and roll older raw rows into daily aggregates.

---

## 7. Routes and folders

```
src/
  app/
    (user)/
      page.tsx                 # Create (state A)
      jobs/[id]/page.tsx       # Progress + Result (states B & C)
      library/page.tsx         # My videos
    (auth)/sign-in, sign-up, verify, forgot-password   # built, hidden until AUTH_MODE=full
    admin/
      layout.tsx               # requireAdmin()
      page.tsx                 # Overview
      users/, users/[id]/
      credits/
      billing/
      jobs/, jobs/[id]/
      catalog/, catalog/[id]/
      health/
    api/
      auth/[...all]/route.ts   # Better Auth
      jobs/[id]/route.ts       # GET status
      jobs/[id]/events/route.ts # SSE
      health/route.ts          # self-check
      webhooks/razorpay/route.ts   # stub, returns 501 until enabled
  server/
    enginex/client.ts          # the only place that talks to Engine X
    enginex/types.ts
    catalog/                   # resolve, validate, mapInput, stageFor
    credits/                   # charge, refund, grant, adjust (all transactional)
    jobs/                      # create, cancel, refund, retry
    health/probes/*.ts         # one file per probe
    auth.ts, email/, payments/ (interface + razorpay stub)
  db/ schema.ts, migrations/, seed.ts
  worker/ index.ts, queues.ts, processors/*.ts
  components/ ui/ (shadcn), job/, admin/, health/
  config/ brand.ts, env.ts (zod-parsed env)
```

---

## 8. Build order (milestones)

Each milestone ends with passing tests and a short demo note in `docs/progress.md`.

1. **Scaffold:** Next.js, Tailwind, shadcn, Drizzle, env parsing, Docker Compose (Postgres, Redis), lint, typecheck, Vitest. Add the dark theme tokens that match the screenshot.
2. **Engine X adapter:** typed client with the six operations, retries with backoff, and timeouts. Include a script (`pnpm enginex:smoke`) that calls `fleet_status` and `get_pipeline` for both template IDs and prints their inputs.
3. **DB and seed:** schema, migrations, seed both catalog items with the template IDs from §0, settings defaults.
4. **Auth (anonymous mode) and credits core:** anonymous sessions, starter grant, ledger functions with unit tests (charge/refund, concurrency with `SELECT … FOR UPDATE`).
5. **Worker:** start and poll processors, stage mapping, events, timeouts, resume after restart.
6. **User flow:** the Create page with the catalog-driven form, uploads, Progress with SSE, Result with sign-on-demand, and Library.
7. **Admin (part 1):** admin guard, Users, Credits (adjust with reason), Jobs (refund and retry), audit log.
8. **Admin (part 2):** Catalog CRUD with Validate and revisions; Billing settings and cost report.
9. **Service health:** probes, sweep, uptime aggregation, the React Flow page.
10. **Full auth ready:** Google, email+password, email OTP, reset, account linking. Tested manually with `AUTH_MODE=full` and shipped with `AUTH_MODE=anonymous`.
11. **Hardening:** rate limits, error pages, empty states, mobile layout, basic analytics events, backup notes.
12. **Payments hook (later):** Razorpay order, webhook and credit purchase behind `PAYMENTS_ENABLED`.

---

## 9. Acceptance checklist (v1)

- [ ] A new visitor can paste a URL, pick Kill Montage at 60 s, enter a player name, and get a downloadable 9:16 MP4 without signing in.
- [ ] Closing the tab mid-job and coming back to `/jobs/:id` shows live progress.
- [ ] The fixed price is charged at start and fully refunded on failure. The ledger sums to the balance.
- [ ] Changing a catalog item's template ID in the admin makes the next job use the new pipeline with no deploy. A job already running keeps its old ID.
- [ ] Validate rejects an unknown or unpublished template ID and warns about unmapped inputs.
- [ ] An admin can add or remove credits with a reason, and it shows up in the ledger and audit log.
- [ ] The health page shows every probe with status and latency, and 24 h / 7 d / 90 d uptime. A missing Razorpay key shows "Not configured", not Down.
- [ ] `ENGINEX_API_KEY` never appears in client bundles, logs or API responses (checked by a test that greps the build output).
- [ ] With `AUTH_MODE=full`, Google, email+password and OTP sign-up all work (manual test), and an anonymous user's jobs and credits move to the new account.

---

## 10. Risks and open questions

1. **Compute cost vs. price** (see §5.4). Measure before setting prices.
2. **Kill Montage length input:** it may be missing in the pipeline, so confirm it (§5.2).
3. **Uploads through ytdlp:** check that the signed URL works (§5.1).
4. **YouTube and music rights:** downloading YouTube videos and songs for a paid product carries platform-terms and copyright risk, and users' uploads of montages with commercial songs may get Content ID claims. Get advice before commercial launch, and consider a "use your own audio file" option for Lyrical.
5. **Engine X transport:** REST or MCP. The adapter hides it, but confirm which one before milestone 2.
