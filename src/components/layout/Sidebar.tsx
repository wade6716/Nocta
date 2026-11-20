import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Compass,
  Play,
  Film,
  Tv,
  Clapperboard,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
  Server,
  Folder,
} from 'lucide-react';
import { useMediaStore } from '../../stores/useMediaStore';
import { useAuthStore } from '../../stores/useAuthStore';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed: controlledCollapsed,
  onToggleCollapse,
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const toggleCollapse = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed(!internalCollapsed);
    }
  };

  const { views, viewCounts } = useMediaStore();
  const currentServer = useAuthStore((s) => s.getCurrentServer());

  const currentPath = location.pathname;

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
    return <Folder className="w-4 h-4 flex-shrink-0" />;
  };

  return (
    <aside
      className={`h-full flex-shrink-0 select-none bg-[#0B0E17]/90 backdrop-blur-2xl border-r border-white/[0.06] transition-all duration-300 flex flex-col justify-between z-30 ${
        isCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* 顶部 Logo 与折叠按钮 */}
      <div className="flex flex-col flex-1 min-h-0">
        <div
          className={`h-14 flex items-center justify-between border-b border-white/[0.04] ${
            isCollapsed ? 'px-2 justify-center' : 'px-3.5'
          }`}
        >
          <div
            onClick={() => navigate('/')}
            className={`flex items-center space-x-2.5 cursor-pointer overflow-hidden ${
              isCollapsed ? 'justify-center w-full' : ''
            }`}
          >
            <img
              src="/app-icon.svg"
              alt="Nocta"
              className="w-7 h-7 rounded-lg object-contain flex-shrink-0 shadow-lg shadow-sky-500/20"
            />
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold tracking-wider text-slate-100 truncate">
                  Nocta
                </span>
                <span className="text-[10px] text-slate-500 tracking-widest font-mono uppercase">
                  夜幕影院
                </span>
              </div>
            )}
          </div>

          {!isCollapsed && (
            <button
              onClick={toggleCollapse}
              className="p-1 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition cursor-pointer"
              title="折叠侧边栏"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 导航菜单列表 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-1 custom-scrollbar">
          {/* 主导航区 */}
          <div className="space-y-0.5">
            {/* 首页发现 */}
            <button
              onClick={() => handleNavClick('/')}
              className={`w-full h-10 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                isCollapsed ? 'justify-center px-0' : 'px-3 gap-3'
              } ${
                currentPath === '/' && !location.hash
                  ? 'bg-[#38BDF8]/12 text-[#38BDF8] font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
              }`}
              title="首页发现"
            >
              {currentPath === '/' && !location.hash && (
                <span className="absolute left-0 w-1 h-5 rounded-full bg-[#38BDF8]" />
              )}
              <Compass className="w-4 h-4 flex-shrink-0" />
              {!isCollapsed && <span>首页发现</span>}
            </button>

            {/* 继续观看 */}
            <button
              onClick={() => handleNavClick('/continue-watching')}
              className={`w-full h-10 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                isCollapsed ? 'justify-center px-0' : 'px-3 gap-3'
              } ${
                currentPath === '/continue-watching'
                  ? 'bg-[#38BDF8]/12 text-[#38BDF8] font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
              }`}
              title="继续观看与最近播放"
            >
              {currentPath === '/continue-watching' && (
                <span className="absolute left-0 w-1 h-5 rounded-full bg-[#38BDF8]" />
              )}
              <Play className="w-4 h-4 flex-shrink-0" />
              {!isCollapsed && <span>继续观看</span>}
            </button>

            {/* 跨库聚合搜索 */}
            <button
              onClick={() => handleNavClick('/search')}
              className={`w-full h-10 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                isCollapsed ? 'justify-center px-0' : 'justify-between px-3'
              } ${
                currentPath === '/search'
                  ? 'bg-[#38BDF8]/12 text-[#38BDF8] font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
              }`}
              title="全库聚合搜索 (Ctrl+K)"
            >
              {currentPath === '/search' && (
                <span className="absolute left-0 w-1 h-5 rounded-full bg-[#38BDF8]" />
              )}
              {isCollapsed ? (
                <Search className="w-4 h-4 flex-shrink-0" />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Search className="w-4 h-4 flex-shrink-0" />
                    <span>聚合搜索</span>
                  </div>
                  <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.08]">
                    ⌘K
                  </kbd>
                </>
              )}
            </button>
          </div>

          {/* 媒体库分类区 */}
          {views.length > 0 && (
            <div className="pt-4 space-y-1">
              {!isCollapsed && (
                <div className="px-3 pb-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  媒体库
                </div>
              )}
              {isCollapsed && <div className="border-t border-white/[0.06] my-2" />}

              {views.map((v) => {
                const isSelected = location.hash === `#view-${v.Id}`;
                const counts = viewCounts[v.Id];
                const countNum = counts?.movieCount || counts?.seriesCount;

                return (
                  <button
                    key={v.Id}
                    onClick={() => handleNavClick('/', `view-${v.Id}`)}
                    className={`w-full h-10 rounded-xl flex items-center text-sm transition-all cursor-pointer relative group ${
                      isCollapsed ? 'justify-center px-0' : 'justify-between px-3'
                    } ${
                      isSelected
                        ? 'bg-[#38BDF8]/12 text-[#38BDF8] font-medium'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                    }`}
                    title={v.Name}
                  >
                    {isSelected && (
                      <span className="absolute left-0 w-1 h-5 rounded-full bg-[#38BDF8]" />
                    )}
                    {isCollapsed ? (
                      renderViewIcon(v.CollectionType)
                    ) : (
                      <>
                        <div className="flex items-center gap-3 truncate">
                          {renderViewIcon(v.CollectionType)}
                          <span className="truncate">{v.Name}</span>
                        </div>

                        {typeof countNum === 'number' && countNum > 0 && (
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {countNum}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 底部系统配置与服务器状态区 */}
      <div className="p-2 border-t border-white/[0.06] space-y-1">
        {/* 系统设置 */}
        <button
          onClick={() => handleNavClick('/settings')}
          className={`w-full h-10 rounded-xl flex items-center text-sm transition-all cursor-pointer relative ${
            isCollapsed ? 'justify-center px-0' : 'px-3 gap-3'
          } ${
            currentPath === '/settings'
              ? 'bg-[#38BDF8]/12 text-[#38BDF8] font-medium'
              : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
          }`}
          title="系统设置"
        >
          {currentPath === '/settings' && (
            <span className="absolute left-0 w-1 h-5 rounded-full bg-[#38BDF8]" />
          )}
          <Settings className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && <span>系统设置</span>}
        </button>

        {/* 展开按钮（仅折叠时展示） */}
        {isCollapsed && (
          <button
            onClick={toggleCollapse}
            className="w-full h-10 flex items-center justify-center rounded-xl hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition cursor-pointer"
            title="展开侧边栏"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* 服务器连接指示卡 */}
        {!isCollapsed && (
          currentServer ? (
            <div className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center space-x-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  currentServer.lastTestOk === false ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <span className="text-xs text-slate-300 font-medium truncate block">
                  {currentServer.name}
                </span>
              </div>
            </div>
          ) : (
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
          )
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
