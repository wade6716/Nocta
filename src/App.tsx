import React, { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { DetailPage } from './pages/DetailPage';
import { PlayerPage } from './pages/PlayerPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useSyncStore } from './stores/useSyncStore';

export const App: React.FC = () => {
  const location = useLocation();
  const isPlayerPage = location.pathname.startsWith('/player');
  const isLoginPage = location.pathname === '/login';

  // 应用启动时自动拉取并合并多端配置
  useEffect(() => {
    const { enabled, autoSyncOnStartup, syncNow } = useSyncStore.getState();
    if (enabled && autoSyncOnStartup) {
      console.log('[Nocta Sync] 正在执行启动自动同步...');
      syncNow('smart_merge')
        .then((res) => {
          if (res.success) {
            console.log('[Nocta Sync] 启动同步成功:', res.message);
          } else {
            console.warn('[Nocta Sync] 启动同步未完成:', res.message);
          }
        })
        .catch((err) => {
          console.error('[Nocta Sync] 启动同步异常:', err);
        });
    }
  }, []);

  return (
    <ErrorBoundary fallbackTitle="应用发生意外错误">
      <div
        className={`h-screen w-screen ${
          isPlayerPage ? 'bg-transparent' : 'bg-[#0B0E17]'
        } select-none overflow-hidden flex flex-col`}
      >
        {/* Native-style TitleBar for non-player routes */}
        {!isPlayerPage && <TitleBar title="Nocta · 夜幕" />}

        {/* Frameless Shell Body */}
        <div className="flex-1 min-h-0 w-full flex overflow-hidden">
          {/* Desktop Left Sidebar (Non-player & Non-login routes) */}
          {!isPlayerPage && !isLoginPage && <Sidebar />}

          {/* Main view container with vertical scroll */}
          <main
            id="main-scroll-container"
            className={`flex-1 min-h-0 w-full ${
              isPlayerPage
                ? 'overflow-hidden bg-transparent'
                : 'overflow-y-auto overflow-x-hidden bg-[#0B0E17]'
            }`}
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/detail/:itemId" element={<DetailPage />} />
              <Route path="/player/:itemId" element={<PlayerPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
