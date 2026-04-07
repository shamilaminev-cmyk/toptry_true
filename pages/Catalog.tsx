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
const CATALOG_FILTERS_STORAGE_KEY = 'toptry.catalog.filters.v1';

const Catalog = () => {
  const { wardrobe, actions } = useAppState();

  const [gender, setGender] = useState<'' | Gender>('');
  const [draftGender, setDraftGender] = useState<'' | Gender>('');
  const [displayCategory, setDisplayCategory] = useState<'' | DisplayCategory>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [discountOnly, setDiscountOnly] = useState(false);
  const [brand, setBrand] = useState('');
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [sort, setSort] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftDisplayCategory, setDraftDisplayCategory] = useState<'' | DisplayCategory>('');
  const [draftDiscountOnly, setDraftDiscountOnly] = useState(false);
  const [draftBrand, setDraftBrand] = useState('');
  const [draftPriceMin, setDraftPriceMin] = useState('');
  const [draftPriceMax, setDraftPriceMax] = useState('');

  const [draftTotal, setDraftTotal] = useState<number | null>(null)
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const rawHash = window.location.hash || '';
    const query = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : '';
    const hashParams = new URLSearchParams(query);
    const hasHashFilters = Array.from(hashParams.keys()).length > 0;

    let saved: null | {
      q?: string;
      gender?: string;
      displayCategory?: string;
      discountOnly?: boolean;
      brand?: string;
      priceMin?: string;
      priceMax?: string;
      sort?: string;
    } = null;

    if (!hasHashFilters) {
      try {
        const raw = window.sessionStorage.getItem(CATALOG_FILTERS_STORAGE_KEY);
        saved = raw ? JSON.parse(raw) : null;
      } catch {
        saved = null;
      }
    }

    const q = hasHashFilters ? (hashParams.get('q') || '') : (saved?.q || '');
    const genderParam = String(
      hasHashFilters ? (hashParams.get('gender') || '') : (saved?.gender || '')
    ).toUpperCase();
    const categoryParam = String(
      hasHashFilters
        ? (hashParams.get('displayCategory') || hashParams.get('category') || '')
        : (saved?.displayCategory || '')
    ).toUpperCase();
    const discountOnlyParam = hasHashFilters
      ? hashParams.get('discountOnly') === '1'
      : Boolean(saved?.discountOnly);
    const brandParam = hasHashFilters ? (hashParams.get('brand') || '') : (saved?.brand || '');
    const priceMinParam = hasHashFilters ? (hashParams.get('priceMin') || '') : (saved?.priceMin || '');
    const priceMaxParam = hasHashFilters ? (hashParams.get('priceMax') || '') : (saved?.priceMax || '');
    const sortParam = hasHashFilters ? (hashParams.get('sort') || '') : (saved?.sort || '');

    setSearch(q);
    setDebouncedSearch(q);

    setDiscountOnly(discountOnlyParam);
    setDraftDiscountOnly(discountOnlyParam);

    setBrand(brandParam);
    setDraftBrand(brandParam);

    setPriceMin(priceMinParam);
    setDraftPriceMin(priceMinParam);

    setPriceMax(priceMaxParam);
    setDraftPriceMax(priceMaxParam);

    setSort(sortParam);

    if (genderParam && GENDER_TABS.some((x) => x.id === genderParam)) {
      setGender(genderParam as Gender);
      setDraftGender(genderParam as Gender);
    } else {
      setGender('');
      setDraftGender('');
    }

    if (categoryParam && CATEGORY_TABS.some((x) => x.id === categoryParam)) {
      setDisplayCategory(categoryParam as DisplayCategory);
      setDraftDisplayCategory(categoryParam as DisplayCategory);
    } else {
      setDisplayCategory('');
      setDraftDisplayCategory('');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!filtersOpen) return;
    setDraftGender(gender);
    setDraftDisplayCategory(displayCategory);
    setDraftDiscountOnly(discountOnly);
    setDraftBrand(brand);
    setDraftPriceMin(priceMin);
    setDraftPriceMax(priceMax);
  }, [filtersOpen, gender, displayCategory, discountOnly, brand, priceMin, priceMax]);

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
        if (draftBrand && !nextBrands.includes(draftBrand)) {
          setDraftBrand('');
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
    try {
      const payload = {
        q: debouncedSearch,
        gender,
        displayCategory,
        discountOnly,
        brand,
        priceMin,
        priceMax,
        sort,
      };
      window.sessionStorage.setItem(CATALOG_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [debouncedSearch, gender, displayCategory, discountOnly, brand, priceMin, priceMax, sort]);

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

  const isInWardrobe = (product: any) => {
    return wardrobe.some((item: any) => {
      if (!(item?.isCatalog || item?.sourceType === "catalog")) return false;

      if (product?.affiliateUrl && item?.affiliateUrl && item.affiliateUrl === product.affiliateUrl) return true;
      if (product?.productUrl && item?.productUrl && item.productUrl === product.productUrl) return true;
      if (product?.images?.[0] && item?.images?.[0] && item.images[0] === product.images[0]) return true;

      return (
        String(item?.title || "").trim().toLowerCase() === String(product?.title || "").trim().toLowerCase() &&
        String(item?.category || "").trim().toUpperCase() === String(product?.category || "").trim().toUpperCase() &&
        String(item?.gender || "").trim().toUpperCase() === String(product?.gender || "").trim().toUpperCase()
      );
    });
  };

  const clearFilters = () => {
    setGender('');
    setDraftGender('');
    setDisplayCategory('');
    setDraftDisplayCategory('');
    setSearch('');
    setDebouncedSearch('');
    setDiscountOnly(false);
    setBrand('');
    setPriceMin('');
    setPriceMax('');
    setSort('');
    setDraftDiscountOnly(false);
    setDraftBrand('');
    setDraftPriceMin('');
    setDraftPriceMax('');
    try {
      window.sessionStorage.removeItem(CATALOG_FILTERS_STORAGE_KEY);
    } catch {}
    window.history.replaceState(null, '', '#/catalog');
  };

  const clearDraftFilters = () => {
    setDraftGender('');
    setDraftDisplayCategory('');
    setDraftDiscountOnly(false);
    setDraftBrand('');
    setDraftPriceMin('');
    setDraftPriceMax('');
  };

  

  useEffect(() => {
    if (!filtersOpen) return

    const controller = new AbortController()

    const run = async () => {
      try {
        const params = new URLSearchParams()

        if (draftGender) params.set('gender', draftGender)
        if (draftDisplayCategory) params.set('category', draftDisplayCategory)
        if (draftBrand) params.set('brand', draftBrand)
        if (draftDiscountOnly) params.set('discount', '1')
        if (draftPriceMin) params.set('priceMin', draftPriceMin)
        if (draftPriceMax) params.set('priceMax', draftPriceMax)

        params.set('limit', '1') // только ради total

        const res = await fetch(`/api/catalog/products?${params.toString()}`, {
          signal: controller.signal
        })

        const json = await res.json()

        if (!controller.signal.aborted) {
          setDraftTotal(json.total ?? 0)
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setDraftTotal(null)
        }
      }
    }

    const t = setTimeout(run, 300)

    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [
    filtersOpen,
    draftGender,
    draftDisplayCategory,
    draftBrand,
    draftDiscountOnly,
    draftPriceMin,
    draftPriceMax
  ])


  const applyDrawerFilters = () => {
    setGender(draftGender);
    setDisplayCategory(draftDisplayCategory);
    setDiscountOnly(draftDiscountOnly);
    setBrand(draftBrand);
    setPriceMin(draftPriceMin);
    setPriceMax(draftPriceMax);
    setFiltersOpen(false);
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
  const activeFiltersCount = useMemo(
    () =>
      [gender, displayCategory, debouncedSearch, discountOnly ? '1' : '', brand, priceMin, priceMax, sort].filter(Boolean).length,
    [gender, displayCategory, debouncedSearch, discountOnly, brand, priceMin, priceMax, sort]
  );
  const draftActiveFiltersCount = useMemo(
    () =>
      [draftGender, draftDisplayCategory, debouncedSearch, draftDiscountOnly ? '1' : '', draftBrand, draftPriceMin, draftPriceMax].filter(Boolean).length,
    [draftGender, draftDisplayCategory, debouncedSearch, draftDiscountOnly, draftBrand, draftPriceMin, draftPriceMax]
  );
  const applyButtonLabel = useMemo(() => {
    if (loading) return 'Загружаем...';
    const mod10 = filteredCountLabel % 10;
    const mod100 = filteredCountLabel % 100;
    const noun =
      mod10 === 1 && mod100 !== 11
        ? 'товар'
        : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)
          ? 'товара'
          : 'товаров';
    return `Показать ${filteredCountLabel} ${noun}`;
  }, [filteredCountLabel, loading]);

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


        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setDraftGender(gender);
              setDraftDiscountOnly(discountOnly);
              setDraftBrand(brand);
              setDraftPriceMin(priceMin);
              setDraftPriceMax(priceMax);
              setFiltersOpen(true);
            }}
            className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 flex items-center justify-between"
          >
            <span>Фильтры{activeFiltersCount ? ` (${activeFiltersCount})` : ''}</span>
            <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-12 min-w-[150px] px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900"
          >
            <option value="">Сортировка</option>
            <option value="price_asc">Цена ↑</option>
            <option value="price_desc">Цена ↓</option>
            <option value="discount_desc">Скидка ↓</option>
          </select>
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

      {filtersOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end"
          onClick={() => setFiltersOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-[28px] p-5 space-y-4 animate-slide-up max-h-[calc(85vh-64px)] overflow-y-auto pb-[88px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1.5 rounded-full bg-zinc-200 mx-auto" />

            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-900">
                Фильтры{draftActiveFiltersCount ? ` (${draftActiveFiltersCount})` : ''}
              </p>
              <button
                onClick={() => setFiltersOpen(false)}
                className="w-10 h-10 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-700"
                aria-label="Закрыть фильтры"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
              {GENDER_TABS.map((tab) => {
                const active = draftGender === tab.id;
                return (
                  <button
                    key={String(tab.id || 'all')}
                    onClick={() => setDraftGender(tab.id)}
                    className={`flex-shrink-0 h-11 px-5 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                      active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
              {CATEGORY_TABS.map((tab) => {
                const active = draftDisplayCategory === tab.id;
                return (
                  <button
                    key={String(tab.id || 'all')}
                    onClick={() => setDraftDisplayCategory(tab.id)}
                    className={`flex-shrink-0 h-11 px-5 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                      active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <select
              value={draftBrand}
              onChange={(e) => setDraftBrand(e.target.value)}
              className="w-full h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900"
            >
              <option value="">Бренд</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <input
                inputMode="numeric"
                placeholder="Цена от"
                value={draftPriceMin}
                onChange={(e) => setDraftPriceMin(e.target.value)}
                className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 placeholder:normal-case placeholder:tracking-normal placeholder:font-medium placeholder:text-zinc-400"
              />

              <input
                inputMode="numeric"
                placeholder="Цена до"
                value={draftPriceMax}
                onChange={(e) => setDraftPriceMax(e.target.value)}
                className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 placeholder:normal-case placeholder:tracking-normal placeholder:font-medium placeholder:text-zinc-400"
              />
            </div>

            <button
              onClick={() => setDraftDiscountOnly((v) => !v)}
              className={`w-full h-12 inline-flex items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                draftDiscountOnly ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
              }`}
            >
              Со скидкой
            </button>

            <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-white border-t border-zinc-100 grid grid-cols-2 gap-2">
              <button
                onClick={clearDraftFilters}
                className="h-12 rounded-full border border-zinc-300 text-[10px] font-bold uppercase tracking-widest bg-white text-zinc-600"
              >
                Сбросить
              </button>

              <button
                onClick={applyDrawerFilters}
                className="h-12 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-widest shadow-md disabled:opacity-60"
              >
                {draftTotal !== null ? `Показать ${draftTotal} товаров` : applyButtonLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="py-24 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Загружаем каталог...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 px-4 mt-6">
            {items.map((p: any) => {
              const added = isInWardrobe(p);
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
                        if (added) return;
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
