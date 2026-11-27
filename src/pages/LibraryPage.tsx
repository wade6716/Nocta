import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Film,
  Tv,
  Folder,
  Search,
  RefreshCw,
  RotateCcw,
  Loader2,
  X,
  ArrowUpDown,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import {
  EmbyItem,
  getLibraryGenres,
  getLibraryItems,
  getUserViews,
  isMusicLibraryView,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';
import { PosterGridSkeleton } from '../components/common/Skeletons';
import { buildServerScopedKey, libraryPageCache } from '../services/pageCache';

type WatchStatusFilter = 'all' | 'unplayed' | 'played' | 'favorite';
type SortOptionId = 'date_desc' | 'premiere_desc' | 'rating_desc' | 'name_asc';

const SORT_OPTIONS: ReadonlyArray<{
  id: SortOptionId;
  label: string;
  sortBy: string;
  sortOrder: 'Ascending' | 'Descending';
}> = [
  { id: 'date_desc', label: '最新入库', sortBy: 'DateCreated,SortName', sortOrder: 'Descending' },
  { id: 'premiere_desc', label: '发行日期', sortBy: 'PremiereDate,SortName', sortOrder: 'Descending' },
  { id: 'rating_desc', label: '最高评分', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' },
  { id: 'name_asc', label: '片名 A-Z', sortBy: 'SortName', sortOrder: 'Ascending' },
];

const PAGE_SIZE = 48;

export const LibraryPage: React.FC = () => {
  const { libraryId } = useParams<{ libraryId: string }>();
  const navigate = useNavigate();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  useAuthStore((s) => s.imageProxyRevision);
  const views = useMediaStore((s) => s.views);

  const [libraryView, setLibraryView] = useState<EmbyItem | null>(() =>
    views.find((v) => v.Id === libraryId) || null
  );
  const [items, setItems] = useState<EmbyItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<WatchStatusFilter>('all');
  const [sortOption, setSortOption] = useState<SortOptionId>('date_desc');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genres, setGenres] = useState<string[]>([]);

  const reqIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const genresRef = useRef<string[]>([]);
  genresRef.current = genres;

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear; y >= currentYear - 15; y--) {
      list.push(y);
    }
    return list;
  }, []);

  // 搜索输入防抖 300ms
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 切换媒体库时重置筛选并同步库信息
  useEffect(() => {
    setStatusFilter('all');
    setSortOption('date_desc');
    setSelectedGenre('');
    setSelectedYear('');
    setSearchInput('');
    setDebouncedSearch('');
    setErrorMsg(null);

    const defaultCached =
      currentServer?.id && libraryId
        ? libraryPageCache.get(
            buildServerScopedKey(currentServer.id, libraryId, 'all', 'date_desc')
          )
        : null;
    if (defaultCached) {
      setItems(defaultCached.data.items);
      setTotalCount(defaultCached.data.totalCount);
      if (defaultCached.data.genres.length > 0) {
        setGenres(defaultCached.data.genres);
      }
      setLoading(false);
    } else {
      setItems([]);
      setTotalCount(0);
      setLoading(true);
    }

    const matched = views.find((v) => v.Id === libraryId) || null;
    setLibraryView(matched);

    if (!matched && currentServer && libraryId) {
      getUserViews(currentServer.url, currentServer.userId, currentServer.accessToken)
        .then((res) => {
          const found = (res.Items || [])
            .filter((v) => !isMusicLibraryView(v))
            .find((v) => v.Id === libraryId);
          if (found) setLibraryView(found);
        })
        .catch(() => {});
    }
  }, [libraryId, views, currentServer?.id]);

  // 加载流派标签
  useEffect(() => {
    if (!currentServer || !libraryId) {
      setGenres([]);
      return;
    }
    let cancelled = false;
    getLibraryGenres(currentServer.url, currentServer.userId, libraryId, currentServer.accessToken)
      .then((list) => {
        if (!cancelled) setGenres(list);
      })
      .catch(() => {
        if (!cancelled) setGenres([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentServer?.id, currentServer?.url, currentServer?.accessToken, libraryId]);

  const fetchPage = useCallback(
    async (startIndex: number, append: boolean, forceReload = false) => {
      if (!currentServer || !libraryId) return;
      const reqId = ++reqIdRef.current;
      const cacheKey = buildServerScopedKey(
        currentServer.id,
        libraryId,
        statusFilter,
        sortOption,
        selectedGenre,
        selectedYear,
        debouncedSearch
      );

      if (append) {
        setLoadingMore(true);
      } else {
        setErrorMsg(null);
        const cached = libraryPageCache.get(cacheKey);
        if (cached && !forceReload) {
          setItems(cached.data.items);
          setTotalCount(cached.data.totalCount);
          if (cached.data.genres.length > 0 && genresRef.current.length === 0) {
            setGenres(cached.data.genres);
          }
          setLoading(false);
          setRefreshing(true);
        } else if (forceReload) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      }

      const sortCfg = SORT_OPTIONS.find((s) => s.id === sortOption) || SORT_OPTIONS[0];
      const filters: string[] = [];
      if (statusFilter === 'unplayed') filters.push('IsUnplayed');
      else if (statusFilter === 'played') filters.push('IsPlayed');
      else if (statusFilter === 'favorite') filters.push('IsFavorite');

      const years = selectedYear ? [Number(selectedYear)] : undefined;

      try {
        const res = await getLibraryItems(
          currentServer.url,
          currentServer.userId,
          libraryId,
          currentServer.accessToken,
          {
            startIndex,
            limit: PAGE_SIZE,
            sortBy: sortCfg.sortBy,
            sortOrder: sortCfg.sortOrder,
            genres: selectedGenre ? [selectedGenre] : undefined,
            years,
            filters: filters.length > 0 ? filters : undefined,
            searchTerm: debouncedSearch || undefined,
          }
        );

        if (reqId !== reqIdRef.current) return;
        setItems((prev) => {
          if (!append) return res.Items;
          const existingIds = new Set(prev.map((i) => i.Id));
          const merged = [...prev];
          for (const it of res.Items) {
            if (!existingIds.has(it.Id)) {
              merged.push(it);
            }
          }
          return merged;
        });
        setTotalCount(res.TotalRecordCount);
        if (!append) {
          libraryPageCache.set(cacheKey, {
            items: res.Items,
            totalCount: res.TotalRecordCount,
            genres: genresRef.current,
          });
        }
      } catch (err: any) {
        if (reqId !== reqIdRef.current) return;
        if (items.length === 0) {
          setErrorMsg(err?.message || '加载媒体库失败');
        }
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [
      currentServer,
      libraryId,
      sortOption,
      statusFilter,
      selectedGenre,
      selectedYear,
      debouncedSearch,
    ]
  );

  useEffect(() => {
    if (!currentServer) {
      navigate('/login');
      return;
    }
    fetchPage(0, false);
  }, [currentServer, fetchPage, navigate]);

  const hasMore = items.length < totalCount;

  // 无限滚动分页监听
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading || loadingMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchPage(items.length, true);
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, loadingMore, hasMore, items.length, fetchPage]);

  const hasActiveFilters =
    statusFilter !== 'all' ||
    sortOption !== 'date_desc' ||
    selectedGenre !== '' ||
    selectedYear !== '' ||
    debouncedSearch !== '';

  const resetFilters = () => {
    setStatusFilter('all');
    setSortOption('date_desc');
    setSelectedGenre('');
    setSelectedYear('');
    setSearchInput('');
    setDebouncedSearch('');
  };

  const renderLibraryIcon = () => {
    const type = libraryView?.CollectionType;
    if (type === 'tvshows') return <Tv className="w-5 h-5 text-[#38BDF8]" />;
    if (type === 'movies') return <Film className="w-5 h-5 text-[#38BDF8]" />;
    return <Folder className="w-5 h-5 text-[#38BDF8]" />;
  };

  return (
    <div className="w-full min-h-full select-none pb-12">
      {/* 顶部吸顶筛选与排序工具栏 */}
      <div className="sticky top-0 z-20 bg-[#0B0E17]/90 backdrop-blur-xl border-b border-white/[0.06] px-6 lg:px-10 py-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            {renderLibraryIcon()}
            <h1 className="text-xl font-bold tracking-tight text-white truncate">
              {libraryView?.Name || '媒体库'}
            </h1>
            {!loading && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-slate-300 tabular-nums">
                {totalCount.toLocaleString()} 部
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* 库内搜索 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="在当前媒体库内筛选..."
                className="w-48 sm:w-60 pl-8 pr-7 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] focus:border-[#38BDF8]/50 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500 transition"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => fetchPage(0, false, true)}
              disabled={loading || refreshing}
              className="p-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              title="刷新"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading || refreshing ? 'animate-spin text-[#38BDF8]' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* 筛选胶囊与排序下拉行 */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* 观看状态胶囊 */}
          <div className="flex items-center space-x-1.5">
            {(
              [
                { id: 'all', label: '全部' },
                { id: 'unplayed', label: '未看' },
                { id: 'played', label: '已看' },
                { id: 'favorite', label: '收藏' },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer border ${
                    active
                      ? 'bg-[#38BDF8]/20 border-[#38BDF8]/40 text-[#38BDF8]'
                      : 'bg-white/[0.04] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* 排序、流派与年份 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <ArrowUpDown className="w-3 h-3 text-slate-400 absolute left-2.5 pointer-events-none" />
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOptionId)}
                className="pl-7 pr-6 py-1 rounded-full bg-[#131826] border border-white/[0.08] text-xs text-slate-200 focus:border-[#38BDF8]/50 focus:outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {genres.length > 0 && (
              <select
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="px-3 py-1 rounded-full bg-[#131826] border border-white/[0.08] text-xs text-slate-200 focus:border-[#38BDF8]/50 focus:outline-none cursor-pointer max-w-[140px]"
              >
                <option value="">全部类型</option>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-3 py-1 rounded-full bg-[#131826] border border-white/[0.08] text-xs text-slate-200 focus:border-[#38BDF8]/50 focus:outline-none cursor-pointer"
            >
              <option value="">全部年份</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y} 年
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs text-slate-300 hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重置</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 海报网格主体 */}
      <div className="px-6 lg:px-10 pt-6">
        {errorMsg ? (
          <div className="py-20 text-center space-y-3">
            <p className="text-sm text-amber-300">{errorMsg}</p>
            <button
              type="button"
              onClick={() => fetchPage(0, false)}
              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs text-white transition cursor-pointer"
            >
              重新加载
            </button>
          </div>
        ) : loading ? (
          <PosterGridSkeleton count={18} variant="poster" />
        ) : items.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <p className="text-sm text-slate-400">当前筛选条件下没有找到影视作品</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-2 rounded-full bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 text-xs text-[#38BDF8] border border-[#38BDF8]/30 transition cursor-pointer"
              >
                清除筛选条件
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5">
              {items.map((item) => (
                <MediaCard
                  key={item.Id}
                  item={item}
                  serverUrl={currentServer?.url || ''}
                  onClick={(it) =>
                    navigate(`/detail/${it.Id}`, { state: { previewItem: it } })
                  }
                  aspectRatio="poster"
                />
              ))}
            </div>

            {/* 无限滚动哨兵与底部状态 */}
            <div ref={sentinelRef} className="pt-8 pb-4 flex flex-col items-center justify-center">
              {loadingMore ? (
                <div className="flex items-center space-x-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-[#38BDF8]" />
                  <span>正在加载更多...</span>
                </div>
              ) : hasMore ? (
                <button
                  type="button"
                  onClick={() => fetchPage(items.length, true)}
                  className="px-5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs text-slate-200 transition cursor-pointer"
                >
                  加载更多（已显示 {items.length} / {totalCount}）
                </button>
              ) : (
                <p className="text-xs text-slate-500 tabular-nums">
                  已加载全部 {items.length} 部作品
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LibraryPage;
