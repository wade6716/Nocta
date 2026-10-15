import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  X,
  Film,
  Tv,
  Clapperboard,
  History,
  Trash2,
  Loader2,
  Sparkles,
  Folder,
  Layers,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import {
  EmbyItem,
  searchMediaItems,
  SearchFilterType,
  getUserViews,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';
import { ServerSwitcherDropdown } from '../components/layout/ServerSwitcherDropdown';

const HISTORY_STORAGE_KEY = 'nocta_search_history';
const MAX_HISTORY_COUNT = 12;

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
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const storeViews = useMediaStore((s) => s.views);

  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState<SearchFilterType>('All');
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('All');
  const [views, setViews] = useState<EmbyItem[]>(storeViews);
  const [results, setResults] = useState<EmbyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 确保在页面加载时获取全部分类
  useEffect(() => {
    if (!currentServer) {
      navigate('/login');
      return;
    }
    inputRef.current?.focus();

    if (storeViews.length > 0) {
      setViews(storeViews.filter((v) => v.CollectionType !== 'music' && v.CollectionType !== 'photos'));
    } else {
      getUserViews(currentServer.url, currentServer.userId, currentServer.accessToken)
        .then((res) => {
          const validViews = (res.Items || []).filter(
            (v) => v.CollectionType !== 'music' && v.CollectionType !== 'photos'
          );
          setViews(validViews);
        })
        .catch((err) => console.warn('[SearchPage getUserViews error]', err));
    }
  }, [currentServer, navigate, storeViews]);

  const executeSearch = useCallback(
    async (
      searchTerm: string,
      type: SearchFilterType,
      libraryId: string = selectedLibraryId
    ) => {
      const cleanTerm = searchTerm.trim();
      if (!cleanTerm || !currentServer) {
        setResults([]);
        setLoading(false);
        setHasSearched(false);
        return;
      }

      setLoading(true);
      setHasSearched(true);

      try {
        const items = await searchMediaItems(
          currentServer.url,
          currentServer.userId,
          currentServer.accessToken,
          {
            keyword: cleanTerm,
            filterType: type,
            parentId: libraryId !== 'All' ? libraryId : undefined,
            views,
            limit: 100,
          }
        );
        setResults(items);

        // 成功搜索后更新历史记录
        setHistory((prev) => {
          const updated = [cleanTerm, ...prev.filter((h) => h.toLowerCase() !== cleanTerm.toLowerCase())].slice(
            0,
            MAX_HISTORY_COUNT
          );
          saveSearchHistory(updated);
          return updated;
        });
      } catch (err) {
        console.error('搜索媒体失败', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [currentServer, views, selectedLibraryId]
  );

  // 输入或条件切换时防抖触发
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!keyword.trim()) {
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(keyword, filterType, selectedLibraryId);
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [keyword, filterType, selectedLibraryId, executeSearch]);

  const handleClearInput = () => {
    setKeyword('');
    setResults([]);
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

  const handleCardClick = (item: EmbyItem) => {
    navigate(`/detail/${item.Id}`);
  };

  return (
    <div className="w-full min-h-full py-6 px-8 select-none">
      {/* 顶部搜索操作栏与服务器切换 */}
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
                executeSearch(keyword, filterType, selectedLibraryId);
              }
            }}
            placeholder="跨媒体库聚合搜索电影、电视剧、动漫、纪录片..."
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

        {/* 服务器快速切换器 */}
        <div className="flex-shrink-0">
          <ServerSwitcherDropdown />
        </div>
      </div>

      {/* 筛选标签栏 (类型过滤 + 媒体库分类胶囊) */}
      <div className="space-y-3 mb-8 max-w-4xl pl-14">
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

        {/* 第二排：各媒体库精确筛选胶囊（如果服务器有多分类） */}
        {views.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.04]">
            <span className="text-[11px] text-gray-500 mr-1 flex items-center space-x-1">
              <Layers className="w-3 h-3 text-primary/70" />
              <span>媒体库:</span>
            </span>

            {/* 全部媒体库选项 */}
            <button
              onClick={() => setSelectedLibraryId('All')}
              className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer border ${
                selectedLibraryId === 'All'
                  ? 'bg-primary/20 text-primary border-primary/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/5'
              }`}
            >
              全部媒体库 ({views.length})
            </button>

            {/* 单个具体媒体库选项 */}
            {views.map((v) => {
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
            <p className="text-sm font-medium text-gray-300">跨媒体库深度聚合检索</p>
            <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
              并发穿透当前服务器下的全部媒体库分类，即时呈现电影、电视剧、番剧、纪录片匹配结果。
            </p>
          </div>
        )}

        {/* 搜索结果 */}
        {hasSearched && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="text-xs text-gray-400">
                搜索「<span className="text-white font-medium">{keyword}</span>」的结果
                <span className="ml-2 font-mono text-gray-500">
                  (已聚合找到 {results.length} 部作品
                  {views.length > 0 && selectedLibraryId === 'All'
                    ? ` · 覆盖 ${views.length} 个媒体库`
                    : ''}
                  )
                </span>
              </div>
            </div>

            {results.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {results.map((item) => (
                  <MediaCard
                    key={item.Id}
                    item={item}
                    serverUrl={currentServer!.url}
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
                    请尝试检查片名拼写，或切换至「全部媒体库」或简短关键词重新检索。
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

