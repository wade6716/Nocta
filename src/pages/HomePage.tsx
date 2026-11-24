import React, { useEffect, useState, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  Film,
  Tv,
  Play,
  History,
  TriangleAlert,
  Info,
  Sparkles,
} from 'lucide-react';
import { useAuthStore, SavedServer } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { fetchAndPreparePlaybackSession } from '../player/playbackSessionService';
import { DanmuServerModal } from '../components/danmu/DanmuServerModal';
import { EmbyServerModal } from '../components/settings/EmbyServerModal';
import { NetworkProxyModal } from '../components/settings/NetworkProxyModal';
import {
  EmbyItem,
  getUserViews,
  getResumeItems,
  getRecentlyPlayedItems,
  getNextUpEpisodes,
  getLatestItems,
  getViewItemCounts,
  ViewCounts,
  mergeMediaBySeries,
  isVideoMedia,
  resolveItemBackdropUrl,
  resolveItemPosterUrl,
  stripImageFormatWebp,
  formatSeriesEpisodeBadge,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';

function renderViewCountBadge(counts?: ViewCounts) {
  if (!counts) return null;
  const parts: string[] = [];
  if (typeof counts.movieCount === 'number' && counts.movieCount > 0) {
    parts.push(`${counts.movieCount.toLocaleString()} 部电影`);
  }
  if (typeof counts.seriesCount === 'number' && counts.seriesCount > 0) {
    if (typeof counts.episodeCount === 'number' && counts.episodeCount > 0) {
      parts.push(`${counts.seriesCount.toLocaleString()} 部剧集 · ${counts.episodeCount.toLocaleString()} 集`);
    } else {
      parts.push(`${counts.seriesCount.toLocaleString()} 部剧集`);
    }
  }
  if (parts.length === 0) return null;

  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400 font-normal tracking-normal select-none">
      {parts.join(' · ')}
    </span>
  );
}

const VIEW_COUNTS_TTL_MS = 5 * 60 * 1000;

function getHomeScrollContainer(): HTMLElement | null {
  return (
    document.getElementById('home-scroll-container') ||
    document.getElementById('main-scroll-container')
  );
}

export const HomePage: React.FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  // 订阅代理/UA 修订号，确保站内弹层修改代理后首页海报立即按新策略刷新
  useAuthStore((s) => s.imageProxyRevision);

  const {
    serverId,
    resumeItems,
    nextUpItems,
    recentlyPlayedItems,
    views,
    latestMap,
    viewCounts,
    playbackDirtyRevision,
    isLoaded,
    isRefreshing,
    homeScrollY,
    cacheVersion,
    setMediaData,
    updateResumeAndRecent,
    setViewCounts,
    setRefreshing,
    setHomeScrollY,
  } = useMediaStore();

  const isCached = isLoaded && serverId === currentServer?.id;
  const [loading, setLoading] = useState(!isCached);
  const [startingSpotlightPlay, setStartingSpotlightPlay] = useState(false);
  const [isDanmuModalOpen, setIsDanmuModalOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);
  const loadReqIdRef = useRef(0);
  const lastHandledDirtyRef = useRef(playbackDirtyRevision);

  const fetchCountsForViews = useCallback(
    async (currentViews: EmbyItem[], targetServer: SavedServer, reqId: number) => {
      if (currentViews.length === 0) return;

      const settled = await Promise.allSettled(
        currentViews.map(async (v) => ({
          viewId: v.Id,
          counts: await getViewItemCounts(
            targetServer.url,
            targetServer.userId,
            v.Id,
            v.CollectionType,
            targetServer.accessToken
          ),
        }))
      );

      if (
        reqId !== loadReqIdRef.current ||
        useAuthStore.getState().getCurrentServer()?.id !== targetServer.id
      ) {
        return;
      }

      const nextCounts: Record<string, ViewCounts> = {
        ...useMediaStore.getState().viewCounts,
      };
      let hasUpdates = false;
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          nextCounts[r.value.viewId] = r.value.counts;
          hasUpdates = true;
        }
      }
      if (hasUpdates) {
        setViewCounts(nextCounts);
      }
    },
    [setViewCounts]
  );

  const loadData = useCallback(
    async (isManualRefresh = false) => {
      const targetServer = currentServer;
      if (!targetServer) return;

      const reqId = ++loadReqIdRef.current;
      const isStale = () =>
        reqId !== loadReqIdRef.current ||
        useAuthStore.getState().getCurrentServer()?.id !== targetServer.id;

      const mediaState = useMediaStore.getState();
      const serverCached = mediaState.isLoaded && mediaState.serverId === targetServer.id;

      if (isManualRefresh) {
        setRefreshing(true);
      } else if (!serverCached) {
        setLoading(true);
        getHomeScrollContainer()?.scrollTo({ top: 0 });
      }

      try {
        // If we already have cache and it's not a forced manual refresh,
        // quietly update "继续观看" and "最近播放" in background without flashing the UI
        if (!isManualRefresh && serverCached) {
          const [resResume, resNextUp, resRecent] = await Promise.all([
            getResumeItems(targetServer.url, targetServer.userId, targetServer.accessToken),
            getNextUpEpisodes(targetServer.url, targetServer.userId, targetServer.accessToken).catch(() => []),
            getRecentlyPlayedItems(targetServer.url, targetServer.userId, targetServer.accessToken).catch(() => []),
          ]);
          if (isStale()) return;

          updateResumeAndRecent({
            resumeItems: resResume.Items || [],
            nextUpItems: resNextUp || [],
            recentlyPlayedItems: resRecent || [],
          });

          // 缓存模式下按 5 分钟 TTL 节流后台同步各分类统计数（批量合并一次渲染）
          const shouldRefreshCounts =
            mediaState.views.length > 0 &&
            (mediaState.lastViewCountsSyncAt <= 0 ||
              Date.now() - mediaState.lastViewCountsSyncAt >= VIEW_COUNTS_TTL_MS);
          if (shouldRefreshCounts) {
            fetchCountsForViews(mediaState.views, targetServer, reqId);
          }
          return;
        }

        // Full fetch (initial load, server switch, or manual refresh button)
        const [resResume, resNextUp, resRecent, resViews] = await Promise.all([
          getResumeItems(targetServer.url, targetServer.userId, targetServer.accessToken),
          getNextUpEpisodes(targetServer.url, targetServer.userId, targetServer.accessToken).catch(() => []),
          getRecentlyPlayedItems(targetServer.url, targetServer.userId, targetServer.accessToken).catch(() => []),
          getUserViews(targetServer.url, targetServer.userId, targetServer.accessToken),
        ]);
        if (isStale()) return;

        const userViews = resViews.Items || [];
        const latestEntries: Record<string, EmbyItem[]> = {};

        await Promise.all(
          userViews.map(async (v) => {
            try {
              const items = await getLatestItems(
                targetServer.url,
                targetServer.userId,
                v.Id,
                targetServer.accessToken,
                12
              );
              latestEntries[v.Id] = items;
            } catch (e) {
              console.warn(`Fetch latest for ${v.Name} failed`, e);
            }
          })
        );
        if (isStale()) return;

        setMediaData({
          serverId: targetServer.id,
          resumeItems: resResume.Items || [],
          nextUpItems: resNextUp || [],
          recentlyPlayedItems: resRecent || [],
          views: userViews,
          latestMap: latestEntries,
        });

        // 异步并发拉取每个媒体库的剧集和电影数量（Promise.allSettled 一次批量提交）
        fetchCountsForViews(userViews, targetServer, reqId);
      } catch (err: any) {
        if (!isStale()) {
          console.error('加载媒体库失败', err);
        }
      } finally {
        if (!isStale()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [currentServer, setMediaData, updateResumeAndRecent, setRefreshing, fetchCountsForViews]
  );

  useEffect(() => {
    if (!currentServer) {
      if (isActive) {
        navigate('/login');
      }
      return;
    }

    if (serverId !== currentServer.id || !isLoaded) {
      setLoading(true);
    }

    loadData(false);
    // 服务器切换、地址/令牌变更或手动清除缓存时均强制重新拉取媒体库
  }, [currentServer?.id, currentServer?.url, currentServer?.accessToken, cacheVersion]);

  // 仅当离开播放页产生了新播放进度且回到首页激活态时，后台静默同步断点与最近播放（普通切换零请求）
  useEffect(() => {
    if (!isActive || !currentServer) return;
    if (playbackDirtyRevision === lastHandledDirtyRef.current) return;
    lastHandledDirtyRef.current = playbackDirtyRevision;
    loadData(false);
  }, [isActive, playbackDirtyRevision, currentServer, loadData]);

  // Restore scroll position when returning from video/detail pages
  useLayoutEffect(() => {
    if (isCached && homeScrollY > 0) {
      const container = getHomeScrollContainer();
      if (container) {
        container.scrollTop = homeScrollY;
      }
      const frameId = requestAnimationFrame(() => {
        const el = getHomeScrollContainer();
        if (el && Math.abs(el.scrollTop - homeScrollY) > 5) {
          el.scrollTop = homeScrollY;
        }
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [isCached, homeScrollY]);

  // Save scroll position when navigating away or unmounting
  useEffect(() => {
    const saveCurrentScroll = () => {
      if (!useMediaStore.getState().isLoaded) return;
      const container = getHomeScrollContainer();
      if (container) {
        setHomeScrollY(container.scrollTop);
      }
    };

    return () => {
      saveCurrentScroll();
    };
  }, [setHomeScrollY]);

  // 全局搜索快捷键监听 (Ctrl+K / Cmd+K / 斜杠)
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/search');
      } else if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, navigate]);

  const saveHomeScroll = useCallback(() => {
    const container = getHomeScrollContainer();
    if (container) {
      setHomeScrollY(container.scrollTop);
    }
  }, [setHomeScrollY]);

  const handleCardClick = (item: EmbyItem) => {
    saveHomeScroll();
    navigate(`/detail/${item.Id}`);
  };

  const handleSpotlightDetail = (item: EmbyItem) => {
    saveHomeScroll();
    const targetId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
    navigate(`/detail/${targetId}`);
  };

  const handleSpotlightPlay = async (item: EmbyItem) => {
    if (!currentServer || startingSpotlightPlay) return;
    saveHomeScroll();
    if (item.Type !== 'Movie' && item.Type !== 'Episode') {
      navigate(`/detail/${item.Id}`);
      return;
    }
    try {
      setStartingSpotlightPlay(true);
      const engineType = usePlayerStore.getState().engineType;
      const session = await fetchAndPreparePlaybackSession(
        currentServer,
        item.Id,
        engineType,
        item
      );
      setPlaybackContext(session);
      navigate(`/player/${item.Id}`);
    } catch (err: any) {
      alert(`无法起播: ${err?.message || '请检查服务器连接'}`);
    } finally {
      setStartingSpotlightPlay(false);
    }
  };

  // 用于 Hero Spotlight 的精选候选计算
  const continueWatchingItems = useMemo(() => {
    let sourceList: EmbyItem[] = [];
    if (resumeItems.length > 0 || nextUpItems.length > 0) {
      sourceList = [...resumeItems, ...nextUpItems];
    } else if (recentlyPlayedItems.length > 0) {
      sourceList = recentlyPlayedItems;
    }
    const videoOnly = sourceList.filter(isVideoMedia);
    return mergeMediaBySeries(videoOnly);
  }, [resumeItems, nextUpItems, recentlyPlayedItems]);

  // Hero Spotlight Banner: 优先选取当前继续观看首位，或第一个分类的首部大片
  const spotlightItem = useMemo(() => {
    if (continueWatchingItems.length > 0) return continueWatchingItems[0];
    for (const v of views) {
      if (latestMap[v.Id] && latestMap[v.Id].length > 0) {
        return latestMap[v.Id][0];
      }
    }
    return null;
  }, [continueWatchingItems, views, latestMap]);

  const spotlightBackdropUrl = useMemo(() => {
    if (!spotlightItem || !currentServer) return '';
    return resolveItemBackdropUrl(currentServer.url, spotlightItem, {
      maxWidth: 1920,
      quality: 90,
      mode: 'hero',
      allowPrimaryFallback: true,
    });
  }, [spotlightItem, currentServer]);

  const spotlightPrimaryFallbackUrl = useMemo(() => {
    if (!spotlightItem || !currentServer) return '';
    return resolveItemPosterUrl(currentServer.url, spotlightItem, {
      maxWidth: 1200,
      quality: 85,
    });
  }, [spotlightItem, currentServer]);

  return (
    <div className="w-full py-6 px-8 select-none">
      {/* 顶部状态与快速操作栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>媒体库</span>
            <span className="text-xs font-normal text-slate-400 font-mono">
              · 欢迎回来，{currentServer?.username || '用户'}
            </span>
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigate('/continue-watching')}
            className="px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 hover:text-white border border-white/[0.06] transition cursor-pointer inline-flex items-center space-x-1.5 text-xs font-medium"
            title="前往独立「继续观看与最近播放」页面"
          >
            <History className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>继续观看</span>
          </button>
          <button
            onClick={() => loadData(true)}
            disabled={isRefreshing || loading}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.06] transition cursor-pointer"
            title="手动刷新媒体库"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
          </button>
        </div>
      </div>

      {/* 当前服务器上次连接失败：明确提示，避免媒体库空白被误认为无内容 */}
      {currentServer && currentServer.lastTestOk === false && (
        <div className="mb-6 p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-start justify-between space-x-3">
          <div className="flex items-start space-x-2.5 text-xs text-amber-200/90 leading-relaxed">
            <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              当前服务器「{currentServer.name}」上次连接未成功
              {currentServer.lastTestError ? `：${currentServer.lastTestError}` : ''}
              ，媒体库可能无法正常加载，可检查地址、密码或网络后重试。
            </span>
          </div>
          <button
            onClick={() => setIsServerModalOpen(true)}
            className="flex-shrink-0 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            检查服务器
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-medium">正在同步媒体库信息...</p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* 1. Hero Spotlight Banner (精选全宽大屏 + 双层渐变遮罩) */}
          {spotlightItem && (
            <div className="h-[360px] md:h-[420px] rounded-2xl overflow-hidden relative border border-white/[0.08] bg-[#131826] shadow-2xl group">
              {/* 背景剧照 */}
              {spotlightBackdropUrl && (
                <img
                  key={spotlightBackdropUrl}
                  src={spotlightBackdropUrl}
                  alt={spotlightItem.SeriesName || spotlightItem.Name}
                  onError={(e) => {
                    const target = e.currentTarget;
                    const step = target.dataset.fallbackStep;
                    if (step === 'done') return;

                    if (!step) {
                      const noWebp = stripImageFormatWebp(target.src);
                      if (noWebp) {
                        target.dataset.fallbackStep = '1';
                        target.src = noWebp;
                        return;
                      }
                    }

                    if (
                      step !== '2' &&
                      spotlightPrimaryFallbackUrl &&
                      spotlightPrimaryFallbackUrl !== spotlightBackdropUrl &&
                      target.src !== spotlightPrimaryFallbackUrl
                    ) {
                      target.dataset.fallbackStep = '2';
                      target.src = spotlightPrimaryFallbackUrl;
                      return;
                    }

                    target.dataset.fallbackStep = 'done';
                    target.style.display = 'none';
                  }}
                  className="absolute inset-0 w-full h-full object-cover object-top filter brightness-90 group-hover:scale-105 transition-transform duration-700 ease-out"
                />
              )}

              {/* 左侧文字保护渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-r from-[#0B0E17] via-[#0B0E17]/75 to-transparent" />
              {/* 底部融合渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0E17] via-transparent to-transparent" />

              {/* 焦点信息排布 */}
              <div className="absolute bottom-8 left-8 right-8 z-10 flex flex-col justify-end">
                {/* 规格徽章行 */}
                <div className="flex items-center space-x-2 mb-3">
                  <span className="px-2.5 py-0.5 rounded-md bg-[#38BDF8]/20 border border-[#38BDF8]/30 text-[#38BDF8] text-[11px] font-bold tracking-wide">
                    精选推荐
                  </span>
                  {(spotlightItem.ProductionYear || spotlightItem.PremiereDate) && (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.08] text-slate-300 text-[11px] font-medium font-mono">
                      {spotlightItem.ProductionYear || spotlightItem.PremiereDate?.slice(0, 4)}
                    </span>
                  )}
                  {formatSeriesEpisodeBadge(spotlightItem) && (
                    <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/30 text-sky-300 text-[11px] font-semibold flex items-center space-x-1">
                      <Tv className="w-3 h-3 text-sky-400" />
                      <span>{formatSeriesEpisodeBadge(spotlightItem)}</span>
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.08] text-slate-300 text-[11px] font-medium font-mono uppercase">
                    4K HEVC
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-[#F472B6]/15 border border-[#F472B6]/30 text-[#F472B6] text-[11px] font-semibold flex items-center space-x-1">
                    <Sparkles className="w-3 h-3" />
                    <span>全网弹幕</span>
                  </span>
                </div>

                {/* 剧集主标题 */}
                <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-50 tracking-tight drop-shadow-lg max-w-2xl line-clamp-1">
                  {spotlightItem.SeriesName || spotlightItem.Name}
                </h2>

                {/* 剧集简介 */}
                {spotlightItem.Overview && (
                  <p className="line-clamp-2 max-w-xl text-xs sm:text-sm text-slate-300 leading-relaxed mt-2 drop-shadow">
                    {spotlightItem.Overview}
                  </p>
                )}

                {/* 主行动按钮组 */}
                <div className="flex items-center space-x-3 mt-5">
                  <button
                    onClick={() => handleSpotlightPlay(spotlightItem)}
                    disabled={startingSpotlightPlay}
                    className="px-6 py-2.5 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-sky-500/25 transition flex items-center space-x-2 cursor-pointer disabled:opacity-60"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{startingSpotlightPlay ? '准备播放...' : '立即播放'}</span>
                  </button>
                  <button
                    onClick={() => handleSpotlightDetail(spotlightItem)}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-100 font-medium text-xs sm:text-sm backdrop-blur-md border border-white/10 transition flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                    <span>剧集详情</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. 媒体库各分类海报网格 (2:3 纵向海报) */}
          {views.map((v) => {
            const items = latestMap[v.Id] || [];
            if (items.length === 0) return null;

            return (
              <div key={v.Id} id={`view-${v.Id}`} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    {v.CollectionType === 'tvshows' ? (
                      <Tv className="w-4 h-4 text-primary" />
                    ) : (
                      <Film className="w-4 h-4 text-primary" />
                    )}
                    <h2 className="text-lg font-semibold tracking-tight text-slate-100">{v.Name}</h2>
                    {renderViewCountBadge(viewCounts[v.Id])}
                  </div>
                  <span className="text-xs text-slate-500 font-mono">最新入库</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                  {items.map((item) => (
                    <MediaCard
                      key={item.Id}
                      item={item}
                      serverUrl={currentServer!.url}
                      onClick={handleCardClick}
                      aspectRatio="poster"
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Emby 服务器管理弹窗 */}
      <EmbyServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
      />

      {/* 弹幕 API 节点设置弹窗 */}
      <DanmuServerModal
        isOpen={isDanmuModalOpen}
        onClose={() => setIsDanmuModalOpen(false)}
      />

      {/* 网络与代理设置弹窗 */}
      <NetworkProxyModal
        isOpen={isProxyModalOpen}
        onClose={() => setIsProxyModalOpen(false)}
      />
    </div>
  );
};

export default HomePage;
