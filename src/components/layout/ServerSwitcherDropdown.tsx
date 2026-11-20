import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Server,
  Check,
  Plus,
  Settings,
} from 'lucide-react';
import { useAuthStore, SavedServer } from '../../stores/useAuthStore';
import { useMediaStore } from '../../stores/useMediaStore';

interface ServerSwitcherDropdownProps {
  onOpenManageModal?: () => void;
  onOpenAddModal?: () => void;
}

export const ServerSwitcherDropdown: React.FC<ServerSwitcherDropdownProps> = ({
  onOpenManageModal,
  onOpenAddModal,
}) => {
  const navigate = useNavigate();
  const { servers, currentServerId, setCurrentServer } = useAuthStore();
  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentServer = servers.find((s) => s.id === currentServerId) || servers[0];

  // 点击外部自动关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectServer = (server: SavedServer) => {
    setIsOpen(false);
    document.getElementById('main-scroll-container')?.scrollTo({ top: 0 });
    if (server.id === currentServer?.id) {
      navigate('/', { replace: true });
      return;
    }
    // 清除旧缓存、切换服务器并强制回到首页重新拉取数据
    clearMediaCache();
    setCurrentServer(server.id);
    navigate('/', { replace: true });
  };

  if (!currentServer && servers.length === 0) {
    return null;
  }

  // 格式化展示服务器地址
  const formatServerHost = (url: string) => {
    try {
      const u = new URL(url);
      return u.host;
    } catch {
      return url.replace(/^https?:\/\//, '');
    }
  };

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium transition cursor-pointer border ${
          isOpen
            ? 'bg-white/20 text-white border-white/20 ring-2 ring-primary/40'
            : 'bg-white/10 hover:bg-white/15 text-gray-200 hover:text-white border-white/10'
        }`}
        title="点击直接切换 Emby 服务器"
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            currentServer?.lastTestOk === false
              ? 'bg-amber-400 animate-pulse'
              : 'bg-emerald-400'
          }`}
        />
        <span className="max-w-[140px] truncate font-semibold">
          {currentServer?.name || '未命名服务器'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {/* 展开下拉浮层 */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-80 rounded-2xl bg-[#161821]/95 backdrop-blur-2xl border border-white/15 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-2">
          {/* 标头 */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-white/10 mb-1">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-300">
              <Server className="w-3.5 h-3.5 text-primary" />
              <span>切换 Emby 服务器</span>
            </div>
            <span className="text-[11px] text-gray-500 font-mono">
              共 {servers.length} 台
            </span>
          </div>

          {/* 服务器列表 */}
          <div className="max-h-64 overflow-y-auto space-y-1 py-1 custom-scrollbar">
            {servers.map((server) => {
              const isSelected = server.id === currentServer?.id;
              return (
                <button
                  key={server.id}
                  onClick={() => handleSelectServer(server)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition cursor-pointer group ${
                    isSelected
                      ? 'bg-primary/20 text-white border border-primary/30'
                      : 'hover:bg-white/10 text-gray-300 hover:text-white border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        server.lastTestOk === false
                          ? 'bg-amber-400'
                          : server.lastTestOk === true
                          ? 'bg-emerald-400'
                          : 'bg-gray-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-medium truncate block">
                          {server.name}
                        </span>
                        {server.username && (
                          <span className="text-[10px] text-gray-400 px-1.5 py-0.2 bg-white/5 rounded">
                            {server.username}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-400 truncate block mt-0.5 font-mono">
                        {formatServerHost(server.url)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-primary/30 text-primary flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 底部快捷操作 */}
          <div className="border-t border-white/10 pt-1.5 mt-1 grid grid-cols-2 gap-1 text-xs">
            {onOpenAddModal && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenAddModal();
                }}
                className="flex items-center justify-center space-x-1.5 py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                <span>添加服务器</span>
              </button>
            )}
            {onOpenManageModal && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenManageModal();
                }}
                className="flex items-center justify-center space-x-1.5 py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5 text-gray-400" />
                <span>管理服务器</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
