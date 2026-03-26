export function catalogImageSrc(rawUrl?: string | null): string {
  if (!rawUrl) return "";

  const encoded = encodeURIComponent(String(rawUrl));
  const path = `/api/catalog/image?url=${encoded}`;

  if (typeof window === "undefined") return path;

  const host = window.location.hostname.toLowerCase();

  if (host === "toptry.ru" || host === "www.toptry.ru") {
    return `https://api.toptry.ru${path}`;
  }

  return path;
}
