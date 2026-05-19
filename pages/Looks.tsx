import React from 'react';
import { useAppState } from '../store';
import { Link, useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';
import { withApiOrigin } from '../utils/withApiOrigin';

const CommentIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 17 0Z" />
  </svg>
);

const formatPriceRUB = (value: any) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 ₽';
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
};

const Looks = () => {
  const { looks, actions, user } = useAppState();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<'feed' | 'mine'>('feed');
  const [feedLooks, setFeedLooks] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [likedPulseIds, setLikedPulseIds] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (tab !== 'feed') return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const resp = await fetch('/api/looks/public?limit=50', { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));

        if (cancelled) return;

        const raw = Array.isArray(data?.looks) ? data.looks : Array.isArray(data) ? data : [];
        setFeedLooks(raw.map((l: any) => ({ ...l, createdAt: l?.createdAt ? new Date(l.createdAt) : new Date() })));
      } catch {
        if (!cancelled) setFeedLooks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, user?.id]);

  const visibleLooks = tab === 'mine' ? looks : feedLooks;

  const handleLikeFromFeed = async (lookId: string) => {
    setLikedPulseIds((prev) => ({ ...prev, [lookId]: true }));
    window.setTimeout(() => {
      setLikedPulseIds((prev) => ({ ...prev, [lookId]: false }));
    }, 520);

    try {
      const resp = await fetch(`/api/looks/${encodeURIComponent(lookId)}/like`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) return;

      setFeedLooks((prev) =>
        prev.map((l) =>
          String(l.id) === String(lookId)
            ? { ...l, likes: data?.likes ?? ((l.likes || 0) + 1), viewerLiked: true }
            : l
        )
      );

      actions.likeLook(lookId);
    } catch {
      // ignore
    }
  };

  const openComments = (lookId: string) => {
    navigate(`/look/${lookId}?comments=1`);
  };

  return (
    <div className="pb-12">
      <style id="toptry-feed-desktop-css">{`
        @media (min-width: 900px) {
          .toptry-feed-list {
            max-width: 1180px;
            margin-left: auto;
            margin-right: auto;
            padding: 32px 24px;
            display: flex;
            flex-direction: column;
            gap: 48px;
          }
          .toptry-feed-card {
            display: grid;
            grid-template-columns: minmax(420px, 560px) minmax(360px, 1fr);
            gap: 32px;
            align-items: start;
          }
          .toptry-feed-image-link {
            height: min(760px, calc(100vh - 220px));
            min-height: 560px;
            max-width: 560px;
            margin-left: auto;
            aspect-ratio: auto;
          }
          .toptry-feed-image {
            object-fit: contain;
          }
          .toptry-feed-side {
            display: flex !important;
            flex-direction: column;
            justify-content: space-between;
            min-height: min(760px, calc(100vh - 220px));
            position: sticky;
            top: 112px;
          }
          .toptry-feed-mobile-meta {
            display: none !important;
          }
        }
      `}</style>
      <div className="p-4 sticky top-0 bg-white z-40 border-b border-zinc-100 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold uppercase tracking-tighter">
            {tab === 'feed' ? 'Лента образов' : 'Мои образы'}
          </h1>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setTab('feed')}
            className={`px-5 h-10 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${
              tab === 'feed'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-500 border-zinc-200'
            }`}
          >
            Лента
          </button>
          <button
            onClick={() => setTab('mine')}
            className={`px-5 h-10 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${
              tab === 'mine'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-500 border-zinc-200'
            }`}
          >
            Мои
          </button>
        </div>
      </div>

      {loading && tab === 'feed' && (
        <div className="py-10 text-center text-xs text-zinc-400 uppercase tracking-widest">
          Загрузка...
        </div>
      )}

      {!loading && visibleLooks.length === 0 && (
        <div className="px-4 py-16 text-center">
          <div className="bg-zinc-50 border border-zinc-100 rounded-[32px] p-8 space-y-4">
            <h3 className="text-lg font-bold uppercase tracking-widest">
              {tab === 'feed' ? 'Пока нет публичных образов' : 'У вас пока нет образов'}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed uppercase tracking-wider">
              {tab === 'feed'
                ? 'Сгенерируйте и опубликуйте первые образы, чтобы наполнить ленту.'
                : 'Создайте первый образ и он появится здесь.'}
            </p>
            <Link
              to="/create-look"
              className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest"
            >
              Создать образ
            </Link>
          </div>
        </div>
      )}

      {visibleLooks.length > 0 && (
        <div className="toptry-feed-list px-4 py-5 space-y-8 md:px-6 md:py-8 md:max-w-6xl md:mx-auto">
          {visibleLooks.map((look: any) => {
            const sourceItems = Array.isArray(look.sourceItems) ? look.sourceItems : [];
            const totalPrice =
              Number(look.priceBuyNowRUB || 0) ||
              sourceItems.reduce((sum: number, item: any) => sum + (Number(item?.price || 0) || 0), 0);

            return (
              <article
                key={look.id}
                className="toptry-feed-card group md:grid md:grid-cols-2 md:gap-8 md:items-start"
              >
                <Link
                  to={`/look/${look.id}`}
                  className="toptry-feed-image-link block relative aspect-[3/4] rounded-[32px] overflow-hidden bg-zinc-100 md:h-[calc(100vh-220px)] md:min-h-[560px] md:max-h-[760px] md:aspect-auto md:border md:border-zinc-100 md:max-w-[560px] md:ml-auto"
                >
                  <img
                    src={withApiOrigin(look.resultImageUrl)}
                    alt=""
                    className="toptry-feed-image w-full h-full object-cover md:object-contain transition-all duration-700"
                  />
                  <div className="absolute top-4 right-4 flex flex-col gap-2 md:flex-row">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleLikeFromFeed(String(look.id));
                      }}
                      className={`bg-white/85 backdrop-blur-sm p-2 rounded-full shadow-lg transition-all duration-300 ${
                        likedPulseIds[String(look.id)] ? 'scale-125 bg-zinc-900 text-white ring-4 ring-white/70' : ''
                      }`}
                      aria-label="Лайкнуть образ"
                    >
                      <ICONS.Heart className={`w-4 h-4 transition-transform duration-300 ${
                        likedPulseIds[String(look.id)] ? 'scale-125' : ''
                      }`} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        openComments(String(look.id));
                      }}
                      className="bg-white/85 backdrop-blur-sm p-2 rounded-full shadow-lg transition-all duration-300 hover:scale-110"
                      aria-label="Открыть комментарии"
                    >
                      <CommentIcon className="w-4 h-4" />
                    </button>
                  </div>
                </Link>

                <div className="toptry-feed-side pt-4 md:pt-2 md:sticky md:top-28 md:space-y-8">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl md:text-3xl font-black uppercase tracking-tight leading-none">
                        {look.title || 'Сгенерированный образ'}
                      </h2>
                      <div className="flex items-center gap-2 mt-3">
                        {(look.authorAvatar || user?.avatarUrl || user?.selfieUrl) ? (
                          <img
                            src={withApiOrigin(look.authorAvatar || user?.avatarUrl || user?.selfieUrl || '')}
                            alt=""
                            className="w-5 h-5 rounded-full bg-zinc-100 object-cover object-top"
                          />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-zinc-100 inline-block" />
                        )}
                        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
                          {look.authorName || 'Пользователь TopTry'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm font-bold whitespace-nowrap">
                      <button
                        onClick={() => handleLikeFromFeed(String(look.id))}
                        className="flex items-center gap-1.5 transition-transform hover:scale-110"
                      >
                        <ICONS.Heart className="w-5 h-5" /> {look.likes || 0}
                      </button>
                      <button
                        onClick={() => openComments(String(look.id))}
                        className="flex items-center gap-1.5 transition-transform hover:scale-110"
                      >
                        <CommentIcon className="w-5 h-5" /> {look.comments || 0}
                      </button>
                    </div>
                  </div>

                  {sourceItems.length > 0 && (
                    <section className="hidden md:block space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-400">
                        Вещи в образе
                      </h3>
                      <div className="space-y-3">
                        {sourceItems.slice(0, 3).map((item: any, idx: number) => {
                          const buyUrl = item?.affiliateUrl || item?.productUrl || '';
                          const imageUrl = Array.isArray(item?.images) ? item.images[0] : item?.imageUrl;

                          return (
                            <div
                              key={item?.id || idx}
                              className="flex items-center gap-4 bg-zinc-50 p-3 rounded-2xl border border-zinc-100"
                            >
                              <div className="w-14 h-14 bg-white rounded-xl p-2 border border-zinc-200 shrink-0">
                                {imageUrl ? (
                                  <img
                                    src={withApiOrigin(imageUrl)}
                                    alt=""
                                    className="w-full h-full object-contain mix-blend-multiply"
                                  />
                                ) : null}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold uppercase tracking-tight truncate">
                                  {item?.title || 'Вещь'}
                                </h4>
                                <p className="text-sm font-bold mt-0.5">
                                  {formatPriceRUB(item?.price)}
                                </p>
                              </div>
                              {buyUrl ? (
                                <a
                                  href={buyUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-zinc-900 text-white px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest"
                                >
                                  Купить
                                </a>
                              ) : (
                                <span className="bg-zinc-200 text-zinc-400 px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest">
                                  Нет ссылки
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  <div className="hidden md:flex items-center justify-between gap-4 bg-zinc-900 text-white rounded-3xl p-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.25em] text-white/50 font-bold">
                        Купить всё
                      </p>
                      <p className="text-lg font-black">{formatPriceRUB(totalPrice)}</p>
                    </div>
                    <Link
                      to={`/look/${look.id}`}
                      className="bg-white text-zinc-900 px-7 py-3 rounded-full text-xs font-black uppercase tracking-widest"
                    >
                      Открыть
                    </Link>
                  </div>

                  <div className="toptry-feed-mobile-meta md:hidden px-1 mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider truncate">
                      {look.title || 'Образ'}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[9px] text-zinc-400 font-bold uppercase truncate">
                        {look.authorName || 'Пользователь TopTry'}
                      </span>
                      <button
                        onClick={() => openComments(String(look.id))}
                        className="text-[9px] text-zinc-400 font-bold uppercase hover:text-zinc-900 transition-colors"
                      >
                        {look.likes || 0} ❤️ · {look.comments || 0} 💬
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="px-4 py-8">
        <div className="bg-zinc-100 rounded-[32px] p-8 text-center space-y-4">
          <h3 className="text-lg font-bold uppercase tracking-widest">Стань трендсеттером</h3>
          <p className="text-xs text-zinc-400 leading-relaxed uppercase tracking-wider">
            Создавай свои образы и попадай в ленту рекомендаций.
          </p>
          <Link
            to="/create-look"
            className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest"
          >
            Начать
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Looks;
