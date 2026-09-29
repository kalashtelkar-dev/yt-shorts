# Style: Ultra Edit

The third style (the user's spec, 2026-09-29): every kill gets the same cinematic treatment. It slows into the kill, plays the kill in slow motion, then speed-ramps into a zoom-tilt transition that pinches into the next kill. Loud gunshots play under the song, and the song's words are on screen karaoke-style.

- **Inputs:** gameplay link (or uploaded file), in-game name, song link. Same as the Lyrical Kill Montage.
- **Pipeline:** `style-ultra-edit`, built by `pipelines/build.py` (`style("ultra")`), with the same gameplay-index and song-index as the other styles.

## Structure

```
| intro flex (1-1.5 s, zoom-tilt out) | kill | kill | kill | ... | fade 0.8 s |
```

**One kill (K = the kill-feed time), a fixed 6 s window of the recording from K-2, as steps (`ULTRA_STEPS`):**

| Recording | Speed | On screen |
|---|---|---|
| K-2 → K-1.75 | 0.5× | 0.5 s |
| K-1.75 → K | 1× | 1.75 s |
| K → K+1 | 0.5× (the kill) | 2 s |
| K+1 → K+2 | 1× | 1 s |
| K+2 → K+4 | eight 0.25 s steps easing from 0.5× up to 3× (0.66, 0.97, 1.28, 1.59, 1.91, 2.22, 2.53, 2.84) | 1.42 s |

That's 6.67 s per kill on screen, so a 30 s edit holds the intro plus about four kills (the planner is told to plan only that many).
- **One list for picture and sound:** the picture's time map (one piecewise `setpts`) and the game sound's pieces are both generated from the same step list, so they can't drift apart.
- **Game sound only at normal speed (the user, 2026-09-29):** the game sound plays in the 1× steps at natural pitch, exactly under its picture, with 20 ms fades. In slow motion and the ramp it's silent and the song carries the moment, as in the Kill Montage's slow clips. The shots leading up to each kill fall in the 1× step just before it. Tape-style slow-down (the version before) made gunshots deep and dragged, made the ramp squeak, and those pitched sounds were what the voice removal ate; the user heard all of it as out of sync. The silent pieces still run at their step's speed, so every piece is exactly as long as its picture.
- **The first version was out of sync (2026-09-29):**
  - **The flaw:** it warped the picture along a smooth curve but sped the sound up at one average rate (and time-stretched it with `atempo`, which repeats slices).
  - **Measured on the user's job:** the sound ran up to about 0.5 s ahead of the picture in every ramp.
  - **Measured with a flash-and-click test:** 58–120 ms off through the clip and 305 ms in the ramp before the fix; 0 ms after (worst 19 ms, one frame).

**Transitions (in every clip, so a plain concat joins them):**
- **Out:** over the ramp, the frame zooms in (to 1.6×), tilts (to 0.12 rad) and slides right.
- **In:** the next clip starts zoomed (1.4×) and tilted the other way, and pinches back to normal over 0.35 s.
- **Corners:** the zoom always outgrows the tilt, so the rotated frame's corners never show.

**The planner's job:** only which kills and in what order. It gets the shuffled, merged kill list, like the other styles, and copies clip starts (2 s before each kill). Whatever speed or length it writes for a kill clip is replaced (speed 1, 6.68 s). One clip per kill, as in every style.

## Sound

- **Game sound:** the cut is rendered with the game's own sound, cut from the video itself, so it's in sync. Then `transcribe/separate` removes the voice chat from that short track, keeping the `instrumental` stem (gunshots, footsteps, abilities), before the song goes on. Every style does this; Ultra mixes it loud (×1.4).
- **Song:** from its start, at ×0.85.
- **Limiter:** a limiter (0.95) keeps the sum from clipping.

## Lyrics

**The lyrics start with the kills (the user's choice, 2026-09-29):** the intro plays without words. Only lines that start at or after the intro's end are shown (the intro's length comes from the plan, via the same node the cover still uses). Otherwise the same as the Lyrical Kill Montage (see `lyrical-kill-montage.md`):
- force-aligned lines of 3–5 words, building word by word, never before the voice;
- a random spot per line, never the centre;
- one of ten looks per job.

## Checked

- **`check.py`:** input order, the window per kill, the warp and the audio pieces, transitions on every clip, the play time, the mix and the lyrics.
- **Local ffmpeg 7.1 render** on test media: exit 0, 14.65 s for the intro plus two kills. Frames show the zoom-tilt out, the opposite-tilt pinch in, and no black corners.
