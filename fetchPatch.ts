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

function inferMethod(input: RequestInfo | URL, init?: RequestInit) {
  const method =
    (init?.method ||
      (typeof Request !== "undefined" && input instanceof Request ? input.method : "") ||
      "GET").toString();

  return method.toUpperCase();
}

function isApiUrl(url: string) {
  try {
    if (url.startsWith("/api") || url.startsWith("api")) return true;
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url);
      return u.pathname === "/api" || u.pathname.startsWith("/api/");
    }
  } catch {
    return false;
  }

  return false;
}

function isMediaUrl(url: string) {
  try {
    if (url.startsWith("/media") || url.startsWith("media")) return true;
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url);
      return u.pathname === "/media" || u.pathname.startsWith("/media/");
    }
  } catch {
    return false;
  }

  return false;
}

function mergeNoStoreHeaders(headers?: HeadersInit) {
  const h = new Headers(headers || {});
  h.set("Cache-Control", "no-cache");
  h.set("Pragma", "no-cache");
  return h;
}

function addCacheBuster(url: string, attempt: number) {
  const token = `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url);
      u.searchParams.set("_t", token);
      return u.toString();
    }

    const [path, hash = ""] = url.split("#");
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}_t=${encodeURIComponent(token)}${hash ? `#${hash}` : ""}`;
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_t=${encodeURIComponent(token)}`;
  }
}

function shouldRetryApiResponse(resp: Response) {
  return (
    resp.status === 304 ||
    resp.status === 408 ||
    resp.status === 425 ||
    resp.status === 429 ||
    resp.status === 500 ||
    resp.status === 502 ||
    resp.status === 503 ||
    resp.status === 504
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

    let rewrittenUrl = originalUrl;

    const relativePath = normalizeRelativeApiOrMedia(originalUrl);
    if (relativePath) {
      const explicitOrigin = explicitApiOriginForNonToptryHost();
      rewrittenUrl = explicitOrigin ? `${explicitOrigin}${relativePath}` : relativePath;
    }

    const method = inferMethod(input, init);
    const apiRequest = isApiUrl(rewrittenUrl);
    const mediaRequest = isMediaUrl(rewrittenUrl);
    const apiGet = apiRequest && method === "GET";

    const nextInit: RequestInit = apiRequest || mediaRequest
      ? {
          ...(init || {}),
          credentials: "include",
          ...(apiRequest
            ? {
                cache: "no-store",
                headers: mergeNoStoreHeaders((init || {}).headers),
              }
            : {}),
        }
      : (init || {});

    const maxAttempts = apiGet ? 3 : 1;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const attemptUrl = apiGet ? addCacheBuster(String(rewrittenUrl), attempt + 1) : rewrittenUrl;

      try {
        const resp = await originalFetch(attemptUrl as any, nextInit);

        if (apiGet && shouldRetryApiResponse(resp) && attempt < maxAttempts - 1) {
          console.warn("[toptry][fetchPatch] retrying api response", {
            url: String(rewrittenUrl || ""),
            status: resp.status,
            attempt: attempt + 1,
          });

          await sleep(300 + attempt * 500);
          continue;
        }

        if (apiRequest && resp.status === 304) {
          throw new Error(`API returned unexpected 304: ${String(rewrittenUrl || "")}`);
        }

        return resp;
      } catch (err) {
        lastError = err;

        if (apiGet && attempt < maxAttempts - 1) {
          console.warn("[toptry][fetchPatch] retrying api fetch error", {
            url: String(rewrittenUrl || ""),
            attempt: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          });

          await sleep(300 + attempt * 500);
          continue;
        }

        console.error("[toptry][fetchPatch] fetch failed", {
          url: String(rewrittenUrl || ""),
          error: err instanceof Error ? err.message : String(err),
        });

        throw err;
      }
    }

    throw lastError || new Error(`API fetch failed: ${String(rewrittenUrl || "")}`);
  };
}
