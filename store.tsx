
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User, Product, Look, WardrobeItem, Gender, Category, SubscriptionTier, HomeLayout } from './types';
import { withApiOrigin } from "./utils/withApiOrigin";

const ENABLE_DB_SYNC = ((import.meta as any)?.env?.VITE_ENABLE_DB_SYNC || "").toString() === "1";


interface AppState {
  user: User | null;
  products: Product[];
  wardrobe: WardrobeItem[];
  looks: Look[];
  homeLayout: HomeLayout;
  loading: boolean;
  aiBusy: boolean;
  aiError: string | null;
  actions: {
    login: (emailOrUsername: string, password: string) => Promise<void>;
    register: (email: string, username: string, password: string) => Promise<void>;
    startPhoneAuth: (phone: string) => Promise<void>;
    verifyPhoneAuth: (phone: string, code: string) => Promise<any>;
    updateProfileSizes: (sizeTop: string, sizeBottom: string) => Promise<void>;
    logout: () => Promise<void>;
    toggleHomeLayout: () => void;
    addToWardrobe: (product: Product) => void;
    addMultipleToWardrobe: (products: Product[]) => void;
    upsertWardrobeItem: (item: WardrobeItem) => void;
    removeFromWardrobe: (id: string) => void;
    createLook: (items: WardrobeItem[]) => Promise<string | undefined>;
    setSelfie: (url: string) => void;
    likeLook: (id: string) => void;
    reactToLook: (id: string, reaction: 'like' | 'want_try' | 'would_buy') => Promise<void>;
    saveLook: (id: string) => Promise<void>;
  };
}

const AppContext = createContext<AppState | undefined>(undefined);



// Using picsum.photos for better CORS support when fetching images for AI processing
const getProductImage = (i: number, category: Category) => {
  return "";
};

const MOCK_PRODUCTS: Product[] = Array.from({ length: 40 }).map((_, i) => {
  const category = i % 4 === 0 ? Category.TOPS : (i % 4 === 1 ? Category.BOTTOMS : (i % 4 === 2 ? Category.SHOES : Category.ACCESSORIES));
  return {
    id: `p-${i}`,
    title: i % 2 === 0 ? `Футболка Basic №${i}` : `Джинсы Relaxed №${i}`,
    price: 1500 + (i * 100),
    currency: 'RUB',
    gender: i % 3 === 0 ? Gender.MALE : (i % 3 === 1 ? Gender.FEMALE : Gender.UNISEX),
    category,
    sizes: ['S', 'M', 'L', 'XL'],
    images: [getProductImage(i, category)],
    storeId: `s-${i % 5}`,
    availability: true,
    isCatalog: true,
  };
});

const MOCK_LOOKS: Look[] = Array.from({ length: 12 }).map((_, i) => ({
  id: `l-${i}`,
  userId: `u-${i % 3}`,
  title: `Стильный образ ${i + 1}`,
  items: [`p-${i}`, `p-${(i + 5) % 40}`],
  resultImageUrl: "",
  isPublic: true,
  likes: Math.floor(Math.random() * 50),
  comments: Math.floor(Math.random() * 10),
  createdAt: new Date(),
  authorName: ['alex_fit', 'marina_style', 'ksenia_vogue'][i % 3],
  authorAvatar: `https://i.pravatar.cc/150?u=${i % 3}`,
}));

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clampArray<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  return arr.slice(0, max);
}
async function urlToDataUrlIfMock(url: string): Promise<string> {
  if (!url) return url;
  if (url.startsWith('data:')) return url;

  // Convert local mock images into data URLs so backend doesn't fetch protected staging assets (BasicAuth -> 401)
  // We treat any URL containing "/mock/" as a mock asset.
  if (!url.includes('/mock/')) return url;

  // If url is absolute, convert to relative path to use current browser auth/session.
  let fetchUrl = url;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url);
      fetchUrl = u.pathname + (u.search || '');
    }
  } catch {
    // ignore
  }

  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Failed to fetch mock image: ${res.status} ${fetchUrl}`);
  const blob = await res.blob();

  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

const STORAGE_KEY = "toptry_state_v1";


export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [homeLayout, setHomeLayout] = useState<HomeLayout>(HomeLayout.DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Hydrate from localStorage (fast MVP persistence)
  useEffect(() => {
    const saved = safeParse<{ user: User | null; wardrobe: WardrobeItem[]; looks: Look[]; homeLayout: HomeLayout }>(
      typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    );

    if (saved) {
      setUser(saved.user || null);
      setWardrobe(Array.isArray(saved.wardrobe) ? saved.wardrobe : []);

      // Dates may come back as strings; keep them usable by re-wrapping if present.
      const restoredLooks = (Array.isArray(saved.looks) ? saved.looks : []).map((l: any) => ({
        ...l,
        createdAt: l?.createdAt ? new Date(l.createdAt) : new Date(),
      }));
      setLooks(restoredLooks.length ? restoredLooks : []);

      setHomeLayout(saved.homeLayout || HomeLayout.DASHBOARD);
    }

    // Simulate small loading skeleton
    const t = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/catalog/products', { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        const items = Array.isArray(data?.products) ? data.products : [];
        // allow empty (server is source of truth)
        setProducts(items);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Restore server session (JWT in httpOnly cookie)
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/auth/me', { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        if (!data?.user) return;
        const u = data.user;
        setUser((prev) => {
          return {
            id: u.id,
            email: u.email,
            name: prev?.name || u.username,
            username: u.username,
            phone: prev?.phone || '',
            avatarUrl: u.avatarUrl || prev?.avatarUrl,
            selfieUrl: prev?.selfieUrl,
            sizeTop: u.sizeTop || prev?.sizeTop,
            sizeBottom: u.sizeBottom || prev?.sizeBottom,
            tier: prev?.tier || SubscriptionTier.FREE,
            limits: prev?.limits || { hdTryOnRemaining: 5, looksRemaining: 10 },
            isPublic: !!u.isPublic,
          };
        });
      } catch {
        // ignore
      }
    })();
  }, []);

  // Always sync wardrobe from backend for authenticated user
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const resp = await fetch(`/api/wardrobe/list`, { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        const items = Array.isArray(data?.items) ? data.items : [];
        setWardrobe(
          items
            .map((raw: any) => ({
              ...raw,
              addedAt: raw?.addedAt ? new Date(raw.addedAt) : new Date(),
            }))
            .sort((a: any, b: any) =>
              new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
            )
        );
      } catch {
        // ignore
      }
    })();
  }, [user?.id]);

  // Always sync my looks from backend for authenticated user
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const resp = await fetch('/api/looks/my', { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        const serverLooks = Array.isArray(data?.looks) ? data.looks : [];
        setLooks(serverLooks.map((l: any) => ({ ...l, createdAt: new Date(l.createdAt) })));
      } catch {
        // ignore
      }
    })();
  }, [user?.id]);

  // Persist state (but avoid blowing up localStorage with huge base64 images)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Keep at most 10 looks in storage; if they include large data URLs, clamp harder.
    const looksForStorage = clampArray(
      looks,
      looks.some((l) => typeof l.resultImageUrl === 'string' && l.resultImageUrl.startsWith('data:')) ? 5 : 10
    );

    const payload = {
      user,
      wardrobe: clampArray(wardrobe, 200),
      looks: looksForStorage,
      homeLayout,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // If storage is full, fallback to storing minimal state without images.
      try {
        const compactLooks = looksForStorage.map((l) => ({ ...l, resultImageUrl: (typeof l.resultImageUrl === "string" && l.resultImageUrl.startsWith("data:")) ? "" : (l.resultImageUrl || "") }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, looks: compactLooks }));
      } catch {
        // ignore
      }
    }
  }, [user, wardrobe, looks, homeLayout]);

  const actions = useMemo(() => ({
    startPhoneAuth: async (phone: string) => {
      let resp: Response;
      try {
        const body = new URLSearchParams({ phone });
        resp = await fetch('/api/auth/phone/start', {
          method: 'POST',
          credentials: 'include',
          body,
        });
      } catch (e: any) {
        throw new Error('Не удалось связаться с сервером. Попробуйте обновить страницу или открыть сайт в новой вкладке.');
      }

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(data?.error || 'Не удалось отправить код');
      }
    },

    verifyPhoneAuth: async (phone: string, code: string) => {
      let resp: Response;
      try {
        const body = new URLSearchParams({ phone, code });
        resp = await fetch('/api/auth/phone/verify', {
          method: 'POST',
          credentials: 'include',
          body,
        });
      } catch (e: any) {
        throw new Error('Не удалось связаться с сервером. Попробуйте обновить страницу или открыть сайт в новой вкладке.');
      }

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(data?.error || 'Неверный код');
      }

      const u = data?.user;
      if (!u?.id) throw new Error('Сервер не вернул пользователя');

      setUser({
        id: u.id,
        email: u.email || undefined,
        name: u.username || undefined,
        username: u.username || undefined,
        phone: u.phone || phone,
        avatarUrl: u.avatarUrl || undefined,
        selfieUrl: undefined,
        sizeTop: u.sizeTop || undefined,
        sizeBottom: u.sizeBottom || undefined,
        tier: SubscriptionTier.FREE,
        limits: { hdTryOnRemaining: 5, looksRemaining: 10 },
        isPublic: u.isPublic ?? false,
      });

      return data;
    },
login: async (emailOrUsername: string, password: string) => {
  console.log('[auth] login start');

  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername, password }),
  });

  console.log('[auth] login response', resp.status);

  const raw = await resp.text();
  console.log('[auth] login body len', raw?.length ?? 0);

  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[auth] login JSON parse failed. First 300 chars:', raw?.slice(0, 300));
    throw new Error(`Login: invalid JSON (status ${resp.status})`);
  }

  if (!resp.ok) {
    console.error('[auth] login not ok', data);
    throw new Error(data?.error || `Login failed (${resp.status})`);
  }

  const u = data.user;
  if (!u?.id) throw new Error('Login: server did not return user');

  console.log('[auth] login setUser');

  setUser((prev) => ({
    id: u.id,
    email: u.email,
    name: prev?.name || u.username,
    username: u.username,
    phone: prev?.phone || '',
    avatarUrl: u.avatarUrl || prev?.avatarUrl,
    selfieUrl: prev?.selfieUrl,
    sizeTop: u.sizeTop || prev?.sizeTop,
    sizeBottom: u.sizeBottom || prev?.sizeBottom,
    tier: prev?.tier || SubscriptionTier.FREE,
    limits: prev?.limits || { hdTryOnRemaining: 5, looksRemaining: 10 },
    isPublic: u.isPublic ?? true,
  }));

  console.log('[auth] login done');
},

register: async (email: string, username: string, password: string) => {
  console.log('[auth] register start');

  const resp = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password }),
  });

  console.log('[auth] register response', resp.status);

  const raw = await resp.text();
  console.log('[auth] register body len', raw?.length ?? 0);

  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[auth] register JSON parse failed. First 300 chars:', raw?.slice(0, 300));
    throw new Error(`Register: invalid JSON (status ${resp.status})`);
  }

  if (!resp.ok) {
    console.error('[auth] register not ok', data);
    throw new Error(data?.error || `Registration failed (${resp.status})`);
  }

  const u = data.user;
  if (!u?.id) throw new Error('Register: server did not return user');

  console.log('[auth] register setUser');

  setUser((prev) => ({
    id: u.id,
    email: u.email,
    name: prev?.name || u.username,
    username: u.username,
    phone: prev?.phone || '',
    avatarUrl: u.avatarUrl || prev?.avatarUrl,
    selfieUrl: prev?.selfieUrl,
    sizeTop: u.sizeTop || prev?.sizeTop,
    sizeBottom: u.sizeBottom || prev?.sizeBottom,
    tier: prev?.tier || SubscriptionTier.FREE,
    limits: prev?.limits || { hdTryOnRemaining: 5, looksRemaining: 10 },
    isPublic: u.isPublic ?? true,
  }));

  console.log('[auth] register done');
},

    updateProfileSizes: async (sizeTop: string, sizeBottom: string) => {
      const resp = await fetch('/api/profile/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizeTop, sizeBottom }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(data?.error || 'Profile update failed');
      }

      setUser((prev) =>
        prev
          ? {
              ...prev,
              sizeTop: data?.user?.sizeTop || undefined,
              sizeBottom: data?.user?.sizeBottom || undefined,
            }
          : prev
      );
    },

    logout: async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null);
      setUser(null);
      setWardrobe([]);
      setLooks([]);
    },

    refreshMe: async () => {
      try {
        const resp = await fetch('/api/auth/me', { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        if (!data?.user) return;
        const u = data.user;
        setUser((prev) =>
          prev
            ? {
                ...prev,
                avatarUrl: u.avatarUrl || prev.avatarUrl,
                sizeTop: u.sizeTop || prev.sizeTop,
                sizeBottom: u.sizeBottom || prev.sizeBottom,
              }
            : prev
        );
      } catch {
        // ignore
      }
    },
    toggleHomeLayout: () => setHomeLayout(prev => 
      prev === HomeLayout.DASHBOARD ? HomeLayout.FEED : HomeLayout.DASHBOARD
    ),
    addToWardrobe: async (product: Product) => {
      const userId = user?.id || 'demo-user-id';

      if (user?.id) {
        try {
          const resp = await fetch('/api/wardrobe/save-catalog', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product),
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.ok && data?.item) {
            const saved = data.item;
            setWardrobe(prev => {
              const withoutSameSavedId = prev.filter(i => i.id !== saved.id);
              const alreadyPresent = withoutSameSavedId.some((i: any) => {
                if (!(i?.isCatalog || i?.sourceType === 'catalog')) return false;
                if (saved?.affiliateUrl && i?.affiliateUrl === saved.affiliateUrl) return true;
                if (saved?.productUrl && i?.productUrl === saved.productUrl) return true;
                if (saved?.images?.[0] && i?.images?.[0] === saved.images[0]) return true;
                return false;
              });

              if (alreadyPresent) {
                return withoutSameSavedId;
              }

              return [
                { ...saved, addedAt: saved?.addedAt ? new Date(saved.addedAt) : new Date() },
                ...withoutSameSavedId
              ];
            });
            return;
          }
        } catch {}
      }

      setWardrobe(prev => {
        if (prev.some(item => item.id === product.id)) return prev;
        const newItem: WardrobeItem = {
          ...product,
          userId: userId,
          addedAt: new Date(),
          isCatalog: true,
          sourceType: 'catalog',
        };
        return [newItem, ...prev];
      });
    },
    addMultipleToWardrobe: (products: Product[]) => {
      const userId = user?.id || 'demo-user-id';
      const newItems = products.map(p => ({
        ...p,
        userId: userId,
        addedAt: new Date(),
        isCatalog: false,
        sourceType: 'own',
      }));
      setWardrobe(prev => [...newItems, ...prev]);
    },
    upsertWardrobeItem: (item: WardrobeItem) => {
      setWardrobe((prev) => {
        const next = prev.filter((p) => p.id !== item.id);
        return [
          {
            ...item,
            addedAt: (item as any)?.addedAt
              ? new Date((item as any).addedAt)
              : new Date(),
          },
          ...next,
        ];
      });
    },
    removeFromWardrobe: async (id: string) => {
      try {
        const resp = await fetch(`/api/wardrobe/item/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          throw new Error(data?.error || 'Delete failed');
        }

        setWardrobe(prev => prev.filter(i => i.id !== id));
      } catch (e) {
        console.error('[wardrobe] delete failed', e);
      }
    },
    createLook: async (selectedItems: WardrobeItem[]) => {
      const selfieUrl = user?.selfieUrl || user?.avatarUrl;
      if (!user || !selfieUrl) {
        throw new Error('CREATE_LOOK_PRECHECK: missing user or selfie');
      }
      if (!selectedItems?.length) {
        throw new Error('CREATE_LOOK_PRECHECK: no selected items');
      }

      setAiError(null);
      setAiBusy(true);

      try {
        console.log('[createLook] start', {
          userId: user.id,
          selfieUrl,
          selectedCount: selectedItems.length,
          selectedIds: selectedItems.map((i) => i.id),
        });

        const rawItemImageUrls = selectedItems
          .map((i) => {
            const maybe =
              (i as any).cutoutUrl ||
              (i as any).originalUrl ||
              (i as any).imageUrl ||
              (i.images && i.images[0]);

            return typeof maybe === 'string' ? withApiOrigin(maybe) : null;
          })
          .filter(Boolean) as string[];

        console.log('[createLook] rawItemImageUrls', rawItemImageUrls);

        if (!rawItemImageUrls.length) {
          throw new Error('CREATE_LOOK_IMAGES: no usable image urls');
        }

        const itemImageUrls = await Promise.all(
          rawItemImageUrls.map(async (url, idx) => {
            try {
              const prepared = await urlToDataUrlIfMock(url);
              console.log('[createLook] prepared item image', {
                idx,
                originalPrefix: String(url).slice(0, 80),
                preparedPrefix: String(prepared).slice(0, 80),
              });
              return prepared;
            } catch (err: any) {
              console.error('[createLook] prepare item image failed', idx, url, err);
              throw new Error(`CREATE_LOOK_PREPARE_IMAGE_${idx}: ${err?.message || err}`);
            }
          })
        );

        const itemIds = selectedItems.map((i) => i.id);
        const sourceItems = selectedItems.map((i) => ({
          id: i.id,
          title: i.title,
          price: i.price || 0,
          currency: i.currency || 'RUB',
          category: i.category,
          gender: i.gender,
          images: Array.isArray(i.images) ? i.images : [],
          brand: (i as any).brand || undefined,
          storeId: i.storeId,
          storeName: (i as any).storeName || undefined,
          isCatalog: !!i.isCatalog,
          affiliateUrl: (i as any).affiliateUrl || undefined,
          productUrl: (i as any).productUrl || undefined,
        }));

        const priceBuyNowRUB = selectedItems
          .filter((i) => i.isCatalog)
          .reduce((s, i) => s + (i.price || 0), 0);

        const payload = {
          selfieDataUrl: withApiOrigin(selfieUrl),
          itemImageUrls,
          itemIds,
          sourceItems,
          aspectRatio: '3:4',
          priceBuyNowRUB,
        };

        console.log('[createLook] before fetch', {
          selfiePrefix: String(payload.selfieDataUrl).slice(0, 80),
          itemCount: payload.itemImageUrls.length,
          firstItemPrefix: payload.itemImageUrls[0] ? String(payload.itemImageUrls[0]).slice(0, 80) : null,
        });

        let resp: Response;
        try {
          resp = await fetch('/api/looks/create', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch (err: any) {
          console.error('[createLook] fetch failed before response', err);
          throw new Error(`CREATE_LOOK_FETCH: ${err?.message || err}`);
        }

        const raw = await resp.text();
        console.log('[createLook] response status', resp.status, raw.slice(0, 300));

        let data: any = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }

        if (!resp.ok) {
          if (resp.status === 401) {
            throw new Error('AUTH_REQUIRED');
          }
          throw new Error(data?.error || raw || `AI server error (${resp.status})`);
        }

        const look = data?.look;
        if (!look) throw new Error('CREATE_LOOK_RESPONSE: server did not return look');

        const newLook: Look = { ...look, createdAt: new Date(look.createdAt) };
        setLooks((prev) => [newLook, ...prev]);
        setUser((u) =>
          u
            ? {
                ...u,
                limits: {
                  ...u.limits,
                  looksRemaining: Math.max(0, u.limits.looksRemaining - 1),
                  hdTryOnRemaining: Math.max(0, u.limits.hdTryOnRemaining - 1),
                },
              }
            : null
        );
        return newLook.id;
      } catch (e: any) {
        console.error('[createLook] final error', e);
        setAiError(e?.message || 'Ошибка генерации образа');
        throw e;
      } finally {
        setAiBusy(false);
      }
    },
    setSelfie: (url: string) => {
      setUser(prev => {
        if (prev) return { ...prev, selfieUrl: url };
        return {
          id: 'u-current',
          name: 'Стильный Гость',
          username: 'guest_looker',
          phone: '+7 (000) 000-00-00',
          avatarUrl: 'https://i.pravatar.cc/150?u=guest',
          selfieUrl: url,
          sizeTop: undefined,
          sizeBottom: undefined,
          tier: SubscriptionTier.FREE,
          limits: { hdTryOnRemaining: 5, looksRemaining: 10 },
          isPublic: false,
        };
      });
    },
    likeLook: async (id: string) => {
      try {
        const resp = await fetch(`/api/looks/${encodeURIComponent(id)}/like`, { method: 'POST' , credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || 'Like failed');
        setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, likes: data.likes } : l)));
      } catch {
        // ignore
      }
    },

    reactToLook: async (id: string, reaction: 'like' | 'want_try' | 'would_buy') => {
      try {
        const resp = await fetch(`/api/looks/${encodeURIComponent(id)}/react`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reaction }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || 'Reaction failed');

        setLooks((prev) =>
          prev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  likes: data?.likes ?? l.likes,
                  wantTryCount: data?.wantTryCount ?? l.wantTryCount ?? 0,
                  wouldBuyCount: data?.wouldBuyCount ?? l.wouldBuyCount ?? 0,
                  viewerReaction: reaction,
                }
              : l
          )
        );
      } catch {
        // ignore
      }
    },

    saveLook: async (id: string) => {
      try {
        const resp = await fetch(`/api/looks/${encodeURIComponent(id)}/save`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || 'Save failed');

        setLooks((prev) =>
          prev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  saves: data?.saves ?? ((l.saves || 0) + 1),
                  viewerSaved: true,
                }
              : l
          )
        );
      } catch {
        // ignore
      }
    },
  }), [user, looks, wardrobe, homeLayout]);

  return (
      <AppContext.Provider value={{ user, products, wardrobe, looks, homeLayout, loading, aiBusy, aiError, actions }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppState = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used within AppProvider');
  return context;
};
