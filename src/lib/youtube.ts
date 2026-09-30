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

/** YouTube's own 320 × 180 still for a video (next.config.ts allows only this host and path). */
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const youtubeWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
