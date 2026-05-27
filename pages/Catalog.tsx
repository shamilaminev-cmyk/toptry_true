import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import { withApiOrigin } from "../utils/withApiOrigin";
import { catalogImageSrc } from "../utils/catalogImageSrc";
import { useAppState } from '../store';
import { Gender } from '../types';
import { CURRENCY, ICONS } from '../constants';

type DisplayCategory =
  | 'CLOTHING'
  | 'SHOES'
  | 'BAGS'
  | 'ACCESSORIES';

type ClothingType =
  | ''
  | 'FEMALE_CLOTHING'
  | 'MALE_CLOTHING'
  | 'DRESSES'
  | 'TOPS'
  | 'TSHIRTS'
  | 'POLO'
  | 'SHIRTS'
  | 'HOODIES'
  | 'KNITWEAR'
  | 'SKIRTS'
  | 'TROUSERS'
  | 'DENIM'
  | 'BLAZERS'
  | 'OUTERWEAR'
  | 'SUITS';

type ShoeType =
  | ''
  | 'SNEAKERS'
  | 'SNEAKERS_CASUAL'
  | 'BOOTS'
  | 'HEELS'
  | 'BALLET'
  | 'TALL_BOOTS'
  | 'LOAFERS'
  | 'SANDALS'
  | 'SHOES_CLASSIC';

const GENDER_TABS: Array<{ id: '' | Gender; label: string }> = [
  { id: '', label: 'Все' },
  { id: Gender.FEMALE, label: 'Женщинам' },
  { id: Gender.MALE, label: 'Мужчинам' },
];

const CATEGORY_TABS: Array<{ id: '' | DisplayCategory; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'CLOTHING', label: 'Одежда' },
  { id: 'SHOES', label: 'Обувь' },
  { id: 'BAGS', label: 'Сумки' },
  { id: 'ACCESSORIES', label: 'Аксессуары' },
];

const CLOTHING_TABS_MIXED: Array<{ id: ClothingType; label: string }> = [
  { id: 'FEMALE_CLOTHING', label: 'Женская одежда' },
  { id: 'MALE_CLOTHING', label: 'Мужская одежда' },
];

const CLOTHING_TABS_FEMALE: Array<{ id: ClothingType; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'DRESSES', label: 'Платья' },
  { id: 'TOPS', label: 'Топы' },
  { id: 'SHIRTS', label: 'Блузы и рубашки' },
  { id: 'SKIRTS', label: 'Юбки' },
  { id: 'TROUSERS', label: 'Брюки' },
  { id: 'DENIM', label: 'Джинсы' },
  { id: 'BLAZERS', label: 'Жакеты' },
  { id: 'OUTERWEAR', label: 'Верхняя одежда' },
];

const CLOTHING_TABS_MALE: Array<{ id: ClothingType; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'TSHIRTS', label: 'Футболки' },
  { id: 'POLO', label: 'Поло' },
  { id: 'SHIRTS', label: 'Рубашки' },
  { id: 'HOODIES', label: 'Худи и свитшоты' },
  { id: 'KNITWEAR', label: 'Свитеры' },
  { id: 'TROUSERS', label: 'Брюки' },
  { id: 'DENIM', label: 'Джинсы' },
  { id: 'OUTERWEAR', label: 'Верхняя одежда' },
  { id: 'SUITS', label: 'Костюмы' },
];

const getClothingTabs = (gender: '' | Gender): Array<{ id: ClothingType; label: string }> => {
  if (gender === Gender.FEMALE) return CLOTHING_TABS_FEMALE;
  if (gender === Gender.MALE) return CLOTHING_TABS_MALE;
  return CLOTHING_TABS_MIXED;
};

const SHOE_TABS_FEMALE: Array<{ id: ShoeType; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'SNEAKERS', label: 'Кроссовки' },
  { id: 'SNEAKERS_CASUAL', label: 'Кеды' },
  { id: 'SHOES_CLASSIC', label: 'Туфли' },
  { id: 'BALLET', label: 'Балетки' },
  { id: 'LOAFERS', label: 'Лоферы' },
  { id: 'BOOTS', label: 'Ботинки' },
  { id: 'TALL_BOOTS', label: 'Сапоги' },
  { id: 'SANDALS', label: 'Сандалии' },
];

const SHOE_TABS_MALE: Array<{ id: ShoeType; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'SNEAKERS', label: 'Кроссовки' },
  { id: 'SNEAKERS_CASUAL', label: 'Кеды' },
  { id: 'SHOES_CLASSIC', label: 'Туфли' },
  { id: 'LOAFERS', label: 'Лоферы' },
  { id: 'BOOTS', label: 'Ботинки' },
  { id: 'SANDALS', label: 'Сандалии' },
];

const getShoeTabs = (gender: '' | Gender): Array<{ id: ShoeType; label: string }> => {
  if (gender === Gender.FEMALE) return SHOE_TABS_FEMALE;
  return SHOE_TABS_MALE;
};


const IMG_FALLBACK = "";
const PAGE_SIZE = 24;
const CATALOG_FILTERS_STORAGE_KEY = 'toptry.catalog.filters.v1';


const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];


const Catalog = () => {
  const { wardrobe, actions, user } = useAppState() as any;

  const [gender, setGender] = useState<'' | Gender>('');
  const [draftGender, setDraftGender] = useState<'' | Gender>('');
  const [displayCategory, setDisplayCategory] = useState<'' | DisplayCategory>('');
  const [clothingType, setClothingType] = useState<ClothingType>('');
  const [shoeType, setShoeType] = useState<ShoeType>('');
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
  const [draftClothingType, setDraftClothingType] = useState<ClothingType>('');
  const [draftShoeType, setDraftShoeType] = useState<ShoeType>('');
  const [draftDiscountOnly, setDraftDiscountOnly] = useState(false);
  const [draftBrand, setDraftBrand] = useState('');
  const [draftPriceMin, setDraftPriceMin] = useState('');
  const [draftPriceMax, setDraftPriceMax] = useState('');
  const [size, setSize] = useState('');
  const [draftSize, setDraftSize] = useState('');
  const [sizeLoose, setSizeLoose] = useState(false);
  const [draftSizeLoose, setDraftSizeLoose] = useState(false);


  const effectiveSizeCategory = filtersOpen ? draftDisplayCategory : displayCategory;

  const isShoesCategory = effectiveSizeCategory === 'SHOES';
  const isClothingCategory = effectiveSizeCategory === 'CLOTHING';

  const visibleSizeOptions = isShoesCategory ? SHOE_SIZES : CLOTHING_SIZES;


  const [draftTotal, setDraftTotal] = useState<number | null>(null)
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasProfileSize = Boolean(user?.sizeTop || user?.sizeBottom || user?.sizeShoes);

  const getProfileSizeForFilters = (
    category: '' | DisplayCategory,
    type: ClothingType
  ) => {
    if (category === 'SHOES') return user?.sizeShoes || '';

    if (category === 'CLOTHING') {
      const bottomTypes: ClothingType[] = ['SKIRTS', 'TROUSERS', 'DENIM'];
      const topTypes: ClothingType[] = [
        'TOPS',
        'TSHIRTS',
        'POLO',
        'SHIRTS',
        'HOODIES',
        'KNITWEAR',
        'BLAZERS',
        'OUTERWEAR',
        'SUITS',
      ];

      if (bottomTypes.includes(type)) return user?.sizeBottom || '';
      if (topTypes.includes(type)) return user?.sizeTop || '';

      if (type === 'DRESSES') {
        if (user?.sizeTop && user?.sizeTop === user?.sizeBottom) return user.sizeTop;
        return user?.sizeTop || user?.sizeBottom || '';
      }

      return user?.sizeTop || user?.sizeBottom || '';
    }

    return '';
  };

  const currentMySizeValue = getProfileSizeForFilters(
    filtersOpen ? draftDisplayCategory : displayCategory,
    filtersOpen ? draftClothingType : clothingType
  );

  const draftMySizeValue = getProfileSizeForFilters(draftDisplayCategory, draftClothingType);

  const mySizeLabel = [
    user?.sizeTop ? `верх ${user.sizeTop}` : '',
    user?.sizeBottom ? `низ ${user.sizeBottom}` : '',
    user?.sizeShoes ? `обувь ${user.sizeShoes}` : '',
  ].filter(Boolean).join(' · ');

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
      size?: string;
      sizeLoose?: boolean;
      clothingType?: string;
      shoeType?: string;
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
    const sizeParam = hasHashFilters ? (hashParams.get('size') || '') : (saved?.size || '');
    const clothingTypeParam = String(
      hasHashFilters ? (hashParams.get('clothingType') || '') : (saved?.clothingType || '')
    ).toUpperCase() as ClothingType;
    const shoeTypeParam = String(
      hasHashFilters ? (hashParams.get('shoeType') || '') : (saved?.shoeType || '')
    ).toUpperCase() as ShoeType;
    const sizeLooseParam = sizeParam === 'MY' && (hasHashFilters ? hashParams.get('sizeLoose') === '1' : Boolean(saved?.sizeLoose));

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
    setSize(sizeParam);
    setDraftSize(sizeParam);
    setSizeLoose(sizeLooseParam);
    setDraftSizeLoose(sizeLooseParam);
    setClothingType(clothingTypeParam);
    setDraftClothingType(clothingTypeParam);
    setShoeType(shoeTypeParam);
    setDraftShoeType(shoeTypeParam);

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
    setDraftSize(size);
    setDraftSizeLoose(size === 'MY' ? sizeLoose : false);
    setDraftClothingType(clothingType);
    setDraftShoeType(shoeType);
  }, [filtersOpen, gender, displayCategory, clothingType, shoeType, discountOnly, brand, priceMin, priceMax, size, sizeLoose]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const params = new URLSearchParams();
        if (gender) params.set('gender', gender);
        if (displayCategory) params.set('displayCategory', displayCategory);
    if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
    if (displayCategory === 'SHOES' && shoeType) params.set('shoeType', shoeType);
        if (displayCategory === 'SHOES' && shoeType) params.set('shoeType', shoeType);
        if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
    if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
        if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
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
  }, [gender, displayCategory, clothingType, shoeType, debouncedSearch, discountOnly, brand]);

  const fetchCatalog = async (nextOffset: number, append: boolean) => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(nextOffset));

    if (gender) params.set('gender', gender);
    if (displayCategory) params.set('displayCategory', displayCategory);
    if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
    if (displayCategory === 'SHOES' && shoeType) params.set('shoeType', shoeType);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (discountOnly) params.set('discountOnly', '1');
    if (brand) params.set('brand', brand);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (sort) params.set('sort', sort);
    if (size) params.set('size', size);
    if (size === 'MY' && sizeLoose) params.set('sizeLoose', '1');

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
    setItems([]);
    setOffset(0);
    setHasMore(false);

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', '0');

        if (gender) params.set('gender', gender);
        if (displayCategory) params.set('displayCategory', displayCategory);
    if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
    if (displayCategory === 'SHOES' && shoeType) params.set('shoeType', shoeType);
        if (debouncedSearch) params.set('q', debouncedSearch);
        if (discountOnly) params.set('discountOnly', '1');
    if (brand) params.set('brand', brand);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (sort) params.set('sort', sort);
    if (size) params.set('size', size);
    if (size === 'MY' && sizeLoose) params.set('sizeLoose', '1');

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
  }, [gender, displayCategory, clothingType, shoeType, debouncedSearch, discountOnly, brand, priceMin, priceMax, sort, size, sizeLoose]);

  useEffect(() => {
    try {
      const payload = {
        q: debouncedSearch,
        gender,
        displayCategory,
        clothingType: displayCategory === 'CLOTHING' ? clothingType : '',
        shoeType: displayCategory === 'SHOES' ? shoeType : '',
        discountOnly,
        brand,
        priceMin,
        priceMax,
        sort,
        size,
        sizeLoose: size === 'MY' && sizeLoose,
      };
      window.sessionStorage.setItem(CATALOG_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [debouncedSearch, gender, displayCategory, clothingType, shoeType, discountOnly, brand, priceMin, priceMax, sort, size, sizeLoose]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (debouncedSearch) params.set('q', debouncedSearch);
    if (gender) params.set('gender', gender);
    if (displayCategory) params.set('displayCategory', displayCategory);
    if (displayCategory === 'CLOTHING' && clothingType) params.set('clothingType', clothingType);
    if (displayCategory === 'SHOES' && shoeType) params.set('shoeType', shoeType);
    if (discountOnly) params.set('discountOnly', '1');
    if (brand) params.set('brand', brand);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (sort) params.set('sort', sort);
    if (size) params.set('size', size);
    if (size === 'MY' && sizeLoose) params.set('sizeLoose', '1');

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
    clothingType,
    shoeType,
    discountOnly,
    brand,
    priceMin,
    priceMax,
    sort,
    size,
    sizeLoose,
  ]);

  const isInWardrobe = (product: any) => {
    return wardrobe.some((item: any) => {
      if (!(item?.isCatalog || item?.sourceType === "catalog")) return false;

      // Catalog titles are not unique: e.g. many cards can be named
      // "Брюки Maison David". The selected/checkmark state must rely only
      // on stable item identity, not on title/category/gender fallback.
      if (product?.id && item?.id && item.id === product.id) return true;
      if (product?.affiliateUrl && item?.affiliateUrl && item.affiliateUrl === product.affiliateUrl) return true;
      if (product?.productUrl && item?.productUrl && item.productUrl === product.productUrl) return true;
      if (product?.images?.[0] && item?.images?.[0] && item.images[0] === product.images[0]) return true;

      return false;
    });
  };

  const clearFilters = () => {
    setGender('');
    setDraftGender('');
    setDisplayCategory('');
    setDraftDisplayCategory('');
    setClothingType('');
    setDraftClothingType('');
    setShoeType('');
    setDraftShoeType('');
    setSearch('');
    setDebouncedSearch('');
    setDiscountOnly(false);
    setBrand('');
    setPriceMin('');
    setPriceMax('');
    setSort('');
    setSize('');
    setSizeLoose(false);
    setDraftDiscountOnly(false);
    setDraftBrand('');
    setDraftPriceMin('');
    setDraftPriceMax('');
    setDraftSize('');
    setDraftSizeLoose(false);
    try {
      window.sessionStorage.removeItem(CATALOG_FILTERS_STORAGE_KEY);
    } catch {}
    window.history.replaceState(null, '', '#/catalog');
  };

  const clearDraftFilters = () => {
    setDraftGender('');
    setDraftDisplayCategory('');
    setDraftClothingType('');
    setDraftShoeType('');
    setDraftDiscountOnly(false);
    setDraftBrand('');
    setDraftPriceMin('');
    setDraftPriceMax('');
    setDraftSize('');
    setDraftSizeLoose(false);
  };

  

  useEffect(() => {
    if (!filtersOpen) return

    const controller = new AbortController()

    const run = async () => {
      try {
        const params = new URLSearchParams()

        if (draftGender) params.set('gender', draftGender)
        if (draftDisplayCategory) params.set('displayCategory', draftDisplayCategory)
        if (draftDisplayCategory === 'CLOTHING' && draftClothingType) params.set('clothingType', draftClothingType)
        if (draftDisplayCategory === 'SHOES' && draftShoeType) params.set('shoeType', draftShoeType)
        if (draftBrand) params.set('brand', draftBrand)
        if (draftDiscountOnly) params.set('discountOnly', '1')
        if (draftPriceMin) params.set('priceMin', draftPriceMin)
        if (draftPriceMax) params.set('priceMax', draftPriceMax)
        if (draftSize) params.set('size', draftSize)
        if (draftSize === 'MY' && draftSizeLoose) params.set('sizeLoose', '1')

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
    draftClothingType,
    draftShoeType,
    draftBrand,
    draftDiscountOnly,
    draftPriceMin,
    draftPriceMax,
    draftSize,
    draftSizeLoose
  ])


  const applyDrawerFilters = () => {
    setGender(draftGender);
    setDisplayCategory(draftDisplayCategory);
    setClothingType(draftDisplayCategory === 'CLOTHING' ? draftClothingType : '');
    setShoeType(draftDisplayCategory === 'SHOES' ? draftShoeType : '');
    setDiscountOnly(draftDiscountOnly);
    setBrand(draftBrand);
    setPriceMin(draftPriceMin);
    setPriceMax(draftPriceMax);
    setSize(draftSize);
    setSizeLoose(draftSize === 'MY' ? draftSizeLoose : false);
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
      [gender, displayCategory, displayCategory === 'CLOTHING' ? clothingType : '', displayCategory === 'SHOES' ? shoeType : '', debouncedSearch, discountOnly ? '1' : '', brand, priceMin, priceMax, sort, size, size === 'MY' && sizeLoose ? 'sizeLoose' : ''].filter(Boolean).length,
    [gender, displayCategory, clothingType, shoeType, debouncedSearch, discountOnly, brand, priceMin, priceMax, sort, size, sizeLoose]
  );
  const draftActiveFiltersCount = useMemo(
    () =>
      [draftGender, draftDisplayCategory, draftDisplayCategory === 'CLOTHING' ? draftClothingType : '', draftDisplayCategory === 'SHOES' ? draftShoeType : '', debouncedSearch, draftDiscountOnly ? '1' : '', draftBrand, draftPriceMin, draftPriceMax, draftSize, draftSize === 'MY' && draftSizeLoose ? 'sizeLoose' : ''].filter(Boolean).length,
    [draftGender, draftDisplayCategory, draftClothingType, draftShoeType, debouncedSearch, draftDiscountOnly, draftBrand, draftPriceMin, draftPriceMax, draftSize, draftSizeLoose]
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
              setDraftSize(size);
              setDraftSizeLoose(size === 'MY' ? sizeLoose : false);
              setDraftClothingType(clothingType);
              setDraftShoeType(shoeType);
              setFiltersOpen(true);
            }}
            className="h-12 px-5 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900 flex items-center justify-between"
          >
            <span>Фильтры{activeFiltersCount ? ` (${activeFiltersCount})` : ''}</span>
            <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>

          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="appearance-none w-full h-12 min-w-[150px] pl-5 pr-12 border rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border-zinc-300 text-zinc-900"
            >
              <option value="">Сортировка</option>
              <option value="price_asc">Цена ↑</option>
              <option value="price_desc">Цена ↓</option>
              <option value="discount_desc">Скидка ↓</option>
            </select>
            <svg
              className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </div>
        </div>

      </div>

      <div className="px-4 mt-4 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Найдено: {filteredCountLabel}
        </p>
        {(gender || displayCategory || clothingType || shoeType || search || discountOnly || brand || priceMin || priceMax || sort || size || (size === 'MY' && sizeLoose)) && (
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
              {CATEGORY_TABS.map((tab) => {
                const active = draftDisplayCategory === tab.id;
                return (
                  <button
                    key={String(tab.id || 'all')}
                    onClick={() => {
                      const nextCategory = tab.id;
                      setDraftDisplayCategory(nextCategory);
                      if (nextCategory !== 'CLOTHING') setDraftClothingType('');
                      if (nextCategory !== 'SHOES') setDraftShoeType('');

                      setDraftSize((current) => {
                        if (!current || current === 'MY') return current;

                        const nextIsShoes = nextCategory === 'SHOES';
                        const nextIsClothing = nextCategory === 'CLOTHING';

                        if (!nextIsShoes && !nextIsClothing) {
                          setDraftSizeLoose(false);
                          return '';
                        }

                        if (nextIsShoes && !SHOE_SIZES.includes(current)) {
                          setDraftSizeLoose(false);
                          return '';
                        }

                        if (nextIsClothing && !CLOTHING_SIZES.includes(current)) {
                          setDraftSizeLoose(false);
                          return '';
                        }

                        return current;
                      });
                    }}
                    className={`flex-shrink-0 h-11 px-5 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                      active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {draftDisplayCategory === 'CLOTHING' && (
              <div className="space-y-3 rounded-[28px] bg-zinc-50/70 border border-zinc-100 p-3">
                {!draftGender ? (
                  <div className="space-y-2">
                    <div className="px-1 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-400">
                      Для кого
                    </div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {[
                        { id: Gender.FEMALE, label: 'Женщинам' },
                        { id: Gender.MALE, label: 'Мужчинам' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            setDraftGender(tab.id);
                            setDraftClothingType('');
                          }}
                          className="flex-shrink-0 h-10 px-4 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border border-zinc-200 bg-white text-zinc-600 transition-all active:scale-[0.98]"
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 px-1">
                      <div className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-400">
                        Категории
                      </div>
                      <button
                        onClick={() => {
                          setDraftGender('');
                          setDraftClothingType('');
                        }}
                        className="text-[9px] font-black uppercase tracking-[0.22em] text-zinc-400 underline underline-offset-4"
                      >
                        изменить
                      </button>
                    </div>

                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {getClothingTabs(draftGender).map((tab) => {
                        const active = draftClothingType === tab.id;
                        return (
                          <button
                            key={String(tab.id || 'all-clothing')}
                            onClick={() => setDraftClothingType(tab.id)}
                            className={`flex-shrink-0 h-10 px-4 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                              active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {draftDisplayCategory === 'SHOES' && (
              <div className="space-y-3 rounded-[28px] bg-zinc-50/70 border border-zinc-100 p-3">
                {!draftGender ? (
                  <div className="space-y-2">
                    <div className="px-1 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-400">
                      Для кого
                    </div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {[
                        { id: Gender.FEMALE, label: 'Женщинам' },
                        { id: Gender.MALE, label: 'Мужчинам' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            setDraftGender(tab.id);
                            setDraftShoeType('');
                          }}
                          className="flex-shrink-0 h-10 px-4 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border border-zinc-200 bg-white text-zinc-600 transition-all active:scale-[0.98]"
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 px-1">
                      <div className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-400">
                        Категории
                      </div>
                      <button
                        onClick={() => {
                          setDraftGender('');
                          setDraftShoeType('');
                        }}
                        className="text-[9px] font-black uppercase tracking-[0.22em] text-zinc-400 underline underline-offset-4"
                      >
                        изменить
                      </button>
                    </div>

                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {getShoeTabs(draftGender).map((tab) => {
                        const active = draftShoeType === tab.id;
                        return (
                          <button
                            key={String(tab.id || 'all-shoes')}
                            onClick={() => setDraftShoeType(tab.id)}
                            className={`flex-shrink-0 h-10 px-4 inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                              active ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}


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

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  if (!hasProfileSize) return;
                  setDraftSize((v) => {
                    const next = v === 'MY' ? '' : 'MY';
                    if (next !== 'MY') setDraftSizeLoose(false);
                    return next;
                  });
                }}
                disabled={!hasProfileSize}
                title={hasProfileSize ? mySizeLabel : 'Укажите размеры в профиле'}
                className={`w-full h-12 inline-flex items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  draftSize === 'MY' ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                }`}
              >
                Мой размер
              </button>

              <button
                onClick={() => {
                  if (draftSize !== 'MY') return;
                  setDraftSizeLoose((v) => !v);
                }}
                disabled={draftSize !== 'MY'}
                title="Показывать соседние размеры"
                className={`w-full h-12 inline-flex items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  draftSize === 'MY' && draftSizeLoose ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' : 'bg-white border-zinc-200 text-zinc-500'
                }`}
              >
                ± 1 размер
              </button>
            </div>

            {(isShoesCategory || isClothingCategory) && (
              <div className="flex flex-wrap gap-2">
                {visibleSizeOptions.map((s) => {
                  const active =
                    draftSize === s ||
                    (draftSize === 'MY' && draftMySizeValue === s);

                  return (
                    <button
                      key={s}
                      onClick={() => {
                        setDraftSize((v) => v === s ? '' : s);
                        setDraftSizeLoose(false);
                      }}
                      className={`h-11 min-w-[52px] px-4 inline-flex items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                        active
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                          : 'bg-white border-zinc-200 text-zinc-500'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            )}

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

                    {size === 'MY' && (
                      <div className="absolute top-4 right-4 z-10 bg-white/95 backdrop-blur border border-zinc-200 text-zinc-900 px-2.5 py-1.5 rounded-full shadow-sm">
                        <span className="text-[9px] font-black uppercase tracking-[0.12em]">
                          Есть ваш размер
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
                        el.style.display = "none";
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
