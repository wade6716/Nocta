import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Minus,
  Square,
  Copy,
  X,
  Search,
  Settings,
  Film,
  Headphones,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { isTauriEnvironment } from '../../api/http';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ServerSwitcherDropdown } from './ServerSwitcherDropdown';
import { useAuthStore } from '../../stores/useAuthStore';
import { hasUnignoredUpdate, useUpdaterStore } from '../../stores/useUpdaterStore';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';

interface TitleBarProps {
  title?: string;
  onOpenAddServerModal?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Nocta · 夜幕',
  onOpenAddServerModal,
  sidebarCollapsed = false,
  onToggleSidebar,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSpace = useMusicPlayerStore((s) => s.activeSpace);
  const setActiveSpace = useMusicPlayerStore((s) => s.setActiveSpace);
  const isMusicPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isMusicSpace =
    location.pathname.startsWith('/music') ||
    (activeSpace === 'music' && location.pathname === '/settings');
  const isLoginPage = location.pathname === '/login';

  const handleSwitchSpace = (space: 'video' | 'music') => {
    setActiveSpace(space);
    if (space === 'music') {
      if (!location.pathname.startsWith('/music')) {
        navigate('/music');
      }
    } else {
      if (location.pathname.startsWith('/music')) {
        navigate('/');
      }
    }
  };
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const hasUpdate = useUpdaterStore(hasUnignoredUpdate);
  const [isMaximized, setIsMaximized] = useState(false);
  const isTauri = isTauriEnvironment();
  const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent);

  useEffect(() => {
    if (!isTauri) return;
    try {
      const appWindow = getCurrentWindow();
      appWindow.isMaximized().then(setIsMaximized);
    } catch (e) {
      console.warn(e);
    }
  }, [isTauri]);

  const handleMinimize = async () => {
    if (isTauri) {
      try {
        await getCurrentWindow().minimize();
      } catch (e) {
        console.warn(e);
      }
    }
  };

  const handleToggleMaximize = async () => {
    if (isTauri) {
      try {
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized();
        if (max) {
          await appWindow.unmaximize();
          setIsMaximized(false);
        } else {
          await appWindow.maximize();
          setIsMaximized(true);
        }
      } catch (e) {
        console.warn(e);
      }
    }
  };

  const handleClose = async () => {
    if (isTauri) {
      try {
        await getCurrentWindow().close();
      } catch (e) {
        console.warn(e);
      }
    }
  };

  return (
    <header
      data-tauri-drag-region
      className={`relative h-12 flex-shrink-0 bg-[#0B0E17] border-b border-white/[0.06] flex items-center justify-between px-4 select-none z-40 w-full ${
        isMac ? 'pl-20' : ''
      }`}
    >
      {/* 左侧：侧边栏折叠 + Logo 与应用标题 + 历史后退/前进导航 */}
      <div className="flex items-center space-x-2.5">
        {!isLoginPage && onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="relative pointer-events-auto p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-slate-100 transition cursor-pointer"
            title={
              sidebarCollapsed
                ? hasUpdate
                  ? '展开侧边栏 · 发现新版本'
                  : '展开侧边栏'
                : '隐藏侧边栏'
            }
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
            {sidebarCollapsed && hasUpdate && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#38BDF8] animate-pulse" />
            )}
          </button>
        )}

        <div className="flex items-center space-x-2 pointer-events-none">
          <img src="/app-icon.svg" alt="Nocta" className="w-4 h-4 rounded-sm object-contain" />
          <span className="text-xs font-semibold tracking-wider text-slate-200">
            {title}
          </span>
        </div>

        {!isLoginPage && (
          <div className="pointer-events-auto flex items-center space-x-0.5 ml-1 pl-2 border-l border-white/[0.08]">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
              title="后退"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
              title="前进"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 中部：空间切换胶囊 + 聚合搜索快捷胶囊 + 服务器快速切换器 (确保非拖拽区域可交互) */}
      <div className="flex items-center space-x-2.5 pointer-events-auto">
        {!isLoginPage && (
          <div
            className="relative p-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] inline-grid grid-cols-2 items-center"
            role="tablist"
            aria-label="空间切换"
          >
            <div
              className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full transition-all duration-300 ease-out ${
                isMusicSpace
                  ? 'translate-x-full bg-gradient-to-r from-purple-500/30 to-sky-500/25 border border-purple-400/40 shadow-sm shadow-purple-500/20'
                  : 'translate-x-0 bg-[#38BDF8]/20 border border-[#38BDF8]/40 shadow-sm shadow-sky-500/20'
              }`}
            />
            <button
              type="button"
              role="tab"
              aria-selected={!isMusicSpace}
              onClick={() => handleSwitchSpace('video')}
              className={`relative z-10 h-7 px-3 rounded-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                !isMusicSpace ? 'text-[#38BDF8]' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="切换至影视空间"
            >
              <Film className="w-3.5 h-3.5" />
              <span>影视</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isMusicSpace}
              onClick={() => handleSwitchSpace('music')}
              className={`relative z-10 h-7 px-3 rounded-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                isMusicSpace ? 'text-purple-200' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="切换至音乐空间"
            >
              <Headphones
                className={`w-3.5 h-3.5 ${
                  isMusicPlaying ? 'animate-pulse text-purple-300' : ''
                }`}
              />
              <span>音乐</span>
            </button>
          </div>
        )}

        <button
          onClick={() => navigate(isMusicSpace ? '/music/search' : '/search')}
          className="flex items-center justify-between space-x-2 sm:min-w-[260px] lg:min-w-[340px] px-3.5 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-100 border border-white/[0.08] hover:border-white/[0.15] transition cursor-pointer text-xs group"
          title={isMusicSpace ? '搜索音乐' : '全局搜索'}
        >
          <div className="flex items-center space-x-2 min-w-0">
            <Search
              className={`w-3.5 h-3.5 flex-shrink-0 group-hover:scale-110 transition-transform ${
                isMusicSpace ? 'text-purple-400' : 'text-primary'
              }`}
            />
            <span className="hidden sm:inline truncate">
              {isMusicSpace ? '搜索歌曲、专辑、歌手...' : '搜索片名、剧集、演员...'}
            </span>
          </div>
          <kbd className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.08] text-slate-400 border border-white/[0.08] flex-shrink-0">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>

        {currentServer ? (
          <ServerSwitcherDropdown
            targetHomePath={isMusicSpace ? '/music' : '/'}
            onOpenManageModal={() => navigate('/settings')}
            onOpenAddModal={onOpenAddServerModal}
          />
        ) : (
          <button
            onClick={() => navigate(hasUpdate ? '/settings?tab=about' : '/settings')}
            className="relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.08] hover:border-white/[0.15] transition cursor-pointer text-xs"
            title={hasUpdate ? '发现新版本 · 点击前往更新与设置' : '系统设置与备份配置导入'}
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
            <span>设置 & 导入</span>
            {hasUpdate && (
              <span className="w-2 h-2 rounded-full bg-[#38BDF8] animate-pulse" />
            )}
          </button>
        )}
      </div>

      {/* 右侧：窗口控制按钮 (Windows/Linux) */}
      {!isMac && (
        <div className="flex items-center h-full pointer-events-auto">
          <button
            onClick={handleMinimize}
            className="h-full px-3 hover:bg-white/10 text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer"
            title="最小化"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="h-full px-3 hover:bg-white/10 text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer"
            title="最大化/还原"
          >
            {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClose}
            className="h-full px-3 hover:bg-red-600 text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {isMac && <div className="w-10" />}
    </header>
  );
};

export default TitleBar;

