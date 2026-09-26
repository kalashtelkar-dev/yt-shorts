# Engine X pipeline change requests

Changes this app needs on the Engine X side. This repo never edits pipelines (CLAUDE.md §4.9).

## 1. Kill Montage (`tpl_QUL4sc1xbOWL`): accept a target length

**Status:** done as a new pipeline, **`tpl_uKbQwmdYcij7`** ("gamer-montage-v6"), imported 2026-09-26; compiles; waiting to be published in the dashboard

**Why:** users pick a 30 / 60 / 90 s montage (PLAN.md §1.1). The published pipeline (v4) only declares `youtubeUrl` and `playerName`, so the chosen length can't reach it. Today the length comes from however many kills the LLM finds (clips capped at 60 s each).

**Ask:** add an input node `durationSec` (text or number, required, one of 30/60/90). Use it in the `find_kills` instruction to pick the best kills that fit the length, and cap the concat total in `ffmpeg_args`. Then publish.

**On our side once it's live:** add `"durationSec": "$durationSec"` to the catalog item's `inputMap` in the admin. No deploy needed.

## 2. Both montages: drafts ahead of published

**Status:** for the pipeline owner to decide

Kill Montage head is v5 but v4 is published; Lyrical is v10 with v9 published. `/v1/run` executes the published version, so any fixes in the drafts aren't live yet. Publish them if they're ready.

## 3. Kill Montage v6 → new pipeline `tpl_uKbQwmdYcij7` (2026-09-26)

The run key can't save over an existing pipeline (authoring needs an admin key), but it can import, so v6 was imported as a new pipeline. The original `tpl_QUL4sc1xbOWL` is unchanged. Built on its head draft (v5), validated with `POST /v1/pipelines/validate` (compiles, engines ffmpeg/ocr/vllm/ytdlp, request = youtubeUrl, playerName, durationSec).

- New input `durationSec` (30/60/90) wired into the LLM instruction and into ffmpeg as a hard `-t` cap.
- Tighter clips: each kill is K−3.5 s to K+1.5 s (was K−10 to K+6 in the v5 draft), merged when < 1.5 s apart; when over the length, drop the clip with the fewest kills (longest first among ties).
- OCR-tolerant name filter: the player name becomes a pattern that accepts 0/O, 1/l/I/i, 5/S, 8/B mix-ups (`player_frames` uses `matches`), so misread names no longer hide whole 10-second blocks.
- Clearer kill rules for the LLM (killer first, victim second; count a row once while it stays on screen); totalKills = kills in the kept clips.
- No kills → rendering is skipped (gate on clip count) and the run returns totalKills 0; the app shows "we didn't find any kills by <name>" and refunds.

**After publishing:** in the admin catalog, set Kill Montage's template to `tpl_uKbQwmdYcij7`, add `"durationSec": "$durationSec"` to its input map, and `"itemSeconds": 10` on its `read_feed` stage (all three are already in the seed). Validate, then save. Running jobs keep the old template.

## 4. Kill Montage v6 (`tpl_uKbQwmdYcij7`): clips too short (2026-09-26)

**Status:** imported as a new pipeline **`tpl_ERjJTGvMAUeS`** ("gamer-montage-v7") on 2026-09-26, because the run key can't save over `tpl_uKbQwmdYcij7` ("authoring a pipeline needs an admin key or a dashboard session") and the dashboard import didn't work for the user. Waiting to be published; then point Kill Montage's template at it in the admin catalog (Validate, then Save). `tpl_uKbQwmdYcij7` itself is unchanged.

**Why:** v6 runs cut each kill to K−3.5…K+1.5 s. With the kill feed sampled once per second, K lands a second or two late, so clips started ~1 s before the kill or missed it; real outputs had 2.5–5.5 s clips and even a 0.5 s one (`573.00-573.50`). The old pipeline (v5) used K−10…K+6 and every clip was 12–14 s with the kill in it.

**Change (instruction node only; built on draft v2, whose only edits were sample values):**
- Step 2 → "For each K make a window from K-10 to K+6 seconds (never below 0). The feed is sampled once per second, so K can be a second or two after the real kill: always keep the full 10 seconds before K for the build-up."
- Step 3 → "Merge windows that overlap or are less than 1 second apart, so a multi-kill becomes one clip. Never shorten a window: every clip is at least 16 seconds long unless it starts at 0. A clip's kills is the number of kill moments inside it."
- Example range → `"123.00-139.00"`.

Full text: `.pipelines/instruction-v3.txt` (local). Validated: compiles, no errors. The upload variant `tpl_24XhRunrxRjQ` has the same short windows and was left unchanged on purpose.
