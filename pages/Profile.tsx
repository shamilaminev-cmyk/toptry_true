import React, { useEffect, useState } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { ICONS } from '../constants';

type UsageInfo = {
  plan: string;
  isAdmin: boolean;
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyRemaining: number;
  generationCreditsRemaining: number;
};

type ReferralInfo = {
  code: string;
  link: string;
  inviterRewardCredits: number;
  invitedRewardCredits: number;
  invitedCount: number;
  creditsRemaining: number;
};

type CreatorAnalyticsInfo = {
  days: number;
  totals: {
    all: number;
    profileViews: number;
    collectionOpens: number;
    tryonStarts: number;
    clickouts: number;
    followersCount: number;
    follows: number;
    unfollows: number;
  };
  popularCollections: any[];
  popularLooks: any[];
  recent: any[];
};

type CabinetTabId = 'overview' | 'data' | 'storefront' | 'collections' | 'stats' | 'support';

const CABINET_TABS: { id: CabinetTabId; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'data', label: 'Данные' },
  { id: 'storefront', label: 'Витрина' },
  { id: 'collections', label: 'Подборки' },
  { id: 'stats', label: 'Статистика' },
  { id: 'support', label: 'Поддержка' },
];

const Profile = () => {
  const { user, wardrobe, looks, actions } = useAppState();
  const navigate = useNavigate();

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sizeTop, setSizeTop] = useState(user?.sizeTop || '');
  const [sizeBottom, setSizeBottom] = useState(user?.sizeBottom || '');
  const [sizeShoes, setSizeShoes] = useState(user?.sizeShoes || '');
  const [catalogGenderPreference, setCatalogGenderPreference] = useState(user?.catalogGenderPreference || 'ALL');
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);
  const [supportTopic, setSupportTopic] = React.useState('Другое');
  const [supportMessage, setSupportMessage] = React.useState('');
  const [supportSending, setSupportSending] = React.useState(false);
  const [supportResult, setSupportResult] = React.useState('');
  const [supportError, setSupportError] = React.useState('');
  const [publicSlug, setPublicSlug] = React.useState(user?.publicSlug || '');
  const [publicDisplayName, setPublicDisplayName] = React.useState(user?.publicDisplayName || '');
  const [publicBio, setPublicBio] = React.useState(user?.publicBio || '');
  const [publicSocialUrl, setPublicSocialUrl] = React.useState(user?.publicSocialUrl || '');
  const [publicProfileSaving, setPublicProfileSaving] = React.useState(false);
  const [publicProfileResult, setPublicProfileResult] = React.useState('');
  const [publicProfileError, setPublicProfileError] = React.useState('');
  const [collections, setCollections] = React.useState<any[]>([]);
  const [collectionsLoading, setCollectionsLoading] = React.useState(false);
  const [collectionTitle, setCollectionTitle] = React.useState('');
  const [collectionDescription, setCollectionDescription] = React.useState('');
  const [collectionCreating, setCollectionCreating] = React.useState(false);
  const [collectionError, setCollectionError] = React.useState('');
  const [collectionResult, setCollectionResult] = React.useState('');
  const [publishedLooks, setPublishedLooks] = React.useState<any[]>([]);
  const [publishedLooksLoading, setPublishedLooksLoading] = React.useState(false);
  const [activeCollectionId, setActiveCollectionId] = React.useState('');
  const [addingLookIds, setAddingLookIds] = React.useState<Record<string, boolean>>({});

  const [creatorAnalytics, setCreatorAnalytics] = React.useState<CreatorAnalyticsInfo | null>(null);
  const [creatorAnalyticsLoading, setCreatorAnalyticsLoading] = React.useState(false);
  const [creatorAnalyticsError, setCreatorAnalyticsError] = React.useState('');
  const [activeCabinetTab, setActiveCabinetTab] = React.useState<CabinetTabId>('overview');

  useEffect(() => {
    if (!avatarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setAvatarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [avatarOpen, busy]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const freshUser = await actions.refreshMe();
        if (!cancelled && !freshUser) {
          setErr('Сессия истекла. Войдите заново, чтобы продолжить.');
          navigate('/auth');
        }
      } catch {
        // ignore: store handles session state
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSizeTop(user?.sizeTop || '');
    setSizeBottom(user?.sizeBottom || '');
    setSizeShoes(user?.sizeShoes || '');
    setCatalogGenderPreference(user?.catalogGenderPreference || 'ALL');
  }, [user?.sizeTop, user?.sizeBottom, user?.sizeShoes, user?.catalogGenderPreference]);

  useEffect(() => {
    setPublicSlug(user?.publicSlug || '');
    setPublicDisplayName(user?.publicDisplayName || '');
    setPublicBio(user?.publicBio || '');
    setPublicSocialUrl(user?.publicSocialUrl || '');
  }, [user?.publicSlug, user?.publicDisplayName, user?.publicBio, user?.publicSocialUrl]);

  useEffect(() => {
    if (user?.id) {
      loadCollections();
      loadPublishedLooks();
      loadCreatorAnalytics();
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadReferral = async () => {
      try {
        const res = await fetch('/api/referrals/me', {
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || 'Не удалось загрузить приглашения');
        }

        if (!cancelled) {
          setReferralInfo(data?.referral || null);
        }
      } catch (e) {
        console.warn('[profile referrals] failed', e);
      }
    };

    loadReferral();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadUsage = async () => {
      try {
        const res = await fetch('/api/usage/me', {
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || 'Не удалось загрузить лимиты');
        }

        if (!cancelled) {
          setUsageInfo(data?.usage || null);
        }
      } catch (e) {
        console.warn('[profile usage] failed', e);
      }
    };

    loadUsage();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const copyReferralLink = async () => {
    const link = referralInfo?.link;
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setReferralCopied(true);
      window.setTimeout(() => setReferralCopied(false), 1800);
    } catch {
      window.prompt('Скопируйте ссылку', link);
    }
  };

  const normalizePublicSlugInput = (value: string) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);

  const normalizedPublicSlug = normalizePublicSlugInput(publicSlug).replace(/^[-_]+|[-_]+$/g, '');

  const publicStorefrontUrl = `${window.location.origin}/#/u/${encodeURIComponent(user?.publicSlug || normalizedPublicSlug || user?.id || '')}`;

  const copyPublicStorefrontLink = async () => {
    try {
      await navigator.clipboard.writeText(publicStorefrontUrl);
      setPublicProfileResult('Ссылка на витрину скопирована');
      window.setTimeout(() => setPublicProfileResult(''), 1800);
    } catch {
      window.prompt('Скопируйте ссылку', publicStorefrontUrl);
    }
  };

  const savePublicProfile = async () => {
    setPublicProfileResult('');
    setPublicProfileError('');

    if (!normalizedPublicSlug || normalizedPublicSlug.length < 3) {
      setPublicProfileError('Короткая ссылка должна быть не короче 3 символов. Используйте латиницу, цифры, дефис или подчёркивание.');
      return;
    }

    setPublicProfileSaving(true);

    try {
      await actions.updatePublicProfile(normalizedPublicSlug, publicDisplayName, publicBio, publicSocialUrl);
      await actions.refreshMe();
      setPublicProfileResult('Публичная витрина сохранена');
    } catch (e: any) {
      if (e?.message === 'SESSION_EXPIRED') {
        setPublicProfileError('Сессия истекла. Войдите заново, чтобы сохранить витрину.');
        navigate('/auth');
        return;
      }

      setPublicProfileError(e?.message || 'Не удалось сохранить публичную витрину');
    } finally {
      setPublicProfileSaving(false);
    }
  };

  const loadCollections = async () => {
    setCollectionsLoading(true);
    setCollectionError('');

    try {
      const resp = await fetch('/api/profile/look-collections', {
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        navigate('/auth');
        return;
      }

      if (!resp.ok) {
        throw new Error(data?.error || 'Не удалось загрузить подборки');
      }

      setCollections(Array.isArray(data?.collections) ? data.collections : []);
    } catch (e: any) {
      setCollectionError(e?.message || 'Не удалось загрузить подборки');
    } finally {
      setCollectionsLoading(false);
    }
  };

  const createCollection = async () => {
    setCollectionError('');
    setCollectionResult('');

    const title = collectionTitle.trim();
    if (!title) {
      setCollectionError('Введите название подборки');
      return;
    }

    setCollectionCreating(true);

    try {
      const resp = await fetch('/api/profile/look-collections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: collectionDescription,
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        navigate('/auth');
        return;
      }

      if (!resp.ok) {
        throw new Error(data?.error || 'Не удалось создать подборку');
      }

      setCollectionTitle('');
      setCollectionDescription('');
      setCollectionResult('Подборка создана');
      await loadCollections();
    } catch (e: any) {
      setCollectionError(e?.message || 'Не удалось создать подборку');
    } finally {
      setCollectionCreating(false);
    }
  };

  const loadPublishedLooks = async () => {
    setPublishedLooksLoading(true);

    try {
      const resp = await fetch('/api/profile/published-looks', {
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        navigate('/auth');
        return;
      }

      if (!resp.ok) {
        throw new Error(data?.error || 'Не удалось загрузить опубликованные образы');
      }

      setPublishedLooks(Array.isArray(data?.looks) ? data.looks : []);
    } catch (e: any) {
      setCollectionError(e?.message || 'Не удалось загрузить опубликованные образы');
    } finally {
      setPublishedLooksLoading(false);
    }
  };

  const loadCreatorAnalytics = async () => {
    setCreatorAnalyticsLoading(true);
    setCreatorAnalyticsError('');

    try {
      const resp = await fetch('/api/profile/creator-analytics?days=7', {
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        navigate('/auth');
        return;
      }

      if (!resp.ok) {
        throw new Error(data?.error || 'Не удалось загрузить статистику витрины');
      }

      setCreatorAnalytics(data || null);
    } catch (e: any) {
      setCreatorAnalyticsError(e?.message || 'Не удалось загрузить статистику витрины');
      setCreatorAnalytics(null);
    } finally {
      setCreatorAnalyticsLoading(false);
    }
  };

  const addLookToCollection = async (collectionId: string, lookId: string) => {
    if (!collectionId || !lookId) return;

    setCollectionError('');
    setCollectionResult('');
    setAddingLookIds((prev) => ({ ...prev, [lookId]: true }));

    try {
      const resp = await fetch(`/api/profile/look-collections/${encodeURIComponent(collectionId)}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookId }),
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        navigate('/auth');
        return;
      }

      if (!resp.ok) {
        throw new Error(data?.error || 'Не удалось добавить образ в подборку');
      }

      setCollectionResult('Образ добавлен в подборку');
      await loadCollections();
    } catch (e: any) {
      setCollectionError(e?.message || 'Не удалось добавить образ в подборку');
    } finally {
      setAddingLookIds((prev) => ({ ...prev, [lookId]: false }));
    }
  };


  if (!user) {
    return (
      <div className="p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-zinc-100 rounded-full mx-auto flex items-center justify-center">
          <ICONS.User className="w-10 h-10 text-zinc-300" />
        </div>
        <h1 className="text-xl font-bold uppercase tracking-widest">Кабинет недоступен</h1>
        <p className="text-sm text-zinc-400">Войдите в аккаунт, чтобы увидеть кабинет, настройки и лимиты.</p>
        <button onClick={() => navigate('/auth')} className="bg-zinc-900 text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs">Войти</button>
      </div>
    );
  }

  const bigSrc = withApiOrigin(user.avatarUrl || user.selfieUrl || "");
  const hasTryOnPhoto = Boolean(user.avatarUrl || user.selfieUrl);
  const hasSizes = Boolean(user.sizeTop || user.sizeBottom || user.sizeShoes);
  const hasWardrobeItems = Array.isArray(wardrobe) && wardrobe.length > 0;
  const hasCreatedLooks = Array.isArray(looks) && looks.length > 0;

  const onboardingSteps = [
    {
      id: 'photo',
      title: 'Фото для примерки',
      description: hasTryOnPhoto
        ? 'Фото загружено. Его можно обновить в любой момент.'
        : 'Загрузите фото, чтобы примерять образы на себе.',
      done: hasTryOnPhoto,
      action: hasTryOnPhoto ? 'Обновить фото' : 'Загрузить фото',
      onClick: () => {
        setErr(null);
        setAvatarOpen(true);
      },
    },
    {
      id: 'sizes',
      title: 'Размеры',
      description: hasSizes
        ? 'Размеры указаны. Каталог сможет точнее показывать подходящие товары.'
        : 'Укажите размеры верха, низа или обуви для фильтра “Мой размер”.',
      done: hasSizes,
      action: hasSizes ? 'Изменить размеры' : 'Указать размеры',
      onClick: () => {
        document.getElementById('profile-sizes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    },
    {
      id: 'catalog',
      title: 'Выберите товары',
      description: hasWardrobeItems
        ? 'В шкафу уже есть товары. Можно собирать образы быстрее.'
        : 'Откройте каталог, добавьте вещи в шкаф или сразу соберите образ.',
      done: hasWardrobeItems,
      action: hasWardrobeItems ? 'Открыть шкаф' : 'Перейти в каталог',
      onClick: () => navigate(hasWardrobeItems ? '/wardrobe' : '/catalog'),
    },
    {
      id: 'create',
      title: 'Создайте первый образ',
      description: hasCreatedLooks
        ? 'Первый образ уже создан. Можно продолжать примерять новые сочетания.'
        : 'Выберите до 5 вещей и посмотрите, как они будут выглядеть на вас.',
      done: hasCreatedLooks,
      action: hasCreatedLooks ? 'Мои образы' : 'Создать образ',
      onClick: () => navigate(hasCreatedLooks ? '/looks' : '/create-look'),
    },
  ];

  const onboardingDoneCount = onboardingSteps.filter((step) => step.done).length;
  const onboardingProgressPct = Math.round((onboardingDoneCount / onboardingSteps.length) * 100);
  const onboardingAllDone = onboardingDoneCount === onboardingSteps.length;

  const planCode = String(usageInfo?.plan || 'FREE').toUpperCase();
  const planTitle = {
    FREE: 'Базовый',
    TESTER: 'Тестер',
    ADMIN: 'Администратор',
  }[planCode] || planCode;

  const planDescription = {
    FREE: 'Для знакомства с TopTry и регулярной примерки образов.',
    TESTER: 'Расширенный лимит для активного тестирования продукта.',
    ADMIN: 'Внутренний тариф команды TopTry с увеличенными лимитами.',
  }[planCode] || 'Индивидуальный режим доступа к генерациям.';

  const freeGenerationsRemaining = usageInfo
    ? Math.max(0, Math.min(usageInfo.dailyRemaining, usageInfo.monthlyRemaining))
    : 0;

  const totalGenerationsAvailable = usageInfo
    ? freeGenerationsRemaining + Math.max(0, usageInfo.generationCreditsRemaining || 0)
    : 0;

  const dailyProgressPct = usageInfo?.dailyLimit
    ? Math.min(100, Math.round((usageInfo.dailyUsed / usageInfo.dailyLimit) * 100))
    : 0;

  const monthlyProgressPct = usageInfo?.monthlyLimit
    ? Math.min(100, Math.round((usageInfo.monthlyUsed / usageInfo.monthlyLimit) * 100))
    : 0;

  const limitStatusText = usageInfo
    ? totalGenerationsAvailable > 0
      ? `Доступно генераций: ${totalGenerationsAvailable}`
      : 'Лимит генераций исчерпан'
    : 'Загружаем лимиты';

  const nextGenerationHint = usageInfo
    ? freeGenerationsRemaining > 0
      ? 'Следующая генерация войдёт в ваш дневной и месячный лимит.'
      : usageInfo.generationCreditsRemaining > 0
        ? 'Бесплатный лимит исчерпан, следующая генерация спишется из бонусов.'
        : 'Сегодня генерации недоступны. Можно пригласить друга и получить бонусы.'
    : 'Скоро покажем актуальные лимиты.';

  const submitSupportRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    const msg = supportMessage.trim();
    if (msg.length < 3) {
      setSupportError('Напишите, пожалуйста, чуть подробнее.');
      setSupportResult('');
      return;
    }

    setSupportSending(true);
    setSupportError('');
    setSupportResult('');

    try {
      const resp = await fetch('/api/support/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: supportTopic,
          message: msg,
          source: 'profile',
          pageUrl: window.location.href,
          context: {
            plan: usageInfo?.plan || null,
            dailyRemaining: usageInfo?.dailyRemaining ?? null,
            monthlyRemaining: usageInfo?.monthlyRemaining ?? null,
            generationCreditsRemaining: usageInfo?.generationCreditsRemaining ?? null,
          },
        }),
      });

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(json?.error || `Ошибка ${resp.status}`);
      }

      setSupportMessage('');
      setSupportResult(`Обращение отправлено. Номер: ${json?.request?.id || '—'}`);
    } catch (err: any) {
      setSupportError(err?.message || String(err));
    } finally {
      setSupportSending(false);
    }
  };

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

  const cabinetSectionClass = (tab: CabinetTabId, className: string) =>
    `${className} ${activeCabinetTab === tab ? '' : 'hidden'}`;

  const cabinetTabButtonClass = (tab: CabinetTabId) =>
    `shrink-0 h-10 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.16em] transition-colors ${
      activeCabinetTab === tab
        ? 'bg-zinc-900 text-white'
        : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
    }`;

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

        <section className="rounded-[32px] border border-zinc-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                Кабинет
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-900">
                Управление TopTry
              </h2>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                Данные, витрина автора, подборки, статистика, лимиты и поддержка собраны в одном месте.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate(`/u/${user.publicSlug || user.id}`)}
              className="h-10 px-4 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.16em]"
            >
              Открыть витрину
            </button>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {CABINET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCabinetTab(tab.id)}
                className={cabinetTabButtonClass(tab.id)}
                aria-pressed={activeCabinetTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        <section id="cabinet-stats" className={cabinetSectionClass('stats', 'bg-white rounded-[32px] p-6 space-y-5 border border-zinc-100 shadow-sm scroll-mt-24')}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                Статистика
              </p>
              <h2 className="mt-1 text-xl font-black tracking-tight">
                Статистика витрины
              </h2>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-2xl">
                Личная аналитика автора за 7 дней: просмотры, подписки, примерки и переходы к покупке.
              </p>
            </div>

            <button
              type="button"
              onClick={loadCreatorAnalytics}
              disabled={creatorAnalyticsLoading}
              className="h-10 px-4 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase tracking-[0.16em] disabled:opacity-50"
            >
              {creatorAnalyticsLoading ? 'Обновляем...' : 'Обновить'}
            </button>
          </div>

          {creatorAnalyticsError ? (
            <div className="rounded-2xl bg-red-50 border border-red-100 p-3 text-xs font-bold text-red-700">
              {creatorAnalyticsError}
            </div>
          ) : null}

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Событий</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.all || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Просмотры</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.profileViews || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Подборки</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.collectionOpens || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Примерки</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.tryonStarts || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Переходы</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.clickouts || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Подписчики</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.followersCount || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Новые</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.follows || 0}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Отписки</div>
              <div className="mt-2 text-2xl font-black">{creatorAnalytics?.totals?.unfollows || 0}</div>
            </div>
          </div>

          {(creatorAnalytics?.popularCollections || []).length ? (
            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.18em] text-zinc-900">
                Популярные подборки
              </h3>
              <div className="mt-3 grid gap-2">
                {(creatorAnalytics?.popularCollections || []).slice(0, 5).map((collection: any) => (
                  <div key={collection.collectionId} className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black">{collection.title}</div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        открытий: {collection.opens || 0} · событий: {collection.total || 0}
                      </div>
                    </div>
                    <div className="text-xl font-black">{collection.total || 0}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(creatorAnalytics?.popularLooks || []).length ? (
            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.18em] text-zinc-900">
                Самые примеряемые образы
              </h3>
              <div className="mt-3 grid gap-2">
                {(creatorAnalytics?.popularLooks || []).slice(0, 5).map((look: any) => (
                  <div key={look.lookId} className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black">{look.title}</div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        стартов примерки: {look.tryonStarts || 0} · переходов к покупке: {look.clickouts || 0}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/look/${look.lookId}`)}
                      className="h-9 px-3 rounded-full bg-white border border-zinc-100 text-[10px] font-black uppercase tracking-[0.14em]"
                    >
                      Смотреть
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section id="cabinet-overview" className={cabinetSectionClass('overview', 'scroll-mt-24 bg-zinc-900 text-white rounded-[32px] p-6 space-y-5 shadow-sm')}>
          {onboardingAllDone ? (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">
                  Обзор
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-tight">
                  Кабинет настроен
                </h2>
                <p className="mt-2 text-sm text-white/60 leading-relaxed max-w-xl">
                  Фото, размеры, шкаф и первый образ готовы. Можно создавать новые образы, развивать витрину и смотреть статистику.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {onboardingSteps.map((step) => (
                    <span
                      key={step.id}
                      className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/70"
                    >
                      ✓ {step.title}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/create-look')}
                  className="h-11 px-5 rounded-full bg-white text-zinc-900 text-[10px] font-black uppercase tracking-[0.18em]"
                >
                  Создать образ
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/u/${user.publicSlug || user.id}`)}
                  className="h-11 px-5 rounded-full bg-white/10 text-white text-[10px] font-black uppercase tracking-[0.18em] border border-white/10"
                >
                  Открыть витрину
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">
                    Быстрый старт
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight">
                    Настройте TopTry за несколько шагов
                  </h2>
                  <p className="mt-2 text-sm text-white/60 leading-relaxed max-w-xl">
                    Загрузите фото, укажите размеры, выберите товары и создайте первый образ.
                  </p>
                </div>

                <div className="shrink-0 rounded-2xl bg-white/10 px-4 py-3 text-right">
                  <div className="text-2xl font-black">{onboardingDoneCount}/{onboardingSteps.length}</div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">
                    готово
                  </div>
                </div>
              </div>

              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${onboardingProgressPct}%` }}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {onboardingSteps.map((step, idx) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={step.onClick}
                    className="text-left rounded-2xl bg-white/10 hover:bg-white/15 transition-colors p-4 border border-white/10"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                        step.done ? 'bg-white text-zinc-900' : 'bg-white/10 text-white/70'
                      }`}>
                        {step.done ? '✓' : idx + 1}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-black uppercase tracking-[0.08em]">
                            {step.title}
                          </div>
                          {step.done && (
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-white/60">
                              готово
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-white/60 leading-relaxed">
                          {step.description}
                        </p>
                        <div className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                          {step.action}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {onboardingDoneCount >= 2 ? (
                <div className="rounded-2xl bg-white text-zinc-900 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="text-sm font-black tracking-tight">
                      Можно переходить к примерке
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                      Вы уже готовы выбрать вещи и создать первый образ.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/create-look')}
                    className="h-10 px-4 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em]"
                  >
                    Создать образ
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
        <div id="cabinet-storefront" className={cabinetSectionClass('storefront', 'bg-white rounded-[32px] p-6 space-y-5 border border-zinc-100 shadow-sm')}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                Публичная витрина
              </p>
              <h2 className="mt-1 text-xl font-black tracking-tight">
                Ваша страница автора
              </h2>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-2xl">
                Оформите публичную страницу с примеряемыми образами. Эту ссылку можно отправлять подписчикам, партнёрам и брендам.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate(`/u/${user.publicSlug || user.id}`)}
                className="h-10 px-4 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase tracking-[0.16em]"
              >
                Открыть
              </button>
              <button
                type="button"
                onClick={copyPublicStorefrontLink}
                className="h-10 px-4 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.16em]"
              >
                Скопировать
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-[minmax(0,1fr)_220px] gap-3">
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Имя на витрине
              </span>
              <input
                value={publicDisplayName}
                onChange={(e) => setPublicDisplayName(e.target.value.slice(0, 80))}
                placeholder="Например: Шамиль Аминев или Bourbaki Style"
                className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-bold outline-none"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Короткая ссылка
              </span>
              <div className="flex items-center rounded-2xl border border-zinc-200 bg-zinc-50 overflow-hidden">
                <span className="pl-4 text-xs text-zinc-400">/u/</span>
                <input
                  value={publicSlug}
                  onChange={(e) => setPublicSlug(normalizePublicSlugInput(e.target.value))}
                  placeholder="shamil"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full h-12 bg-transparent px-2 text-sm font-bold outline-none"
                />
              </div>
              <span className="block text-[10px] font-bold text-zinc-400 leading-relaxed">
                Только латиница, цифры, дефис и подчёркивание. Минимум 3 символа.
              </span>
            </label>

            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Ссылка на соцсети
              </span>
              <input
                value={publicSocialUrl}
                onChange={(e) => setPublicSocialUrl(e.target.value)}
                placeholder="https://t.me/... или https://vk.com/..."
                className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-bold outline-none"
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
              Описание автора
            </span>
            <textarea
              value={publicBio}
              onChange={(e) => setPublicBio(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Например: собираю примеряемые образы для офиса, выходных и путешествий."
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm outline-none resize-none"
            />
            <span className="block text-right text-[10px] font-bold text-zinc-400">
              {publicBio.length}/280
            </span>
          </label>

          <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3 text-[11px] text-zinc-500 break-all">
            {publicStorefrontUrl}
          </div>

          {publicProfileResult ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 text-xs font-bold text-emerald-700">
              {publicProfileResult}
            </div>
          ) : null}

          {publicProfileError ? (
            <div className="rounded-2xl bg-red-50 border border-red-100 p-3 text-xs font-bold text-red-700">
              {publicProfileError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={savePublicProfile}
            disabled={publicProfileSaving}
            className="w-full h-12 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] disabled:opacity-50"
          >
            {publicProfileSaving ? 'Сохраняем...' : 'Сохранить витрину'}
          </button>
        </div>
        <div id="cabinet-collections" className={cabinetSectionClass('collections', 'bg-white rounded-[32px] scroll-mt-24 p-6 space-y-5 border border-zinc-100 shadow-sm')}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                Мои подборки
              </p>
              <h2 className="mt-1 text-xl font-black tracking-tight">
                Коллекции для витрины
              </h2>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-2xl">
                Собирайте опубликованные образы в тематические подборки: офис, выходные, вечер, сезонная капсула.
              </p>
            </div>

            <button
              type="button"
              onClick={loadCollections}
              disabled={collectionsLoading}
              className="h-10 px-4 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase tracking-[0.16em] disabled:opacity-50"
            >
              {collectionsLoading ? 'Обновляем...' : 'Обновить'}
            </button>
          </div>

          <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Название подборки
              </span>
              <input
                value={collectionTitle}
                onChange={(e) => setCollectionTitle(e.target.value.slice(0, 80))}
                placeholder="Например: Офис без скуки"
                className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-bold outline-none"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Описание
              </span>
              <input
                value={collectionDescription}
                onChange={(e) => setCollectionDescription(e.target.value.slice(0, 220))}
                placeholder="Коротко о стиле подборки"
                className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-bold outline-none"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={createCollection}
            disabled={collectionCreating}
            className="w-full h-12 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] disabled:opacity-50"
          >
            {collectionCreating ? 'Создаём...' : 'Создать подборку'}
          </button>

          {collectionResult ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 text-xs font-bold text-emerald-700">
              {collectionResult}
            </div>
          ) : null}

          {collectionError ? (
            <div className="rounded-2xl bg-red-50 border border-red-100 p-3 text-xs font-bold text-red-700">
              {collectionError}
            </div>
          ) : null}

          {collections.length ? (
            <div className="grid md:grid-cols-2 gap-3">
              {collections.map((collection) => {
                const collectionLooks = Array.isArray(collection.looks) ? collection.looks : [];

                return (
                  <div key={collection.id} className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black tracking-tight">
                          {collection.title}
                        </div>
                        {collection.description ? (
                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                            {collection.description}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
                        {collection.looksCount || 0}
                      </span>
                    </div>

                    {collectionLooks.length ? (
                      <div className="relative aspect-[4/3] rounded-2xl bg-zinc-100 overflow-hidden border border-white">
                        {collectionLooks.length === 1 ? (
                          <img
                            src={withApiOrigin(collectionLooks[0].resultImageUrl)}
                            alt=""
                            className="w-full h-full object-cover object-top"
                          />
                        ) : collectionLooks.length === 2 ? (
                          <div className="grid grid-cols-2 h-full gap-px bg-white">
                            {collectionLooks.slice(0, 2).map((look: any) => (
                              <div key={look.id} className="bg-zinc-100 overflow-hidden">
                                {look.resultImageUrl ? (
                                  <img src={withApiOrigin(look.resultImageUrl)} alt="" className="w-full h-full object-cover object-top" />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : collectionLooks.length === 3 ? (
                          <div className="grid grid-cols-2 h-full gap-px bg-white">
                            <div className="bg-zinc-100 overflow-hidden">
                              {collectionLooks[0]?.resultImageUrl ? (
                                <img src={withApiOrigin(collectionLooks[0].resultImageUrl)} alt="" className="w-full h-full object-cover object-top" />
                              ) : null}
                            </div>
                            <div className="grid grid-rows-2 gap-px">
                              {collectionLooks.slice(1, 3).map((look: any) => (
                                <div key={look.id} className="bg-zinc-100 overflow-hidden">
                                  {look.resultImageUrl ? (
                                    <img src={withApiOrigin(look.resultImageUrl)} alt="" className="w-full h-full object-cover object-top" />
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 grid-rows-2 h-full gap-px bg-white">
                            {collectionLooks.slice(0, 4).map((look: any) => (
                              <div key={look.id} className="bg-zinc-100 overflow-hidden">
                                {look.resultImageUrl ? (
                                  <img src={withApiOrigin(look.resultImageUrl)} alt="" className="w-full h-full object-cover object-top" />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="absolute top-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-900 shadow-sm">
                          {collectionLooks.length}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-white border border-dashed border-zinc-200 p-4 text-xs text-zinc-500">
                        В подборке пока нет образов.
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCollectionId((prev) => prev === collection.id ? '' : collection.id);
                          if (!publishedLooks.length) loadPublishedLooks();
                        }}
                        className="h-10 px-4 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.16em]"
                      >
                        Добавить образы
                      </button>

                      <button
                        type="button"
                        onClick={() => navigate(`/u/${user.publicSlug || user.id}`)}
                        className="h-10 px-4 rounded-full bg-white text-zinc-900 border border-zinc-200 text-[10px] font-black uppercase tracking-[0.16em]"
                      >
                        Открыть витрину
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-zinc-50 border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">
              Подборок пока нет. Создайте первую подборку, а затем добавьте в неё опубликованные образы.
            </div>
          )}

          {activeCollectionId ? (
            <div className="rounded-[28px] border border-zinc-100 bg-zinc-50 p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                    Добавление образов
                  </p>
                  <h3 className="mt-1 text-sm font-black tracking-tight">
                    Выберите опубликованные образы
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                    В подборки можно добавлять только опубликованные образы.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveCollectionId('')}
                  className="h-10 px-4 rounded-full bg-white text-zinc-900 border border-zinc-200 text-[10px] font-black uppercase tracking-[0.16em]"
                >
                  Закрыть
                </button>
              </div>

              {publishedLooksLoading ? (
                <div className="rounded-2xl bg-white p-5 text-sm text-zinc-500">
                  Загружаем опубликованные образы...
                </div>
              ) : publishedLooks.length ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  {publishedLooks.map((look) => {
                    const activeCollection = collections.find((collection) => collection.id === activeCollectionId);
                    const alreadyInCollection = Boolean(
                      activeCollection?.looks?.some((item: any) => String(item.id) === String(look.id))
                    );

                    return (
                      <div key={look.id} className="rounded-2xl bg-white border border-zinc-100 overflow-hidden">
                        <div className="aspect-[3/4] bg-zinc-100">
                          {look.resultImageUrl ? (
                            <img src={withApiOrigin(look.resultImageUrl)} alt="" className="w-full h-full object-cover" />
                          ) : null}
                        </div>
                        <div className="p-3 space-y-3">
                          <div className="text-xs font-black tracking-tight line-clamp-2">
                            {look.title || 'Образ TopTry'}
                          </div>

                          <button
                            type="button"
                            onClick={() => addLookToCollection(activeCollectionId, look.id)}
                            disabled={alreadyInCollection || Boolean(addingLookIds[look.id])}
                            className="w-full h-9 rounded-full bg-zinc-900 text-white text-[9px] font-black uppercase tracking-[0.14em] disabled:bg-zinc-100 disabled:text-zinc-400"
                          >
                            {alreadyInCollection ? 'Уже в подборке' : addingLookIds[look.id] ? 'Добавляем...' : 'Добавить'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-white p-5 text-sm text-zinc-500">
                  У вас пока нет опубликованных образов. Опубликуйте образ, чтобы добавить его в подборку.
                </div>
              )}
            </div>
          ) : null}
        </div>





        <form id="cabinet-support" onSubmit={submitSupportRequest} className={cabinetSectionClass('support', 'bg-white scroll-mt-24 rounded-[32px] p-6 space-y-5 border border-zinc-100 shadow-sm')}>
          <div>
            <p className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest">
              Связаться с TopTry
            </p>
            <h2 className="mt-2 text-xl font-black tracking-tight text-zinc-900">
              Напишите нам, если что-то пошло не так
            </h2>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              Можно сообщить о проблеме с генерацией, товаром, лимитами или предложить улучшение.
            </p>
          </div>

          <div className="grid md:grid-cols-[220px_1fr] gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Тема
              </span>
              <select
                value={supportTopic}
                onChange={(e) => setSupportTopic(e.target.value)}
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              >
                <option value="Проблема с генерацией">Проблема с генерацией</option>
                <option value="Проблема с товаром">Проблема с товаром</option>
                <option value="Лимиты / генерации">Лимиты / генерации</option>
                <option value="Хочу стать тестером">Хочу стать тестером</option>
                <option value="Оплата / тарифы">Оплата / тарифы</option>
                <option value="Предложение">Предложение</option>
                <option value="Другое">Другое</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                Сообщение
              </span>
              <textarea
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                placeholder="Опишите, что произошло или что хотелось бы улучшить..."
                rows={4}
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900 resize-none"
              />
            </label>
          </div>

          {(supportError || supportResult) && (
            <div className={`rounded-2xl p-4 text-xs leading-relaxed ${
              supportError
                ? 'bg-rose-50 text-rose-700 border border-rose-100'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
            }`}>
              {supportError || supportResult}
            </div>
          )}

          <button
            type="submit"
            disabled={supportSending}
            className="h-11 px-5 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] disabled:opacity-50"
          >
            {supportSending ? 'Отправляем…' : 'Отправить сообщение'}
          </button>
        </form>

        <div id="cabinet-plan" className={cabinetSectionClass('overview', 'bg-zinc-50 rounded-[32px] p-6 space-y-6 border border-zinc-100')}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest">
                Тариф и генерации
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] bg-zinc-900 text-white">
                  {planCode}
                </div>
                <div className="inline-flex px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] bg-white border border-zinc-100 text-zinc-700">
                  {planTitle}
                </div>
              </div>

              <div>
                <h2 className="text-xl font-black tracking-tight text-zinc-900">
                  {limitStatusText}
                </h2>
                <p className="mt-2 text-xs text-zinc-500 leading-relaxed max-w-xl">
                  {planDescription} {nextGenerationHint}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/create-look')}
              className="shrink-0 h-11 px-5 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em]"
            >
              Создать образ
            </button>
          </div>

          {usageInfo ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-zinc-100">
                  <p className="text-[10px] font-bold uppercase text-zinc-400 mb-1">
                    Сегодня
                  </p>
                  <p className="text-lg font-bold">
                    {usageInfo.dailyRemaining}
                    <span className="text-zinc-300 text-sm"> осталось</span>
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-400 uppercase tracking-widest">
                    использовано {usageInfo.dailyUsed} из {usageInfo.dailyLimit}
                  </p>
                  <div className="mt-3 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-zinc-900"
                      style={{ width: `${dailyProgressPct}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-zinc-100">
                  <p className="text-[10px] font-bold uppercase text-zinc-400 mb-1">
                    В этом месяце
                  </p>
                  <p className="text-lg font-bold">
                    {usageInfo.monthlyRemaining}
                    <span className="text-zinc-300 text-sm"> осталось</span>
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-400 uppercase tracking-widest">
                    использовано {usageInfo.monthlyUsed} из {usageInfo.monthlyLimit}
                  </p>
                  <div className="mt-3 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-zinc-900"
                      style={{ width: `${monthlyProgressPct}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-zinc-100">
                  <p className="text-[10px] font-bold uppercase text-zinc-400 mb-1">
                    Бонусные
                  </p>
                  <p className="text-lg font-bold">
                    {usageInfo.generationCreditsRemaining}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-400 uppercase tracking-widest">
                    сверх лимита тарифа
                  </p>
                  <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
                    Бонусы можно получить за приглашения или вручную от команды TopTry.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-zinc-100 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                  Как получить больше генераций
                </div>
                <div className="mt-3 grid md:grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-zinc-50 p-3">
                    <div className="text-xs font-black uppercase tracking-widest text-zinc-900">
                      Пригласить друга
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
                      Вы получите {referralInfo?.inviterRewardCredits || 3} бонусные генерации после регистрации друга.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-3">
                    <div className="text-xs font-black uppercase tracking-widest text-zinc-900">
                      Стать тестером
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
                      Для активных тестеров доступен расширенный лимит 20 / день и 100 / месяц.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-3">
                    <div className="text-xs font-black uppercase tracking-widest text-zinc-900">
                      Пакеты генераций
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
                      Платные пакеты появятся после запуска оплаты. Сейчас цены не финализированы.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-zinc-100 p-4 text-xs text-zinc-400">
              Загружаем лимиты генераций...
            </div>
          )}
        </div>

        <div id="cabinet-data" data-profile-sizes-anchor="1" className={cabinetSectionClass('data', 'bg-white rounded-[32px] p-6 space-y-4 border border-zinc-100 scroll-mt-24')}>
          <p className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest">
            Ваши размеры
          </p>

          <div className="grid grid-cols-2 gap-3">
            <select
              value={sizeTop}
              onChange={(e) => setSizeTop(e.target.value)}
              className="h-12 px-4 rounded-full border border-zinc-200 bg-white text-[10px] font-bold uppercase tracking-widest text-zinc-900"
            >
              <option value="">Верх</option>
              {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={sizeBottom}
              onChange={(e) => setSizeBottom(e.target.value)}
              className="h-12 px-4 rounded-full border border-zinc-200 bg-white text-[10px] font-bold uppercase tracking-widest text-zinc-900"
            >
              <option value="">Низ</option>
              {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <select
            value={sizeShoes}
            onChange={(e) => setSizeShoes(e.target.value)}
            className="w-full h-12 px-4 rounded-full border border-zinc-200 bg-white text-[10px] font-bold uppercase tracking-widest text-zinc-900"
          >
            <option value="">Обувь</option>
            {['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
              Для кого подбирать товары
            </span>
            <select
              value={catalogGenderPreference}
              onChange={(e) => setCatalogGenderPreference(e.target.value)}
              className="w-full h-12 px-4 rounded-full border border-zinc-200 bg-white text-[10px] font-bold uppercase tracking-widest text-zinc-900"
            >
              <option value="ALL">Показывать всё</option>
              <option value="MALE">Мужское</option>
              <option value="FEMALE">Женское</option>
              <option value="UNISEX">Унисекс</option>
            </select>
            <span className="block text-[11px] text-zinc-400 leading-relaxed">
              Это не обязательная анкета, а настройка каталога: её можно будет использовать как стартовый фильтр.
            </span>
          </label>

          <button
            onClick={async () => {
              setErr(null);
              try {
                await actions.updateProfileSizes(sizeTop, sizeBottom, sizeShoes, catalogGenderPreference);
                await actions.refreshMe();
                setErr('Размеры сохранены');
              } catch (e: any) {
                if (e?.message === 'SESSION_EXPIRED') {
                  setErr('Сессия истекла. Войдите заново, чтобы сохранить размеры.');
                  navigate('/auth');
                  return;
                }
                setErr(e?.message || 'Не удалось сохранить размеры');
              }
            }}
            className="w-full h-12 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-[0.18em]"
          >
            Сохранить размеры
          </button>
        </div>

        <div className={cabinetSectionClass('overview', 'bg-white border border-zinc-100 rounded-[28px] p-5 shadow-sm space-y-4')}>
          <div className="space-y-1">
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400">
              Приглашения
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight">
              Пригласите друга
            </h2>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Друг получит {referralInfo?.invitedRewardCredits || 1} дополнительную генерацию после регистрации, а вы получите {referralInfo?.inviterRewardCredits || 3}.
            </p>
          </div>

          {referralInfo ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3 text-[11px] text-zinc-600 break-all">
                {referralInfo.link}
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3">
                  <div className="text-lg font-black">{referralInfo.invitedCount}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">друзей</div>
                </div>
                <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3">
                  <div className="text-lg font-black">{referralInfo.creditsRemaining}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">бонусных генераций</div>
                </div>
              </div>

              <button
                type="button"
                onClick={copyReferralLink}
                className="w-full h-12 rounded-full bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-[0.18em]"
              >
                {referralCopied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4 text-xs text-zinc-400">
              Загружаем вашу ссылку-приглашение...
            </div>
          )}
        </div>

        <div className={cabinetSectionClass('data', 'space-y-2')}>
          <button
            type="button"
            onClick={() => actions.logout()}
            className="w-full p-5 rounded-2xl bg-red-50 text-red-600 text-sm font-bold uppercase tracking-widest text-center hover:bg-red-100 transition-colors"
          >
            Выйти из системы
          </button>
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
