# Edit styles

Each edit style is a written spec, and later its own pipeline.

- **Specs:** they come from reference edits read frame by frame. Their measurements are in `analysis/`: the JSON from edit-analyzer-v3, plus the frame analysis written into each spec.
- **No reference at run time:** users never pass a reference video; the style is fixed.

| Style | Spec | Reference |
|---|---|---|
| Kill Montage | [kill-montage.md](kill-montage.md) | Beggin' (Valorant Montage), `vQqU0F8vTOE` |
| Lyrical Kill Montage | [lyrical-kill-montage.md](lyrical-kill-montage.md) | Untouchable - Valorant Edit, `H2N0eHGOi_w` |

**To add a style:**
1. Run edit-analyzer-v3 on a reference.
2. Read its frames.
3. Write a spec in the same shape: reference measurements, structure, look, and what the pipeline needs.

## What worked and what didn't (edit-studio v1–v9, 2026-09-28)

**Worked, and stays in every style:**
- **Kill times:** from the kill feed (1 fps OCR, crop top-right, OCR-tolerant name pattern), found by a model that only lists kill times (v2+).
- **Clip starts:** computed from those kill times (kill − 2.5 s normal, − 1 s slow). The planner copies one from the list, and a check drops any clip whose start isn't on it (v5+).
- **Beats and drop:** from the song's loudness every 0.25 s (ffprobe astats).
- **Lyrics:** separated vocals, then word timestamps in English (v3+). Words are filtered by their start time with a ±0.15 s margin (v6).
- **Layout:** the 9:16 near-square sharp band over a blurred copy; flash plus zoom punch at every cut; picture-only slow motion (game audio muted and padded, song untouched) (v2, v5).
- **Length:** equals the song, which plays from 0. The video ends when the clips run out (v8).
- **Testing:** `.pipelines/emulate.py` reproduces a real run's render command exactly, so graph edits can be tested for identical output offline.

**Failed, and never again:**
- **v1:** the planner "merged" kills minutes apart into 60–145 s clips. So the model never sets clip bounds freely; lengths are checked (1–6.5 s).
- **v3:** the planner wrote clip starts as montage positions (0, 3, 6…), so no kills appeared. Starts come only from the allow-list.
- **v3:** the planner wrote whole lines as captions and ignored "one word". Caption text only comes from the word timestamps.
- **v5:** a caption window filtered by `end ≤ x` dropped a word by 3 ms, and auto language detection wrote English as Korean. Filter by start with a margin, and force English.
- **v7/v8:** running lyrics in the bottom band read as subtitles. Text only in the centre of the gameplay.
- **v9:** held the last frame when clips ran short, freezing for 6 s to 2 min. Never pad with frozen frames.
- **Ffmpeg-in-a-template:** a `custom` step's arguments must pass template → json-parse → merge. A plain text template becomes one argument ("Error opening output files").
- **Lists:** filter nodes output lists, and every single-value node after them runs once per item. Rebuild one text before regexes, and count with the filter's `count`.

## Proposed production architecture: split into stage pipelines

Today one pipeline does everything in one run: about 107 nodes and 4–6 minutes. For production, split it by what can be reused:

| Pipeline | Input | Output | Heavy steps | Reuse |
|---|---|---|---|---|
| `gameplay-index` | gameplay link or upload, player name | video key, kill times, flex candidates (contact sheets + times) | download (≈ 50 s), kill-feed strips (≈ 45 s), OCR (≈ 60 s), kill finder | cached per (video, player). Any style or song re-renders without redoing this |
| `song-index` | song link | audio key, duration, loudness/beats, word timestamps | audio download, vocal separation, word timing (≈ 5–35 s) | cached per song |
| `style-<name>` (one per style) | the two indexes above + a random seed | montage + plan | planner model call, render (≈ 45–60 s) | cheap; one run per edit |

**Why:**
- **Concurrency:** the two index runs start in parallel as separate runs, and many users' renders run side by side.
- **Speed:** re-renders skip about 3 minutes of downloading and OCR.
- **Reliability:** each stage retries on its own; a render failure doesn't redo the OCR.
- **Accuracy work:** each stage's output is stored, so each can be measured and improved separately.
- **Size:** each graph is small (≈ 20–35 nodes).

**In the app:**
- **New DB table:** a `media_index` table (by URL hash plus player name) caches index results and their storage keys.
- **Worker:** the job worker becomes a small stage machine: `index (gameplay ∥ song) → style render → done`. Refund on failure is as today.
- **Catalog:** each style is a catalog item (Kill Montage, Lyrical Kill Montage) pointing at its `style-*` pipeline.

**Accuracy testing:**
- **Labelled set:** 3–5 matches with hand-labelled kill times.
- **Measures:** kill-detection precision and recall, the share of clips that contain their kill, and whether text timing matches the vocals (±0.1 s).
- **Render checks:** duration equals the song, text overlay counts, speeds as planned. They run offline with the emulator on stored stage outputs.
