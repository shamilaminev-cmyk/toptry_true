import React, { useState, useRef } from 'react';
import { useAppState } from '../store';
import { ICONS } from '../constants';
import { Category, Gender, WardrobeItem } from '../types';
import { useNavigate } from 'react-router-dom';

const Wardrobe = () => {
  const { wardrobe, actions, user } = useAppState();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');

  // States for uploading/recognition
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<{ original: string; cutout: string; attrs: any } | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCategory, setDraftCategory] = useState<Category>(Category.TOPS);
  const [draftGender, setDraftGender] = useState<Gender>(Gender.UNISEX);
  const [draftTags, setDraftTags] = useState<string>('');
  const [draftColor, setDraftColor] = useState<string>('');
  const [draftMaterial, setDraftMaterial] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredItems =
    activeCategory === 'all'
      ? wardrobe
      : wardrobe.filter((i) => i.category === activeCategory);

  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });

  // ✅ В PROD фронт на Timeweb, а backend+media на DO (api.toptry.ru)
  // Поэтому /media/* нужно префиксовать apiOrigin, иначе браузер идёт на toptry.ru/media/* (404)
  const apiOrigin = import.meta.env.VITE_API_ORIGIN || 'https://api.toptry.ru';

  function withApiOrigin(url?: string) {
    if (!url) return '';
    if (url.startsWith('/api/')) return apiOrigin + url;
    if (url.startsWith('/media/')) return apiOrigin + url;
    return url;
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setIsRecognizing(true);
    try {
      const original = await readAsDataUrl(file);
      const resp = await fetch('/api/wardrobe/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoDataUrl: original,
          hintCategory: activeCategory === 'all' ? undefined : activeCategory,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.error || `Ошибка сервера (${resp.status})`);
      }
      const data = await resp.json();
      const cutout = data?.cutoutDataUrl;
      const attrs = data?.attributes || {};
      if (!cutout) throw new Error('Сервер не вернул вырезанную вещь');
      setExtracted({ original, cutout, attrs });
      setDraftTitle(attrs?.title || 'Моя вещь');
      setDraftCategory((Object.values(Category) as any).includes(attrs?.category) ? attrs.category : Category.TOPS);
      setDraftGender((Object.values(Gender) as any).includes(attrs?.gender) ? attrs.gender : Gender.UNISEX);
      setDraftTags(Array.isArray(attrs?.tags) ? attrs.tags.join(', ') : '');
      setDraftColor(attrs?.color || '');
      setDraftMaterial(attrs?.material || '');
    } catch (err: any) {
      setExtractError(err?.message || 'Не удалось распознать вещь');
    } finally {
      setIsRecognizing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmAddition = async () => {
    if (!extracted) return;
    if (!user?.id) {
      setExtractError('Чтобы добавлять свои вещи, нужно войти в аккаунт');
      return;
    }
    setExtractError(null);
    setIsRecognizing(true);

    try {
      const saveResp = await fetch('/api/wardrobe/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          category: draftCategory,
          gender: draftGender,
          tags: draftTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          color: draftColor || undefined,
          material: draftMaterial || undefined,
          originalDataUrl: extracted.original,
          cutoutDataUrl: extracted.cutout,
        }),
      });

      if (!saveResp.ok) {
        const data = await saveResp.json().catch(() => ({}));
        if (saveResp.status === 401)
          throw new Error('Нужно войти, чтобы добавлять свои вещи');
        throw new Error(data?.error || `Ошибка сохранения (${saveResp.status})`);
      }

      const data = await saveResp.json();
      const item = data?.item;
      if (!item) throw new Error('Сервер не вернул сохраненную вещь');

      actions.upsertWardrobeItem({
        ...item,
        addedAt: item?.addedAt ? new Date(item.addedAt) : new Date(),
      } as WardrobeItem);

      setExtracted(null);
    } catch (err: any) {
      setExtractError(err?.message || 'Не удалось добавить вещь');
    } finally {
      setIsRecognizing(false);
    }
  };

  return (
    <div className="pb-24">
      <div className="p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold uppercase tracking-tighter">Мой Шкаф</h1>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-zinc-100 p-3 rounded-full hover:bg-zinc-900 hover:text-white transition-all shadow-sm"
          >
            <ICONS.Plus className="w-6 h-6" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept="image/*"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
              activeCategory === 'all'
                ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                : 'bg-white border-zinc-200 text-zinc-400 hover:border-zinc-400'
            }`}
          >
            Все
          </button>
          {Object.values(Category).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                activeCategory === cat
                  ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                  : 'bg-white border-zinc-200 text-zinc-400 hover:border-zinc-400'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Upload Recognition UI */}
        {(isRecognizing || extracted) && (
          <div className="fixed inset-0 z-[100] bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[40px] p-8 space-y-8 animate-in zoom-in">
              {isRecognizing ? (
                <div className="py-12 flex flex-col items-center gap-6">
                  <div className="w-12 h-12 border-4 border-zinc-100 border-t-zinc-900 rounded-full animate-spin"></div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] animate-pulse">Анализ фото...</p>
                </div>
              ) : (
                <>
                  <h3 className="text-lg font-bold uppercase tracking-widest">Добавить вещь</h3>
                  {extractError && (
                    <div className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
                      {extractError}
                    </div>
                  )}
                  {extracted && (
                    <div className="space-y-4">
                      <div className="flex gap-3">
                        <div className="w-28 h-28 rounded-2xl bg-zinc-50 border border-zinc-100 p-2 flex items-center justify-center">
                          <img src={extracted.cutout} className="w-full h-full object-contain mix-blend-multiply" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Название</label>
                          <input
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-900"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Категория</label>
                          <select
                            value={draftCategory}
                            onChange={(e) => setDraftCategory(e.target.value as any)}
                            className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-sm bg-white focus:outline-none focus:border-zinc-900"
                          >
                            {Object.values(Category).map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Пол</label>
                          <select
                            value={draftGender}
                            onChange={(e) => setDraftGender(e.target.value as any)}
                            className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-sm bg-white focus:outline-none focus:border-zinc-900"
                          >
                            <option value={Gender.UNISEX}>UNISEX</option>
                            <option value={Gender.MALE}>MALE</option>
                            <option value={Gender.FEMALE}>FEMALE</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Цвет</label>
                          <input
                            value={draftColor}
                            onChange={(e) => setDraftColor(e.target.value)}
                            className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-900"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Материал</label>
                          <input
                            value={draftMaterial}
                            onChange={(e) => setDraftMaterial(e.target.value)}
                            className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-900"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Теги (через запятую)</label>
                        <input
                          value={draftTags}
                          onChange={(e) => setDraftTags(e.target.value)}
                          className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-900"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => setExtracted(null)}
                          className="flex-1 border border-zinc-200 py-4 rounded-full text-xs font-bold uppercase tracking-widest"
                        >
                          Отмена
                        </button>
                        <button
                          onClick={confirmAddition}
                          className="flex-1 bg-zinc-900 text-white py-4 rounded-full text-xs font-bold uppercase tracking-widest"
                        >
                          Добавить
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {wardrobe.length === 0 ? (
          <div className="py-24 text-center border-2 border-dashed border-zinc-100 rounded-[48px] bg-zinc-50 px-8 space-y-8">
            <ICONS.Wardrobe className="w-10 h-10 text-zinc-200 mx-auto" />
            <p className="text-sm text-zinc-400 italic max-w-[240px] mx-auto uppercase tracking-tighter">Ваш шкаф пока пуст</p>
            <button
              onClick={() => navigate('/catalog')}
              className="bg-zinc-900 text-white py-4 px-12 rounded-full text-xs font-bold uppercase tracking-widest"
            >
              В каталог
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className={`relative group aspect-square rounded-[24px] bg-zinc-50 border border-zinc-100 transition-all overflow-hidden p-3 hover:border-zinc-300 hover:shadow-md`}
              >
                {/* ✅ ВАЖНО: префиксуем /media/* на apiOrigin */}
                <img
                  src={withApiOrigin(item.images?.[0])}
                  alt=""
                  className="w-full h-full object-contain mix-blend-multiply transition-all duration-500"
                />
                <button
                  onClick={() => actions.removeFromWardrobe(item.id)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 p-1.5 rounded-lg text-zinc-400 hover:text-red-500 shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    ></path>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="pt-6">
          <div className="bg-zinc-900 text-white p-8 rounded-[40px] space-y-6 shadow-2xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10 space-y-2">
              <h3 className="text-xl font-bold uppercase tracking-widest">Стилизовать образ</h3>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest leading-relaxed">
                Используйте Gemini 3 для виртуальной примерки ваших вещей.
              </p>
            </div>
            <button
              onClick={() => navigate('/create-look')}
              className="w-full bg-white text-zinc-900 py-4 rounded-full text-xs font-black uppercase tracking-[0.2em] shadow-lg hover:bg-zinc-50 transition-all"
            >
              Перейти к созданию
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Wardrobe;
