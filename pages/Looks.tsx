
import React from 'react';
import { useAppState } from '../store';
import { Link } from 'react-router-dom';
import { ICONS } from '../constants';

const Looks = () => {
  const { looks, actions } = useAppState();

  return (
    <div className="pb-12">
      <div className="p-4 flex items-center justify-between sticky top-0 bg-white z-40 border-b border-zinc-100">
         <h1 className="text-xl font-bold uppercase tracking-tighter">Все образы</h1>
         <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest">
            <button className="text-zinc-900">Популярное</button>
            <button className="text-zinc-400">Новое</button>
         </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4">
         {looks.map(look => (
           <div key={look.id} className="space-y-2 group">
              <Link to={`/look/${look.id}`} className="block relative aspect-[3/4] rounded-3xl overflow-hidden bg-zinc-100">
                 <img src={look.resultImageUrl} alt="" className="w-full h-full object-cover transition-all duration-700" />
                 <div className="absolute top-3 right-3 flex flex-col gap-2">
                    <button 
                      onClick={(e) => { e.preventDefault(); actions.likeLook(look.id); }}
                      className="bg-white/80 backdrop-blur-sm p-2 rounded-full shadow-lg"
                    >
                       <ICONS.Heart className="w-4 h-4" />
                    </button>
                 </div>
              </Link>
              <div className="px-1">
                 <p className="text-[10px] font-bold uppercase tracking-wider truncate">{look.title}</p>
                 <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1.5">
                       <img src={look.authorAvatar} alt="" className="w-4 h-4 rounded-full" />
                       <span className="text-[9px] text-zinc-400 font-bold uppercase">{look.authorName}</span>
                    </div>
                    <span className="text-[9px] text-zinc-400 font-bold uppercase">{look.likes} ❤️</span>
                 </div>
              </div>
           </div>
         ))}
      </div>
      
      <div className="px-4 py-8">
         <div className="bg-zinc-100 rounded-[32px] p-8 text-center space-y-4">
            <h3 className="text-lg font-bold uppercase tracking-widest">Стань трендсеттером</h3>
            <p className="text-xs text-zinc-400 leading-relaxed uppercase tracking-wider">Создавай свои образы и попадай в ленту рекомендаций миллионов пользователей.</p>
            <Link to="/wardrobe" className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest">Начать</Link>
         </div>
      </div>
    </div>
  );
};

export default Looks;
