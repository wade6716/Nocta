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
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import {
  EmbyItem,
  searchMediaItems,
  SearchFilterType,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';

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

  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState<SearchFilterType>('All');
  const [results, setResults] = useState<EmbyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!currentServer) {
      navigate('/login');
      return;
    }
    inputRef.current?.focus();
  }, [currentServer, navigate]);

  const executeSearch = useCallback(
    async (searchTerm: string, type: SearchFilterType) => {
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
            limit: 60,
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
    [currentServer]
  );

  // 输入防抖触发
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
      executeSearch(keyword, filterType);
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [keyword, filterType, executeSearch]);

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
      {/* 顶部搜索操作栏 */}
      <div className="flex items-center space-x-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 rounded-full bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer flex-shrink-0"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* 搜索框 */}
        <div className="relative flex-1 max-w-3xl">
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
                executeSearch(keyword, filterType);
              }
            }}
            placeholder="搜索当前服务器全部分类电影、电视剧、动漫..."
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
      </div>

      {/* 筛选标签 */}
      <div className="flex items-center space-x-2 mb-8 max-w-3xl pl-14">
        {(
          [
            { id: 'All', label: '全部', icon: Clapperboard },
            { id: 'Movie', label: '电影', icon: Film },
            { id: 'Series', label: '电视剧 / 剧集', icon: Tv },
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
            <p className="text-sm font-medium text-gray-300">跨媒体库聚合搜索</p>
            <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
              输入片名、剧名或演员，在当前服务器所有媒体库分类中即时检索。
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
                  ({results.length} 部作品)
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
                      item.Type === 'Series'
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
                    请尝试检查拼写，或者更换更简短的关键词重新搜索。
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
