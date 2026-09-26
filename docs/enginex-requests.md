# Engine X pipeline change requests

Changes this app needs on the Engine X side. This repo never edits pipelines (CLAUDE.md §4.9).

## 1. Kill Montage (`tpl_QUL4sc1xbOWL`): accept a target length

**Status:** prepared as v6 draft (`.pipelines/tpl_QUL4sc1xbOWL.v6.json`), compiles; waiting for approval to save and publish

**Why:** users pick a 30 / 60 / 90 s montage (PLAN.md §1.1). The published pipeline (v4) only declares `youtubeUrl` and `playerName`, so the chosen length can't reach it. Today the length comes from however many kills the LLM finds (clips capped at 60 s each).

**Ask:** add an input node `durationSec` (text or number, required, one of 30/60/90). Use it in the `find_kills` instruction to pick the best kills that fit the length, and cap the concat total in `ffmpeg_args`. Then publish.

**On our side once it's live:** add `"durationSec": "$durationSec"` to the catalog item's `inputMap` in the admin. No deploy needed.

## 2. Both montages: drafts ahead of published

**Status:** for the pipeline owner to decide

Kill Montage head is v5 but v4 is published; Lyrical is v10 with v9 published. `/v1/run` executes the published version, so any fixes in the drafts aren't live yet. Publish them if they're ready.

## 3. Kill Montage v6 (prepared 2026-09-26)

Built on the head draft (v5), validated with `POST /v1/pipelines/validate` (compiles, engines ffmpeg/ocr/vllm/ytdlp, request = youtubeUrl, playerName, durationSec).

- New input `durationSec` (30/60/90) wired into the LLM instruction and into ffmpeg as a hard `-t` cap.
- Tighter clips: each kill is K−3.5 s to K+1.5 s (was K−10 to K+6 in the v5 draft), merged when < 1.5 s apart; when over the length, drop the clip with the fewest kills (longest first among ties).
- OCR-tolerant name filter: the player name becomes a pattern that accepts 0/O, 1/l/I/i, 5/S, 8/B mix-ups (`player_frames` uses `matches`), so misread names no longer hide whole 10-second blocks.
- Clearer kill rules for the LLM (killer first, victim second; count a row once while it stays on screen); totalKills = kills in the kept clips.
- No kills → rendering is skipped (gate on clip count) and the run returns totalKills 0; the app shows "we didn't find any kills by <name>" and refunds.

**After publishing:** add `"durationSec": "$durationSec"` to Kill Montage's input map in the admin catalog (already in the seed), and `"itemSeconds": 10` on its `read_feed` stage for "x of y scanned" progress.
