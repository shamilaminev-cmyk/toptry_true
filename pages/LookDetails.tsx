import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppState } from '../store';
import { ICONS, CURRENCY } from '../constants';
import { withApiOrigin } from '../utils/withApiOrigin';

const LookDetails = () => {
  const { id } = useParams();
  const { looks: localLooks, products, actions, user } = useAppState();
  const [isTryingOn, setIsTryingOn] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [look, setLook] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

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

  if (loading) return <div className="p-10 text-center text-zinc-400">Загрузка...</div>;
  if (!look) return <div className="p-10 text-center">Образ не найден</div>;

  const lookProducts = products.filter((p) => (look.items || look.itemIds || []).includes(p.id));

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

  return (
    <div className="pb-12">
      <div className="relative aspect-[3/4] bg-zinc-100">
        <img
          src={
            showResult
              ? `https://picsum.photos/seed/tryon-${id}/800/1200`
              : withApiOrigin(look.resultImageUrl)
          }
          alt=""
          className={`w-full h-full object-cover transition-all duration-1000 ${
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

        {!showResult && !isTryingOn && (
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

      <div className="p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">{look.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <img src={withApiOrigin(look.authorAvatar)} alt="" className="w-5 h-5 rounded-full" />
              <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
                {look.authorName}
              </span>
            </div>
          </div>
          <div className="flex gap-4">
            <button onClick={() => actions.likeLook(look.id)} className="flex items-center gap-1.5 font-bold">
              <ICONS.Heart className="w-6 h-6" /> {look.likes}
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
            {lookProducts.map((p) => (
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
                <button className="bg-zinc-900 text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest">
                  Купить
                </button>
              </div>
            ))}
          </div>
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

        <section className="space-y-4">
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
            <div className="flex gap-2">
              <input
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
          )}
        </section>

        <div className="pt-4 border-t border-zinc-100">
          <button className="w-full flex items-center justify-center gap-2 text-zinc-400 uppercase font-bold text-[10px] tracking-widest py-4">
            <ICONS.Share className="w-4 h-4" /> Поделиться этим образом
          </button>
        </div>
      </div>
    </div>
  );
};

export default LookDetails;
