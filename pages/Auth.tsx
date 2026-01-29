import React, { useMemo, useState } from 'react';
import { useAppState } from '../store';
import { useNavigate } from 'react-router-dom';

const Auth: React.FC = () => {
  const { actions } = useAppState();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ✅ реальный счётчик рендеров (должен быть небольшой)
console.count('AUTH render');

const submit = async () => {
  console.count('AUTH submit');
  if (busy) return;

  setError(null);
  setBusy(true);
  try {
    ...
  } catch (e:any) {
    console.error('AUTH submit error:', e);
    setError(e?.stack || e?.message || String(e) || 'Ошибка');
  } finally {
    setBusy(false);
  }
};


  const buttonText = useMemo(() => {
    if (busy) return '...';
    return mode === 'login' ? 'Войти' : 'Создать аккаунт';
  }, [busy, mode]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          {/* Лого + fallback */}
          <img
            src="/toptry.png"
            alt="toptry"
            className="w-10 h-10 rounded-xl object-cover"
            onError={(e) => {
              // спрятать картинку, показать fallback (следующий элемент)
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const fallback = (e.currentTarget as HTMLImageElement)
                .nextElementSibling as HTMLElement | null;
              if (fallback) fallback.classList.remove('hidden');
            }}
          />
          <div className="hidden w-10 h-10 rounded-xl bg-zinc-900 text-white items-center justify-center font-bold">
            t
          </div>

          <div>
            <div className="text-base font-black tracking-tight">toptry</div>
            <div className="text-xs text-zinc-500">AI Virtual Fitting</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-zinc-100 rounded-full p-1 flex mb-6">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
              mode === 'login' ? 'bg-white shadow-sm' : 'text-zinc-500'
            }`}
          >
            Войти
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
              mode === 'register' ? 'bg-white shadow-sm' : 'text-zinc-500'
            }`}
          >
            Регистрация
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* ✅ Form: чтобы исключить клик-ловушки и Enter работал */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          {mode === 'register' ? (
            <>
              <label className="block">
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                  Email
                </div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                  autoComplete="email"
                  disabled={busy}
                />
              </label>

              <label className="block">
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                  Никнейм
                </div>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                  autoComplete="username"
                  disabled={busy}
                />
              </label>
            </>
          ) : (
            <label className="block">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                Email или ник
              </div>
              <input
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                autoComplete="username"
                disabled={busy}
              />
            </label>
          )}

          <label className="block">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
              Пароль
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-zinc-900"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={busy}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-zinc-900 text-white py-3 text-xs font-bold uppercase tracking-widest hover:opacity-95 disabled:opacity-60"
          >
            {buttonText}
          </button>
        </form>

        <div className="mt-4 text-[10px] text-zinc-500">
          Продолжая, вы соглашаетесь с правилами сервиса и обработкой данных.
        </div>
      </div>
    </div>
  );
};

export default Auth;
