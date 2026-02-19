import React, { useRef, useState } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { ICONS } from '../constants';
import { SubscriptionTier } from '../types';

const Profile = () => {
  const { user, actions } = useAppState();
  const navigate = useNavigate();

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!user) {
    return (
      <div className="p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-zinc-100 rounded-full mx-auto flex items-center justify-center">
          <ICONS.User className="w-10 h-10 text-zinc-300" />
        </div>
        <h1 className="text-xl font-bold uppercase tracking-widest">Профиль не доступен</h1>
        <p className="text-sm text-zinc-400">Войдите в аккаунт, чтобы увидеть свои настройки и лимиты.</p>
        <button onClick={() => navigate('/auth')} className="bg-zinc-900 text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs">Войти</button>
      </div>
    );
  }

  const tierColors = {
    [SubscriptionTier.FREE]: 'bg-zinc-100 text-zinc-400',
    [SubscriptionTier.SILVER]: 'bg-zinc-200 text-zinc-900',
    [SubscriptionTier.GOLD]: 'bg-zinc-900 text-white',
  };

  const bigSrc = withApiOrigin(user.selfieUrl || user.avatarUrl || "");

  const processAvatar = async (photoDataUrl: string) => {
    setBusy(true);
    setErr(null);
    try {
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

      // обновим user с сервера (avatarUrl/selfieUrl)
      if (typeof (actions as any).refreshMe === 'function') {
        await (actions as any).refreshMe();
      }
      setAvatarOpen(false);
    } catch (e: any) {
      console.error("[profile avatar/process] error:", e);
      setErr(e?.message || "Не удалось обработать аватар");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      processAvatar(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="pb-12">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      <div className="p-6 space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <div className="w-32 h-32 rounded-full bg-white border-4 border-white shadow-xl overflow-hidden">
              {(user.avatarUrl || user.selfieUrl) ? (
                <img
                  src={withApiOrigin(user.avatarUrl || user.selfieUrl)}
                  alt=""
                  className="w-full h-full object-cover object-top"
                />
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => { setErr(null); setAvatarOpen(true); }}
              className="absolute bottom-1 right-1 bg-zinc-900 text-white p-2 rounded-full shadow-lg"
              aria-label="Редактировать аватар"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
              </svg>
            </button>
          </div>

          <div>
            <h1 className="text-2xl font-bold">@{user.username}</h1>
            <p className="text-sm text-zinc-400 uppercase tracking-widest font-medium">{user.phone}</p>
          </div>
        </div>

        <div className="bg-zinc-50 rounded-[32px] p-6 space-y-6 border border-zinc-100">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest">Твой тариф</p>
              <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${tierColors[user.tier]}`}>
                {user.tier}
              </div>
            </div>
            <button className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 underline underline-offset-4">Улучшить</button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-bold uppercase text-zinc-400 mb-1">HD Примерки</p>
              <p className="text-lg font-bold">{user.limits.hdTryOnRemaining} <span className="text-zinc-300 text-sm">/ 20</span></p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-zinc-100">
              <p className="text-[10px] font-bold uppercase text-zinc-400 mb-1">Новые образы</p>
              <p className="text-lg font-bold">{user.limits.looksRemaining} <span className="text-zinc-300 text-sm">/ 100</span></p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <button className="w-full flex items-center justify-between p-5 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-colors">
            <span className="text-sm font-bold uppercase tracking-widest">Мои покупки</span>
            <ICONS.ArrowRight className="w-4 h-4" />
          </button>
          <button className="w-full flex items-center justify-between p-5 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-colors">
            <span className="text-sm font-bold uppercase tracking-widest">Настройки приватности</span>
            <ICONS.ArrowRight className="w-4 h-4" />
          </button>
          <button className="w-full flex items-center justify-between p-5 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-colors">
            <span className="text-sm font-bold uppercase tracking-widest">Удалить мои данные</span>
            <ICONS.ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={() => actions.logout()} className="w-full p-5 text-red-500 text-sm font-bold uppercase tracking-widest text-center mt-4">Выйти из системы</button>
        </div>
      </div>

      {/* Modal */}
      {avatarOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !busy && setAvatarOpen(false)}
        >
          <div
            className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-400">Аватар</div>
              <button
                className="text-xs font-bold uppercase tracking-widest text-zinc-900"
                onClick={() => !busy && setAvatarOpen(false)}
              >
                Закрыть
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
                {bigSrc ? (
                  <img
                    src={bigSrc}
                    alt=""
                    className="w-full h-auto block"
                  />
                ) : (
                  <div className="p-10 text-center text-zinc-400">Нет изображения</div>
                )}
              </div>

              {err ? (
                <div className="text-sm text-red-500">{err}</div>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onPickFile}
                  disabled={busy}
                  className="bg-zinc-900 text-white px-6 py-3 rounded-full font-bold uppercase tracking-widest text-xs disabled:opacity-60"
                >
                  {busy ? "Обработка..." : "Заменить"}
                </button>

                <div className="text-xs text-zinc-400">
                  Загрузите новое фото — фон будет нормализован автоматически.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Profile;
