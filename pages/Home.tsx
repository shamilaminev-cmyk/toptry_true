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
    <div className="pb-28">
      <section className="px-5 pt-8 md:pt-14 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="rounded-[36px] bg-zinc-950 text-white overflow-hidden lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:min-h-[460px]">
          <div className="p-7 md:p-12 flex flex-col justify-between gap-10">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/45">
                AI virtual fitting
              </p>
              <h1 className="mt-5 text-4xl md:text-6xl font-black tracking-tight leading-[0.95]">
                Примерьте образ до покупки
              </h1>
              <p className="mt-5 text-sm md:text-base text-white/60 max-w-xl leading-relaxed">
                TopTry помогает выбрать вещи из каталога, собрать образ и увидеть, как он выглядит на вас.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to={user ? '/create-look' : '/auth'}
                className="bg-white text-zinc-950 rounded-full px-7 py-4 text-xs font-black uppercase tracking-[0.22em] text-center"
              >
                Создать образ
              </Link>
              <Link
                to="/catalog"
                className="bg-white/10 text-white rounded-full px-7 py-4 text-xs font-black uppercase tracking-[0.22em] text-center"
              >
                Открыть каталог
              </Link>
            </div>
          </div>

          <div className="relative min-h-[340px] sm:min-h-[420px] lg:min-h-0 bg-white/5 overflow-hidden">
            <div className="absolute inset-6 sm:inset-10 rounded-[32px] bg-gradient-to-br from-white/15 to-white/5 border border-white/10" />

            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="w-full max-w-sm rounded-[32px] bg-white text-zinc-950 shadow-2xl p-5 rotate-[-2deg]">
                <div className="aspect-[3/4] rounded-[24px] bg-zinc-100 flex items-center justify-center overflow-hidden">
                  <div className="text-center px-6">
                    <div className="text-6xl font-black leading-none">AI</div>
                    <div className="mt-3 text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">
                      примерка
                    </div>
                    <div className="mt-6 grid grid-cols-3 gap-2">
                      <span className="h-16 rounded-2xl bg-zinc-200" />
                      <span className="h-16 rounded-2xl bg-zinc-900" />
                      <span className="h-16 rounded-2xl bg-zinc-300" />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400">
                      Образ готов
                    </p>
                    <p className="mt-1 text-sm font-black uppercase">
                      3 вещи подобраны
                    </p>
                  </div>
                  <span className="w-12 h-12 rounded-full bg-zinc-950 text-white flex items-center justify-center text-xl">
                    ✓
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 mt-8 md:px-8 md:max-w-6xl md:mx-auto grid md:grid-cols-3 gap-4">
        <Link to="/create-look" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm">
          <ICONS.Plus className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black uppercase">AI-образ</h2>
          <p className="mt-2 text-sm text-zinc-500">Соберите look из вещей и примерьте его на себе.</p>
        </Link>

        <Link to="/catalog" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm">
          <ICONS.Catalog className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black uppercase">Каталог</h2>
          <p className="mt-2 text-sm text-zinc-500">Выбирайте одежду, обувь и аксессуары из каталога.</p>
        </Link>

        <Link to="/looks" className="rounded-[28px] border border-zinc-100 p-6 bg-white shadow-sm">
          <ICONS.Looks className="w-7 h-7" />
          <h2 className="mt-5 text-lg font-black uppercase">Лента</h2>
          <p className="mt-2 text-sm text-zinc-500">Смотрите опубликованные образы и сохраняйте идеи.</p>
        </Link>
      </section>

      <section className="px-5 mt-10 md:px-8 md:max-w-6xl md:mx-auto">
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

      <section className="px-5 mt-10 md:px-8 md:max-w-6xl md:mx-auto">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400">Social</p>
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
