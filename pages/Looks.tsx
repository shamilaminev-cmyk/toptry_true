import React from 'react';
import { useAppState } from '../store';
import { Link } from 'react-router-dom';
import { ICONS } from '../constants';
import { withApiOrigin } from '../utils/withApiOrigin';

const Looks = () => {
  const { looks, actions, user } = useAppState();
  const [tab, setTab] = React.useState<'feed' | 'mine'>('feed');
  const [feedLooks, setFeedLooks] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

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

  return (
    <div className="pb-12">
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
        <div className="p-4 grid grid-cols-2 gap-4">
          {visibleLooks.map((look: any) => (
            <div key={look.id} className="space-y-2 group">
              <Link
                to={`/look/${look.id}`}
                className="block relative aspect-[3/4] rounded-3xl overflow-hidden bg-zinc-100"
              >
                <img
                  src={withApiOrigin(look.resultImageUrl)}
                  alt=""
                  className="w-full h-full object-cover transition-all duration-700"
                />
                <div className="absolute top-3 right-3 flex flex-col gap-2">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      actions.likeLook(look.id);
                    }}
                    className="bg-white/80 backdrop-blur-sm p-2 rounded-full shadow-lg"
                  >
                    <ICONS.Heart className="w-4 h-4" />
                  </button>
                </div>
              </Link>

              <div className="px-1">
                <p className="text-[10px] font-bold uppercase tracking-wider truncate">
                  {look.title || 'Образ'}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <img
                      src={withApiOrigin(look.authorAvatar || user?.avatarUrl || user?.selfieUrl || '')}
                      alt=""
                      className="w-4 h-4 rounded-full bg-zinc-100"
                    />
                    <span className="text-[9px] text-zinc-400 font-bold uppercase truncate">
                      {look.authorName || 'toptry'}
                    </span>
                  </div>
                  <span className="text-[9px] text-zinc-400 font-bold uppercase">
                    {look.likes || 0} ❤️
                  </span>
                </div>
              </div>
            </div>
          ))}
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
