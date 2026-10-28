import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CalendarDays,
  ChartNoAxesCombined,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { AuthProvider, useAuth } from './session';
import { Brand, ErrorState, Loading, ToastProvider, useToast } from './ui';
import { send } from './api';
import { cloudEnabled, getCloudAuth } from './cloudbase';
import { Landing, AuthPage, Dashboard, SettingsPage, Planner, Privacy, NotFound } from './pages';
import { ActivityEditor, ActivityDetail } from './activity';
import { PublicEvent, PublicSurvey, TicketPage } from './public';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: true } },
});
function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  return (
    <button
      className="icon-btn"
      title={dark ? '切换浅色主题' : '切换深色主题'}
      aria-label={dark ? '切换浅色主题' : '切换深色主题'}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? 'dark' : 'light';
        localStorage.setItem('campusflow-theme', next ? 'dark' : 'light');
      }}
    >
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
function Workspace() {
  const { session, pending, error, org, selectOrg, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (pending) return <Loading />;
  if (error) return <ErrorState error={error} retry={() => void refresh()} />;
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  const logout = async () => {
    try {
      await send('/auth/logout', {});
      if (cloudEnabled) {
        const result = await (await getCloudAuth()).signOut();
        if (result && 'error' in result && result.error) throw result.error;
      }
      queryClient.clear();
      await refresh();
      navigate('/');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="workspace">
      <a href="#main" className="skip-link">
        跳到主要内容
      </a>
      {open && (
        <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setOpen(false)} />
      )}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-btn mobile-only"
            aria-label="关闭导航"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
        </div>
        <div className="org-picker">
          <span className="org-icon">{(org?.name || '新')[0]}</span>
          <div>
            <small>当前组织</small>
            <select
              aria-label="切换组织"
              value={org?.id || ''}
              onChange={(e) => {
                selectOrg(e.target.value);
                navigate('/app');
                setOpen(false);
              }}
            >
              {!org && <option value="">创建你的组织</option>}
              {session.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="nav-caption">工作空间</p>
        <nav onClick={() => setOpen(false)}>
          <NavLink to="/app" end>
            <LayoutDashboard size={19} />
            概览
          </NavLink>
          <NavLink to="/app/events">
            <CalendarDays size={19} />
            我的活动
          </NavLink>
          <NavLink to="/app/planner">
            <Sparkles size={19} />
            AI 策划助手<span className="nav-new">AI</span>
          </NavLink>
          <NavLink to="/app/analytics">
            <ChartNoAxesCombined size={19} />
            数据分析
          </NavLink>
          <NavLink to="/app/settings">
            <Users size={19} />
            组织与成员
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" />
          <strong>{session.mode === 'cloudbase' ? 'CloudBase 已连接' : '本地开发环境'}</strong>
          <p>
            {session.mode === 'cloudbase'
              ? '活动数据由你的云端环境管理。'
              : '数据保存于本机 PostgreSQL。当前尚未部署到腾讯云。'}
          </p>
        </div>
        <div className="sidebar-bottom">
          <Link to="/app/settings" className="profile-mini">
            <span className="avatar">{session.user.display_name[0]}</span>
            <span>
              <strong>{session.user.display_name}</strong>
              <small>{org?.role || '新成员'}</small>
            </span>
          </Link>
          <button className="icon-btn" aria-label="退出登录" onClick={() => void logout()}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn mobile-only"
              aria-label="打开导航"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              工作空间 <span>/</span>{' '}
              {location.pathname.includes('planner')
                ? 'AI 策划助手'
                : location.pathname.includes('settings')
                  ? '组织设置'
                  : location.pathname.includes('analytics')
                    ? '数据分析'
                    : location.pathname.includes('events')
                      ? '活动管理'
                      : '概览'}
            </span>
          </div>
          <div className="actions">
            <span className="timezone">北京时间 UTC+8</span>
            <ThemeToggle />
            <Link to="/app/settings" className="icon-btn" aria-label="设置">
              <Settings size={18} />
            </Link>
          </div>
        </header>
        <main id="main" className="main-content">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>AMYRTLE · CAMPUSFLOW</span>
          <Link to="/privacy">隐私说明</Link>
          <span>每一个好想法，都值得发生。</span>
        </footer>
      </div>
    </div>
  );
}
function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/events/:slug" element={<PublicEvent />} />
      <Route path="/tickets/:id" element={<TicketPage />} />
      <Route path="/surveys/:id" element={<PublicSurvey />} />
      <Route path="/app" element={<Workspace />}>
        <Route index element={<Dashboard />} />
        <Route path="events" element={<Dashboard list />} />
        <Route path="events/new" element={<ActivityEditor />} />
        <Route path="events/:id/edit" element={<ActivityEditor />} />
        <Route path="events/:id" element={<ActivityDetail />} />
        <Route path="planner" element={<Planner />} />
        <Route path="analytics" element={<Dashboard analytics />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
document.documentElement.dataset.theme = localStorage.getItem('campusflow-theme') || 'light';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
