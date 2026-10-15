import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowLeft,
  X,
  History,
  Trash2,
  Clapperboard,
  Film,
  Tv,
  Loader2,
  Folder,
  Layers,
  Sparkles,
  Server,
  Globe,
  AlertTriangle,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import {
  EmbyItem,
  SearchFilterType,
  searchFederatedMediaItems,
  FederatedSearchStats,
  FederatedServerTarget,
  getUserViews,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';

const HISTORY_STORAGE_KEY = 'emby_search_history';
const MAX_HISTORY_COUNT = 15;

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_COUNT)));
  } catch {}
}

export const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const servers = useAuthStore((s) => s.servers);
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const setCurrentServer = useAuthStore((s) => s.setCurrentServer);
  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);

  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState<SearchFilterType>('All');

  // 搜索范围：'ALL' (跨全部已保存服务器联合并发搜索) 或 单个指定的 serverId
  const [searchScope, setSearchScope] = useState<string>('ALL');
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false);
  const scopeMenuRef = useRef<HTMLDivElement>(null);

  // 搜索结果的二次服务器筛选：'ALL' 或 具体 serverId
  const [filterServerId, setFilterServerId] = useState<string>('ALL');
  // 媒体库过滤：'All' 或 具体 viewId
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('All');

  const [results, setResults] = useState<EmbyItem[]>([]);
  const [stats, setStats] = useState<FederatedSearchStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);

  // 缓存各服务器的媒体库 Views，避免打字时频繁请求 getUserViews
  const viewsCacheRef = useRef<Record<string, EmbyItem[]>>({});
  const [currentScopeViews, setCurrentScopeViews] = useState<EmbyItem[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 检查登录状态
  useEffect(() => {
    if (!currentServer && servers.length === 0) {
      navigate('/login');
      return;
    }
    inputRef.current?.focus();
  }, [currentServer, servers, navigate]);

  // 点击外部自动关闭下拉菜单
  useEffect(() => {
    if (!isScopeMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (scopeMenuRef.current && !scopeMenuRef.current.contains(e.target as Node)) {
        setIsScopeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isScopeMenuOpen]);

  // 当选择单台服务器范围或查看单台服务器时，拉取并更新该服务器的媒体库 views
  const effectiveSingleServerId =
    searchScope !== 'ALL' ? searchScope : filterServerId !== 'ALL' ? filterServerId : null;

  useEffect(() => {
    if (!effectiveSingleServerId) {
      setCurrentScopeViews([]);
      return;
    }
    const target = servers.find((s) => s.id === effectiveSingleServerId);
    if (!target) return;

    if (viewsCacheRef.current[target.id]) {
      setCurrentScopeViews(viewsCacheRef.current[target.id]);
    } else {
      getUserViews(target.url, target.userId, target.accessToken)
        .then((res) => {
          const valid = (res.Items || []).filter(
            (v) => v.CollectionType !== 'music' && v.CollectionType !== 'photos'
          );
          viewsCacheRef.current[target.id] = valid;
          setCurrentScopeViews(valid);
        })
        .catch(console.warn);
    }
  }, [effectiveSingleServerId, servers]);

  // 执行联合检索
  const executeSearch = useCallback(
    async (searchTerm: string, type: SearchFilterType, scope: string) => {
      const cleanTerm = searchTerm.trim();
      if (!cleanTerm || servers.length === 0) {
        setResults([]);
        setStats([]);
        setLoading(false);
        setHasSearched(false);
        return;
      }

      setLoading(true);
      setHasSearched(true);

      // 确定需要检索的目标服务器集合
      const targetsToSearch =
        scope === 'ALL' ? servers : servers.filter((s) => s.id === scope);

      // 组装目标参数，注入缓存 views
      const federatedTargets: FederatedServerTarget[] = targetsToSearch.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        userId: s.userId,
        accessToken: s.accessToken,
        views: viewsCacheRef.current[s.id],
      }));

      try {
        const response = await searchFederatedMediaItems(federatedTargets, {
          keyword: cleanTerm,
          filterType: type,
          limitPerServer: 80,
        });

        setResults(response.items);
        setStats(response.stats);

        // 成功搜索后更新历史记录
        setHistory((prev) => {
          const updated = [
            cleanTerm,
            ...prev.filter((h) => h.toLowerCase() !== cleanTerm.toLowerCase()),
          ].slice(0, MAX_HISTORY_COUNT);
          saveSearchHistory(updated);
          return updated;
        });
      } catch (err) {
        console.error('[Federated Search Error]', err);
        setResults([]);
        setStats([]);
      } finally {
        setLoading(false);
      }
    },
    [servers]
  );

  // 输入变化或过滤条件变化时防抖执行搜索
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!keyword.trim()) {
      setResults([]);
      setStats([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(keyword, filterType, searchScope);
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [keyword, filterType, searchScope, executeSearch]);

  const handleClearInput = () => {
    setKeyword('');
    setResults([]);
    setStats([]);
    setHasSearched(false);
    inputRef.current?.focus();
  };

  const handleSelectHistory = (term: string) => {
    setKeyword(term);
    inputRef.current?.focus();
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch {}
  };

  // 卡片点击无缝切换服务器并进入详情页
  const handleCardClick = (item: EmbyItem) => {
    if (item.ServerId && item.ServerId !== currentServer?.id) {
      const target = servers.find((s) => s.id === item.ServerId);
      if (target) {
        clearMediaCache();
        setCurrentServer(target.id);
      }
    }
    navigate(`/detail/${item.Id}`);
  };

  // 结果前端动态过滤（服务器二次筛选与媒体库二次筛选）
  const displayedResults = useMemo(() => {
    let list = results;
    if (filterServerId !== 'ALL') {
      list = list.filter((it) => it.ServerId === filterServerId);
    }
    if (selectedLibraryId !== 'All') {
      list = list.filter(
        (it) => it.LibraryId === selectedLibraryId || it.LibraryName === selectedLibraryId
      );
    }
    return list;
  }, [results, filterServerId, selectedLibraryId]);

  // 统计信息
  const activeScopeServer = servers.find((s) => s.id === searchScope);
  const failedServers = stats.filter((s) => !s.ok);
  const successfulServers = stats.filter((s) => s.ok);

  return (
    <div className="w-full min-h-full py-6 px-8 select-none">
      {/* 顶部搜索操作栏与服务器范围选择 */}
      <div className="flex items-center space-x-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 rounded-full bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer flex-shrink-0"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* 搜索框 */}
        <div className="relative flex-1 max-w-2xl">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            {loading ? (
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            ) : (
              <Search className="w-5 h-5 text-gray-400" />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                executeSearch(keyword, filterType, searchScope);
              }
            }}
            placeholder={
              searchScope === 'ALL'
                ? `跨全部 ${servers.length} 台服务器联合搜索电影、电视剧、动漫...`
                : `在「${activeScopeServer?.name || '指定服务器'}」中检索影视资源...`
            }
            className="w-full pl-11 pr-10 py-3 rounded-2xl bg-surface/90 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition text-sm font-medium"
          />
          {keyword && (
            <button
              onClick={handleClearInput}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 服务器搜索范围下拉菜单 */}
        <div className="relative flex-shrink-0" ref={scopeMenuRef}>
          <button
            onClick={() => setIsScopeMenuOpen((prev) => !prev)}
            className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl text-xs font-medium transition cursor-pointer border ${
              isScopeMenuOpen
                ? 'bg-white/20 text-white border-white/25 ring-2 ring-primary/40'
                : 'bg-surface/90 hover:bg-white/10 text-gray-200 border-white/10'
            }`}
            title="选择搜索服务器范围"
          >
            {searchScope === 'ALL' ? (
              <Globe className="w-4 h-4 text-primary flex-shrink-0" />
            ) : (
              <Server className="w-4 h-4 text-amber-400 flex-shrink-0" />
            )}
            <span className="font-semibold max-w-[130px] truncate">
              {searchScope === 'ALL'
                ? `全部服务器 (${servers.length})`
                : activeScopeServer?.name || '指定服务器'}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                isScopeMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isScopeMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-[#141824] border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl z-50 p-1.5 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 border-b border-white/5 mb-1">
                选择搜索服务器范围
              </div>

              {/* 全部服务器选项 */}
              <button
                onClick={() => {
                  setSearchScope('ALL');
                  setFilterServerId('ALL');
                  setSelectedLibraryId('All');
                  setIsScopeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                  searchScope === 'ALL'
                    ? 'bg-primary/20 text-primary font-semibold'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <span>全部服务器联合检索</span>
                </div>
                {searchScope === 'ALL' && <Check className="w-3.5 h-3.5 text-primary stroke-[3]" />}
              </button>

              <div className="my-1 border-t border-white/5" />

              {/* 各独立服务器选项 */}
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {servers.map((srv) => {
                  const isSelected = searchScope === srv.id;
                  return (
                    <button
                      key={srv.id}
                      onClick={() => {
                        setSearchScope(srv.id);
                        setFilterServerId(srv.id);
                        setSelectedLibraryId('All');
                        setIsScopeMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-primary/20 text-primary font-semibold'
                          : 'text-gray-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            srv.lastTestOk === false ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                        />
                        <span className="truncate">{srv.name}</span>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-primary stroke-[3]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 筛选标签栏 (类型过滤 + 服务器胶囊 + 媒体库胶囊) */}
      <div className="space-y-3 mb-8 max-w-5xl pl-14">
        {/* 第一排：影视类型过滤 */}
        <div className="flex items-center space-x-2">
          {(
            [
              { id: 'All', label: '全部影视', icon: Clapperboard },
              { id: 'Movie', label: '电影', icon: Film },
              { id: 'Series', label: '剧集 / 动漫', icon: Tv },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = filterType === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer border ${
                  isActive
                    ? 'bg-primary text-white border-primary shadow-lg shadow-primary/25'
                    : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/10 hover:border-white/20'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 第二排：服务器结果筛选胶囊（当处于跨服务器搜索且有多个服务器结果时展示） */}
        {searchScope === 'ALL' && servers.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.04]">
            <span className="text-[11px] text-gray-500 mr-1 flex items-center space-x-1">
              <Server className="w-3 h-3 text-amber-400/80" />
              <span>来源服务器:</span>
            </span>

            {/* 全部服务器胶囊 */}
            <button
              onClick={() => {
                setFilterServerId('ALL');
                setSelectedLibraryId('All');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer border ${
                filterServerId === 'ALL'
                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/5'
              }`}
            >
              全部服务器 ({results.length} 部)
            </button>

            {/* 各独立服务器胶囊 */}
            {servers.map((srv) => {
              const stat = stats.find((s) => s.serverId === srv.id);
              const isSelected = filterServerId === srv.id;
              const count = stat ? stat.count : results.filter((r) => r.ServerId === srv.id).length;
              const isError = stat && !stat.ok;

              return (
                <button
                  key={srv.id}
                  onClick={() => {
                    setFilterServerId(srv.id);
                    setSelectedLibraryId('All');
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer border flex items-center space-x-1.5 ${
                    isSelected
                      ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 font-semibold'
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/5'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isError ? 'bg-red-400' : 'bg-emerald-400'
                    }`}
                  />
                  <span>{srv.name}</span>
                  <span className="font-mono text-[10px] opacity-75">
                    ({isError ? '离线' : `${count}`})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* 第三排：媒体库分类胶囊（当锁定到具体单台服务器时展示） */}
        {currentScopeViews.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.04]">
            <span className="text-[11px] text-gray-500 mr-1 flex items-center space-x-1">
              <Layers className="w-3 h-3 text-primary/70" />
              <span>媒体库:</span>
            </span>

            <button
              onClick={() => setSelectedLibraryId('All')}
              className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer border ${
                selectedLibraryId === 'All'
                  ? 'bg-primary/20 text-primary border-primary/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/5'
              }`}
            >
              全部媒体库 ({currentScopeViews.length})
            </button>

            {currentScopeViews.map((v) => {
              const isSelected = selectedLibraryId === v.Id;
              return (
                <button
                  key={v.Id}
                  onClick={() => setSelectedLibraryId(v.Id)}
                  className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer border flex items-center space-x-1 ${
                    isSelected
                      ? 'bg-primary/20 text-primary border-primary/40 font-semibold'
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/5'
                  }`}
                >
                  <Folder className="w-3 h-3 text-gray-400" />
                  <span>{v.Name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 内容区域 */}
      <div className="max-w-7xl mx-auto">
        {/* 历史搜索（当搜索框为空时） */}
        {!keyword.trim() && history.length > 0 && (
          <div className="space-y-3 pl-2">
            <div className="flex items-center justify-between max-w-2xl">
              <div className="flex items-center space-x-2 text-xs font-semibold text-gray-400">
                <History className="w-3.5 h-3.5" />
                <span>搜索历史</span>
              </div>
              <button
                onClick={handleClearHistory}
                className="text-xs text-gray-500 hover:text-red-400 flex items-center space-x-1 transition cursor-pointer"
                title="清空历史"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-w-2xl">
              {history.map((term, index) => (
                <button
                  key={`${term}-${index}`}
                  onClick={() => handleSelectHistory(term)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 text-xs text-gray-300 hover:text-white transition cursor-pointer"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 初始空提示 */}
        {!keyword.trim() && history.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-400">
              <Sparkles className="w-6 h-6 text-primary/70" />
            </div>
            <p className="text-sm font-medium text-gray-300">跨 Emby 服务器联合聚合搜索</p>
            <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
              并发穿透您配置的全部 {servers.length} 台 Emby
              服务器与其媒体库分类，即时呈现电影、剧集、番剧资源。
            </p>
          </div>
        )}

        {/* 搜索结果 */}
        {hasSearched && (
          <div className="space-y-4">
            {/* 结果状态统计行 */}
            <div className="flex flex-wrap items-center justify-between border-b border-white/5 pb-2.5 gap-2">
              <div className="text-xs text-gray-400 flex items-center space-x-1.5 flex-wrap">
                <span>搜索「<span className="text-white font-medium">{keyword}</span>」的结果</span>
                <span className="font-mono text-gray-500">
                  (已联合聚合找到 {results.length} 部作品
                  {searchScope === 'ALL'
                    ? ` · 跨 ${successfulServers.length}/${servers.length} 台服务器`
                    : ` · 来自「${activeScopeServer?.name || ''}」`}
                  {filterServerId !== 'ALL' && ` · 已过滤显示 ${displayedResults.length} 部`}
                  )
                </span>
              </div>

              {/* 异常服务器提示（温和提示，不阻断） */}
              {failedServers.length > 0 && (
                <div className="flex items-center space-x-1.5 text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    {failedServers.map((s) => s.serverName).join('、')} 响应超时或离线
                  </span>
                </div>
              )}
            </div>

            {/* 结果网格 */}
            {displayedResults.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {displayedResults.map((item) => (
                  <MediaCard
                    key={`${item.ServerId || 'srv'}_${item.Id}`}
                    item={item}
                    serverUrl={item.ServerUrl || currentServer?.url}
                    serverBadge={item.ServerName}
                    onClick={handleCardClick}
                    aspectRatio="poster"
                    badge={
                      item.LibraryName
                        ? item.LibraryName
                        : item.Type === 'Series'
                        ? '剧集'
                        : item.Type === 'Movie'
                        ? '电影'
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              !loading && (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-500">
                    <Search className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-gray-300">未找到相关影视内容</p>
                  <p className="text-xs text-gray-500 max-w-xs">
                    请尝试检查片名拼写，或切换服务器范围重新检索。
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPage;
