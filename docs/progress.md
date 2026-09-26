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
