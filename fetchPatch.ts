// fetchPatch.ts
// Monkeypatch window.fetch so that relative /api/* and /media/* calls
// go to VITE_API_ORIGIN (e.g. https://api.toptry.ru) and always include cookies.

export function patchFetchForApi() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const apiOrigin = (import.meta as any)?.env?.VITE_API_ORIGIN as string | undefined;

  // If apiOrigin is not set, we still add credentials for relative calls.
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

    const isRelativeApi = url.startsWith('/api/') || url === '/api' || url.startsWith('/api?');
    const isRelativeMedia = url.startsWith('/media/') || url === '/media' || url.startsWith('/media?');

    if (isRelativeApi || isRelativeMedia) {
      // Rewrite only relative paths. If url is already absolute, keep as is.
      const rewritten =
        origin && url.startsWith('/')
          ? `${origin}${url}`
          : url;

      const nextInit: RequestInit = { ...(init || {}), credentials: 'include' };
      return originalFetch(rewritten, nextInit);
    }

    return originalFetch(input as any, init);
  };
}
