import React, { useState, useRef, useMemo } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { useAppState } from '../store';
import { ICONS } from '../constants';
import { Category, Gender, WardrobeItem } from '../types';
import { useNavigate } from 'react-router-dom';

type DetectBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type CandidateAttrs = {
  title?: string;
  category?: string;
  gender?: string;
  tags?: string[];
  color?: string;
  material?: string;
};

type WardrobeCandidate = {
  id: string;
  original: string;
  selected: boolean;
  cutoutDataUrl?: string;
  box?: DetectBox;
  attributes: CandidateAttrs;
};


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
  const [candidates, setCandidates] = useState<WardrobeCandidate[] | null>(null);
  const [pendingExtracted, setPendingExtracted] = useState<Array<{ original: string; cutout: string; attrs: any }>>([]);
  const [hoveredCandidateId, setHoveredCandidateId] = useState<string | null>(null);


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

  const normalizeCandidateBox = (box: any): DetectBox | undefined => {
    if (!box || typeof box !== 'object') return undefined;

    const toUnit = (value: any) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      const normalized = n > 1 ? n / 1000 : n;
      return Math.max(0, Math.min(1, normalized));
    };

    const x = toUnit(box?.x);
    const y = toUnit(box?.y);
    const w = toUnit(box?.w);
    const h = toUnit(box?.h);

    if ([x, y, w, h].some((v) => v === undefined)) return undefined;
    if ((w as number) <= 0.02 || (h as number) <= 0.02) return undefined;

    const clampedW = Math.min(w as number, 1 - (x as number));
    const clampedH = Math.min(h as number, 1 - (y as number));
    if (clampedW <= 0.02 || clampedH <= 0.02) return undefined;

    return { x: x as number, y: y as number, w: clampedW, h: clampedH };
  };

  const hasBoxes = useMemo(
    () => (candidates || []).some((c) => c?.box),
    [candidates]
  );

  const resolvedDotPoints = useMemo(
    () => getResolvedDotPoints(candidates || []),
    [candidates]
  );

  const selectedCandidatesCount = useMemo(

    () => (candidates || []).filter((c) => c.selected).length,
    [candidates]
  );

  const toggleCandidateSelection = (index: number) => {
    setCandidates((prev) =>
      (prev || []).map((item, idx) => {
        if (idx !== index) return item;
        if (!item.selected && selectedCandidatesCount >= 3) return item;
        return { ...item, selected: !item.selected };
      })
    );
  };

  const expandBox = (
    box: DetectBox,
    attrs?: CandidateAttrs,
    mode: 'display' | 'crop' = 'display'
  ): DetectBox => {
    const title = String(attrs?.title || '').toLowerCase();
    const category = String(attrs?.category || '').toLowerCase();
    const tags = Array.isArray(attrs?.tags) ? attrs?.tags.map((t) => String(t).toLowerCase()) : [];
    const haystack = [title, category, ...tags].join(' ');

    let left = mode === 'crop' ? 0.05 : 0.04;
    let right = mode === 'crop' ? 0.05 : 0.04;
    let top = mode === 'crop' ? 0.05 : 0.04;
    let bottom = mode === 'crop' ? 0.06 : 0.04;

    const isTie = haystack.includes('галст');
    const isTrousers = haystack.includes('брюк') || haystack.includes('брюки') || category.includes('низ');
    const isJacket =
      haystack.includes('пиджак') ||
      haystack.includes('рубаш') ||
      haystack.includes('верх') ||
      haystack.includes('жакет');

    if (isTie) {
      left += mode === 'crop' ? 0.03 : 0.025;
      right += mode === 'crop' ? 0.03 : 0.025;
      top += mode === 'crop' ? 0.08 : 0.06;
      bottom += mode === 'crop' ? 0.18 : 0.12;
    }

    if (isTrousers) {
      left += mode === 'crop' ? 0.05 : 0.04;
      right += mode === 'crop' ? 0.05 : 0.04;
      top += mode === 'crop' ? 0.03 : 0.02;
      bottom += mode === 'crop' ? 0.16 : 0.12;
    }

    if (isJacket) {
      left += mode === 'crop' ? 0.05 : 0.04;
      right += mode === 'crop' ? 0.05 : 0.04;
      top += mode === 'crop' ? 0.05 : 0.04;
      bottom += mode === 'crop' ? 0.08 : 0.06;
    }

    const x = Math.max(0, box.x - left);
    const y = Math.max(0, box.y - top);
    const maxX = Math.min(1, box.x + box.w + right);
    const maxY = Math.min(1, box.y + box.h + bottom);

    return {
      x,
      y,
      w: Math.max(0.02, maxX - x),
      h: Math.max(0.02, maxY - y),
    };
  };

  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const getDotPoint = (box: DetectBox, attrs?: CandidateAttrs) => {
    const title = String(attrs?.title || '').toLowerCase();
    const category = String(attrs?.category || '').toLowerCase();
    const tags = Array.isArray(attrs?.tags) ? attrs?.tags.map((t) => String(t).toLowerCase()) : [];
    const haystack = [title, category, ...tags].join(' ');

    const isTie = haystack.includes('галст');
    const isFootwear =
      haystack.includes('ботин') ||
      haystack.includes('кроссов') ||
      haystack.includes('туф') ||
      haystack.includes('обув');
    const isBottom =
      haystack.includes('джинс') ||
      haystack.includes('брюк') ||
      haystack.includes('брюки') ||
      haystack.includes('низ');
    const isShirt =
      haystack.includes('рубаш');
    const isJacket =
      haystack.includes('кардиган') ||
      haystack.includes('пиджак') ||
      haystack.includes('свитер') ||
      haystack.includes('худи') ||
      haystack.includes('верх');
    const isTee =
      haystack.includes('футбол');

    let x = box.x + box.w * 0.5;
    let y = box.y + box.h * 0.38;

    if (isTie) {
      x = box.x + box.w * 0.5;
      y = box.y + box.h * 0.63;
    } else if (isShirt) {
      x = box.x + box.w * 0.48;
      y = box.y + box.h * 0.34;
    } else if (isTee) {
      x = box.x + box.w * 0.5;
      y = box.y + box.h * 0.42;
    } else if (isJacket) {
      x = box.x + box.w * 0.52;
      y = box.y + box.h * 0.5;
    } else if (isBottom) {
      x = box.x + box.w * 0.5;
      y = box.y + box.h * 0.22;
    } else if (isFootwear) {
      x = box.x + box.w * 0.5;
      y = box.y + box.h * 0.58;
    }

    return {
      x: clamp01(x),
      y: clamp01(y),
    };
  };

  const getResolvedDotPoints = (items: WardrobeCandidate[]) => {
    const placed: Array<{ x: number; y: number }> = [];

    return items.map((c) => {
      if (!c?.box) return null;

      const displayBox = expandBox(c.box, c.attributes, 'display');
      const base = getDotPoint(displayBox, c.attributes);
      const next = { ...base };

      for (const prev of placed) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.085) {
          next.y = clamp01(next.y + 0.075);
          next.x = clamp01(next.x + (dx >= 0 ? 0.018 : -0.018));
        }
      }

      placed.push(next);
      return next;
    });
  };

  const cropImageToBox = (dataUrl: string, box: DetectBox) =>
    new Promise<string>((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        try {
          const sx = Math.round(box.x * img.width);
          const sy = Math.round(box.y * img.height);
          const sw = Math.max(1, Math.round(box.w * img.width));
          const sh = Math.max(1, Math.round(box.h * img.height));

          const canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = sh;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Не удалось получить canvas context'));
            return;
          }

          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => reject(new Error('Не удалось загрузить изображение для crop'));
      img.src = dataUrl;
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setCandidates(null);
    setPendingExtracted([]);
    setIsRecognizing(true);
    try {
      const original = await readAsDataUrl(file);

      // Frontend validation: must be a valid image data URL (photoDataUrl expects data:image/...)
      if (!file.type || !file.type.startsWith("image/")) throw new Error("Пожалуйста, выберите файл изображения (JPG/PNG/WEBP)");
      if (!original || typeof original !== "string" || !original.startsWith("data:image/")) throw new Error("Не удалось прочитать изображение (некорректный формат)");
      if (original.length < 32) throw new Error("Изображение слишком маленькое или повреждено");
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
      const items = data?.items || [];

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Сервер не вернул распознанные вещи');
      }

      if (items.length > 1) {
        setCandidates(items.map((i: any, idx: number) => ({
          id: String(idx),
          original,
          selected: false,
          cutoutDataUrl: i?.cutoutDataUrl || '',
          box: normalizeCandidateBox(i?.box),
          attributes: i?.attributes || {
            title: i?.title || '',
            category: i?.category || '',
            gender: i?.gender || '',
            tags: Array.isArray(i?.tags) ? i.tags : [],
            color: i?.color || '',
            material: i?.material || '',
          },
        })));
        return;
      }

      const cutout = items?.[0]?.cutoutDataUrl || data?.cutoutDataUrl;
      const attrs = items?.[0]?.attributes || data?.attributes || {};

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

  const processSelectedCandidates = async () => {
    const selected = (candidates || []).filter((c) => c?.selected);
    if (!selected.length) {
      setExtractError('Выберите хотя бы одну вещь');
      return;
    }
    if (selected.length > 3) {
      setExtractError('Можно выбрать не более 3 вещей за раз');
      return;
    }

    setExtractError(null);
    setIsRecognizing(true);

    try {
      const queue: Array<{ original: string; cutout: string; attrs: any }> = [];

      for (const c of selected) {
        let photoDataUrlForCutout = c.original;

        if (c.box) {
          try {
            const expandedCropBox = expandBox(c.box, c.attributes, 'crop');
            photoDataUrlForCutout = await cropImageToBox(c.original, expandedCropBox);
          } catch (err) {
            console.warn('[wardrobe] crop before cutout failed, fallback to original', err);
          }
        }

        const resp = await fetch('/api/wardrobe/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photoDataUrl: photoDataUrlForCutout,
            hintCategory: c?.attributes?.category,
            targetItem: c?.attributes || {},
          }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data?.error || `Ошибка сервера (${resp.status})`);
        }

        const data = await resp.json();
        const cutout = data?.cutoutDataUrl;
        const attrs = data?.attributes || c?.attributes || {};

        if (!cutout) throw new Error('Сервер не вернул вырезанную вещь');

        queue.push({
          original: c.original,
          cutout,
          attrs,
        });
      }

      if (!queue.length) {
        throw new Error('Не удалось вырезать выбранные вещи');
      }

      const [first, ...rest] = queue;
      setPendingExtracted(rest);
      setExtracted(first);
      setDraftTitle(first.attrs?.title || 'Моя вещь');
      setDraftCategory((Object.values(Category) as any).includes(first.attrs?.category) ? first.attrs.category : Category.TOPS);
      setDraftGender((Object.values(Gender) as any).includes(first.attrs?.gender) ? first.attrs.gender : Gender.UNISEX);
      setDraftTags(Array.isArray(first.attrs?.tags) ? first.attrs.tags.join(', ') : '');
      setDraftColor(first.attrs?.color || '');
      setDraftMaterial(first.attrs?.material || '');
      setCandidates(null);
    } catch (err: any) {
      setExtractError(err?.message || 'Не удалось вырезать выбранные вещи');
    } finally {
      setIsRecognizing(false);
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

      if (pendingExtracted.length > 0) {
        const [next, ...rest] = pendingExtracted;
        setPendingExtracted(rest);
        setExtracted(next);
        setDraftTitle(next.attrs?.title || 'Моя вещь');
        setDraftCategory((Object.values(Category) as any).includes(next.attrs?.category) ? next.attrs.category : Category.TOPS);
        setDraftGender((Object.values(Gender) as any).includes(next.attrs?.gender) ? next.attrs.gender : Gender.UNISEX);
        setDraftTags(Array.isArray(next.attrs?.tags) ? next.attrs.tags.join(', ') : '');
        setDraftColor(next.attrs?.color || '');
        setDraftMaterial(next.attrs?.material || '');
      } else {
        setExtracted(null);
      }
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

        <div className="rounded-3xl border border-zinc-200 bg-white p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Быстрый старт</div>
            <div className="text-sm font-semibold">Добавь свою вещь по фото → она появится в шкафу → дальше можно примерять</div>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 px-4 py-3 rounded-2xl bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all"
          >
            Загрузить фото
          </button>
        </div>


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
        {(isRecognizing || candidates || extracted || extractError) && (
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
                  
        {candidates && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold uppercase tracking-widest">
              Выберите вещи
            </h3>

            {hasBoxes ? (
              <>
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  Нажмите на вещь прямо на фото • максимум 3
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                  <img
                    src={withApiOrigin(candidates[0]?.original)}
                    alt=""
                    className="w-full max-h-[50vh] object-contain"
                  />
                  <div className="absolute inset-0">
                    {candidates.map((c, i) => {
                      if (!c?.box) return null;
                      const dot = resolvedDotPoints[i];
                      if (!dot) return null;
                      const title = c?.attributes?.title || `Вещь ${i + 1}`;
                      const isActive = c.selected || hoveredCandidateId === c.id;

                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCandidateSelection(i)}
                          onMouseEnter={() => setHoveredCandidateId(c.id)}
                          onMouseLeave={() => setHoveredCandidateId(null)}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border font-black shadow-sm transition-all ${
                            isActive
                              ? 'bg-zinc-900 text-white border-zinc-900 scale-110 ring-4 ring-white/70'
                              : 'bg-white/95 text-zinc-900 border-white hover:scale-105'
                          } ${c.selected ? 'w-9 h-9 text-[12px]' : 'w-8 h-8 text-[11px]'}`}
                          style={{
                            left: `${dot.x * 100}%`,
                            top: `${dot.y * 100}%`,
                          }}
                          aria-label={title}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {candidates.map((c, i) => {
                    const isActive = c?.selected || hoveredCandidateId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCandidateSelection(i)}
                        onMouseEnter={() => setHoveredCandidateId(c.id)}
                        onMouseLeave={() => setHoveredCandidateId(null)}
                        className={`w-full rounded-xl px-4 py-3 text-left transition flex items-start gap-3 border ${
                          c?.selected
                            ? 'border-zinc-900 bg-zinc-50'
                            : isActive
                              ? 'border-zinc-400 bg-zinc-50'
                              : 'border-zinc-200 hover:border-zinc-900'
                        }`}
                      >
                        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black transition-all ${
                          c?.selected
                            ? 'bg-zinc-900 text-white'
                            : isActive
                              ? 'bg-zinc-200 text-zinc-900'
                              : 'bg-zinc-100 text-zinc-900'
                        }`}>
                          {i + 1}
                        </div>

                        <div className="min-w-0">
                          <div className="text-xs font-bold uppercase tracking-widest text-zinc-900">
                            {c?.attributes?.title || `Вещь ${i + 1}`}
                          </div>
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                            {c?.attributes?.category || 'Категория'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                {candidates.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCandidateSelection(i)}
                    className={`w-full rounded-xl px-4 py-3 text-left transition flex items-start gap-3 border ${
                      c?.selected
                        ? 'border-zinc-900 bg-zinc-50'
                        : 'border-zinc-200 hover:border-zinc-900'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold uppercase tracking-widest text-zinc-900">
                        {c?.attributes?.title || `Вещь ${i + 1}`}
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                        {c?.attributes?.category || 'Категория'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setCandidates(null)}
                className="flex-1 border border-zinc-200 py-4 rounded-full text-xs font-bold uppercase tracking-widest"
              >
                Отмена
              </button>
              <button
                onClick={processSelectedCandidates}
                className="flex-1 bg-zinc-900 text-white py-4 rounded-full text-xs font-bold uppercase tracking-widest"
              >
                Вырезать выбранные{selectedCandidatesCount ? ` (${selectedCandidatesCount})` : ''}
              </button>
            </div>
          </div>
        )}

                  {extracted && (
                    <div className="space-y-4">
                      <div className="flex gap-3">
                        <div className="w-28 h-28 rounded-2xl bg-zinc-50 border border-zinc-100 p-2 flex items-center justify-center">
                          <img src={withApiOrigin(extracted.cutout)} className="w-full h-full object-contain mix-blend-multiply" />
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
