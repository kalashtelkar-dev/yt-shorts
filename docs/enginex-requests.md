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

**Status:** imported as a new pipeline **`tpl_ERjJTGvMAUeS`** ("gamer-montage-v7") on 2026-09-26, because the run key can't save over `tpl_uKbQwmdYcij7` ("authoring a pipeline needs an admin key or a dashboard session") and the dashboard import didn't work for the user. Published by the user; Kill Montage points at it (admin catalog, validated live). `tpl_uKbQwmdYcij7` itself is unchanged.

**Why:** v6 runs cut each kill to K−3.5…K+1.5 s. With the kill feed sampled once per second, K lands a second or two late, so clips started ~1 s before the kill or missed it; real outputs had 2.5–5.5 s clips and even a 0.5 s one (`573.00-573.50`). The old pipeline (v5) used K−10…K+6 and every clip was 12–14 s with the kill in it.

**Change (instruction node only; built on draft v2, whose only edits were sample values):**
- Step 2 → "For each K make a window from K-10 to K+6 seconds (never below 0). The feed is sampled once per second, so K can be a second or two after the real kill: always keep the full 10 seconds before K for the build-up."
- Step 3 → "Merge windows that overlap or are less than 1 second apart, so a multi-kill becomes one clip. Never shorten a window: every clip is at least 16 seconds long unless it starts at 0. A clip's kills is the number of kill moments inside it."
- Example range → `"123.00-139.00"`.

Full text: `.pipelines/instruction-v3.txt` (local). Validated: compiles, no errors. The upload variant `tpl_24XhRunrxRjQ` has the same short windows and was left unchanged on purpose.

## 5. Kill Montage v8 (`tpl_PsnN7fGHnApj`): 8 s clips (2026-09-26)

**Status:** published by the user; Kill Montage switched to it on 2026-09-26 through the audited catalog save (validated live, no errors or warnings). Imported as a new pipeline because the run key can't save over v7.

**Why:** v7's 16 s clips (K−10…K+6) always caught the kill but left room for only 1–2 kills in a 30 s montage. The user picked K−5…K+3.

**Change from v7 (instruction node only):** window K−5…K+3 ("always keep the full 5 seconds before K"), minimum clip 8 s, example range `"123.00-131.00"`. Everything else is identical to v7. Validated: compiles, no errors.

## 6. Upload version of v8 and faster downloads (2026-09-26)

**Status:** both imported as new pipelines, waiting to be published; then Kill Montage switches to them (template and upload template).

- **`tpl_7fumxOvggmKG`** ("gamer-montage-v8-upload"): the upload pipeline (`tpl_24XhRunrxRjQ`) with v8's instruction (8 s clips). Its only difference from before is the instruction text. Note: `tpl_24XhRunrxRjQ` was never published, so upload jobs would have failed until this replaces it.
- **`tpl_WexN4yE_mfh1`** ("gamer-montage-v9"): v8 plus `concurrentFragments: 8` on the yt-dlp download.

**Why the download was slow:** app and dashboard jobs send identical download settings and start without queueing (`waitMs` ≈ 15 ms). The same 1.35 GB 1080p file took 45 s on one download pod and 152 s on another, and 480–530 s when two ran at once. Speed is YouTube throughput per pod, fetched one fragment at a time. Parallel fragments are yt-dlp's standard fix; the 1080p quality (needed for kill-feed OCR) stays. If it's still slow, the next lever is `height<=720` (about half the size), at some risk to OCR accuracy.

Both validated: compile, no errors.

## 7. Engine names changed on the Engine X side (noticed 2026-09-28)

Engine X renamed its engines: `ytdlp` → `media-fetch`, `ffmpeg` → `video`, `scenedetect` → `scenes`, `whisperx` → `transcribe`, `vllm` → `llm` (and `imagemagick` → `image`). Stored pipelines were migrated server-side and still compile, but documents built with the old names no longer validate, so `.pipelines/*.import.json` files from before are stale; re-`get` a pipeline before editing it. The app keys its friendly errors and automatic retries on engine names; `src/server/jobs/errors.ts` now accepts both.

## 8. Edit analyzer (2026-09-28)

**Status:** use **`tpl_xiLyac3nxPin`** ("edit-analyzer-v3"), waiting to be published. A dev tool for tuning prompts; not used by the app.
- `tpl_aTgr3PL4JeTW` (v1): the contact-sheet step got its ffmpeg arguments as one text string ("Error opening output files: Invalid argument"). Every other step worked, including the ffprobe loudness command.
- `tpl_oRXjkvG0j3zL` (v2): broken draft (imported by mistake after a failed validation; json-parse output can't feed `args` directly). Don't publish.
- v3 passes the arguments through json-parse → merge, as the kill-montage pipeline does.

**What it does:** takes a reference YouTube edit (`youtubeUrl`) and returns what the edit is made of, so the kill-montage instruction can be tuned to copy it:
- exact measurements: duration, resolution, fps, every cut time (scenedetect, adaptive detector, min shot 6 frames), shot count and average shot length;
- audio loudness every 0.25 s (ffprobe astats), for drops and beat-synced cuts;
- speech/lyrics transcript (whisperx large-v3-turbo);
- 8 contact sheets (4×4 frames, time-stamped, spread evenly over the whole video, ~120 frames);
- an LLM (vision) write-up as JSON: summary, format/framing, pacing and beat sync, structure, per-clip roles with seconds before/after each kill, transitions, effects, overlays, audio, what it couldn't tell, and concrete changes to our pipeline.

**Still untested:** whether the `deepsoch-worker` model accepts images (if not, drop the `sheets → analyse.images` wire and it runs on the measurements alone).

## 9. Edit studio (`tpl_5v_XQg1Bc11V`, 2026-09-28)

**Status:** imported, waiting to be published. A version of the edit analyzer that carries on from its JSON to a finished montage. Not wired into the app yet (it needs two new inputs: a reference link and a music link).

**Inputs:** `youtubeUrl` (raw gameplay), `playerName`, `durationSec`, `referenceUrl` (the edit to copy), `musicUrl` (the song).

**Steps:**
1. Reference → the analyzer (cuts, loudness, transcript, contact sheets → vision LLM) → edit plan JSON. The prompt no longer describes our old 5 s / 3 s pipeline (the first run echoed it back), and `format` must copy the measured size.
2. Gameplay → kill-feed OCR (as v9) → an LLM lists kill moments only, no clip windows.
3. Song → audio only → loudness every 0.25 s.
4. Planner LLM: plan + kills + song loudness + target length → `musicStartSec`, the drop, and clips. Clip lengths follow the plan; the only hard rule is that each clip contains its kill (start ≤ K−1.5, end ≥ K+0.5), and cuts should land on the song's beats.
5. Render: per clip a near-square centre crop (width 1.02 × height, full height, HUD kept) scaled to 1080 wide over a blurred, zoomed copy filling 1080×1920; 60 fps; clips joined with hard cuts; the song from `musicStartSec` mixed over the game audio at 30 %; capped at `durationSec`.

**Outputs:** `montage`, `clips`, `totalKills`, `title`, `plan`, `analysis`, `musicStartSec`.

Built by `.pipelines/build-edit-studio.py` (local) from v9 and edit-analyzer-v3. Validated: compiles.

## 10. Edit studio v2 (`tpl_lA-8tjA4SQE7`, 2026-09-28)

**Status:** imported, waiting to be published.

**Why:** the first edit-studio run (`run_36eefda2…`, 15 s target) planned clips of 6, 60, 145 and 106 seconds by "merging" kills minutes apart; the 15 s cap then cut the video off mid-way through clip 2, so most planned kills never appeared and the ending was abrupt. Its stated beat timings didn't add up either.

**Changes:**
- Planner makes choices only: beat length (`beatSec`), `musicStartSec`, `dropAtSec`, and per clip `k` (its kill), `start` (k − lead, lead 1.5–3 s from the reference), `len` (whole beats, lead + 0.5 to 6 s) and `speed` (1, or 0.5 for exactly one clip, on the drop). No merging of kills more than 2 s apart.
- Checked in the graph: clips missing `speed`, shorter than 1 s, longer than 6.5 s or starting before 0 are dropped. Clips are cut by start + duration.
- Play time is computed (sum of lengths, slow clip counted twice); the montage fades in over 0.3 s and fades picture and sound out over 0.8 s, ending exactly at `min(play time, durationSec)`.
- Slow motion is picture only: `setpts=2*PTS` smoothed with `framerate=60`; that clip's game audio is muted and padded to the slowed length so audio stays in sync; the song is untouched.

Built by `.pipelines/build-edit-studio-v2.py` (local) from edit-studio. Validated: compiles; the render command was simulated on a sample plan (normal, slow and reordered/quoted clips).
