import React from 'react';
import { Link } from 'react-router-dom';

type AdminSummary = any;

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

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const resp = await fetch('/api/admin/dashboard/summary', {
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

  React.useEffect(() => {
    load();
  }, [load]);

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
          onClick={load}
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

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Пользователи" value={data?.users?.total} hint={`+${fmt(data?.users?.new7d)} за 7 дней`} />
        <StatCard label="Активные товары" value={data?.catalog?.activeTotal} hint={`${fmt(data?.catalog?.inactiveTotal)} inactive`} />
        <StatCard label="Генерации сегодня" value={(data?.usage?.today || []).reduce((s: number, r: any) => s + Number(r.count || 0), 0)} hint={`avg ${fmt(data?.usage?.avgDurationMsToday)} ms`} />
        <StatCard label="Clickouts 7д" value={data?.clickouts?.sevenDays} hint={`${fmt(data?.clickouts?.fallbackSevenDays)} fallback`} />
        <StatCard label="Публичные образы" value={data?.social?.publicLooks} hint={`${fmt(data?.social?.looksToday)} образов сегодня`} />
        <StatCard label="Лайки" value={data?.social?.likesTotal} />
        <StatCard label="Комментарии" value={data?.social?.commentsTotal} />
        <StatCard label="Товары без фото" value={data?.catalog?.missingImage} hint={`без цены: ${fmt(data?.catalog?.missingPrice)}`} />
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
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
