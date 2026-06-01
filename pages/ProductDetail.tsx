import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppState } from '../store';
import { Product } from '../types';
import { CURRENCY } from '../constants';
import { withApiOrigin } from '../utils/withApiOrigin';
import { catalogImageSrc } from '../utils/catalogImageSrc';

const IMG_FALLBACK = '';

function isSameCatalogProduct(a: any, b: any) {
  if (!a || !b) return false;
  if (a?.id && b?.id && a.id === b.id) return true;
  if (a?.affiliateUrl && b?.affiliateUrl && a.affiliateUrl === b.affiliateUrl) return true;
  if (a?.productUrl && b?.productUrl && a.productUrl === b.productUrl) return true;
  if (a?.images?.[0] && b?.images?.[0] && a.images[0] === b.images[0]) return true;
  return false;
}

function genderLabel(value?: string) {
  const v = String(value || '').toUpperCase();
  if (v === 'FEMALE') return 'женщинам';
  if (v === 'MALE') return 'мужчинам';
  return 'унисекс';
}

function categoryLabel(value?: string) {
  const v = String(value || '').toUpperCase();
  if (v === 'SHOES') return 'обувь';
  if (v === 'BAGS') return 'сумки';
  if (v === 'ACCESSORIES') return 'аксессуары';
  if (v === 'TOPS') return 'верх';
  if (v === 'BOTTOMS') return 'низ';
  if (v === 'JACKETS') return 'верхняя одежда';
  if (v === 'DRESS') return 'платья';
  return 'товар';
}


function productClickoutUrl(product: any, placement: string) {
  const id = String(product?.id || '').trim();
  if (!id) return '';
  const params = new URLSearchParams({ placement });
  return withApiOrigin(`/api/out/product/${encodeURIComponent(id)}?${params.toString()}`);
}

function productTypeCatalogParams(product: any) {
  const group = String(product?.taxonomyGroup || '').toUpperCase();
  const subgroup = String(product?.taxonomySubgroup || '').toUpperCase();
  const displayCategory = String(product?.displayCategory || '').toUpperCase();
  const category = String(product?.category || '').toUpperCase();

  const shoeTypes = new Set([
    'SNEAKERS',
    'SNEAKERS_CASUAL',
    'BOOTS',
    'TALL_BOOTS',
    'LOAFERS',
    'SANDALS',
    'BALLET',
    'SHOES_CLASSIC',
  ]);

  const clothingTypes = new Set([
    'DRESSES',
    'TOPS',
    'BLAZERS',
    'OUTERWEAR',
    'SKIRTS',
    'TROUSERS',
    'DENIM',
    'TSHIRTS',
    'POLO',
    'HOODIES',
    'KNITWEAR',
    'SHIRTS',
    'SUITS',
  ]);

  if (group === 'SHOES' || category === 'SHOES' || displayCategory === 'SHOES') {
    const shoeType = shoeTypes.has(subgroup) ? `&shoeType=${encodeURIComponent(subgroup)}` : '';
    return `displayCategory=SHOES${shoeType}`;
  }

  if (group === 'CLOTHING' || ['TOPS', 'BOTTOMS', 'JACKETS', 'DRESS'].includes(category) || displayCategory === 'CLOTHING') {
    const clothingType = clothingTypes.has(subgroup) ? `&clothingType=${encodeURIComponent(subgroup)}` : '';
    return `displayCategory=CLOTHING${clothingType}`;
  }

  if (group === 'BAGS' || displayCategory === 'BAGS') {
    return 'displayCategory=BAGS';
  }

  if (group === 'ACCESSORIES' || displayCategory === 'ACCESSORIES') {
    return 'displayCategory=ACCESSORIES';
  }

  return displayCategory ? `displayCategory=${encodeURIComponent(displayCategory)}` : '';
}

function productTypeLabel(product: any) {
  const subgroup = String(product?.taxonomySubgroup || '').toUpperCase();
  const group = String(product?.taxonomyGroup || '').toUpperCase();
  const category = String(product?.category || '').toUpperCase();

  const labels: Record<string, string> = {
    SNEAKERS: 'кроссовки',
    SNEAKERS_CASUAL: 'кеды',
    BOOTS: 'ботинки',
    TALL_BOOTS: 'сапоги',
    LOAFERS: 'лоферы',
    SANDALS: 'сандалии и босоножки',
    BALLET: 'балетки',
    SHOES_CLASSIC: 'туфли',
    DRESSES: 'платья',
    TOPS: 'верх',
    BLAZERS: 'жакеты',
    OUTERWEAR: 'верхнюю одежду',
    SKIRTS: 'юбки',
    TROUSERS: 'брюки',
    DENIM: 'джинсы',
    TSHIRTS: 'футболки',
    POLO: 'поло',
    HOODIES: 'худи и толстовки',
    KNITWEAR: 'трикотаж',
    SHIRTS: 'рубашки',
    SUITS: 'костюмы',
    BAGS: 'сумки',
  };

  if (labels[subgroup]) return labels[subgroup];
  if (group === 'SHOES' || category === 'SHOES') return 'обувь';
  if (group === 'CLOTHING') return 'одежду';
  if (group === 'BAGS') return 'сумки';
  return 'похожие товары';
}


function companionLinks(product: any) {
  const subgroup = String(product?.taxonomySubgroup || '').toUpperCase();
  const group = String(product?.taxonomyGroup || '').toUpperCase();
  const gender = String(product?.gender || '').toUpperCase();

  const genderParam = gender && gender !== 'UNISEX' ? `&gender=${encodeURIComponent(gender)}` : '';

  const link = (label: string, params: string) => ({
    label,
    href: `/catalog?${params}${genderParam}`,
  });

  if (group === 'SHOES') {
    return [
      link('Брюки и джинсы', 'displayCategory=CLOTHING&clothingType=TROUSERS'),
      link('Худи и трикотаж', 'displayCategory=CLOTHING&clothingType=KNITWEAR'),
      link('Куртки и жакеты', 'displayCategory=CLOTHING&clothingType=OUTERWEAR'),
    ];
  }

  if (['TROUSERS', 'DENIM', 'SKIRTS'].includes(subgroup)) {
    return [
      link('Рубашки', 'displayCategory=CLOTHING&clothingType=SHIRTS'),
      link('Жакеты', 'displayCategory=CLOTHING&clothingType=BLAZERS'),
      link('Обувь', 'displayCategory=SHOES'),
    ];
  }

  if (['DRESSES'].includes(subgroup)) {
    return [
      link('Туфли и босоножки', 'displayCategory=SHOES&shoeType=SHOES_CLASSIC'),
      link('Жакеты', 'displayCategory=CLOTHING&clothingType=BLAZERS'),
      link('Сумки', 'displayCategory=BAGS'),
    ];
  }

  if (['OUTERWEAR', 'BLAZERS'].includes(subgroup)) {
    return [
      link('Брюки', 'displayCategory=CLOTHING&clothingType=TROUSERS'),
      link('Трикотаж', 'displayCategory=CLOTHING&clothingType=KNITWEAR'),
      link('Обувь', 'displayCategory=SHOES'),
    ];
  }

  return [
    link('Одежда', 'displayCategory=CLOTHING'),
    link('Обувь', 'displayCategory=SHOES'),
    link('Сумки', 'displayCategory=BAGS'),
  ];
}

const ProductDetail = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { wardrobe, actions } = useAppState() as any;

  const [product, setProduct] = useState<Product | any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError('');

      try {
        const resp = await fetch(
          withApiOrigin(`/api/catalog/products/${encodeURIComponent(id)}`),
          { credentials: 'include' }
        );
        const data = await resp.json().catch(() => ({}));

        if (cancelled) return;

        if (!resp.ok) {
          throw new Error(data?.error || `Product fetch failed (${resp.status})`);
        }

        setProduct(data?.product || null);
      } catch (e: any) {
        if (!cancelled) {
          setProduct(null);
          setError(e?.message || 'Не удалось загрузить товар');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const added = useMemo(
    () => wardrobe.some((item: any) => isSameCatalogProduct(item, product)),
    [wardrobe, product]
  );

  const sizes = useMemo(() => {
    const values = [
      ...((product as any)?.sizesTop || []),
      ...((product as any)?.sizesBottom || []),
      ...((product as any)?.sizesShoes || []),
      ...((product as any)?.sizes || []),
    ].map(String).filter((v) => v && v !== 'ONE');

    return Array.from(new Set(values));
  }, [product]);

  if (loading) {
    return (
      <div className="px-5 py-24 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Загружаем товар...</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="px-5 py-24 text-center space-y-5">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
          {error || 'Товар не найден'}
        </p>
        <Link
          to="/catalog"
          className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-[10px] font-black uppercase tracking-[0.18em] text-white"
        >
          Вернуться в каталог
        </Link>
      </div>
    );
  }

  const image = product?.images?.[0] || '';
  const hasBuyUrl = !!(product.affiliateUrl || product.productUrl);
  const buyUrl = productClickoutUrl(product, 'product_detail');
  const relatedParams = productTypeCatalogParams(product);
  const relatedTypeLabel = productTypeLabel(product);
  const relatedHref = `/catalog?${relatedParams}${
    product.brand ? `&brand=${encodeURIComponent(product.brand)}` : ''
  }`;
  const relatedFallbackHref = `/catalog?${relatedParams}`;

  return (
    <div className="px-4 pt-4 pb-28 max-w-6xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-900"
      >
        ← Назад
      </button>

      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] gap-6 lg:gap-10">
        <div className="relative rounded-[32px] overflow-hidden bg-zinc-50 border border-zinc-100 min-h-[480px] p-8 flex items-center justify-center">
          {!!product.discountPercent && product.discountPercent > 0 && (
            <div className="absolute top-5 left-5 z-10 bg-zinc-900 text-white px-3 py-2 rounded-full shadow-md">
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">
                -{product.discountPercent}%
              </span>
            </div>
          )}

          <img
            src={image ? catalogImageSrc(image, { w: 900 }) : IMG_FALLBACK}
            alt={product.title || ''}
            className="w-full h-full max-h-[620px] object-contain mix-blend-multiply"
          />
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-zinc-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap gap-2 mb-5">
              <span className="rounded-full bg-zinc-50 border border-zinc-100 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {product.storeName || 'Магазин'}
              </span>
              <span className="rounded-full bg-zinc-50 border border-zinc-100 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {categoryLabel(product.category)}
              </span>
              <span className="rounded-full bg-zinc-50 border border-zinc-100 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {genderLabel(product.gender)}
              </span>
            </div>

            {!!product.brand && (
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400 mb-2">
                {product.brand}
              </p>
            )}

            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-950">
              {product.title}
            </h1>

            <div className="mt-5 flex items-end gap-3">
              <p className="text-2xl font-black">{product.price} {CURRENCY}</p>
              {!!product.oldPrice && product.oldPrice > product.price && (
                <p className="text-sm font-bold text-zinc-400 line-through pb-1">
                  {product.oldPrice} {CURRENCY}
                </p>
              )}
            </div>

            {sizes.length > 0 && (
              <div className="mt-6">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 mb-3">
                  Размеры
                </p>
                <div className="flex flex-wrap gap-2">
                  {sizes.map((s) => (
                    <span
                      key={s}
                      className="min-w-10 h-9 px-3 rounded-full border border-zinc-200 bg-white flex items-center justify-center text-[11px] font-black text-zinc-700"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-7 grid gap-3">
              <button
                onClick={() => {
                  if (!added) actions.addToWardrobe(product);
                  navigate('/create-look');
                }}
                className="h-12 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] shadow-md active:scale-95 transition-all"
              >
                Добавить в образ
              </button>

              <button
                onClick={() => {
                  if (!added) actions.addToWardrobe(product);
                }}
                className={`h-12 rounded-full border text-[10px] font-black uppercase tracking-[0.18em] transition-all ${
                  added
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-900 border-zinc-900 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                {added ? 'В шкафу' : 'В шкаф'}
              </button>

              <button
                onClick={() => {
                  if (buyUrl) window.open(buyUrl, '_blank', 'noopener,noreferrer');
                }}
                disabled={!hasBuyUrl || !buyUrl}
                className="h-12 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-900 text-[10px] font-black uppercase tracking-[0.18em] hover:bg-white disabled:opacity-50 active:scale-95 transition-all"
              >
                Купить на сайте продавца
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-zinc-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 mb-3">
              С чем примерить
            </p>
            <div className="grid gap-2">
              {companionLinks(product).map((item) => (
                <Link
                  key={item.label}
                  to={item.href}
                  className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-800 hover:bg-zinc-100"
                >
                  <span>{item.label}</span>
                  <span className="text-zinc-400">→</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-zinc-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 mb-3">
              Похожие товары
            </p>

            <div className="grid gap-2">
              <Link
                to={relatedHref}
                className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-800 hover:bg-zinc-100"
              >
                <span>
                  {product.brand
                    ? `${relatedTypeLabel} бренда ${product.brand}`
                    : `Похожие ${relatedTypeLabel}`}
                </span>
                <span className="text-zinc-400">→</span>
              </Link>

              {product.brand && (
                <Link
                  to={relatedFallbackHref}
                  className="flex items-center justify-between rounded-2xl bg-white border border-zinc-100 px-4 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  <span>Все похожие {relatedTypeLabel}</span>
                  <span className="text-zinc-400">→</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
