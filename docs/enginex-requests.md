# Engine X pipeline change requests

Changes this app needs on the Engine X side. This repo never edits pipelines (CLAUDE.md §4.9).

## 1. Kill Montage (`tpl_QUL4sc1xbOWL`): accept a target length

**Status:** open (found 2026-09-26 via `pnpm enginex:smoke`)

**Why:** users pick a 30 / 60 / 90 s montage (PLAN.md §1.1). The published pipeline (v4) only declares `youtubeUrl` and `playerName`, so the chosen length can't reach it. Today the length comes from however many kills the LLM finds (clips capped at 60 s each).

**Ask:** add an input node `durationSec` (text or number, required, one of 30/60/90). Use it in the `find_kills` instruction to pick the best kills that fit the length, and cap the concat total in `ffmpeg_args`. Then publish.

**On our side once it's live:** add `"durationSec": "$durationSec"` to the catalog item's `inputMap` in the admin. No deploy needed.

## 2. Both montages: drafts ahead of published

**Status:** for the pipeline owner to decide

Kill Montage head is v5 but v4 is published; Lyrical is v10 with v9 published. `/v1/run` executes the published version, so any fixes in the drafts aren't live yet. Publish them if they're ready.
