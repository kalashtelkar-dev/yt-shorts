# Progress

## Milestone 1: Scaffold (done 2026-09-26)

**Done**
- Next.js 15.5 (App Router, Turbopack), TypeScript strict, Tailwind v4, shadcn/ui (base-nova style, Base UI primitives), npm.
- Dark theme tokens in `src/app/globals.css` following CLAUDE.md §8. Filled buttons use `--accent-strong` (`#d13438`) because white on `#e5484d` is only 3.9:1 (fails AA); `#e5484d` stays the accent for text, dots and "down".
- Buttons are 44 px tall on mobile (40 px from `sm`) for touch targets; form fields are at least 16 px so iOS doesn't zoom.
- Fonts: Inter + Geist Mono via `next/font` (self-hosted).
- `src/config/env.ts`: zod-parsed env, server-only, errors never echo values. `src/config/brand.ts`.
- Drizzle wired (`src/db/index.ts`, `drizzle.config.ts`); tables arrive in M3.
- `docker-compose.yml` for Postgres 17 + Redis 7. `.env.example` lists every variable.
- Vitest (env tests). `npm run build` then greps `.next/static` for secret names.
- Automated e2e dropped at the user's request; flows are tested manually.

**Numbers:** `/` first-load JS 113 KB (budget 130 KB).

**Demo:** `npm run dev` → http://localhost:3000 shows the placeholder shell.

**Manual checks:** open `/` at 360 px and at desktop width; there should be no horizontal scroll and the heading should wrap cleanly.

**Open issues**
- Engine X transport (REST or MCP) is unconfirmed. M2 starts with `npm run enginex:smoke`.

## Milestone 2: Engine X adapter (code done; live check pending)

**Done**
- `src/server/enginex/client.ts`: REST client for `https://enginex.run` with `runPipeline`, `getRun`, `cancelRun`, `signOutput`, `createUploadUrl`, `getPipeline`, `fleetStatus`. 30 s timeout, 3 retries with exponential backoff on network/5xx (never on `runPipeline`), typed `EngineXError`, key never in errors.
- `runPipeline` sends the job id as `Idempotency-Key` (Engine X returns the existing run on a repeat).
- `src/server/enginex/mock.ts` (`ENGINEX_MODE=mock`): stateless simulated runs; player name containing "fail" fails at OCR, "timeout" never finishes.
- `npm run enginex:smoke` prints fleet engines and each catalog pipeline's inputs plus the raw response shape.
- Unit tests: retries, no retry on 4xx/runPipeline, key redaction, normalisers, mock scenarios.

**Open issues**
- The OpenAPI spec doesn't type success bodies, so response parsing is lenient. Run `npm run enginex:smoke` (live) and tighten `normalise*` from the real output.
- Confirm step names so `stageMap` prefixes match, and whether Kill Montage accepts `durationSec` (PLAN §5.2).

## Milestone 3: DB and seed (done)

**Done**
- `src/db/schema.ts`: Better Auth tables (`users` with `isAnonymous`, `role`, `suspendedAt`), catalog + revisions, jobs + events, credit ledger + balances, settings (single row), admin audit log. Payments and probe tables come with M12 and M9.
- Ledger idempotency is enforced in the DB: unique `(job_id, kind)` where `job_id` is set. A trigger rejects any `UPDATE`/`DELETE` on `credit_ledger`.
- Migrations in `src/db/migrations`; `npm run db:seed` inserts both catalog items and the settings row (idempotent).

**Demo:** `docker compose up -d && npm run db:migrate && npm run db:seed`

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
- `src/worker/index.mts` (`npm run dev:worker`): BullMQ worker. A scheduled sweep every 5 s starts queued jobs and polls running ones (10 s after 5 min). Web can also enqueue `start` for an instant start (`src/server/queue.ts`). Heartbeat `worker:heartbeat` (60 s TTL).
- `src/server/jobs/lifecycle.ts`: start → poll → finish. Every transition is a conditional `UPDATE`, so overlapping sweeps or two workers can't double-start or double-settle. Restart-safe by design: the sweep picks up everything from the DB.
- `runPipeline` uses the job id as `Idempotency-Key`. On a network/5xx error at start the job stays `starting` and the sweep re-sends after 2 min with the same key, which returns the existing run instead of creating one.
- Success: output key, kills, title stored; credits settled by actual `runMs`; `computeCostPaise` stored. Failure/cancel: credits released, raw error kept for admin, friendly message by failing engine (`src/server/jobs/errors.ts`). Timeout (`maxRunMinutes`): run canceled on Engine X, credits released.
- `src/server/catalog`: `mapInput` (strict expression grammar, no eval), `progressOf` (fan-out items count individually), `stageFor`.
- Catalog `stageMap` now uses the real pipeline step ids; the mock uses the same names.

**Numbers:** 40 unit tests pass (credits, lifecycle with mock Engine X, catalog helpers, adapter, env, IP).

**Demo:** `ENGINEX_MODE=mock npm run dev:worker` (jobs arrive with milestone 6's Create page).

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
ENGINEX_MODE=mock npm run dev:worker
ENGINEX_MODE=mock npm run dev
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
- Admin sign-in at `/admin/sign-in` (email + password, Redis-limited per IP and per email). Public sign-up stays off until M10; create admins with `npm run admin:create you@example.com` (prints a generated password once). Verified accounts listed in `ADMIN_EMAILS` are promoted on sign-in.
- `requireAdmin()` in the panel layout **and** every page; `currentAdmin()` in every admin action. Both re-read the user row, so demotion or suspension applies immediately (the session cookie cache can be 5 minutes old). `createJob` also re-reads suspension.
- Better Auth POST routes are closed except `/sign-out`; sign-in runs only through rate-limited server actions.
- **Overview:** jobs today, success rate, average run time, credits used, compute cost (₹), today (IST) and 7 days; recent failures with raw errors.
- **Users:** search by email/name/ID, accounts vs guests; user page with balance, ledger, jobs, credit adjustment, suspend, role. Admins can't suspend or demote themselves; guests can't be admins.
- **Credits:** add/remove by email or ID with a required reason; recent grants, adjustments and refunds.
- **Jobs:** filter by status and style; job page with template snapshot, run ID, live Engine X steps, input/output, raw and public errors, events, credit movements. Refund (once, for finished jobs) and retry (new free job, same input, current template).
- **Audit log:** every admin mutation, written in the same transaction, with before/after.

**Numbers:** 55 unit tests pass. Admin pages 128–131 KB first-load JS. No horizontal scroll at 360 px on any admin page.

**Demo:** `npm run admin:create you@example.com`, then sign in at `/admin/sign-in`.

**Manual checks**
1. `/admin` while signed out → redirected to sign-in. Wrong password → one generic message.
2. Adjust credits (+ and −) with a reason → balance, ledger and audit log all show it; removing more than the balance is refused.
3. Refund a succeeded job → credits back once; a second refund is refused.
4. Retry a failed job → a new free job starts on the current template.
5. Suspend a user → they can't start a montage (friendly message); unsuspend works.

**Open issues**
- No password reset yet (M10); re-run `npm run admin:create` to reset an admin's password.

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
- One probe per file in `src/server/health/probes/`: web (`/api/health`), worker (Redis heartbeat), PostgreSQL, Redis, job queue (BullMQ counts; degraded above 20 waiting), Engine X gateway (authenticated `fleetStatus`), and one probe per engine worker.
- Only what the app uses: engine probes are derived from the graphs of enabled catalog pipelines (today ytdlp, ffmpeg, OCR, vLLM; WhisperX appears if Lyrical is switched on). SMTP and Razorpay are left out until they're used.
- Worker runs the sweep every 30 s (5 s timeout per probe, slow = degraded, errors redacted). Raw results kept 8 days; daily rollups kept 90 days.
- Uptime: 24 h = 96 × 15 min, 7 d = 84 × 2 h, 90 d = 90 × 1 day buckets; a bucket is up when ≥ 99% of checks were available. Fleet uptime is the worst of the critical probes.
- `/admin/health`: fleet uptime card with bucket strip, React Flow service map (admin-only chunk; hidden on phones), side panel with summary or a service's last 50 checks, uptime list per service, 24 h / 7 d / 90 d toggle, auto-refresh every 30 s, banner when the worker has stopped.

**Numbers:** 76 unit tests pass. `/admin/health` 134 KB first-load JS (React Flow loads after, on this page only).

**Manual checks**
1. With `npm run dev:worker` running, `/admin/health` shows every check operational within 30 s.
2. Stop the worker → within a minute the page says checks are paused.
3. Stop Redis (`docker compose stop redis`) → Redis goes down (red, dashed edge), fleet uptime drops. Start it again.
4. Click a node → its recent checks appear in the side panel.

## Health page upgrade (2026-09-26)

- **Live traffic:** dots drift along healthy edges (slower on degraded links, none on broken ones, which stay dashed red). Hidden when the OS asks for reduced motion.
- **Hover details:** service cards (status, latency, uptime for the range, last check, role, last message); every uptime bar shows its time slot, status and check counts, and the fleet strip lists which critical services were affected.
- **Incidents:** opened after 2 failing checks in a row (dated from the first), resolved after 2 good checks, severity only escalates; one open incident per service enforced by the DB. Ongoing incidents show as a banner on the health page and a status chip on the admin Overview; 30-day history with durations. Resolved incidents are kept 90 days.

**Manual check:** `docker compose stop redis`, wait a minute → incident banner and a red Redis node; `docker compose start redis`, wait a minute → the incident shows as resolved with its duration.

## Pipeline v6 + file uploads (2026-09-26)

**Pipelines (Engine X, via `npm run enginex:pipeline`):**
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
- **No Google:** dropped at the user's request; email + password is the only sign-in. (Brought back 2026-10-01, see below.)
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

## Staged styles: split pipelines in the app (2026-09-28)

- **Pipelines** (`pipelines/`, ids in `pipelines/README.md`): gameplay-index (+ upload version), song-index, style-kill-montage, style-lyrical-kill-montage. Specs in `docs/edit-styles/`.
- **Catalog:** a style with `indexTemplates` is staged: `templateId` is its style pipeline, fed by the index pipelines. Admin catalog has an "Index pipelines" field; Validate/Save check the style pipeline against what the app sends and each index pipeline against the mapped inputs. The seed makes Kill Montage and Lyrical Kill Montage staged, with a song-link field.
- **Jobs:** a staged job starts its own gameplay-index and song-index runs in parallel, then the style run. `media_index` holds each index run. It's keyed by pipeline + input + job id, so nothing is shared between jobs, even for the same video and song (the user's call on 2026-09-29: "every run should be new"); a worker restart finds the job's own run. The render phase is an ordinary run, so polling, retry, timeout and refunds are unchanged; progress counts both phases; a failed index fails the job with a gameplay- or song-specific message and a refund. Each job gets a random `variation` (where the slow and fast clips go).
- **Mock:** knows the staged pipelines (by template id), their steps and outputs, so the whole flow runs locally with `ENGINEX_MODE=mock`.

**Numbers:** 111 unit tests (6 new for staged jobs), `pipelines/check.py` 13 checks, `/` 135 KB.

**To go live:** publish the five pipelines in Engine X, then set Kill Montage and Lyrical Kill Montage to the staged config in the admin catalog (or with the audited save script), and run one real job per style.

**Manual checks (mock):** make a Kill Montage with a song link → stages go "Reading the kill feed" → "Planning your edit" → "Rendering your montage" → done; a second job with the same links goes straight to the render; player name "fail" → kill-feed error and refund; a song link containing "fail" → song error and refund.

## Credits by editing time, buying credits, GST invoices (2026-09-29)

**What changed**
- Usage pricing: 1 credit = 1 second of editing. Nothing is charged when a montage starts; it pays for the time it used when it succeeds (capped at the balance). Failed montages cost nothing. To start, the balance minus what running jobs hold must cover the top of the style's range.
- Catalog prices became credit ranges per length (`credit_ranges`, min–max); Create shows a range meter with your free credits (design B), and "Add credits" when short.
- Account page (design B): credits wheel (₹100 minimum, GST included, ₹0.20 a credit so ₹100 = 500), "that makes about" per style, Profile tab with invoice details, password, sign out.
- Billing page (design A): every credit movement with the balance after it, filters, paging, invoice links; desktop has a summary column.
- Payments: provider interface (Razorpay; mock for local testing, refused in production), webhook `/api/webhooks/razorpay`, one purchase ledger row per payment, GST tax invoice per purchase (CGST+SGST in Karnataka, IGST elsewhere), printable / save as PDF, admin transactions list and invoice view. Razorpay health probe when checkout is on.
- Admin Billing: price per credit, top-up limits, GST rate, seller details for invoices; cost report on actual charged credits.
- Fixed: the DB pool is cached across dev hot reloads (each reload used to open 10 more connections until Postgres refused new ones).

**Manual checks**
1. `.env`: `PAYMENTS_ENABLED=true`, `PAYMENTS_PROVIDER=mock`. Sign in, open Account: scroll the wheel, Pay, fill the state once, confirm the test payment, see "Added N credits", open the invoice, print it.
2. Billing shows the purchase with the balance after it and the invoice link; paging and filters work on phone and desktop.
3. Create: pick Ultra Edit 90 s with fewer credits than its top → the meter turns red and the button becomes Add credits. With enough, start a montage: the balance doesn't drop until it finishes; then it drops by the seconds it took.
4. A failed montage leaves the balance unchanged.
5. Admin Billing: transactions list, invoice view, edit the seller details and price; Catalog: edit a style's ranges.

**Open**
- (Superseded 2026-10-01: Razorpay was replaced by Cashfree, see below.)
- SAC code for the credits is blank on invoices until set in admin Billing (ask the accountant).
- Credit ranges are from few measured runs; tune them in the catalog as more jobs finish.

## Landing page (2026-09-29)

- Design C ("key art poster") from the landing canvas: the key art with "Every kill. One edit.", the styles, and a "what ₹X gets you" slider, all from the catalog and settings.
- `/` shows the landing page to visitors who aren't signed in (with AUTH_MODE=anonymous: anyone who hasn't used the app yet); signed-in users still land on Create. Create also lives at `/create`, where the landing's button goes.
- Manual check: signed out, open `/` on a phone and a desktop, move the slider, press Make my montage (lands on /create with "Create a free account"); signed in, `/` is Create.

## 2026-09-29: Database layer on Prisma 7 (was Drizzle)

The user's call. Same tables and data; only the query code changed (commit 1499441).

**Setting up after pulling this:**
- `npm install` generates the Prisma client (`src/generated/prisma`, git-ignored).
- A database that already has the tables (made by the old Drizzle migrations): run `npx prisma migrate resolve --applied 0_init` once. Its schema matches `prisma/schema.prisma` exactly (checked with `prisma migrate diff`).
- A new database: `npm run db:migrate`, then `npm run db:seed`.
- The old `drizzle.__drizzle_migrations` table can be dropped whenever convenient; nothing reads it.

**Checked:** lint, typecheck, 145 tests (the test database is rebuilt from the migrations on each run), a production build from a clean install, no Prisma or secrets in the client bundle, every read path against the dev data, and the worker writing health checks through Prisma.

**Manual checks:** sign in (both modes), make a montage end to end, buy credits with the mock provider (invoice appears), an admin credit adjustment, a catalog save.

## 2026-09-30: Finished videos and covers are kept in Postgres

Engine X clears its output storage (every job older than ~13 h was already gone, covers and videos alike), so libraries and result pages were losing their videos.

- New table `job_files` (migration `20260930062648_job_files`): one row per job and kind (`video`, `thumbnail`), the bytes in a `bytea` column stored uncompressed (`STORAGE EXTERNAL`) so byte ranges read only their own chunks.
- The worker copies the files the moment a job succeeds, before the result is shown (`src/server/jobs/files.ts`). A failed copy is retried every 60 s for a day (`files` scheduler in the worker).
- `/api/jobs/:id/files/:kind` serves them, owner or admin only, with Range support so the player can seek. Library covers, the result page, Download/Share/Save cover and the admin gallery all use it; jobs without a saved copy fall back to signed Engine X links.
- `npm run files:backfill` copies anything still missing. Run on 2026-09-30: all 35 earlier jobs had already been cleared by Engine X, so they can't be recovered.

**Open issue:** each montage adds ~20–60 MB to the database. Plan backups and disk size for it, or move the bytes to object storage we own if it grows large.

**Manual checks:** make a montage; on the result page the video plays and seeks, Download and Save cover work; it still plays in `/library` and the admin gallery after a day.

**2026-09-30, clean start (the user's call):** the dev database was emptied: jobs, run data, files, gameplay indexes, credits, balances, payments, invoices, audit log and health history. Kept: the accounts kalash.telkar@deepsoch.ai (admin) and kalashtelkar@gmail.com, the catalog (3 styles and their revisions) and settings. Both accounts start at 0 credits. The leftover `drizzle` schema was dropped.

**2026-09-30, stuck "Running" jobs and a Stop button.** A Lyrical job showed "Running" for 14 h because the worker had stopped (its last heartbeat was one minute after the job's last update); with the worker up, the 60-minute timeout would have stopped it at no cost. Now:
- The admin Jobs page shows a red notice when the worker has no heartbeat, so a frozen queue is obvious.
- Admins can stop an unfinished job ("Stop this job" in the job pane and on its detail page). It cancels every Engine X run the job has (the render run, or a Lyrical job's index runs), marks it canceled, costs the user nothing, and writes `job.cancel` to the audit log. A cancel that lands while the worker is starting the run also stops that run.
- Manual check: stop the worker, open /admin/jobs (notice shows); start it again (notice goes after a reload). Start a montage, press Stop this job: it turns Canceled, the user's page says it cost nothing, and the Engine X run is canceled.

**2026-09-30, how many montages can run at once.** 1 per user and 3 per admin, both set in admin Billing → Limits (new setting `maxConcurrentJobsPerAdmin`, migration `20260930071229_admin_job_limit`). The count now runs under the balance lock, so two quick taps can't both start. Manual check: as a user, start a montage, then try another: "You already have a montage being made…". As an admin, three start and the fourth is refused.

**2026-09-30, object storage probe.** It showed down (HTTP 404) because Engine X moved its MinIO store from `enginex.fapi.run` to `enginex-minio.minio.run` (the host in its signed upload links); the old host now answers 404 for everything. `ENGINEX_STORAGE_URL` updated in `.env` and `.env.example`; the probe reports up (138 ms). The probe stays: uploads and the copy of finished files into Postgres both go through this store.

**2026-09-30, YouTube 403 on the gameplay download.** A job failed with "unable to download video data: HTTP Error 403" while another job for the same video, started 33 s earlier, downloaded fine: YouTube refusing a stream now and then, not a bad video. Index runs (gameplay, song) now get the same one automatic retry of their failed steps that render runs have (`media_index.retries`, migration `20260930072746_media_index_retries`), and that 403 counts as a blip. Age-gated and private videos still fail at once with their own messages.

**2026-09-30, the copy to Postgres moved off the finish line.** A job used to wait for its video to download into Postgres before showing "Done". Now it's Done at once and plays from Engine X; the worker's `save-files` task copies the video and cover right after (3 attempts, 30 s backoff), the minute sweep catches anything missed, and links switch to Postgres as soon as the copy is saved. Removed the two failed test jobs from 12:49 (and their index runs).

**2026-09-30, which copy plays.** For the first hour after a montage finishes, the video plays (and downloads, and shares) from Engine X; the Postgres copy rides along as the fallback, so the player, Download and Share switch to it if the Engine X link fails. After an hour every link points at Postgres. Covers come from Postgres as soon as they're saved. One constant: `ENGINEX_SERVE_MS` in `src/server/jobs/files.ts`.

**Published (the user):** gameplay-index `tpl_HHdgqEu5oz46` and song-index `tpl_2e8cr5IiomI_` (impersonate Chrome; the kill finder lists only the player's kills). Catalog synced (3 styles, 0 errors). Test runs: the song download with impersonate succeeded end to end.

**2026-09-30, the video download gets its own progress bar.** Engine X reports a download's progress only in the step's engine-job trail (`GET /v1/jobs/:id/events`, `downloading` events with fraction, bytes, total size and eta, every second or two); the dashboard reads the same. The worker reads the latest one on each 5-second poll while the gameplay download runs (`getJobEvents`, `src/server/jobs/download.ts`) and stores it on the job (`jobs.download`, migration `20260930082002_job_download_progress`) only when the percent changes. The progress page shows it inside the 9:16 frame above the overall percentage ("Video download 64% · 481 of 752 MB", its own bar), and next to the current step in All steps; the admin job pane shows it too. It clears once the download is done. The mock reports download progress as well, so it shows in mock mode. Also confirmed: a 752 MB gameplay download with `impersonate` finished in 5 min 16 s.

**2026-09-30, a timeline on each admin job.** The admin job page has a Timeline panel: every step of the job drawn to scale on one clock, one lane per run (Gameplay reader, Song reader, Editor for staged jobs; one lane for older single-run jobs), coloured by engine kind, with each step's duration, OCR's item count, "start to finish" and "runs added up" (what the user is billed on). It reads the steps' `startedAt`/`finishedAt`, which the Engine X client now keeps (`RunStep`, optional so stored steps without them still parse); the index runs are fetched live beside the render run and left out if Engine X can't find them. Util helpers and instant steps are hidden; a running step draws to now. Pure server-rendered SVG with native hover titles, no chart library. Manual check: open a finished Lyrical job in /admin/jobs/:id at 1280 px (three lanes, bars match the steps table) and a running one (the open bar grows on reload).

**2026-09-30, the download bar counts the whole download.** Engine X's download trail is really four parts: the picture file, then the sound file (each reported 0 → 1 on its own), then joining them ("Merger") and moving the result into storage ("MoveFiles"), with no progress for the last two. The bar used to follow only the latest file, so it ran 0 → 100% on the picture, restarted at ~60% on the sound, then sat at "100% · 64 of 64 MB" while joining and saving ran for 35 s to over 3 minutes (a 65-min, 1.5 GB video: transfer 91 s, then 3+ min of saving). Now the files add up to one download (held at 99% while the sound arrives, so it never goes backwards), and after the transfer the bar says "Joining picture and sound", then "Saving your video", with the file size. The worker stores a phase change even at 100%. The mock plays the same four parts. Measured this morning's "5 min 16 s download": 3 min 30 s transfer, 35 s joining, 68 s saving; the same video downloaded in 43 s at 16:08. Manual check: open a job while its video downloads: the bar climbs once to 100%, then shows the two phases, then clears when the kill feed starts.

**2026-09-30, "Made from" on the job page.** `/jobs/:id` shows what the montage is made from, above All steps (which opens itself on desktop, so nothing below it moves): the edit style and length, then the gameplay and the song, each with YouTube's own still, the video's title once its reader has finished (from the index rows' output; "YouTube video" until then), and a link to the video on YouTube. Uploads show "Your uploaded video". Ids come from the pasted link (`src/lib/youtube.ts`: watch, youtu.be, shorts and music links, with `&t=`, `&list=`, `&pp=`; tested); the stills go through Next's image optimizer, allowed only for `i.ytimg.com/vi/**` in `next.config.ts`, so the browser makes no third-party request. The loading skeleton has the block's height. Manual check at 360 px and 1280 px: a running job shows the style, two stills and "YouTube video" until the titles arrive; a finished one keeps the block under Download.

**2026-09-30, 10-link production test (16:08–16:43 IST).** 10 jobs through the app's own `createJob` as the admin (all "Me", 30 s, styles rotated, the pasted links with `&t=`, `&list=`, `&pp=` as-is): 7 succeeded, 3 failed as "no kills found". The 3-at-once limit queued the rest with no refusals; two song readers retried once on their own and succeeded.
- **Bug, fixed in `pipelines/build.py` (not yet imported):** 2 of the 3 failures had real kills (15 and 27). The kill cleanup's comma tidy left `[,{…` whenever two or more non-kill rows came before the player's first kill, so the list didn't parse and the job failed. New pattern `(?<=[\[,]),|,(?=,*\])`; replayed on all 9 real kill-finder answers: the 2 broken ones parse (15 and 27 kills), the 7 others give identical kills. `check.py` has the case now (it failed before the fix). Both gameplay pipelines validate. The rebuilt pipeline differs from production (`tpl_HHdgqEu5oz46`) only in `tidy_commas`.
- **Correct failure:** the 65-min 2v2 video (`p5CqaQa8de4`) shows real names in its kill feed, not "Me": no strip had the name, the user saw the "check the name" message and paid nothing.
- **Open: users are charged above the range they're shown, on every success.** 30 s charges: Kill Montage 386–742 (shown 120–360), Lyrical 558–571 (shown 90–300), Ultra 582–653 (shown 150–420). The charge follows the gameplay video's length (downloading and reading it), not the montage's. The ranges are the admin's call (Catalog).
- Wall time 6–13 min per job; 16–27 min gameplay videos.

**2026-09-30, a site-wide queue.** At most 2 montages run at once across all users (`settings.maxConcurrentJobsTotal`, migration `20260930112317_site_job_limit`, admin Billing → Limits); every other job waits as `queued` and starts oldest first when a slot frees (the worker's 5-second sweep). The slot is taken in the worker's start step under a Postgres advisory lock, so parallel starts can't go over. The per-user limit (1) and per-admin limit (3) still apply on top, counting waiting jobs, so a user can't line up a second montage; with the site at 2, an admin also gets at most 2. Waiting costs nothing: the run clock (and so the charge) starts when the job gets its slot. The job page says "Waiting in line · 2 ahead of you" / "You're next". Tested: four started at once → two run, two wait with the right places; after one finishes the oldest waiting one starts, never a newer one first. Manual check: start montages from three accounts: two run, the third's page says "Waiting in line · You're next" and it starts within ~5 s of one finishing.

**2026-09-30, pricing matches what users see.** Every successful job in the 10-link test charged above the range shown (e.g. 742 against "120–360"). Now (the user's call): the charge is capped at the job's `maxCredits`, the top of the range shown when it started (tested), and the ranges come from the test's measurements, saved through the audited admin Catalog save and in `src/db/catalog-seed.ts`: Kill Montage 30/60/90 s = 350–900 / 400–1,000 / 450–1,100; Lyrical 450–900 / 500–1,000 / 550–1,100; Ultra 500–1,000 / 550–1,100 / 600–1,200 (60/90 s not measured yet). Since a job needs its max available to start, new accounts now get 1,000 starter credits (was 600, which couldn't start any montage): `settings.starterCredits` saved through the audited admin save, schema default in migration `…_starter_credits_1000`. Manual check: a new anonymous user has 1,000 credits and can start a 30 s montage of any style; the create page shows the new ranges.

**2026-09-30, admin job pane: "Made from" instead of the step list.** The pane on /admin/jobs no longer lists every Engine X step (the Timeline above it shows the steps that take time); it shows the same "Made from" block as the user's job page: style and length, the gameplay and the song with their YouTube stills and titles. The block is one shared component (`src/components/job/made-from.tsx`), fed by `jobSources()` in `src/server/jobs/public.ts`. The "All details" page keeps its full step table (status, items, per-step errors) for debugging.
**New gameplay pipelines imported (the kill-list comma fix):** `tpl_hlx1_T84Rgxm` (link) and `tpl_ZsNBv4Nq8gr9` (upload), set in `src/db/catalog-seed.ts`, `pipelines/README.md` and the mock. Waiting for publish, then `npm run catalog:sync`.

**2026-09-30, the live queue leads the admin Jobs page.** "Live queue" and its numbers are now the first thing on /admin/jobs (Run times moved below the list). The numbers are two tiles: running, shown as "of 2" (red when above 0), and queued (amber when above 0), counted across the whole site (`queueCounts()` in `src/server/admin/queries.ts`). Before, they were counted from the rows on the current page, so a search, a filter or page 2 showed wrong numbers. The page also refreshes itself whenever anything is running or waiting, not only when a listed row is. Redesign options for the page: artifact "Admin Jobs Redesign" (three directions, desktop and phone).

**2026-09-30, admin Jobs page: option A ("Control room") built.** From the "Admin Jobs Redesign" canvas, the user's pick:
- **Header:** "Live queue" with two big tiles, running (a slot meter with one bar per site slot, red when in use) and waiting in line ("next starts when a slot frees"), plus a "Worker up · N s ago" chip (the red alert still shows when it's down).
- **List:** grouped into Running (stage, time running, progress), Waiting in line (each numbered with its real place in the site-wide line and how long it has waited) and Finished (done time and credits, or the reason it failed). `queueCounts()` returns the line in order; list rows carry `startedAt`.
- **Job pane:** the preview beside the style name (not its slug), status, "All details", the numbers (credits shown "of up to N", the job's max), and "Made from"; the timeline at full width under them; the actions last.
- **Run times:** folded into a one-line summary at the bottom (each style's average), with the table on open.
- New `loading.tsx` in the same shape.
Manual check at 1280 px and 390 px: with nothing running, both tiles read 0 in white and the meter shows 2 empty bars; start two montages from different accounts and a third: the tiles read 2 (red, both bars filled) and 1 (amber), the list shows the third as "1" in Waiting in line.

**2026-09-30, admin Jobs page without inner scrollbars.** The list and the job pane were fixed-height boxes that scrolled inside the page (three scrollbars with the page's own). Now both are as tall as their content and only the page scrolls; the list shows 13 jobs a page (`JOBS_PAGE`, the user's pick), so it stays short. The header tiles read just "N running" (with the slot meter) and "N waiting". "of undefined slots" was the dev server running the database client from before the new `maxConcurrentJobsTotal` column: restart `npm run dev` after a migration (the worker restarts itself on file changes; the Next dev server keeps its client in memory).

**2026-09-30, the planner is handed the beat and the drop.** Before, the planner model found the beat and the drop itself from ~500–900 loudness lines; on the 10-link test it followed every hard rule but put the drop outside the montage, so 3 of 5 "slow motion on the drop" montages had no slow motion, and it planned 2–3× the clips needed. Now the song reader measures loudness every 0.05 s and the app measures the beat, the beat times up to the montage's length and the drop (`src/server/jobs/beats.ts`: every beat length 0.30–1.00 s in 1 ms steps against where the sound jumps, halved above 0.75 s; the drop is the biggest 2 s lift of 6 dB or more with music already playing, on the nearest beat). Checked on the six test songs: the four with a known tempo came within 4 ms at 0.05 s steps (two were 0.1–0.3 s off at the old 0.25 s). Tests use a real 60 s loudness curve (`fixtures/loudness-rolling-in-the-deep-60s.csv`). The style pipelines get `beatSec`, `beats`, `dropAtSec`, a reworded instruction and a short system prompt (see `docs/enginex-requests.md`). New ids are in the seed; `npm run catalog:sync` after they're published. Ultra's fixed 6.67 s kill clip still doesn't land on the beat (open).

**2026-09-30, three fixes from the user's checks.**
- **"Retry as a new job" failed at once** ("the request body does not match this pipeline"): the retry, written before staged styles, didn't copy the style's index pipelines, so the worker sent the job's input straight to the style pipeline. It now snapshots them as `createJob` does (and the upload pipeline for single-run upload jobs). Tested.
- **The timeline chart was drawn too big** on the All details page: it stretched to the panel's width, scaling its text with it. It now draws at its own size and only shrinks to fit.
- **The download progress sits under its stage pill** on the progress page (one piece with "Downloading your video": percent and MB, then "Joining picture and sound" / "Saving your video" with the size), not as a separate bar at the bottom of the frame.

**2026-09-30, the app plans the clips (the user's call).** The planner model, even with the measured beats, kept the hard rules but not the timing (first job: every cut 0.29 s off the beat, 78.7 s planned for 30 s, the slow clip at 74 s). `src/server/jobs/plan.ts` now builds the clip list from what's measured: the intro ends on a beat (kill: 2–4 s, on the drop if it's there; lyrical/Ultra: 1–1.5 s, else the first beat up to 2 s, never under the pipeline's 1 s minimum), the kills in the run's order, each clip its minimum (2.5 s + hold, 1 s + hold/2 slow, a multi-kill up to its last kill) lengthened to the next beat, one slow clip placed by the variation among the clips that actually play ("on the drop" = the clip playing at the drop; a drop in the intro = the first kill clip), stopping at the length plus at most one clip; Ultra: the intro and the first ⌈(length − 1.5) / 6.669⌉ kills. It goes to the style pipelines as the `plan` input, and their checks and render are unchanged. Emulated on a real job's inputs at 30 and 60 s: every clip kept by the checks, every cut on the song's beat, slow motion where asked, one clip past the end. 10 tests (`plan.test.ts`), including a real song's beats. New ids in the seed; `npm run catalog:sync` after publishing.

**2026-09-30, only kills after the intro, and a clean ending (the user's calls).**
- **No deaths on screen:** the gameplay reader now also outputs the player's deaths (kill-feed rows with the player as the victim). The planner keeps every clip at least 1 s before a death: a kill with a death during its hold is left out, a clip is never stretched to a beat into a death, a multi-kill shows only the kills before it, Ultra leaves out a kill with a death in its fixed window, and an intro moment with a death is passed over.
- **No kill cut off by the end:** a kill clip starts only if its kill and hold fit before the end; the time left is an outro flex (another intro moment, clear of deaths, shorter than any kill clip so it can't reach its own kill), or under 1 s, the last clip plays a little longer. Ultra takes only whole 6.67 s kill clips. The outro's `kill` is -1 so the pipeline's one-clip-per-kill check keeps it.
- Emulated with a real job's inputs, all three styles at 30 and 60 s: every clip kept by the pipeline's checks, every montage ends at its length, no kill past the end. 16 planner tests. New gameplay ids in the seed.

**2026-09-30, admin job pane: actions on the right, a bigger preview.** The refund and retry actions moved into the right column under "Made from": "Reason" and its box across the top, "Refund credits" and "Retry as a new job" side by side under it (the refund form's parts sit in a small grid, `display: contents`, so it stays one form). The "Same input, current template, no charge to the user." line is gone here and on the All details page. The preview is 256 px wide on desktop (was 192), filling the taller right column.

**2026-09-30, no email health check (the user's call).** The SMTP probe is removed (`src/server/health/probes/smtp.ts`, its place in the health graph, and the CLAUDE.md §9 rule). Sending OTP emails is unchanged. The health page lists only registered probes, so old email results in `probe_results` are ignored and age out.

**2026-09-30, 60 s test on the code planner (9 links, 3 per style).** 8 of 9 succeeded. Kill Montage and Lyrical: 48 of 51 cuts on the measured beat, slow motion visible in all 6 and where the variation said, every montage ends at 60 s (±0.01) on an outro, no kill cut off, 9–44 deaths found per match and 0 clips reaching one. Ultra: no kill cut off and an outro, but only 1–2 of 9 cuts on the beat (its fixed 6.67 s warp: still open). Run time 7.8–12.3 min; charged 471–736 credits against the 60 s maxima 1,000/1,100 (Ultra's 471 is under its 550 minimum). The failure (#10) was Engine X's object store taking a file short ("did not provide the number of bytes specified by the Content-Length"): not treated as a blip, so never retried; it now is (errors.ts, tested). Also: "on the drop" now plays the slow clip at least 0.5 s past the drop (one plan had it ending exactly on it).

**2026-09-30, the song can be an uploaded file (the user's ask).** Like the gameplay upload: on the create form the Song row has an "Upload a song file instead" button; the file goes straight from the browser to Engine X storage (MP3, M4A, WAV, AAC, OGG or FLAC, the same size and hourly limits as videos, `issueUpload(…, "audio")`), and a video can't pass as a song or a song as a video. `createJob` takes `songUpload {key, name}` in place of the song link (only for the user's own key, and only where the style has `indexTemplates.songUpload`), and stores `songUpload` and `songName` in the job's input; the job's song reader is then `song-index-upload` with the file as `audio` (`indexInputs`). "Made from" shows the file's name. Admin Catalog accepts and validates `songUpload`, and lists it under "Song from an upload"; `catalog:sync` compares it. Tests: file types, the create rules, the reader's input. Manual check at 360 and 1280 px: pick "upload a song file" on the Song row, upload an MP3, start a montage: the job page's "Made from" shows the file name and the montage uses the song.

**2026-09-30, previews for uploaded files in "Made from".** An uploaded song shows a drawn waveform (bars shaped by the file's name, so each file looks its own and stays the same; one red bar in seven), an uploaded video a film frame with sprocket holes and a play mark, in place of the empty grey box. Inline SVG from the theme tokens, nothing to load. A real still from the uploaded video would need the gameplay reader to save one frame and could only show after it has read the video.

**2026-09-30, Lyrical Kill Montage retired; Ultra Edit is now Smart Edit (the user's calls).** Migration `20260930142453_retire_lyrical_rename_smart_edit` (data only): Lyrical is switched off (no longer on the create page; its 9 past jobs stay in My videos and the admin, since their charges are in the append-only ledger; its pipelines stay in Engine X and `pipelines/`), and Ultra Edit's catalog item and all 11 past jobs now use the id `smart-edit` and the name "Smart Edit". Code: the seed has two styles (Kill Montage, Smart Edit), the planner has two (`kill`, `ultra` = Smart Edit; its pipeline is still `style-ultra-edit`), the create form's preview and the mock follow. Next: a new style, Semi-Auto Edit.

**2026-09-30, pipelines laid out cleanly in the Engine X editor (the user's ask: view only).** `build.py` places every step left to right in the order data flows (`layout()`: columns by dependency, 380 px apart; rows level with what feeds them, 150 px apart; constants beside their consumer; the least-crossing ordering kept). Checked that each rebuilt pipeline is identical to the one in use apart from node positions; crossings down 60–80% on the big ones and no backward wires. New versions imported; ids in the seed, README and mock; `npm run catalog:sync` after publishing.

## Payments: Cashfree replaces Razorpay (2026-10-01)

**What changed**
- `src/server/payments/provider.ts`: a Cashfree provider (PG API `2023-08-01`, sandbox or production via `CASHFREE_ENV`) in place of Razorpay. Orders use our payment id as `order_id`; checkout opens Cashfree's JS SDK (`sdk.cashfree.com/js/v3`) as a modal with the order's `payment_session_id`.
- Confirmation no longer trusts a browser signature: the server asks Cashfree for the order's payments and credits the one with `SUCCESS`. The mock keeps its signed proof.
- Webhook moved to `/api/webhooks/cashfree` (`PAYMENT_SUCCESS_WEBHOOK`, signed with the secret key: base64 HMAC-SHA256 of `x-webhook-timestamp` + raw body). No health probe for payments (the user's call). Env: `CASHFREE_ENV`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` (the `RAZORPAY_*` vars are gone).

**Manual checks**
1. `.env`: `PAYMENTS_ENABLED=true`, `PAYMENTS_PROVIDER=cashfree`, `CASHFREE_ENV=sandbox` and the sandbox keys.
2. Account → Pay: Cashfree's sandbox checkout opens; pay with a test UPI/card; see "Added N credits" and the invoice. Close the checkout instead: "The payment didn't finish", no credits.
3. With a public URL (e.g. a tunnel), set `<APP_URL>/api/webhooks/cashfree` as the webhook in the Cashfree dashboard (Payments → Webhooks) and check a payment is credited even if the tab is closed right after paying.

**Open**
- Cashfree requires a customer phone; we send a placeholder (`9999999999`). Collect a real one if Cashfree asks.

## Google sign-in (2026-10-01)

**What changed**
- "Continue with Google" on `/sign-in` and `/sign-up` (outline button above the email form), shown only when `AUTH_MODE=full` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set.
- `googleSignInAction` (rate-limited per network, 30 / 15 min) asks Better Auth for Google's page. Google returns to `/auth/google/callback` (the URI registered on the OAuth client), which forwards to Better Auth's `/api/auth/callback/google`, then `/auth/google/done` grants starter credits (same once-per-inbox rules) and goes home. A failed or cancelled sign-in lands on `/sign-in?google=failed` with a message.
- A guest who signs in with Google keeps their videos and credits (the anonymous plugin links on `/callback`). A Google account with the same email as an existing account signs into that account (Google verifies the email).

**Manual checks**
1. `.env`: `AUTH_MODE=full`, the Google client id and secret. The OAuth client in Google Cloud must list `http://localhost:3000/auth/google/callback` as an authorized redirect URI.
2. `/sign-up` → Continue with Google → pick an account → home, signed in, with starter credits. Sign out, `/sign-in` → Continue with Google → same account, no second grant.
3. As a guest with a montage, sign in with Google: the montage and credits are in the account.
4. Cancel on Google's screen: back on `/sign-in` with "Google sign-in didn't finish".

## Billing details optional (2026-10-01)

- Paying no longer asks for the "Details for your tax invoice" first (the user's call). Without them the invoice is still issued, with the seller's state for the GST split (CGST+SGST) and no buyer GSTIN. Details stay editable in Account → Profile and apply to later invoices.
- Manual check: a new account pays straight from the wheel (no details step) and its invoice shows CGST+SGST; after saving a state in another region in Profile, the next invoice shows IGST.

## SEO (2026-10-01)

**What changed**
- Root metadata (`src/app/layout.tsx`): `metadataBase` from `APP_URL`, a search title and description that name what people search for (gameplay / kill montage, Shorts, Reels, TikTok; in `src/config/brand.ts`), Open Graph and Twitter `summary_large_image` cards.
- Share image `src/app/opengraph-image.jpg` (1200×630, cut from the landing key art, with alt text), used for every page's link preview.
- `robots.txt` (`src/app/robots.ts`): public pages crawlable; admin, API, account, library, montages and auth flows disallowed. `sitemap.xml` (`src/app/sitemap.ts`): `/` and `/create`.
- Canonicals on `/` and `/create`; `noindex, nofollow` on account, billing, invoices, library and montage pages (auth and admin were already noindex).
- JSON-LD `WebApplication` on the landing page (free to start, publisher from the seller details).

**Manual checks**
1. `/robots.txt` and `/sitemap.xml` load; in production they must show the real domain (set `APP_URL`).
2. Paste the production URL into a link-preview checker (e.g. opengraph.xyz) or a WhatsApp/Slack message: the share card shows the image and title.
3. Google Rich Results Test on `/` finds the WebApplication.
4. After launch: add the domain to Google Search Console and submit `/sitemap.xml`.

**Open**
- The landing hero has two `<h1>`s (phone and desktop layouts, one hidden by CSS); fine for Google, but one would be cleaner.
- `public/create-preview.jpg` is 25 MB and publicly downloadable at its path; the page itself gets optimized versions through `next/image`.

## Montage links: YouTube videos only, no Shorts (2026-10-01)

- The match link and the song link must be an https YouTube video link (`youtube.com/watch?v=…`, `youtu.be/…`, mobile and YouTube Music too). Shorts links, channels, playlists, other sites and `http://` are refused with a message saying what to paste instead (`youtubeLinkProblem` in `src/lib/youtube.ts`, used by `src/server/jobs/create.ts`).
- Manual check: on Create, paste a `youtube.com/shorts/…` link → "Shorts links don't work. Paste the link to the full video instead."; a channel link → "That link doesn't point to a video…"; a normal video link starts the montage.

## Change password: "Forgot your current password?" (2026-10-01)

- Account → Change password has a "Forgot your current password?" link. It swaps the current-password field for "Email me a code" (sent to the account's own address, same code rules as sign-up: 6 digits, 10 min, 5 tries, 60 s resend, hashed), then the code and a new password. Other devices are signed out; this browser stays signed in with the new password. It also lets Google-only accounts set a password.
- Server: `sendAccountResetCodeAction` and `accountResetPasswordAction` in `src/app/(auth)/actions.ts` (signed-in only, per-account limit 10 / 15 min).
- Manual check: Account → "Forgot your current password?" → "Email me a code" → the code arrives (or is in the server log without SMTP) → enter it with a new password → "Password changed"; still signed in; sign out and sign in with the new password. A wrong code shows the code error; "Send a new code" within a minute says to wait; "I remember it" goes back.

## Legal pages: terms, privacy (DPDP Act), refunds, contact (2026-10-01)

**What changed**
- `/terms`, `/privacy`, `/refunds`, `/contact` (in `src/app/(user)/`, shared bits in `src/components/legal.tsx`). Business details come from `settings.seller` (admin Billing), so they match the invoices. Indexed and in the sitemap.
- Privacy is written as the DPDP Act, 2023 notice: Data Fiduciary, what's collected and why, consent and withdrawal, processors, retention, the Data Principal rights (access, correction, erasure, grievance, nomination), children, breaches, the Data Protection Board.
- Footer with the four links on every user page (replaces the landing page's own footer).
- Notices where people agree: under sign-up (and sign-in when Google is on), under the Pay button (Terms + Refund policy), and in the "Check your choices" dialog before a montage starts (Terms + Privacy).

**Manual checks**
1. Open each page at 360 px and 1280 px; the footer links work from Home, Create, Account and a montage page.
2. Cashfree dashboard → website/compliance details: enter `<APP_URL>/terms`, `/privacy`, `/refunds` and `/contact`.

**Open (needs the business, ideally a lawyer)**
- The text is a draft written from how the app works today. Have it reviewed before launch.
- Policy choices made in the draft: 18+ or a parent's consent; purchased credits final and never expiring; refunds only for debited-without-credits, double charges or legal requirement (within 30 days of payment); invoices kept 8 years; account deletion within 30 days of an emailed request; grievances acknowledged in 48 hours and resolved within 15 days; data-rights replies within 30 days; disputes in Bengaluru courts.
- The grievance officer is the support email; DPDP and the IT Rules may need a named person.
- Consent is a notice next to the action, not a checkbox, and isn't recorded per user. Verifiable parental consent for under-18s has no in-app flow. Account deletion and data export are by email, not self-serve.

## Cookie notice (2026-10-01)

- A notice at the bottom of user and sign-in pages (not admin): "We use only the cookies MontageAI needs to work… No ads or tracking." with a Privacy policy link and an Accept button (`src/components/cookie-notice.tsx`). Accept sets `cookie_consent=essential` for a year; the layouts render the notice only while that cookie is missing (`src/lib/consent.ts`), so it never flashes for people who accepted.
- No reject or settings choice: every cookie we set is needed for the service (sign-in session and its security). If analytics or ads are ever added, this must become a real opt-in with those cookies off until accepted.
- Privacy policy, Cookies section (`/privacy#cookies`), mentions the notice's own cookie.
- Manual check: in a private window the notice shows at 360 px and 1280 px; Accept hides it and it stays hidden after a reload; the Create page's sticky Make button is reachable after accepting.

## New logo and favicon (2026-10-01)

- Header logo is the "MontageAI" brush wordmark (`public/brand/wordmark.svg`, traced art run through svgo, background rectangle removed, cropped by its viewBox; `Wordmark` in `src/components/logo.tsx`) on user, sign-in and admin pages. The admin desktop rail uses the square "MAI" mark (`LogoIcon`, `public/brand/mark.svg`, square crop with the tagline paths removed). Tax invoices keep the Deepsoch company mark (the seller).
- Favicon, app icon and Apple touch icon from the "MAI" mark: `src/app/favicon.ico` (16/32/48, RGBA: Next refuses an .ico whose images have no alpha), `src/app/icon.png` (512), `src/app/apple-icon.png` (180). The old `icon.svg` is gone.
- Raster, not SVG: the art is painted brush strokes with glow; tracing it would lose that. If a vector original turns up, swap it in.
- Manual check: header at 360 and 1280 px, admin sign-in, admin rail on desktop, the browser tab icon, "Add to Home Screen" on a phone.

## Display font: Castle Chunk (2026-10-01)

- Castle Chunk by Decograph Studio (1001Fonts Free For Commercial Use licence: web embedding and conversion to WOFF2 allowed; licence text in `src/fonts/CastleChunk-LICENSE.txt`), self-hosted as `src/fonts/CastleChunk-Regular.woff2` (13 KB) through `next/font/local`, exposed as the `font-display` utility (`globals.css`).
- Used only for display text: landing hero and section titles, page titles (Create, My videos, Add credits, Profile, Billing, sign-in/up, montage page, not-found), "Added N credits", the share image. Everything people read (forms, labels, body, prices and numbers, errors, dialogs, legal, invoices) stays Inter / mono. Rule recorded in CLAUDE.md §8.
- The font has no ₹ sign; keep prices out of display text.
- Manual check: landing, Create, My videos, Account, sign-in at 360 and 1280 px.

## Finished montages kept in object storage (2026-10-01)

- **Done:** the object-storage health probe and `ENGINEX_STORAGE_URL` are gone (only the probe read it). Finished videos and covers now go to the private `montageai-media` bucket on the `Demo-Minio` connection through the new `store-file` pipeline (`tpl_58P5rbAu2j3C`), one run per file, instead of into Postgres. `/api/jobs/:id/files/:kind` redirects to a fresh share link (≤ 1 h, never stored). New client method `shareStored`; new env `ENGINEX_STORE_PIPELINE` / `_CONNECTION` / `_BUCKET`. 190 tests pass.
- **Finished the same day:** `tpl_58P5rbAu2j3C` published; the worker stored 7 recent jobs from Engine X; a one-off script moved the 44 Postgres copies into the bucket (one retried after a timeout); migration `drop_job_files` then dropped the table (it refuses to run while the table has rows). The Postgres streaming code (`fileResponse`, `parseRange`) is gone. 188 tests pass.
- **Demo:** finish a montage, wait for the `save-files` task, open the job: Admin → job shows `stored` in the output; after an hour the video's network request is a 302 to `enginex-demo-minio.minio.run`.
- **Open:** nothing deletes old montages from the bucket yet (no retention rule).

## Smart Edit 90 s: lyrics as a subtitle file (2026-10-01)

- **Problem:** 90 s Smart Edit montages with a wordy song failed with "spawn E2BIG": the lyrics were one `drawtext` filter per word inside one ffmpeg argument, which passed Linux's 128 KiB per-argument limit. Users weren't charged.
- **Fix:** the app writes the lyrics as subtitle events (`lyricEvents`, `src/server/jobs/lyrics.ts`, sent as the new `subs` input, only lines inside the montage's length); the Smart Edit pipeline turns them into `lyrics.ass` with the job's look and draws them with libass. Same look as before (compared frame by frame on the failed job's lyrics). Details in `docs/enginex-requests.md`.
- **Also:** the job page's clock doesn't run while a job waits in line, and billing ends at Engine X's last step (`lastStepEnd`), not at our next poll.
- **Waiting for:** publishing `tpl_lWBBGBXvtLpa`, then the catalog points Smart Edit at it (`npm run catalog:sync`).
- **Manual check after publish:** make a 90 s Smart Edit with a wordy song (the one that failed): it finishes; lyrics build word by word, slide in and out, in the job's look, never over the intro. Also a 30 s Smart Edit and a Kill Montage (no lyrics, unchanged).

## Result page: the montage's real length, and why it's shorter (2026-10-01)

- **Why:** a montage is never longer than the song, and it ends when the kills run out (no frozen frames), so picking 30 s can give 14 s. The result page showed the length picked, with no explanation.
- **Done:** when a staged job finishes, `outputMeta` records `lengthSec` (how long the plan plays, `planSec` in `plan.ts`) and `songSec` (from the song index). The result page and My videos show the real length; under the stats, `lengthNote` says why when it's over a second short: "Your song is 20 s long, so your montage is too. Pick a longer song…" or "We found 3 kills, enough for 14 s. A longer match with more kills fills all 30 s." Older jobs have no `lengthSec` and show as before. 200 tests pass.
- **Manual check:** a 30 s montage with a ~20 s song, and one from a short clip with 2–3 kills: the right note shows at 360 and 1280 px; a full-length montage shows none.

## Background artwork behind user pages (2026-10-01)

- **Done:** design B from the backgrounds canvas: the user's geometric artwork, half-blended toward red, fixed behind every user page (`src/components/backdrop.tsx`, `.backdrop` in `globals.css`). Served through next/image (`getImageProps` + `<picture>`, AVIF/WebP, desktop 16:9 and a 9:16 phone crop), lazy and low priority so it doesn't affect LCP. Each page sets the veil with `data-backdrop` (levels in CLAUDE.md §8); the landing's lightens around the hero and darkens over the first screen of scrolling (scroll-driven opacity; Firefox stays dark). Hidden when printing. 200 tests pass.
- **Manual check (360 and 1280 px):** landing top shows the art around the hero, scrolled sections read on a dark ground; Create, My videos, a job page, Billing (faint red glow), Account and Terms get darker in that order; the scrolled header panel shows the art through it; printing an invoice shows no background.
