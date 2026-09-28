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
    g.util("flex_args", "template", {"template": json.dumps(["-y", "-i", "{in0}", "-vf",
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
    g.take("music", "music_file", "music_loudness", "vocals", "lyrics").keep_src_edges()
    g.edge("music_url", "value", "music", "url")
    g.node("out", kind="output", fields=["audio", "durationSec", "loudness", "words", "title"])
    g.edge("music_file", "value", "out", "audio").edge("music", "duration", "out", "durationSec").edge("music_loudness", "stdout", "out", "loudness")
    g.edge("lyrics", "words", "out", "words").edge("music", "title", "out", "title")
    return g.doc("song-index", "Song link -> audio file, duration, loudness every 0.25 s (beats/drop), and English word timestamps from the separated vocals. Cache per song; feeds every style-* pipeline.")

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

THE PLAYER'S KILLS in the gameplay recording, in recording seconds (K is when the kill-feed row appears; the real kill is up to 2 s before K):
{{{{a}}}}
The recording is {{{{f}}}} s long.

INTRO FLEX MOMENTS (no kill, the player showing off), in recording seconds: {{{{m}}}}
CLIP STARTS for normal and speed-up clips, in RECORDING seconds (each 2.5 s before one kill, same order as the kills, separated by |): {{{{k}}}}
SLOW-MOTION CLIP STARTS, in RECORDING seconds (each 1 s before one kill, same order): {{{{l}}}}

THE SONG: {{{{g}}}} s long. Loudness every 0.25 s as "time,RMS dB" (a sudden rise is a hit or beat; the biggest sustained rise is the drop):
{{{{h}}}}
{extra}
LENGTH: the montage is at most {{{{i}}}} seconds. The song plays from its start, so montage time = song time.
VARIATION for this run (follow it, so every run looks different): {{{{n}}}}

Plan it:
1. From the loudness, find beatSec (time between beats, usually 0.35 to 0.6 s) and dropAtSec (song seconds).
2. Clip 1 is the intro flex: start is the start of one of the INTRO FLEX MOMENTS (copy it exactly), speed 1, role "flex", len {flex_len}. If there are no flex moments, the first kill clip opens the montage instead.
3. Then the kill section: one clip per kill (kills less than 2 s apart share a clip). A clip's start is a time in the RECORDING, never a position in the montage; copy it exactly from the lists above.
   - Normal: speed 1, start from CLIP STARTS, len 3 to 5 s.
   - Speed-up: speed 1.5, start from CLIP STARTS, len 3 to 6 s (it plays for len / 1.5).
   - Slow motion: speed 0.5, start from SLOW-MOTION CLIP STARTS, len 1.5 to 2 s (it plays for 2 x len).
   Use at least one slow-motion and one speed-up clip, at most one slow-motion clip for every 4 clips, and place them as the VARIATION says. The clip playing across dropAtSec should be the strongest kill (a multi-kill if there is one). Don't use a kill twice or let clips overlap in the recording.
   Make play times whole beats where you can, so the cuts land on beats.
4. The play time of all clips (len / speed, added up) should reach the LENGTH when there are enough kills; the end is trimmed with a fade.
5. totalKills is the number of kills inside the kept clips.
{step6}Write each clip's keys in exactly this order: id, start, len, speed, role. Numbers, not strings, with at most 2 decimals. Number the clips id 1, 2, 3... in montage order.
Answer exactly in this shape: {{"beatSec": number, "dropAtSec": number, {hook_key}"clips": [{{"id": integer, "start": number, "len": number, "speed": number, "role": string}}], "totalKills": integer, "notes": string}}. If there are no kills, answer {{"beatSec": 0.5, "dropAtSec": 0, {hook_zero}"clips": [], "totalKills": 0, "notes": "no kills"}}."""

def style(lyrical):
    g = G()
    for nid, name, typ, sample in (("video_in", "video", "file:video", ""), ("kills_in", "kills", "text", '{"kills":[{"t":51}],"totalKills":1}'),
                                   ("flex_in", "flex", "text", '{"flex":[{"start":20,"what":"knife out"}]}'), ("game_dur", "gameDurationSec", "text", "2400"),
                                   ("audio_in", "audio", "file:audio", ""), ("song_dur", "songDurationSec", "text", "22"),
                                   ("loudness_in", "loudness", "text", "0.000000,-30.0"), ("max_dur", "maxDurationSec", "text", "60"),
                                   ("variation_in", "variation", "text", "Put the slow-motion clip third and the speed-up clips early.")):
        inp(g, nid, name, typ, sample)
    if lyrical: inp(g, "words_in", "words", "text", "[]")
    g.take("llm", "kill_list", "kill_times", "lead_normal", "lead_slow", "zero_num", "starts_normal_raw", "starts_slow_raw", "starts_normal", "starts_slow",
           "starts_normal_csv", "starts_slow_csv", "starts_normal_alt", "starts_slow_alt", "plan", "clips", "has_speed", "len_max", "len_min", "start_allowed",
           "clip_id_range", "clip_id_range_text", "clip_items_joined", "slow_filters", "segment_filters", "segment_labels",
           "play_sum", "slow_clips", "slow_sum", "play_time", "end_time", "fade_len", "fade_start", "ffmpeg_args", "args_json", "args_list",
           "zero", "has_clips", "render_gate", "make_montage").keep_src_edges()
    if lyrical:
        g.take("caption_font", "words_sure", "words_clean", "caption_pick", "caption_item", "caption_joined", "word_apos", "word_punct", "caption_draw", "caption_keep").keep_src_edges()
    # kills and flex arrive as JSON text
    g.util("kills_json", "json-parse", {"fenced": False}).edge("kills_in", "value", "kills_json", "text")
    g.E = [e for e in g.E if e['to']['node'] != "kill_list"]; g.edge("kills_json", "value", "kill_list", "value")
    g.util("flex_json", "json-parse", {"fenced": False}).edge("flex_in", "value", "flex_json", "text")
    g.util("flex_list", "json-path", {"path": "flex", "fallback": "[]"}).edge("flex_json", "value", "flex_list", "value")
    g.util("flex_starts", "json-map", {"path": "start", "dropEmpty": True}).edge("flex_list", "value", "flex_starts", "value")
    g.util("flex_alt", "join", {"separator": "|"}).edge("flex_starts", "items", "flex_alt", "value")
    g.util("starts_pattern", "template", {"template": "^({{a}}|{{b}}|{{c}})0*$"})
    g.edge("starts_normal_alt", "value", "starts_pattern", "a").edge("starts_slow_alt", "value", "starts_pattern", "b").edge("flex_alt", "value", "starts_pattern", "c")
    g.edge("starts_pattern", "value", "start_allowed", "compareTo")
    # clip checks: clips -> has_speed -> len_max -> len_min -> start_allowed (v8 order)
    for a, b in (("clips", "has_speed"),): pass
    # planner
    extra = ("\nTHE SONG'S LYRICS, word by word with start and end in song seconds (may be empty): {{j}}\n" if lyrical else "")
    step6 = ('6. hook: the song\'s hook, the one word sung most often or most strongly while the montage plays (English letters only, copied from the lyrics), or "" if there are no lyrics. It is shown bigger each time it is sung.\n' if lyrical else "")
    prompt = PLAN_HEAD.format(style="lyrical kill montage: a very short intro flex, then back-to-back kills at mixed speeds, with the song's words on screen" if lyrical
                              else "kill montage: a short intro flex (no kill), then back-to-back kills at mixed speeds",
                              extra=extra, flex_len="1 to 1.5 s, ending on a beat" if lyrical else "2 to 4 s, ending on the drop if the drop comes within 4 s, otherwise on a beat around 3 s",
                              step6=step6, hook_key='"hook": string, ' if lyrical else "", hook_zero='"hook": "", ' if lyrical else "")
    g.util("plan_prompt", "template", {"template": prompt})
    g.util("kills_text", "json-stringify", {"indent": 0}).edge("kills_json", "value", "kills_text", "value")
    g.util("flex_text", "json-stringify", {"indent": 0}).edge("flex_list", "value", "flex_text", "value")
    g.util("cap", "math", {"op": "min"}).edge("song_dur", "value", "cap", "a").edge("max_dur", "value", "cap", "b")
    for port, (n, p) in {"a": ("kills_text", "value"), "f": ("game_dur", "value"), "m": ("flex_text", "value"), "k": ("starts_normal_alt", "value"),
                         "l": ("starts_slow_alt", "value"), "g": ("song_dur", "value"), "h": ("loudness_in", "value"), "i": ("cap", "value"),
                         "n": ("variation_in", "value")}.items():
        g.edge(n, p, "plan_prompt", port)
    if lyrical: g.edge("words_in", "value", "plan_prompt", "j")
    g.edge("llm", "connection", "plan", "connection").edge("plan_prompt", "value", "plan", "prompt")
    # speed-up clips: 1.5x picture and game audio, a horizontal whip blur on the first frames
    normal = SRC["segment_filters"]["params"]["replace"]
    a1, a2 = "setpts=PTS-STARTPTS,fps=60,split=2[f$1][b$1];", "aresample=48000[a$1];"
    assert a1 in normal and a2 in normal
    fast = normal.replace(a1, "setpts=(PTS-STARTPTS)/1.5,fps=60,avgblur=sizeX=48:sizeY=1:enable='lt(t,0.07)',split=2[f$1][b$1];").replace(a2, "aresample=48000,atempo=1.5[a$1];")
    g.util("fast_filters", "regex", {"flags": "g", "pattern": clip_pat(r'1\.50*'), "replace": fast})
    g.N["slow_filters"]["params"]["pattern"] = clip_pat(r'0?\.50*'); g.N["segment_filters"]["params"]["pattern"] = clip_pat(r'1(?:\.0+)?')
    g.E = [e for e in g.E if not (e['to']['node'] in ("slow_filters", "segment_filters") and e['to']['port'] == "text")]
    g.edge("clip_items_joined", "value", "slow_filters", "text").edge("slow_filters", "text", "fast_filters", "text").edge("fast_filters", "text", "segment_filters", "text")
    # play time = sum(len) + sum(len of slow) - sum(len of fast) / 3 ; end = min(play time, cap)
    g.util("fast_clips", "json-filter", {"path": "speed", "op": "greater", "compareTo": "1"}).edge("start_allowed", "items", "fast_clips", "value")
    g.util("fast_sum", "json-aggregate", {"op": "sum", "path": "len"}).edge("fast_clips", "items", "fast_sum", "value")
    g.util("three", "number", {"value": 3}).util("fast_saving", "math", {"op": "divide"}).edge("fast_sum", "value", "fast_saving", "a").edge("three", "value", "fast_saving", "b")
    g.util("play_net", "math", {"op": "subtract"}).edge("play_time", "value", "play_net", "a").edge("fast_saving", "value", "play_net", "b")
    g.E = [e for e in g.E if e['to']['node'] != "end_time"]
    g.edge("play_net", "value", "end_time", "a").edge("cap", "value", "end_time", "b")
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
        g.edge("caption_font", "file", "make_montage", "input")
        # every confident, clean word sung before the montage ends, centred, glowing, fading in over 0.08 s; the hook word bigger
        g.util("end_text", "template", {"template": "{{a}}"}).edge("end_time", "value", "end_text", "a")
        g.util("words_json", "json-parse", {"fenced": False}).edge("words_in", "value", "words_json", "text")
        g.util("words_before", "json-filter", {"path": "start", "op": "less-or-equal"})
        g.edge("words_json", "value", "words_before", "value").edge("end_text", "value", "words_before", "compareTo")
        g.E = [e for e in g.E if e['to']['node'] != "words_sure"]; g.edge("words_before", "items", "words_sure", "value")
        base = g.N["caption_draw"]["params"]["replace"]
        assert "fontsize=84" in base and "y=h*0.875-text_h/2" in base, base
        word = base.replace("y=h*0.875-text_h/2", "y=h*0.5-text_h/2").replace(":enable=", ":alpha='min(1,(t-$2)/0.08)':enable=")
        g.N["caption_draw"]["params"]["replace"] = word.replace("fontsize=84", "fontsize=130")
        g.util("hook", "json-path", {"path": "hook", "fallback": '""'}).edge("plan", "json", "hook", "value")
        g.util("hook_clean", "regex", {"flags": "g", "pattern": "[^A-Za-z’]", "replace": ""}).edge("hook", "value", "hook_clean", "text")
        cap_pat = g.N["caption_draw"]["params"]["pattern"]
        assert '"word":"([A-Za-z0-9’\\-]{1,14})"' in cap_pat, cap_pat
        g.util("hook_pattern", "template", {"template": cap_pat.replace('"word":"([A-Za-z0-9’\\-]{1,14})"', '"word":"({{a}})"')})
        g.edge("hook_clean", "text", "hook_pattern", "a")
        g.util("hook_draw", "regex", {"flags": "gi", "replace": word.replace("fontsize=84", "fontsize=170")})
        g.edge("hook_pattern", "value", "hook_draw", "pattern")
        g.E = [e for e in g.E if not (e['to']['node'] == "caption_draw" and e['to']['port'] == "text")]
        g.edge("word_punct", "text", "hook_draw", "text").edge("hook_draw", "text", "caption_draw", "text")
        g.edge("caption_keep", "text", "ffmpeg_args", "g")
    g.node("out", kind="output", fields=["montage", "plan"])
    g.edge("make_montage", "file", "out", "montage").edge("plan", "json", "out", "plan")
    name = "style-lyrical-kill-montage" if lyrical else "style-kill-montage"
    return g.doc(name, ("Lyrical kill montage (docs/edit-styles/lyrical-kill-montage.md)" if lyrical else "Kill montage (docs/edit-styles/kill-montage.md)")
                 + " from a gameplay-index and a song-index: intro flex, mixed normal / 0.5x / 1.5x kill clips placed by a per-run variation, beat-synced, 9:16 blurred layout, flash + zoom (+ whip on speed-ups), song from its start"
                 + (", every sung word centred and glowing, the hook bigger." if lyrical else ", no text."))

if __name__ == "__main__":
    for fname, d in (("style-kill-montage", style(False)), ("style-lyrical-kill-montage", style(True))):
        json.dump(d, open(os.path.join(HERE, f'{fname}.json'), 'w'), indent=2)
        print(fname, "nodes", len(d['graph']['nodes']), "edges", len(d['graph']['edges']))
