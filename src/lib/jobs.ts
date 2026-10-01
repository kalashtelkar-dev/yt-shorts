// Types shared by server and client. No server imports here.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; field?: string } };

export type PublicStatus = "queued" | "running" | "succeeded" | "failed";

export type PublicJob = {
  id: string;
  title: string;
  status: PublicStatus;
  stage: string | null;
  /** e.g. "4:10 of 24:00 scanned" */
  stageDetail: string | null;
  stages: string[];
  progress: number; // 0..1
  /** While the video downloads: its own progress (whole percent, bytes, seconds left), then joining and saving it. */
  download: { pct: number; bytes: number; totalBytes: number; etaSec: number | null; phase?: "downloading" | "joining" | "saving" } | null;
  events: { at: string; message: string; level: "info" | "warn" | "error" }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number; // the length picked
  /** The finished montage's real length (null for older jobs), and why it's shorter than picked when it is. */
  lengthSec: number | null;
  lengthNote: string | null;
  credits: number;
  kills: number | null;
  videoTitle: string | null;
  error: string | null;
  /** What the montage is made from, as the user gave it; titles appear once the video and song have been read. */
  sources: { gameplay: MediaSource; song: MediaSource | null };
};

/** A YouTube video (youtubeId set) or an uploaded file (youtubeId null). */
export type MediaSource = { youtubeId: string | null; title: string | null };

export type LibraryItem = {
  id: string;
  title: string;
  status: PublicStatus;
  createdAt: string;
  durationSec: number; // the real length once finished (when known), else the length picked
  kills: number | null;
  videoTitle: string | null;
  progress: number; // 0..1
  /** Signed link to the cover still, fresh on every render (never stored). */
  poster: string | null;
  /** Friendly reason, for failed jobs only. */
  error: string | null;
};

export type CatalogOption = {
  slug: string;
  /** This style also takes uploaded files. */
  uploads: boolean;
  /** The song can be an uploaded audio file instead of a YouTube link. */
  songUploads: boolean;
  title: string;
  description: string;
  beta: boolean;
  durations: number[];
  /** Credits each length usually uses (1 a second); starting needs `max` free. */
  creditRanges: Record<string, { min: number; max: number }>;
  fields: { name: string; label: string; type: "text" | "url" | "textarea" | "range"; required?: boolean; max?: number; advanced?: boolean; help?: string }[];
};

export const isFinished = (s: PublicStatus) => s === "succeeded" || s === "failed";
