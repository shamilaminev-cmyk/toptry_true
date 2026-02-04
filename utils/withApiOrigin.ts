// utils/withApiOrigin.ts
export function withApiOrigin(url?: string | null): string {
  if (!url) return '';
  const s = String(url).trim();

  // Absolute URLs - keep
  if (/^https?:\/\//i.test(s)) return s;

  // data/blob URLs - keep
  if (/^(data:|blob:)/i.test(s)) return s;

  const apiOrigin = import.meta.env.VITE_API_ORIGIN || '';

  // Media & API should go to apiOrigin in prod static hosting
  if (s.startsWith('/media/') || s.startsWith('/api/')) {
    return apiOrigin ? `${apiOrigin}${s}` : s;
  }

  return s;
}
