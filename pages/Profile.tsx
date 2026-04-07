import React, { useEffect, useState } from 'react';
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
  useEffect(() => {
    if (!avatarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setAvatarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [avatarOpen, busy]);


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

  const bigSrc = withApiOrigin(user.avatarUrl || user.selfieUrl || "");

  const preprocessAvatarFile = async (file: File): Promise<string> => {
    const objectUrl = URL.createObjectURL(file);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Не удалось прочитать изображение"));
        el.src = objectUrl;
      });

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      if (!width || !height) {
        throw new Error("Некорректный размер изображения");
      }

      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas недоступен");
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      let quality = 0.86;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);

      const maxBytes = 2.5 * 1024 * 1024;
      const estimateBytes = (url: string) => {
        const base64 = url.split(",")[1] || "";
        return Math.ceil((base64.length * 3) / 4);
      };

      while (estimateBytes(dataUrl) > maxBytes && quality > 0.6) {
        quality = Math.max(0.6, Number((quality - 0.08).toFixed(2)));
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }

      return dataUrl;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const processAvatar = async (photoDataUrl: string) => {
    setErr(null);
    try {
      setBusy(true);

      const res = await fetch("/api/avatar/process", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoDataUrl }),
      });

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {}

      if (!res.ok) {
        const msg = payload?.error || payload?.message || "Не удалось обработать аватар";
        throw new Error(msg);
      }

      if (typeof (actions as any).setSelfie === 'function') {
        (actions as any).setSelfie(payload?.selfieUrl || photoDataUrl);
      }

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

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.currentTarget.value = "";

    setErr(null);
    setBusy(true);

    try {
      const dataUrl = await preprocessAvatarFile(file);
      await processAvatar(dataUrl);
    } catch (e: any) {
      console.error("[profile avatar/preprocess] error:", e);
      setErr(e?.message || "Не удалось подготовить фото");
      setBusy(false);
    }
  };

  return (
    <div className="pb-12">

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
                type="button"
                className="w-9 h-9 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-900 disabled:opacity-50"
                onClick={() => !busy && setAvatarOpen(false)}
                disabled={busy}
                aria-label="Закрыть"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
                {bigSrc ? (
                  <img
                    src={bigSrc}
                    alt=""
                    className="w-full max-h-[62vh] object-contain mx-auto block"
                  />
                ) : (
                  <div className="p-10 text-center text-zinc-400">Нет изображения</div>
                )}
              </div>

              {err ? (
                <div className="text-sm text-red-500">{err}</div>
              ) : null}

              <div className="flex items-center gap-3">
                <label className={`relative inline-flex items-center justify-center bg-zinc-900 text-white px-6 py-3 rounded-full font-bold uppercase tracking-widest text-xs ${busy ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                  {busy ? "Обработка..." : "Заменить"}
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={onFileChange}
                    disabled={busy}
                  />
                </label>

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
