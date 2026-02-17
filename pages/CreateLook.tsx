
import React, { useState } from 'react';
import { withApiOrigin } from "../utils/withApiOrigin";
import { useAppState } from '../store';
import { ICONS } from '../constants';
import { Category, WardrobeItem } from '../types';
import { useNavigate, Link } from 'react-router-dom';

const CreateLook = () => {
  const { wardrobe, user, actions, aiError } = useAppState();
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);

  const filteredItems = activeCategory === 'all' 
    ? wardrobe 
    : wardrobe.filter(i => i.category === activeCategory);

  const toggleItem = (item: WardrobeItem) => {
    const next = new Set(selectedIds);
    if (next.has(item.id)) {
      next.delete(item.id);
    } else {
      if (next.size >= 5) return; // Limit to 5 items
      next.add(item.id);
    }
    setSelectedIds(next);
  };

  const handleGenerate = async () => {
    if (!user?.selfieUrl) {
      alert("Сначала загрузите селфи на главной странице или в профиле!");
      return;
    }
    if (selectedIds.size < 2) {
      alert("Выберите хотя бы 2 вещи для полноценного образа");
      return;
    }

    setIsGenerating(true);
    setGenStep(1);

    const steps = [
      "Анализируем ваш аватар...",
      "Гармонизируем стили...",
      "Gemini 3 стилизует образ...",
      "Финальный рендеринг..."
    ];

    const interval = setInterval(() => {
      setGenStep(s => (s < steps.length - 1 ? s + 1 : s));
    }, 3000);

    try {
      const selectedItems = wardrobe.filter(i => selectedIds.has(i.id));
      const lookId = await actions.createLook(selectedItems);
      clearInterval(interval);
      if (lookId) {
        navigate(`/look/${lookId}`);
      }
    } catch (err) {
      clearInterval(interval);
      console.error(err);
      alert(aiError || "Не удалось сгенерировать образ. Проверьте соединение и настройки сервера.");
      setIsGenerating(false);
    }
  };

  if (!user?.selfieUrl) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 text-center space-y-8 animate-in fade-in duration-700">
        <div className="w-24 h-24 bg-zinc-50 rounded-full flex items-center justify-center border-2 border-dashed border-zinc-200">
          <ICONS.User className="w-10 h-10 text-zinc-300" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-tight">Нужен ваш аватар</h1>
          <p className="text-sm text-zinc-400 leading-relaxed uppercase tracking-wider max-w-xs mx-auto">Для виртуальной примерки нам нужно ваше фото. Это займет всего секунду.</p>
        </div>
        <Link to="/" className="bg-zinc-900 text-white px-10 py-4 rounded-full text-xs font-black uppercase tracking-[0.2em] shadow-xl hover:scale-105 transition-transform">
          Загрузить селфи
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-12">
      {/* Header Info */}
      <div className="p-6 bg-zinc-50 border-b border-zinc-100">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-full border-2 border-white shadow-md overflow-hidden bg-zinc-200">
            <img src={withApiOrigin(user.selfieUrl)} alt="Avatar" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter">Создать образ</h1>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.1em]">Выберите 2-5 вещей из вашего шкафа</p>
          </div>
        </div>
      </div>

      {/* Categories Filter */}
      <div className="sticky top-[64px] z-30 bg-white border-b border-zinc-50 p-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setActiveCategory('all')}
            className={`flex-shrink-0 px-6 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${activeCategory === 'all' ? 'bg-zinc-900 text-white border-zinc-900 shadow-lg' : 'bg-white border-zinc-200 text-zinc-400'}`}
          >Все</button>
          {Object.values(Category).map(cat => (
            <button 
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 px-6 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${activeCategory === cat ? 'bg-zinc-900 text-white border-zinc-900 shadow-lg' : 'bg-white border-zinc-200 text-zinc-400'}`}
            >{cat}</button>
          ))}
        </div>
      </div>

      {/* Wardrobe Grid */}
      <div className="p-4 grid grid-cols-3 gap-3">
        {filteredItems.map(item => (
          <div 
            key={item.id}
            onClick={() => toggleItem(item)}
            className={`relative group aspect-square rounded-[24px] bg-zinc-50 border-2 transition-all p-2 overflow-hidden ${selectedIds.has(item.id) ? 'border-zinc-900 ring-2 ring-zinc-900 ring-inset' : 'border-zinc-100 hover:border-zinc-300'}`}
          >
            <img src={withApiOrigin(item.images?.[0])} alt="" className="w-full h-full object-contain mix-blend-multiply transition-all duration-500" />
            
            <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${selectedIds.has(item.id) ? 'bg-zinc-900 border-zinc-900 scale-110' : 'bg-white border-zinc-200'}`}>
              {selectedIds.has(item.id) && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
            </div>
            
            <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-[7px] font-black uppercase bg-white/80 backdrop-blur px-1 py-0.5 rounded truncate block">{item.title}</span>
            </div>
          </div>
        ))}
        {filteredItems.length === 0 && (
          <div className="col-span-3 py-20 text-center">
            <p className="text-xs font-bold uppercase text-zinc-300 tracking-widest">В этой категории пока пусто</p>
          </div>
        )}
      </div>

      {/* Floating Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-[40] animate-in slide-in-from-bottom-8">
          <div className="bg-white rounded-[32px] p-4 shadow-2xl border border-zinc-100 flex items-center justify-between">
            <div className="flex -space-x-3 overflow-hidden ml-2">
              {wardrobe.filter(i => selectedIds.has(i.id)).map(item => (
                <div key={item.id} className="inline-block h-10 w-10 rounded-full ring-2 ring-white bg-zinc-100 overflow-hidden border border-zinc-200">
                  <img src={withApiOrigin(item.images?.[0])} className="w-full h-full object-contain mix-blend-multiply" />
                </div>
              ))}
            </div>
            <button 
              onClick={handleGenerate}
              disabled={selectedIds.size < 2}
              className="bg-zinc-900 text-white px-8 py-4 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all disabled:opacity-40"
            >
              Стилизовать ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Generation Overlay */}
      {isGenerating && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-10 text-center space-y-12">
          <div className="relative">
            <div className="w-40 h-40 border-[8px] border-zinc-50 border-t-zinc-900 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <span className="text-3xl font-black italic tracking-tighter">G3</span>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-lg font-black uppercase tracking-[0.4em]">Gemini 3 Processing</h2>
            <div className="flex gap-2 justify-center">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`h-1.5 w-10 rounded-full transition-all duration-700 ${genStep >= i ? 'bg-zinc-900' : 'bg-zinc-100'}`}></div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-[0.2em] mt-6 animate-pulse">
              {[
                "Анализируем ваш аватар...",
                "Гармонизируем стили...",
                "Gemini 3 стилизует образ...",
                "Финальный рендеринг..."
              ][genStep]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateLook;
