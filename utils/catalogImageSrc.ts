export function catalogImageSrc(
  rawUrl?: string | null,
  options?: { w?: number | null }
): string {
  if (!rawUrl) return "";

  // remington.fashion недоступен с DO/VPS, поэтому backend proxy не может скачать эти картинки.
  // Для <img> CORS не нужен, отдаём прямой URL в браузер.
  try {
    const u = new URL(String(rawUrl));
    if (u.hostname === "remington.fashion" || u.hostname === "www.remington.fashion") {
      return String(rawUrl);
    }
  } catch {}

  const params = new URLSearchParams();
  params.set("url", String(rawUrl));

  const width = Number(options?.w || 0);
  if (Number.isFinite(width) && width > 0) {
    params.set("w", String(Math.round(width)));
  }

  // Keep catalog images same-origin on toptry.ru.
  // nginx proxies /api/catalog/image to backend, so we avoid mobile cross-origin quirks.
  return `/api/catalog/image?${params.toString()}`;
}
