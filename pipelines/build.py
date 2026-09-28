"""Builds the stage pipelines from edit-studio v8's proven nodes (see docs/edit-styles/README.md)."""
import json, copy, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
V8 = json.load(open(os.path.join(HERE, 'base', 'edit-studio-v8.json')))
SRC = {n['id']: n for n in V8['graph']['nodes']}
SRC_E = V8['graph']['edges']

class G:
    def __init__(self): self.N = {}; self.E = []
    def take(self, *ids):
        for i in ids:
            n = copy.deepcopy(SRC[i]); n.pop('position', None); self.N[i] = n
        return self
    def node(self, nid, kind="engine", **kw): self.N[nid] = {"id": nid, "kind": kind, **kw}; return self
    def util(self, nid, op, params): return self.node(nid, engine="util", operation=op, params=params)
    def edge(self, f, fp, t, tp): self.E.append({"id": f"{f}.{fp}->{t}.{tp}", "from": {"node": f, "port": fp}, "to": {"node": t, "port": tp}}); return self
    def keep_src_edges(self):  # v8 edges between nodes we took
        for e in SRC_E:
            if e['from']['node'] in self.N and e['to']['node'] in self.N and SRC[e['from']['node']].get('kind') != 'input':
                self.E.append(copy.deepcopy(e))
        return self
    def doc(self, name, desc):
        nodes = list(self.N.values())
        for i, n in enumerate(nodes): n["position"] = {"x": (i % 7) * 300, "y": (i // 7) * 180}
        ids = set(self.N); seen = set(); edges = []
        for e in self.E:  # the same wire added twice (copied from v8 and added again) is kept once
            assert e['from']['node'] in ids and e['to']['node'] in ids, e['id']
            if e['id'] not in seen: seen.add(e['id']); edges.append(e)
        self.E = edges
        return {"kind": "editor-api/pipeline", "formatVersion": 1, "source": {"id": "tpl_x4p9irJIKNb-", "version": 1},
                "name": name, "description": desc, "graph": {"version": V8['graph'].get('version', 1), "nodes": nodes, "edges": self.E}}

def inp(g, nid, name, typ, sample): return g.node(nid, kind="input", name=name, type=typ, sample=sample, required=True)

# ---------------- gameplay-index ----------------
def gameplay_index(upload=False):
    g = G()
    inp(g, "player_name", "playerName", "text", "Me")
    g.take("stamp_font", "kill_feed", "feed_frames", "read_feed", "name_escape", "name_o", "name_i", "name_s", "name_b",
           "player_frames", "player_frames_text", "llm_text", "kill_instruction", "llm", "find_kills").keep_src_edges()
    if upload:
        inp(g, "video_in", "video", "file:video", "")
        g.node("info", engine="video", operation="video-info", params={"tier": "cpu"})
        g.util("video_file", "merge", {})
        g.edge("video_in", "value", "video_file", "a").edge("video_in", "value", "info", "input")
        src, dur = ("video_in", "value"), ("info", "duration")
    else:
        inp(g, "youtube_url", "youtubeUrl", "text", "https://www.youtube.com/watch?v=_q_DGT5qpSU")
        g.take("download"); g.util("video_file", "pick", {"index": 0})
        g.edge("youtube_url", "value", "download", "url").edge("download", "files", "video_file", "list")
        src, dur = ("download", "files"), ("download", "duration")
    g.edge(*src, "kill_feed", "input")
    # keep the font as the second kill_feed input ({in1}); the edge order decides {in0}/{in1}
    g.E = [e for e in g.E if not (e['to']['node'] == "kill_feed" and e['from']['node'] == "stamp_font")]
    g.edge("stamp_font", "file", "kill_feed", "input")
    g.edge("player_name", "value", "kill_instruction", "a")
    for a, b in (("name_escape", "text"),): g.edge("player_name", "value", a, b)
    # flex candidates: ~120 time-stamped frames spread over the whole recording, read by the vision model
    g.util("flex_frames_n", "number", {"value": 120})
    g.util("flex_fps", "math", {"op": "divide"}).edge("flex_frames_n", "value", "flex_fps", "a").edge(*dur, "flex_fps", "b")
    # -skip_frame nokey: decode only keyframes (every few seconds in YouTube files); plenty for frames ~20 s apart,
    # and ~50x less decoding than every frame of a 40-minute 60 fps recording (the first version took 10+ minutes here).
    g.util("flex_args", "template", {"template": json.dumps(["-y", "-skip_frame", "nokey", "-i", "{in0}", "-vf",
        "fps={{a}},scale=-2:300,drawtext=fontfile={in1}:text='%{pts\\:hms}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4,tile=4x4:padding=4:margin=4",
        "-an", "-c:v", "libx264", "-g", "1", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "{out}"])})
    g.util("flex_args_json", "json-parse", {"fenced": False}).util("flex_args_list", "merge", {})
    g.edge("flex_fps", "value", "flex_args", "a").edge("flex_args", "value", "flex_args_json", "text").edge("flex_args_json", "value", "flex_args_list", "a")
    g.node("flex_sheets_video", engine="video", operation="custom", params={"tier": "cpu", "output": "flex.mp4"})
    g.edge(*src, "flex_sheets_video", "input").edge("stamp_font", "file", "flex_sheets_video", "input").edge("flex_args_list", "value", "flex_sheets_video", "args")
    g.node("flex_sheets", engine="video", operation="frames", params={"tier": "cpu", "mode": "keyframes", "format": "jpg", "quality": 3})
    g.edge("flex_sheets_video", "file", "flex_sheets", "input")
    g.util("kills_text", "json-stringify", {"indent": 0}).edge("find_kills", "json", "kills_text", "value")
    g.util("flex_prompt", "template", {"template":
        "These contact sheets show one first-person Valorant/CS2 gameplay recording, {{b}} seconds long. Each sheet is a 4x4 grid of frames, read left to right, top to bottom, "
        "spread evenly over the recording; every frame is stamped top-left with its time (HH:MM:SS.mmm).\n"
        "The player's kills happen at these times (seconds): {{a}}\n\n"
        "Find up to 5 FLEX moments for the intro of a montage: 2 to 4 seconds where the player shows off without killing anyone - knife out, weapon inspect, "
        "stylish walking or jumping, buying, using an ability - at least 6 seconds away from every kill. Prefer knife out or weapon inspect, then movement.\n"
        "start is the recording time in seconds (convert the stamp: 00:01:23.500 = 83.5) where the moment begins.\n"
        "Answer exactly in this shape, best first: {\"flex\": [{\"start\": number, \"what\": string}]}. If nothing fits, answer {\"flex\": []}."})
    g.edge("kills_text", "value", "flex_prompt", "a").edge(*dur, "flex_prompt", "b")
    g.node("flex_pick", engine="llm", operation="chat", params={"system": "You are a gaming video editor choosing intro shots. You answer only with valid JSON.", "json": True, "maxTokens": 2048, "temperature": 0.2})
    g.edge("llm", "connection", "flex_pick", "connection").edge("flex_prompt", "value", "flex_pick", "prompt").edge("flex_sheets", "frames", "flex_pick", "images")
    g.node("out", kind="output", fields=["video", "durationSec", "kills", "flex"] + ([] if upload else ["title"]))
    g.edge("video_file", "value", "out", "video").edge(*dur, "out", "durationSec").edge("find_kills", "json", "out", "kills").edge("flex_pick", "json", "out", "flex")
    if not upload: g.edge("download", "title", "out", "title")
    return g.doc("gameplay-index" + ("-upload" if upload else ""),
        "Gameplay " + ("upload" if upload else "link") + " + player name -> the video, its length, the player's kill times (1 fps kill-feed OCR, name-tolerant) and up to 5 intro-flex moments "
        "(no kill, >= 6 s from kills; picked by the vision model from 120 time-stamped frames). Cache per (video, player); feeds every style-* pipeline.")

# ---------------- song-index ----------------
def song_index():
    g = G()
    inp(g, "music_url", "musicUrl", "text", "https://www.youtube.com/watch?v=V-2ToWpNx9s")
    g.take("music", "music_file", "music_loudness", "vocals").keep_src_edges()
    g.edge("music_url", "value", "music", "url")
    # lyrics: the vocals stem -> Whisper segments (its own alignment off) -> the forced aligner times every word in each segment
    g.node("transcript", engine="transcribe", operation="transcribe", params={"model": "large-v3", "language": "en", "align": False, "formats": ["json"]})
    g.node("aligned", engine="transcribe", operation="align", params={})
    g.edge("vocals", "vocals", "transcript", "input").edge("vocals", "vocals", "aligned", "input")
    g.edge("transcript", "segments", "aligned", "segments").edge("transcript", "language", "aligned", "language")
    g.node("out", kind="output", fields=["audio", "durationSec", "loudness", "segments", "title"])
    g.edge("music_file", "value", "out", "audio").edge("music", "duration", "out", "durationSec").edge("music_loudness", "stdout", "out", "loudness")
    g.edge("aligned", "segments", "out", "segments").edge("music", "title", "out", "title")
    return g.doc("song-index", "Song link -> audio file, duration, loudness every 0.25 s (beats/drop), and the lyrics as segments with every word force-aligned on the separated vocals. Cache per song; feeds every style-* pipeline.")

if __name__ == "__main__" and (len(sys.argv) == 1 or sys.argv[1] == "all"):
    for fname, d in (("gameplay-index", gameplay_index()), ("gameplay-index-upload", gameplay_index(True)), ("song-index", song_index())):
        json.dump(d, open(os.path.join(HERE, f'{fname}.json'), 'w'), indent=2)
        print(fname, "nodes", len(d['graph']['nodes']), "edges", len(d['graph']['edges']))

# ---------------- style-* ----------------
NUM = r'"?(\d+(?:\.\d+)?)"?'
def clip_pat(speed):
    return (r'\{(?=[^}]*"id":"?(\d+)"?)(?=[^}]*"start":' + NUM + r')(?=[^}]*"len":' + NUM +
            r')(?=[^}]*"speed":"?' + speed + r'"?[,}])[^}]*\}')

PLAN_HEAD = """You are planning a 9:16 Valorant/CS2 {style}, cut to a song.

THE PLAYER'S KILLS, listed in THIS RUN'S MONTAGE ORDER (shuffled on purpose, so every montage of this match is different). Each entry is one kill, or a multi-kill whose "more" lists its next kills in seconds after t. Times are recording seconds; t is when the kill-feed row appears, and the real kill is up to 2 s before it:
{{{{a}}}}
The recording is {{{{f}}}} s long.

INTRO FLEX MOMENTS (no kill, the player showing off), in recording seconds: {{{{m}}}}
CLIP STARTS for normal-speed clips, in RECORDING seconds (each 2.5 s before one kill entry, same order as the entries, separated by |): {{{{k}}}}
SLOW-MOTION CLIP STARTS, in RECORDING seconds (each 1 s before one kill entry, same order): {{{{l}}}}

THE SONG: {{{{g}}}} s long. Loudness every 0.25 s as "time,RMS dB" (a sudden rise is a hit or beat; the biggest sustained rise is the drop):
{{{{h}}}}
{extra}
LENGTH: the montage is at most {{{{i}}}} seconds. The song plays from its start, so montage time = song time.
VARIATION for this run (follow it, so every run looks different): {{{{n}}}}

Plan it:
1. From the loudness, find beatSec (time between beats, usually 0.35 to 0.6 s) and dropAtSec (song seconds).
2. Clip 1 is the intro flex: start is the start of one of the INTRO FLEX MOMENTS (copy it exactly), speed 1, role "flex", len {flex_len}. If there are no flex moments, the first kill clip opens the montage instead.
3. Then the kill section: exactly ONE clip per kill entry (normal OR slow motion, never both), in exactly the order the entries are listed. Never sort them by time or by strength. A clip's start is a time in the RECORDING, never a position in the montage; copy it exactly from the lists above.
   Every kill must stay on screen at least {{{{p}}}} s after it happens before the next clip starts, so:
   - Normal: speed 1, start from CLIP STARTS (the kill is 2.5 s in), len at least {{{{o}}}} s, up to 2 s longer to land the cut on a beat.
   - Slow motion: speed 0.5, start from SLOW-MOTION CLIP STARTS (the kill is 1 s in), len at least {{{{q}}}} s, up to 1 s longer (it plays for 2 x len).
   For an entry with "more" you may lengthen its clip to show those next kills too (add the last one's offset to len); it must keep playing {{{{p}}}} s after the last kill it shows.
   There are only these two speeds. Use at least one slow-motion clip and at most one slow-motion clip for every 4 clips, and place them as the VARIATION says. Don't use a kill twice or let clips overlap in the recording.
   Make play times whole beats where you can, so the cuts land on beats.
4. The play time of all clips (len / speed, added up) should reach the LENGTH when there are enough kills; the end is trimmed with a fade.
5. totalKills is the number of kills inside the kept clips.
{step6}Write each clip's keys in exactly this order: id, start, len, speed, role, kill. kill is the t of the entry the clip shows, copied exactly (0 for the flex clip). Numbers, not strings, with at most 2 decimals. Number the clips id 1, 2, 3... in montage order.
Answer exactly in this shape: {{"beatSec": number, "dropAtSec": number, {hook_key}"clips": [{{"id": integer, "start": number, "len": number, "speed": number, "role": string, "kill": number}}], "totalKills": integer, "notes": string}}. If there are no kills, answer {{"beatSec": 0.5, "dropAtSec": 0, {hook_zero}"clips": [], "totalKills": 0, "notes": "no kills"}}."""

# Seconds each kill stays on screen before the next clip, by the montage length the user picked (the user's rule:
# 15 s -> 1, 60 s -> 2, 90 s -> 4; 30 s sits between). Any other length uses "default".
HOLD = {"15": 1, "30": 1.5, "60": 2, "90": 4, "default": 2}
LEAD_NORMAL, LEAD_SLOW = 2.5, 1.0  # the kill's place in a clip (lead_normal / lead_slow in v8)

def lt_regex(x):
    """A regex for the decimal numbers below x (0 <= x < 10, at most 2 decimals), e.g. 4.5 -> 0-3.xx, 4, 4.0-4.4x."""
    i, _, f = f"{x:.2f}".rstrip("0").rstrip(".").partition(".")
    i = int(i); alts = [f"[0-{i - 1}](?:\\.\\d+)?"] if i else []
    if f:
        frac = [f[:k] + (f"[0-{int(f[k]) - 1}]" if f[k] != "0" else "") + "\\d*" for k in range(len(f)) if f[k] != "0"] + [f[:k] for k in range(1, len(f))]
        alts.append(f"{i}(?:\\.(?:{'|'.join(frac)})?)?")
    return "|".join(alts) or "(?!)"

def hold_table():
    # rows "\n<length>;<hold>;<min len normal>;<min len slow>;<regex: below normal>;<regex: below slow>"
    rows = []
    for d, t in HOLD.items():
        ln, ls = LEAD_NORMAL + t, LEAD_SLOW + t / 2  # slow plays at half speed: t/2 s of recording fill t s on screen
        rows.append(f"\n{d};{t:g};{ln:g};{ls:g};{lt_regex(ln)};{lt_regex(ls)}")
    return "".join(rows)

# Lyric looks, one picked per job by the app's lyricLook digit (0-9). Heavy fonts, outline + hard shadow. The size fits a
# 16-character row across ~720 px, so the words sit on the gameplay without covering it (the app cuts lyric lines into
# rows of at most 16, src/server/jobs/lyrics.ts).
FONT_BASE = "https://github.com/google/fonts/raw/main/"
LOOKS = [
    ("ofl/anton/Anton-Regular.ttf", 96, "fontcolor=white:borderw=5:bordercolor=black:shadowx=6:shadowy=6:shadowcolor=black@0.85"),
    ("ofl/archivoblack/ArchivoBlack-Regular.ttf", 61, "fontcolor=white:borderw=5:bordercolor=black:shadowx=0:shadowy=8:shadowcolor=black@0.75"),
    ("ofl/bungee/Bungee-Regular.ttf", 69, "fontcolor=0xFFD83D:borderw=4:bordercolor=black:shadowx=6:shadowy=6:shadowcolor=black"),
    ("apache/luckiestguy/LuckiestGuy-Regular.ttf", 78, "fontcolor=white:borderw=6:bordercolor=0x141414:shadowx=6:shadowy=6:shadowcolor=0xE5484D"),
    ("ofl/titanone/TitanOne-Regular.ttf", 67, "fontcolor=white:borderw=5:bordercolor=0x5B21B6:shadowx=6:shadowy=6:shadowcolor=black@0.8"),
    ("ofl/blackopsone/BlackOpsOne-Regular.ttf", 68, "fontcolor=0xF4F4F4:borderw=4:bordercolor=black:shadowx=7:shadowy=7:shadowcolor=black@0.7"),
    ("ofl/russoone/RussoOne-Regular.ttf", 67, "fontcolor=0x3DE8FF:borderw=4:bordercolor=0x03141A:shadowx=6:shadowy=6:shadowcolor=black@0.85"),
    ("ofl/bowlbyone/BowlbyOne-Regular.ttf", 61, "fontcolor=white:borderw=5:bordercolor=black:shadowx=4:shadowy=7:shadowcolor=0xFF3B30"),
    ("ofl/rubikmonoone/RubikMonoOne-Regular.ttf", 53, "fontcolor=white:borderw=4:bordercolor=black:shadowx=6:shadowy=6:shadowcolor=black@0.8"),
    ("ofl/passionone/PassionOne-Black.ttf", 80, "fontcolor=0xFFE14D:borderw=5:bordercolor=0x1A1200:shadowx=6:shadowy=6:shadowcolor=black@0.85"),
]
assert len(LOOKS) == 10  # the app sends one digit

# Where a lyric line sits: the app gives every line a random spot "p" (0-5, never the same twice in a row); never the
# centre (the crosshair). x for each row, y of the line's middle. The gameplay band is y 431-1489; its top HUD ends ~540
# and the weapon/health HUD starts ~1360.
SPOTS = [(x, y) for y in ("h*0.34", "h*0.64") for x in ("70", "(w-text_w)/2", "w-text_w-70")]

def look_table():
    # rows "\n<digit>;<font input>;<style>"; "default" (look 0) catches anything else
    rows = [(str(i), f"{{in{i}}}", f"fontsize={size}:{st}") for i, (_, size, st) in enumerate(LOOKS)]
    return "".join(f"\n{';'.join(r)}" for r in rows + [("default",) + rows[0][1:]])

def style(lyrical):
    g = G()
    for nid, name, typ, sample in (("video_in", "video", "file:video", ""), ("kills_in", "kills", "text", '{"kills":[{"t":51}],"totalKills":1}'),
                                   ("flex_in", "flex", "text", '{"flex":[{"start":20,"what":"knife out"}]}'), ("game_dur", "gameDurationSec", "text", "2400"),
                                   ("audio_in", "audio", "file:audio", ""), ("song_dur", "songDurationSec", "text", "22"),
                                   ("loudness_in", "loudness", "text", "0.000000,-30.0"), ("max_dur", "maxDurationSec", "text", "60"),
                                   ("variation_in", "variation", "text", "Put the slow-motion clip third.")):
        inp(g, nid, name, typ, sample)
    if lyrical: inp(g, "lines_in", "lines", "text", "[]"); inp(g, "look_in", "lyricLook", "text", "0")
    g.take("llm", "kill_list", "kill_times", "lead_normal", "lead_slow", "zero_num", "starts_normal_raw", "starts_slow_raw", "starts_normal", "starts_slow",
           "starts_normal_csv", "starts_slow_csv", "starts_normal_alt", "starts_slow_alt", "plan", "clips", "has_speed", "len_max", "len_min", "start_allowed",
           "clip_id_range", "clip_id_range_text", "clip_items_joined", "slow_filters", "segment_filters", "segment_labels",
           "play_sum", "slow_clips", "slow_sum", "play_time", "end_time", "fade_len", "fade_start", "ffmpeg_args", "args_json", "args_list",
           "zero", "has_clips", "render_gate", "make_montage").keep_src_edges()
    if lyrical:
        g.take("caption_font", "caption_keep")
    # kills and flex arrive as JSON text
    # The kill finder sometimes answers [67, 176] instead of [{"t": 67}, {"t": 176}] (seen on a real match);
    # a number straight after "[" or "," is a bare list entry, so wrap it. "totalKills": 14 follows ":", untouched.
    g.util("kills_norm", "regex", {"flags": "g", "pattern": r'(?<=[\[,])\s*(\d+(?:\.\d+)?)\s*(?=[,\]])', "replace": '{"t":$1}'})
    g.edge("kills_in", "value", "kills_norm", "text")
    g.util("kills_json", "json-parse", {"fenced": False}).edge("kills_norm", "text", "kills_json", "text")
    g.E = [e for e in g.E if e['to']['node'] != "kill_list"]; g.edge("kills_json", "value", "kill_list", "value")
    g.util("flex_norm", "regex", {"flags": "g", "pattern": r'(?<=[\[,])\s*(\d+(?:\.\d+)?)\s*(?=[,\]])', "replace": '{"start":$1}'})
    g.edge("flex_in", "value", "flex_norm", "text")
    g.util("flex_json", "json-parse", {"fenced": False}).edge("flex_norm", "text", "flex_json", "text")
    g.util("flex_list", "json-path", {"path": "flex", "fallback": "[]"}).edge("flex_json", "value", "flex_list", "value")
    g.util("flex_starts", "json-map", {"path": "start", "dropEmpty": True}).edge("flex_list", "value", "flex_starts", "value")
    g.util("flex_alt", "join", {"separator": "|"}).edge("flex_starts", "items", "flex_alt", "value")
    g.util("starts_pattern", "template", {"template": "^({{a}}|{{b}}|{{c}})0*$"})
    g.edge("starts_normal_alt", "value", "starts_pattern", "a").edge("starts_slow_alt", "value", "starts_pattern", "b").edge("flex_alt", "value", "starts_pattern", "c")
    g.edge("starts_pattern", "value", "start_allowed", "compareTo")
    # clip checks: clips -> has_speed -> len_max -> len_min -> start_allowed (v8 order)
    for a, b in (("clips", "has_speed"),): pass
    # planner
    prompt = PLAN_HEAD.format(style="lyrical kill montage: a very short intro flex, then back-to-back kills at normal speed and in slow motion, with the song's words on screen" if lyrical
                              else "kill montage: a short intro flex (no kill), then back-to-back kills at normal speed and in slow motion",
                              extra="", flex_len="1 to 1.5 s, ending on a beat" if lyrical else "2 to 4 s, ending on the drop if the drop comes within 4 s, otherwise on a beat around 3 s",
                              step6="", hook_key="", hook_zero="")
    g.util("plan_prompt", "template", {"template": prompt})
    g.util("kills_text", "json-stringify", {"indent": 0}).edge("kills_json", "value", "kills_text", "value")
    g.util("flex_text", "json-stringify", {"indent": 0}).edge("flex_list", "value", "flex_text", "value")
    g.util("cap", "math", {"op": "min"}).edge("song_dur", "value", "cap", "a").edge("max_dur", "value", "cap", "b")
    for port, (n, p) in {"a": ("kills_text", "value"), "f": ("game_dur", "value"), "m": ("flex_text", "value"), "k": ("starts_normal_alt", "value"),
                         "l": ("starts_slow_alt", "value"), "g": ("song_dur", "value"), "h": ("loudness_in", "value"), "i": ("cap", "value"),
                         "n": ("variation_in", "value")}.items():
        g.edge(n, p, "plan_prompt", port)
    g.edge("llm", "connection", "plan", "connection").edge("plan_prompt", "value", "plan", "prompt")
    # two speeds only (normal, 0.5x); a planned speed-up matches neither render pattern and is dropped by speed_ok
    g.N["slow_filters"]["params"]["pattern"] = clip_pat(r'0?\.50*'); g.N["segment_filters"]["params"]["pattern"] = clip_pat(r'1(?:\.0+)?')
    g.E = [e for e in g.E if not (e['to']['node'] in ("slow_filters", "segment_filters") and e['to']['port'] == "text")]
    g.edge("clip_items_joined", "value", "slow_filters", "text").edge("slow_filters", "text", "segment_filters", "text")
    g.util("speed_ok", "json-filter", {"path": "speed", "op": "matches", "compareTo": r"^(1(\.0+)?|0?\.50*)$"})
    g.E = [e for e in g.E if e['to']['node'] != "len_max"]
    g.edge("has_speed", "items", "speed_ok", "value").edge("speed_ok", "items", "len_max", "value")
    g.N["len_max"]["params"]["compareTo"] = "20"  # a multi-kill clip can run over its next kills
    # one clip per kill, after the start check (a clip with a made-up start must not claim a kill first)
    g.util("one_per_kill", "json-unique", {"path": "kill", "keep": "first"})
    g.util("kept_count", "json-aggregate", {"op": "count"}).edge("one_per_kill", "items", "kept_count", "value")
    moved = [e for e in g.E if e['from']['node'] == "start_allowed"]
    g.E = [e for e in g.E if e['from']['node'] != "start_allowed"]
    g.edge("start_allowed", "items", "one_per_kill", "value")
    for e in moved:
        src = ("one_per_kill", "items") if e['from']['port'] == "items" else ("kept_count", "value")
        g.edge(*src, e['to']['node'], e['to']['port'])
    # end = min(sum(len) + sum(len of slow), cap)
    g.E = [e for e in g.E if e['to']['node'] != "end_time"]
    g.edge("play_time", "value", "end_time", "a").edge("cap", "value", "end_time", "b")
    # hold after each kill, by the length the user picked (HOLD); kill clips shorter than that are lengthened, never dropped
    g.util("hold_table", "text", {"value": hold_table()})
    g.util("hold_pattern", "template", {"template": r"^[\s\S]*?\n(?:{{a}}|default);([^;\n]*);([^;\n]*);([^;\n]*);([^;\n]*);([^\n]*)[\s\S]*$"})
    g.edge("max_dur", "value", "hold_pattern", "a")
    for i, nid in enumerate(("hold_sec", "len_normal", "len_slow", "short_normal", "short_slow"), 1):
        g.util(nid, "regex", {"replace": f"${i}"}).edge("hold_table", "value", nid, "text").edge("hold_pattern", "value", nid, "pattern")
    for port, nid in (("o", "len_normal"), ("p", "hold_sec"), ("q", "len_slow")): g.edge(nid, "text", "plan_prompt", port)
    # on the plan as text: a clip object (no nested braces), not the flex clip, with this speed, whose len is below the minimum
    clamp = r'(\{(?=[^{}]*"speed":"?SPEED"?[,}])(?![^{}]*"role":"flex")[^{}]*?"len":)"?(?:{{a}})"?(?=[,}])'
    g.util("plan_text", "json-stringify", {"indent": 0}).edge("plan", "json", "plan_text", "value")
    g.util("kill_fill", "regex", {"flags": "g", "pattern": r'\{(?![^{}]*"kill":)(?=[^{}]*"start":' + NUM + ')', "replace": '{"kill":"s$1",'})
    g.edge("plan_text", "value", "kill_fill", "text")
    prev = ("kill_fill", "text")
    for nid, speed, short, length in (("hold_normal", r"1(?:\.0+)?", "short_normal", "len_normal"), ("hold_slow", r"0?\.50*", "short_slow", "len_slow")):
        g.util(nid + "_pattern", "template", {"template": clamp.replace("SPEED", speed)}).edge(short, "text", nid + "_pattern", "a")
        g.util(nid + "_len", "template", {"template": "$1{{a}}"}).edge(length, "text", nid + "_len", "a")
        g.util(nid, "regex", {"flags": "g"}).edge(*prev, nid, "text")
        g.edge(nid + "_pattern", "value", nid, "pattern").edge(nid + "_len", "value", nid, "replace")
        prev = (nid, "text")
    g.util("plan_held", "json-parse", {"fenced": False}).edge(*prev, "plan_held", "text")
    g.E = [e for e in g.E if e['to']['node'] != "clips"]; g.edge("plan_held", "value", "clips", "value")
    # render inputs: {in0} gameplay, {in1} song (, {in2} caption font)
    g.edge("video_in", "value", "make_montage", "input").edge("audio_in", "value", "make_montage", "input")
    tpl = g.N["ffmpeg_args"]["params"]["template"]
    layer = ("color=c=black@0:s=1080x1920:r=60,format=rgba,{{g}}split=2[t1][t2];[t1]gblur=sigma=14,colorchannelmixer=aa=1.6[glow];"
             "[vc][glow]overlay=0:0:shortest=1:format=auto[vg];[vg][t2]overlay=0:0:shortest=1:format=auto,fade=t=in:st=0:d=0.3,fade=t=out:st={{f}}:d=0.8[v];")
    assert layer in tpl, tpl[:400]
    if not lyrical:
        tpl = tpl.replace(layer, "[vc]fade=t=in:st=0:d=0.3,fade=t=out:st={{f}}:d=0.8[v];")
    g.N["ffmpeg_args"]["params"]["template"] = tpl
    g.E = [e for e in g.E if not (e['to']['node'] == "ffmpeg_args" and e['to']['port'] in ("d", "g"))]
    g.edge("cap", "value", "ffmpeg_args", "d")
    if lyrical:
        # the font is {in2}: drop v8's copy of this edge (it came first) so the order is gameplay, song, font
        g.E = [e for e in g.E if not (e['to']['node'] == "make_montage" and e['from']['node'] == "caption_font")]
        g.edge("caption_font", "file", "make_montage", "input")
        # this job's look: its font is copied out of the ten downloaded ones, its style goes into the drawtext templates
        g.util("look_table", "text", {"value": look_table()})
        g.util("look_pattern", "template", {"template": r"^[\s\S]*?\n(?:{{a}}|default);([^;\n]*);([^\n]*)[\s\S]*$"})
        g.edge("look_in", "value", "look_pattern", "a")
        for i, nid in enumerate(("look_font", "look_style"), 1):
            g.util(nid, "regex", {"replace": f"${i}"}).edge("look_table", "value", nid, "text").edge("look_pattern", "value", nid, "pattern")
        g.N["caption_font"]["params"] = {"tier": "gpu", "input": [FONT_BASE + f for f, _, _ in LOOKS], "outputs": [{"name": "caption.ttf", "contentType": "font/ttf"}]}
        g.util("font_args", "template", {"template": json.dumps(["-y", "-f", "data", "-i", "{{a}}", "-map", "0", "-c", "copy", "-f", "data", "{out}"])})
        g.util("font_args_json", "json-parse", {"fenced": False}).util("font_args_list", "merge", {})
        g.edge("look_font", "text", "font_args", "a").edge("font_args", "value", "font_args_json", "text").edge("font_args_json", "value", "font_args_list", "a")
        g.edge("font_args_list", "value", "caption_font", "args")
        # lyric lines from the app (aligned segments cut into 3-5 words, one or two rows): the ones that start before the end,
        # rebuilt into one text, then each drawn centred with a 0.08 s fade-in, from its first word's start to its last word's end
        g.util("end_text", "template", {"template": "{{a}}"}).edge("end_time", "value", "end_text", "a")
        g.util("lines_json", "json-parse", {"fenced": False}).edge("lines_in", "value", "lines_json", "text")
        g.util("lines_before", "json-filter", {"path": "start", "op": "less-or-equal"})
        g.edge("lines_json", "value", "lines_before", "value").edge("end_text", "value", "lines_before", "compareTo")
        g.util("line_item", "json-stringify", {"indent": 0}).edge("lines_before", "items", "line_item", "value")
        g.util("lines_joined", "join", {"separator": ""}).edge("line_item", "value", "lines_joined", "value")
        prev = ("lines_joined", "value")
        for i, (x, y) in enumerate(SPOTS):
            g.util(f"spot_{i}", "regex", {"flags": "g", "pattern": f'"p":"?{i}"?(?=[,}}])', "replace": f'"x":"{x}","y":"{y}"'}).edge(*prev, f"spot_{i}", "text")
            prev = (f"spot_{i}", "text")
        x, y = SPOTS[4]  # a line without a spot: lower middle
        g.util("spot_default", "regex", {"flags": "g", "pattern": '\\{(?![^}]*"x":)', "replace": f'{{"x":"{x}","y":"{y}",'}).edge(*prev, "spot_default", "text")
        head = '\\{(?=[^}]*"start":' + NUM + ')(?=[^}]*"end":' + NUM + ')(?=[^}]*"l1":"([^"]+)")'
        at = '(?=[^}]*"x":"([^"]+)")(?=[^}]*"y":"([^"]+)")[^}]*\\}'
        draw = "drawtext=fontfile='{in2}':text='ROW':{{a}}:x=X:y=Y:alpha='min(1,(t-$1)/0.08)':enable='between(t,$1,$2)',"
        g.util("two_rows", "regex", {"flags": "g", "pattern": head + '(?=[^}]*"l2":"([^"]+)")' + at})  # $4 row 2, $5 x, $6 y
        g.util("one_row", "regex", {"flags": "g", "pattern": head + '(?=[^}]*"l2":"")' + at})  # $4 x, $5 y
        g.util("two_rows_draw", "template", {"template": "§" + draw.replace("ROW", "$3").replace("X", "$5").replace("Y", "$6-lh-8")
                                                          + draw.replace("ROW", "$4").replace("X", "$5").replace("Y", "$6+8") + "§"})
        g.util("one_row_draw", "template", {"template": "§" + draw.replace("ROW", "$3").replace("X", "$4").replace("Y", "$5-lh/2") + "§"})
        for t in ("two_rows_draw", "one_row_draw"): g.edge("look_style", "text", t, "a")
        g.edge("spot_default", "text", "two_rows", "text").edge("two_rows_draw", "value", "two_rows", "replace")
        g.edge("two_rows", "text", "one_row", "text").edge("one_row_draw", "value", "one_row", "replace")
        g.edge("one_row", "text", "caption_keep", "text")
        g.edge("caption_keep", "text", "ffmpeg_args", "g")
    g.node("out", kind="output", fields=["montage", "plan"])
    g.edge("make_montage", "file", "out", "montage").edge("plan", "json", "out", "plan")
    name = "style-lyrical-kill-montage" if lyrical else "style-kill-montage"
    return g.doc(name, ("Lyrical kill montage (docs/edit-styles/lyrical-kill-montage.md)" if lyrical else "Kill montage (docs/edit-styles/kill-montage.md)")
                 + " from a gameplay-index and a song-index: intro flex, normal and 0.5x kill clips placed by a per-run variation, each kill held a minimum time that grows with the length, beat-synced, 9:16 blurred layout, flash + zoom, song from its start"
                 + (", the lyrics as force-aligned lines of 3-5 words, centred, in one of ten looks per job." if lyrical else ", no text."))

if __name__ == "__main__":
    for fname, d in (("style-kill-montage", style(False)), ("style-lyrical-kill-montage", style(True))):
        json.dump(d, open(os.path.join(HERE, f'{fname}.json'), 'w'), indent=2)
        print(fname, "nodes", len(d['graph']['nodes']), "edges", len(d['graph']['edges']))
