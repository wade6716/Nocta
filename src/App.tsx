import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { HomePage } from './pages/HomePage';
import { ContinueWatchingPage } from './pages/ContinueWatchingPage';
import { LoginPage } from './pages/LoginPage';
import { DetailPage } from './pages/DetailPage';
import { PlayerPage } from './pages/PlayerPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { UpdateBannerModal } from './components/common/UpdateBannerModal';
import { useAuthStore } from './stores/useAuthStore';
import { useMediaStore } from './stores/useMediaStore';
import { useSyncStore } from './stores/useSyncStore';
import { useUpdaterStore } from './stores/useUpdaterStore';
import { isTauriEnvironment } from './api/http';

const KeepAliveTabPane: React.FC<{
  id?: string;
  active: boolean;
  children: React.ReactNode;
}> = ({ id, active, children }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (active && savedScrollTopRef.current > 0) {
      el.scrollTop = savedScrollTopRef.current;
    }
  }, [active]);

  return (
    <div
      id={id}
      ref={containerRef}
      onScroll={(e) => {
        if (active) {
          savedScrollTopRef.current = e.currentTarget.scrollTop;
        }
      }}
      className={active ? 'h-full w-full overflow-y-auto overflow-x-hidden' : 'hidden'}
    >
      {children}
    </div>
  );
};

export const App: React.FC = () => {
  const location = useLocation();
  const isPlayerPage = location.pathname.startsWith('/player');
  const isLoginPage = location.pathname === '/login';
  const serversCount = useAuthStore((s) => s.servers.length);

  const isHomeTab = location.pathname === '/';
  const isContinueTab = location.pathname === '/continue-watching';
  const isSearchTab = location.pathname === '/search';
  const isPrimaryTab = isHomeTab || isContinueTab || isSearchTab;

  const [visitedTabs, setVisitedTabs] = useState<{
    home: boolean;
    continue: boolean;
    search: boolean;
  }>(() => ({
    home: isHomeTab && serversCount > 0 && !isLoginPage,
    continue: isContinueTab && serversCount > 0 && !isLoginPage,
    search: isSearchTab && serversCount > 0 && !isLoginPage,
  }));

  useEffect(() => {
    if (isLoginPage || serversCount === 0) {
      setVisitedTabs({ home: false, continue: false, search: false });
      return;
    }
    setVisitedTabs((prev) => {
      const nextHome = prev.home || isHomeTab;
      const nextContinue = prev.continue || isContinueTab;
      const nextSearch = prev.search || isSearchTab;
      if (
        nextHome === prev.home &&
        nextContinue === prev.continue &&
        nextSearch === prev.search
      ) {
        return prev;
      }
      return { home: nextHome, continue: nextContinue, search: nextSearch };
    });
  }, [isLoginPage, serversCount, isHomeTab, isContinueTab, isSearchTab]);

  // 离开播放页后标记播放进度脏状态，供首页与继续观看静默刷新最新进度
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prevPath = prevPathRef.current;
    if (prevPath.startsWith('/player') && !location.pathname.startsWith('/player')) {
      useMediaStore.getState().markPlaybackDirty();
    }
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

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

  // 应用启动 3 秒后静默检查客户端更新（不阻塞首页加载）
  useEffect(() => {
    const updater = useUpdaterStore.getState();
    updater.initRuntimeInfo();

    if (!isTauriEnvironment() || !updater.autoCheckOnStartup) {
      return;
    }

    const timer = window.setTimeout(() => {
      const latestState = useUpdaterStore.getState();
      if (latestState.autoCheckOnStartup) {
        latestState.checkForUpdates({ silent: true });
      }
    }, 3000);

    return () => window.clearTimeout(timer);
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

          {/* Main view container with Keep-Alive primary tabs */}
          <main
            id="main-scroll-container"
            className={`flex-1 min-h-0 w-full overflow-hidden ${
              isPlayerPage ? 'bg-transparent' : 'bg-[#0B0E17]'
            }`}
          >
            {!isLoginPage && serversCount > 0 && (
              <>
                {visitedTabs.home && (
                  <KeepAliveTabPane id="home-scroll-container" active={isHomeTab}>
                    <HomePage isActive={isHomeTab} />
                  </KeepAliveTabPane>
                )}
                {visitedTabs.continue && (
                  <KeepAliveTabPane id="continue-scroll-container" active={isContinueTab}>
                    <ContinueWatchingPage isActive={isContinueTab} />
                  </KeepAliveTabPane>
                )}
                {visitedTabs.search && (
                  <KeepAliveTabPane id="search-scroll-container" active={isSearchTab}>
                    <SearchPage isActive={isSearchTab} />
                  </KeepAliveTabPane>
                )}
              </>
            )}

            <div
              className={
                isPrimaryTab
                  ? 'hidden'
                  : isPlayerPage
                  ? 'h-full w-full overflow-hidden bg-transparent'
                  : 'h-full w-full overflow-y-auto overflow-x-hidden'
              }
            >
              <Routes>
                <Route
                  path="/"
                  element={serversCount === 0 ? <HomePage isActive={isHomeTab} /> : null}
                />
                <Route
                  path="/continue-watching"
                  element={
                    serversCount === 0 ? <ContinueWatchingPage isActive={isContinueTab} /> : null
                  }
                />
                <Route
                  path="/search"
                  element={serversCount === 0 ? <SearchPage isActive={isSearchTab} /> : null}
                />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/detail/:itemId" element={<DetailPage />} />
                <Route path="/player/:itemId" element={<PlayerPage />} />
              </Routes>
            </div>
          </main>
        </div>

        {/* 桌面端自动更新无打扰浮窗与详情弹窗 */}
        <UpdateBannerModal />
      </div>
    </ErrorBoundary>
  );
};

export default App;
