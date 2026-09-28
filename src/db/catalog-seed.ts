import type { catalogItems } from "./schema";

// Initial catalog (PLAN.md §0). After seeding, the admin Catalog page owns these rows.
// stageMap matches the pipelines' engine step ids (smoke, 2026-09-26). Order = order in the pipeline;
// while several steps run in parallel, the earliest stage listed wins.
// Both styles are staged (docs/edit-styles/, pipelines/README.md): gameplay-index and song-index run in
// parallel and are cached, then the style pipeline plans and renders.
const INDEX = { gameplay: "tpl_yYsSXHkQXJBP", gameplayUpload: "tpl_K6Lo3rwFya4A", song: "tpl_sfY_wbow51wN" };
const FIELDS = [
  { name: "playerName", label: "Your in-game name", type: "text" as const, required: true, max: 32, help: "Exactly as it shows in the kill feed" },
  { name: "songUrl", label: "Song (YouTube link)", type: "url" as const, required: true, help: "The montage runs as long as the song, up to the length you pick" },
];
const INPUT_MAP = { youtubeUrl: "$source.url", video: "$source.key", playerName: "$fields.playerName", musicUrl: "$fields.songUrl", maxDurationSec: "$durationSec" };
// Index-phase steps first (they take longest), then the render. While steps run in parallel, the earliest listed wins.
const STAGE_MAP = [
  { match: "download", label: "Downloading your video", only: "url" as const },
  { match: "stamp_font", label: "Reading the kill feed" },
  { match: "kill_feed", label: "Reading the kill feed" },
  { match: "feed_frames", label: "Reading the kill feed" },
  { match: "read_feed", label: "Reading the kill feed", itemSeconds: 10 },
  { match: "find_kills", label: "Finding your kills" },
  { match: "flex", label: "Picking your intro" },
  { match: "music", label: "Getting your song" },
  { match: "vocals", label: "Listening to the lyrics" },
  { match: "lyrics", label: "Listening to the lyrics" },
  { match: "plan", label: "Planning your edit" },
  { match: "make_montage", label: "Rendering your montage" },
];

export const catalogSeed: (typeof catalogItems.$inferInsert)[] = [
  {
    slug: "kill-montage",
    title: "Kill Montage",
    description: "A quick intro, then your kills back to back, cut to your song.",
    templateId: "tpl_L9GCGiLR4xdr", // style-kill-montage
    indexTemplates: INDEX,
    enabled: true,
    beta: false,
    sortOrder: 1,
    durations: [30, 60, 90],
    fields: FIELDS,
    inputMap: INPUT_MAP,
    stageMap: STAGE_MAP,
    outputKey: "montage",
    // ponytail: placeholder prices; set real ones in the admin once runMs per length is measured.
    prices: { "30": 300, "60": 450, "90": 600 },
  },
  {
    slug: "lyrical-kill-montage",
    title: "Lyrical Kill Montage",
    description: "Your kills cut to your song, with its words on screen.",
    templateId: "tpl_DtMrjAKAX5Pl", // style-lyrical-kill-montage
    indexTemplates: INDEX,
    enabled: true,
    beta: true,
    sortOrder: 2,
    durations: [30, 60, 90],
    fields: FIELDS,
    inputMap: INPUT_MAP,
    stageMap: STAGE_MAP,
    outputKey: "montage",
    prices: { "30": 350, "60": 500, "90": 650 },
  },
];
