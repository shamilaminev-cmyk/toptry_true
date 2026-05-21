import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ICONS } from '../constants';
import { useAppState } from '../store';
import { withApiOrigin } from '../utils/withApiOrigin';
import { catalogImageSrc } from '../utils/catalogImageSrc';

const Home: React.FC = () => {
  const { user, looks } = useAppState();
  const [feedLooks, setFeedLooks] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/looks/public?limit=4', { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        setFeedLooks(Array.isArray(data?.looks) ? data.looks : []);
      } catch {
        setFeedLooks([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/catalog/products?merchant=rendezvous&limit=8');
        const data = await resp.json().catch(() => ({}));
        setCatalogItems(Array.isArray(data?.products) ? data.products : []);
      } catch {
        setCatalogItems([]);
      }
    })();
  }, []);

  const previewLooks = useMemo(() => {
    return feedLooks.length ? feedLooks : looks.slice(0, 4);
  }, [feedLooks, looks]);

  return (
    <div className="pb-56">
      <section className="px-5 pt-3 md:pt-5 md:px-8 md:max-w-7xl md:mx-auto">
        <div className="relative overflow-hidden rounded-[32px] border border-zinc-200 bg-[#f5f5f5]">
          <div className="grid lg:grid-cols-[470px_minmax(0,1fr)] items-center">
            <div className="relative z-10 p-6 md:p-8 lg:p-9">
              <p className="mb-4 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                Виртуальная примерочная
              </p>

              <h1 className="max-w-[500px] text-4xl leading-[0.96] tracking-[-0.05em] text-zinc-950 md:text-6xl lg:text-[58px] font-black">
                Посмотри на себя.
                <br />
                Потом решай.
              </h1>

              <p className="mt-5 max-w-[455px] text-base md:text-[16px] leading-8 text-zinc-600">
                Примеряйте вещи на своём аватаре, сравнивайте варианты
                и заказывайте только то, в чём уверены.
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Link
                  to={user ? '/create-look' : '/auth'}
                  className="bg-zinc-950 text-white rounded-full px-7 py-4 text-sm font-black text-center transition hover:opacity-90"
                >
                  Создать образ
                </Link>

                <Link
                  to="/catalog"
                  className="bg-white text-zinc-950 border border-zinc-200 rounded-full px-7 py-4 text-sm font-black text-center transition hover:bg-zinc-100"
                >
                  Открыть каталог
                </Link>
              </div>

            </div>

            <div className="relative min-h-[280px] sm:min-h-[370px] lg:min-h-[480px]">
              <img
                src="/hero-toptry-v4.webp"
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-[#f5f5f5] via-transparent to-transparent lg:hidden" />
              <div className="hidden lg:block absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-[#f5f5f5] to-transparent" />
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 mt-5 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-[24px] bg-zinc-50 border border-zinc-100 px-5 py-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">01</p>
            <h2 className="mt-3 text-base font-black">Примерьте на себе</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Загрузите аватар и посмотрите, как вещь выглядит именно на вас.</p>
          </div>

          <div className="rounded-[24px] bg-zinc-50 border border-zinc-100 px-5 py-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">02</p>
            <h2 className="mt-3 text-base font-black">Сравните варианты</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Соберите несколько образов и спокойно сравните их между собой.</p>
          </div>

          <div className="rounded-[24px] bg-zinc-50 border border-zinc-100 px-5 py-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">03</p>
            <h2 className="mt-3 text-base font-black">Выберите уверенно</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Заказывайте только те вещи, которые прошли вашу личную проверку.</p>
          </div>
        </div>
      </section>

      <section className="px-5 mt-6 md:px-8 md:max-w-6xl md:mx-auto grid md:grid-cols-3 gap-4">
        <Link to="/create-look" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <ICONS.Plus className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black">AI-образ</h2>
          <p className="mt-2 text-sm text-zinc-500">Соберите образ из вещей и примерьте его на себе.</p>
        </Link>

        <Link to="/catalog" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <ICONS.Catalog className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black">Каталог</h2>
          <p className="mt-2 text-sm text-zinc-500">Выбирайте одежду, обувь и аксессуары из каталога.</p>
        </Link>

        <Link to="/looks" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <ICONS.Looks className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black">Лента</h2>
          <p className="mt-2 text-sm text-zinc-500">Смотрите опубликованные образы и сохраняйте идеи.</p>
        </Link>
      </section>

      <section className="px-5 mt-12 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">Каталог</p>
            <h2 className="mt-2 text-2xl font-black uppercase">Новые вещи</h2>
          </div>
          <Link to="/catalog" className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
            Смотреть все
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {catalogItems.slice(0, 4).map((item: any) => (
            <Link key={item.id} to="/catalog" className="rounded-[24px] bg-zinc-50 border border-zinc-100 p-3">
              <div className="aspect-[3/4] bg-white rounded-[20px] overflow-hidden">
                {item.imageUrl ? (
                  <img
                    src={catalogImageSrc(item.imageUrl)}
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
          ))}
        </div>
      </section>

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
