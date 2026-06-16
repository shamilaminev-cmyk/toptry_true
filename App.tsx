
import React, { useEffect } from 'react';
import { withApiOrigin } from "./utils/withApiOrigin";
import { patchFetchForApi } from './fetchPatch';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AppProvider, useAppState } from './store';
import { ICONS } from './constants';
import Catalog from './pages/Catalog';
import Wardrobe from './pages/Wardrobe';
import Looks from './pages/Looks';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import Home from './pages/Home';
import LookDetails from './pages/LookDetails';
import CreateLook from './pages/CreateLook';
import ProductDetail from './pages/ProductDetail';
import Admin from './pages/Admin';
import UserStorefront from './pages/UserStorefront';

class TopTryErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: any }> {
  state = { error: null as any };

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, info: any) {
    console.error("[toptry][ErrorBoundary]", error, info);
    window.__toptryClientLog?.("react_error_boundary", {
      message: error?.message || String(error || ""),
      stack: error?.stack ? String(error.stack).slice(0, 1000) : "",
      componentStack: info?.componentStack ? String(info.componentStack).slice(0, 1000) : "",
    });
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || String(this.state.error) || "Unknown error";
      return (
        <div style={{ padding: 16, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          <h2>TopTry crashed</h2>
          <div>{msg}</div>
        </div>
      );
    }
    return this.props.children;
  }
}


const NavItem: React.FC<{ to: string; icon: React.FC<any>; label: string; highlight?: boolean }> = ({ to, icon: Icon, label, highlight }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex flex-col items-center gap-0.5 transition-all ${
        isActive ? 'text-zinc-900 scale-110' : 'text-zinc-400'
      } ${highlight ? 'relative' : ''}`}
    >
      {highlight ? (
        <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center text-white shadow-xl shadow-zinc-900/20 border-4 border-white">
          <Icon className="w-8 h-8 -translate-y-[1px]" />
        </div>
      ) : (
        <div className="w-12 h-12 flex items-center justify-center">
          <Icon className="w-8 h-8 -translate-y-[1px]" />
        </div>
        )}
      <span className={`text-[10px] leading-none h-[12px] flex items-center font-bold uppercase tracking-wider`}>{label}</span>
    </Link>
  );
};

const Header = () => {
  const { user, actions } = useAppState();
  const [avatarFailed, setAvatarFailed] = React.useState(false);

  React.useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatarUrl, user?.selfieUrl]);
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-100 px-4 py-4 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2" aria-label="TopTry">
        <span className="text-xl font-black tracking-tighter uppercase text-zinc-950 leading-none">
          toptry
        </span>
      </Link>

      <div className="flex items-center gap-4">
        {user ? (
          <>
            <Link
              to="/profile"
              className="flex items-center gap-2 px-3 py-2 rounded-full border border-zinc-200 hover:border-zinc-900 transition-colors"
            >
            <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200 overflow-hidden flex items-center justify-center text-[11px] font-black text-zinc-400">
              {(user.avatarUrl || user.selfieUrl) && !avatarFailed ? (
                <img
                  src={withApiOrigin(user.avatarUrl || user.selfieUrl)}
                  alt=""
                  className="w-full h-full object-cover object-top"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <span>{(user.name || user.username || user.phone || 'T').slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-900">Кабинет</span>
            </Link>
            <button
              type="button"
              onClick={async () => {
                await actions.logout();
                window.location.hash = '#/auth';
              }}
              className="inline-flex text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-900"
            >
              Выйти
            </button>
          </>
        ) : (
          <Link
            to="/auth"
            className="text-sm font-semibold uppercase tracking-wide px-4 py-2 border border-zinc-900 rounded-full hover:bg-zinc-900 hover:text-white transition-all"
          >
            Войти
          </Link>
        )}
      </div>
    </header>
  );
};

const Layout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const isAdminPage = location.pathname === '/admin';

  return (
    <div className={`min-h-screen md:pt-0 ${isAdminPage ? 'pb-0' : 'pb-24 md:pb-28'}`}>
      <Header />
      <main className="max-w-screen-xl mx-auto">{children}</main>

      {!isAdminPage && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 md:bottom-4">
          <div className="mx-auto w-full bg-white border-t border-zinc-100 px-4 py-2 flex items-center justify-between h-20 md:max-w-md md:rounded-3xl md:border md:border-zinc-200 md:shadow-xl">
            <NavItem to="/" icon={ICONS.Home} label="Главная" />
            <NavItem to="/catalog" icon={ICONS.Catalog} label="Каталог" />
            <NavItem to="/create-look" icon={ICONS.Plus} label="Создать" highlight />
            <NavItem to="/wardrobe" icon={ICONS.Wardrobe} label="Шкаф" />
            <NavItem to="/looks" icon={ICONS.Looks} label="Лента" />
          </div>
        </nav>
      )}
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
        <Route path="/u/:slug" element={<UserStorefront />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Layout>
  );
};

const App = () => {
  React.useEffect(() => {
    window.__toptryClientLog?.("app_mounted");
  }, []);

  window.__toptryClientLog?.("app_render");

  return (
    <TopTryErrorBoundary>
      <AppProvider>
      <Router>
        <AppRoutes />
      </Router>
      </AppProvider>
    </TopTryErrorBoundary>
  );
};

export default App;
