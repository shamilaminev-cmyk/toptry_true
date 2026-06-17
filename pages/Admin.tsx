import React from 'react';
import { Link } from 'react-router-dom';

type AdminSummary = any;

function adminApiUrl(path: string) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

const numberFmt = new Intl.NumberFormat('ru-RU');

function fmt(value: any) {
  const n = Number(value || 0);
  return numberFmt.format(Number.isFinite(n) ? n : 0);
}

function StatCard({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <div className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-zinc-900">{fmt(value)}</div>
      {hint && <div className="mt-2 text-xs text-zinc-500 leading-relaxed">{hint}</div>}
    </div>
  );
}

function DataTable({ title, rows, columns }: { title: string; rows: any[]; columns: string[] }) {
  return (
    <section className="rounded-[32px] border border-zinc-100 bg-white p-5 shadow-sm overflow-hidden">
      <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-900">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              {columns.map((c) => <th key={c} className="py-2 pr-4 font-black">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {(rows || []).slice(0, 30).map((row, idx) => (
              <tr key={idx} className="border-b border-zinc-50 last:border-0">
                {columns.map((c) => (
                  <td key={c} className="py-2 pr-4 text-zinc-700 whitespace-nowrap">
                    {typeof row[c] === 'number' ? fmt(row[c]) : String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const Admin: React.FC = () => {
  const [data, setData] = React.useState<AdminSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const [limitPhone, setLimitPhone] = React.useState('');
  const [limitPlan, setLimitPlan] = React.useState('FREE');
  const [dailyLookLimit, setDailyLookLimit] = React.useState('3');
  const [monthlyLookLimit, setMonthlyLookLimit] = React.useState('20');
  const [isAdminUser, setIsAdminUser] = React.useState(false);

  const [creditPhone, setCreditPhone] = React.useState('');
  const [creditAmount, setCreditAmount] = React.useState('3');
  const [adminActionLoading, setAdminActionLoading] = React.useState('');
  const [adminActionResult, setAdminActionResult] = React.useState<any | null>(null);
  const [adminActionError, setAdminActionError] = React.useState('');

  const [supportRequests, setSupportRequests] = React.useState<any[]>([]);
  const [supportLoading, setSupportLoading] = React.useState(false);
  const [supportError, setSupportError] = React.useState('');
  const [supportStatusLoading, setSupportStatusLoading] = React.useState('');

  const [creatorSummary, setCreatorSummary] = React.useState<any | null>(null);
  const [creatorLoading, setCreatorLoading] = React.useState(false);
  const [creatorError, setCreatorError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const resp = await fetch(adminApiUrl('/api/admin/dashboard/summary'), {
        credentials: 'include',
      });
      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setError(json?.error || `Ошибка ${resp.status}`);
        setData(null);
        return;
      }

      setData(json);
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSupportRequests = React.useCallback(async () => {
    setSupportLoading(true);
    setSupportError('');

    try {
      const resp = await fetch(adminApiUrl('/api/admin/support/requests?limit=20'), {
        credentials: 'include',
      });
      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(json?.error || `Ошибка ${resp.status}`);
      }

      setSupportRequests(json?.requests || []);
    } catch (err: any) {
      setSupportError(err?.message || String(err));
      setSupportRequests([]);
    } finally {
      setSupportLoading(false);
    }
  }, []);

  const loadCreatorSummary = React.useCallback(async () => {
    setCreatorLoading(true);
    setCreatorError('');

    try {
      const resp = await fetch(adminApiUrl('/api/admin/creator/events/summary?days=7'), {
        credentials: 'include',
      });
      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(json?.error || `Ошибка ${resp.status}`);
      }

      setCreatorSummary(json);
    } catch (err: any) {
      setCreatorError(err?.message || String(err));
      setCreatorSummary(null);
    } finally {
      setCreatorLoading(false);
    }
  }, []);

  const updateSupportRequestStatus = async (id: string, status: string) => {
    setSupportStatusLoading(id);
    setSupportError('');

    try {
      const resp = await fetch(adminApiUrl(`/api/admin/support/requests/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(json?.error || `Ошибка ${resp.status}`);
      }

      await loadSupportRequests();
    } catch (err: any) {
      setSupportError(err?.message || String(err));
    } finally {
      setSupportStatusLoading('');
    }
  };

  React.useEffect(() => {
    load();
    loadSupportRequests();
    loadCreatorSummary();
  }, [load, loadSupportRequests, loadCreatorSummary]);

  const submitEntitlement = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminActionLoading('entitlement');
    setAdminActionError('');
    setAdminActionResult(null);

    try {
      const resp = await fetch(adminApiUrl('/api/admin/users/entitlement-by-phone'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: limitPhone,
          plan: limitPlan,
          dailyLookLimit: Number(dailyLookLimit || 0),
          monthlyLookLimit: Number(monthlyLookLimit || 0),
          isAdmin: isAdminUser,
        }),
      });

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(json?.error || `Ошибка ${resp.status}`);
      }

      setAdminActionResult({
        type: 'entitlement',
        title: 'Лимиты обновлены',
        data: json,
      });
    } catch (err: any) {
      setAdminActionError(err?.message || String(err));
    } finally {
      setAdminActionLoading('');
    }
  };

  const submitCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminActionLoading('credits');
    setAdminActionError('');
    setAdminActionResult(null);

    try {
      const resp = await fetch(adminApiUrl('/api/admin/users/credits-by-phone'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: creditPhone,
          amount: Number(creditAmount || 0),
          reason: 'ADMIN',
          comment: 'Admin panel grant',
        }),
      });

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(json?.error || `Ошибка ${resp.status}`);
      }

      setAdminActionResult({
        type: 'credits',
        title: 'Бонусные генерации выданы',
        data: json,
      });
    } catch (err: any) {
      setAdminActionError(err?.message || String(err));
    } finally {
      setAdminActionLoading('');
    }
  };

  const applyPlanPreset = (plan: string) => {
    setLimitPlan(plan);

    if (plan === 'ADMIN') {
      setDailyLookLimit('100');
      setMonthlyLookLimit('1000');
      setIsAdminUser(true);
      return;
    }

    if (plan === 'TESTER') {
      setDailyLookLimit('20');
      setMonthlyLookLimit('100');
      setIsAdminUser(false);
      return;
    }

    setDailyLookLimit('3');
    setMonthlyLookLimit('20');
    setIsAdminUser(false);
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] p-6 flex items-center justify-center">
        <div className="text-xs font-black uppercase tracking-[0.28em] text-zinc-400">Загружаем админку…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[70vh] p-6 flex items-center justify-center">
        <div className="max-w-md rounded-[32px] border border-zinc-100 bg-white p-8 text-center shadow-sm">
          <div className="text-xl font-black tracking-tight text-zinc-900">Доступ недоступен</div>
          <p className="mt-3 text-sm text-zinc-500 leading-relaxed">{error}</p>
          <Link to="/" className="mt-6 inline-flex h-11 px-5 items-center rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em]">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  const alerts = data?.alerts || [];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-400">TopTry admin</div>
          <h1 className="mt-2 text-3xl md:text-5xl font-black tracking-tight text-zinc-900">Панель контроля</h1>
          <p className="mt-3 text-sm text-zinc-500">
            Обновлено: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('ru-RU') : '—'}
          </p>
        </div>

        <button
          onClick={() => {
            load();
            loadSupportRequests();
            loadCreatorSummary();
          }}
          className="h-11 px-5 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em]"
        >
          Обновить
        </button>
      </div>

      {alerts.length > 0 && (
        <section className="rounded-[32px] border border-zinc-200 bg-zinc-50 p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-900">Предупреждения</h2>
          <div className="mt-4 grid gap-3">
            {alerts.map((a: any, idx: number) => (
              <div key={idx} className="rounded-2xl bg-white border border-zinc-100 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-zinc-900">
                  {a.level === 'danger' ? '⚠️ ' : '• '}{a.title}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{a.detail}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid lg:grid-cols-2 gap-4">
        <form onSubmit={submitEntitlement} className="rounded-[32px] border border-zinc-100 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-900">Лимиты пользователя</h2>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              Обновить план, дневной и месячный лимит генераций по телефону.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Телефон</span>
              <input
                value={limitPhone}
                onChange={(e) => setLimitPhone(e.target.value)}
                placeholder="+7..."
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">План</span>
              <select
                value={limitPlan}
                onChange={(e) => applyPlanPreset(e.target.value)}
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              >
                <option value="FREE">FREE</option>
                <option value="TESTER">TESTER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Дневной лимит</span>
              <input
                type="number"
                min="0"
                value={dailyLookLimit}
                onChange={(e) => setDailyLookLimit(e.target.value)}
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Месячный лимит</span>
              <input
                type="number"
                min="0"
                value={monthlyLookLimit}
                onChange={(e) => setMonthlyLookLimit(e.target.value)}
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3">
            <input
              type="checkbox"
              checked={isAdminUser}
              onChange={(e) => setIsAdminUser(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-xs font-bold text-zinc-700">Сделать пользователя администратором TopTry</span>
          </label>

          <button
            type="submit"
            disabled={adminActionLoading === 'entitlement'}
            className="h-11 px-5 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] disabled:opacity-50"
          >
            {adminActionLoading === 'entitlement' ? 'Обновляем…' : 'Обновить лимиты'}
          </button>
        </form>

        <form onSubmit={submitCredits} className="rounded-[32px] border border-zinc-100 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-900">Бонусные генерации</h2>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              Выдать пользователю дополнительные генерации сверх дневного/месячного лимита.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Телефон</span>
              <input
                value={creditPhone}
                onChange={(e) => setCreditPhone(e.target.value)}
                placeholder="+7..."
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Количество</span>
              <input
                type="number"
                min="1"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                className="w-full rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={adminActionLoading === 'credits'}
            className="h-11 px-5 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.18em] disabled:opacity-50"
          >
            {adminActionLoading === 'credits' ? 'Выдаём…' : 'Выдать бонусы'}
          </button>

          <div className="rounded-2xl bg-zinc-50 p-4 text-xs text-zinc-500 leading-relaxed">
            Причина начисления: <span className="font-black text-zinc-900">ADMIN</span>. Позже можно добавить PURCHASE_CONFIRMED / PROMO.
          </div>
        </form>
      </section>

      {(adminActionError || adminActionResult) && (
        <section className={`rounded-[28px] border p-5 ${
          adminActionError
            ? 'border-rose-100 bg-rose-50'
            : 'border-emerald-100 bg-emerald-50'
        }`}>
          <div className={`text-sm font-black uppercase tracking-[0.18em] ${
            adminActionError ? 'text-rose-700' : 'text-emerald-700'
          }`}>
            {adminActionError ? 'Ошибка операции' : adminActionResult?.title}
          </div>
          <pre className="mt-3 overflow-x-auto text-[11px] text-zinc-700 whitespace-pre-wrap">
            {adminActionError || JSON.stringify(adminActionResult?.data || {}, null, 2)}
          </pre>
        </section>
      )}

      <section className="rounded-[32px] border border-zinc-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-900">
              Обращения пользователей
            </h2>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              Последние сообщения из формы связи в профиле.
            </p>
          </div>

          <button
            type="button"
            onClick={loadSupportRequests}
            className="h-10 px-4 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase tracking-[0.18em]"
          >
            Обновить обращения
          </button>
        </div>

        {supportError && (
          <div className="mt-4 rounded-2xl bg-rose-50 border border-rose-100 p-4 text-xs text-rose-700">
            {supportError}
          </div>
        )}

        {supportLoading ? (
          <div className="mt-4 rounded-2xl bg-zinc-50 p-4 text-xs text-zinc-400">
            Загружаем обращения…
          </div>
        ) : supportRequests.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-zinc-50 p-4 text-xs text-zinc-400">
            Пока нет обращений.
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {supportRequests.map((r: any) => (
              <div key={r.id} className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-zinc-900 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">
                        {r.status}
                      </span>
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-zinc-900">
                        {r.topic}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString('ru-RU') : ''}
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                      {r.message}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                      <span>id: {r.id}</span>
                      {r.user?.phone && <span>phone: {r.user.phone}</span>}
                      {r.source && <span>source: {r.source}</span>}
                      {r.lookId && <span>look: {r.lookId}</span>}
                      {r.productId && <span>product: {r.productId}</span>}
                    </div>

                    {r.pageUrl && (
                      <a
                        href={r.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-[11px] font-bold text-zinc-900 underline"
                      >
                        Открыть страницу пользователя
                      </a>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {r.status !== 'OPEN' && (
                      <button
                        type="button"
                        disabled={supportStatusLoading === r.id}
                        onClick={() => updateSupportRequestStatus(r.id, 'OPEN')}
                        className="h-9 px-3 rounded-full bg-white border border-zinc-100 text-[10px] font-black uppercase tracking-[0.14em] disabled:opacity-50"
                      >
                        Открыть
                      </button>
                    )}

                    {r.status !== 'IN_PROGRESS' && (
                      <button
                        type="button"
                        disabled={supportStatusLoading === r.id}
                        onClick={() => updateSupportRequestStatus(r.id, 'IN_PROGRESS')}
                        className="h-9 px-3 rounded-full bg-white border border-zinc-100 text-[10px] font-black uppercase tracking-[0.14em] disabled:opacity-50"
                      >
                        В работе
                      </button>
                    )}

                    {r.status !== 'CLOSED' && (
                      <button
                        type="button"
                        disabled={supportStatusLoading === r.id}
                        onClick={() => updateSupportRequestStatus(r.id, 'CLOSED')}
                        className="h-9 px-3 rounded-full bg-zinc-900 text-white text-[10px] font-black uppercase tracking-[0.14em] disabled:opacity-50"
                      >
                        Закрыть
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[32px] border border-zinc-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-900">
              Creator analytics
            </h2>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              События по публичным витринам авторов за последние 7 дней: просмотры, подписки, примерки и переходы.
            </p>
          </div>

          <button
            type="button"
            onClick={loadCreatorSummary}
            className="h-10 px-4 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-black uppercase tracking-[0.18em]"
          >
            Обновить creator
          </button>
        </div>

        {creatorError && (
          <div className="mt-4 rounded-2xl bg-rose-50 border border-rose-100 p-4 text-xs text-rose-700">
            {creatorError}
          </div>
        )}

        {creatorLoading ? (
          <div className="mt-4 rounded-2xl bg-zinc-50 p-4 text-xs text-zinc-400">
            Загружаем creator analytics…
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
              <StatCard label="Всего событий" value={creatorSummary?.totals?.all} hint="creator events 7д" />
              <StatCard label="Просмотры витрин" value={creatorSummary?.totals?.profileViews} hint="profile view" />
              <StatCard label="Подписчики" value={creatorSummary?.totals?.followers} hint="всего сейчас" />
              <StatCard label="Новые подписки" value={creatorSummary?.totals?.follows} hint="за 7 дней" />
              <StatCard label="Отписки" value={creatorSummary?.totals?.unfollows} hint="за 7 дней" />
              <StatCard label="Открытия подборок" value={creatorSummary?.totals?.collectionOpens} hint="collection open" />
              <StatCard label="Старты примерки" value={creatorSummary?.totals?.tryonStarts} hint="try-on started" />
              <StatCard label="Переходы" value={creatorSummary?.totals?.clickouts} hint="creator clickouts" />
            </div>

            <div className="mt-4">
              <DataTable
                title="Авторы / события 7д"
                rows={(creatorSummary?.creators || []).map((c: any) => ({
                  author: c.publicDisplayName || c.username || c.phone || c.creatorUserId,
                  slug: c.publicSlug,
                  followers: c.followersCount,
                  follows: c.follows,
                  unfollows: c.unfollows,
                  profileViews: c.profileViews,
                  collectionOpens: c.collectionOpens,
                  tryonStarts: c.tryonStarts,
                  clickouts: c.clickouts,
                  total: c.total,
                  lastEventAt: c.lastEventAt ? new Date(c.lastEventAt).toLocaleString('ru-RU') : '',
                }))}
                columns={['author', 'slug', 'followers', 'follows', 'unfollows', 'profileViews', 'tryonStarts', 'clickouts', 'total', 'lastEventAt']}
              />
            </div>
          </>
        )}
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Пользователи" value={data?.users?.total} hint={`+${fmt(data?.users?.new7d)} за 7 дней`} />
        <StatCard label="Активные товары" value={data?.catalog?.activeTotal} hint={`${fmt(data?.catalog?.inactiveTotal)} inactive`} />
        <StatCard label="Создано товаров сегодня" value={data?.catalog?.createdToday} hint="новые строки каталога" />
        <StatCard label="Активировано/обновлено сегодня" value={data?.catalog?.activeUpdatedToday} hint={`${fmt(data?.catalog?.inactiveUpdatedToday)} inactive updated`} />
        <StatCard label="Генерации сегодня" value={(data?.usage?.today || []).reduce((s: number, r: any) => s + Number(r.count || 0), 0)} hint={`avg ${fmt(data?.usage?.avgDurationMsToday)} ms`} />
        <StatCard label="Clickouts 7д" value={data?.clickouts?.sevenDays} hint={`${fmt(data?.clickouts?.fallbackSevenDays)} fallback`} />
        <StatCard label="Creator clickouts" value={data?.creator?.totals?.clickouts} hint="переходы из образов авторов" />
        <StatCard label="Публичные образы" value={data?.social?.publicLooks} hint={`${fmt(data?.social?.looksToday)} образов сегодня`} />
        <StatCard label="Лайки" value={data?.social?.likesTotal} />
        <StatCard label="Комментарии" value={data?.social?.commentsTotal} />
        <StatCard label="Товары без фото" value={data?.catalog?.missingImage} hint={`без цены: ${fmt(data?.catalog?.missingPrice)}`} />
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <DataTable title="Продавцы: health" rows={data?.catalog?.merchantHealth || []} columns={['merchant', 'activeTotal', 'inactiveTotal', 'createdToday', 'activeUpdatedToday', 'inactiveUpdatedToday', 'activeMaleShoes', 'inactiveMaleShoes', 'activeFemaleShoes']} />
        <DataTable title="Продавцы: active" rows={data?.catalog?.byMerchant || []} columns={['merchant', 'count']} />
        <DataTable title="Продавцы / пол" rows={data?.catalog?.byMerchantGender || []} columns={['merchant', 'gender', 'count']} />
        <DataTable title="Продавцы / группа" rows={data?.catalog?.byMerchantGroup || []} columns={['merchant', 'taxonomyGroup', 'count']} />
        <DataTable title="Генерации сегодня" rows={data?.usage?.today || []} columns={['status', 'count']} />
        <DataTable title="Clickouts по продавцам 7д" rows={data?.clickouts?.byMerchantSevenDays || []} columns={['merchant', 'count']} />
        <DataTable title="Clickouts по placement 7д" rows={data?.clickouts?.byPlacementSevenDays || []} columns={['placement', 'count']} />
      </div>
    </div>
  );
};

export default Admin;
