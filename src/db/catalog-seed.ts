import type { catalogItems } from "./schema";

// Initial catalog (PLAN.md §0). After seeding, the admin Catalog page owns these rows.
// stageMap matches the pipelines' engine step ids (smoke, 2026-09-26). Order = order in the pipeline;
// while several steps run in parallel, the earliest stage listed wins.
export const catalogSeed: (typeof catalogItems.$inferInsert)[] = [
  {
    slug: "kill-montage",
    title: "Kill Montage",
    description: "Every kill from your match, cut into one fast vertical edit.",
    templateId: "tpl_QUL4sc1xbOWL",
    enabled: true,
    beta: false,
    sortOrder: 1,
    durations: [30, 60, 90],
    fields: [{ name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32, help: "Exactly as it shows in the kill feed" }],
    inputMap: { youtubeUrl: "$source.url", playerName: "$fields.playerName" },
    stageMap: [
      { match: "download", label: "Downloading your video" },
      { match: "stamp_font", label: "Reading the kill feed" },
      { match: "kill_feed", label: "Reading the kill feed" },
      { match: "feed_frames", label: "Reading the kill feed" },
      { match: "read_feed", label: "Reading the kill feed" },
      { match: "find_kills", label: "Finding your kills" },
      { match: "make_montage", label: "Rendering your montage" },
    ],
    outputKey: "montage",
    // ponytail: placeholder prices; set real ones in the admin once runMs per length is measured.
    prices: { "30": 300, "60": 450, "90": 600 },
  },
  {
    slug: "lyrical-kill-montage",
    title: "Lyrical Kill Montage",
    description: "Your kills timed to a song, with the lyrics on screen.",
    templateId: "tpl_fgi2j31DHK_M",
    enabled: false, // hidden for now; admins can switch it on
    beta: true,
    sortOrder: 2,
    durations: [30, 60, 90],
    fields: [
      { name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32, help: "Exactly as it shows in the kill feed" },
      { name: "songUrl", label: "Song (YouTube link)", type: "url", required: true },
      { name: "songRange", label: "Part of the song", type: "range", maxFrom: "durationSec" },
      { name: "lyricsLrc", label: "Lyrics with timestamps (LRC)", type: "textarea", advanced: true },
    ],
    inputMap: {
      youtubeUrl: "$source.url",
      playerName: "$fields.playerName",
      songUrl: "$fields.songUrl",
      songStart: "$fields.songRange.start",
      songEnd: "$fields.songRange.end",
      lyricsLrc: "$fields.lyricsLrc",
    },
    stageMap: [
      { match: "download", label: "Downloading your video and song" },
      { match: "song_dl", label: "Downloading your video and song" },
      { match: "stamp_font", label: "Reading the kill feed" },
      { match: "kill_feed", label: "Reading the kill feed" },
      { match: "feed_frames", label: "Reading the kill feed" },
      { match: "read_feed", label: "Reading the kill feed" },
      { match: "song_cut", label: "Finding the beat" },
      { match: "bass_level", label: "Finding the beat" },
      { match: "lrc_to_lines", label: "Syncing the lyrics" },
      { match: "vox_filter", label: "Syncing the lyrics" },
      { match: "auto_lyrics", label: "Syncing the lyrics" },
      { match: "align_lyrics", label: "Syncing the lyrics" },
      { match: "plan_edit", label: "Planning the edit" },
      { match: "title_font", label: "Rendering your montage" },
      { match: "make_montage", label: "Rendering your montage" },
    ],
    outputKey: "montage",
    prices: { "30": 600, "60": 900, "90": 1200 },
  },
];
