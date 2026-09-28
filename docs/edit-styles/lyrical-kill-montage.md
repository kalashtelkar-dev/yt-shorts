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
2. **Kill section:** same rules as the Kill Montage, with mixed normal, slow and speed-up clips in a shuffled order every run, and transitions at every cut. On top of it, the lyrics.
3. **End:** the last clip lands on the song's last hit, then a 0.8 s fade.

## Lyrics on screen

- **Source:**
  - `transcribe/separate` gives the vocals stem, then `transcribe/words` in English gives each word with its start and end.
  - The pipeline keeps confident words (score ≥ 0.3), strips punctuation, blocks slurs, and allows English letters only.
- **What shows:**
  - **Every sung word** while the montage plays, **one word at a time**, from its start to its end (the next word replaces it).
  - **The hook word** (the most repeated word or line, e.g. "UNTOUCHABLE") gets the big treatment each time it's sung, as in the reference.
- **Where:** centred on the gameplay band (never in the blurred bands, never styled like subtitles).
- **Look:**
  - **The user's choice:** Cinzel Decorative (Google Fonts): white, glowing, big (140–150 px), capitals.
  - **The reference's alternative:** a heavy rounded sans (e.g. Montserrat ExtraBold).
  - **Glow:** a blurred copy of the text under the sharp text.
- **Motion, in steps:**
  1. **Now:** each word appears on its sung start with a quick scale-pop (≈ 0.1 s) and leaves on its end.
  2. **Next:** the hook word is built letter by letter over its sung duration (prefix reveal), as in the reference.
- **Sync:** the words' timestamps come straight from the transcription. The song plays from 0, so montage time = song time. The model never computes caption times.
- **No lyrics:** if the song has no clear English vocals, no text shows and the montage still renders, which then looks the same as a Kill Montage.

## What the pipeline needs (maps to edit-studio v8)

| Step | Status in v8 | Change |
|---|---|---|
| Everything in the Kill Montage table | see `kill-montage.md` | same |
| Vocals, then word timestamps | works (v3+) | none |
| Words on screen | v8: running words in the bottom band, plus cut words in the centre (the user rejected the bottom band) | Show the running words in the centre, one at a time, glowing. Drop the separate cut-word track, since the running words already land on the cuts. Avoid v5's mistake of letting the planner write caption text |
| Hook treatment | missing | The planner names the hook word (a copy from the words list). Each time it's sung it renders larger (150 px) with a pop |
| Intro flex ≈ 1 s | missing | Same as the Kill Montage, with the flex capped at 1–1.5 s |
