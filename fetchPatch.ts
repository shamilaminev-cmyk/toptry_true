// fetchPatch.ts
export function patchFetchForApi() {
  if (typeof window === 'undefined') return;

  const w = window as any;

  // ✅ защита от повторного патча
  if (w.__toptryFetchPatched) return;
  w.__toptryFetchPatched = true;

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

