import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CURRENCY } from '../constants';
import { withApiOrigin } from '../utils/withApiOrigin';

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || '';

const apiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path}`;
};

const formatRub = (value: any) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.round(n).toLocaleString('ru-RU')} ${CURRENCY}`;
};

const CollectionPreview: React.FC<{ looks: any[]; count: number }> = ({ looks, count }) => {
  const previewLooks = Array.isArray(looks) ? looks.slice(0, 4) : [];

  const renderImage = (look: any, className = '') => {
    const src = look?.resultImageUrl ? withApiOrigin(look.resultImageUrl) : '';

    return (
      <div className={`relative bg-zinc-100 overflow-hidden ${className}`}>
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover object-top" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] font-black uppercase tracking-[0.18em] text-zinc-300">
            TopTry
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative aspect-[4/3] bg-zinc-100 overflow-hidden">
      {previewLooks.length === 0 ? (
        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-400">
          Подборка
        </div>
      ) : previewLooks.length === 1 ? (
        renderImage(previewLooks[0], 'w-full h-full')
      ) : previewLooks.length === 2 ? (
        <div className="grid grid-cols-2 h-full gap-px bg-white">
          {renderImage(previewLooks[0], 'h-full')}
          {renderImage(previewLooks[1], 'h-full')}
        </div>
      ) : previewLooks.length === 3 ? (
        <div className="grid grid-cols-2 h-full gap-px bg-white">
          {renderImage(previewLooks[0], 'h-full')}
          <div className="grid grid-rows-2 gap-px">
            {renderImage(previewLooks[1], 'h-full')}
            {renderImage(previewLooks[2], 'h-full')}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 grid-rows-2 h-full gap-px bg-white">
          {previewLooks.map((look) => (
            <React.Fragment key={look.id}>
              {renderImage(look, 'h-full')}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-900 shadow-sm">
        {count} {count === 1 ? 'образ' : count > 1 && count < 5 ? 'образа' : 'образов'}
      </div>
    </div>
  );
};

const StorefrontLookCard: React.FC<{ look: any; onTry: (look: any) => void }> = ({ look, onTry }) => {
  const imageUrl = look?.resultImageUrl ? withApiOrigin(look.resultImageUrl) : '';
  const sourceItems = Array.isArray(look?.sourceItems) ? look.sourceItems : [];
  const priceText = formatRub(look?.priceBuyNowRUB);

  return (
    <article className="bg-white rounded-[28px] border border-zinc-100 overflow-hidden shadow-sm">
      <Link to={`/look/${look.id}`} className="block bg-zinc-100 aspect-[3/4] overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={look.title || 'Образ'} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs font-bold uppercase tracking-widest">
            Образ
          </div>
        )}
      </Link>

      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight line-clamp-2">
            {look.title || 'Образ TopTry'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <span>♥ {look.likes || 0}</span>
            <span>💬 {look.comments || 0}</span>
            <span>🔖 {look.saves || 0}</span>
            {priceText ? <span>{priceText}</span> : null}
          </div>
        </div>

        {sourceItems.length > 0 ? (
          <div className="flex -space-x-2">
            {sourceItems.slice(0, 5).map((item: any, idx: number) => {
              const src = item?.images?.[0] || item?.imageUrl || item?.cutoutImage || '';
              return (
                <div key={`${item?.id || idx}`} className="w-9 h-9 rounded-full bg-zinc-100 border-2 border-white overflow-hidden">
                  {src ? <img src={withApiOrigin(src)} alt="" className="w-full h-full object-cover" /> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTry(look)}
            disabled={!sourceItems.length}
            className="h-10 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.16em] disabled:opacity-40"
          >
            Примерить
          </button>
          <Link
            to={`/look/${look.id}`}
            className="h-10 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase tracking-[0.16em] flex items-center justify-center"
          >
            Смотреть
          </Link>
        </div>
      </div>
    </article>
  );
};

const UserStorefront: React.FC = () => {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<any | null>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [looks, setLooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr('');

      try {
        const resp = await fetch(apiUrl(`/api/users/public/${encodeURIComponent(String(slug || ''))}`), {
          credentials: 'include',
        });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          throw new Error(data?.error || `Ошибка ${resp.status}`);
        }

        if (cancelled) return;

        setProfile(data?.user || null);
        setCollections(Array.isArray(data?.collections) ? data.collections : []);
        setLooks(Array.isArray(data?.looks) ? data.looks : []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const publicUrl = useMemo(() => {
    const current = window.location.href;
    return current;
  }, []);

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: profile?.username || 'Витрина TopTry',
          text: 'Посмотрите примеряемые образы в TopTry',
          url: publicUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(publicUrl);
      alert('Ссылка скопирована');
    } catch {
      // ignore
    }
  };

  const tryLook = (look: any) => {
    const sourceItems = Array.isArray(look?.sourceItems) ? look.sourceItems.slice(0, 5) : [];

    if (!sourceItems.length) {
      navigate(`/look/${look.id}`);
      return;
    }

    navigate('/create-look', {
      state: {
        preselectedItems: sourceItems,
        fromLookId: look.id,
        fromCreatorUserId: profile?.id || look?.userId || '',
        fromCreatorSlug: profile?.publicSlug || slug || '',
        source: 'creator_storefront',
      },
    });
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-zinc-400 font-bold uppercase tracking-widest text-xs">
        Загрузка витрины...
      </div>
    );
  }

  if (err || !profile) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-2xl font-black tracking-tight">Витрина не найдена</h1>
        <p className="mt-3 text-sm text-zinc-500 max-w-md">
          {err || 'Пользователь не найден или ещё не публиковал образы.'}
        </p>
        <Link
          to="/looks"
          className="mt-6 h-11 px-6 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] flex items-center justify-center"
        >
          Перейти в ленту
        </Link>
      </div>
    );
  }

  const avatar = profile.avatarUrl ? withApiOrigin(profile.avatarUrl) : '';
  const displayName = profile.publicDisplayName || profile.username || 'Автор TopTry';

  return (
    <div className="px-4 py-6 md:py-10 pb-32 md:pb-36 max-w-6xl mx-auto space-y-8">
      <section className="relative overflow-hidden rounded-[36px] bg-zinc-900 text-white p-6 md:p-10">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-white/10 border border-white/15 overflow-hidden shrink-0">
              {avatar ? (
                <img src={avatar} alt="" className="w-full h-full object-cover object-top" />
              ) : null}
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">
                Витрина автора
              </p>
              <h1 className="mt-2 text-3xl md:text-5xl font-black tracking-tight">
                {displayName}
              </h1>

              {profile.publicBio ? (
                <p className="mt-3 text-sm md:text-base text-white/70 leading-relaxed max-w-2xl">
                  {profile.publicBio}
                </p>
              ) : (
                <p className="mt-3 text-sm md:text-base text-white/55 leading-relaxed max-w-2xl">
                  Автор собирает примеряемые образы в TopTry. Выберите образ и посмотрите, как он будет выглядеть на вас.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {profile.publicSocialUrl ? (
                  <a
                    href={profile.publicSocialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-4 rounded-full bg-white/10 text-white text-[10px] font-black uppercase tracking-[0.16em] flex items-center justify-center"
                  >
                    Соцсети автора
                  </a>
                ) : null}

                <button
                  type="button"
                  onClick={handleShare}
                  className="h-9 px-4 rounded-full bg-white text-zinc-900 text-[10px] font-black uppercase tracking-[0.16em]"
                >
                  Поделиться
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 md:min-w-[280px]">
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{looks.length}</div>
              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">образов</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{collections.length}</div>
              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">подборок</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">↗</div>
              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">примерка</div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
              Подборки
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">
              Коллекции автора
            </h2>
          </div>
        </div>

        {collections.length ? (
          <div className="grid md:grid-cols-3 gap-4">
            {collections.map((collection) => {
              const collectionLooks = Array.isArray(collection.looks) ? collection.looks : [];
              const count = collectionLooks.length;

              return (
                <article key={collection.id} className="rounded-[28px] overflow-hidden border border-zinc-100 bg-white shadow-sm">
                  <CollectionPreview looks={collectionLooks} count={count} />

                  <div className="p-4">
                    <h3 className="text-sm font-black uppercase tracking-tight">{collection.title}</h3>
                    {collection.description ? (
                      <p className="mt-2 text-xs text-zinc-500 leading-relaxed">{collection.description}</p>
                    ) : null}
                    <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
                      Открыть подборку
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] bg-zinc-50 border border-dashed border-zinc-200 p-6">
            <div className="text-sm font-black tracking-tight">
              Здесь будут подборки автора
            </div>
            <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-2xl">
              Скоро авторы смогут собирать образы в коллекции: офис, вечер, выходные, сезонные капсулы и подборки по стилю.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
            Образы
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">
            Примеряемые образы
          </h2>
        </div>

        {looks.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {looks.map((look) => (
              <StorefrontLookCard key={look.id} look={look} onTry={tryLook} />
            ))}
          </div>
        ) : (
          <div className="rounded-[28px] bg-zinc-50 border border-zinc-100 p-8 text-center">
            <h3 className="font-black tracking-tight">Пока нет опубликованных образов</h3>
            <p className="mt-2 text-sm text-zinc-500">
              Когда автор опубликует образы, они появятся на этой странице.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default UserStorefront;
