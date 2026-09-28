"""Regression check for the style pipelines: builds each style's render command from fixed inputs with the
emulator and asserts what it must contain. Run after changing build.py:  python3 pipelines/check.py"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from emulate import run

words = json.load(open(os.path.join(HERE, "fixtures", "words.json")))
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
def build(name, p, song=17.9, cap=60, w=words, look="0"):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("game_dur", "value"): "95",
             ("song_dur", "value"): song, ("max_dur", "value"): cap, ("loudness_in", "value"): "0.0,-30", ("variation_in", "value"): "x",
             ("words_in", "value"): json.dumps(w), ("plan", "json"): p, ("look_in", "value"): look}
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
check("kill montage: no clips -> no render", build("style-kill-montage", {**plan(3), "clips": []}) is None)

b = build("style-lyrical-kill-montage", plan(1.25))
check("lyrical: words shown one at a time, centred", fc(b).count("drawtext") > 20 and "y=h*0.875" not in fc(b) and "y=h*0.5-text_h/2" in fc(b))
check("lyrical: look 0 by default (Anton), hook bigger than words", "fontsize=167:fontcolor=white:borderw=7" in fc(b) and fc(b).count("fontsize=200:") >= 1)
check("lyrical: outline and shadow on every word", fc(b).count("shadowx=") == fc(b).count("drawtext"))
b3 = build("style-lyrical-kill-montage", plan(1.25), look="3")
check("lyrical: look 3 changes the style", "fontsize=128:fontcolor=white:borderw=8:bordercolor=0x141414" in fc(b3) and "fontsize=167" not in fc(b3))
check("lyrical: look 3 copies font input 3", run(json.load(open(os.path.join(HERE, "style-lyrical-kill-montage.json")))["graph"], {("look_in", "value"): "3"}, ("font_args_list", "value"))[4] == "{in3}")
check("lyrical: an unknown look falls back to look 0", fc(build("style-lyrical-kill-montage", plan(1.25), look="x")) == fc(b))
check("lyrical: ten fonts downloaded", len(next(n for n in json.load(open(os.path.join(HERE, "style-lyrical-kill-montage.json")))["graph"]["nodes"] if n["id"] == "caption_font")["params"]["input"]) == 10)
check("lyrical: only words sung before the montage ends", all(float(x.split(",")[0]) <= fade(b) + 0.8 for x in fc(b).split("between(t,")[1:]))
check("lyrical: no song words -> renders without text", "drawtext" not in fc(build("style-lyrical-kill-montage", plan(1.25), w=[])))
check("lyrical: a slur is never shown", "igga" not in fc(b).lower())
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
             ("words_in", "value"): "[]", ("plan", "json"): plan(3), ("look_in", "value"): "0"}
    return run(g, seeds, ("render_gate", "value"))
check("kills as bare numbers (and flex as bare numbers) give the same render", build_with(bare) == build_with(kills))
# {in0}/{in1}/{in2} follow the order of the edges into the render; the filter reads gameplay, song, font
def render_inputs(name):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    return [e["from"]["node"] for e in g["edges"] if e["to"] == {"node": "make_montage", "port": "input"}]
check("render inputs in order: gameplay, song", render_inputs("style-kill-montage") == ["video_in", "audio_in"])
check("lyrical render inputs in order: gameplay, song, font", render_inputs("style-lyrical-kill-montage") == ["video_in", "audio_in", "caption_font"])
sys.exit(1 if failures else 0)
