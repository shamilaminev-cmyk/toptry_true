// utils/withApiOrigin.ts
export function withApiOrigin(url?: string | null): string {
  const s = (url || "").toString();
  if (!s) return "";

  // keep data/blob as-is
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;

  // Build-time origin (vite)
  const apiOriginRaw = (import.meta as any)?.env?.VITE_API_ORIGIN?.toString?.() || "";

  // Runtime fallback for static hosting:
  // <meta name="toptry-api-origin" content="%VITE_API_ORIGIN%">
  const metaOrigin =
    typeof window !== "undefined"
      ? ((document.querySelector('meta[name="toptry-api-origin"]') as any)?.content?.toString?.() || "")
      : "";

  const apiOrigin = (apiOriginRaw || metaOrigin).replace(/\/+$/g, "");

  // no origin => keep same-origin behavior
  if (!apiOrigin) return s;

  // relative /api and /media => prefix
  if (
    s.startsWith("/api/") || s === "/api" || s.startsWith("/api?") ||
    s.startsWith("/media/") || s === "/media" || s.startsWith("/media?")
  ) {
    return `${apiOrigin}${s}`;
  }

  // absolute URLs: keep, BUT if they point to /api or /media => rewrite origin to apiOrigin
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const p = u.pathname;
      const isApi = p === "/api" || p.startsWith("/api/");
      const isMedia = p === "/media" || p.startsWith("/media/");
      if (isApi || isMedia) {
        return `${apiOrigin}${u.pathname}${u.search}${u.hash}`;
      }
    } catch {
      // ignore parse errors
    }
    return s;
  }

  return s;
}
