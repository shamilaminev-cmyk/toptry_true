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
  const [discountOnly, setDiscountOnly] = useState(false);
  const [brand, setBrand] = useState('');
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [sort, setSort] = useState('');

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
    const discountOnlyParam = params.get('discountOnly') === '1';
    const brandParam = params.get('brand') || '';
    const priceMinParam = params.get('priceMin') || '';
    const priceMaxParam = params.get('priceMax') || '';
    const sortParam = params.get('sort') || '';

    if (q) setSearch(q);
    if (discountOnlyParam) setDiscountOnly(true);
    if (brandParam) setBrand(brandParam);
    if (priceMinParam) setPriceMin(priceMinParam);
    if (priceMaxParam) setPriceMax(priceMaxParam);
    if (sortParam) setSort(sortParam);

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

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const params = new URLSearchParams();
        if (gender) params.set('gender', gender);
        if (displayCategory) params.set('displayCategory', displayCategory);
        if (debouncedSearch) params.set('q', debouncedSearch);
        if (discountOnly) params.set('discountOnly', '1');

        const url = withApiOrigin(`/api/catalog/brands?${params.toString()}`);
        const resp = await fetch(url, { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));

        if (cancelled) return;
        if (!resp.ok) throw new Error(data?.error || `Catalog brands fetch failed (${resp.status})`);

        const nextBrands = Array.isArray(data?.brands) ? data.brands : [];
        setBrandOptions(nextBrands);

        if (brand && !nextBrands.includes(brand)) {
          setBrand('');
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[catalog] brands fetch error', e);
          setBrandOptions([]);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [gender, displayCategory, debouncedSearch, discountOnly, brand]);

  const fetchCatalog = async (nextOffset: number, append: boolean) => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(nextOffset));

    if (gender) params.set('gender', gender);
    if (displayCategory) params.set('displayCategory', displayCategory);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (discountOnly) params.set('discountOnly', '1');
    if (brand) params.set('brand', brand);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (sort) params.set('sort', sort);

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
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', '0');

        if (gender) params.set('gender', gender);
        if (displayCategory) params.set('displayCategory', displayCategory);
        if (debouncedSearch) params.set('q', debouncedSearch);
        if (discountOnly) params.set('discountOnly', '1');
    if (brand) params.set('brand', brand);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (sort) params.set('sort', sort);

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
  }, [gender, displayCategory, debouncedSearch, discountOnly, brand, priceMin, priceMax, sort]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (debouncedSearch) params.set('q', debouncedSearch);
    if (gender) params.set('gender', gender);
    if (displayCategory) params.set('displayCategory', displayCategory);
    if (discountOnly) params.set('discountOnly', '1');
    if (brand) params.set('brand', brand);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (sort) params.set('sort', sort);

    const base = (window.location.hash || '#/catalog').split('?')[0] || '#/catalog';
    const qs = params.toString();
    const nextHash = qs ? `${base}?${qs}` : base;

    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [
    debouncedSearch,
    gender,
    displayCategory,
    discountOnly,
    brand,
    priceMin,
    priceMax,
    sort,
  ]);

  const isInWardrobe = (productId: string) => {
    return wardrobe.some(item => item.id === productId);
  };

  const clearFilters = () => {
    setGender('');
    setDisplayCategory('');
    setSearch('');
    setDiscountOnly(false);
    setBrand('');
    setPriceMin('');
    setPriceMax('');
    setSort('');
    window.history.replaceState(null, '', '#/catalog');
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

        <div className="flex gap-2 flex-wrap">
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 min-w-[128px]"
          >
            <option value="">Бренд</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <input
            placeholder="Цена от"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 w-[150px] placeholder:normal-case placeholder:tracking-normal placeholder:font-medium placeholder:text-zinc-400"
          />

          <input
            placeholder="Цена до"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="h-10 px-4 rounded-full bg-zinc-100 text-xs uppercase tracking-wide border-none focus:ring-2 focus:ring-zinc-900 outline-none w-28"
          />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 min-w-[180px]"
          >
            <option value="">Сортировка</option>
            <option value="price_asc">Цена ↑</option>
            <option value="price_desc">Цена ↓</option>
            <option value="discount_desc">Скидка ↓</option>
          </select>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setDiscountOnly((v) => !v)}
            className={`flex-shrink-0 px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
              discountOnly ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-400'
            }`}
          >
            Со скидкой
          </button>
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
        {(gender || displayCategory || search || discountOnly || brand || priceMin || priceMax || sort) && (
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 px-4 mt-6">
            {items.map((p: any) => {
              const added = isInWardrobe(p.id);
              return (
                <div key={p.id} className="group">
                  <div className="relative aspect-[3/4] rounded-[24px] overflow-hidden bg-zinc-50 p-6 border border-zinc-100 transition-all hover:shadow-xl hover:border-zinc-200">
                    {!!p.discountPercent && p.discountPercent > 0 && (
                      <div className="absolute top-4 left-4 z-10 bg-zinc-900 text-white px-2.5 py-1.5 rounded-full shadow-md">
                        <span className="text-[9px] font-black uppercase tracking-[0.12em]">
                          -{p.discountPercent}%
                        </span>
                      </div>
                    )}

                    <img
                      src={p?.images?.[0] ? catalogImageSrc(p.images[0], { w: 420 }) : IMG_FALLBACK}
                      alt={p.title || ""}
                      loading="lazy"
                      decoding="async"
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
                    <div className="flex justify-between items-center gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black">{p.price} {CURRENCY}</p>
                        {!!p.oldPrice && p.oldPrice > p.price && (
                          <p className="text-[10px] font-bold text-zinc-400 line-through">
                            {p.oldPrice} {CURRENCY}
                          </p>
                        )}
                      </div>
                      <span className="text-[8px] font-bold uppercase text-zinc-400 px-2 py-1 bg-zinc-50 rounded-md border border-zinc-100 shrink-0">
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
