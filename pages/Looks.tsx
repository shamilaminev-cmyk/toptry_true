import React from 'react';
import { useAppState } from '../store';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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

function authorStorefrontRoute(look: any) {
  const slug = String(look?.authorSlug || look?.userId || '').trim();
  return slug ? `/u/${encodeURIComponent(slug)}` : '';
}


function sourceItemClickoutUrl(item: any, placement: string, lookId?: string, itemIndex?: number) {
  const id = String(item?.id || '').trim();
  if (!id) return '';
  const params = new URLSearchParams({ placement });
  if (lookId) params.set('lookId', String(lookId));
  if (typeof itemIndex === 'number') params.set('itemIndex', String(itemIndex));
  return withApiOrigin(`/api/out/product/${encodeURIComponent(id)}?${params.toString()}`);
}

function similarCatalogRoute(item: any) {
  const rawText = [
    item?.title,
    item?.brand,
    item?.category,
    item?.displayCategory,
    item?.taxonomyGroup,
    item?.taxonomySubgroup,
    item?.colorFamily,
    item?.color,
    item?.storeName,
    item?.merchant,
  ]
    .filter(Boolean)
    .map(String)
    .join(' ')
    .toLowerCase();

  const params = new URLSearchParams();
  params.set('unavailable', '1');

  const normalizeGender = (value: any) => {
    const s = String(value || '').trim().toUpperCase();
    if (s === 'MALE' || s === 'FEMALE') return s;

    const hay = [
      value,
      item?.title,
      item?.category,
      item?.gender,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();

    if (/муж|male|men|man/.test(hay)) return 'MALE';
    if (/жен|female|women|woman|girl/.test(hay)) return 'FEMALE';

    return '';
  };

  const normalizeColor = (value: any) => {
    const s = String(value || '').trim().toLowerCase();

    const map: Record<string, string> = {
      black: 'black',
      white: 'white',
      gray: 'gray',
      grey: 'gray',
      silver: 'gray',
      beige: 'beige',
      brown: 'brown',
      blue: 'blue',
      green: 'green',
      red: 'red',
      pink: 'pink',
      purple: 'purple',
      yellow: 'yellow',
      gold: 'yellow',
      orange: 'orange',
      multi: 'multi',
      khaki: 'green',
    };

    if (map[s]) return map[s];

    const hay = [
      value,
      item?.title,
      item?.color,
      item?.colorFamily,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();

    if (/черн|чёрн|black/.test(hay)) return 'black';
    if (/бел|white/.test(hay)) return 'white';
    if (/сер|gray|grey|silver/.test(hay)) return 'gray';
    if (/беж|beige/.test(hay)) return 'beige';
    if (/корич|brown/.test(hay)) return 'brown';
    if (/син|голуб|blue/.test(hay)) return 'blue';
    if (/зел|green|khaki/.test(hay)) return 'green';
    if (/крас|бордов|red/.test(hay)) return 'red';
    if (/роз|pink/.test(hay)) return 'pink';
    if (/фиолет|сирен|purple/.test(hay)) return 'purple';
    if (/желт|жёлт|yellow|gold/.test(hay)) return 'yellow';
    if (/оранж|orange/.test(hay)) return 'orange';
    if (/мульти|разноцвет|multi/.test(hay)) return 'multi';

    return '';
  };

  const gender = normalizeGender(item?.gender);
  const colorFamily = normalizeColor(item?.colorFamily || item?.color);

  if (gender) params.set('gender', gender);
  if (colorFamily) params.set('colorFamily', colorFamily);

  const setClothing = (clothingType: string) => {
    params.set('displayCategory', 'CLOTHING');
    params.set('clothingType', clothingType);
    return `/catalog?${params.toString()}`;
  };

  const setShoes = (shoeType: string) => {
    params.set('displayCategory', 'SHOES');
    params.set('shoeType', shoeType);
    return `/catalog?${params.toString()}`;
  };

  const subgroup = String(item?.taxonomySubgroup || '').trim().toUpperCase();
  const group = String(item?.taxonomyGroup || '').trim().toUpperCase();

  if (group === 'CLOTHING' && subgroup) {
    const allowed = new Set([
      'BLAZERS',
      'OUTERWEAR',
      'SHIRTS',
      'TSHIRTS',
      'POLO',
      'HOODIES',
      'KNITWEAR',
      'TROUSERS',
      'DENIM',
      'SKIRTS',
      'DRESSES',
    ]);
    if (allowed.has(subgroup)) return setClothing(subgroup);
  }

  if (group === 'SHOES' && subgroup) {
    const allowed = new Set([
      'LOAFERS',
      'SNEAKERS',
      'SNEAKERS_CASUAL',
      'BALLET',
      'TALL_BOOTS',
      'BOOTS',
      'SHOES_CLASSIC',
      'SANDALS',
    ]);
    if (allowed.has(subgroup)) return setShoes(subgroup);
  }

  if (/пиджак|жакет|blazer/.test(rawText)) return setClothing('BLAZERS');
  if (/пальто|куртк|пуховик|ветровк|плащ|бомбер|жилет|outerwear|jacket|coat|parka|vest/.test(rawText)) return setClothing('OUTERWEAR');
  if (/рубаш|сорочк|блуз|shirt|blouse/.test(rawText)) return setClothing('SHIRTS');
  if (/футболк|майк|t-?shirt|tee/.test(rawText)) return setClothing('TSHIRTS');
  if (/поло|polo/.test(rawText)) return setClothing('POLO');
  if (/худи|толстовк|свитшот|hoodie|sweatshirt/.test(rawText)) return setClothing('HOODIES');
  if (/свитер|джемпер|кардиган|водолазк|knit|sweater|cardigan/.test(rawText)) return setClothing('KNITWEAR');
  if (/брюк|trouser|pants|slacks/.test(rawText)) return setClothing('TROUSERS');
  if (/джинс|denim|jeans/.test(rawText)) return setClothing('DENIM');
  if (/юбк|skirt/.test(rawText)) return setClothing('SKIRTS');
  if (/плать|сарафан|dress/.test(rawText)) return setClothing('DRESSES');

  if (/лофер|loafer/.test(rawText)) return setShoes('LOAFERS');
  if (/кроссов|sneaker|trainer|runner/.test(rawText)) return setShoes('SNEAKERS');
  if (/кед|слипон|canvas|slip[-\s]?on/.test(rawText)) return setShoes('SNEAKERS_CASUAL');
  if (/балетк|ballet/.test(rawText)) return setShoes('BALLET');
  if (/сапог|ботфорт|угг|tall boot|ugg/.test(rawText)) return setShoes('TALL_BOOTS');
  if (/ботин|ботильон|boot|chelsea|chukka/.test(rawText)) return setShoes('BOOTS');
  if (/туфл|oxford|дерби|монк|brogue|formal shoe|shoes/.test(rawText)) return setShoes('SHOES_CLASSIC');
  if (/босонож|сандал|сабо|эспадриль|сланц|шл[её]п|sandals?|espadrille/.test(rawText)) return setShoes('SANDALS');

  if (/сумк|bag|рюкзак|backpack|клатч|clutch|кошелек|wallet/.test(rawText)) {
    params.set('displayCategory', 'BAGS');
    return `/catalog?${params.toString()}`;
  }

  const title = String(item?.title || '').trim();
  const brand = String(item?.brand || '').trim();
  const q = [brand, title].filter(Boolean).join(' ').trim();

  if (q) params.set('q', q.slice(0, 120));
  return `/catalog?${params.toString()}`;
}

const Looks = () => {
  const { looks, actions, user } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const tabParam = new URLSearchParams(location.search).get('tab');
  const initialTab = tabParam === 'mine' ? 'mine' : tabParam === 'saved' ? 'saved' : tabParam === 'following' ? 'following' : 'feed';
  const [tab, setTab] = React.useState<'feed' | 'following' | 'mine' | 'saved'>(initialTab as 'feed' | 'following' | 'mine' | 'saved');
  const [feedLooks, setFeedLooks] = React.useState<any[]>([]);
  const [followingLooks, setFollowingLooks] = React.useState<any[]>([]);
  const [savedLooks, setSavedLooks] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [likedPulseIds, setLikedPulseIds] = React.useState<Record<string, boolean>>({});
  const [publishBusyIds, setPublishBusyIds] = React.useState<Record<string, boolean>>({});
  const [publishedOverrides, setPublishedOverrides] = React.useState<Record<string, boolean>>({});
  const [savedOverrides, setSavedOverrides] = React.useState<Record<string, boolean>>({});
  const [saveBusyIds, setSaveBusyIds] = React.useState<Record<string, boolean>>({});
  const [socialNotice, setSocialNotice] = React.useState('');

  React.useEffect(() => {
    const requestedParam = new URLSearchParams(location.search).get('tab');
    const requestedTab = requestedParam === 'mine' ? 'mine' : requestedParam === 'saved' ? 'saved' : requestedParam === 'following' ? 'following' : 'feed';
    setTab(requestedTab);
  }, [location.search]);

  React.useEffect(() => {
    if (tab !== 'feed' && tab !== 'saved' && tab !== 'following') return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const endpoint =
          tab === 'saved'
            ? '/api/looks/saved?limit=50'
            : tab === 'following'
              ? '/api/looks/following?limit=50'
              : '/api/looks/public?limit=50';
        const resp = await fetch(endpoint, { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));

        if (cancelled) return;

        if (!resp.ok) {
          if (tab === 'saved') setSavedLooks([]);
          else if (tab === 'following') setFollowingLooks([]);
          else setFeedLooks([]);
          return;
        }

        const raw = Array.isArray(data?.looks) ? data.looks : Array.isArray(data) ? data : [];
        const mapped = raw.map((l: any) => ({ ...l, createdAt: l?.createdAt ? new Date(l.createdAt) : new Date() }));

        if (tab === 'saved') setSavedLooks(mapped);
        else if (tab === 'following') setFollowingLooks(mapped);
        else setFeedLooks(mapped);
      } catch {
        if (!cancelled) {
          if (tab === 'saved') setSavedLooks([]);
          else if (tab === 'following') setFollowingLooks([]);
          else setFeedLooks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, user?.id]);

  const visibleLooks = tab === 'mine' ? looks : tab === 'saved' ? savedLooks : tab === 'following' ? followingLooks : feedLooks;

  const requireAuthForSocial = (message: string) => {
    if (user?.id) return true;
    setSocialNotice(message);
    window.setTimeout(() => setSocialNotice(''), 3500);
    return false;
  };

  const handlePublishFromList = async (look: any) => {
    if (!look?.id || !requireAuthForSocial('Войдите, чтобы публиковать образы и участвовать в ленте.')) return;

    const lookId = String(look.id);
    const currentIsPublic = Boolean(publishedOverrides[lookId] ?? look.isPublic);
    const endpoint = currentIsPublic ? 'unpublish' : 'publish';

    setPublishBusyIds((prev) => ({ ...prev, [lookId]: true }));

    try {
      const resp = await fetch(`/api/looks/${encodeURIComponent(lookId)}/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setSocialNotice(data?.error || 'Не удалось обновить публикацию');
        return;
      }

      const nextIsPublic = Boolean(data?.look?.isPublic ?? !currentIsPublic);
      setPublishedOverrides((prev) => ({ ...prev, [lookId]: nextIsPublic }));

      if (tab === 'feed' && !nextIsPublic) {
        setFeedLooks((prev) => prev.filter((l) => String(l.id) !== lookId));
      }

      setSocialNotice(nextIsPublic ? 'Образ опубликован в ленте' : 'Образ скрыт из ленты');
      window.setTimeout(() => setSocialNotice(''), 2500);
    } finally {
      setPublishBusyIds((prev) => ({ ...prev, [lookId]: false }));
    }
  };

  const handleLikeFromFeed = async (lookId: string) => {
    if (!requireAuthForSocial('Войдите, чтобы ставить лайки и комментировать образы.')) return;

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

  const handleSaveLook = async (look: any) => {
    if (!requireAuthForSocial('Войдите, чтобы сохранять образы.')) return;

    const lookId = String(look?.id || '');
    if (!lookId) return;

    const currentSaved = Boolean(savedOverrides[lookId] ?? look.viewerSaved);
    const method = currentSaved ? 'DELETE' : 'POST';

    setSaveBusyIds((prev) => ({ ...prev, [lookId]: true }));

    try {
      const resp = await fetch(`/api/looks/${encodeURIComponent(lookId)}/save`, {
        method,
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setSocialNotice(data?.error || 'Не удалось обновить сохранение');
        return;
      }

      const nextSaved = Boolean(data?.saved);
      setSavedOverrides((prev) => ({ ...prev, [lookId]: nextSaved }));

      setFeedLooks((prev) => prev.map((l) => String(l.id) === lookId ? { ...l, viewerSaved: nextSaved, saves: data?.saves ?? l.saves } : l));
      setSavedLooks((prev) => {
        if (nextSaved) {
          return prev.map((l) => String(l.id) === lookId ? { ...l, viewerSaved: true, saves: data?.saves ?? l.saves } : l);
        }
        return prev.filter((l) => String(l.id) !== lookId);
      });

      setSocialNotice(nextSaved ? 'Образ сохранён' : 'Образ убран из сохранённых');
      window.setTimeout(() => setSocialNotice(''), 2500);
    } finally {
      setSaveBusyIds((prev) => ({ ...prev, [lookId]: false }));
    }
  };

  const handleTryOnThisLook = (look: any) => {
    const sourceItems = Array.isArray(look?.sourceItems) ? look.sourceItems : [];
    if (!sourceItems.length) {
      navigate(`/look/${look.id}`);
      return;
    }

    navigate('/create-look', {
      state: {
        preselectedItems: sourceItems.slice(0, 5),
        fromLookId: look.id,
      },
    });
  };

  const handleDeleteLook = async (look: any) => {
    const lookId = String(look?.id || '');
    if (!lookId) return;

    const ok = window.confirm('Удалить образ? Это действие нельзя отменить.');
    if (!ok) return;

    try {
      await actions.deleteLook(lookId);
      setFeedLooks((prev) => prev.filter((l) => String(l.id) !== lookId));
      setTab('mine');
      navigate('/looks?tab=mine', { replace: true });
      setSocialNotice('Образ удалён');
      window.setTimeout(() => setSocialNotice(''), 2500);
    } catch (e: any) {
      alert(e?.message || 'Не удалось удалить образ');
    }
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
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold uppercase tracking-tighter">
            {tab === 'feed' ? 'Лента образов' : tab === 'following' ? 'Подписки' : tab === 'saved' ? 'Сохранённые' : 'Мои образы'}
          </h1>

          <Link
            to="/create-look"
            className="hidden sm:inline-flex h-10 px-4 items-center rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em]"
          >
            Создать
          </Link>
        </div>

        {socialNotice && (
          <div className="rounded-2xl bg-zinc-50 border border-zinc-100 px-4 py-3 text-xs text-zinc-600">
            {socialNotice}
            {!user?.id && (
              <Link to="/auth" className="ml-2 font-bold underline underline-offset-4">
                Войти
              </Link>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => {
              setTab('feed');
              navigate('/looks', { replace: true });
            }}
            className={`px-5 h-10 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${
              tab === 'feed'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-500 border-zinc-200'
            }`}
          >
            Лента
          </button>
          <button
            onClick={() => {
              setTab('mine');
              navigate('/looks?tab=mine', { replace: true });
            }}
            className={`px-5 h-10 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${
              tab === 'mine'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-500 border-zinc-200'
            }`}
          >
            Мои
          </button>
          <button
            onClick={() => {
              setTab('saved');
              navigate('/looks?tab=saved', { replace: true });
            }}
            className={`px-5 h-10 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${
              tab === 'saved'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-500 border-zinc-200'
            }`}
          >
            Сохранённые
          </button>
        </div>
      </div>

      {loading && tab !== 'mine' && (
        <div className="py-10 text-center text-xs text-zinc-400 uppercase tracking-widest">
          Загрузка...
        </div>
      )}

      {!loading && visibleLooks.length === 0 && (
        <div className="px-4 py-16 text-center">
          <div className="bg-zinc-50 border border-zinc-100 rounded-[32px] p-8 space-y-4">
            <h3 className="text-lg font-bold uppercase tracking-widest">
              {tab === 'feed'
                ? 'Пока нет публичных образов'
                : tab === 'following'
                  ? 'Пока нет образов от авторов'
                  : tab === 'saved'
                    ? 'Пока нет сохранённых образов'
                    : 'У вас пока нет образов'}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed uppercase tracking-wider">
              {tab === 'feed'
                ? 'Сгенерируйте и опубликуйте первые образы, чтобы наполнить ленту.'
                : tab === 'following'
                  ? 'Подпишитесь на авторов, чтобы видеть здесь их новые примеряемые образы.'
                  : tab === 'saved'
                    ? 'Сохраняйте понравившиеся образы из ленты, чтобы вернуться к ним позже.'
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
            const effectiveIsPublic = Boolean(publishedOverrides[String(look.id)] ?? look.isPublic);
            const authorHref = authorStorefrontRoute(look);
            const authorLabel = look.authorName || 'Автор';

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
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleSaveLook(look);
                      }}
                      disabled={!!saveBusyIds[String(look.id)]}
                      className={`bg-white/85 backdrop-blur-sm p-2 rounded-full shadow-lg transition-all duration-300 hover:scale-110 ${
                        Boolean(savedOverrides[String(look.id)] ?? look.viewerSaved) ? 'bg-zinc-900 text-white' : ''
                      } ${saveBusyIds[String(look.id)] ? 'opacity-60 pointer-events-none' : ''}`}
                      aria-label="Сохранить образ"
                    >
                      <span className="block text-sm leading-none">🔖</span>
                    </button>
                  </div>
                </Link>

                <div className="toptry-feed-side pt-4 md:pt-2 md:sticky md:top-28 md:space-y-8">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl md:text-3xl font-black uppercase tracking-tight leading-none">
                        {sourceItems.length ? `Образ из ${sourceItems.length} вещей` : (look.title || 'Образ')}
                      </h2>
                      <div className="flex items-center gap-2 mt-3">
                        {authorHref ? (
                          <Link
                            to={authorHref}
                            className="flex items-center gap-2 rounded-full hover:bg-zinc-50 transition-colors"
                            aria-label={`Открыть витрину автора: ${authorLabel}`}
                          >
                            {(look.authorAvatar || user?.avatarUrl || user?.selfieUrl) ? (
                              <img
                                src={withApiOrigin(look.authorAvatar || user?.avatarUrl || user?.selfieUrl || '')}
                                alt=""
                                className="w-5 h-5 rounded-full bg-zinc-100 object-cover object-top"
                              />
                            ) : (
                              <span className="w-5 h-5 rounded-full bg-zinc-100 inline-block" />
                            )}
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest hover:text-zinc-900">
                              {authorLabel}
                            </span>
                          </Link>
                        ) : (
                          <>
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
                              {authorLabel}
                            </span>
                          </>
                        )}
                        {effectiveIsPublic && (
                          <span className="text-[8px] bg-zinc-900 text-white px-2 py-1 rounded-full font-black uppercase tracking-widest">
                            В ленте
                          </span>
                        )}
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
                      <button
                        onClick={() => handleSaveLook(look)}
                        disabled={!!saveBusyIds[String(look.id)]}
                        className={`flex items-center gap-1.5 transition-transform hover:scale-110 ${
                          Boolean(savedOverrides[String(look.id)] ?? look.viewerSaved) ? 'text-zinc-900' : 'text-zinc-400'
                        } ${saveBusyIds[String(look.id)] ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        <span className="text-base leading-none">🔖</span> {look.saves || 0}
                      </button>
                    </div>
                  </div>

                  {tab === 'mine' && (
                    <section className="rounded-3xl border border-zinc-100 bg-zinc-50 p-4 space-y-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400">
                          Публикация
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                          {effectiveIsPublic
                            ? 'Образ виден в общей ленте.'
                            : 'Опубликуйте образ, чтобы друзья могли поставить лайк и оставить комментарий.'}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handlePublishFromList(look)}
                          disabled={!!publishBusyIds[String(look.id)]}
                          className={`h-10 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border transition-all ${
                            effectiveIsPublic
                              ? 'bg-white border-zinc-200 text-zinc-500'
                              : 'bg-zinc-900 border-zinc-900 text-white'
                          } ${publishBusyIds[String(look.id)] ? 'opacity-60 pointer-events-none' : ''}`}
                        >
                          {effectiveIsPublic ? 'Скрыть из ленты' : 'Опубликовать'}
                        </button>

                        {effectiveIsPublic && (
                          <button
                            type="button"
                            onClick={() => {
                              setTab('feed');
                              navigate('/looks', { replace: true });
                            }}
                            className="h-10 px-4 rounded-full bg-white border border-zinc-200 text-zinc-700 text-[10px] font-black uppercase tracking-[0.18em]"
                          >
                            Смотреть в ленте
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteLook(look)}
                          className="h-10 px-4 rounded-full bg-white border border-zinc-200 text-zinc-400 hover:text-zinc-900 hover:border-zinc-400 text-[10px] font-black uppercase tracking-[0.18em] transition-colors"
                        >
                          Удалить
                        </button>
                      </div>
                    </section>
                  )}

                  {sourceItems.length > 0 && (
                    <div className="hidden md:flex gap-3">
                      {tab !== 'mine' && (
                        <button
                          type="button"
                          onClick={() => handleTryOnThisLook(look)}
                          className="flex-1 bg-zinc-900 text-white px-5 py-3 rounded-full text-xs font-black uppercase tracking-widest"
                        >
                          Примерить на себе
                        </button>
                      )}
                      <Link
                        to={`/look/${look.id}`}
                        className={`${tab === 'mine' ? 'flex-1 text-center' : ''} bg-white border border-zinc-200 text-zinc-900 px-5 py-3 rounded-full text-xs font-black uppercase tracking-widest`}
                      >
                        Детали
                      </Link>
                    </div>
                  )}

                  {sourceItems.length > 0 && (
                    <section className="hidden md:block space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-400">
                        Товары образа
                      </h3>
                      <div className="space-y-3">
                        {sourceItems.slice(0, 3).map((item: any, idx: number) => {
                          const hasBuyUrl = !!(item?.affiliateUrl || item?.productUrl);
                          const buyUrl = sourceItemClickoutUrl(item, 'feed', String(look.id), idx);
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
                              {hasBuyUrl && buyUrl ? (
                                <a
                                  href={buyUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-zinc-900 text-white px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest"
                                >
                                  Купить
                                </a>
                              ) : (
                                <Link
                                    to={similarCatalogRoute(item)}
                                    className="bg-zinc-100 text-zinc-700 px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
                                  >
                                    Найти похожее
                                  </Link>
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
                        Товары образа
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
                      {authorHref ? (
                        <Link
                          to={authorHref}
                          className="text-[9px] text-zinc-400 font-bold uppercase truncate hover:text-zinc-900"
                        >
                          {authorLabel}
                        </Link>
                      ) : (
                        <span className="text-[9px] text-zinc-400 font-bold uppercase truncate">
                          {authorLabel}
                        </span>
                      )}
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
