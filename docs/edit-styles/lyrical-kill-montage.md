# Style: Lyrical Kill Montage

The Kill Montage (see `kill-montage.md`) plus **the song's words on screen**, timed to the singing, over a short intro flex and a mixed-speed kill section.

- **Inputs:** gameplay link (or uploaded file), in-game name, song link with clear English vocals.
- **No reference video:** this file is the reference.

## Reference

**Untouchable - Valorant Edit** (`H2N0eHGOi_w`, 17.9 s, 1920×1080, 60 fps).

**How it was read:**
- **Every frame, numerically:** all 1,071 frames at 60 fps were measured for cuts, flashes, repeated frames and motion.
- **By eye:** contact sheets at 10 frames per second.
- **Machine analysis:** edit-analyzer-v3, saved in `analysis/H2N0eHGOi_w.json`.

| Measured | Value |
|---|---|
| Song tempo | fast (onsets ≈ every 0.32 s) |
| Opening | 0–0.5 s fade in from black |
| Intro flex | 0.6–6.2 s. Holding the rifle, then moving through the map. Whip blurs (directional smear) at 1.7, 2.5 and 3.1 s link angles without hard cuts. First kills 3.7–4.6 s. Wind/wisp overlay 5.0 s. Ends pushing in on a poster |
| Drop | 6.3 s: white flash (3 frames), grade switches from cool blue to red/pink |
| Hook text | "UNTOUCHABLE", four times: 6.6, 9.2, 11.8 and 13.0 s. Each time it builds letter by letter with the singing ("UN" → "UNTOUCH" → "UNTOUCHABLE") over about 1 s, then holds, then streaks out |
| Text look | Heavy rounded sans-serif, white, strong glow. Tilted/3D and motion-blurred while animating. Centred over the gameplay (once in the lower third, 12.0–13.4 s) |
| Kill section | 6.4–16.6 s. Shots 3.0, 5.2, 1.45 s, then 0.13 and 0.43 s at the end |
| Speed | speed-up 9.0–9.5 s. Smooth slow motion 14.25–15.5 s (dome kill, then scope held) |
| Other effects | light-leak wipe (8.1 s), RGB-split glitch (9.9 s), black bars zooming on the kill banner (12.0–13.4 s), camera shake on kills |
| Ending | whip blur into black at 16.6 s |

**What makes it work:**
- The lyric isn't subtitles: it's one hook word treated as a graphic, built up in time with the vocal and repeated on each chorus hit.
- The drop is marked three ways at once: flash, colour change and the word appearing.

## Structure

```
| intro flex (≈1 s) | kill section with lyrics ........................... | end |
0                   ^ drop: white flash, grade change, first lyric       song end - 0.8 s
```

1. **Intro flex, about 1 s:** a no-kill moment as in the Kill Montage (knife, inspect, movement). It ends on a white flash.
2. **Kill section:** same rules as the Kill Montage (normal and slow clips in a shuffled order every run, the same hold after each kill, transitions at every cut). On top of it, the lyrics.
3. **End:** the last clip lands on the song's last hit, then a 0.8 s fade.

## Lyrics on screen

- **Source (song-index):** `transcribe/separate` gives the vocals stem. `transcribe/transcribe` (large-v3, English, its own alignment off) gives the segments. `transcribe/align`, the forced aligner, then times every word in each segment on the vocals.
- **Never before the voice (the user's rule, 2026-09-29):** `voice-activity/segments` on the vocals stem marks where someone is singing. The aligner sometimes stretches a phrase's first word back over what came before it. In Industry Baby, an untranscribed producer tag made "Baby" 1.07–2.71 s, though it's sung from 2.37 s. A sung word has no silence inside it, so a word starts at the last point inside it where the voice comes in. On that song this moved 3 of 236 words, all long words with a silent gap. Otherwise the aligner's time stands.
- **Lines, karaoke-style (the app, `src/server/jobs/lyrics.ts`; the user's choice, 2026-09-28):**
  - **Cutting:** each segment becomes lines of 3–5 words, cut evenly (7 words → 4 + 3). A line never mixes two segments.
  - **Build-up:** a line builds up word by word, each word appearing when it's sung. The line stays until its last word ends (or until the next line when the gap is under 0.3 s), then vanishes and the next line starts. Only one line is on screen at a time.
  - **Rows:** a line longer than 16 characters gets two rows. The top row stays complete while the bottom row builds.
  - **No shifting:** every step of a row starts at the full row's left edge. That edge is estimated from the row's length and the look's average letter width, measured per font and 5% generous, so a right-aligned row stays inside the frame.
  - **Cleaning:** English letters only, curly apostrophes, no punctuation, and slurs are dropped.
- **Where: a random spot for every line (the user's choice, 2026-09-28), never the centre:** the upper or lower third of the gameplay band, left, middle or right. It's never the same spot twice in a row, and it's repeatable per job (seeded). The spots are `SPOTS` in `pipelines/build.py`. The text is never in the blurred bands and never styled like subtitles.
- **Look: a different one every job (the user's choice, 2026-09-28):** thick, as bold as possible, with shadows.
  - **Ten looks:** the app sends a random digit (`lyricLook`), and the pipeline maps it to a heavy Google font with its own colours: Anton, Archivo Black, Bungee, Luckiest Guy, Titan One, Black Ops One, Russo One, Bowlby One, Rubik Mono One and Passion One Black. The list is `LOOKS` in `pipelines/build.py`.
  - **On every row:** a 4–6 px dark outline and a hard offset shadow (black, or red or purple in some looks), plus the glow (a blurred copy of the text under it).
  - **Size:** a 16-character row fills about 72% of the width, so the words sit on the gameplay without covering it (the user asked for smaller text on 2026-09-28).
  - **Replaced:** Cinzel Decorative centred one word at a time (v8); then one centred word at a time with a bigger hook word.
- **Motion (the user's choice, 2026-09-29):** each line slides in from a random side (left, right, top or bottom; 240 px sideways or 160 px vertically, 0.18 s, easing out, fading in) as its first word is sung. It slides out toward another random side (0.2 s, easing in, fading out) right after its end, often while the next line slides in at its own spot. Every word-step of a line carries the line's start, end and sides, so the line moves as one piece and never flickers as words are added.
- **Sync:** the timestamps come straight from the aligner. The song plays from 0, so montage time = song time. The model never computes caption times or writes caption text.
- **No lyrics:** if the song has no clear English vocals, no text shows and the montage still renders, which then looks the same as a Kill Montage.

## What the pipeline needs (maps to edit-studio v8)

| Step | Status in v8 | Change |
|---|---|---|
| Everything in the Kill Montage table | see `kill-montage.md` | same |
| Vocals, then word timestamps | works (v3+) | none |
| Words on screen | v8: running words in the bottom band, plus cut words in the centre (the user rejected the bottom band) | Show the running words in the centre, one at a time, glowing. Drop the separate cut-word track, since the running words already land on the cuts. Avoid v5's mistake of letting the planner write caption text |
| Hook treatment | tried, then removed | The bigger hook word didn't fit multi-word lines; lines replaced it |
| Intro flex ≈ 1 s | missing | Same as the Kill Montage, with the flex capped at 1–1.5 s |
