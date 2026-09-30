import "server-only";
import type { ActionResult } from "@/lib/jobs";
import type { SessionUser } from "./auth";
import { enginex } from "./enginex/client";
import { redis, underLimit } from "./redis";
import { getSettings } from "./settings";

// Direct browser → storage uploads (CLAUDE.md §7). The server only hands out a presigned PUT URL after
// checking type, size and rate, and remembers which user each key was issued to.

export type UploadKind = "video" | "audio";
const TYPES: Record<UploadKind, Record<string, string[]>> = {
  video: {
    mp4: ["video/mp4"],
    mov: ["video/quicktime"],
    mkv: ["video/x-matroska", "video/matroska"],
    webm: ["video/webm"],
  },
  // the song, uploaded instead of a YouTube link (the user, 2026-09-30)
  audio: {
    mp3: ["audio/mpeg", "audio/mp3"],
    m4a: ["audio/mp4", "audio/x-m4a", "audio/m4a"],
    wav: ["audio/wav", "audio/x-wav", "audio/wave"],
    aac: ["audio/aac", "audio/x-aac"],
    ogg: ["audio/ogg"],
    flac: ["audio/flac", "audio/x-flac"],
  },
};
const WRONG_TYPE: Record<UploadKind, string> = { video: "Upload an MP4, MOV, MKV or WebM video file.", audio: "Upload an MP3, M4A, WAV, AAC, OGG or FLAC audio file." };
export const UPLOAD_EXTENSIONS = Object.keys(TYPES.video);
const UPLOADS_PER_HOUR = 20;
const KEY_TTL_SEC = 24 * 3600;

/** A safe display/storage name: last path segment, harmless characters, at most 100 long. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "video";
  return base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(-100) || "video";
}

export async function issueUpload(user: SessionUser, file: { name: string; size: number; type: string }, kind: UploadKind = "video"): Promise<ActionResult<{ url: string; key: string }>> {
  const name = cleanFileName(file.name);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const types = TYPES[kind];
  // Browsers leave the type empty for some formats (often .mkv); then the extension decides.
  if (!Object.hasOwn(types, ext) || (file.type && !types[ext].includes(file.type))) {
    return { ok: false, error: { code: "type", message: WRONG_TYPE[kind] } };
  }
  const { maxUploadMb } = await getSettings();
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: { code: "empty", message: "That file is empty." } };
  if (file.size > maxUploadMb * 1024 * 1024) {
    return { ok: false, error: { code: "too_big", message: `That file is over ${maxUploadMb >= 1024 ? `${Math.round(maxUploadMb / 1024)} GB` : `${maxUploadMb} MB`}. ${kind === "audio" ? "Use a shorter file" : "Trim the recording"} or paste a YouTube link instead.` } };
  }
  if (!(await underLimit(`uploads:${user.id}`, UPLOADS_PER_HOUR, 3600))) {
    return { ok: false, error: { code: "rate_limited", message: "You've started a lot of uploads this hour. Try again later." } };
  }
  // ponytail: the presigned PUT can't enforce the declared size; storage quotas are the backstop.
  const { url, key } = await enginex().createUploadUrl(name, 3600);
  await redis.set(`upload:${key}`, user.id, "EX", KEY_TTL_SEC);
  return { ok: true, data: { url, key } };
}

/** True when `key` was issued to this user in the last 24 h. */
export async function ownsUpload(userId: string, key: string): Promise<boolean> {
  return (await redis.get(`upload:${key}`)) === userId;
}
