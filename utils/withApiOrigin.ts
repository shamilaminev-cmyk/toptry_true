// utils/withApiOrigin.ts
function normalizeOrigin(origin?: string | null): string {
  const s = (origin || "").toString().trim();
  if (!s) return "";
  return s.replace(/\/+$/g, "");
}

function runtimeApiOrigin(): string {
  if (typeof window === "undefined") return "";

  const metaOrigin =
    (document.querySelector('meta[name="toptry-api-origin"]') as HTMLMetaElement | null)
      ?.content
      ?.toString?.() || "";

  const meta = normalizeOrigin(metaOrigin);
  if (meta && !meta.includes("%VITE_API_ORIGIN%")) return meta;

  const host = window.location.hostname.toLowerCase();

  if (host === "toptry.ru" || host === "www.toptry.ru") {
    return "https://api.toptry.ru";
  }

  if (host === "staging.toptry.ru") {
    return "https://staging-api.toptry.ru";
  }

  return "";
}

function apiOrigin(): string {
  const envOrigin = normalizeOrigin((import.meta as any)?.env?.VITE_API_ORIGIN?.toString?.() || "");
  return envOrigin || runtimeApiOrigin();
}

export function withApiOrigin(url?: string | null): string {
  const s = (url || "").toString();
  if (!s) return "";

  // keep data/blob as-is
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;

  const origin = apiOrigin();

  // no origin => keep same-origin behavior for local dev without env
  if (!origin) return s;

  // relative /api and /media => prefix
  if (
    s.startsWith("/api/") || s === "/api" || s.startsWith("/api?") ||
    s.startsWith("/media/") || s === "/media" || s.startsWith("/media?")
  ) {
    return `${origin}${s}`;
  }

  // relative api/media without leading slash
  if (
    s.startsWith("api/") || s === "api" || s.startsWith("api?") ||
    s.startsWith("media/") || s === "media" || s.startsWith("media?")
  ) {
    return `${origin}/${s}`;
  }

  // absolute URLs: keep, BUT if they point to /api or /media => rewrite origin to apiOrigin
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const p = u.pathname;
      const isApi = p === "/api" || p.startsWith("/api/");
      const isMedia = p === "/media" || p.startsWith("/media/");
      if (isApi || isMedia) {
        return `${origin}${u.pathname}${u.search}${u.hash}`;
      }
    } catch {
      // ignore parse errors
    }
    return s;
  }

  return s;
}
