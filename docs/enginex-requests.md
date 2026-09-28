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

## 11. Edit studio v3 (`tpl_xAu428ogpXWz`, 2026-09-28): lyrics on screen

**Status:** imported, waiting to be published.

**Changes from v2:**
- The song goes through `transcribe/separate` (vocals stem) then `transcribe/words` (large-v3) for word timestamps in song seconds.
- The planner also picks one short lyric passage sung during the montage (the hook or the line on the drop), one word per caption (two only if short, ≤ 12 characters), capitals, Latin letters and `? ! . - ’` only, at most 14 captions.
- Captions become drawtext filters; anything unsafe or malformed is dropped (never fatal), and an empty list means no text. Timing comes straight from the word timestamps: each caption shows while `t + musicStartSec` is inside its sung span (the offset is inserted by a `replace` node, not computed by the model).
- Style (from the user's reference): Cinzel Decorative (Google Fonts, OFL) at 140 px, white, centred over the gameplay, soft glow (text drawn on a transparent layer, Gaussian-blurred and overlaid under the sharp text); fades out with the picture.
- New outputs: `captions`, `lyrics` (all words with timings).

Built by `.pipelines/build-edit-studio-v3.py` (local) from v2. Validated: compiles; the caption chain and render graph were simulated (safe, unsafe and empty captions).

## 12. Edit studio v4 (`tpl_0mGYgFucKOSu`, 2026-09-28): response trimmed

**Status:** imported, waiting to be published.

Response is only `montage` and `plan` (the user's request). Removed the other seven response fields and the one step that only fed them (`total_kills`); everything else feeds the plan or the render. The kill count is still inside `plan.totalKills`. When this is wired into the app, the job page will read kills from `plan` instead of a separate output.

## 13. Edit studio v5 (`tpl_-O5E7PQ5DiA7`, 2026-09-28): kills actually in the clips, word captions, transitions

**Status:** imported, waiting to be published.

**Why:** in v3's run (`run_4f4d0e45…`) the planner picked real kills (65, 111, 356, 546, 556 s) but wrote each clip's start as its montage position (0, 3, 6, 9, 12), so every clip came from the first 15 s of the recording and showed no kills; the slow-motion clip had nothing to slow. It also ignored the one-word caption rule, so 8 of 12 captions were dropped as unsafe.

**Changes:**
- Allowed clip starts are computed in the graph from the kill times: kill − 2.5 s for normal clips, kill − 1 s for the slow-motion clip (never below 0). The planner copies a start from those lists; any clip whose start isn't on them is dropped (regex allow-list via `json-filter matches`).
- Clip rules: normal 3–6 s in whole beats; exactly one slow-motion clip of 1.5–2 s (plays 3–4 s), on the best kill.
- Captions come from the timed words, not the planner: the planner gives `lyricStartSec`/`lyricEndSec`; the graph keeps the words in that window with confidence ≥ 0.3, drops slurs (small blocklist), turns `'` into `’`, strips punctuation, and shows each word while it's sung.
- Transitions at every cut: white flash (0.12 s) and zoom punch (8 %, 0.2 s); the slow-motion clip gets 0.25 s and 15 %.

**Risk:** if the planner still invents starts, every clip is dropped and the run ends without a montage (the plan output shows why).

Built by `.pipelines/build-edit-studio-v5.py` (local) from v4. Validated: compiles; starts, allow-list, captions and clip filters simulated on the v3 run's real kills and words.

## 14. Edit studio v6 (`tpl_dvIkhyi3E42V`, 2026-09-28): lyric captions actually appear

**Status:** imported, waiting to be published.

**Why:** v5's run (`run_7e338a2e…`) rendered kills but no text. The song (`H2N0eHGOi_w`, a phonk track) has one sung word; the transcriber auto-detected Korean and wrote "오마!" ("Oh my!"). The planner picked the window 7.43–8.31 s, but the word ends at 8.313 s, so the "end ≤ 8.31" filter dropped it by 3 ms and every caption step was skipped.

**Changes:** words are kept by their start time within the planner's window ± 0.15 s; lyrics are transcribed with `language: en` (non-English songs would need this changed).

**Note:** captions can only show words the song actually sings; a mostly instrumental track gives one or two words at most.

## 15. Edit studio v7 (`tpl_nCx2XLcZLRhg`, 2026-09-28): a lyric word at every cut

**Status:** imported, waiting to be published.

- The planner gives each clip a `word`: the strongest English word of the lyric sung at or just after that cut, capitals, letters only, ≤ 12, or "" when the song has no usable English lyrics.
- Each clip with a valid word shows it big at the cut: Cinzel Decorative 150 px, centred, soft glow (its own transparent layer, blurred), for the first 0.5 s of the clip, fading out over the last 0.15 s. It's drawn inside the clip's own filter chain, so it lands exactly on the transition with no timing arithmetic. Clips without a valid word render as before.
- The running sung-word captions move to the lower blur band at 84 px, so the two never overlap.
- On-screen text is English letters only everywhere (lyrics transcribed with `language: en`; anything else is dropped).

Built by `.pipelines/build-edit-studio-v7.py` (local) from v6. Validated: compiles; all four clip variants (normal/slow × with/without word, plus an invalid word) simulated.

## 16. Edit studio v8 (`tpl_x4p9irJIKNb-`, 2026-09-28): pruned; montage = song length

**Status:** imported, waiting to be published.

**Inputs:** `youtubeUrl`, `playerName`, `referenceUrl`, `musicUrl` (no `durationSec`: the montage is as long as the song, which plays from its start).

**Removed (119 → 107 nodes):**
- `start_ok`: covered by `start_allowed` (allowed starts are already clamped at 0).
- `clip_list_text`, `filters_list`, `filters_joined`, `labels_list`, `labels_joined`: clip objects are joined with no separator and the regexes write filter text directly instead of a JSON array that was parsed and joined again.
- `caption_list`, `caption_none`: same for captions; one regex keeps the drawtext pieces and yields "" when there are none.
- `ref_transcript`: the reference's own transcript isn't used for our edit.
- `duration_sec`, `music_start`, `caption_offset`: replaced by the song's duration (`music.duration`) and a song start of 0; the planner no longer chooses `musicStartSec`.

**Tested** with `.pipelines/emulate.py` (local interpreter for the util nodes): it reproduces the real v7 run's render command exactly (`run_2968991c…`, 18,849-character filter graph, 66 text overlays). The prune-only graph builds the identical command; full v8 matches v7 run with a song start of 0 and length 22 s apart from the two intended edits (no song trim, caption timing on `t`). Edge cases also match: no lyrics, a non-English word, invalid clip starts, no clips.

## 17. Edit studio v9 (`tpl_EvWSAu_Qa_wk`, 2026-09-28): 107 → 77 nodes; text only in the centre

**Status:** imported, waiting to be published.

**Why:** the user found the graph too big and the running lyrics read as captions in the bottom band; text should only appear in the centre.

**Removed (30 nodes):**
- The running-lyrics chain (18): only the big centred word at each cut remains. The planner no longer picks a lyric window.
- End-time maths (5): the video now holds its last frame if the clips run short (`tpad`), the song plays to its end (`amix duration=first`) and the fade starts at song length − 0.8 s. Same result when the clips fill the song (the normal case).
- Allowed-start formatting (5): one `a|b|c` list feeds both the planner and the allow-list check; the clamp at 0 is gone (only matters for a kill in the first 2.5 s of the recording).
- `llm_text` (a one-line header before the OCR text) and `clip_id_range` (the regexes only read the fields they need).

**Tested** with `.pipelines/emulate.py` on the real v8 run (`run_aed2834c…`): the interpreter reproduces v8's render command exactly; v9's clips, cut words, slow motion and transitions are identical; the only differences are the removed bottom captions (20 → 0) and the new end handling (fade still at 21.2 s for this run).

Utility nodes ("no job") run inside the scheduler in milliseconds; the run time is in the engine jobs (download, kill-feed strips, OCR, lyrics, analysis, render).

## 18. Stage pipelines (2026-09-28): gameplay-index, song-index, style-kill-montage, style-lyrical-kill-montage

**Status:** all five imported, waiting to be published. Source of truth is now `pipelines/` in the repo (built by `pipelines/build.py`, checked by `pipelines/check.py`).

| Pipeline | Id |
|---|---|
| gameplay-index | `tpl_yYsSXHkQXJBP` |
| gameplay-index-upload | `tpl_K6Lo3rwFya4A` |
| song-index | `tpl_sfY_wbow51wN` |
| style-kill-montage | `tpl_L9GCGiLR4xdr` |
| style-lyrical-kill-montage | `tpl_yd7ODZifX40-` |

Specs: `docs/edit-styles/`. New over v8: intro-flex candidates from the vision model (gameplay-index), flex clip + 1.5× speed-up clips with a whip blur, per-run `variation`, `maxDurationSec` cap, and (lyrical) every sung word centred and glowing with the hook bigger. Both styles' render commands were built with the emulator and rendered with a real ffmpeg 7.1 on stand-in media (exit 0, 1080×1920, 60 fps, audio).

## 19. Stage pipelines, second import (2026-09-28)

**Status:** imported as drafts, waiting to be published. They replace `tpl_5qece0gK2fgX`, `tpl_ot0JpJ0pzOr7`, `tpl_xf7oCU4999sK` and `tpl_TAR3yOXmFDte`; song-index is unchanged. The ids in §18's table now point at these.

- **gameplay-index and gameplay-index-upload:** the flex contact sheets decode keyframes only (`-skip_frame nokey`). The first live runs on 19–25 min matches were still on this step after 25 minutes.
- **Both styles:** accept the kill finder's bare-number lists (`[67, 176]`) as well as `[{"t":67}]`, and the same for flex. `check.py` covers it.

## 20. style-lyrical-kill-montage, third import (2026-09-28): render input order

**Status:** imported as `tpl_yd7ODZifX40-`, waiting to be published. It replaces `tpl_DtMrjAKAX5Pl`.

- **The bug:** every lyrical render failed with "Invalid data found when processing input". The copied v8 edge put the caption font first into `make_montage`, so the font became `{in0}` and ffmpeg read it as the gameplay. The filter expects `{in0}` gameplay, `{in1}` song, `{in2}` font.
- **The fix:** the same nodes and edges, reordered. `check.py` now asserts the render input order for both styles.

## 21. Both styles (2026-09-28): two speeds, a hold after each kill, ten lyric looks

**Status:** imported as drafts, waiting to be published: style-kill-montage `tpl_dUktOJyZOv-K` (replaces `tpl_L9GCGiLR4xdr`), style-lyrical-kill-montage `tpl_DFhPatfbngu3` (replaces `tpl_yd7ODZifX40-`). The index pipelines are unchanged.

- **No speed-ups:** the 1.5× clips and their nodes are gone (`fast_filters`, `fast_clips`, `fast_sum`, `three`, `fast_saving`, `play_net`). A new `speed_ok` filter drops any clip that isn't 1× or 0.5×.
- **Hold after each kill:** a `hold_table` keyed by `maxDurationSec` gives 1 s at 15 s, 1.5 s at 30 s, 2 s at 60 s and 4 s at 90 s (2 s otherwise). It sets the planner's minimum clip lengths (normal = 2.5 + hold, slow = 1 + hold/2). Two regexes on the plan text then lengthen any kill clip below its minimum before the clip checks (`hold_normal`, `hold_slow`); the flex clip is excluded. `len_max` goes from 6.5 to 10.
- **Lyric looks (lyrical):** a new input `lyricLook` (a digit 0–9, random per job from the app) picks one of ten looks from `look_table`. `caption_font` downloads the ten fonts, and its command (from `font_args`) copies the chosen one out as `caption.ttf`. The look's word and hook styles (size, colour, outline, shadow) are wired into `caption_draw` and `hook_draw` as their `replace`.
- **Checked** with `check.py` (32 checks, including the "below N" regexes against every value from 0 to 9.99) and with a local ffmpeg 7.1 render of looks 3 and 6 on a real match.
