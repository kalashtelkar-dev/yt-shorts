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
- Docker isn't installed on this machine, so Postgres and Redis aren't running. Needed from M3 (install Docker Desktop / OrbStack, or `brew install postgresql@17 redis`).
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

## Milestone 3: DB and seed (code done; not yet run)

**Done**
- `src/db/schema.ts`: Better Auth tables (`users` with `isAnonymous`, `role`, `suspendedAt`), catalog + revisions, jobs + events, credit ledger + balances, settings (single row), admin audit log. Payments and probe tables come with M12 and M9.
- Ledger idempotency is enforced in the DB: unique `(job_id, kind)` where `job_id` is set. A trigger rejects any `UPDATE`/`DELETE` on `credit_ledger`.
- Migrations in `src/db/migrations`; `pnpm db:seed` inserts both catalog items and the settings row (idempotent).

**Demo:** `docker compose up -d && pnpm db:migrate && pnpm db:seed`

**Open issues**
- Docker Desktop fails to start on this machine ("Docker Desktop is unable to start"), so migrations haven't run yet.
- Better Auth's anonymous plugin deletes the anonymous user after linking; ledger rows reference users, so M10 must move rows in `onLinkAccount` first.
