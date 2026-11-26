import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Minus,
  Square,
  Copy,
  X,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from 'lucide-react';
import { isTauriEnvironment } from '../../api/http';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ServerSwitcherDropdown } from './ServerSwitcherDropdown';
import { useAuthStore } from '../../stores/useAuthStore';
import { hasUnignoredUpdate, useUpdaterStore } from '../../stores/useUpdaterStore';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { useThemeStore } from '../../stores/useThemeStore';

interface TitleBarProps {
  title?: string;
  onOpenAddServerModal?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  scrollProgress?: number;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Nocta · 诺塔',
  onOpenAddServerModal,
  sidebarCollapsed = false,
  onToggleSidebar,
  scrollProgress = 1,
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
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const toggleLightDark = useThemeStore((s) => s.toggleLightDark);
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

  const p = Math.min(1, Math.max(0, scrollProgress));
  const isHeroOverlay = p < 0.45;
  const isLightTheme = resolvedTheme === 'light';
  const leftOnDarkHero = isHeroOverlay && (sidebarCollapsed || isMac);

  return (
    <header
      data-tauri-drag-region
      style={{
        backgroundColor: isLightTheme
          ? `rgba(255, 255, 255, ${(p * 0.88).toFixed(3)})`
          : `rgba(10, 10, 12, ${(p * 0.84).toFixed(3)})`,
        backdropFilter:
          p > 0.02
            ? `blur(${Math.round(p * 28)}px) saturate(${100 + Math.round(p * 80)}%)`
            : 'none',
        WebkitBackdropFilter:
          p > 0.02
            ? `blur(${Math.round(p * 28)}px) saturate(${100 + Math.round(p * 80)}%)`
            : 'none',
        borderBottom: isLightTheme
          ? `1px solid rgba(0, 0, 0, ${(p * 0.06).toFixed(3)})`
          : `1px solid rgba(255, 255, 255, ${(p * 0.08).toFixed(3)})`,
      }}
      className={`absolute top-0 inset-x-0 h-12 flex items-center justify-between px-4 select-none z-40 transition-colors duration-200 ${
        isMac ? 'pl-20' : ''
      }`}
    >
      {/* 左侧：侧边栏折叠 + Logo 与应用标题 + 历史后退/前进导航 */}
      <div className="flex items-center space-x-2">
        {!isLoginPage && onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`relative pointer-events-auto p-1.5 rounded-lg transition cursor-pointer ${
              leftOnDarkHero
                ? 'preserve-dark hover:bg-white/15 text-white/85 hover:text-white'
                : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-[#515154] dark:text-white/75 hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
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
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        )}

        <div
          className={`flex items-center space-x-1.5 pointer-events-none ${
            leftOnDarkHero
              ? 'preserve-dark text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]'
              : 'text-[#1D1D1F] dark:text-[#F5F5F7]'
          }`}
        >
          <img src="/app-icon.svg" alt="Nocta" className="w-4 h-4 rounded-sm object-contain" />
          <span className="text-xs font-semibold tracking-wide">{title}</span>
        </div>

        {!isLoginPage && (
          <div
            className={`pointer-events-auto flex items-center space-x-0.5 ml-0.5 pl-1.5 border-l ${
              leftOnDarkHero
                ? 'border-white/20'
                : 'border-black/[0.08] dark:border-white/[0.1]'
            }`}
          >
            <button
              type="button"
              onClick={() => navigate(-1)}
              className={`p-1 rounded-lg transition cursor-pointer ${
                leftOnDarkHero
                  ? 'preserve-dark hover:bg-white/15 text-white/85 hover:text-white'
                  : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-[#515154] dark:text-white/75 hover:text-[#1D1D1F] dark:hover:text-white'
              }`}
              title="后退"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              className={`p-1 rounded-lg transition cursor-pointer ${
                leftOnDarkHero
                  ? 'preserve-dark hover:bg-white/15 text-white/85 hover:text-white'
                  : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-[#515154] dark:text-white/75 hover:text-[#1D1D1F] dark:hover:text-white'
              }`}
              title="前进"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 中部：Apple TV 原生纯文字圆润「影视 / 音乐」分段控制器 */}
      {!isLoginPage && (
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
          <div
            className={`relative p-0.5 rounded-full inline-grid grid-cols-2 items-center transition-all duration-300 ${
              isHeroOverlay
                ? 'preserve-dark bg-black/28 backdrop-blur-2xl'
                : 'bg-black/[0.055] dark:bg-white/[0.08]'
            }`}
            role="tablist"
            aria-label="空间切换"
          >
            <div
              className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full transition-all duration-300 ease-out ${
                isMusicSpace ? 'translate-x-full' : 'translate-x-0'
              } ${
                isHeroOverlay
                  ? 'bg-white shadow-sm'
                  : 'bg-white dark:bg-white/20 shadow-[0_1px_4px_rgba(0,0,0,0.1)]'
              }`}
            />
            <button
              type="button"
              role="tab"
              aria-selected={!isMusicSpace}
              onClick={() => handleSwitchSpace('video')}
              className={`relative z-10 h-7 px-5 rounded-full inline-flex items-center justify-center text-xs font-semibold transition-colors cursor-pointer ${
                !isMusicSpace
                  ? isHeroOverlay
                    ? 'text-[#1D1D1F]'
                    : 'text-[#1D1D1F] dark:text-white'
                  : isHeroOverlay
                  ? 'text-white/85 hover:text-white'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/65 dark:hover:text-white'
              }`}
              title="切换至影视空间"
            >
              <span>影视</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isMusicSpace}
              onClick={() => handleSwitchSpace('music')}
              className={`relative z-10 h-7 px-5 rounded-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                isMusicSpace
                  ? isHeroOverlay
                    ? 'text-[#1D1D1F]'
                    : 'text-[#1D1D1F] dark:text-white'
                  : isHeroOverlay
                  ? 'text-white/85 hover:text-white'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/65 dark:hover:text-white'
              }`}
              title="切换至音乐空间"
            >
              <span>音乐</span>
              {isMusicPlaying && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* 右侧：统一无框轻盈动作区（搜索圆形钮 + 轻盈服务器切换 + 主题切换 + 窗口控制） */}
      <div className="flex items-center h-full space-x-1 pointer-events-auto">
        <button
          onClick={() => navigate(isMusicSpace ? '/music/search' : '/search')}
          className={`h-8 w-8 rounded-full transition flex items-center justify-center cursor-pointer ${
            isHeroOverlay
              ? 'preserve-dark hover:bg-white/15 text-white/90 hover:text-white'
              : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-[#515154] dark:text-white/80 hover:text-[#1D1D1F] dark:hover:text-white'
          }`}
          title={`${isMusicSpace ? '搜索音乐' : '全局搜索'} (${isMac ? '⌘K' : 'Ctrl K'})`}
        >
          <Search className="w-4 h-4" />
        </button>

        {currentServer ? (
          <ServerSwitcherDropdown
            targetHomePath={isMusicSpace ? '/music' : '/'}
            onOpenManageModal={() => navigate('/settings')}
            onOpenAddModal={onOpenAddServerModal}
            overlayMode={isHeroOverlay}
          />
        ) : (
          <button
            onClick={() => navigate(hasUpdate ? '/settings?tab=about' : '/settings')}
            className={`relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full transition cursor-pointer text-xs font-medium ${
              isHeroOverlay
                ? 'preserve-dark bg-black/25 hover:bg-black/40 backdrop-blur-xl text-white/95'
                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.1] text-[#3A3A3C] dark:text-white/85 hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
            title={hasUpdate ? '发现新版本 · 点击前往更新与设置' : '系统设置与备份配置导入'}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>设置 & 导入</span>
            {hasUpdate && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={toggleLightDark}
          className={`h-8 w-8 rounded-full transition flex items-center justify-center cursor-pointer ${
            isHeroOverlay
              ? 'preserve-dark hover:bg-white/15 text-white/90 hover:text-white'
              : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-[#515154] dark:text-white/80 hover:text-[#1D1D1F] dark:hover:text-white'
          }`}
          title={resolvedTheme === 'light' ? '切换至暗色模式' : '切换至亮色模式'}
        >
          {resolvedTheme === 'light' ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4 text-amber-300" />
          )}
        </button>

        {!isMac && (
          <div className="flex items-center h-full -mr-4 ml-1">
            <button
              onClick={handleMinimize}
              className={`h-full px-3 transition flex items-center justify-center cursor-pointer ${
                isHeroOverlay
                  ? 'preserve-dark hover:bg-white/15 text-white/85 hover:text-white'
                  : 'hover:bg-black/[0.06] dark:hover:bg-white/10 text-[#515154] dark:text-white/75 hover:text-[#1D1D1F] dark:hover:text-white'
              }`}
              title="最小化"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className={`h-full px-3 transition flex items-center justify-center cursor-pointer ${
                isHeroOverlay
                  ? 'preserve-dark hover:bg-white/15 text-white/85 hover:text-white'
                  : 'hover:bg-black/[0.06] dark:hover:bg-white/10 text-[#515154] dark:text-white/75 hover:text-[#1D1D1F] dark:hover:text-white'
              }`}
              title="最大化/还原"
            >
              {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            </button>
            <button
              onClick={handleClose}
              className={`h-full px-3 hover:bg-red-600 transition flex items-center justify-center cursor-pointer ${
                isHeroOverlay
                  ? 'preserve-dark text-white/85 hover:text-white'
                  : 'text-[#515154] dark:text-white/75 hover:text-white'
              }`}
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default TitleBar;

