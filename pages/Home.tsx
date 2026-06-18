import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ICONS } from '../constants';
import { useAppState } from '../store';
import { withApiOrigin } from '../utils/withApiOrigin';
import { catalogImageSrc } from '../utils/catalogImageSrc';

const HERO_SLIDES = [
  { src: '/hero/Hero1.png', alt: 'Женский образ в современном интерфейсе TopTry' },
  { src: '/hero/Hero2.png', alt: 'Мужской образ в современном интерфейсе TopTry' },
  { src: '/hero/Hero3.png', alt: 'Молодёжный образ в современном интерфейсе TopTry' },
  { src: '/hero/Hero4.png', alt: 'Классический образ в современном интерфейсе TopTry' },
];

const Home: React.FC = () => {
  const { user, looks } = useAppState();
  const [feedLooks, setFeedLooks] = useState<any[]>([]);
  const [followingLooks, setFollowingLooks] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [dealItems, setDealItems] = useState<any[]>([]);
  const [priceDropItems, setPriceDropItems] = useState<any[]>([]);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(withApiOrigin('/api/looks/public?limit=16'), { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        setFeedLooks(Array.isArray(data?.looks) ? data.looks : []);
      } catch {
        setFeedLooks([]);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroSlideIndex((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 2800);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setFollowingLooks([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(withApiOrigin('/api/looks/following?limit=6'), {
          credentials: 'include',
        });
        const data = await resp.json().catch(() => ({}));

        if (cancelled) return;

        setFollowingLooks(Array.isArray(data?.looks) ? data.looks : []);
      } catch {
        if (!cancelled) setFollowingLooks([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(withApiOrigin('/api/catalog/home-new?limit=4'), { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        setCatalogItems(Array.isArray(data?.products) ? data.products : []);
      } catch {
        setCatalogItems([]);
      }
    })();
  }, []);


  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(withApiOrigin('/api/catalog/deals?limit=4&minDiscount=30'), { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        setDealItems(Array.isArray(data?.products) ? data.products : []);
      } catch {
        setDealItems([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(withApiOrigin('/api/catalog/price-drops?limit=4&minDeltaPct=10&days=60'), { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        setPriceDropItems(Array.isArray(data?.products) ? data.products : []);
      } catch {
        setPriceDropItems([]);
      }
    })();
  }, []);

  const previewLooks = useMemo(() => {
    const source = feedLooks.length ? feedLooks : looks;

    const preference = String(user?.catalogGenderPreference || '').toUpperCase();
    const targetGender =
      preference === 'MALE' || preference === 'FEMALE'
        ? preference
        : '';

    const lookGender = (look: any) => {
      const genders = Array.isArray(look?.sourceItems)
        ? look.sourceItems
            .map((item: any) => String(item?.gender || '').toUpperCase())
            .filter(Boolean)
        : [];

      if (genders.includes('MALE')) return 'MALE';
      if (genders.includes('FEMALE')) return 'FEMALE';
      if (genders.includes('UNISEX')) return 'UNISEX';

      const authorSlug = String(look?.authorSlug || '').toLowerCase();

      if (authorSlug === 'leo-grant' || authorSlug === 'milan-ash') return 'MALE';
      if (['mira-ward', 'alma-rue', 'tess-noir', 'lina-moss'].includes(authorSlug)) return 'FEMALE';

      return '';
    };

    if (!targetGender) return source.slice(0, 4);

    const preferred = source.filter((look: any) => {
      const gender = lookGender(look);
      return gender === targetGender || gender === 'UNISEX';
    });

    const fallback = source.filter((look: any) => !preferred.some((item: any) => item.id === look.id));

    return [...preferred, ...fallback].slice(0, 4);
  }, [feedLooks, looks, user?.catalogGenderPreference]);

  return (
    <div className="pb-56">
      <section className="px-4 pt-2 md:pt-5 md:px-8 md:max-w-7xl md:mx-auto">
        <div className="overflow-hidden rounded-[30px] md:rounded-[36px] border border-zinc-200 bg-[#f5f5f5] shadow-[0_20px_80px_rgba(15,23,42,0.06)]">
          <div className="lg:grid lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:items-stretch">
            <div className="relative h-[320px] sm:h-[420px] md:h-[560px] lg:order-2 lg:h-auto lg:min-h-[560px] bg-white">
              {HERO_SLIDES.map((slide, idx) => (
                <img
                  key={slide.src}
                  src={slide.src}
                  alt={slide.alt}
                  aria-hidden={idx !== heroSlideIndex}
                  className={`absolute inset-0 h-full w-full object-contain object-center transition-opacity duration-700 ${idx === heroSlideIndex ? 'opacity-100' : 'opacity-0'}`}
                />
              ))}

              <div className="absolute inset-x-0 bottom-1.5 sm:bottom-2 flex items-center justify-center gap-2">
                {HERO_SLIDES.map((slide, idx) => (
                  <button
                    key={slide.src}
                    type="button"
                    onClick={() => setHeroSlideIndex(idx)}
                    className={`h-2 rounded-full transition-all ${idx === heroSlideIndex ? 'w-7 bg-zinc-500' : 'w-2 bg-zinc-200 hover:bg-zinc-300'}`}
                    aria-label={`Показать слайд ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            <div className="lg:order-1 flex flex-col justify-center px-6 py-5 sm:p-8 lg:p-10 xl:p-12 bg-white lg:bg-[#f5f5f5]">
              <p className="mb-4 text-[10px] font-black uppercase tracking-[0.26em] text-zinc-400">
                Социальная AI-примерочная
              </p>

              <h1 className="max-w-[560px] text-[30px] leading-[0.98] tracking-[-0.055em] text-zinc-950 sm:text-5xl md:text-[56px] lg:text-[58px] font-black">
                Посмотрите на себя.
                <br />
                Потом решайте.
              </h1>

              <p className="mt-4 max-w-[460px] text-[14px] md:text-[17px] leading-6 md:leading-8 text-zinc-600">
                Примеряйте свои вещи и товары из разных магазинов, собирайте образы и спрашивайте мнение — до покупки.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:flex-row">
                <Link
                  to={user ? '/create-look' : '/auth'}
                  className="bg-zinc-950 text-white rounded-full px-4 py-3.5 sm:px-7 sm:py-4 text-[13px] sm:text-sm font-black text-center transition hover:opacity-90"
                >
                  Создать образ
                </Link>

                <Link
                  to="/catalog"
                  className="bg-white text-zinc-950 border border-zinc-200 rounded-full px-4 py-3.5 sm:px-7 sm:py-4 text-[13px] sm:text-sm font-black text-center transition hover:bg-zinc-100"
                >
                  Открыть каталог
                </Link>
              </div>


            </div>
          </div>
        </div>
      </section>

      <section className="px-4 mt-4 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-[24px] bg-zinc-50 border border-zinc-100 px-5 py-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">01</p>
            <h2 className="mt-3 text-base font-black">Примерьте на себе</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Соберите образ из своих вещей и товаров из каталога.</p>
          </div>

          <div className="rounded-[24px] bg-zinc-50 border border-zinc-100 px-5 py-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">02</p>
            <h2 className="mt-3 text-base font-black">Спросите мнение</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Покажите образ тем, кому доверяете, или опубликуйте его в ленте.</p>
          </div>

          <div className="rounded-[24px] bg-zinc-50 border border-zinc-100 px-5 py-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">03</p>
            <h2 className="mt-3 text-base font-black">Выберите уверенно</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Покупайте после примерки и обратной связи, а не наугад.</p>
          </div>
        </div>
      </section>

      <section className="px-4 mt-6 md:px-8 md:max-w-6xl md:mx-auto grid md:grid-cols-3 gap-4">
        <Link to="/create-look" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <ICONS.Plus className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black">AI-образ</h2>
          <p className="mt-2 text-sm text-zinc-500">Соберите образ из своих вещей и каталога и примерьте его на себе.</p>
        </Link>

        <Link to="/catalog" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <ICONS.Catalog className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black">Каталог</h2>
          <p className="mt-2 text-sm text-zinc-500">Выбирайте вещи у разных продавцов и добавляйте их в свой образ.</p>
        </Link>

        <Link to="/looks" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <ICONS.Looks className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black">Лента</h2>
          <p className="mt-2 text-sm text-zinc-500">Смотрите опубликованные образы, сохраняйте идеи и собирайте свои сочетания.</p>
        </Link>
      </section>

      {followingLooks.length ? (
        <section className="px-5 mt-12 md:px-8 md:max-w-6xl md:mx-auto">
          <div className="rounded-[32px] bg-zinc-900 text-white p-5 md:p-6 overflow-hidden">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/45">
                  Подписки
                </p>
                <h2 className="mt-2 text-2xl font-black uppercase">
                  Новое от ваших авторов
                </h2>
                <p className="mt-2 text-sm text-white/55 leading-relaxed max-w-xl">
                  Свежие примеряемые образы от людей, на которых вы подписаны.
                </p>
              </div>

              <Link
                to="/looks?tab=following"
                className="hidden sm:inline-flex text-xs font-black uppercase tracking-[0.2em] text-white/55 hover:text-white"
              >
                Смотреть все
              </Link>
            </div>

            <div className="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {followingLooks.slice(0, 6).map((look: any) => (
                <Link
                  key={look.id}
                  to={`/look/${look.id}`}
                  className="rounded-[22px] bg-white/10 border border-white/10 overflow-hidden transition hover:-translate-y-0.5 hover:bg-white/15"
                >
                  <div className="aspect-[3/4] bg-white/5">
                    {look.resultImageUrl ? (
                      <img
                        src={withApiOrigin(look.resultImageUrl)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="p-3">
                    <p className="text-[10px] font-black uppercase truncate">
                      {look.authorName || 'Автор'}
                    </p>
                    <p className="mt-1 text-[10px] text-white/45 font-bold truncate">
                      {look.likes || 0} ❤️ · {look.comments || 0} 💬
                    </p>
                  </div>
                </Link>
              ))}
            </div>

            <Link
              to="/looks?tab=following"
              className="mt-4 sm:hidden h-10 rounded-full bg-white text-zinc-900 text-[10px] font-black uppercase tracking-[0.16em] flex items-center justify-center"
            >
              Смотреть все
            </Link>
          </div>
        </section>
      ) : null}

      <section className="px-5 mt-12 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">Каталог</p>
            <h2 className="mt-2 text-2xl font-black uppercase">Новое в каталоге</h2>
          </div>
          <Link to="/catalog" className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
            Смотреть все
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {catalogItems.slice(0, 4).map((item: any) => {
            const image =
              Array.isArray(item.images) && item.images[0]
                ? item.images[0]
                : (item.imageUrl || item.image || item.imageSrc || item.mediaUrl || '');

            return (
              <Link key={item.id} to={`/product/${encodeURIComponent(item.id)}`} className="rounded-[24px] bg-zinc-50 border border-zinc-100 p-3">
                <div className="aspect-[3/4] bg-white rounded-[20px] overflow-hidden">
                  {image ? (
                    <img
                      src={catalogImageSrc(image, { w: 420 })}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  ) : null}
                </div>
                <p className="mt-3 text-[10px] font-black uppercase tracking-tight line-clamp-2">
                  {item.title || 'Товар'}
                </p>
                <p className="mt-1 text-xs font-bold text-zinc-500">
                  {Number(item.price || 0).toLocaleString('ru-RU')} ₽
                </p>
              </Link>
            );
          })}
        </div>
      </section>


      {dealItems.length ? (
        <section className="px-5 mt-12 md:px-8 md:max-w-6xl md:mx-auto">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">Выгодные цены</p>
              <h2 className="mt-2 text-2xl font-black uppercase">Выгодные находки</h2>
            </div>
            <Link to="/catalog" className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
              В каталог
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {dealItems.slice(0, 4).map((item: any) => {
              const image =
                Array.isArray(item.images) && item.images[0]
                  ? item.images[0]
                  : (item.imageUrl || item.image || item.imageSrc || item.mediaUrl || '');

              const price = Number(item.price || 0);
              const oldPrice = Number(item.oldPrice || 0);
              const discount =
                Number(item.discountPercent || 0) ||
                (oldPrice > price && price > 0 ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0);

              return (
                <Link key={item.id} to={`/product/${encodeURIComponent(item.id)}`} className="rounded-[24px] bg-zinc-50 border border-zinc-100 p-3">
                  <div className="relative aspect-[3/4] bg-white rounded-[20px] overflow-hidden">
                    {discount > 0 ? (
                      <div className="absolute left-2 top-2 z-10 rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-black text-white">
                        −{discount}%
                      </div>
                    ) : null}
                    {image ? (
                      <img
                        src={catalogImageSrc(image, { w: 420 })}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    ) : null}
                  </div>
                  <p className="mt-3 text-[10px] font-black uppercase tracking-tight line-clamp-2">
                    {item.title || 'Товар'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="text-xs font-black text-zinc-950">
                      {price.toLocaleString('ru-RU')} ₽
                    </p>
                    {oldPrice > price ? (
                      <p className="text-[10px] font-bold text-zinc-400 line-through">
                        {oldPrice.toLocaleString('ru-RU')} ₽
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {priceDropItems.length ? (
        <section className="px-5 mt-12 md:px-8 md:max-w-6xl md:mx-auto">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">Цена снизилась</p>
              <h2 className="mt-2 text-2xl font-black uppercase">Свежие снижения цены</h2>
            </div>
            <Link to="/catalog" className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
              В каталог
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {priceDropItems.slice(0, 4).map((item: any) => {
              const image =
                Array.isArray(item.images) && item.images[0]
                  ? item.images[0]
                  : (item.imageUrl || item.image || item.imageSrc || item.mediaUrl || '');

              const price = Number(item.currentPrice || item.price || 0);
              const previousPrice = Number(item.previousPrice || item.oldPrice || 0);
              const delta = Number(item.delta || (previousPrice > price && price > 0 ? previousPrice - price : 0));
              const deltaPct = Number(item.deltaPct || (previousPrice > price && price > 0 ? ((previousPrice - price) / previousPrice) * 100 : 0));
              const dropRub = Math.max(0, Math.round(delta));
              const discount = Math.max(0, Math.round(deltaPct));

              return (
                <Link key={item.id} to={`/product/${encodeURIComponent(item.id)}`} className="rounded-[24px] bg-zinc-50 border border-zinc-100 p-3">
                  <div className="relative aspect-[3/4] bg-white rounded-[20px] overflow-hidden">
                    {dropRub > 0 ? (
                      <div className="absolute left-2 top-2 z-10 rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-black text-white">
                        −{dropRub.toLocaleString('ru-RU')} ₽
                      </div>
                    ) : null}

                    {discount > 0 ? (
                      <div className="absolute right-2 top-2 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-black text-zinc-950 shadow-sm">
                        −{discount}%
                      </div>
                    ) : null}

                    {image ? (
                      <img
                        src={catalogImageSrc(image, { w: 420 })}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    ) : null}
                  </div>

                  <p className="mt-3 text-[10px] font-black uppercase tracking-tight line-clamp-2">
                    {item.title || 'Товар'}
                  </p>

                  {dropRub > 0 ? (
                    <p className="mt-1 text-[10px] font-black text-emerald-700">
                      Подешевело на {dropRub.toLocaleString('ru-RU')} ₽
                    </p>
                  ) : null}

                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="text-xs font-black text-zinc-950">
                      {price.toLocaleString('ru-RU')} ₽
                    </p>
                    {previousPrice > price ? (
                      <p className="text-[10px] font-bold text-zinc-400 line-through">
                        {previousPrice.toLocaleString('ru-RU')} ₽
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="px-5 mt-12 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">Лента</p>
            <h2 className="mt-2 text-2xl font-black uppercase">Образы из ленты</h2>
          </div>
          <Link to="/looks" className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
            В ленту
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {previewLooks.slice(0, 4).map((look: any) => (
            <Link key={look.id} to={`/look/${look.id}`} className="rounded-[24px] bg-zinc-50 border border-zinc-100 overflow-hidden">
              <div className="aspect-[3/4] bg-zinc-100">
                {look.resultImageUrl ? (
                  <img
                    src={withApiOrigin(look.resultImageUrl)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>
              <div className="p-3">
                <p className="text-[10px] font-black uppercase truncate">
                  {look.title || 'Образ'}
                </p>
                <p className="mt-1 text-[10px] text-zinc-400 font-bold">
                  {look.likes || 0} ❤️ · {look.comments || 0} 💬
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;
