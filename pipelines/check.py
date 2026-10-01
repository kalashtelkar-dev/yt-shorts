"""Regression check for the style pipelines: builds each style's render command from fixed inputs with the
emulator and asserts what it must contain. Run after changing build.py:  python3 pipelines/check.py"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from emulate import run

# lyrics as the app sends them (src/server/jobs/lyrics.ts lyricEvents): subtitle events, each starting "{@L" for the look
EVENTS = ("; lyrics\n"
          "Dialogue: 0,0:00:00.49,0:00:00.55,L,,0,0,0,,{@L\\an4\\move(-170,653,10,653)\\alpha&HFF&\\t(\\alpha&HAA&)}I’m{\\alpha&HFF&} so cool\n"
          "Dialogue: 0,0:00:00.55,0:00:00.69,L,,0,0,0,,{@L\\an4\\pos(70,653)}I’m{\\alpha&HFF&} so cool")
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
def build(name, p, song=17.9, cap=60, subs=EVENTS, look="0"):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("game_dur", "value"): "95",
             ("song_dur", "value"): song, ("max_dur", "value"): cap, ("beats_in", "value"): "0.2, 0.7, 1.2", ("beat_sec_in", "value"): "0.5", ("drop_in", "value"): "none", ("variation_in", "value"): "x",
             ("subs_in", "value"): subs, ("plan", "value"): p, ("look_in", "value"): look}
    return run(g, seeds, ("render_gate", "value"))
def fc(args): return args[args.index("-filter_complex") + 1]
def t(args): return float(args[args.index("-t") + 1])
def fade(args): return float(re.search(r"(?<!a)fade=t=out:st=([\d.]+)", fc(args)).group(1))  # the picture's fade out, not a sound fade

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
LYRICAL = json.load(open(os.path.join(HERE, "style-lyrical-kill-montage.json")))["graph"]
def ass(look="0", subs=EVENTS):  # the subtitle file the render draws
    return run(LYRICAL, {("subs_in", "value"): subs, ("look_in", "value"): look}, ("ass_doc", "value"))
def into(graph, node):  # the nodes feeding a step's inputs, in order ({in0}, {in1}, ...)
    return [e["from"]["node"] for e in graph["edges"] if e["to"] == {"node": node, "port": "input"}]
check("lyrical: the text layer is the subtitle file ({in2}) drawn by libass, no drawtext",
      "color=c=black@0:s=1080x1920:r=60,format=rgba,subtitles=filename='{in2}':alpha=1,split=2[t1][t2]" in fc(b) and "drawtext" not in fc(b))
check("lyrical: the render's filter doesn't grow with the lyrics (a wordy 90 s song hit E2BIG, 2026-10-01)",
      fc(build("style-lyrical-kill-montage", plan(1.25), subs=EVENTS * 2000)) == fc(b) and len(fc(b)) < 20000)
d0 = ass()
check("lyrical: a whole subtitle file at 1080x1920, no wrapping, the app's events after the format line",
      d0.startswith("[Script Info]\n") and "PlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n" in d0 and "\n[Events]\nFormat: Layer, Start, End," in d0 and d0.rstrip().endswith("}I’m{\\alpha&HFF&} so cool"))
check("lyrical: look 0 by default (Anton at the size that matches drawtext's 96, outline and shadow)", "\nStyle: L,Anton,168,&H00FFFFFF,&H00FFFFFF,&H00000000,&H26000000,0,0,0,0,100,100,0,0,1,5,6,5," in d0)
check("lyrical: the look's shadow offsets open every event", d0.count("{\\xshad6\\yshad6\\an4") == 2 and "@L" not in d0)
d3 = ass("3")
check("lyrical: look 3 is Luckiest Guy, dark outline, red shadow", "Style: L,Luckiest Guy,95,&H00FFFFFF,&H00FFFFFF,&H00141414,&H004D48E5," in d3 and "Anton" not in d3)
check("lyrical: look 1's shadow falls straight down", "{\\xshad0\\yshad8\\an4" in ass("1"))
check("lyrical: an unknown look falls back to look 0", ass("x") == d0)
check("lyrical: look 3 copies font input 3", run(LYRICAL, {("look_in", "value"): "3"}, ("font_args_list", "value"))[4] == "{in3}")
check("lyrical: ten fonts downloaded", len(next(n for n in LYRICAL["nodes"] if n["id"] == "caption_font")["params"]["input"]) == 10)
check("lyrical: no lyrics -> a file with no events", ass(subs="; lyrics").rstrip().endswith("Effect, Text\n; lyrics"))
nodes = {n["id"]: n for n in LYRICAL["nodes"]}
check("lyrical: the file is written as lyrics.ass and packed with the look's font into subs.mkv",
      nodes["ass_file"]["params"]["filename"] == "lyrics.ass" and into(LYRICAL, "subs") == ["ass_file", "caption_font"]
      and nodes["subs"]["params"]["args"][nodes["subs"]["params"]["args"].index("-attach") + 1] == "{in1}" and nodes["subs"]["params"]["output"] == "subs.mkv")
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
             ("song_dur", "value"): 17.9, ("max_dur", "value"): 60, ("beats_in", "value"): "0.2, 0.7, 1.2", ("beat_sec_in", "value"): "0.5", ("drop_in", "value"): "none", ("variation_in", "value"): "x",
             ("subs_in", "value"): EVENTS, ("plan", "value"): plan(3), ("look_in", "value"): "0"}
    return run(g, seeds, ("render_gate", "value"))
check("kills as bare numbers (and flex as bare numbers) give the same render", build_with(bare) == build_with(kills))
# {in0}/{in1}/{in2} follow the order of the edges into the render; the filter reads gameplay, song, font
def render_inputs(name):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    return [e["from"]["node"] for e in g["edges"] if e["to"] == {"node": "make_montage", "port": "input"}]
check("render inputs in order: gameplay, song", render_inputs("style-kill-montage") == ["video_in", "audio_in"])
check("lyrical render inputs in order: gameplay, song, subtitles", render_inputs("style-lyrical-kill-montage") == ["video_in", "audio_in", "subs"])
# the cut: the game's own sound (in sync, from the video) and no song; voice chat is removed from it, then the song goes on
check("the cut carries the video's own game sound and no song", all("amovie='{in0}'" in fc(x) and "amovie='{in1}'" not in fc(x) and fc(x).endswith("[ga]anull[a]") for x in (a, b)))
def final(name, p, song=17.9, cap=60):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("game_dur", "value"): "95",
             ("song_dur", "value"): song, ("max_dur", "value"): cap, ("beats_in", "value"): "0.2, 0.7, 1.2", ("beat_sec_in", "value"): "0.5", ("drop_in", "value"): "none", ("variation_in", "value"): "x",
             ("subs_in", "value"): EVENTS, ("plan", "value"): p, ("look_in", "value"): "0"}
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
check("ultra: render inputs in order: gameplay, song, subtitles", render_inputs("style-ultra-edit") == ["video_in", "audio_in", "subs"])
check("ultra: the flex as planned, each kill a 6 s window from 2 s before it", trims(u) == [(6, 1.25), (16, 6), (26.3, 6)])
check("ultra: every kill time-warped (0.5x, 1x, 0.5x, 1x, ramp to 3x), the flex not", fc(u).count("setpts='(if(lt(T,0.25),0+(T-0)/0.5,") == 2)
# picture and sound must share one time map (the first version didn't: up to 0.3 s apart in every ramp, measured 2026-09-29)
kill1 = fc(u)[fc(u).index("[v1];") + 5:fc(u).index("[a2];")]
pic = [(float(a), float(v)) for a, v in re.findall(r"\(T-([\d.]+)\)/([\d.]+)", kill1)]
snd = [(float(a), round(int(r) / 48000, 4) if r else 1.0) for a, r in re.findall(r"atrim=([\d.]+):[\d.]+,asetpts=PTS-STARTPTS(?:,asetrate=(\d+))?", kill1)]
check("ultra: picture and game sound change speed at the same moments by the same amounts", len(pic) == 12 and pic == snd)
check("ultra: game sound at normal speed and slowed with the slow motion (tape-style, faded), silent in the ramp",
      "atempo" not in fc(u) and fc(u).count(",volume=0[") == 16 and fc(u).count("asetrate=24000,aresample=48000,afade") == 4
      and fc(u).count("afade=t=in:d=0.02") == 8 and fc(u).count("amovie='{in0}'") == 3 and "amovie='{in1}'" not in fc(u))
check("ultra: pinch out and in on every clip, no tilt or slide, blur and colour split only at the cuts",
      "rotate=" not in fc(u) and fc(u).count("zoompan=z='1+0.6*") == 3 and fc(u).count(":x='iw/2-iw/zoom/2':") == 3
      and fc(u).count("gblur=sigma=6:enable='") == 3 and fc(u).count("gblur=sigma=14:enable='") == 3 and fc(u).count("chromashift=cbh=-16:crh=16:enable='") == 3)
check("ultra: play time = flex + 6.669 s per kill, faded 0.8 s before", abs(fade(u) - (min(1.25 + 2 * 6.669, 17.9) - 0.8)) < 0.01)
fu = final("style-ultra-edit", up)[final("style-ultra-edit", up).index("-filter_complex") + 1]
check("ultra: game sound and song brought to set loudness (game 2 LU above), then limited",
      "loudnorm=I=-16:TP=-2:LRA=11,aresample=48000[g]" in fu and "loudnorm=I=-18:TP=-2:LRA=11,aresample=48000[m]" in fu and "alimiter=limit=0.95" in fu)
check("ultra: lyrics drawn from the subtitle file too (the app leaves the intro without lyrics)", "subtitles=filename='{in2}':alpha=1," in fc(u) and "drawtext" not in fc(u))
# the cover still (thumbnail): the first kill = intro length + 2.3 s, never past the fade; taken from the cut
def cover(name, p, song=17.9):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    seeds = {("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("game_dur", "value"): "95",
             ("song_dur", "value"): song, ("max_dur", "value"): 60, ("beats_in", "value"): "0.2, 0.7, 1.2", ("beat_sec_in", "value"): "0.5", ("drop_in", "value"): "none", ("variation_in", "value"): "x",
             ("subs_in", "value"): EVENTS, ("plan", "value"): p, ("look_in", "value"): "0"}
    args = run(g, seeds, ("cover_args_list", "value"))
    return float(args[args.index("-ss") + 1]), args
at, cargs = cover("style-kill-montage", plan(3))
check("thumbnail: the first kill (3 s intro + 2.3 s), one 720 px frame of the cut", at == 5.3 and cargs[cargs.index("-i") + 1] == "{in0}" and "-frames:v" in cargs and "scale=720:-2" in cargs)
check("thumbnail: Ultra's first kill (1.25 s intro + 2.3 s)", cover("style-ultra-edit", up)[0] == 3.55)
check("thumbnail: no intro clip -> 2.3 s", cover("style-kill-montage", {**plan(3), "clips": plan(3)["clips"][1:]})[0] == 2.3)
check("thumbnail: never past the start of the fade (a 4 s edit: 3.2 s)", cover("style-kill-montage", plan(3), song=4)[0] == 3.2)
for name in ("style-kill-montage", "style-lyrical-kill-montage", "style-ultra-edit"):
    gg = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    check(f"{name}: outputs the thumbnail, taken from the cut", {"make_montage.file->thumbnail.input", "thumbnail.file->out.thumbnail"} <= {e["id"] for e in gg["edges"]})
# The clip list comes from the app (src/server/jobs/plan.ts): no planner model, the plan input parsed as-is, and every
# check after it unchanged (a clip with a start not on the allowed list, a third speed or a bad length is still dropped).
for name in ("style-kill-montage", "style-lyrical-kill-montage", "style-ultra-edit"):
    gg = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    nodes = {n["id"]: n for n in gg["nodes"]}
    check(f"{name}: no planner model; the plan is the app's plan input", "llm" not in nodes and "plan_prompt" not in nodes
          and nodes["plan"].get("operation") == "json-parse" and "plan_in.value->plan.text" in {e["id"] for e in gg["edges"]})
    check(f"{name}: the plan still goes through the holds and the clip checks", {"plan.value->plan_text.value", "plan_held.value->clips.value"} <= {e["id"] for e in gg["edges"]})
def kept(name, clips):
    g = json.load(open(os.path.join(HERE, f"{name}.json")))["graph"]
    p = {"beatSec": 0.5, "dropAtSec": 0, "clips": clips, "totalKills": 0}
    return run(g, {("plan_in", "value"): json.dumps(p), ("kills_in", "value"): json.dumps(kills), ("flex_in", "value"): json.dumps(flex), ("song_dur", "value"): 60,
                   ("max_dur", "value"): 60}, ("kept_count", "value"))
good = [{"id": 1, "start": 6.0, "len": 2, "speed": 1, "role": "flex", "kill": 0}, {"id": 2, "start": 8.25, "len": 4.5, "speed": 1, "role": "kill", "kill": 10.75}]
check("style-kill-montage: a plan from the app passes the clip checks", kept("style-kill-montage", good) == 2)
check("style-kill-montage: a clip with a start not on the allowed list is still dropped",
      kept("style-kill-montage", good + [{"id": 3, "start": 99.0, "len": 4.5, "speed": 1, "role": "kill", "kill": 12.5}]) == 2)
su = json.load(open(os.path.join(HERE, "song-index-upload.json")))["graph"]
check("song-index-upload: reads the uploaded file (no download), its length from the info step, then the same steps as a link",
      not any(n.get("engine") == "media-fetch" for n in su["nodes"]) and {"audio_in.value->music_file.a", "info.duration->out.durationSec", "music_file.value->vocals.input"} <= {e["id"] for e in su["edges"]}
      and {n["id"] for n in su["nodes"]} - {"audio_in", "info"} == {n["id"] for n in json.load(open(os.path.join(HERE, "song-index.json")))["graph"]["nodes"]} - {"music_url", "music"})
def node_params(f, nid): return next(n for n in json.load(open(os.path.join(HERE, f)))["graph"]["nodes"] if n["id"] == nid)["params"]
check("YouTube downloads (gameplay video, song) impersonate a browser", node_params("gameplay-index.json", "download").get("impersonate") == "chrome"
      and node_params("song-index.json", "music").get("impersonate") == "chrome")
# gameplay-index: the model lists only the player's kills; the pipeline still drops any row where the player is not the KILLER
def kills_from(rows, name):
    g = json.load(open(os.path.join(HERE, "gameplay-index.json")))["graph"]
    return run(g, {("player_name", "value"): name, ("find_kills", "json"): {"rows": rows}}, ("kills_found", "value"))
fed = [{"t": 32, "killer": "taffishmegafan", "victim": "Me"},            # the player dying (a real run counted this)
       {"t": 92, "killer": "Me", "victim": "Clove"}, {"t": 238, "killer": "Me", "victim": "Reyna"},
       {"t": 238, "killer": "Me", "victim": "Sage"},                      # a double kill: both rows count
       {"t": 300, "killer": "Meatball", "victim": "Jett"}]               # another player whose name starts with "Me"
k = kills_from(fed, "Me")
check("gameplay-index: only rows with the player as killer are kills (deaths and look-alike names dropped)",
      [r["t"] for r in k["kills"]] == [92, 238, 238])
check("gameplay-index: OCR-misread names still match (N0va = Nova)", [r["t"] for r in kills_from([{"t": 5, "killer": "N0va", "victim": "x"}, {"t": 9, "killer": "x", "victim": "Nova"}], "Nova")["kills"]] == [5])
check("gameplay-index: only deaths -> no kills (an empty list, not missing)", kills_from([{"t": 32, "killer": "taffishmegafan", "victim": "Me"}], "Me") == {"kills": []})
check("gameplay-index: no rows at all -> no kills", kills_from([], "Me") == {"kills": []})
check("gameplay-index: a kill first, last or alone keeps valid JSON", [len(kills_from(r, "Me")["kills"]) for r in (
    [{"t": 1, "killer": "Me", "victim": "a"}, {"t": 2, "killer": "b", "victim": "Me"}], [{"t": 2, "killer": "b", "victim": "Me"}, {"t": 3, "killer": "Me", "victim": "c"}],
    [{"t": 3, "killer": "Me", "victim": "c"}])] == [1, 1, 1])
def deaths_from(rows, name):
    g = json.load(open(os.path.join(HERE, "gameplay-index.json")))["graph"]
    return run(g, {("player_name", "value"): name, ("find_kills", "json"): {"rows": rows}}, ("deaths_found", "value"))
mixed = [{"t": 32, "killer": "taffishmegafan", "victim": "Me"}, {"t": 56, "killer": "Sova", "victim": "BABYMETAL"}, {"t": 108, "killer": "Me", "victim": "Fade"},
         {"t": 111, "killer": "Jett", "victim": "Me."}, {"t": 174, "killer": "Me", "victim": "4ver|Fake"}, {"t": 300, "killer": "Me", "victim": "Meatball"}]
check("gameplay-index: the player's deaths are listed apart (victim = the player, OCR-tolerant)", [r["t"] for r in deaths_from(mixed, "Me")["deaths"]] == [32, 111])
check("gameplay-index: deaths never count as kills", [r["t"] for r in kills_from(mixed, "Me")["kills"]] == [108, 174, 300])
check("gameplay-index: no deaths -> an empty list", deaths_from([{"t": 5, "killer": "Me", "victim": "x"}], "Me") == {"deaths": []})
check("gameplay-index: the kill finder is asked for kills and deaths", "the player's DEATHS" in next(n for n in json.load(open(os.path.join(HERE, "gameplay-index.json")))["graph"]["nodes"] if n["id"] == "kill_instruction")["params"]["template"])
# Two jobs (2026-09-30) found real kills, but two rows before the first kill left "[,{" and they failed as "no kills found".
check("gameplay-index: several rows dropped before, between and after kills keep valid JSON", [r["t"] for r in kills_from([
    {"t": 32, "killer": "taffishmegafan", "victim": "Me"}, {"t": 56, "killer": "Sova", "victim": "BABYMETAL"}, {"t": 108, "killer": "Me", "victim": "Fade"},
    {"t": 120, "killer": "Jett", "victim": "Me"}, {"t": 130, "killer": "a", "victim": "b"}, {"t": 174, "killer": "Me", "victim": "4ver|Fake"},
    {"t": 200, "killer": "x", "victim": "y"}, {"t": 210, "killer": "y", "victim": "Me"}], "Me")["kills"]] == [108, 174])
check("gameplay-index: only other players' rows -> no kills", kills_from([{"t": 1, "killer": "a", "victim": "b"}, {"t": 2, "killer": "c", "victim": "d"}, {"t": 3, "killer": "e", "victim": "Me"}], "Me") == {"kills": []})
fl = next(n for n in json.load(open(os.path.join(HERE, "gameplay-index.json")))["graph"]["nodes"] if n["id"] == "flex_prompt")["params"]["template"]
check("gameplay-index: the intro is live-round gameplay, never agent select, menus or the scoreboard", "Never the agent select screen" in fl and "the scoreboard" in fl)
# Engine X's limits: a regex pattern or replacement holds at most 2000 characters (validate refuses more)
for f in sorted(os.listdir(HERE)):
    if f.endswith(".json"):
        long = [(n["id"], k, len(v)) for n in json.load(open(os.path.join(HERE, f)))["graph"]["nodes"] if n.get("operation") == "regex"
                for k, v in (n.get("params") or {}).items() if k in ("pattern", "replace") and isinstance(v, str) and len(v) > 2000]
        check(f"{f}: every regex pattern and replacement within 2000 characters", not long)
sys.exit(1 if failures else 0)
