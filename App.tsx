
import React from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AppProvider, useAppState } from './store';
import { ICONS } from './constants';
import Home from './pages/Home';
import Catalog from './pages/Catalog';
import Wardrobe from './pages/Wardrobe';
import Looks from './pages/Looks';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import LookDetails from './pages/LookDetails';
import CreateLook from './pages/CreateLook';

const NavItem: React.FC<{ to: string; icon: React.FC<any>; label: string; highlight?: boolean }> = ({ to, icon: Icon, label, highlight }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`flex flex-col items-center gap-1 transition-all ${isActive ? 'text-zinc-900 scale-110' : 'text-zinc-400'} ${highlight ? 'relative -top-4' : ''}`}>
      {highlight ? (
        <div className="w-14 h-14 bg-zinc-900 rounded-full flex items-center justify-center text-white shadow-xl shadow-zinc-900/20 border-4 border-white">
          <Icon className="w-7 h-7" />
        </div>
      ) : (
        <Icon className="w-6 h-6" />
      )}
      <span className={`text-[9px] font-bold uppercase tracking-wider ${highlight ? 'mt-0' : ''}`}>{label}</span>
    </Link>
  );
};

const Header = () => {
  const { user } = useAppState();
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-100 px-4 py-4 flex items-center justify-between">
      <Link to="/" className="flex items-center">
        <img 
          src="logo.png" 
          alt="toptry" 
          className="h-8 w-auto object-contain block"
          onError={(e) => {
            // В случае ошибки загрузки покажем текст, но приоритет — логотип
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.nextElementSibling;
            if (fallback) fallback.classList.remove('hidden');
          }}
        />
        <span className="hidden text-xl font-black tracking-tighter uppercase">toptry</span>
      </Link>
      <div className="flex items-center gap-4">
        {user ? (
          <Link to="/profile" className="flex items-center gap-2 px-3 py-2 rounded-full border border-zinc-200 hover:border-zinc-900 transition-colors">
            <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200 overflow-hidden">
              <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-900">Профиль</span>
          </Link>
        ) : (
          <Link to="/auth" className="text-sm font-semibold uppercase tracking-wide px-4 py-2 border border-zinc-900 rounded-full hover:bg-zinc-900 hover:text-white transition-all">
            Войти
          </Link>
        )}
      </div>
    </header>
  );
};

const Layout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen pb-24 md:pb-0 md:pt-0">
      <Header />
      <main className="max-w-screen-xl mx-auto">
        {children}
      </main>
      
      {/* Mobile Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-100 px-4 py-2 flex items-center justify-between md:hidden z-50 h-20">
        <NavItem to="/" icon={ICONS.Home} label="Главная" />
        <NavItem to="/catalog" icon={ICONS.Catalog} label="Каталог" />
        <NavItem to="/create-look" icon={ICONS.Plus} label="Создать" highlight />
        <NavItem to="/wardrobe" icon={ICONS.Wardrobe} label="Шкаф" />
        <NavItem to="/looks" icon={ICONS.Looks} label="Лента" />
      </nav>
    </div>
  );
};

const AppRoutes = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/wardrobe" element={<Wardrobe />} />
        <Route path="/create-look" element={<CreateLook />} />
        <Route path="/looks" element={<Looks />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/look/:id" element={<LookDetails />} />
      </Routes>
    </Layout>
  );
};

const App = () => {
  return (
    <AppProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AppProvider>
  );
};

export default App;
