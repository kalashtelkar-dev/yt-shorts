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
  events: { at: string; message: string; level: "info" | "warn" | "error" }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number;
  credits: number;
  kills: number | null;
  videoTitle: string | null;
  error: string | null;
};

export type LibraryItem = {
  id: string;
  title: string;
  status: PublicStatus;
  createdAt: string;
  durationSec: number;
  kills: number | null;
  videoTitle: string | null;
};

export type CatalogOption = {
  slug: string;
  /** This style also takes uploaded files. */
  uploads: boolean;
  title: string;
  description: string;
  beta: boolean;
  durations: number[];
  prices: Record<string, number>;
  fields: { name: string; label: string; type: "text" | "url" | "textarea" | "range"; required?: boolean; max?: number; advanced?: boolean; help?: string }[];
};

export const isFinished = (s: PublicStatus) => s === "succeeded" || s === "failed";
