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

    if (q) setSearch(q);
    if (discountOnlyParam) setDiscountOnly(true);

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
  }, [gender, displayCategory, debouncedSearch, discountOnly]);

  const isInWardrobe = (productId: string) => {
    return wardrobe.some(item => item.id === productId);
  };

  const clearFilters = () => {
    setGender('');
    setDisplayCategory('');
    setSearch('');
    setDiscountOnly(false);
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

        <div className="flex gap-2 flex-wrap">
          <input
            placeholder="Бренд"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="px-3 py-2 border rounded-lg text-xs"
          />

          <input
            placeholder="Цена от"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            className="px-3 py-2 border rounded-lg text-xs w-24"
          />

          <input
            placeholder="Цена до"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="px-3 py-2 border rounded-lg text-xs w-24"
          />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-3 py-2 border rounded-lg text-xs"
          >
            <option value="">Сортировка</option>
            <option value="price_asc">Цена ↑</option>
            <option value="price_desc">Цена ↓</option>
            <option value="discount_desc">Скидка ↓</option>
          </select>
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
          <input
            