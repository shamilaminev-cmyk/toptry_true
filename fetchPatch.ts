const TOPTRY_FETCH_PATCH_FLAG = "__toptry_fetch_patched__";

// fetchPatch.ts
// Monkeypatch window.fetch so that relative /api/* and /media/* calls
// go to the API origin and always include cookies.
//
// Production guard:
// if VITE_API_ORIGIN is missing in a stale/mobile/static bundle, toptry.ru must still
// not fetch /api/* from the web origin. Runtime fallback prevents silent HTML-as-JSON failures.

function normalizeOrigin(origin?: string | null) {
  const s = (origin || "").toString().trim();
  if (!s) return "";
  return s.replace(/\/+$/g, "");
}

function runtimeApiOrigin() {
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

function getApiOrigin() {
  const envOrigin = normalizeOrigin(import.meta.env.VITE_API_ORIGIN as string | undefined);
  return envOrigin || runtimeApiOrigin();
}

function pathFromApiLikeUrl(url: string) {
  if (
    url.startsWith("/api/") || url === "/api" || url.startsWith("/api?") ||
    url.startsWith("api/") || url === "api" || url.startsWith("api?")
  ) {
    return url.startsWith("/") ? url : `/${url}`;
  }

  if (
    url.startsWith("/media/") || url === "/media" || url.startsWith("/media?") ||
    url.startsWith("media/") || url === "media" || url.startsWith("media?")
  ) {
    return url.startsWith("/") ? url : `/${url}`;
  }

  return "";
}

function isApiPath(path: string) {
  return path === "/api" || path.startsWith("/api/") || path.startsWith("/api?");
}

export function patchFetchForApi() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const w = window as any;
  if (w[TOPTRY_FETCH_PATCH_FLAG]) return;
  w[TOPTRY_FETCH_PATCH_FLAG] = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const originalUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    const origin = getApiOrigin();
    let rewrittenUrl = originalUrl;
    let shouldForceCredentials = false;
    let apiPath = "";

    const relativePath = pathFromApiLikeUrl(originalUrl);

    if (relativePath) {
      shouldForceCredentials = true;
      apiPath = isApiPath(relativePath) ? relativePath : "";
      rewrittenUrl = origin ? `${origin}${relativePath}` : originalUrl;
    } else if (origin && /^https?:\/\//i.test(originalUrl)) {
      try {
        const u = new URL(originalUrl);
        const isApiOrMedia =
          u.pathname === "/api" || u.pathname.startsWith("/api/") ||
          u.pathname === "/media" || u.pathname.startsWith("/media/");
        if (isApiOrMedia) {
          shouldForceCredentials = true;
          apiPath = isApiPath(u.pathname) ? u.pathname : "";
          rewrittenUrl = `${origin}${u.pathname}${u.search}${u.hash}`;
        }
      } catch {
        // keep original
      }
    }

    const nextInit: RequestInit = shouldForceCredentials
      ? { ...(init || {}), credentials: "include" }
      : (init || {});

    const resp = await originalFetch(rewrittenUrl as any, nextInit);

    if (apiPath) {
      const contentType = resp.headers?.get?.("content-type") || "";
      if (resp.ok && contentType.includes("text/html")) {
        console.error("[toptry][api-origin] API returned HTML instead of JSON", {
          originalUrl,
          rewrittenUrl,
          status: resp.status,
          contentType,
        });
      }
    }

    return resp;
  };
}
