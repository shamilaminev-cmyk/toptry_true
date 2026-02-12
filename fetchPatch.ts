const TOPTRY_FETCH_PATCH_FLAG = "__toptry_fetch_patched__";

// fetchPatch.ts
// Monkeypatch window.fetch so that relative /api/* and /media/* calls
// go to VITE_API_ORIGIN (e.g. https://api.toptry.ru) and always include cookies.

export function patchFetchForApi() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const w = window as any;
  if (w[TOPTRY_FETCH_PATCH_FLAG]) return;
  w[TOPTRY_FETCH_PATCH_FLAG] = true;

  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  // IMPORTANT: use direct import.meta.env access so Vite replaces it reliably.
  const apiOrigin = import.meta.env.VITE_API_ORIGIN as string | undefined;

  // TEMP (optional): uncomment for one deploy to verify in prod console
  // console.log('[fetchPatch] VITE_API_ORIGIN =', apiOrigin);

  const normalizeOrigin = (origin?: string) => {
    if (!origin) return '';
    return origin.endsWith('/') ? origin.slice(0, -1) : origin;
  };

  const origin = normalizeOrigin(apiOrigin);

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Support both "/api/..." and "api/..." (some code uses no leading slash)
    const isApi =
      url.startsWith('/api/') || url === '/api' || url.startsWith('/api?') ||
      url.startsWith('api/') || url === 'api' || url.startsWith('api?');

    const isMedia =
      url.startsWith('/media/') || url === '/media' || url.startsWith('/media?') ||
      url.startsWith('media/') || url === 'media' || url.startsWith('media?');

    const isAbsApi = !!origin && (
      url.startsWith(origin + "/api/") || url === origin + "/api" || url.startsWith(origin + "/api?")
    );
    const isAbsMedia = !!origin && (
      url.startsWith(origin + "/media/") || url === origin + "/media" || url.startsWith(origin + "/media?")
    );

    if (isAbsApi || isAbsMedia) {
      const nextInit: RequestInit = { ...(init || {}), credentials: "include" };
      return originalFetch(input as any, nextInit);
    }


    if (isApi || isMedia) {
      // Rewrite relative paths to absolute using origin (if set).
      const path = url.startsWith('/') ? url : `/${url}`;
      const rewritten = origin ? `${origin}${path}` : url;

      const nextInit: RequestInit = { ...(init || {}), credentials: 'include' };
      return originalFetch(rewritten, nextInit);
    }

    return originalFetch(input as any, init);
  };
}
