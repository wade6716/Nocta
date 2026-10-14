import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { isTauriEnvironment } from '../../api/http';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface TitleBarProps {
  title?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({ title = 'Nocta · 夜幕' }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const isTauri = isTauriEnvironment();

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
      className="h-10 flex-shrink-0 bg-[#0f1115] border-b border-white/5 flex items-center justify-between px-4 select-none z-50 w-full"
    >
      {/* Title */}
      <div className="flex items-center space-x-2 pointer-events-none">
        <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
        <span className="text-xs font-semibold tracking-wider text-gray-300 uppercase">
          {title}
        </span>
      </div>

      {/* Window Controls */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="h-full px-3 hover:bg-white/10 text-gray-400 hover:text-white transition flex items-center justify-center cursor-pointer"
          title="最小化"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="h-full px-3 hover:bg-white/10 text-gray-400 hover:text-white transition flex items-center justify-center cursor-pointer"
          title="最大化/还原"
        >
          {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-3 hover:bg-red-600 text-gray-400 hover:text-white transition flex items-center justify-center cursor-pointer"
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};

export default TitleBar;
