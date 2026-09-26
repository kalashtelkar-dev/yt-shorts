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
