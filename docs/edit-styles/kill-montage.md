# Style: Kill Montage

A 9:16 Valorant/CS2 montage cut to a song: a short **intro flex**, then **back-to-back kills** at mixed speeds, synced to the beat.

- **Inputs:** gameplay link (or uploaded file), in-game name, song link.
- **No reference video:** this file is the reference.
- **Length:** the song's length, capped by the length the user picks.

## Reference

**Beggin' (Valorant Montage)** (`vQqU0F8vTOE`, 95 s, 1920×1080, 60 fps).

**How it was read:**
- **Every frame, numerically:** all 5,700 frames at 60 fps were measured for cuts, brightness flashes, repeated frames and motion.
- **By eye:** contact sheets at 4 frames per second, plus frame-by-frame around every cut.
- **Machine analysis:** edit-analyzer-v3, saved in `analysis/vQqU0F8vTOE.json`.

**Parts we copy:** the intro flex (5–16.8 s), the drop (16.8 s) and the kill sections (16.8–39 s, 72–89 s).

**Parts we don't copy:** the creator logo (0–4.8 s), the skits and subtitle story (39–72 s), the end card and the promo.

| Measured | Value |
|---|---|
| Song tempo | ≈ 133 BPM (beat 0.45 s) |
| Intro flex | 11.8 s continuous (5.0–16.8), relaxed movement, ability use, knife and gun in hand, 2 stylish kills inside it, parts in smooth slow motion (5.25–5.75, 9.25–9.75, 10.25–11.0) |
| Drop | 16.8 s: white flash (3 frames at luma ≈ 238), then the kill section |
| Opening burst | 16.8–24 s: 12 cuts, shots 0.18–0.63 s (≈ 1 beat each), back-to-back kills |
| Kill section after the burst | shots 1.2–5.4 s, median ≈ 1.4 s |
| Speed-ups (ramps, heavy motion blur) | 19.5–21.5, 23–25, 31–32.5, 72–75, 83–84.5 s |
| Slow motion (smooth, interpolated, on the kill) | 28.0–28.75 (scope), 34.25–34.75 (scope kill), 36.25–37.0 s |
| Freeze on a hit | 75.5–77.5 s (single held frame, glow) |
| Transitions | Mostly hard cuts on the beat. Whip blur (directional smear, 1–2 frames) into ~1 in 3 clips. White flash on the drop and on big kills. Zoom into the scope circle on sniper kills |
| Game audio | Kept under the music: gunshots and kill sounds audible |
| Text | None over the gameplay |

**What makes it work:**
- The flex is calm and long enough to set the mood.
- The drop switches everything on at once: flash, then fast cuts.
- The kills never repeat a rhythm. A speed-up runs into a kill, the kill itself plays at normal speed or slowed, then it cuts on the next beat.

## Structure

```
| intro flex | kill section ......................................... | end |
0          ~3 s (up to the song's drop)                          song end - 0.8 s fade
           ^ white flash on the drop
```

1. **Intro flex (2–4 s, until the drop if the drop is sooner).**
   - **What it shows:** gameplay with no kill. Knife out, weapon inspect, walking or jumping, utility, buy phase.
   - **Where it comes from:** a quiet stretch at least 6 s away from any kill.
   - **Speed:** normal, or smooth slow motion if the song is calm there.
2. **Kill section.**
   - **Content:** one clip per kill, in time order or in the plan's order. A kill that comes within the hold time of the previous one shares its clip (multi-kill).
   - **Clip shape:** a normal clip starts 2.5 s before the kill-feed time, a slow clip 1 s before.
   - **Hold after each kill (the user's rule, 2026-09-28):** every kill stays on screen for a minimum time before the next clip starts.

     | Length picked | Hold | Shortest normal clip | Shortest slow clip (plays 2×) |
     |---|---|---|---|
     | 15 s | 1 s | 3.5 s | 1.5 s |
     | 30 s | 1.5 s | 4 s | 1.75 s |
     | 60 s | 2 s | 4.5 s | 2 s |
     | 90 s | 4 s | 6.5 s | 3 s |
     | any other | 2 s | 4.5 s | 2 s |

     The planner is told these minimums. Any kill clip it still makes shorter is lengthened to the minimum, never dropped. The flex clip has no kill and is left alone.
   - **Speed:** each clip gets one speed, chosen per run in a shuffled order (see below).
3. **End:** the last clip lands on the song's last strong hit, then the picture and sound fade out over 0.8 s.

### Speeds: normal and slow motion, in a random order

| Speed | Picture | Game audio | Use |
|---|---|---|---|
| Normal (1×) | as is | as is | most kills |
| Slow motion (0.5×) | half speed, smoothed to 60 fps | muted for that clip (song carries it) | the best kill, a multi-kill, a sniper kill |

**Rules:**
- **No speed-ups:** removed by the user on 2026-09-28. A speed-up the planner still writes is dropped.
- **Mix:** at least one slow clip, at most 1 slow clip for every 4 clips.
- **Order:** random every run. A slow clip can be first, third, seventh or last.
- **Variety:** the same match must give different orders on different runs, so the app passes a random seed to the planner.
- **Drop:** a slow clip or the strongest kill lands on the song's drop.

## Look

- **Frame:** 1080×1920 at 60 fps.
  - **Middle band:** a near-square centre crop of the gameplay (crop width 1.02 × height, full height, HUD kept), scaled to 1080 wide.
  - **Top and bottom:** a blurred, zoomed copy of the same frame.
- **Transitions, at every cut:**
  - a 0.12 s white flash and a zoom punch (8 %, 0.2 s);
  - on the drop, a longer flash (0.25 s) and a 15 % punch.
- **Text:** none.
- **Audio:**
  - **Song:** from its start, at full volume.
  - **Game audio:** at 30 %.

## What the pipeline needs (maps to the edit-studio v8 graph)

| Step | Status in v8 | Change |
|---|---|---|
| Kill times from the kill feed (1 fps OCR, name-tolerant) | works | none |
| Intro flex | missing | New: sample quiet stretches (≥ 6 s from any kill) into time-stamped contact sheets. The vision model picks a 2–4 s window showing knife, inspect or movement. The graph checks it's ≥ 6 s from kills |
| Song beats, drop | works (loudness every 0.25 s) | none |
| Clip starts from the pipeline's allow-list, never from the model | works (v5+) | none |
| Speed per clip | normal and 0.5 only | Keep only these two (a 1.5× version was built and then removed at the user's request). Planner gets a random seed and the mix rules above |
| Hold after each kill | missing | The hold table above, by length; kill clips below the minimum are lengthened |
| Length = song length | works (v8) | Keep v8's ending: the video ends when clips run out. Never hold a frozen frame (v9's bug) |
| Lyrics / text | cut words in v7/v8 | Off for this style |
