// Shapes of the JSON columns. src/db/client.ts types the columns with these on every read.
import type { RunStep } from "@/server/enginex/types";

export type CatalogField = {
  name: string;
  label: string;
  type: "text" | "url" | "textarea" | "range";
  required?: boolean;
  max?: number;
  maxFrom?: "durationSec";
  advanced?: boolean;
  help?: string;
};
export type InputMap = Record<string, string | number | boolean>;
/**
 * `itemSeconds`: for fan-out steps, seconds of video per item, so progress can say "4:10 of 24:00 scanned".
 * `only`: show this stage only for link or upload jobs (e.g. downloading happens only for links).
 */
export type StageMapEntry = { match: string; label: string; itemSeconds?: number; only?: "url" | "upload" };
/**
 * A staged style (docs/edit-styles/README.md): the gameplay and the song are indexed by their own pipelines
 * (results cached in media_index), then `templateId` is the style pipeline that plans and renders.
 */
export type IndexTemplates = { gameplay: string; gameplayUpload?: string | null; song: string; songUpload?: string | null };
export type CreditRange = { min: number; max: number };
export type JobPhase = "index" | "render";

export type Seller = {
  legalName?: string;
  address?: string;
  stateCode?: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  website?: string;
  sac?: string;
  signatory?: string;
};
export type Buyer = { email: string; legalName: string | null; gstin: string | null; stateCode: string };

export type { RunStep };

/** jobs.download: the video download's latest progress (whole percent and bytes; eta in seconds). */
/** After the transfer Engine X joins picture and sound, then stores the file; rows saved before phases existed have none. */
export type DownloadPhase = "downloading" | "joining" | "saving";
export type DownloadProgress = { pct: number; bytes: number; totalBytes: number; etaSec: number | null; phase?: DownloadPhase };
