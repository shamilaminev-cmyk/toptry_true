import React, { useState } from 'react';
import { useAppState } from '../store';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';

const Auth = () => {
  const { actions } = useAppState();
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 'phone') {
        await actions.startPhoneAuth(phone.trim());
        setStep('code');
      } else {
        await actions.verifyPhoneAuth(phone.trim(), code.trim());
        navigate('/');
      }
    } catch (e: any) {
      const msg = e?.message || 'Ошибка';
      if (msg === 'Failed to fetch') {
        setError('Не удалось связаться с сервером. Попробуйте обновить страницу или открыть сайт в новой вкладке.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const goBackToPhone = () => {
    setCode('');
    setError(null);
    setStep('phone');
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 space-y-10">
      <div className="text-center space-y-4">
        {/* ✅ Новый логотип */}
        <Logo className="h-16 w-auto mx-auto object-contain block" alt="toptry" />

        {/* Фолбэк-текст (на случай, если логотип не загрузился) */}
        <h1 className="hidden text-5xl font-black uppercase tracking-tighter">toptry</h1>

        <p className="text-xs text-zinc-400 uppercase tracking-[0.3em] font-black">
          AI Virtual Fitting
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400">
            {step === 'phone' ? 'Вход по номеру телефона' : 'Введите код из SMS'}
          </div>
          <div className="text-sm text-zinc-500">
            {step === 'phone'
              ? 'Мы отправим одноразовый код подтверждения'
              : `Код отправлен на ${phone || 'ваш номер'}`}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {step === 'phone' ? (
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 ml-4">
                Номер телефона
              </label>
              <input
                type="tel"
                placeholder="+7 999 123 45 67"
                className="w-full bg-zinc-100 border-none rounded-full py-4 px-6 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 ml-4">
                  Код из SMS
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  className="w-full bg-zinc-100 border-none rounded-full py-4 px-6 text-center text-lg tracking-[0.4em] focus:ring-2 focus:ring-zinc-900 outline-none"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>

              <button
                type="button"
                onClick={goBackToPhone}
                className="w-full py-3 rounded-full bg-zinc-100 text-zinc-700 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-all"
              >
                Изменить номер
              </button>
            </>
          )}
        </div>

        <button
          onClick={submit}
          disabled={busy}
          className={`w-full bg-zinc-900 text-white py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:scale-[0.98] transition-all shadow-lg active:scale-95 ${
            busy ? 'opacity-60 pointer-events-none' : ''
          }`}
        >
          {busy ? '...' : step === 'phone' ? 'Получить код' : 'Войти'}
        </button>
      </div>

      <p className="text-[10px] text-center text-zinc-300 leading-relaxed max-w-[280px] uppercase tracking-widest font-medium">
        Продолжая, вы соглашаетесь с правилами сервиса и обработкой данных.
      </p>
    </div>
  );
};

export default Auth;
