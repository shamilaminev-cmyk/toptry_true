// mediaUrl.ts
const MEDIA_ORIGIN = "https://api.toptry.ru";

export function mediaUrl(p?: string | null): string {
  if (!p) return "";

  // already absolute
  if (p.startsWith("http://") || p.startsWith("https://")) return p;

  // relative "/media/..."
  if (p.startsWith("/media/")) return `${MEDIA_ORIGIN}${p}`;

  // relative "users/..../cutouts/.."
  if (p.startsWith("users/")) return `${MEDIA_ORIGIN}/media/${p}`;

  // any other relative path
  return `${MEDIA_ORIGIN}/${p.replace(/^\/+/, "")}`;
}
