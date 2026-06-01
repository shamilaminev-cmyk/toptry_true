import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useAppState } from '../store';
import { ICONS, CURRENCY } from '../constants';
import { withApiOrigin } from '../utils/withApiOrigin';


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

const LookDetails = () => {
  const { id } = useParams();
  const location = useLocation();
  const { looks: localLooks, products, actions, user } = useAppState();
  const [isTryingOn, setIsTryingOn] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [look, setLook] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const commentsRef = useRef<HTMLElement | null>(null);
  const commentInputRef = useRef<HTMLInputElement | null>(null);

  const quickComments = [
    'Очень удачно',
    'Хочу такой же',
    'Лучше с другими брюками',
    'Слишком спортивно',
    'Где купить?',
  ];

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/looks/${encodeURIComponent(String(id))}`);
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          setLook(data?.look || null);
        } else {
          const fallback = localLooks.find((l) => l.id === id);
          setLook(fallback || null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id, localLooks]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`/api/looks/${encodeURIComponent(String(id))}/comments`);
        if (!resp.ok) return;
        const data = await resp.json().catch(() => ({}));
        const raw = Array.isArray(data?.comments) ? data.comments : [];
        setComments(raw.map((c: any) => ({ ...c, createdAt: new Date(c.createdAt) })));
      } catch {
        // ignore
      }
    })();
  }, [id]);

  useEffect(() => {
    if (loading) return;

    const params = new URLSearchParams(location.search);
    if (params.get('comments') !== '1') return;

    window.setTimeout(() => {
      commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      commentInputRef.current?.focus();
    }, 120);
  }, [loading, location.search, id]);

  if (loading) return <div className="p-10 text-center text-zinc-400">Загрузка...</div>;
  if (!look) return <div className="p-10 text-center">Образ не найден</div>;

  const lookProducts =
    Array.isArray(look.sourceItems) && look.sourceItems.length > 0
      ? look.sourceItems
      : products.filter((p) => (look.items || look.itemIds || []).includes(p.id));
  const isOwnLook = !!localLooks.find((l) => String(l.id) === String(look?.id));

  const handleTryOn = () => {
    setIsTryingOn(true);
    setTimeout(() => {
      setIsTryingOn(false);
      setShowResult(true);
    }, 2000);
  };

  const submitComment = async () => {
    if (!user?.id) return;
    if (!commentText.trim()) return;

    setCommentBusy(true);
    try {
      const resp = await fetch(`/api/looks/${encodeURIComponent(String(id))}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (!resp.ok) return;

      setCommentText('');

      const refreshed = await fetch(`/api/looks/${encodeURIComponent(String(id))}/comments`);
      if (refreshed.ok) {
        const data = await refreshed.json().catch(() => ({}));
        const raw = Array.isArray(data?.comments) ? data.comments : [];
        setComments(raw.map((c: any) => ({ ...c, createdAt: new Date(c.createdAt) })));
      }
    } finally {
      setCommentBusy(false);
    }
  };

  const handlePublishToggle = async () => {
    if (!user?.id || !look?.id) return;

    setPublishBusy(true);
    try {
      const endpoint = look.isPublic ? "unpublish" : "publish";
      const resp = await fetch(`/api/looks/${encodeURIComponent(String(look.id))}/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        showToast(data?.error || 'Не удалось обновить публикацию');
        return;
      }

      if (data?.look) {
        setLook({ ...data.look, createdAt: new Date(data.look.createdAt) });
      } else {
        setLook((prev: any) => prev ? { ...prev, isPublic: !prev.isPublic } : prev);
      }

      showToast(endpoint === "publish" ? 'Образ опубликован' : 'Образ скрыт из ленты');
    } finally {
      setPublishBusy(false);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    const title = look?.title || 'Образ TopTry';

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: 'Посмотри этот образ в TopTry',
          url,
        });
        return;
      }

      try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
      showToast('Ссылка скопирована');
    } catch {
      try {
        try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
        showToast('Ссылка скопирована');
      } catch {
        showToast('Ссылка скопирована');
      }
    }
  };

  return (
    <div className="pb-12 md:px-6 md:py-6">
      <div className="md:grid md:grid-cols-[minmax(0,560px)_minmax(360px,1fr)] md:gap-8 md:items-start md:max-w-6xl md:mx-auto">
        <div className="relative aspect-[3/4] bg-zinc-100 md:sticky md:top-24 md:h-[calc(100vh-180px)] md:min-h-[560px] md:max-h-[820px] md:aspect-auto md:rounded-[32px] md:overflow-hidden md:border md:border-zinc-100">
        <img
          src={
            showResult
              ? `https://picsum.photos/seed/tryon-${id}/800/1200`
              : withApiOrigin(look.resultImageUrl)
          }
          alt=""
          className={`w-full h-full object-cover md:object-contain transition-all duration-1000 ${
            isTryingOn ? 'blur-xl' : 'blur-0'
          }`}
        />

        {isTryingOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/20 backdrop-blur-sm">
            <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4"></div>
            <p className="text-white text-xs font-bold uppercase tracking-widest drop-shadow-md">
              AI примерка...
            </p>
          </div>
        )}

        {!showResult && !isTryingOn && !isOwnLook && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={handleTryOn}
              className="bg-white/90 backdrop-blur-md px-10 py-4 rounded-full font-bold uppercase tracking-widest text-sm shadow-2xl hover:scale-105 transition-transform"
            >
              Примерить этот образ
            </button>
          </div>
        )}

        <Link to="/" className="absolute top-4 left-4 bg-white/50 backdrop-blur p-2 rounded-full">
          <svg className="w-6 h-6 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            ></path>
          </svg>
        </Link>
        </div>

        <div className="p-6 space-y-8 md:p-0 md:pb-24">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">{look.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              {look.authorAvatar ? (
                <img src={withApiOrigin(look.authorAvatar)} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <span className="w-5 h-5 rounded-full bg-zinc-100 inline-block" />
              )}
              <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
                {look.authorName || 'Пользователь TopTry'}
              </span>
              {look.isPublic ? (
                <span className="text-[9px] bg-zinc-900 text-white px-2 py-1 rounded-full font-bold uppercase tracking-widest">
                  Опубликовано
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-4 flex-wrap justify-end">
            {isOwnLook && (
              <button
                onClick={handlePublishToggle}
                disabled={publishBusy}
                className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                  look.isPublic
                    ? 'border-zinc-300 text-zinc-500'
                    : 'border-zinc-900 bg-zinc-900 text-white'
                } ${publishBusy ? 'opacity-60 pointer-events-none' : ''}`}
              >
                {look.isPublic ? 'Скрыть' : 'Опубликовать'}
              </button>
            )}
            <button onClick={() => actions.reactToLook(look.id, 'like')} className="flex items-center gap-1.5 font-bold">
              <ICONS.Heart className="w-6 h-6" /> {look.likes}
            </button>
            <button onClick={() => actions.reactToLook(look.id, 'want_try')} className="flex items-center gap-1.5 font-bold">
              <span className="text-lg leading-none">🔥</span> {look.wantTryCount || 0}
            </button>
            <button onClick={() => actions.reactToLook(look.id, 'would_buy')} className="flex items-center gap-1.5 font-bold">
              <span className="text-lg leading-none">🛍️</span> {look.wouldBuyCount || 0}
            </button>
            <button onClick={() => actions.saveLook(look.id)} className="flex items-center gap-1.5 font-bold">
              <span className="text-lg leading-none">🔖</span> {look.saves || 0}
            </button>
          </div>
        </div>

        {(look.userDescription || look.aiDescription) && (
          <section className="space-y-2">
            {look.userDescription && (
              <p className="text-sm">
                <span className="font-bold">Автор:</span> {look.userDescription}
              </p>
            )}
            {look.aiDescription && (
              <p className="text-sm text-zinc-600">
                <span className="font-bold">AI:</span> {look.aiDescription}
              </p>
            )}
          </section>
        )}

        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Вещи в образе</h2>
          <div className="space-y-3">
            {lookProducts.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center gap-4 bg-zinc-50 p-3 rounded-2xl border border-zinc-100"
              >
                <div className="w-16 h-16 bg-white rounded-xl p-2 border border-zinc-200">
                  <img
                    src={withApiOrigin(p.images?.[0])}
                    alt=""
                    className="w-full h-full object-contain mix-blend-multiply"
                  />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-bold uppercase tracking-tight">{p.title}</h4>
                  <p className="text-sm font-bold mt-0.5">
                    {p.price} {CURRENCY}
                  </p>
                </div>
                {p.affiliateUrl || p.productUrl ? (
                  <a
                    href={sourceItemClickoutUrl(p, 'look_details', String(look.id), idx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-zinc-900 text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest"
                  >
                    Купить
                  </a>
                ) : (
                  <Link
                    to={similarCatalogRoute(p)}
                    className="bg-zinc-100 text-zinc-700 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
                  >
                    Найти похожее
                  </Link>
                )}
              </div>
            ))}
          </div>

          {Array.isArray(look.sourceItems) && look.sourceItems.some((i: any) => i.isCatalog) && (
            <div className="pt-4">
              <div className="bg-zinc-900 text-white p-4 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest opacity-70">Купить всё</p>
                  <p className="text-lg font-bold">
                    {look.priceBuyNowRUB || 0} {CURRENCY}
                  </p>
                </div>
                <button
                  onClick={() => {
                    (look.sourceItems || [])
                      .map((i: any, idx: number) => sourceItemClickoutUrl(i, 'look_details_buy_all', String(look.id), idx))
                      .filter(Boolean)
                      .forEach((url: string) => {
                        window.open(url, '_blank', 'noopener,noreferrer');
                      });
                  }}
                  className="bg-white text-black px-5 py-3 rounded-full text-xs font-bold uppercase tracking-widest"
                >
                  Купить
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Похожие образы</h2>
          <div className="flex gap-4 overflow-x-auto no-scrollbar">
            {localLooks.slice(0, 4).map((l) => (
              <Link
                key={l.id}
                to={`/look/${l.id}`}
                className="flex-shrink-0 w-32 aspect-square rounded-2xl bg-zinc-100 overflow-hidden"
              >
                <img src={withApiOrigin(l.resultImageUrl)} alt="" className="w-full h-full object-cover" />
              </Link>
            ))}
          </div>
        </section>

        <section ref={commentsRef} className="space-y-4 scroll-mt-24">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Комментарии</h2>

          {comments.length === 0 ? (
            <p className="text-sm text-zinc-400">Пока нет комментариев.</p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-zinc-100 overflow-hidden">
                    {c.authorAvatar ? (
                      <img
                        src={withApiOrigin(c.authorAvatar)}
                        className="w-full h-full object-cover"
                        alt=""
                      />
                    ) : null}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold">{c.authorName}</p>
                    <p className="text-sm text-zinc-700">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {user?.id && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {quickComments.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setCommentText(preset)}
                    className="px-3 py-2 rounded-full border border-zinc-200 text-[10px] font-bold uppercase tracking-widest hover:border-zinc-900"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  ref={commentInputRef}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Написать комментарий..."
                  className="flex-1 border border-zinc-200 rounded-full px-5 py-3 text-sm focus:outline-none focus:border-zinc-900"
                />
                <button
                  onClick={submitComment}
                  disabled={commentBusy}
                  className={`bg-zinc-900 text-white px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest ${
                    commentBusy ? 'opacity-60 pointer-events-none' : ''
                  }`}
                >
                  Отправить
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="pt-4 border-t border-zinc-100">
          <button
            onClick={handleShare}
            className="w-full flex items-center justify-center gap-2 text-zinc-400 uppercase font-bold text-[10px] tracking-widest py-4"
          >
            <ICONS.Share className="w-4 h-4" /> Поделиться этим образом
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};


function showToast(message: string) {
  const el = document.createElement('div');
  el.innerText = message;
  el.style.position = 'fixed';
  el.style.bottom = '24px';
  el.style.left = '50%';
  el.style.transform = 'translateX(-50%)';
  el.style.background = '#111';
  el.style.color = '#fff';
  el.style.padding = '10px 16px';
  el.style.borderRadius = '999px';
  el.style.fontSize = '12px';
  el.style.zIndex = '9999';
  el.style.opacity = '0';
  el.style.transition = 'opacity 0.2s ease';

  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = '1'));

  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }, 2000);
}

export default LookDetails;
