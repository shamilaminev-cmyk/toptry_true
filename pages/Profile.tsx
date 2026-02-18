
import React from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { ICONS } from '../constants';
import { SubscriptionTier } from '../types';

const Profile = () => {
  const { user, actions } = useAppState();
  const navigate = useNavigate();

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

  return (
    <div className="pb-12">
      <div className="p-6 space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
           <div className="relative">
              <div className="w-32 h-32 rounded-full bg-zinc-100 border-4 border-white shadow-xl overflow-hidden">
                {(user.avatarUrl || user.selfieUrl) ? (
                  <img src={withApiOrigin(user.avatarUrl || user.selfieUrl)} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
              <button className="absolute bottom-1 right-1 bg-zinc-900 text-white p-2 rounded-full shadow-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
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
    </div>
  );
};

export default Profile;
