import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { HomePage } from './pages/HomePage';
import { ContinueWatchingPage } from './pages/ContinueWatchingPage';
import { LoginPage } from './pages/LoginPage';
import { DetailPage } from './pages/DetailPage';
import { PlayerPage } from './pages/PlayerPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { MusicHomePage } from './pages/music/MusicHomePage';
import { MusicBrowsePage } from './pages/music/MusicBrowsePage';
import { MusicAlbumDetailPage } from './pages/music/MusicAlbumDetailPage';
import { MusicArtistDetailPage } from './pages/music/MusicArtistDetailPage';
import { MusicPlaylistDetailPage } from './pages/music/MusicPlaylistDetailPage';
import { MusicSearchPage } from './pages/music/MusicSearchPage';
import { MusicAudioController } from './music/MusicAudioController';
import { MusicPlayerDock } from './components/music/MusicPlayerDock';
import { NowPlayingOverlay } from './components/music/NowPlayingOverlay';
import { MusicQueueDrawer } from './components/music/MusicQueueDrawer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { UpdateBannerModal } from './components/common/UpdateBannerModal';
import { useAuthStore } from './stores/useAuthStore';
import { useMediaStore } from './stores/useMediaStore';
import { useSyncStore } from './stores/useSyncStore';
import { useUpdaterStore } from './stores/useUpdaterStore';
import { useMusicPlayerStore } from './stores/useMusicPlayerStore';
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
  const navigate = useNavigate();
  const isPlayerPage = location.pathname.startsWith('/player');
  const isLoginPage = location.pathname === '/login';
  const serversCount = useAuthStore((s) => s.servers.length);
  const hasMusicTrack = useMusicPlayerStore((s) => Boolean(s.currentTrack));
  const activeSpace = useMusicPlayerStore((s) => s.activeSpace);

  const isHomeTab = location.pathname === '/';
  const isContinueTab = location.pathname === '/continue-watching';
  const isSearchTab = location.pathname === '/search';
  const isMusicHomeTab = location.pathname === '/music';
  const isPrimaryTab = isHomeTab || isContinueTab || isSearchTab || isMusicHomeTab;

  const [visitedTabs, setVisitedTabs] = useState<{
    home: boolean;
    continue: boolean;
    search: boolean;
    musicHome: boolean;
  }>(() => ({
    home: isHomeTab && serversCount > 0 && !isLoginPage,
    continue: isContinueTab && serversCount > 0 && !isLoginPage,
    search: isSearchTab && serversCount > 0 && !isLoginPage,
    musicHome: isMusicHomeTab && serversCount > 0 && !isLoginPage,
  }));

  useEffect(() => {
    if (isLoginPage || serversCount === 0) {
      setVisitedTabs({ home: false, continue: false, search: false, musicHome: false });
      return;
    }
    setVisitedTabs((prev) => {
      const nextHome = prev.home || isHomeTab;
      const nextContinue = prev.continue || isContinueTab;
      const nextSearch = prev.search || isSearchTab;
      const nextMusicHome = prev.musicHome || isMusicHomeTab;
      if (
        nextHome === prev.home &&
        nextContinue === prev.continue &&
        nextSearch === prev.search &&
        nextMusicHome === prev.musicHome
      ) {
        return prev;
      }
      return {
        home: nextHome,
        continue: nextContinue,
        search: nextSearch,
        musicHome: nextMusicHome,
      };
    });
  }, [isLoginPage, serversCount, isHomeTab, isContinueTab, isSearchTab, isMusicHomeTab]);

  // 全局搜索快捷键 Ctrl+K / Cmd+K 按当前所在空间分流
  useEffect(() => {
    if (isPlayerPage || isLoginPage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const inMusic = location.pathname.startsWith('/music') || activeSpace === 'music';
        navigate(inMusic ? '/music/search' : '/search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayerPage, isLoginPage, location.pathname, activeSpace, navigate]);

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

  const showMusicDock = hasMusicTrack && !isPlayerPage && !isLoginPage;

  return (
    <ErrorBoundary fallbackTitle="应用发生意外错误">
      <div
        className={`h-screen w-screen ${
          isPlayerPage ? 'bg-transparent' : 'bg-[#0B0E17]'
        } select-none overflow-hidden flex flex-col`}
      >
        {/* 全局音乐音频后台控制器 */}
        <MusicAudioController />

        {/* Native-style TitleBar for non-player routes */}
        {!isPlayerPage && <TitleBar title="Nocta · 夜幕" />}

        {/* Frameless Shell Body */}
        <div className="flex-1 min-h-0 w-full flex overflow-hidden">
          {/* Desktop Left Sidebar (Non-player & Non-login routes) */}
          {!isPlayerPage && !isLoginPage && <Sidebar />}

          {/* Main view container with Keep-Alive primary tabs */}
          <main
            id="main-scroll-container"
            className={`flex-1 min-h-0 w-full overflow-hidden flex flex-col ${
              isPlayerPage ? 'bg-transparent' : 'bg-[#0B0E17]'
            }`}
          >
            <div className="flex-1 min-h-0 w-full overflow-hidden">
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
                  {visitedTabs.musicHome && (
                    <KeepAliveTabPane id="music-home-scroll-container" active={isMusicHomeTab}>
                      <MusicHomePage isActive={isMusicHomeTab} />
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
                  <Route
                    path="/music"
                    element={serversCount === 0 ? <MusicHomePage isActive={isMusicHomeTab} /> : null}
                  />
                  <Route path="/music/albums" element={<MusicBrowsePage mode="albums" />} />
                  <Route path="/music/artists" element={<MusicBrowsePage mode="artists" />} />
                  <Route path="/music/playlists" element={<MusicBrowsePage mode="playlists" />} />
                  <Route path="/music/favorites" element={<MusicBrowsePage mode="favorites" />} />
                  <Route path="/music/library/:libraryId" element={<MusicBrowsePage mode="library" />} />
                  <Route path="/music/album/:albumId" element={<MusicAlbumDetailPage />} />
                  <Route path="/music/artist/:artistId" element={<MusicArtistDetailPage />} />
                  <Route path="/music/playlist/:playlistId" element={<MusicPlaylistDetailPage />} />
                  <Route path="/music/search" element={<MusicSearchPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/detail/:itemId" element={<DetailPage />} />
                  <Route path="/player/:itemId" element={<PlayerPage />} />
                </Routes>
              </div>
            </div>

            {/* 底部常驻音乐播放条 */}
            {showMusicDock && <MusicPlayerDock />}
          </main>
        </div>

        {/* 沉浸式全屏正在播放浮层与队列抽屉 */}
        {!isPlayerPage && !isLoginPage && (
          <>
            <NowPlayingOverlay />
            <MusicQueueDrawer />
          </>
        )}

        {/* 桌面端自动更新无打扰浮窗与详情弹窗 */}
        <UpdateBannerModal />
      </div>
    </ErrorBoundary>
  );
};

export default App;
