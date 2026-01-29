import React, { useState } from 'react';
import { useAppState } from '../store';
import { useNavigate, useLocation } from 'react-router-dom';

const Auth = () => {
  const { actions } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  // откуда пришли (из RequireAuth)
  const from = (location.state as any)?.from || '/';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await actions.login(emailOrUsername.trim(), password);
      } else {
        await actions.register(email.trim(), username.trim(), password);
      }
      navigate(from, { replace: true });
    } catch (e: any) {
      console.error('AUTH submit error:', e); // ✅ чтобы было видно в Console
      setError(e?.stack || e?.message || String(e) || 'Ошибка'); // ✅ чтобы был стек в окошке под кнопками
    } finally {

      setBusy(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 space-y-10">
      <div className="text-center space-y-4">
        <img
          src="logo.png"
          alt="toptry"
          className="h-16 w-auto mx-auto object-contain block"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.classList.remove('hidden');
          }}
        />
        <h1 className="hidden text-5xl font-black uppercase tracking-tighter">toptry</h1>
        <p className="text-xs text-zinc-400 uppercase tracking-[0.3em] font-black">AI Virtual Fitting</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div className="flex gap-2 bg-zinc-100 p-1 rounded-full">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'login' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
          >
            Войти
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'register' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
          >
            Регистрация
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {mode === 'register' ? (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 ml-4">Email</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  className="w-full bg-zinc-100 border-none rounded-full py-4 px-6 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 ml-4">Никнейм</label>
                <input
                  type="text"
                  placeholder="toptry_user"
                  className="w-full bg-zinc-100 border-none rounded-full py-4 px-6 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 ml-4">Email или ник</label>
              <input
                type="text"
                placeholder="name@example.com / username"
                className="w-full bg-zinc-100 border-none rounded-full py-4 px-6 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 ml-4">Пароль</label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full bg-zinc-100 border-none rounded-full py-4 px-6 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={busy}
          className={`w-full bg-zinc-900 text-white py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:scale-[0.98] transition-all shadow-lg active:scale-95 ${busy ? 'opacity-60 pointer-events-none' : ''}`}
        >
          {busy ? '...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </div>

      <p className="text-[10px] text-center text-zinc-300 leading-relaxed max-w-[280px] uppercase tracking-widest font-medium">
        Продолжая, вы соглашаетесь с правилами сервиса и обработкой данных.
      </p>
    </div>
  );
};

export default Auth;
