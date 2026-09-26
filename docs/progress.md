# Progress

## Milestone 1: Scaffold (done 2026-09-26)

**Done**
- Next.js 15.5 (App Router, Turbopack), TypeScript strict, Tailwind v4, shadcn/ui (base-nova style, Base UI primitives), pnpm.
- Dark theme tokens in `src/app/globals.css` following CLAUDE.md §8. Filled buttons use `--accent-strong` (`#d13438`) because white on `#e5484d` is only 3.9:1 (fails AA); `#e5484d` stays the accent for text, dots and "down".
- Buttons are 44 px tall on mobile (40 px from `sm`) for touch targets; form fields are at least 16 px so iOS doesn't zoom.
- Fonts: Inter + Geist Mono via `next/font` (self-hosted).
- `src/config/env.ts`: zod-parsed env, server-only, errors never echo values. `src/config/brand.ts`.
- Drizzle wired (`src/db/index.ts`, `drizzle.config.ts`); tables arrive in M3.
- `docker-compose.yml` for Postgres 17 + Redis 7. `.env.example` lists every variable.
- Vitest (env tests). `pnpm check:secrets` greps `.next/static` for secret names.
- Automated e2e dropped at the user's request; flows are tested manually.

**Numbers:** `/` first-load JS 113 KB (budget 130 KB).

**Demo:** `pnpm dev` → http://localhost:3000 shows the placeholder shell.

**Manual checks:** open `/` at 360 px and at desktop width; there should be no horizontal scroll and the heading should wrap cleanly.

**Open issues**
- Engine X transport (REST or MCP) is unconfirmed. M2 starts with `pnpm enginex:smoke`.

## Milestone 2: Engine X adapter (code done; live check pending)

**Done**
- `src/server/enginex/client.ts`: REST client for `https://enginex.run` with `runPipeline`, `getRun`, `cancelRun`, `signOutput`, `createUploadUrl`, `getPipeline`, `fleetStatus`. 30 s timeout, 3 retries with exponential backoff on network/5xx (never on `runPipeline`), typed `EngineXError`, key never in errors.
- `runPipeline` sends the job id as `Idempotency-Key` (Engine X returns the existing run on a repeat).
- `src/server/enginex/mock.ts` (`ENGINEX_MODE=mock`): stateless simulated runs; player name containing "fail" fails at OCR, "timeout" never finishes.
- `pnpm enginex:smoke` prints fleet engines and each catalog pipeline's inputs plus the raw response shape.
- Unit tests: retries, no retry on 4xx/runPipeline, key redaction, normalisers, mock scenarios.

**Open issues**
- The OpenAPI spec doesn't type success bodies, so response parsing is lenient. Run `pnpm enginex:smoke` (live) and tighten `normalise*` from the real output.
- Confirm step names so `stageMap` prefixes match, and whether Kill Montage accepts `durationSec` (PLAN §5.2).

## Milestone 3: DB and seed (done)

**Done**
- `src/db/schema.ts`: Better Auth tables (`users` with `isAnonymous`, `role`, `suspendedAt`), catalog + revisions, jobs + events, credit ledger + balances, settings (single row), admin audit log. Payments and probe tables come with M12 and M9.
- Ledger idempotency is enforced in the DB: unique `(job_id, kind)` where `job_id` is set. A trigger rejects any `UPDATE`/`DELETE` on `credit_ledger`.
- Migrations in `src/db/migrations`; `pnpm db:seed` inserts both catalog items and the settings row (idempotent).

**Demo:** `docker compose up -d && pnpm db:migrate && pnpm db:seed`

**Open issues**
- Better Auth's anonymous plugin deletes the anonymous user after linking; ledger rows reference users, so M10 must move rows in `onLinkAccount` first.

## Milestone 4: Anonymous sessions and credits core (done 2026-09-26)

**Done**
- Better Auth (`src/server/auth.ts`) with the Drizzle adapter on our tables and the anonymous plugin. Route at `/api/auth/*`.
- `ensureUser()` creates an anonymous user lazily, on the visitor's first action (server actions only), so page views and bots create nothing. Limits via Redis: 10 new anonymous users per IP per hour, starter credits for at most 3 per IP per day. The public `/sign-in/anonymous` route is closed so it can't bypass these.
- `src/server/credits`: `grant`, `reserve` (inside the job-creation transaction), `settle` (release + charge by actual `runMs`, rounded up), `release`. Each locks the balance row with `SELECT … FOR UPDATE`; job-scoped entries are idempotent.
- Tests (real Postgres, `montage_test`): full lifecycle, double settle, double release, insufficient balance, concurrent reservations, negative-balance rule, DB refusal of ledger edits.

**Numbers:** 23 unit tests pass. Tests need `docker compose up -d`.

**Manual checks:** none yet (no UI); anonymous sign-in was checked live against `/api/auth`.

**Open issues**
- `disableDeleteAnonymousUser` is on until M10 moves jobs and ledger rows in `onLinkAccount`.

## Milestone 5: Worker (done 2026-09-26)

**Done**
- `src/worker/index.mts` (`pnpm worker:dev`): BullMQ worker. A scheduled sweep every 5 s starts queued jobs and polls running ones (10 s after 5 min). Web can also enqueue `start` for an instant start (`src/server/queue.ts`). Heartbeat `worker:heartbeat` (60 s TTL).
- `src/server/jobs/lifecycle.ts`: start → poll → finish. Every transition is a conditional `UPDATE`, so overlapping sweeps or two workers can't double-start or double-settle. Restart-safe by design: the sweep picks up everything from the DB.
- `runPipeline` uses the job id as `Idempotency-Key`. On a network/5xx error at start the job stays `starting` and the sweep re-sends after 2 min with the same key, which returns the existing run instead of creating one.
- Success: output key, kills, title stored; credits settled by actual `runMs`; `computeCostPaise` stored. Failure/cancel: credits released, raw error kept for admin, friendly message by failing engine (`src/server/jobs/errors.ts`). Timeout (`maxRunMinutes`): run canceled on Engine X, credits released.
- `src/server/catalog`: `mapInput` (strict expression grammar, no eval), `progressOf` (fan-out items count individually), `stageFor`.
- Catalog `stageMap` now uses the real pipeline step ids; the mock uses the same names.

**Numbers:** 40 unit tests pass (credits, lifecycle with mock Engine X, catalog helpers, adapter, env, IP).

**Demo:** `ENGINEX_MODE=mock pnpm worker:dev` (jobs arrive with milestone 6's Create page).

**Open issues**
- Kill Montage has no length input yet: see `docs/enginex-requests.md`.
- Run/sign/upload response bodies are still parsed leniently; confirm on the first real run.

## Pricing change (2026-09-26)

Fixed price per style and length (`catalog_items.prices`), charged when the job is created and refunded in full on failure, cancel or timeout. Estimates, settle-by-runtime and the negative-balance rule are gone. Placeholder prices: Kill Montage 30/60/90 s = 300/450/600 credits (set real ones in the admin). Lyrical is switched off for now.

## Milestone 6: User flow (done 2026-09-26)

**Done**
- **Create** (`/`): YouTube link, in-game name, length (30/60/90). Exact price and balance shown; the button is disabled when short. The style picker only appears when more than one style is enabled. File upload stays hidden until it's tested through Engine X.
- **Progress + Result** (`/jobs/:id`): rendered on the server from the DB, then live over SSE (`/api/jobs/:id/events`, Redis pub/sub), falling back to polling `/api/jobs/:id`. Stages appear as kill-feed rows in a 9:16 frame with a progress bar. On finish: video preview (fresh signed link), Download (fresh link each click), Make another. On failure: friendly message, Try again. Header balance refreshes when the job ends.
- **My videos** (`/library`): past jobs with status; empty state with one action.
- Signature element: an in-game kill feed. On desktop the Create page previews it with the typed player name.
- Form uses a React form action + server action: works before hydration, keeps typed values on errors.
- `createJob` validates (zod strict, YouTube https allowlist, catalog fields), checks suspension, concurrency (`maxConcurrentJobsPerUser`) and a per-user hourly limit, then charges and inserts in one transaction.
- Swapped Base UI Button/Input for native elements and `cn` for `clsx` + `tailwind-merge`: first-load JS 147 KB → 134 KB.

**Numbers:** `/` 134 KB, `/jobs/[id]` 134 KB, `/library` 119 KB first-load JS (budget 135 KB). 48 unit tests pass. No horizontal scroll at 360 px; inputs 16 px; buttons 44–48 px.

**Demo (mock Engine X, no compute cost):**
```bash
docker compose up -d
ENGINEX_MODE=mock pnpm worker:dev
ENGINEX_MODE=mock pnpm dev
```
In mock mode a player name containing "fail" fails at the kill-feed step, and "timeout" never finishes.

**Manual checks**
1. At 360 px and at desktop width: Create fits without horizontal scroll; the Make my montage button stays pinned at the bottom on mobile.
2. Paste a non-YouTube link → error under the field, typed values stay.
3. Happy path: stages appear one by one, then the video plays; Download opens a fresh link; balance drops by the price.
4. Name containing "fail" → friendly error, Try again, balance restored in the header.
5. Close the tab mid-job, reopen `/jobs/:id` → live progress continues.
6. My videos lists every job with the right status.

**Open issues**
- With `ENGINEX_MODE=live`, confirm the run, sign and upload response bodies on the first real run.
- Deploy skew: a tab left open across a deploy gets "Server Action not found". Handle in M11 (stable action encryption key / reload prompt).

## Milestone 7: Admin part 1 (done 2026-09-26)

**Done**
- Admin sign-in at `/admin/sign-in` (email + password, Redis-limited per IP and per email). Public sign-up stays off until M10; create admins with `pnpm admin:create you@example.com` (prints a generated password once). Verified accounts listed in `ADMIN_EMAILS` are promoted on sign-in.
- `requireAdmin()` in the panel layout **and** every page; `currentAdmin()` in every admin action. Both re-read the user row, so demotion or suspension applies immediately (the session cookie cache can be 5 minutes old). `createJob` also re-reads suspension.
- Better Auth POST routes are closed except `/sign-out`; sign-in runs only through rate-limited server actions.
- **Overview:** jobs today, success rate, average run time, credits used, compute cost (₹), today (IST) and 7 days; recent failures with raw errors.
- **Users:** search by email/name/ID, accounts vs guests; user page with balance, ledger, jobs, credit adjustment, suspend, role. Admins can't suspend or demote themselves; guests can't be admins.
- **Credits:** add/remove by email or ID with a required reason; recent grants, adjustments and refunds.
- **Jobs:** filter by status and style; job page with template snapshot, run ID, live Engine X steps, input/output, raw and public errors, events, credit movements. Refund (once, for finished jobs) and retry (new free job, same input, current template).
- **Audit log:** every admin mutation, written in the same transaction, with before/after.

**Numbers:** 55 unit tests pass. Admin pages 128–131 KB first-load JS. No horizontal scroll at 360 px on any admin page.

**Demo:** `pnpm admin:create you@example.com`, then sign in at `/admin/sign-in`.

**Manual checks**
1. `/admin` while signed out → redirected to sign-in. Wrong password → one generic message.
2. Adjust credits (+ and −) with a reason → balance, ledger and audit log all show it; removing more than the balance is refused.
3. Refund a succeeded job → credits back once; a second refund is refused.
4. Retry a failed job → a new free job starts on the current template.
5. Suspend a user → they can't start a montage (friendly message); unsuspend works.

**Open issues**
- No password reset yet (M10); re-run `pnpm admin:create` to reset an admin's password.
