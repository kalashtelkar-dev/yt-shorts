"""Regression check for the style pipelines: builds each style's render command from fixed inputs with the
emulator and asserts what it must contain. Run after changing build.py:  python3 pipelines/check.py"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from emulate import run

# lyric lines as the app sends them (src/server/jobs/lyrics.ts): 3-5 words, one or two rows, song seconds
# lyrics as the app sends them (src/server/jobs/lyrics.ts): one item per step of a line building word by word
NO_TEXT = {"s": 0, "e": 0, "t": "", "r": 0, "n": 0, "p": 0}  # the app always adds it, so the text steps never see an empty list
lines = [{"s": 0.49, "e": 0.69, "t": "I’m", "r": 0, "n": 11, "p": 0}, {"s": 0.69, "e": 0.93, "t": "I’m so", "r": 0, "n": 11, "p": 0},
         {"s": 0.93, "e": 1.21, "t": "I’m so cool", "r": 0, "n": 11, "p": 0},
         {"s": 1.21, "e": 2.69, "t": "with my", "r": 1, "n": 15, "p": 4}, {"s": 1.9, "e": 2.69, "t": "pink", "r": 2, "n": 13, "p": 4},
         {"s": 2.69, "e": 4.09, "t": "and my knee", "r": 0, "n": 11, "p": 5}, {"s": 4.09, "e": 5.26, "t": "All the boys say", "r": 0, "n": 16},
         {"s": 30.0, "e": 31.0, "t": "after", "r": 0, "n": 5, "p": 1}, NO_TEXT]
K = [10.75, 12.5, 18.0, 20.6, 25.0, 28.3, 34.4, 36.5, 45.8]
kills = {"kills": [{"t": k} for k in K], "totalKills": len(K)}
flex = {"flex": [{"start": 6.0, "what": "walking with the pistol"}]}
def plan(flex_len, clips_extra=()):
    return {"beatSec": 0.45, "dropAtSec": 6.4, "hook": "cool", "totalKills": 6, "notes": "fixture",
            "clips": [{"id": 1, "start": 6.0, "len": flex_len, "speed": 1, "role": "flex"},
                      {"id": 2, "start": 8.25, "len": 4.5, "speed": 1.5, "role": "kill"},
                      {"id": 3, "start": 17.0, "len": 1.5, "speed": 0.5, "role": "kill"},
                      {"id": 4, "start": 22.5, "len": 3, "speed": 1, "role": "kill"},
                      {"id": 5, "start": 25.8, "len": 3.5, "speed": 1.5, "role": "kill"},
                      {"id": 6, "start": 31.9, "len": 3, "speed": 1, "role": "kill"},
                      {"id": 7, "start": 99.0, "len": 3, "speed": 1, "role": "kill"}, *clips_extra]}
def build(name, p, song=17.9, cap=60, w=lines, look="0"):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("game_dur", "value"): "95",
             ("song_dur", "value"): song, ("max_dur", "value"): cap, ("loudness_in", "value"): "0.0,-30", ("variation_in", "value"): "x",
             ("lines_in", "value"): json.dumps(w, ensure_ascii=False), ("plan", "json"): p, ("look_in", "value"): look}
    return run(g, seeds, ("render_gate", "value"))
def fc(args): return args[args.index("-filter_complex") + 1]
def t(args): return float(args[args.index("-t") + 1])
def fade(args): return float(fc(args).split("fade=t=out:st=")[1].split(":")[0])

failures = []
def check(label, cond):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond: failures.append(label)

a = build("style-kill-montage", plan(3))
import re
def trims(args):  # (start, len) of each clip's picture, as numbers
    return [(float(a), float(b)) for a, b in re.findall(r"movie='\{in0\}':seek_point=[\d.]+,trim=start=([\d.]+):duration=([\d.]+)", fc(args))]
# fixture at 60 s (hold 2 s): flex 6+3 kept as is; slow 17+1.5 -> 2; normal 22.5+3 and 31.9+3 -> 4.5; the two 1.5x clips and start 99 dropped
check("kill montage: speed-ups dropped, 4 clips (flex, slow, 2 normal)", trims(a) == [(6, 3), (17, 2), (22.5, 4.5), (31.9, 4.5)])
check("kill montage: no speed-up filters", "atempo" not in fc(a) and "avgblur" not in fc(a))
check("kill montage: 1 slow-motion clip, game audio muted", fc(a).count("setpts=2*") == 1 and fc(a).count("volume=0,apad") == 1)
check("kill montage: no text", "drawtext" not in fc(a))
check("kill montage: -t is the song length when under the cap", t(a) == 17.9)
check("kill montage: fade 0.8 s before the play time (3 + 2x2 + 4.5 + 4.5)", abs(fade(a) - (16 - 0.8)) < 0.01)
a15 = build("style-kill-montage", plan(3), song=120, cap=15)
check("15 s: hold 1 s (normal 3.5, slow 1.5 kept), capped at 15", trims(a15) == [(6, 3), (17, 1.5), (22.5, 3.5), (31.9, 3.5)] and t(a15) == 15 and abs(fade(a15) - 12.2) < 0.01)
a90 = build("style-kill-montage", plan(3), song=120, cap=90)
check("90 s: hold 4 s (normal 6.5, slow 3), flex untouched", trims(a90) == [(6, 3), (17, 3), (22.5, 6.5), (31.9, 6.5)] and abs(fade(a90) - 21.2) < 0.01)
a45 = build("style-kill-montage", plan(3), song=120, cap=45)
check("a length with no row (45 s) uses the default hold (2 s)", trims(a45) == trims(a))
long = build("style-kill-montage", plan(3, clips_extra=()) | {"clips": plan(3)["clips"][:3] + [{"id": 4, "start": 22.5, "len": 5.5, "speed": 1, "role": "kill"}]})
check("a clip already longer than the minimum keeps its length", (22.5, 5.5) in trims(long))
dup = {**plan(3), "clips": plan(3)["clips"][:1] + [{"id": 2, "start": 17.0, "len": 2, "speed": 0.5, "role": "kill", "kill": 18},
                                                   {"id": 3, "start": 15.5, "len": 4.5, "speed": 1, "role": "kill", "kill": 18},
                                                   {"id": 4, "start": 22.5, "len": 4.5, "speed": 1, "role": "kill", "kill": 25}]}
check("one clip per kill: a second clip of the same kill (slow + normal) is dropped", trims(build("style-kill-montage", dup)) == [(6, 3), (17, 2), (22.5, 4.5)])
check("kill montage: no clips -> no render", build("style-kill-montage", {**plan(3), "clips": []}) is None)

b = build("style-lyrical-kill-montage", plan(1.25))
draws = re.findall(r"drawtext=[^,]*?text='([^']*)'[^,]*?:x=([^:]*):y=([^:]*):enable='gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)'", fc(b))
check("lyrical: each step of a line from its word to the next, rows anchored at the full row's left edge, one spot per line", [(t, x, y, float(a), float(e)) for t, x, y, a, e in draws] == [
    ("I’m", "70-0*11*42.9", "h*0.34-lh/2", 0.49, 0.69), ("I’m so", "70-0*11*42.9", "h*0.34-lh/2", 0.69, 0.93),       # spot 0: upper left
    ("I’m so cool", "70-0*11*42.9", "h*0.34-lh/2", 0.93, 1.21),
    ("with my", "w/2-0.5*15*42.9", "h*0.64-lh-8", 1.21, 2.69), ("pink", "w/2-0.5*13*42.9", "h*0.64+8", 1.9, 2.69),   # 4: lower middle, two rows
    ("and my knee", "w-70-1*11*42.9", "h*0.64-lh/2", 2.69, 4.09),                                                     # 5: lower right
    ("All the boys say", "w/2-0.5*16*42.9", "h*0.64-lh/2", 4.09, 5.26)])                                              # no spot: lower middle
check("lyrical: never in the centre", all(not y.startswith("h*0.5") for _, _, y, *_ in draws))
check("lyrical: never in the bottom band", "y=h*0.875" not in fc(b))
check("lyrical: look 0 by default (Anton, a 16-character row fills ~72% of the width)", fc(b).count("fontsize=96:fontcolor=white:borderw=5") == len(draws))
check("lyrical: outline and shadow on every row", fc(b).count("shadowx=") == fc(b).count("drawtext") == len(draws))
b3 = build("style-lyrical-kill-montage", plan(1.25), look="3")
check("lyrical: look 3 changes the style and the letter width", "fontsize=78:fontcolor=white:borderw=6:bordercolor=0x141414" in fc(b3) and "fontsize=96" not in fc(b3) and "70-0*11*43.8" in fc(b3))
check("lyrical: look 3 copies font input 3", run(json.load(open(os.path.join(HERE, "style-lyrical-kill-montage.json")))["graph"], {("look_in", "value"): "3"}, ("font_args_list", "value"))[4] == "{in3}")
check("lyrical: an unknown look falls back to look 0", fc(build("style-lyrical-kill-montage", plan(1.25), look="x")) == fc(b))
check("lyrical: ten fonts downloaded", len(next(n for n in json.load(open(os.path.join(HERE, "style-lyrical-kill-montage.json")))["graph"]["nodes"] if n["id"] == "caption_font")["params"]["input"]) == 10)
check("lyrical: no lyrics (only the no-text line) -> renders without text", "drawtext" not in fc(build("style-lyrical-kill-montage", plan(1.25), w=[NO_TEXT])))
song = json.load(open(os.path.join(HERE, "song-index.json")))["graph"]
check("song-index: vocals -> transcribe (no built-in alignment) -> align -> segments out, and voice activity on the vocals",
      {e["id"] for e in song["edges"]} >= {"vocals.vocals->transcript.input", "transcript.segments->aligned.segments", "vocals.vocals->aligned.input", "aligned.segments->out.segments",
                                             "vocals.vocals->voice.input", "voice.segments->out.voice"}
      and next(n for n in song["nodes"] if n["id"] == "transcript")["params"]["align"] is False)
# "below the minimum" regexes: every value from 0 to 9.99 in 0.01 steps, as written by the planner
from build import lt_regex
for x in (1.5, 1.75, 2, 3, 3.5, 4, 4.5, 6.5):
    r = re.compile(f"^(?:{lt_regex(x)})$")
    bad = [v for v in (f"{n / 100:g}" for n in range(1000)) if bool(r.match(v)) != (float(v) < x)]
    bad += [v for v in (f"{n / 100:.2f}" for n in range(1000)) if bool(r.match(v)) != (float(v) < x)]
    check(f"below-{x:g} regex matches exactly the numbers under {x:g}", not bad)
# the kill finder sometimes answers bare numbers: both shapes must give the same clips
bare = {"kills": K, "totalKills": len(K)}
def build_with(kills_obj, name="style-kill-montage"):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills_obj), ("flex_in", "value"): json.dumps({"flex": [6.0]}), ("game_dur", "value"): "95",
             ("song_dur", "value"): 17.9, ("max_dur", "value"): 60, ("loudness_in", "value"): "0.0,-30", ("variation_in", "value"): "x",
             ("lines_in", "value"): "[]", ("plan", "json"): plan(3), ("look_in", "value"): "0"}
    return run(g, seeds, ("render_gate", "value"))
check("kills as bare numbers (and flex as bare numbers) give the same render", build_with(bare) == build_with(kills))
# {in0}/{in1}/{in2} follow the order of the edges into the render; the filter reads gameplay, song, font
def render_inputs(name):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    return [e["from"]["node"] for e in g["edges"] if e["to"] == {"node": "make_montage", "port": "input"}]
check("render inputs in order: gameplay, song", render_inputs("style-kill-montage") == ["video_in", "audio_in"])
check("lyrical render inputs in order: gameplay, song, font", render_inputs("style-lyrical-kill-montage") == ["video_in", "audio_in", "caption_font"])
# the cut: the game's own sound (in sync, from the video) and no song; voice chat is removed from it, then the song goes on
check("the cut carries the video's own game sound and no song", all("amovie='{in0}'" in fc(x) and "amovie='{in1}'" not in fc(x) and fc(x).endswith("[ga]anull[a]") for x in (a, b)))
def final(name, p, song=17.9, cap=60):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("game_dur", "value"): "95",
             ("song_dur", "value"): song, ("max_dur", "value"): cap, ("loudness_in", "value"): "0.0,-30", ("variation_in", "value"): "x",
             ("lines_in", "value"): "[]", ("plan", "json"): p, ("look_in", "value"): "0"}
    return run(g, seeds, ("final_args_list", "value"))
def final_inputs(name):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    return [e["from"]["node"] + "." + e["from"]["port"] for e in g["edges"] if e["to"] == {"node": "final_cut", "port": "input"}]
for name in ("style-kill-montage", "style-lyrical-kill-montage", "style-ultra-edit"):
    gg = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    check(f"{name}: voice chat removed from the cut (instrumental stem of the cut)",
          next(n for n in gg["nodes"] if n["id"] == "clean_audio")["params"]["stems"] == ["instrumental"] and "make_montage.file->clean_audio.input" in {e["id"] for e in gg["edges"]})
    check(f"{name}: final cut inputs in order: the cut, the song, the clean game sound", final_inputs(name) == ["make_montage.file", "audio_in.value", "clean_audio.instrumental"])
fa = final("style-kill-montage", plan(3))
check("final cut: picture copied, clean game sound at 30% under the song, fades at the edit's end, capped length",
      fa[fa.index("-c:v") + 1] == "copy" and "[2:a]aresample=48000,volume=0.3[g];[1:a]aresample=48000,volume=1[m]" in fa[fa.index("-filter_complex") + 1]
      and "afade=t=out:st=15.2:d=0.8" in fa[fa.index("-filter_complex") + 1] and fa[fa.index("-t") + 1] == "17.9")
check("lyric font is {in2}", "fontfile='{in2}'" in fc(b))
for gi in ("gameplay-index", "gameplay-index-upload"):
    check(f"{gi}: no separation of the whole recording (voice chat is removed from the cut)",
          all(n.get("operation") != "separate" for n in json.load(open(os.path.join(HERE, f"{gi}.json")))["graph"]["nodes"]))
# ---- Ultra Edit (docs/edit-styles/ultra-edit.md): every kill a fixed 6 s window from K-2, time-warped, with transitions
up = {"beatSec": 0.45, "dropAtSec": 6.4, "totalKills": 2, "notes": "fixture", "clips": [
    {"id": 1, "start": 6.0, "len": 1.25, "speed": 1, "role": "flex"},
    {"id": 2, "start": 16.0, "len": 4, "speed": 0.5, "role": "kill", "kill": 18},   # a planned slow clip: still a standard Ultra clip
    {"id": 3, "start": 26.3, "len": 3, "speed": 1.5, "role": "kill", "kill": 28.3},  # a planned speed-up: the same
    {"id": 4, "start": 99.0, "len": 6, "speed": 1, "role": "kill", "kill": 101}]}   # not a clip start: dropped
u = build("style-ultra-edit", up)
check("ultra: render inputs in order: gameplay, song, font", render_inputs("style-ultra-edit") == ["video_in", "audio_in", "caption_font"])
check("ultra: the flex as planned, each kill a 6 s window from 2 s before it", trims(u) == [(6, 1.25), (16, 6), (26.3, 6)])
check("ultra: every kill time-warped (0.5x, 1x, 0.5x, 1x, ramp to 3x), the flex not", fc(u).count("setpts='(if(lt(T,0.25),2*T,") == 2)
check("ultra: the game sound follows in five pieces per kill", fc(u).count("atempo=0.5") == 4 and fc(u).count("atempo=1.3956") == 2 and fc(u).count("amovie='{in0}'") == 3 and "amovie='{in1}'" not in fc(u))
check("ultra: zoom-tilt-slide out and pinch in on every clip", fc(u).count("rotate=a=") == 3 and fc(u).count("zoompan=z='1+0.6*") == 3)
check("ultra: play time = flex + 6.68 s per kill, faded 0.8 s before", abs(fade(u) - (min(1.25 + 2 * 6.68, 17.9) - 0.8)) < 0.01)
fu = final("style-ultra-edit", up)[final("style-ultra-edit", up).index("-filter_complex") + 1]
check("ultra: clean game sound loud under the song, limited", "volume=1.4[g]" in fu and "volume=0.85[m]" in fu and "alimiter=limit=0.95" in fu)
check("ultra: karaoke lyrics", fc(u).count("drawtext") == len(draws))
sys.exit(1 if failures else 0)
