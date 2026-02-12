// utils/withApiOrigin.ts
export function withApiOrigin(url?: string | null): string {
  const s = (url || "").toString();
  if (!s) return "";

  // keep data/blob as-is
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;

  const apiOriginRaw = import.meta.env.VITE_API_ORIGIN || "";
  const apiOrigin = apiOriginRaw.replace(/\/+$/g, ""); // trim trailing "/"

  // no VITE_API_ORIGIN => keep same-origin behavior
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
