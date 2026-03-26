
import React, { useEffect, useState } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { catalogImageSrc } from "../utils/catalogImageSrc";
import { useAppState } from '../store';
import { Category, Gender } from '../types';
import { CURRENCY, ICONS } from '../constants';

const Catalog = () => {
  const { products, wardrobe, actions } = useAppState();
  const [filter, setFilter] = useState<{ gender?: Gender; category?: Category }>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    const rawHash = window.location.hash || '';
    const query = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);

    const q = params.get('q') || '';
    const category = params.get('category') || '';

    if (q) setSearch(q);

    if (category) {
      setFilter((prev) => ({
        ...prev,
        category: category as Category
      }));
    }
  }, []);


  const IMG_FALLBACK = "https://i.pravatar.cc/150?u=toptry-demo";

  const mockProducts: any[] = [
    { id: "mock-001", title: "Блейзер прямого кроя", price: 12990, gender: Gender.FEMALE, category: Category.JACKETS, images: ["https://picsum.photos/seed/home-blazer/400/600"], storeName: "ZARA" },
    { id: "mock-002", title: "Пальто шерстяное", price: 24990, gender: Gender.FEMALE, category: Category.JACKETS, images: ["https://picsum.photos/seed/home-coat/400/600"], storeName: "MASSIMO DUTTI" },
    { id: "mock-003", title: "Куртка бомбер", price: 15990, gender: Gender.MALE, category: Category.JACKETS, images: ["https://picsum.photos/seed/home-bomber/400/600"], storeName: "H&M" },
    { id: "mock-004", title: "Джинсы straight", price: 7990, gender: Gender.MALE, category: Category.PANTS, images: ["https://picsum.photos/seed/home-jeans/400/600"], storeName: "UNIQLO" },
    { id: "mock-005", title: "Брюки классические", price: 9990, gender: Gender.UNISEX, category: Category.PANTS, images: ["https://picsum.photos/seed/home-trousers/400/600"], storeName: "COS" },
    { id: "mock-006", title: "Платье миди", price: 11990, gender: Gender.FEMALE, category: Category.DRESS, images: ["https://picsum.photos/seed/home-dress/400/600"], storeName: "MANGO" },
  ];

  const USE_MOCK_CATALOG = false;
  const baseProducts = USE_MOCK_CATALOG
    ? mockProducts
    : (products && products.length ? products : mockProducts);
  if (typeof window !== "undefined") {
    console.log("[catalog] products.len=", products?.length, "base.len=", (baseProducts as any[])?.length);
    console.log("[catalog] first.image=", (baseProducts as any[])[0]?.images?.[0]);
  }


  const getHaystack = (p: any) =>
    [p?.title, p?.category, p?.brand, p?.storeName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  const matchesGenderFilter = (p: any, activeGender?: Gender) => {
    if (!activeGender) return true;

    const hay = getHaystack(p);
    const selected = String(activeGender || '').toLowerCase();
    const productGender = String(p?.gender || '').toLowerCase();
    const full = `${productGender} ${hay}`;

    const wantsMale = /male|man|men|муж/.test(selected);
    const wantsFemale = /female|woman|women|жен/.test(selected);

    if (wantsMale) {
      if (/жен|female|woman|women/.test(full)) return false;
      if (/муж|male|man|men/.test(full)) return true;
      return productGender === 'unisex';
    }

    if (wantsFemale) {
      if (/муж|male|man|men/.test(full)) return false;
      if (/жен|female|woman|women/.test(full)) return true;
      return productGender === 'unisex';
    }

    return productGender === selected;
  };

  const matchesCategoryFilter = (p: any, activeCategory?: Category) => {
    if (!activeCategory) return true;

    const hay = getHaystack(p);
    const selected = String(activeCategory || '').toLowerCase();
    const productCategory = String(p?.category || '').toLowerCase();

    if (productCategory === selected) return true;

    const categoryMatchers: Array<[RegExp, RegExp]> = [
      [/(jacket|outer|верх|coat|куртк|пальто|бомбер|парка|ветров|пухов|blazer)/, /(jacket|outer|верх|coat|куртк|пальто|бомбер|парка|ветров|пухов|blazer)/],
      [/(pants|bottom|низ|брюк|брюки|джинс|trouser|shorts|юбк|skirt|legging)/, /(pants|bottom|низ|брюк|брюки|джинс|trouser|shorts|юбк|skirt|legging)/],
      [/(dress|плать)/, /(dress|плать)/],
      [/(shoes|обув|кроссов|кед|ботин|туфл|сапог|loafer|sneaker|sandals)/, /(shoes|обув|кроссов|кед|ботин|туфл|сапог|loafer|sneaker|sandals)/],
      [/(accessor|аксесс|шапк|сумк|bag|belt|ремень|шарф|перчат|cap|кепк|очк|watch)/, /(accessor|аксесс|шапк|сумк|bag|belt|ремень|шарф|перчат|cap|кепк|очк|watch)/],
      [/(tops|top|верх|футбол|майк|рубаш|лонгслив|поло|худи|свитш|свитер|джемпер)/, /(tops|top|верх|футбол|майк|рубаш|лонгслив|поло|худи|свитш|свитер|джемпер)/],
    ];

    for (const [selectedRx, productRx] of categoryMatchers) {
      if (selectedRx.test(selected)) {
        return productRx.test(`${productCategory} ${hay}`);
      }
    }

    return (`${productCategory} ${hay}`).includes(selected);
  };

  const filtered = baseProducts.filter(p => {
    const matchesGender = matchesGenderFilter(p, filter.gender);
    const matchesCategory = matchesCategoryFilter(p, filter.category);
    const matchesSearch = p.title.toLowerCase().includes(search.toLowerCase());
    return matchesGender && matchesCategory && matchesSearch;
  });

  const isInWardrobe = (productId: string) => {
    return wardrobe.some(item => item.id === productId);
  };

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
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          <button 
            onClick={() => setFilter({ ...filter, gender: filter.gender === Gender.MALE ? undefined : Gender.MALE })}
            className={`flex-shrink-0 px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${filter.gender === Gender.MALE ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-400'}`}
          >Мужчинам</button>
          <button 
            onClick={() => setFilter({ ...filter, gender: filter.gender === Gender.FEMALE ? undefined : Gender.FEMALE })}
            className={`flex-shrink-0 px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${filter.gender === Gender.FEMALE ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-400'}`}
          >Женщинам</button>
          {Object.values(Category).map(cat => (
             <button 
               key={cat}
               onClick={() => setFilter({ ...filter, category: filter.category === cat ? undefined : cat })}
               className={`flex-shrink-0 px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${filter.category === cat ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-400'}`}
             >{cat}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-4 mt-6">
        {filtered.map(p => {
          const added = isInWardrobe(p.id);
          return (
            <div key={p.id} className="group">
              <div className="relative aspect-[3/4] rounded-[24px] overflow-hidden bg-zinc-50 p-6 border border-zinc-100 transition-all hover:shadow-xl hover:border-zinc-200">
                 <img
                   src={(p as any).images?.[0] ? catalogImageSrc((p as any).images[0]) : IMG_FALLBACK}
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
                   className={`absolute bottom-4 right-4 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${added ? 'bg-zinc-900 text-white scale-110' : 'bg-white/90 backdrop-blur text-zinc-900 hover:bg-zinc-900 hover:text-white'}`}
                 >
                   {added ? (
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
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
                    <h3 className="text-[11px] font-bold uppercase tracking-tight truncate flex-1 text-zinc-700">{p.title}</h3>
                 </div>
                 <div className="flex justify-between items-center">
                    <p className="text-sm font-black">{p.price} {CURRENCY}</p>
                    <span className="text-[8px] font-bold uppercase text-zinc-400 px-2 py-1 bg-zinc-50 rounded-md border border-zinc-100">{((p as any).storeName || (p as any).brand || "Store-A")}</span>
                 </div>
                 <button
                   onClick={() => {
                     const url = (p as any).affiliateUrl || (p as any).productUrl;
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
              <svg className="w-8 h-8 text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
           </div>
           <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Ничего не найдено</p>
           <button onClick={() => {setFilter({}); setSearch('');}} className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 underline underline-offset-4">Сбросить фильтры</button>
        </div>
      )}
    </div>
  );
};

export default Catalog;
