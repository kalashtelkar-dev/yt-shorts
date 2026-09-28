import "server-only";

// Friendly errors for users (CLAUDE.md §4.8). Keyed by the engine of the failed step, so they
// work for any pipeline. Raw errors stay in jobs.errorRaw for the admin.

const REFUND = "Your credits were returned.";

const BY_ENGINE: Record<string, string> = {
  ytdlp: `We couldn't download that video. Check the link is public and plays without signing in, then try again. ${REFUND}`,
  ocr: `We couldn't read the kill feed in this video. Use a Valorant or CS2 recording with the kill feed visible in the top-right corner. ${REFUND}`,
  vllm: `We couldn't find kills for that player name. Check it matches the kill feed exactly, including capitals. ${REFUND}`,
  whisperx: `We couldn't sync the lyrics to this song. Try a different part of the song, or leave the lyrics empty. ${REFUND}`,
  ffmpeg: `Rendering failed on our side. Try again in a few minutes. ${REFUND}`,
};

// Engine X renamed its engines on 2026-09-28; accept both names so old runs and new runs read the same.
const ALIAS: Record<string, string> = { "media-fetch": "ytdlp", video: "ffmpeg", llm: "vllm", transcribe: "whisperx" };
const canonical = (engine: string | null) => (engine ? (ALIAS[engine] ?? engine) : null);

const BY_CODE: Record<string, string> = {
  no_workers: `Our editing servers are busy right now. Try again in a few minutes. ${REFUND}`,
};

export const noKillsMessage = (name: string) =>
  `We didn't find any kills by "${name}" in this video. Check the name matches the kill feed exactly, including capitals, and that the video is a Valorant or CS2 match. ${REFUND}`;

/** Failures worth one automatic retry: infrastructure blips, not problems with the video or the edit. */
export function isTransientFailure(engine: string | null, error: string | null): boolean {
  if (/exit(ed)?( with)? code 137|out of memory|oom|timed? ?out|timeout|econn|connection|unavailable|503|502|worker (lost|died|restarted)/i.test(error ?? "")) return true;
  const e = canonical(engine);
  return e === "ocr" || e === "vllm";
}

export const TIMEOUT_MESSAGE = `This video took too long to edit, so we stopped. Try a shorter recording. ${REFUND}`;

export function publicErrorFor(engine: string | null, code?: string): string {
  const e = canonical(engine);
  return (code && BY_CODE[code]) || (e && BY_ENGINE[e]) || `Something went wrong on our side. Try again, or use a different video. ${REFUND}`;
}
