import type { Prisma } from "@/generated/prisma/client";
import type { CatalogField, CreditRange, IndexTemplates, InputMap, StageMapEntry } from "./types";

// A catalog insert with the JSON columns typed (scripts/catalog-sync.mts reads them).
type JsonColumns = "fields" | "inputMap" | "stageMap" | "creditRanges" | "indexTemplates";
export type CatalogSeedItem = Omit<Prisma.CatalogItemCreateManyInput, JsonColumns> & {
  fields: CatalogField[];
  inputMap: InputMap;
  stageMap: StageMapEntry[];
  creditRanges: Record<string, CreditRange>;
  indexTemplates?: IndexTemplates | null;
};

// Initial catalog (PLAN.md §0). After seeding, the admin Catalog page owns these rows.
// stageMap matches the pipelines' engine step ids (smoke, 2026-09-26). Order = order in the pipeline;
// while several steps run in parallel, the earliest stage listed wins.
// All styles are staged (docs/edit-styles/, pipelines/README.md): gameplay-index and song-index run in
// parallel and are cached, then the style pipeline plans and renders.
const INDEX = { gameplay: "tpl_v6kGXcY1_I82", gameplayUpload: "tpl_6V6yanSolGTE", song: "tpl_gLc9bMedBz16", songUpload: "tpl_sVzbs9FDpeFW" };
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
  { match: "transcript", label: "Listening to the lyrics" },
  { match: "aligned", label: "Timing the lyrics" },
  { match: "voice", label: "Timing the lyrics" },
  { match: "plan", label: "Planning your edit" },
  { match: "make_montage", label: "Rendering your montage" },
  { match: "clean_audio", label: "Removing voice chat" },
  { match: "final_cut", label: "Adding your song" },
];

export const catalogSeed: CatalogSeedItem[] = [
  {
    slug: "kill-montage",
    title: "Kill Montage",
    description: "A quick intro, then your kills back to back, cut to your song.",
    templateId: "tpl_A_MNb8DRHume", // style-kill-montage
    indexTemplates: INDEX,
    enabled: true,
    beta: false,
    sortOrder: 1,
    durations: [30, 60, 90],
    fields: FIELDS,
    inputMap: INPUT_MAP,
    stageMap: STAGE_MAP,
    outputKey: "montage",
    // Credits = seconds of editing. From measured run times (Sep 2026); admins tune them in the catalog.
    // From the 10-link test (2026-09-30): 30 s jobs used 386-742 s on 16-30 min matches. 60/90 s not measured yet.
    creditRanges: { "30": { min: 350, max: 900 }, "60": { min: 400, max: 1000 }, "90": { min: 450, max: 1100 } },
  },
  {
    // Smart Edit, called Ultra Edit until 2026-09-30 (the user renamed it; its pipeline is still style-ultra-edit)
    slug: "smart-edit",
    title: "Smart Edit",
    description: "Every kill slowed down, sped up and spun into the next, with loud gunshots and your song's words.",
    templateId: "tpl_dxRIHs2Bd4VP", // style-ultra-edit
    indexTemplates: INDEX,
    enabled: true,
    beta: true,
    sortOrder: 2,
    durations: [30, 60, 90],
    fields: FIELDS,
    inputMap: INPUT_MAP,
    stageMap: STAGE_MAP,
    outputKey: "montage",
    creditRanges: { "30": { min: 500, max: 1000 }, "60": { min: 550, max: 1100 }, "90": { min: 600, max: 1200 } },
  },
];
