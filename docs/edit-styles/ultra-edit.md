# Style: Ultra Edit

The third style (the user's spec, 2026-09-29): every kill gets the same cinematic treatment. It slows into the kill, plays the kill in slow motion, then speed-ramps into a zoom-tilt transition that pinches into the next kill. Loud gunshots play under the song, and the song's words are on screen karaoke-style.

- **Inputs:** gameplay link (or uploaded file), in-game name, song link. Same as the Lyrical Kill Montage.
- **Pipeline:** `style-ultra-edit`, built by `pipelines/build.py` (`style("ultra")`), with the same gameplay-index and song-index as the other styles.

## Structure

```
| intro flex (1-1.5 s, zoom-tilt out) | kill | kill | kill | ... | fade 0.8 s |
```

**One kill (K = the kill-feed time), a fixed 6 s window of the recording from K-2:**

| Recording | Speed | On screen |
|---|---|---|
| K-2 → K-1.75 | 0.5× | 0.5 s |
| K-1.75 → K | 1× | 1.75 s |
| K → K+1 | 0.5× (the kill) | 2 s |
| K+1 → K+2 | 1× | 1 s |
| K+2 → K+4 | a smooth ramp from 0.5× to 3× | 1.43 s |

That's 6.68 s per kill on screen, so a 30 s edit holds the intro plus about four kills.
- **Picture:** one `setpts` time map over the whole window (`WARP`); the ramp is out-time = 0.8·ln(1 + 2.5u). Then `framerate` smooths the result to 60 fps.
- **Game sound:** the same five pieces, each at its own `atempo` (0.5, 1, 0.5, 1, 1.3956), so picture and sound stay together.

**Transitions (in every clip, so a plain concat joins them):**
- **Out:** over the ramp, the frame zooms in (to 1.6×), tilts (to 0.12 rad) and slides right.
- **In:** the next clip starts zoomed (1.4×) and tilted the other way, and pinches back to normal over 0.35 s.
- **Corners:** the zoom always outgrows the tilt, so the rotated frame's corners never show.

**The planner's job:** only which kills and in what order. It gets the shuffled, merged kill list, like the other styles, and copies clip starts (2 s before each kill). Whatever speed or length it writes for a kill clip is replaced (speed 1, 6.68 s). One clip per kill, as in every style.

## Sound

- **Game sound:** the recording goes through `transcribe/separate` (the `instrumental` stem), which drops voice chat and keeps gunshots, footsteps and abilities. It's mixed loud (×1.4).
- **Song:** from its start, at ×0.85.
- **Limiter:** a limiter (0.95) keeps the sum from clipping.

## Lyrics

Same as the Lyrical Kill Montage (see `lyrical-kill-montage.md`):
- force-aligned lines of 3–5 words, building word by word, never before the voice;
- a random spot per line, never the centre;
- one of ten looks per job.

## Checked

- **`check.py`:** input order, the window per kill, the warp and the audio pieces, transitions on every clip, the play time, the mix and the lyrics.
- **Local ffmpeg 7.1 render** on test media: exit 0, 14.65 s for the intro plus two kills. Frames show the zoom-tilt out, the opposite-tilt pinch in, and no black corners.
