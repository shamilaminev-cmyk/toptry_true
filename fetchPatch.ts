// fetchPatch.ts

declare global {
  interface Window {
    __toptryFetchPatched?: boolean;
  }
}

export function patchFetchForApi() {
  if (typeof window === 'undefined') return;

  // ✅ стоп-кран от повторного патча
  if (window.__toptryFetchPatched) return;
  window.__toptryFetchPatched = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith('/api/') || url.startsWith('/media/')) {
      const nextInit: RequestInit = { ...(init || {}), credentials: 'include' };
      return originalFetch(input as any, nextInit);
    }
    return originalFetch(input as any, init);
  };
}

export function patchFetchForApi() {
  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    // Add credentials only for /api and /media
    if (url.startsWith('/api/') || url.startsWith('/media/')) {
      const nextInit: RequestInit = { ...(init || {}), credentials: 'include' };
      return originalFetch(input as any, nextInit);
    }

    return originalFetch(input as any, init);
  };
}
