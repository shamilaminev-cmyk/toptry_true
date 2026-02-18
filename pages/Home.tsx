import React, { useState, useRef } from 'react';
import { useAppState } from '../store';
import { HomeLayout, SubscriptionTier } from '../types';
import { ICONS, CURRENCY } from '../constants';
import { Link } from 'react-router-dom';
import { withApiOrigin } from '../utils/withApiOrigin';

const Hero = () => {
  const { user, actions } = useAppState();
  const [showOptions, setShowOptions] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    try {
      setError(null);
      setShowOptions(false);
      setShowCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1350 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError('Не удалось получить доступ к камере');
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg');
        processAvatar(dataUrl);
        stopCamera();
      }
    }
  };
  const processAvatar = async (photoDataUrl: string) => {
    try {
      setError(null);
      setIsProcessing(true);

      const res = await fetch("/api/avatar/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoDataUrl }),
      });

      if (!res.ok) {
        let msg = "Не удалось обработать аватар";
        try {
          const j = await res.json();
          msg = j?.error || j?.message || msg;
        } catch {}
        throw new Error(msg);
      }

      const j = await res.json();
      const nextAvatarUrl =
        j?.avatarUrl ??
        j?.user?.avatarUrl ??
        j?.selfieUrl ??
        j?.user?.selfieUrl;

      actions.setSelfie(nextAvatarUrl || photoDataUrl);
      setShowOptions(false);
    } catch (e: any) {
      console.error("[avatar/process] error:", e);
      setError(e?.message || "Не удалось обработать аватар");
    } finally {
      setIsProcessing(false);
    }
  };


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        processAvatar(reader.result as string);
};
      reader.readAsDataURL(file);
    }
  };

  return (
    <section className="px-4 py-8 bg-zinc-50 rounded-b-[40px] mb-8 relative">
      <div className="max-w-md mx-auto text-center space-y-6">
        {(user?.avatarUrl || user?.selfieUrl) ? (
          <div className="space-y-4">
            <div className="group relative w-32 h-32 mx-auto">
              <div className="w-full h-full rounded-full border-4 border-white shadow-xl overflow-hidden bg-zinc-200">
                <img src={withApiOrigin(user.avatarUrl || user.selfieUrl)} alt="Your Selfie" className="w-full h-full object-cover object-top" />
              </div>
              <button
                onClick={() => setShowOptions(true)} disabled={isProcessing}
                className="absolute bottom-0 right-0 bg-zinc-900 text-white p-2 rounded-full shadow-lg hover:scale-110 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                </svg>
              </button>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Твой аватар готов</h1>
            <p className="text-zinc-500">Пора примерить новые образы из каталога или создать свои.</p>
            <div className="flex gap-2 justify-center">
              <Link
                to="/catalog"
                className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-sm hover:scale-105 transition-transform"
              >
                В каталог
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="w-20 h-20 mx-auto bg-zinc-200 rounded-3xl flex items-center justify-center">
              <ICONS.User className="w-10 h-10 text-zinc-400" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Примерь будущее прямо сейчас</h1>
            <p className="text-zinc-500">
              Загрузи одно селфи и получи полноценную 3D-примерочную для сотен брендов.
            </p>
            <button
              onClick={() => setShowOptions(true)}
              className="bg-zinc-900 text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-sm hover:scale-105 transition-transform"
            >
              Загрузить селфи
            </button>
          </div>
        )}

        {error && <p className="text-red-500 text-xs font-bold uppercase tracking-widest">{error}</p>}

        {isProcessing && <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Обрабатываем аватар…</p>}

        {/* Selection Modal */}
        {showOptions && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm bg-white rounded-[32px] p-6 space-y-4 animate-in slide-in-from-bottom duration-300">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold uppercase tracking-widest">Источник селфи</h3>
                <button onClick={() => setShowOptions(false)} className="text-zinc-400">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    ></path>
                  </svg>
                </button>
              </div>
              <button
                onClick={startCamera}
                className="w-full flex items-center gap-4 p-4 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-colors"
              >
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    ></path>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                    ></path>
                  </svg>
                </div>
                <span className="text-sm font-bold uppercase tracking-widest">Сделать фото</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-4 p-4 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-colors"
              >
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    ></path>
                  </svg>
                </div>
                <span className="text-sm font-bold uppercase tracking-widest">Загрузить файл</span>
              </button>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
            </div>
          </div>
        )}

        {/* Camera Modal */}
        {showCamera && (
          <div className="fixed inset-0 z-[70] bg-black flex flex-col items-center justify-center">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-x-0 bottom-12 flex items-center justify-center gap-8">
              <button
                onClick={stopCamera}
                className="w-14 h-14 bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
              <button
                onClick={capturePhoto}
                className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
              >
                <div className="w-16 h-16 border-4 border-zinc-900 rounded-full"></div>
              </button>
              <div className="w-14 h-14"></div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const Stats = () => {
  const { user } = useAppState();
  if (!user) return null;
  return (
    <div className="grid grid-cols-3 gap-2 px-4 mb-8">
      <div className="bg-zinc-100 p-4 rounded-2xl text-center">
        <p className="text-xs uppercase font-bold text-zinc-400 mb-1">Тариф</p>
        <p className="text-sm font-bold">{user.tier}</p>
      </div>
      <div className="bg-zinc-100 p-4 rounded-2xl text-center">
        <p className="text-xs uppercase font-bold text-zinc-400 mb-1">HD Try-on</p>
        <p className="text-sm font-bold">{user.limits.hdTryOnRemaining}</p>
      </div>
      <div className="bg-zinc-100 p-4 rounded-2xl text-center">
        <p className="text-xs uppercase font-bold text-zinc-400 mb-1">Образы</p>
        <p className="text-sm font-bold">{user.limits.looksRemaining}</p>
      </div>
    </div>
  );
};

const SectionHeader = ({ title, linkTo, linkText }: { title: string; linkTo: string; linkText: string }) => (
  <div className="flex items-center justify-between px-4 mb-4">
    <h2 className="text-lg font-bold uppercase tracking-wider">{title}</h2>
    <Link to={linkTo} className="text-xs font-bold uppercase text-zinc-400 flex items-center gap-1">
      {linkText} <ICONS.ArrowRight className="w-3 h-3" />
    </Link>
  </div>
);

const Dashboard = () => {
  const { products, wardrobe, looks } = useAppState();
  const USE_MOCK_HOME_CATALOG = true;

  const mockHomeProducts: any[] = [
    { id: "home-mock-001", title: "Блейзер прямого кроя", price: 12990, images: ["/mock/items/blazer.jpg"], storeName: "ZARA" },
    { id: "home-mock-002", title: "Пальто шерстяное", price: 24990, images: ["/mock/items/coat.jpg"], storeName: "MASSIMO DUTTI" },
    { id: "home-mock-003", title: "Куртка бомбер", price: 15990, images: ["/mock/items/bomber.jpg"], storeName: "H&M" },
    { id: "home-mock-004", title: "Джинсы straight", price: 7990, images: ["/mock/items/jeans.jpg"], storeName: "UNIQLO" },
    { id: "home-mock-005", title: "Брюки классические", price: 9990, images: ["/mock/items/trousers.jpg"], storeName: "COS" },
    { id: "home-mock-006", title: "Платье миди", price: 11990, images: ["/mock/items/dress.jpg"], storeName: "MANGO" },
  ];

  const homeCatalog = USE_MOCK_HOME_CATALOG ? mockHomeProducts : products;

  const recentProducts = homeCatalog.slice(0, 4);
  const saleProducts = homeCatalog.slice(2, 6);
  const recentWardrobe = wardrobe.slice(0, 4);
  const trendingLooks = looks.slice(0, 4);

  return (
    <div className="space-y-10 pb-12">
      <Hero />
      <Stats />

      {/* ADDED: Create Look Shortcut on Main Page */}
      <section className="px-4">
        <Link to="/create-look" className="block relative bg-zinc-900 rounded-[32px] p-8 overflow-hidden group shadow-2xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-[100px] -translate-y-1/2 translate-x-1/2 group-hover:bg-white/20 transition-all duration-700"></div>
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-full border border-white/20">
              <span className="w-2 h-2 bg-white/60 rounded-full animate-pulse"></span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">AI Try-On</span>
            </div>
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter leading-none">Сгенерировать образ</h2>
            <p className="text-zinc-400 text-xs uppercase font-bold tracking-widest">Виртуальная примерка из вашего шкафа</p>
            <div className="flex items-center gap-4 pt-2">
              <span className="bg-white text-zinc-900 w-12 h-12 flex items-center justify-center rounded-full group-hover:scale-110 transition-transform">
                <ICONS.Plus className="w-6 h-6" />
              </span>
              <span className="text-white text-xs font-bold uppercase tracking-widest">Начать примерку</span>
            </div>
          </div>
        </Link>
      </section>

      <section>
        <SectionHeader title="Последние образы" linkTo="/looks" linkText="Все" />
        <div className="flex gap-4 overflow-x-auto px-4 no-scrollbar">
          {trendingLooks.map((look) => (
            <Link key={look.id} to={`/look/${look.id}`} className="flex-shrink-0 w-40 space-y-2">
              <div className="aspect-[3/4] rounded-2xl bg-zinc-100 overflow-hidden">
                <img
                  src={withApiOrigin(look.resultImageUrl)}
                  alt=""
                  className="w-full h-full object-cover hover:scale-110 transition-all duration-500"
                />
              </div>
              <p className="text-xs font-medium truncate">{look.title}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Мой шкаф" linkTo="/wardrobe" linkText="В шкаф" />
        <div className="grid grid-cols-2 gap-4 px-4">
          {recentWardrobe.length > 0 ? (
            recentWardrobe.map((item) => (
              <div key={item.id} className="aspect-square bg-zinc-100 rounded-2xl overflow-hidden p-4 border border-zinc-200">
                <img
                  src={withApiOrigin(item.images?.[0])}
                  alt=""
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              </div>
            ))
          ) : (
            <div className="col-span-2 bg-zinc-50 border border-zinc-100 border-dashed rounded-2xl py-8 px-4 text-center">
              <p className="text-sm text-zinc-400 mb-4 italic">В шкафу пока пусто</p>
              <div className="flex gap-2 justify-center">
                <Link
                  to="/catalog"
                  className="text-[10px] font-bold uppercase tracking-widest bg-zinc-900 text-white px-4 py-2 rounded-full"
                >
                  Из каталога
                </Link>
                <button className="text-[10px] font-bold uppercase tracking-widest border border-zinc-900 px-4 py-2 rounded-full">
                  Загрузить свое
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeader title="Новое в каталоге" linkTo="/catalog" linkText="Смотреть" />
        <div className="grid grid-cols-2 gap-4 px-4">
          {recentProducts.map((p) => (
            <div key={p.id} className="space-y-2">
              <div className="aspect-[4/5] bg-zinc-50 rounded-2xl overflow-hidden p-6 border border-zinc-100">
                <img
                  src={withApiOrigin(p.images?.[0])}
                  alt=""
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              </div>
              <div className="px-1">
                <p className="text-xs font-bold truncate uppercase">{p.title}</p>
                <p className="text-xs text-zinc-400">
                  {p.price} {CURRENCY}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ADDED: Discounts Section */}
      <section>
        <SectionHeader title="Скидки" linkTo="/catalog" linkText="Все акции" />
        <div className="grid grid-cols-2 gap-4 px-4">
          {saleProducts.map((p, idx) => (
            <div key={p.id} className="space-y-2">
              <div className="relative aspect-[4/5] bg-zinc-50 rounded-2xl overflow-hidden p-6 border border-zinc-100">
                <div className="absolute top-3 left-3 bg-zinc-900 text-white px-2 py-1 rounded text-[8px] font-black uppercase tracking-tighter">
                  SALE -{20 + idx * 5}%
                </div>
                <img
                  src={withApiOrigin(p.images?.[0])}
                  alt=""
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              </div>
              <div className="px-1">
                <p className="text-xs font-bold truncate uppercase">{p.title}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-black text-zinc-900">
                    {Math.round(p.price * 0.7)} {CURRENCY}
                  </p>
                  <p className="text-[10px] text-zinc-400 line-through">
                    {p.price} {CURRENCY}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const Feed = () => {
  const { actions, user } = useAppState();
  const [tab, setTab] = React.useState<'trending' | 'following' | 'new'>('trending');
  const [feedLooks, setFeedLooks] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Demo public feed (used when public endpoints are empty/unavailable)
  const USE_MOCK_PUBLIC_FEED = true;
  const mockPublicLooks: any[] = [
    {
      id: "mock-feed-001",
      authorName: "style.daily",
      authorAvatar: "/mock/placeholder.svg",
      resultImageUrl: "/mock/looks/feed-1.jpg",
      likes: 124,
      comments: 12,
      aiDescription: "Базовый образ на каждый день. 3 вещи • 34 970 ₽",
      createdAt: new Date(),
    },
    {
      id: "mock-feed-002",
      authorName: "minimal.mood",
      authorAvatar: "/mock/placeholder.svg",
      resultImageUrl: "/mock/looks/feed-2.jpg",
      likes: 88,
      comments: 7,
      aiDescription: "Капсула в стиле минимализм. 4 вещи • 52 990 ₽",
      createdAt: new Date(),
    },
    {
      id: "mock-feed-003",
      authorName: "moscow.fit",
      authorAvatar: "/mock/placeholder.svg",
      resultImageUrl: "/mock/looks/feed-3.jpg",
      likes: 203,
      comments: 19,
      aiDescription: "Уличный casual. 2 вещи • 27 990 ₽",
      createdAt: new Date(),
    },
    {
      id: "mock-feed-004",
      authorName: "capsule.club",
      authorAvatar: "/mock/placeholder.svg",
      resultImageUrl: "/mock/looks/feed-4.jpg",
      likes: 61,
      comments: 3,
      aiDescription: "Собранный smart casual. 5 вещей • 79 990 ₽",
      createdAt: new Date(),
    },
  ];

  const isPublicTab = tab === 'trending' || tab === 'new';
  const showMock = USE_MOCK_PUBLIC_FEED && isPublicTab && !loading && feedLooks.length === 0;
  const visibleLooks = (showMock ? mockPublicLooks : feedLooks) as any[];

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const url =
          tab === 'following'
            ? '/api/feed/following'
            : `/api/looks/public?sort=${tab === 'new' ? 'new' : 'trending'}`;
        const resp = await fetch(url);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          setFeedLooks([]);
          return;
        }
        const raw = Array.isArray(data?.looks) ? data.looks : [];
        setFeedLooks(raw.map((l: any) => ({ ...l, createdAt: new Date(l.createdAt) })));
      } catch {
        setFeedLooks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, user?.id]);

  return (
    <div className="p-4 space-y-8">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2">
        <button
          onClick={() => setTab('trending')}
          className={`flex-shrink-0 px-6 py-2 rounded-full border text-xs font-bold uppercase tracking-widest transition-all ${
            tab === 'trending' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 hover:bg-zinc-900 hover:text-white'
          }`}
        >
          Тренды
        </button>
        <button
          onClick={() => setTab('new')}
          className={`flex-shrink-0 px-6 py-2 rounded-full border text-xs font-bold uppercase tracking-widest transition-all ${
            tab === 'new' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 hover:bg-zinc-900 hover:text-white'
          }`}
        >
          Новое
        </button>
        <button
          onClick={() => setTab('following')}
          className={`flex-shrink-0 px-6 py-2 rounded-full border text-xs font-bold uppercase tracking-widest transition-all ${
            tab === 'following' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 hover:bg-zinc-900 hover:text-white'
          }`}
        >
          Подписки
        </button>
      </div>

      {loading && <div className="py-10 text-center text-xs text-zinc-400 uppercase tracking-widest">Загрузка...</div>}

      {/* Empty state for following */}
      {!loading && tab === 'following' && feedLooks.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-xs text-zinc-400 uppercase tracking-widest">Пока нет постов в подписках</p>
          <p className="mt-2 text-[11px] text-zinc-500">Переключись на «Тренды» или «Новое», чтобы посмотреть ленту.</p>
        </div>
      )}

      {/* Demo hint */}
      {showMock && (
        <div className="px-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-zinc-900"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Демо-лента (публичные образы появятся после запуска)
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
        {['Мужское', 'Женское', 'Тренды', 'Распродажа', 'Бренды'].map((cat) => (
          <button
            key={cat}
            className="flex-shrink-0 px-6 py-2 rounded-full border border-zinc-200 text-xs font-bold uppercase tracking-widest hover:bg-zinc-900 hover:text-white transition-all"
          >
            {cat}
          </button>
        ))}
      </div>

      {visibleLooks.map((look: any) => (
        <article key={look.id} className="space-y-4 border-b border-zinc-100 pb-8 last:border-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-100 overflow-hidden">
                <img src={withApiOrigin(look.authorAvatar)} alt="" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-sm font-bold">{look.authorName}</p>
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide">2 часа назад</p>
              </div>
            </div>
            <button className="p-2 text-zinc-400">
              <ICONS.Share className="w-5 h-5" />
            </button>
          </div>

          <Link to={`/look/${look.id}`} className="block relative aspect-[4/5] rounded-[32px] overflow-hidden bg-zinc-100">
            <img src={withApiOrigin(look.resultImageUrl)} alt="" className="w-full h-full object-cover" />
            <div className="absolute bottom-4 left-4 right-4 flex gap-2">
              <button className="flex-1 bg-white/90 backdrop-blur py-3 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg">
                Примерить
              </button>
              <button className="bg-zinc-900 text-white w-12 h-12 flex items-center justify-center rounded-full shadow-lg">
                <ICONS.ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </Link>

          <div className="flex items-center gap-6 px-1">
            <button onClick={() => actions.likeLook(look.id)} className="flex items-center gap-2 group">
              <ICONS.Heart className="w-6 h-6 group-active:scale-125 transition-transform" />
              <span className="text-sm font-bold">{look.likes}</span>
            </button>
            <button className="flex items-center gap-2">
              <ICONS.Message className="w-6 h-6" />
              <span className="text-sm font-bold">{look.comments}</span>
            </button>
          </div>

          <div className="px-1">
            <p className="text-sm">
              <span className="font-bold mr-2">{look.authorName}</span>
              {look.aiDescription || look.userDescription || 'Образ — в ленте. Открой, чтобы посмотреть детали и ссылки.'}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
};

const Home = () => {
  const { homeLayout, actions } = useAppState();

  return (
    <div>
      <div className="px-4 pt-4 flex justify-end">
        <button
          onClick={actions.toggleHomeLayout}
          className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          {homeLayout === HomeLayout.DASHBOARD ? 'Переключить на ленту' : 'Переключить на дашборд'}
        </button>
      </div>

      {homeLayout === HomeLayout.DASHBOARD ? <Dashboard /> : <Feed />}
    </div>
  );
};

export default Home;
