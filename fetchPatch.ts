const TOPTRY_FETCH_PATCH_FLAG = "__toptry_fetch_patched__";

// Safe fetch patch:
// - on production web hosts, keep /api and /media same-origin;
// - nginx proxies /api and /media to backend;
// - this avoids mobile cross-origin/CORS/preflight issues;
// - diagnostics must never be able to break app boot.

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

function normalizeOrigin(origin?: string | null) {
  const s = (origin || "").toString().trim();
  if (!s) return "";
  return s.replace(/\/+$/g, "");
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

function explicitApiOriginForNonToptryHost() {
  if (typeof window === "undefined") return "";

  // For local/dev/preview builds only: respect VITE_API_ORIGIN if provided.
  // On toptry.ru itself, same-origin /api is safer and already proxied by nginx.
  if (isToptryWebHost()) return "";

  const envOrigin = normalizeOrigin(import.meta.env.VITE_API_ORIGIN as string | undefined);
  if (envOrigin) return envOrigin;

  return "";
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
      let shouldForceCredentials = false;

      const relativePath = normalizeRelativeApiOrMedia(originalUrl);

      if (relativePath) {
        shouldForceCredentials = true;

        const explicitOrigin = explicitApiOriginForNonToptryHost();
        rewrittenUrl = explicitOrigin ? `${explicitOrigin}${relativePath}` : relativePath;
      } else if (/^https?:\/\//i.test(originalUrl)) {
        try {
          const u = new URL(originalUrl);
          const p = u.pathname;
          const isApiOrMedia =
            p === "/api" || p.startsWith("/api/") ||
            p === "/media" || p.startsWith("/media/");

          if (isApiOrMedia) {
            shouldForceCredentials = true;
          }
        } catch {
          // keep original
        }
      }

      const isApiRequest = shouldForceCredentials || String(rewrittenUrl || "").startsWith("/api");

      const nextInit: RequestInit = isApiRequest
        ? {
            ...(init || {}),
            credentials: "include",
            cache: "no-store",
            headers: {
              ...(((init || {}) as RequestInit).headers || {}),
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
            },
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
      // The fetch patch must never break the app.
      // Fall back to the browser's original fetch.
      console.error("[toptry][fetchPatch] patched fetch failed; falling back", err);
      return originalFetch(input as any, init);
    }
  };
}
