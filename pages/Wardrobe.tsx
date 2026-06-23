import React, { useState, useRef, useMemo, useEffect } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { catalogImageSrc } from "../utils/catalogImageSrc";
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<WardrobeItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuItem, setMenuItem] = useState<WardrobeItem | null>(null);
  const [swipedItemId, setSwipedItemId] = useState<string | null>(null);
  const [wardrobePriceDrops, setWardrobePriceDrops] = useState<any[]>([]);
  const [priceDropsLoading, setPriceDropsLoading] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchCurrentXRef = useRef<number | null>(null);


  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredItems =
    activeCategory === 'all'
      ? wardrobe
      : wardrobe.filter((i) => i.category === activeCategory);

  useEffect(() => {
    let cancelled = false;

    if (!user?.id) {
      setWardrobePriceDrops([]);
      return;
    }

    const hasCatalogItems = wardrobe.some((item) => item?.sourceType === 'catalog' || item?.isCatalog);
    if (!hasCatalogItems) {
      setWardrobePriceDrops([]);
      return;
    }

    (async () => {
      setPriceDropsLoading(true);
      try {
        const resp = await fetch(withApiOrigin('/api/wardrobe/price-drops?limit=8&days=30'), {
          credentials: 'include',
        });

        if (!resp.ok) {
          if (!cancelled) setWardrobePriceDrops([]);
          return;
        }

        const data = await resp.json().catch(() => ({}));
        const items = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.products)
            ? data.products
            : [];

        if (!cancelled) setWardrobePriceDrops(items);
      } catch {
        if (!cancelled) setWardrobePriceDrops([]);
      } finally {
        if (!cancelled) setPriceDropsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, wardrobe.length]);

  const isCatalogWardrobeItem = (item: WardrobeItem | null | undefined) =>
    item?.sourceType === 'catalog' || !!item?.isCatalog;

  const normalizeWardrobeColorFamily = (item: WardrobeItem) => {
    const direct = String((item as any)?.colorFamily || item.color || '').trim().toLowerCase();

    const hay = [
      direct,
      item.title,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();

    const map: Array<[RegExp, string]> = [
      [/черн|чёрн|black/, 'black'],
      [/бел|white/, 'white'],
      [/сер|gray|grey|silver/, 'gray'],
      [/беж|beige/, 'beige'],
      [/корич|brown/, 'brown'],
      [/син|голуб|blue/, 'blue'],
      [/зел|green|khaki|хаки/, 'green'],
      [/крас|бордов|red|burgundy/, 'red'],
      [/роз|pink/, 'pink'],
      [/фиолет|сирен|purple/, 'purple'],
      [/желт|жёлт|yellow|gold/, 'yellow'],
      [/оранж|orange/, 'orange'],
      [/мульти|разноцвет|multi/, 'multi'],
    ];

    for (const [re, color] of map) {
      if (re.test(hay)) return color;
    }

    return '';
  };


  const inferWardrobeClothingTypeFromItem = (item: WardrobeItem): string => {
    const hay = [
      item.title,
      item.color,
      item.material,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();

    if (/карго|cargo/.test(hay)) return 'CARGO_PANTS';
    if (/чинос|chino/.test(hay)) return 'CHINOS';
    if (/джоггер|jogger/.test(hay)) return 'JOGGERS';
    if (/шорт|shorts/.test(hay)) return 'SHORTS';
    if (/леггин|лосин|legging/.test(hay)) return 'LEGGINGS';
    if (/классическ.*брюк|костюмн.*брюк|formal trouser|slacks/.test(hay)) return 'FORMAL_TROUSERS';

    if (/пальто|coat/.test(hay)) return 'COATS';
    if (/пухов|дутик|puffer|down jacket/.test(hay)) return 'PUFFER_JACKETS';
    if (/бомбер|bomber/.test(hay)) return 'BOMBERS';
    if (/парка|parka/.test(hay)) return 'PARKAS';
    if (/тренч|плащ|trench/.test(hay)) return 'TRENCHES';
    if (/кожан|leather/.test(hay)) return 'LEATHER_JACKETS';
    if (/джинсов.*куртк|denim jacket/.test(hay)) return 'DENIM_JACKETS';
    if (/жилет|vest|gilet/.test(hay)) return 'VESTS';

    if (/куртка[-\s]?рубаш|рубашка[-\s]?куртк|overshirt/.test(hay)) return 'OVERSHIRTS';
    if (/льнян.*рубаш|linen shirt/.test(hay)) return 'LINEN_SHIRTS';
    if (/джинсов.*рубаш|denim shirt/.test(hay)) return 'DENIM_SHIRTS';
    if (/классическ.*рубаш|formal shirt|dress shirt/.test(hay)) return 'FORMAL_SHIRTS';
    if (/кардиган|cardigan/.test(hay)) return 'CARDIGANS';
    if (/водолазк|turtleneck/.test(hay)) return 'TURTLENECKS';
    if (/свитер|джемпер|sweater/.test(hay)) return 'SWEATERS';

    return '';
  };

  const buildSimilarCatalogHref = (item: WardrobeItem) => {
    const params = new URLSearchParams();

    // “Найти похожее” should search by product meaning, not by exact title/brand.
    // Exact q often drags the original brand/manufacturer into results and makes
    // recommendations worse. Use category + gender + color instead.
    switch (item.category) {
      case Category.TOPS:
        params.set('displayCategory', 'CLOTHING');
        params.set('clothingType', inferWardrobeClothingTypeFromItem(item) || 'TOPS');
        break;
      case Category.BOTTOMS:
        params.set('displayCategory', 'CLOTHING');
        params.set('clothingType', inferWardrobeClothingTypeFromItem(item) || 'TROUSERS');
        break;
      case Category.DRESSES:
        params.set('displayCategory', 'CLOTHING');
        params.set('clothingType', 'DRESSES');
        break;
      case Category.OUTERWEAR:
        params.set('displayCategory', 'CLOTHING');
        params.set('clothingType', inferWardrobeClothingTypeFromItem(item) || 'OUTERWEAR');
        break;
      case Category.SHOES:
        params.set('displayCategory', 'SHOES');
        break;
      case Category.ACCESSORIES:
        params.set('displayCategory', 'ACCESSORIES');
        break;
      default:
        break;
    }

    if (item.gender && item.gender !== Gender.UNISEX) {
      params.set('gender', String(item.gender));
    }

    const colorFamily = normalizeWardrobeColorFamily(item);
    if (colorFamily) {
      params.set('colorFamily', colorFamily);
    }

    params.set('unavailable', '1');

    return `/catalog?${params.toString()}`;
  };

  const openBuyForWardrobeItem = (item: WardrobeItem) => {
    if (!isCatalogWardrobeItem(item)) return;

    const url = withApiOrigin(
      `/api/out/product/${encodeURIComponent(item.id)}?placement=wardrobe`
    );

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openBuyForWardrobePriceDrop = (item: any) => {
    const productId = String(item?.id || item?.productId || item?.wardrobeItemId || '').trim();
    if (!productId) return;

    const url = withApiOrigin(
      `/api/out/product/${encodeURIComponent(productId)}?placement=wardrobe_price_drop&wardrobeItemId=${encodeURIComponent(String(item?.wardrobeItemId || ''))}`
    );

    window.open(url, '_blank', 'noopener,noreferrer');
  };

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

  const resolvedDotPoints = useMemo(
    () => getResolvedDotPoints(candidates || []),
    [candidates]
  );

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

  // /api/wardrobe/save receives two data URLs in one JSON request.
  // Keep the final storage payload safely below the reverse-proxy limit.
  const WARDROBE_SAVE_MAX_DATA_URL_CHARS = 280 * 1024;
  const WARDROBE_SAVE_STEPS = [
    { maxSide: 1280, quality: 0.86 },
    { maxSide: 1100, quality: 0.80 },
    { maxSide: 960, quality: 0.74 },
    { maxSide: 820, quality: 0.68 },
    { maxSide: 700, quality: 0.62 },
    { maxSide: 600, quality: 0.58 },
  ];

  const optimizeWardrobeDataUrlForSave = (dataUrl: string, label: string) =>
    new Promise<string>((resolve, reject) => {
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        reject(new Error(`Не удалось подготовить изображение для сохранения: ${label}`));
        return;
      }

      const img = new Image();

      img.onload = () => {
        try {
          const sourceWidth = img.naturalWidth || img.width;
          const sourceHeight = img.naturalHeight || img.height;
          const sourceMaxSide = Math.max(sourceWidth, sourceHeight);

          for (const step of WARDROBE_SAVE_STEPS) {
            const scale = sourceMaxSide > 0 ? Math.min(1, step.maxSide / sourceMaxSide) : 1;
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Не удалось получить canvas context');

            // Both images are stored on a white background, so JPEG is safe
            // and substantially reduces the JSON request size.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            const candidate = canvas.toDataURL('image/jpeg', step.quality);

            if (candidate.length <= WARDROBE_SAVE_MAX_DATA_URL_CHARS) {
              resolve(candidate);
              return;
            }
          }

          reject(new Error('Изображение слишком большое для сохранения. Выберите фото меньшего размера.'));
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () =>
        reject(new Error(`Не удалось загрузить изображение для сохранения: ${label}`));

      img.src = dataUrl;
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setSuccessMessage(null);
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
    setSuccessMessage(null);
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

        const [originalForSave, cutoutForSave] = await Promise.all([
          optimizeWardrobeDataUrlForSave(photoDataUrlForCutout, 'оригинал вещи'),
          optimizeWardrobeDataUrlForSave(cutout, 'карточка вещи'),
        ]);

        queue.push({
          original: originalForSave,
          cutout: cutoutForSave,
          attrs,
        });
      }

      if (!queue.length) {
        throw new Error('Не удалось вырезать выбранные вещи');
      }

      if (!user?.id) {
        throw new Error('Чтобы добавлять вещи, нужно войти в аккаунт');
      }

      // 🔥 сразу сохраняем все вещи
      for (const item of queue) {
        const saveResp = await fetch('/api/wardrobe/save', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.attrs?.title || 'Моя вещь',
            category: item.attrs?.category || 'TOPS',
            gender: item.attrs?.gender || 'UNISEX',
            tags: Array.isArray(item.attrs?.tags) ? item.attrs.tags : [],
            color: item.attrs?.color || undefined,
            material: item.attrs?.material || undefined,
            originalDataUrl: item.original,
            cutoutDataUrl: item.cutout,
          }),
        });

        if (!saveResp.ok) {
          const data = await saveResp.json().catch(() => ({}));
          if (saveResp.status === 413) {
            throw new Error('Изображение слишком большое для сохранения. Попробуйте другое фото.');
          }
          throw new Error(data?.error || `Ошибка сохранения (${saveResp.status})`);
        }

        const data = await saveResp.json();
        const saved = data?.item;

        if (saved) {
          actions.upsertWardrobeItem({
            ...saved,
            addedAt: saved?.addedAt ? new Date(saved.addedAt) : new Date(),
          });
        }
      }

      // ✅ success feedback: сначала показать подтверждение, потом закрыть modal
      setSuccessMessage(`Добавлено ${queue.length} ${queue.length === 1 ? 'вещь' : queue.length < 5 ? 'вещи' : 'вещей'} в гардероб`);

      setTimeout(() => {
        setCandidates(null);
        setExtracted(null);
        setPendingExtracted([]);
        setSuccessMessage(null);
      }, 2200);
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
      const [originalForSave, cutoutForSave] = await Promise.all([
        optimizeWardrobeDataUrlForSave(extracted.original, 'оригинал вещи'),
        optimizeWardrobeDataUrlForSave(extracted.cutout, 'карточка вещи'),
      ]);

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
          originalDataUrl: originalForSave,
          cutoutDataUrl: cutoutForSave,
        }),
      });

      if (!saveResp.ok) {
        const data = await saveResp.json().catch(() => ({}));
        if (saveResp.status === 413)
          throw new Error('Изображение слишком большое для сохранения. Попробуйте другое фото.');
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

  const requestDeleteItem = (item: WardrobeItem) => {
    setPendingDeleteItem(item);
  };

  const confirmDeleteItem = async () => {
    if (!pendingDeleteItem || isDeleting) return;

    setIsDeleting(true);
    try {
      await actions.removeFromWardrobe(pendingDeleteItem.id);
      setPendingDeleteItem(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelDeleteItem = () => {
    if (isDeleting) return;
    setPendingDeleteItem(null);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (item: WardrobeItem) => {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      setMenuItem(item);
      longPressTimerRef.current = null;
    }, 420);
  };

  const closeItemMenu = () => {
    clearLongPressTimer();
    setMenuItem(null);
  };

  const openSimilarFromMenu = () => {
    if (!menuItem) return;

    const href = buildSimilarCatalogHref(menuItem);
    setMenuItem(null);
    navigate(href);
  };

  const openBuyFromMenu = () => {
    if (!menuItem || !isCatalogWardrobeItem(menuItem)) return;

    const item = menuItem;
    setMenuItem(null);
    openBuyForWardrobeItem(item);
  };

  const requestDeleteFromMenu = () => {
    if (!menuItem) return;
    setPendingDeleteItem(menuItem);
    setMenuItem(null);
  };

  const handleCardTouchStart = (e: React.TouchEvent<HTMLDivElement>, item: WardrobeItem) => {
    startLongPress(item);
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    touchCurrentXRef.current = touchStartXRef.current;
  };

  const handleCardTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    clearLongPressTimer();
    touchCurrentXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleCardTouchEnd = (item: WardrobeItem) => {
    clearLongPressTimer();

    const startX = touchStartXRef.current;
    const endX = touchCurrentXRef.current;

    touchStartXRef.current = null;
    touchCurrentXRef.current = null;

    if (startX == null || endX == null) return;

    const deltaX = endX - startX;

    if (deltaX <= -42) {
      setSwipedItemId(item.id);
      return;
    }

    if (deltaX >= 24 && swipedItemId === item.id) {
      setSwipedItemId(null);
      return;
    }
  };

  const closeSwipedItem = () => {
    setSwipedItemId(null);
  };

  return (
    <div className="pb-24">
      <div className="p-4 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="pt-2 text-2xl font-bold uppercase tracking-tighter">Мой Шкаф</h1>

          <div className="flex flex-col items-center gap-2 shrink-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-zinc-100 p-3 rounded-full hover:bg-zinc-900 hover:text-white transition-all shadow-sm"
            >
              <ICONS.Plus className="w-6 h-6" />
            </button>
            <div className="text-[11px] text-zinc-400 text-center leading-none whitespace-nowrap">
              Добавьте вещь по фото
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept="image/*"
            />
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
        {(isRecognizing || candidates || extracted || extractError || successMessage) && (
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

                  {successMessage && (
                    <div className="p-3 rounded-2xl bg-zinc-900 text-white text-xs font-bold uppercase tracking-widest">
                      {successMessage}
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

        {wardrobePriceDrops.length > 0 ? (
          <section className="rounded-[32px] border border-zinc-100 bg-zinc-50 p-4 space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-400">
                  Цена снизилась
                </p>
                <h2 className="mt-1 text-xl font-black uppercase tracking-tighter">
                  Подешевело в шкафу
                </h2>
              </div>
              {priceDropsLoading ? (
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                  Обновляем
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {wardrobePriceDrops.slice(0, 4).map((item: any) => {
                const image =
                  Array.isArray(item.images) && item.images[0]
                    ? item.images[0]
                    : (item.imageUrl || item.wardrobeImageUrl || '');

                const currentPrice = Number(item.currentPrice || item.price || 0);
                const previousPrice = Number(item.previousPrice || item.wardrobePrice || 0);
                const delta = Number(item.delta || (previousPrice > currentPrice ? previousPrice - currentPrice : 0));
                const deltaPct = Number(item.deltaPct || (previousPrice > currentPrice && previousPrice > 0 ? ((previousPrice - currentPrice) / previousPrice) * 100 : 0));
                const dropRub = Math.max(0, Math.round(delta));
                const discount = Math.max(0, Math.round(deltaPct));
                const detectedAtRaw = item.priceDropDetectedAt || item.detectedAt || '';
                const detectedAtDate = detectedAtRaw ? new Date(detectedAtRaw) : null;
                const detectedAtLabel =
                  detectedAtDate && !Number.isNaN(detectedAtDate.getTime())
                    ? new Intl.DateTimeFormat('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                      }).format(detectedAtDate)
                    : '';

                return (
                  <div key={`${item.wardrobeItemId || item.id}-${item.id}`} className="rounded-[24px] bg-white border border-zinc-100 p-3 shadow-sm">
                    <button
                      type="button"
                      onClick={() => navigate(`/product/${encodeURIComponent(item.id)}`)}
                      className="relative block w-full aspect-[3/4] rounded-[20px] bg-zinc-50 overflow-hidden"
                    >
                      {dropRub > 0 ? (
                        <div className="absolute left-2 top-2 z-10 rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-black text-white">
                          −{dropRub.toLocaleString('ru-RU')} ₽
                        </div>
                      ) : null}

                      {image ? (
                        <img
                          src={catalogImageSrc(image, { w: 420 })}
                          alt=""
                          className="w-full h-full object-contain"
                        />
                      ) : null}
                    </button>

                    <p className="mt-3 text-[10px] font-black uppercase tracking-tight line-clamp-2">
                      {item.title || item.wardrobeTitle || 'Товар'}
                    </p>

                    {detectedAtLabel ? (
                      <p className="mt-2 text-[10px] font-bold text-zinc-500">
                        Цена снизилась {detectedAtLabel}
                      </p>
                    ) : null}

                    {dropRub > 0 ? (
                      <p className="mt-1 text-[10px] font-black text-emerald-700">
                        Подешевело на {dropRub.toLocaleString('ru-RU')} ₽{discount > 0 ? ` • −${discount}%` : ''}
                      </p>
                    ) : null}

                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-xs font-black text-zinc-950">
                        {currentPrice.toLocaleString('ru-RU')} ₽
                      </p>
                      {previousPrice > currentPrice ? (
                        <p className="text-[10px] font-bold text-zinc-400 line-through">
                          {previousPrice.toLocaleString('ru-RU')} ₽
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => openBuyForWardrobePriceDrop(item)}
                      className="mt-3 h-9 w-full rounded-full bg-zinc-900 text-white text-[9px] font-black uppercase tracking-[0.16em]"
                    >
                      Купить дешевле
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {filteredItems.map((item) => {
              const isCatalogItem = item.sourceType === 'catalog' || item.isCatalog;

              return (
                <div
                  key={item.id}
                  onTouchStart={(e) => handleCardTouchStart(e, item)}
                  onTouchMove={handleCardTouchMove}
                  onTouchEnd={() => handleCardTouchEnd(item)}
                  onTouchCancel={closeSwipedItem}
                  className="relative aspect-[3/4] rounded-[24px] overflow-hidden md:group"
                >
                  <div className="absolute inset-y-0 right-0 w-16 flex items-center justify-center bg-red-500/90 md:hidden">
                    <button
                      onClick={() => requestDeleteItem(item)}
                      className="w-full h-full flex items-center justify-center text-white"
                      aria-label="Удалить вещь"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        ></path>
                      </svg>
                    </button>
                  </div>

                  <div
                    className={`relative h-full rounded-[24px] bg-white border border-zinc-100 transition-transform duration-200 overflow-hidden flex flex-col hover:border-zinc-300 hover:shadow-md ${
                      swipedItemId === item.id ? '-translate-x-16' : 'translate-x-0'
                    }`}
                  >
                    <div className="relative flex-1 min-h-0 m-2 mb-0 rounded-[20px] bg-zinc-50 p-3 flex items-center justify-center overflow-hidden">
                      <img
                        src={withApiOrigin(item.images?.[0])}
                        alt=""
                        className="max-w-full max-h-full object-contain mix-blend-multiply transition-all duration-500"
                      />

                      {!isCatalogItem && (
                        <div className="absolute top-2 left-2 bg-white/90 backdrop-blur px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-[0.18em] text-zinc-900 shadow-sm">
                          Ваше
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 p-3 pt-2 bg-white space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-tight text-zinc-900 line-clamp-2 pr-7 min-h-[28px]">
                        {item.title || 'Без названия'}
                      </div>

                      {isCatalogItem ? (
                        <>
                          <div className="text-[8px] uppercase tracking-[0.18em] text-zinc-400 truncate">
                            {item.storeName || item.storeId || 'Каталог'}
                          </div>
                          <div className="text-[11px] font-black text-zinc-900">
                            {item.price ? `${item.price} ₽` : ''}
                          </div>
                          <div className="pt-1 grid grid-cols-2 gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openBuyForWardrobeItem(item);
                              }}
                              className="h-8 rounded-full bg-zinc-900 text-white text-[8px] font-black uppercase tracking-[0.14em]"
                            >
                              Купить
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(buildSimilarCatalogHref(item));
                              }}
                              className="h-8 rounded-full bg-white border border-zinc-200 text-zinc-700 text-[8px] font-black uppercase tracking-[0.14em]"
                            >
                              Похожие
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(buildSimilarCatalogHref(item));
                          }}
                          className="mt-1 h-8 w-full rounded-full bg-white border border-zinc-200 text-zinc-700 text-[8px] font-black uppercase tracking-[0.14em]"
                        >
                          Похожие
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => requestDeleteItem(item)}
                      className="absolute top-2 right-2 transition-opacity bg-white/90 p-1.5 rounded-lg text-zinc-400 hover:text-red-500 shadow-sm z-10"
                      aria-label="Удалить вещь"
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
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-6">
          <div className="bg-zinc-900 text-white p-8 rounded-[40px] space-y-6 shadow-2xl overflow-hidden relative group">
      <button
        onClick={(e) => {
          e.stopPropagation();
          removeWardrobeItem(item.id);
        }}
        className="absolute top-2 right-2 w-7 h-7 bg-white/90 backdrop-blur rounded-full flex items-center justify-center text-xs font-bold hover:bg-red-500 hover:text-white transition z-10"
      >
        ×
      </button>

            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10 space-y-2">
              <h3 className="text-xl font-bold uppercase tracking-widest">Стилизовать образ</h3>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest leading-relaxed">
                Соберите образ из своих вещей и примерьте его на аватаре.
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

      {menuItem && (
        <div className="fixed inset-0 z-[109] bg-zinc-950/40 backdrop-blur-[2px] flex items-end justify-center p-3 md:hidden" onClick={closeItemMenu}>
          <div
            className="w-full max-w-md rounded-[28px] bg-white shadow-2xl border border-zinc-100 overflow-hidden animate-in slide-in-from-bottom-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 border-b border-zinc-100">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                Действия с вещью
              </div>
              <div className="mt-2 text-sm font-bold text-zinc-900 line-clamp-2">
                {menuItem.title || 'Без названия'}
              </div>
            </div>

            <div className="p-2">
              {isCatalogWardrobeItem(menuItem) && (
                <button
                  onClick={openBuyFromMenu}
                  className="w-full h-12 rounded-2xl text-left px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 transition"
                >
                  Посмотреть/купить у продавца
                </button>
              )}

              <button
                onClick={openSimilarFromMenu}
                className="w-full h-12 rounded-2xl text-left px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 transition"
              >
                Найти похожее
              </button>

              <button
                onClick={requestDeleteFromMenu}
                className="w-full h-12 rounded-2xl text-left px-4 text-sm font-medium text-red-600 hover:bg-red-50 transition"
              >
                Удалить
              </button>

              <button
                onClick={closeItemMenu}
                className="w-full h-12 rounded-2xl text-left px-4 text-sm font-medium text-zinc-500 hover:bg-zinc-50 transition"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteItem && (
        <div className="fixed inset-0 z-[110] bg-zinc-950/70 backdrop-blur-sm flex items-end md:items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-[32px] bg-white p-6 md:p-7 shadow-2xl space-y-5 animate-in zoom-in">
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-400">
                Подтвердите удаление
              </div>
              <h3 className="text-lg font-bold uppercase tracking-tight text-zinc-900">
                Удалить вещь из шкафа?
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {pendingDeleteItem.title || 'Эта вещь'} будет удалена из вашего шкафа.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-zinc-50 border border-zinc-100 p-3">
              <div className="w-16 h-16 rounded-2xl bg-white border border-zinc-100 p-2 flex items-center justify-center shrink-0 overflow-hidden">
                <img
                  src={withApiOrigin(pendingDeleteItem.images?.[0])}
                  alt=""
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-tight text-zinc-900 line-clamp-2">
                  {pendingDeleteItem.title || 'Без названия'}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-[0.18em] text-zinc-400">
                  {pendingDeleteItem.sourceType === 'catalog' || pendingDeleteItem.isCatalog ? 'Каталог' : 'Ваше'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={cancelDeleteItem}
                disabled={isDeleting}
                className="h-12 rounded-full border border-zinc-200 text-zinc-700 text-[10px] font-bold uppercase tracking-[0.18em] bg-white disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                onClick={confirmDeleteItem}
                disabled={isDeleting}
                className="h-12 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-[0.18em] disabled:opacity-60"
              >
                {isDeleting ? 'Удаляем...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Wardrobe;
