const TOPTRY_FETCH_PATCH_FLAG = "__toptry_fetch_patched__";

function isApiOrMediaLike(url: string) {
  return (
    url === "/api" ||
    url.startsWith("/api/") ||
    url.startsWith("/api?") ||
    url === "api" ||
    url.startsWith("api/") ||
    url.startsWith("api?") ||
    url === "/media" ||
    url.startsWith("/media/") ||
    url.startsWith("/media?") ||
    url === "media" ||
    url.startsWith("media/") ||
    url.startsWith("media?")
  );
}

function normalizeRelativeApiOrMedia(url: string) {
  if (!isApiOrMediaLike(url)) return "";
  return url.startsWith("/") ? url : `/${url}`;
}

function isToptryWebHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host === "toptry.ru" ||
    host === "www.toptry.ru" ||
    host === "staging.toptry.ru"
  );
}

function normalizeOrigin(origin?: string | null) {
  const s = (origin || "").toString().trim();
  if (!s) return "";
  return s.replace(/\/+$/g, "");
}

function explicitApiOriginForNonToptryHost() {
  if (typeof window === "undefined") return "";

  // On toptry.ru/staging.toptry.ru nginx proxies /api and /media.
  // Keeping same-origin is safer for mobile browsers and avoids cross-origin cache quirks.
  if (isToptryWebHost()) return "";

  return normalizeOrigin(import.meta.env.VITE_API_ORIGIN as string | undefined);
}

function mergeNoStoreHeaders(headers?: HeadersInit) {
  const h = new Headers(headers || {});
  h.set("Cache-Control", "no-cache");
  h.set("Pragma", "no-cache");
  return h;
}

export function patchFetchForApi() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const w = window as any;
  if (w[TOPTRY_FETCH_PATCH_FLAG]) return;
  w[TOPTRY_FETCH_PATCH_FLAG] = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const originalUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      let rewrittenUrl = originalUrl;
      let isApiRequest = false;
      let isApiOrMediaRequest = false;

      const relativePath = normalizeRelativeApiOrMedia(originalUrl);

      if (relativePath) {
        isApiOrMediaRequest = true;
        isApiRequest = relativePath === "/api" || relativePath.startsWith("/api/") || relativePath.startsWith("/api?");

        const explicitOrigin = explicitApiOriginForNonToptryHost();
        rewrittenUrl = explicitOrigin ? `${explicitOrigin}${relativePath}` : relativePath;
      } else if (/^https?:\/\//i.test(originalUrl)) {
        try {
          const u = new URL(originalUrl);
          const p = u.pathname;
          isApiOrMediaRequest =
            p === "/api" || p.startsWith("/api/") ||
            p === "/media" || p.startsWith("/media/");
          isApiRequest = p === "/api" || p.startsWith("/api/");
        } catch {
          // keep original
        }
      }

      const nextInit: RequestInit = isApiOrMediaRequest
        ? {
            ...(init || {}),
            credentials: "include",
            ...(isApiRequest
              ? {
                  cache: "no-store",
                  headers: mergeNoStoreHeaders((init || {}).headers),
                }
              : {}),
          }
        : (init || {});

      const resp = await originalFetch(rewrittenUrl as any, nextInit);

      if (isApiRequest && resp.status === 304) {
        console.error("[toptry][fetchPatch] API returned unexpected 304", {
          url: String(rewrittenUrl || ""),
        });
        throw new Error(`API returned unexpected 304: ${String(rewrittenUrl || "")}`);
      }

      return resp;
    } catch (err) {
      console.error("[toptry][fetchPatch] patched fetch failed", err);
      throw err;
    }
  };
}
