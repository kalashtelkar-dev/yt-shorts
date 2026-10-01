// YouTube links as users paste them (with &t=, &list=, &pp=…). Shared by server and client; no server imports here.

/** The 11-character video id of a watch, youtu.be or shorts link, else null. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    const id = host === "youtu.be" ? u.pathname.slice(1) : host === "youtube.com" ? (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : u.searchParams.get("v")) : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Why a pasted link can't make a montage, or null if it can: only https YouTube video links, and not Shorts
 * (a Short is already a finished vertical clip, not a match to edit).
 */
export function youtubeLinkProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "Paste a YouTube video link, like https://www.youtube.com/watch?v=…";
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (u.protocol !== "https:" || (host !== "youtube.com" && host !== "youtu.be")) return "Only YouTube links work. Paste one that starts with https://www.youtube.com/ or https://youtu.be/";
  if (host === "youtube.com" && u.pathname.startsWith("/shorts/")) return "Shorts links don't work. Paste the link to the full video instead.";
  if (!youtubeId(url.trim())) return "That link doesn't point to a video. Open the video on YouTube and copy its link.";
  return null;
}

/** YouTube's own 320 × 180 still for a video (next.config.ts allows only this host and path). */
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const youtubeWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
