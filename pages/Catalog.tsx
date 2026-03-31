import React, { useEffect, useMemo, useState } from 'react';
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

const GENDER_TABS: Array<{ id: '' | Gender; label: string }> = [
  { id: '', label: 'Все' },
  { id: Gender.FEMALE, label: 'Женщинам' },
  { id: Gender.MALE, label: 'Мужчинам' },
];

const IMG_FALLBACK = "https://i.pravatar.cc/150?u=toptry-demo";

const Catalog = () => {
  const { products, wardrobe, actions } = useAppState();

  const [gender, setGender] = useState<'' | Gender>('');
  const [displayCategory, setDisplayCategory] = useState<'' | DisplayCategory>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const rawHash = window.location.hash || '';
    const query = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);

    const q = params.get('q') || '';
    const category = (params.get('category') || '').toUpperCase();
    const genderParam = (params.get('gender') || '').toUpperCase();

    if (q) setSearch(q);

    if (category && CATEGORY_TABS.some((x) => x.id === category)) {
      setDisplayCategory(category as DisplayCategory);
    }

    if (genderParam && GENDER_TABS.some((x) => x.id === genderParam)) {
      setGender(genderParam as Gender);
    }
  }, []);

  const baseProducts = Array.isArray(products) ? products : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return baseProducts.filter((p: any) => {
      const pGender = String(p?.gender || '').toUpperCase();
      const pDisplayCategory = String(p?.displayCategory || '').toUpperCase();

      if (gender) {
        if (gender === Gender.MALE && !(pGender === 'MALE' || pGender === 'UNISEX')) return false;
        if (gender === Gender.FEMALE && !(pGender === 'FEMALE' || pGender === 'UNISEX')) return false;
      }

      if (displayCategory && pDisplayCategory !== displayCategory) return false;

      if (q) {
        const hay = [
          p?.title,
          p?.brand,
          p?.storeName,
          p?.category,
          p?.displayCategory,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [baseProducts, gender, displayCategory, search]);

  const isInWardrobe = (productId: string) => {
    return wardrobe.some((item) => item.id === productId);
  };

  const clearFilters = () => {
    setGender('');
    setDisplayCategory('');
    setSearch('');
  };

  return (
    <div className="pb-12">
      <div className="sticky top-0 z-40 bg-white shadow-sm">
        <div className="px-4 pt-4 pb-3 space-y-4">
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
                  className={`flex-shrink-0 px-5 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] border transition-all ${
                    active
                      ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                      : 'bg-white border-zinc-200 text-zinc-500'
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
                  className={`flex-shrink-0 px-5 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] border transition-all ${
                    active
                      ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                      : 'bg-white border-zinc-200 text-zinc-500'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
          Найдено: {filtered.length}
        </p>

        {(gender || displayCategory || search) && (
          <button
            onClick={clearFilters}
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-900 underline underline-offset-4"
          >
            Сбросить
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-4 mt-6">
        {filtered.map((p: any) => {
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
                    added
                      ? 'bg-zinc-900 text-white scale-110'
                      : 'bg-white/90 backdrop-blur text-zinc-900 hover:bg-zinc-900 hover:text-white'
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
                    <span className="text-[8px] font-black uppercase tracking-tighter text-zinc-900">
                      В шкафу
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 px-1 space-y-1.5">
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-tight leading-4 text-zinc-700 line-clamp-2">
                    {p.title}
                  </h3>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black whitespace-nowrap">
                    {p.price} {CURRENCY}
                  </p>
                  <span className="text-[8px] font-bold uppercase text-zinc-400 px-2 py-1 bg-zinc-50 rounded-md border border-zinc-100 truncate">
                    {p.storeName || p.brand || p.storeId || "Store"}
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

      {filtered.length === 0 && (
        <div className="py-24 text-center space-y-4">
          <div className="w-16 h-16 bg-zinc-50 rounded-full mx-auto flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            Ничего не найдено
          </p>
          <button
            onClick={clearFilters}
            className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 underline underline-offset-4"
          >
            Сбросить фильтры
          </button>
        </div>
      )}
    </div>
  );
};

export default Catalog;
