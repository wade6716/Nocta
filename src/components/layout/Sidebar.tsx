import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Compass,
  Play,
  Film,
  Tv,
  Search,
  Settings,
  Folder,
  Music,
  Disc3,
  Mic2,
  ListMusic,
  Heart,
} from 'lucide-react';
import { useMediaStore } from '../../stores/useMediaStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { hasUnignoredUpdate, useUpdaterStore } from '../../stores/useUpdaterStore';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed: controlledCollapsed }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const isCollapsed = Boolean(controlledCollapsed);

  const { views, musicViews, viewCounts } = useMediaStore();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const hasUpdate = useUpdaterStore(hasUnignoredUpdate);
  const activeSpace = useMusicPlayerStore((s) => s.activeSpace);
  const setActiveSpace = useMusicPlayerStore((s) => s.setActiveSpace);

  const currentPath = location.pathname;
  const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent);

  // 路由与空间状态双向同步
  useEffect(() => {
    if (currentPath.startsWith('/music') && activeSpace !== 'music') {
      setActiveSpace('music');
    } else if (
      (currentPath === '/' ||
        currentPath === '/continue-watching' ||
        currentPath === '/search' ||
        currentPath.startsWith('/detail/')) &&
      activeSpace !== 'video'
    ) {
      setActiveSpace('video');
    }
  }, [currentPath, activeSpace, setActiveSpace]);

  const isMusicSpace =
    currentPath.startsWith('/music') || (activeSpace === 'music' && currentPath === '/settings');

  const handleNavClick = (path: string, hash?: string) => {
    if (path === '/' && hash) {
      if (currentPath === '/') {
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: 'smooth' });
      } else {
        navigate(`/#${hash}`);
      }
      return;
    }
    if (path === '/settings' && hash) {
      navigate(`/settings?tab=${hash}`);
      return;
    }
    navigate(path);
  };

  // 辅助渲染分类图标
  const renderViewIcon = (collectionType?: string) => {
    if (collectionType === 'tvshows') return <Tv className="w-4 h-4 flex-shrink-0" />;
    if (collectionType === 'movies') return <Film className="w-4 h-4 flex-shrink-0" />;
    if (collectionType === 'music') return <Music className="w-4 h-4 flex-shrink-0" />;
    return <Folder className="w-4 h-4 flex-shrink-0" />;
  };

  return (
    <div
      className={`relative h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-out z-30 ${
        isCollapsed ? 'w-0' : 'w-56'
      }`}
      aria-hidden={isCollapsed}
    >
      <aside
        className={`absolute inset-y-0 left-0 w-56 h-full pt-12 select-none glass-sidebar transition-transform duration-300 ease-out flex flex-col justify-between ${
          isCollapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'
        }`}
      >
        {/* 导航菜单列表 */}
        <div className="relative flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2.5 space-y-1 custom-scrollbar">
            {!isMusicSpace ? (
              <>
                {/* 影视主导航区 */}
                <div className="space-y-0.5">
                  <button
                    onClick={() => handleNavClick('/')}
                    className={`w-full h-9 px-3 gap-3 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                      currentPath === '/'
                        ? 'glass-sidebar-active text-[#1D1D1F] dark:text-white font-semibold'
                        : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                    title="首页发现"
                  >
                    <Compass className="w-4 h-4 flex-shrink-0" />
                    <span>首页发现</span>
                  </button>

                  <button
                    onClick={() => handleNavClick('/continue-watching')}
                    className={`w-full h-9 px-3 gap-3 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                      currentPath === '/continue-watching'
                        ? 'glass-sidebar-active text-[#1D1D1F] dark:text-white font-semibold'
                        : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                    title="继续观看与最近播放"
                  >
                    <Play className="w-4 h-4 flex-shrink-0" />
                    <span>继续观看</span>
                  </button>
                </div>

                {/* 影视媒体库分类区 */}
                {views.length > 0 && (
                  <div className="pt-3 space-y-0.5">
                    <div className="px-3 pb-1 text-[11px] font-semibold text-[#86868B] dark:text-white/45 uppercase tracking-wider">
                      媒体库
                    </div>

                    {views.map((v) => {
                      const targetPath = `/library/${v.Id}`;
                      const isSelected = currentPath === targetPath;
                      const counts = viewCounts[v.Id];
                      const countNum = counts?.movieCount || counts?.seriesCount;

                      return (
                        <button
                          key={v.Id}
                          onClick={() => navigate(targetPath)}
                          className={`w-full h-9 px-3 rounded-xl flex items-center justify-between text-sm transition-all cursor-pointer relative group ${
                            isSelected
                              ? 'glass-sidebar-active text-[#1D1D1F] dark:text-white font-semibold'
                              : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                          }`}
                          title={v.Name}
                        >
                          <div className="flex items-center gap-3 truncate">
                            {renderViewIcon(v.CollectionType)}
                            <span className="truncate">{v.Name}</span>
                          </div>

                          {typeof countNum === 'number' && countNum > 0 && (
                            <span className="text-[11px] font-mono text-[#86868B] dark:text-white/40 tabular-nums">
                              {countNum}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* 音乐独立导航区 */}
                <div className="space-y-0.5">
                  {[
                    { path: '/music', label: '发现音乐', icon: Compass },
                    { path: '/music/albums', label: '专辑', icon: Disc3 },
                    { path: '/music/artists', label: '歌手', icon: Mic2 },
                    { path: '/music/playlists', label: '歌单', icon: ListMusic },
                    { path: '/music/favorites', label: '我喜欢的', icon: Heart },
                  ].map((nav) => {
                    const Icon = nav.icon;
                    const active = currentPath === nav.path;
                    return (
                      <button
                        key={nav.path}
                        onClick={() => navigate(nav.path)}
                        className={`w-full h-9 px-3 gap-3 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                          active
                            ? 'glass-sidebar-active-music text-[#1D1D1F] dark:text-white font-semibold'
                            : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                        }`}
                        title={nav.label}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{nav.label}</span>
                      </button>
                    );
                  })}

                  <button
                    onClick={() => navigate('/music/search')}
                    className={`w-full h-9 px-3 rounded-xl flex items-center justify-between text-sm transition-all cursor-pointer relative group ${
                      currentPath === '/music/search'
                        ? 'glass-sidebar-active-music text-[#1D1D1F] dark:text-white font-semibold'
                        : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                    title={`音乐搜索 (${isMac ? '⌘K' : 'Ctrl+K'})`}
                  >
                    <div className="flex items-center gap-3">
                      <Search className="w-4 h-4 flex-shrink-0" />
                      <span>音乐搜索</span>
                    </div>
                    <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.08] text-[#6E6E73] dark:text-white/60 border border-black/[0.06] dark:border-white/[0.08]">
                      {isMac ? '⌘K' : 'Ctrl K'}
                    </kbd>
                  </button>
                </div>

                {/* 音乐库分区 */}
                {musicViews.length > 0 && (
                  <div className="pt-3 space-y-0.5">
                    <div className="px-3 pb-1 text-[11px] font-semibold text-[#86868B] dark:text-white/45 uppercase tracking-wider">
                      音乐库
                    </div>

                    {musicViews.map((v) => {
                      const targetPath = `/music/library/${v.Id}`;
                      const isSelected = currentPath === targetPath;
                      const counts = viewCounts[v.Id];
                      const countNum = counts?.albumCount || counts?.songCount;

                      return (
                        <button
                          key={v.Id}
                          onClick={() => navigate(targetPath)}
                          className={`w-full h-9 px-3 rounded-xl flex items-center justify-between text-sm transition-all cursor-pointer relative group ${
                            isSelected
                              ? 'glass-sidebar-active-music text-[#1D1D1F] dark:text-white font-semibold'
                              : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                          }`}
                          title={v.Name}
                        >
                          <div className="flex items-center gap-3 truncate">
                            <Music className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{v.Name}</span>
                          </div>
                          {typeof countNum === 'number' && countNum > 0 && (
                            <span className="text-[11px] font-mono text-[#86868B] dark:text-white/40 tabular-nums">
                              {countNum}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[#F5F5F7]/70 dark:from-[#0E0E10] to-transparent" />
        </div>

        {/* 底部系统配置区 */}
        <div className="p-2.5 border-t border-black/[0.06] dark:border-white/[0.08] space-y-1">
          {/* 系统设置 */}
          <button
            onClick={() => handleNavClick('/settings', hasUpdate ? 'about' : undefined)}
            className={`w-full h-9 px-3 rounded-xl flex items-center justify-between text-sm transition-all cursor-pointer relative ${
              currentPath === '/settings'
                ? 'glass-sidebar-active text-[#1D1D1F] dark:text-white font-semibold'
                : 'text-[#515154] dark:text-white/65 hover:text-[#1D1D1F] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
            }`}
            title={hasUpdate ? '系统设置 · 发现新版本' : '系统设置'}
          >
            <div className="flex items-center gap-3">
              <Settings className="w-4 h-4 flex-shrink-0" />
              <span>系统设置</span>
            </div>
            {hasUpdate && (
              <span className="px-1.5 py-0.5 rounded-full bg-black/[0.07] dark:bg-white/15 text-[#1D1D1F] dark:text-white text-[10px] font-semibold">
                新版本
              </span>
            )}
          </button>

          {/* 未连接服务器时的快捷引导卡 */}
          {!currentServer && (
            <div
              onClick={() => handleNavClick('/settings', 'sync')}
              className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center space-x-2 cursor-pointer hover:bg-amber-500/20 transition group"
              title="未连接服务器，点击导入配置或添加服务器"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0 bg-amber-400 animate-pulse" />
              <div className="min-w-0 flex-1">
                <span className="text-xs text-amber-300 font-medium truncate block group-hover:underline">
                  未连接 · 导入配置
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default Sidebar;
