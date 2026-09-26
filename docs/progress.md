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

## Milestone 8: Admin part 2 (done 2026-09-26)

**Done**
- **Catalog** (`/admin/catalog`): list, create, edit, delete (only if no job used the item; otherwise switch it off). Edit title, slug, description, template ID, enabled, beta, order, lengths with a price each, and the `fields` / `inputMap` / `stageMap` JSON with strict validation (only supported mapping expressions; `$fields.x` must name a real field).
- **Validate** calls `getPipeline`. Errors (block saving): unknown ID, never published, doesn't compile, a required pipeline input not mapped, output field missing. Warnings: mapped inputs the pipeline doesn't declare, unpublished draft ahead of the published version. Saving re-validates whenever the template, input map or output field changes.
- Every save writes a `catalog_revisions` snapshot and an audit entry; the item page shows the history with which fields changed. New jobs use changes immediately; running jobs keep their snapshot. The Create page updates without a deploy.
- **Billing** (`/admin/billing`): 30-day tiles (compute cost incl. failed runs, credits earned net of refunds, revenue and margin at the sell price), a cost-per-montage table per style and length (median run time, cost per successful montage including failed runs' compute, price, margin), and the pricing/limits settings (audited). Transactions: placeholder until payments (M12).
- Admin forms keep what was typed when an action is refused, and clear after success.

**Numbers:** 68 unit tests pass. Catalog editor 134 KB, other admin pages ≤ 131 KB.

**Manual checks**
1. Catalog → Kill Montage → Validate: with live Engine X it should be valid, with a warning about the unpublished draft.
2. Change a price, save → the Create page shows the new price immediately.
3. Enter a template ID that doesn't exist → Validate and Save both refuse; nothing changes.
4. Billing: set a sell price per credit → revenue and margin columns fill in; negative margins show in red.

**Open issues**
- When Engine X adds `durationSec` to Kill Montage: add `"durationSec": "$durationSec"` to its input map in the catalog editor.

## Milestone 9: Service health (done 2026-09-26)

**Done**
- One probe per file in `src/server/health/probes/`: web (`/api/health`), worker (Redis heartbeat), PostgreSQL, Redis, job queue (BullMQ counts; degraded above 20 waiting), Engine X gateway (authenticated `fleetStatus`), object storage (MinIO `/minio/health/live`, needs `ENGINEX_STORAGE_URL`), and one probe per engine worker.
- Only what the app uses: engine probes are derived from the graphs of enabled catalog pipelines (today ytdlp, ffmpeg, OCR, vLLM; WhisperX appears if Lyrical is switched on). SMTP and Razorpay are left out until they're used.
- Worker runs the sweep every 30 s (5 s timeout per probe, slow = degraded, errors redacted). Raw results kept 8 days; daily rollups kept 90 days.
- Uptime: 24 h = 96 × 15 min, 7 d = 84 × 2 h, 90 d = 90 × 1 day buckets; a bucket is up when ≥ 99% of checks were available. Fleet uptime is the worst of the critical probes.
- `/admin/health`: fleet uptime card with bucket strip, React Flow service map (admin-only chunk; hidden on phones), side panel with summary or a service's last 50 checks, uptime list per service, 24 h / 7 d / 90 d toggle, auto-refresh every 30 s, banner when the worker has stopped.

**Numbers:** 76 unit tests pass. `/admin/health` 134 KB first-load JS (React Flow loads after, on this page only).

**Manual checks**
1. With `pnpm worker:dev` running, `/admin/health` shows every check operational within 30 s.
2. Stop the worker → within a minute the page says checks are paused.
3. Stop Redis (`docker compose stop redis`) → Redis goes down (red, dashed edge), fleet uptime drops. Start it again.
4. Click a node → its recent checks appear in the side panel.

## Health page upgrade (2026-09-26)

- **Live traffic:** dots drift along healthy edges (slower on degraded links, none on broken ones, which stay dashed red). Hidden when the OS asks for reduced motion.
- **Hover details:** service cards (status, latency, uptime for the range, last check, role, last message); every uptime bar shows its time slot, status and check counts, and the fleet strip lists which critical services were affected.
- **Incidents:** opened after 2 failing checks in a row (dated from the first), resolved after 2 good checks, severity only escalates; one open incident per service enforced by the DB. Ongoing incidents show as a banner on the health page and a status chip on the admin Overview; 30-day history with durations. Resolved incidents are kept 90 days.

**Manual check:** `docker compose stop redis`, wait a minute → incident banner and a red Redis node; `docker compose start redis`, wait a minute → the incident shows as resolved with its duration.

## Pipeline v6 + file uploads (2026-09-26)

**Pipelines (Engine X, via `pnpm enginex:pipeline`):**
- Kill Montage v6 imported as a new pipeline **`tpl_uKbQwmdYcij7`** and published: length input (30/60/90) with a hard ffmpeg cap, tighter clips (3.5 s before / 1.5 s after), OCR-tolerant name matching, clearer kill rules, rendering skipped when no kills. The catalog now points at it (validated live, audited).
- Upload variant **`tpl_24XhRunrxRjQ`** ("gamer-montage-v6-upload"): same edit, but takes a `video` file key (and optional `videoTitle`) instead of downloading from YouTube. **Needs publishing in the dashboard**, then set it as Kill Montage's upload template in the admin catalog (Validate checks it).
- The run key can import new pipelines but can't overwrite existing ones; that's why v6 is a new pipeline.

**App:**
- Create page: "YouTube link | Upload a file" switch (shown when the style has an upload template). Files go straight from the browser to Engine X storage with a presigned PUT and a progress bar; the upload widget loads only when chosen.
- Server issues upload URLs after checking type (MP4/MOV/MKV/WebM), size (`maxUploadMb`) and a per-user hourly limit, and remembers which user each key belongs to; jobs refuse keys issued to someone else.
- Catalog: optional upload template per style; one input map serves both sources (`$source.url` vs `$source.key` / `$source.name`, empty values dropped). Validate/save check both templates. Stage map entries can be limited to one source (`only`).
- Automatic retry of transient step failures, "x of y scanned" progress, and a clear refunded message when no kills are found.

**Numbers:** 87 unit tests pass. `/` 135 KB, `/jobs/[id]` 134 KB.

**Manual checks**
1. Upload an MP4 on the Create page → progress bar, then "uploaded"; make the montage → no download stage, "x of y scanned" appears.
2. Try a .exe or an over-size file → friendly refusal before anything uploads.
3. A name that isn't in the video → "We didn't find any kills by …", credits refunded.

## Milestone 10: Full auth (done 2026-09-26)

Built and tested with `AUTH_MODE=full`; ships with `AUTH_MODE=anonymous`, where nothing changes for visitors.

- **Pages:** `/sign-up`, `/sign-in`, `/verify`, `/forgot-password` (404 unless `AUTH_MODE=full`; signed-in accounts are sent home). Header shows "Sign in" or "Account" in full mode only.
- **Account page (`/account`):** email, credits, member since; change password (needs the current one; other devices are signed out within 5 minutes, the session cookie cache); sign out; sign out on every device.
- **Email + password:** sign-up sends a 6-digit code (10 min, 5 tries, hashed, single use); verifying signs you in. Password sign-in before verifying sends a fresh code. 60 s resend cooldown, hourly caps per email and per network, sign-in and sign-up rate limits.
- **Password reset:** code by email, then a new password; other sessions are signed out.
- **No Google:** dropped at the user's request; email + password is the only sign-in.
- **Accounts required in full mode:** visitors see the price and "Create a free account"; uploads need an account.
- **Guests keep their stuff:** a guest session from before the switch that signs up or signs in moves its videos and credits to the account (`transfer` ledger rows; refunds of moved jobs go to the account).
- **Starter credits:** an account that has never had credits gets them right after it finishes sign-up or signs in (once per inbox, same per-network daily cap as guests), so the balance on screen is always real. (An earlier version showed a preview and granted on the first action; an admin top-up before that action made the preview look unchanged and skipped the grant.)
- **No account takeover by pre-registration:** the sign-up password is held server-side (tied to that browser) and only becomes the account's password after the code checks out, so an earlier, unverified sign-up of the same email can't keep its password. A repeat sign-up on an unfinished account gets a fresh code.
- **Abuse limits:** starter credits once per inbox (`me+x@gmail.com` and `m.e@gmail.com` count as one), once per account even after a guest spent down to 0, and within the per-network daily cap; codes capped at 6/hour and 12/day per email; sign-in lockout counts failures only (user and admin), so typing someone's email can't lock them out.
- **No account enumeration:** sign-up, forgot-password and verify answer the same whether or not an account exists.
- **Email:** Nodemailer + React Email template. `SMTP_PASSWORD` is accepted as `SMTP_PASS`. New non-critical "Email (SMTP)" health check (full mode only; logs in, sends nothing).

**Numbers:** 104 unit tests pass (OTP rules, reset, change password, pre-registration takeover, guest merge incl. zero balance, starter-once, inbox key, env). `/` 135 KB, auth and account pages 132 KB.

**Before switching production to full**
1. Make sure SMTP works (the "Email (SMTP)" health check shows up once full mode is on).
2. Set `AUTH_MODE=full` and restart web and worker.

**Manual checks (`AUTH_MODE=full`)**
1. Signed out: Create page shows "Create a free account"; `/library` offers sign-in.
2. Sign up → code email arrives → enter it → signed in, header shows the starter credits → make a montage (credits charged).
3. Wrong code 5 times → "Too many wrong tries"; "Send a new code" twice → "Wait a minute".
4. Sign out, sign in with a wrong password (email stays filled), then "Forgot your password?" → code → new password → sign in.
5. Account page: wrong current password → error; right one → "Password changed"; "Sign out on every device" → back at sign-in.
6. In anonymous mode make a montage as a guest, switch to full, sign up in the same browser → the guest's video and credits are in the account.
7. `AUTH_MODE=anonymous`: `/sign-in` is 404 and the site behaves as before; admin sign-in still works.
