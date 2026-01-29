
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User, Product, Look, WardrobeItem, Gender, Category, SubscriptionTier, HomeLayout } from './types';

interface AppState {
  user: User | null;
  products: Product[];
  wardrobe: WardrobeItem[];
  looks: Look[];
  homeLayout: HomeLayout;
  loading: boolean;
  meLoaded: boolean; 
  meLoading: boolean;
  aiBusy: boolean;
  aiError: string | null;
  actions: {
    login: (emailOrUsername: string, password: string) => Promise<void>;
    register: (email: string, username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    toggleHomeLayout: () => void;
    addToWardrobe: (product: Product) => void;
    addMultipleToWardrobe: (products: Product[]) => void;
    upsertWardrobeItem: (item: WardrobeItem) => void;
    removeFromWardrobe: (id: string) => void;
    createLook: (items: WardrobeItem[]) => Promise<string | undefined>;
    setSelfie: (url: string) => void;
    likeLook: (id: string) => void;
  };
}

const AppContext = createContext<AppState | undefined>(undefined);

// Using picsum.photos for better CORS support when fetching images for AI processing
const getProductImage = (i: number, category: Category) => {
  return `https://picsum.photos/seed/product-${i}-${category}/400/600`;
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
  resultImageUrl: `https://picsum.photos/seed/look-${i}/600/800`,
  isPublic: true,
  likes: Math.floor(Math.random() * 50),
  comments: Math.floor(Math.random() * 10),
  createdAt: new Date(),
  authorName: ['alex_fit', 'marina_style', 'ksenia_vogue'][i % 3],
  authorAvatar: `https://i.pravatar.cc/150?u=${i % 3}`,
}));

const STORAGE_KEY = 'toptry_state_v1';
const ENABLE_DB_SYNC = (import.meta?.env?.VITE_ENABLE_DB_SYNC || '').toString() === '1';

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
async function apiFetch(input: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await apiFetch(input, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(init.headers || {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

    // централизованный 401
    if (resp.status === 401) {
      // ничего не кидаем наружу как "stacktrace"
      throw new Error('AUTH_REQUIRED');
    }

    return resp;
  } finally {
    clearTimeout(t);
  }
}


export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [looks, setLooks] = useState<Look[]>(MOCK_LOOKS);
  const [homeLayout, setHomeLayout] = useState<HomeLayout>(HomeLayout.DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [meLoaded, setMeLoaded] = useState(false); 
  const [meLoading, setMeLoading] = useState(false);
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
      setLooks(restoredLooks.length ? restoredLooks : MOCK_LOOKS);

      setHomeLayout(saved.homeLayout || HomeLayout.DASHBOARD);
    }

    // Simulate small loading skeleton
    const t = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(t);
  }, []);

// Restore server session (JWT in httpOnly cookie)
useEffect(() => {
  (async () => {
    setMeLoading(true);
    try {
      const resp = await fetch('/api/auth/me');
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
          tier: prev?.tier || SubscriptionTier.FREE,
          limits: prev?.limits || { hdTryOnRemaining: 5, looksRemaining: 10 },
          isPublic: !!u.isPublic,
        };
      });
    } catch {
      // ignore
    } finally {
      setMeLoaded(true);
      setMeLoading(false);
    }
  })();
}, []);

  // Optional: sync wardrobe from server DB (if enabled)
  useEffect(() => {
    if (!ENABLE_DB_SYNC) return;
    if (!user?.id) return;
    (async () => {
      try {
        const resp = await apiFetch(`/api/wardrobe/list`);
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) return;
        setWardrobe((prev) => {
          const byId = new Map(prev.map((i) => [i.id, i]));
          for (const raw of items) {
            byId.set(raw.id, {
              ...raw,
              addedAt: raw?.addedAt ? new Date(raw.addedAt) : new Date(),
            });
          }
          return Array.from(byId.values()).sort((a, b) =>
            new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
          );
        });
      } catch {
        // ignore
      }
    })();
  }, [user?.id]);

  // Optional: sync my looks from server
  useEffect(() => {
    if (!ENABLE_DB_SYNC) return;
    if (!user?.id) return;
    (async () => {
      try {
        const resp = await apiFetch('/api/looks/my');
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        const serverLooks = Array.isArray(data?.looks) ? data.looks : [];
        if (!serverLooks.length) return;
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
        const compactLooks = looksForStorage.map((l) => ({ ...l, resultImageUrl: '' }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, looks: compactLooks }));
      } catch {
        // ignore
      }
    }
  }, [user, wardrobe, looks, homeLayout]);

  const actions = useMemo(() => ({
    login: async (emailOrUsername: string, password: string) => {
      const resp = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ emailOrUsername, password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Login failed');
      const u = data.user;
      setUser((prev) => ({
        id: u.id,
        email: u.email,
        name: prev?.name || u.username,
        username: u.username,
        phone: prev?.phone || '',
        avatarUrl: u.avatarUrl || prev?.avatarUrl,
        selfieUrl: prev?.selfieUrl,
        tier: prev?.tier || SubscriptionTier.FREE,
        limits: prev?.limits || { hdTryOnRemaining: 5, looksRemaining: 10 },
        isPublic: u.isPublic ?? true,
      }));
    },
    register: async (email: string, username: string, password: string) => {
      const resp = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, username, password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Registration failed');
      const u = data.user;
      setUser((prev) => ({
        id: u.id,
        email: u.email,
        name: prev?.name || u.username,
        username: u.username,
        phone: prev?.phone || '',
        avatarUrl: u.avatarUrl || prev?.avatarUrl,
        selfieUrl: prev?.selfieUrl,
        tier: prev?.tier || SubscriptionTier.FREE,
        limits: prev?.limits || { hdTryOnRemaining: 5, looksRemaining: 10 },
        isPublic: u.isPublic ?? true,
      }));
    },
    logout: async () => {
      await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
      setUser(null);
    },
    toggleHomeLayout: () => setHomeLayout(prev => 
      prev === HomeLayout.DASHBOARD ? HomeLayout.FEED : HomeLayout.DASHBOARD
    ),
    addToWardrobe: (product: Product) => {
      const userId = user?.id || 'demo-user-id';
      setWardrobe(prev => {
        if (prev.some(item => item.id === product.id)) return prev;
        const newItem: WardrobeItem = {
          ...product,
          userId: userId,
          addedAt: new Date(),
          isCatalog: true,
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
      }));
      setWardrobe(prev => [...newItems, ...prev]);
    },
    upsertWardrobeItem: (item: WardrobeItem) => {
      setWardrobe((prev) => {
        const next = prev.filter((p) => p.id !== item.id);
        return [{ ...item, addedAt: (item as any)?.addedAt ? new Date((item as any).addedAt) : new Date() }, ...next];
      });
    },
    removeFromWardrobe: (id: string) => {
      setWardrobe(prev => prev.filter(i => i.id !== id));
    },
    createLook: async (selectedItems: WardrobeItem[]) => {
      if (!user || !user.selfieUrl) return;
      if (!selectedItems?.length) return;

      setAiError(null);
      setAiBusy(true);
      try {
        const itemImageUrls = selectedItems.map((i) => i.images?.[0]).filter(Boolean);
        const itemIds = selectedItems.map((i) => i.id);
        const priceBuyNowRUB = selectedItems.filter((i) => i.isCatalog).reduce((s, i) => s + (i.price || 0), 0);
        const resp = await apiFetch('/api/looks/create', {
        method: 'POST',
        body: JSON.stringify({
        selfieDataUrl: user.selfieUrl,
        itemImageUrls,
        itemIds,
        aspectRatio: '3:4',
        priceBuyNowRUB,
        }),
       }, 35000);

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || `AI server error (${resp.status})`);
        const look = data?.look;
        if (!look) throw new Error('Server did not return look');
        const newLook: Look = { ...look, createdAt: new Date(look.createdAt) };
        setLooks((prev) => [newLook, ...prev]);
        setUser((u) => (u ? { ...u, limits: { ...u.limits, looksRemaining: Math.max(0, u.limits.looksRemaining - 1), hdTryOnRemaining: Math.max(0, u.limits.hdTryOnRemaining - 1) } } : null));
        return newLook.id;
      } catch (e: any) {
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
          tier: SubscriptionTier.FREE,
          limits: { hdTryOnRemaining: 5, looksRemaining: 10 },
          isPublic: false,
        };
      });
    },
    likeLook: async (id: string) => {
      try {
        const resp = await apiFetch(`/api/looks/${encodeURIComponent(id)}/like`, { method: 'POST' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || 'Like failed');
        setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, likes: data.likes } : l)));
      } catch {
        // ignore
      }
    },
  }), [user, looks, wardrobe, homeLayout]);

return (
  <AppContext.Provider
    value={{
      user,
      products: MOCK_PRODUCTS,
      wardrobe,
      looks,
      homeLayout,
      loading,
      meLoaded,
      meLoading,
      aiBusy,
      aiError,
      actions,
    }}
  >
    {children}
  </AppContext.Provider>
);

};

export const useAppState = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used within AppProvider');
  return context;
};
