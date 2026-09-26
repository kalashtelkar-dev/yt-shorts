import type { catalogItems } from "./schema";

// Initial catalog (PLAN.md §0). After seeding, the admin Catalog page owns these rows.
// ponytail: stageMap prefixes are provisional until `pnpm enginex:smoke` shows the real step names.
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
      { match: "read_feed", label: "Reading the kill feed" },
      { match: "find", label: "Finding your kills" },
      { match: "plan", label: "Planning the edit" },
      { match: "render", label: "Rendering" },
    ],
    outputKey: "montage",
    defaultEstimateSec: 900,
  },
  {
    slug: "lyrical-kill-montage",
    title: "Lyrical Kill Montage",
    description: "Your kills timed to a song, with the lyrics on screen.",
    templateId: "tpl_fgi2j31DHK_M",
    enabled: true,
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
      { match: "read_feed", label: "Reading the kill feed" },
      { match: "find", label: "Finding your kills" },
      { match: "whisper", label: "Syncing the lyrics" },
      { match: "plan", label: "Planning the edit" },
      { match: "render", label: "Rendering" },
    ],
    outputKey: "montage",
    defaultEstimateSec: 1900,
  },
];
