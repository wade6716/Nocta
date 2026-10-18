import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Minus, Square, Copy, X, Search, Settings } from 'lucide-react';
import { isTauriEnvironment } from '../../api/http';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ServerSwitcherDropdown } from './ServerSwitcherDropdown';
import { useAuthStore } from '../../stores/useAuthStore';

interface TitleBarProps {
  title?: string;
  onOpenAddServerModal?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Nocta · 夜幕',
  onOpenAddServerModal,
}) => {
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
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
      className={`h-12 flex-shrink-0 bg-[#0B0E17]/95 backdrop-blur-2xl border-b border-white/[0.06] flex items-center justify-between px-4 select-none z-40 w-full ${
        isMac ? 'pl-20' : ''
      }`}
    >
      {/* 左侧：Logo 与应用标题 */}
      <div className="flex items-center space-x-2.5 pointer-events-none">
        <img src="/app-icon.svg" alt="Nocta" className="w-4 h-4 rounded-sm object-contain" />
        <span className="text-xs font-semibold tracking-wider text-slate-200">
          {title}
        </span>
      </div>

      {/* 中部：聚合搜索快捷胶囊与服务器快速切换器 (确保非拖拽区域可交互) */}
      <div className="flex items-center space-x-3 pointer-events-auto">
        <button
          onClick={() => navigate('/search')}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-100 border border-white/[0.08] hover:border-white/[0.15] transition cursor-pointer text-xs group"
          title="全局搜索 (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
          <span className="hidden sm:inline">搜索片名、剧集、演员...</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.08] text-slate-400 border border-white/[0.08]">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>

        {currentServer ? (
          <ServerSwitcherDropdown
            onOpenManageModal={() => navigate('/settings')}
            onOpenAddModal={onOpenAddServerModal}
          />
        ) : (
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.08] hover:border-white/[0.15] transition cursor-pointer text-xs"
            title="系统设置与备份配置导入"
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
            <span>设置 & 导入</span>
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

