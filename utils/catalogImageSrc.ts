export function catalogImageSrc(
  rawUrl?: string | null,
  options?: { w?: number | null }
): string {
  if (!rawUrl) return "";

  const params = new URLSearchParams();
  params.set("url", String(rawUrl));

  const width = Number(options?.w || 0);
  if (Number.isFinite(width) && width > 0) {
    params.set("w", String(Math.round(width)));
  }

  const path = `/api/catalog/image?${params.toString()}`;

  if (typeof window === "undefined") return path;

  const host = window.location.hostname.toLowerCase();

  if (host === "toptry.ru" || host === "www.toptry.ru") {
    return `https://api.toptry.ru${path}`;
  }

  return path;
}
