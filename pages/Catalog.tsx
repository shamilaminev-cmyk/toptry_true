import React, { useEffect, useMemo, useState } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { catalogImageSrc } from "../utils/catalogImageSrc";
import { useAppState } from '../store';
import { Gender } from '../types';
import { CURRENCY, ICONS } from '../constants';

type DisplayCategory =
  | 'TOPS'
  | 'BOTTOMS'
  | 'OUTERWEAR'
  | 'DRESSES'
  | 'SHOES'
  | 'BAGS'
  | 'ACCESSORIES';

const GENDER_TABS: Array<{ id: '' | Gender; label: string }> = [
  { id: '', label: 'Все' },
  { id: Gender.FEMALE, label: 'Женщинам' },
  { id: Gender.MALE, label: 'Мужчинам' },
];

const CATEGORY_TABS: Array<{ id: '' | DisplayCategory; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'TOPS', label: 'Верх' },
  { id: 'BOTTOMS', label: 'Низ' },
  { id: 'OUTERWEAR', label: 'Верхняя одежда' },
  { id: 'DRESSES', label: 'Платья' },
  { id: 'SHOES', label: 'Обувь' },
  { id: 'BAGS', label: 'Сумки' },
  { id: 'ACCESSORIES', label: 'Аксессуары' },
];

const IMG_FALLBACK = "https://i.pravatar.cc/150?u=toptry-demo";
const PAGE_SIZE = 24;

const Catalog = () => {
  const { wardrobe, actions } = useAppState();

  const [gender, setGender] = useState<'' | Gender>('');
  const [displayCategory, setDisplayCategory] = useState<'' | DisplayCategory>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const rawHash = window.location.hash || '';
    const query = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);

    const q = params.get('q') || '';
    const genderParam = (params.get('gender') || '').toUpperCase();
    const categoryParam = (params.get('displayCategory') || params.get('category') || '').toUpperCase();

    if (q) setSearch(q);

    if (genderParam && GENDER_TABS.some((x) => x.id === genderParam)) {
      setGender(genderParam as Gender);
    }

    if (categoryParam && CATEGORY_TABS.some((x) => x.id === categoryParam)) {
      setDisplayCategory(categoryParam as DisplayCategory);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [search]);

  const fetchCatalog = async (nextOffset: number, append: boolean) => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(nextOffset));

    if (gender) params.set('gender', gender);
    if (displayCategory) params.set('displayCategory', displayCategory);
    if (debouncedSearch) params.set('q', debouncedSearch);

    const url = withApiOrigin(`/api/catalog/products?${params.toString()}`);
    const resp = await fetch(url, { credentials: 'include' });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(data?.error || `Catalog fetch failed (${resp.status})`);
    }

    const products = Array.isArray(data?.products) ? data.products : [];

    setItems((prev) => (append ? [...prev, ...products] : products));
    setTotal(Number(data?.total || 0));
    setOffset(Number(data?.offset || nextOffset));
    setHasMore(Boolean(data?.hasMore));
  };

  useEffect(() => {
    let cancelled = False;

    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', '0');

        if (gender) params.set('gender', gender);
        if (displayCategory) params.set('displayCategory', displayCategory);
        if (debouncedSearch) params.set('q', debouncedSearch);

        const url = withApiOrigin(`/api/catalog/products?${params.toString()}`);
        const resp = await fetch(url, { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));

        if (cancelled) return;
        if (!resp.ok) throw new Error(data?.error || `Catalog fetch failed (${resp.status})`);

        const products = Array.isArray(data?.products) ? data.products : [];
        setItems(products);
        setTotal(Number(data?.total || 0));
        setOffset(Number(data?.offset || 0));
        setHasMore(Boolean(data?.hasMore));
      } catch (e) {
        if (!cancelled) {
          console.error('[catalog] fetch error', e);
          setItems([]);
          setTotal(0);
          setOffset(0);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [gender, displayCategory, debouncedSearch]);

  const isInWardrobe = (productId: string) => {
    return wardrobe.some(item => item.id === productId);
  };

  const clearFilters = () => {
    setGender('');
    setDisplayCategory('');
    setSearch('');
  };

  const handleLoadMore = async () => {
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    try {
      await fetchCatalog(offset + PAGE_SIZE, true);
    } catch (e) {
      console.error('[catalog] load more error', e);
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredCountLabel = useMemo(() => total, [total]);

  return (
    <div className="pb-12">
      <div className="sticky top-0 z-40 bg-white px-4 py-4 space-y-4 shadow-sm">
        <div className="relative">
          <input
            type="text"
            placeholder="Поиск по каталогу..."
            className="w-full bg-zinc-100 border-none rounded-2xl py-4 pl-12 pr-4 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {GENDER_TABS.map((tab) => {
            const active = gender === tab.id;
            return (
              <button
                key={String(tab.id || 'all')}
                onClick={() => setGender(tab.id)}
                className={`flex-shrink-0 px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                  active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-400'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {CATEGORY_TABS.map((tab) => {
            const active = displayCategory === tab.id;
            return (
              <button
                key={String(tab.id || 'all')}
                onClick={() => setDisplayCategory(tab.id)}
                className={`flex-shrink-0 px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                  active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-400'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 mt-4 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Найдено: {filteredCountLabel}
        </p>
        {(gender || displayCategory || search) && (
          <button
            onClick={clearFilters}
            className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 underline underline-offset-4"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="py-24 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Загружаем каталог...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-4 mt-6">
            {items.map((p: any) => {
              const added = isInWardrobe(p.id);
              return (
                <div key={p.id} className="group">
                  <div className="relative aspect-[3/4] rounded-[24px] overflow-hidden bg-zinc-50 p-6 border border-zinc-100 transition-all hover:shadow-xl hover:border-zinc-200">
                    <img
                      src={p?.images?.[0] ? catalogImageSrc(p.images[0]) : IMG_FALLBACK}
                      alt={p.title || ""}
                      onError={(e) => {
                        const el = e.currentTarget as HTMLImageElement;
                        el.src = IMG_FALLBACK;
                      }}
                      className="w-full h-full object-contain mix-blend-multiply group-hover:scale-110 transition-all duration-700"
                    />

                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        actions.addToWardrobe(p);
                      }}
                      className={`absolute bottom-4 right-4 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                        added ? 'bg-zinc-900 text-white scale-110' : 'bg-white/90 backdrop-blur text-zinc-900 hover:bg-zinc-900 hover:text-white'
                      }`}
                    >
                      {added ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                        </svg>
                      ) : (
                        <ICONS.Plus className="w-5 h-5" />
                      )}
                    </button>

                    {added && (
                      <div className="absolute top-4 right-4 bg-zinc-900/10 backdrop-blur-sm px-2 py-1 rounded-lg">
                        <span className="text-[8px] font-black uppercase tracking-tighter text-zinc-900">В шкафу</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 px-1 space-y-1.5">
                    <div className="flex justify-between items-start">
                      <h3 className="text-[11px] font-bold uppercase tracking-tight truncate flex-1 text-zinc-700">
                        {p.title}
                      </h3>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-black">{p.price} {CURRENCY}</p>
                      <span className="text-[8px] font-bold uppercase text-zinc-400 px-2 py-1 bg-zinc-50 rounded-md border border-zinc-100">
                        {(p.storeName || p.brand || "Store")}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const url = p.affiliateUrl || p.productUrl;
                        if (url) window.open(url, "_blank", "noopener,noreferrer");
                      }}
                      className="w-full mt-3 py-2.5 bg-white border border-zinc-900 rounded-full text-[9px] font-black uppercase tracking-[0.15em] hover:bg-zinc-900 hover:text-white transition-all active:scale-95 shadow-sm"
                    >
                      Купить сейчас
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {items.length === 0 && !loading && (
            <div className="py-24 text-center space-y-4">
              <div className="w-16 h-16 bg-zinc-50 rounded-full mx-auto flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Ничего не найдено</p>
              <button
                onClick={clearFilters}
                className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 underline underline-offset-4"
              >
                Сбросить фильтры
              </button>
            </div>
          )}

          {hasMore && items.length > 0 && (
            <div className="px-4 mt-8">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full py-3 rounded-full border border-zinc-900 text-[10px] font-black uppercase tracking-[0.18em] bg-white hover:bg-zinc-900 hover:text-white transition-all disabled:opacity-60"
              >
                {loadingMore ? 'Загружаем...' : 'Показать ещё'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Catalog;
