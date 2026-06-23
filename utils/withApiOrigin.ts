// utils/withApiOrigin.ts
function normalizeOrigin(origin?: string | null): string {
  const s = (origin || "").toString().trim();
  if (!s) return "";
  return s.replace(/\/+$/g, "");
}

function isToptryWebHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host === "toptry.ru" ||
    host === "www.toptry.ru" ||
    host === "staging.toptry.ru"
  );
}

function explicitApiOriginForNonToptryHost(): string {
  if (typeof window === "undefined") return "";

  // On toptry.ru and staging.toptry.ru, nginx already proxies /api and /media.
  // Keeping same-origin avoids mobile cross-origin/CORS/preflight instability.
  if (isToptryWebHost()) return "";

  return normalizeOrigin((import.meta as any)?.env?.VITE_API_ORIGIN?.toString?.() || "");
}

export function withApiOrigin(url?: string | null): string {
  const s = (url || "").toString();
  if (!s) return "";

  if (s.startsWith("data:") || s.startsWith("blob:")) return s;

  const isRelativeApiOrMedia =
    s.startsWith("/api/") || s === "/api" || s.startsWith("/api?") ||
    s.startsWith("/media/") || s === "/media" || s.startsWith("/media?");

  const isBareApiOrMedia =
    s.startsWith("api/") || s === "api" || s.startsWith("api?") ||
    s.startsWith("media/") || s === "media" || s.startsWith("media?");

  const explicitOrigin = explicitApiOriginForNonToptryHost();

  if (isRelativeApiOrMedia) {
    return explicitOrigin ? `${explicitOrigin}${s}` : s;
  }

  if (isBareApiOrMedia) {
    return explicitOrigin ? `${explicitOrigin}/${s}` : `/${s}`;
  }

  if (/^https?:\/\//i.test(s)) {
    return s;
  }

  return s;
}
