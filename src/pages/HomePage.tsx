import React, { useEffect, useState, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
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
  isMusicLibraryView,
  ticksToSeconds,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';
import { HeroCarousel } from '../components/media/HeroCarousel';
import { MediaRail } from '../components/media/MediaRail';

function scoreHeroCandidate(item: EmbyItem): number {
  let score = 0;
  if (
    item.BackdropImageTags?.length ||
    item.ImageTags?.Backdrop ||
    item.ParentBackdropImageTags?.length
  ) {
    score += 40;
  }
  if (item.ImageTags?.Logo || item.ParentLogoImageTag) {
    score += 25;
  }
  if (item.Overview && item.Overview.trim().length > 12) {
    score += 20;
  }
  if (typeof item.CommunityRating === 'number' && item.CommunityRating >= 7.0) {
    score += 15;
  } else if (typeof item.CommunityRating === 'number' && item.CommunityRating > 0) {
    score += 5;
  }
  if ((item.ProductionYear || item.PremiereDate) && item.Genres?.length) {
    score += 10;
  }
  return score;
}

const HomeSkeleton: React.FC = () => (
  <div className="w-full select-none animate-pulse">
    <div className="w-full h-[clamp(400px,58vh,560px)] bg-black/[0.06] dark:bg-white/[0.04] relative">
      <div className="absolute bottom-12 left-8 lg:left-12 space-y-4 max-w-xl">
        <div className="h-3.5 w-16 rounded bg-black/10 dark:bg-white/10" />
        <div className="h-10 w-72 rounded-lg bg-black/10 dark:bg-white/10" />
        <div className="h-4 w-96 rounded bg-black/[0.07] dark:bg-white/[0.06]" />
        <div className="flex space-x-3 pt-2">
          <div className="h-10 w-32 rounded-full bg-black/15 dark:bg-white/15" />
          <div className="h-10 w-28 rounded-full bg-black/[0.08] dark:bg-white/[0.08]" />
        </div>
      </div>
    </div>

    <div className="px-8 lg:px-12 py-8 space-y-11">
      {[0, 1].map((row) => (
        <div key={row} className="space-y-4">
          <div className="h-6 w-36 rounded-md bg-black/[0.08] dark:bg-white/[0.07]" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 7 }).map((_, idx) => (
              <div key={idx} className="w-[152px] sm:w-[168px] lg:w-[180px] flex-shrink-0 space-y-2.5">
                <div className="aspect-[2/3] rounded-[14px] bg-black/[0.06] dark:bg-white/[0.05]" />
                <div className="h-4 w-4/5 rounded bg-black/[0.07] dark:bg-white/[0.06]" />
                <div className="h-3 w-1/2 rounded bg-black/[0.05] dark:bg-white/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

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

        const allViews = resViews.Items || [];
        const videoViews = allViews.filter(
          (v) => !isMusicLibraryView(v) && (v.CollectionType || '').toLowerCase() !== 'photos'
        );
        const musicViews = allViews.filter(isMusicLibraryView);
        const latestEntries: Record<string, EmbyItem[]> = {};

        await Promise.all(
          videoViews.map(async (v) => {
            try {
              const items = await getLatestItems(
                targetServer.url,
                targetServer.userId,
                v.Id,
                targetServer.accessToken,
                18
              );
              latestEntries[v.Id] = items.filter(isVideoMedia);
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
          views: videoViews,
          musicViews,
          latestMap: latestEntries,
        });

        // 异步并发拉取每个媒体库的剧集和电影数量（Promise.allSettled 一次批量提交）
        fetchCountsForViews(videoViews, targetServer, reqId);
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

  // Hero Spotlight 轮播候选（最多 6 部：优先续看首位，其余按视觉质量评分择优挑选）
  const spotlightItems = useMemo(() => {
    const picked: EmbyItem[] = [];
    const seenIds = new Set<string>();

    const tryPush = (candidate?: EmbyItem) => {
      if (!candidate || seenIds.has(candidate.Id)) return;
      seenIds.add(candidate.Id);
      picked.push(candidate);
    };

    if (continueWatchingItems.length > 0) {
      tryPush(continueWatchingItems[0]);
    }

    for (const v of views) {
      if (picked.length >= 6) break;
      const list = [...(latestMap[v.Id] || [])].sort(
        (a, b) => scoreHeroCandidate(b) - scoreHeroCandidate(a)
      );
      for (const item of list) {
        if (item.BackdropImageTags?.length || item.ImageTags?.Backdrop || item.ImageTags?.Primary) {
          tryPush(item);
          break;
        }
      }
    }

    if (picked.length < 6) {
      const globalRanked = views
        .flatMap((v) => latestMap[v.Id] || [])
        .sort((a, b) => scoreHeroCandidate(b) - scoreHeroCandidate(a));
      for (const item of globalRanked) {
        if (picked.length >= 6) break;
        tryPush(item);
      }
    }

    return picked;
  }, [continueWatchingItems, views, latestMap]);

  return (
    <div className="w-full select-none">
      {/* 当前服务器上次连接失败：明确提示，避免媒体库空白被误认为无内容 */}
      {currentServer && currentServer.lastTestOk === false && (
        <div
          className={`mx-8 lg:mx-12 ${
            spotlightItems.length > 0 ? 'mt-16' : 'mt-16'
          } mb-2 p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-start justify-between space-x-3`}
        >
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
        <HomeSkeleton />
      ) : (
        <div className="w-full">
          {/* 1. Apple TV+ 沉浸式通栏无边距融底 Hero 轮播 */}
          {spotlightItems.length > 0 && currentServer && (
            <HeroCarousel
              items={spotlightItems}
              serverUrl={currentServer.url}
              startingPlay={startingSpotlightPlay}
              isRefreshing={isRefreshing}
              onPlay={handleSpotlightPlay}
              onDetail={handleSpotlightDetail}
              onRefresh={() => loadData(true)}
            />
          )}

          {/* 2. 影视墙横向发现轨道区 */}
          <div
            className={`relative z-10 px-8 lg:px-12 pb-16 space-y-9 ${
              spotlightItems.length > 0 ? 'pt-7' : 'pt-20'
            }`}
          >
            {/* 黄金首行：继续观看 (16:9 横版剧照轨道) */}
            {continueWatchingItems.length > 0 && currentServer && (
              <MediaRail
                title="继续观看"
                actionLabel="查看全部"
                onActionClick={() => navigate('/continue-watching')}
              >
                {continueWatchingItems.map((item) => {
                  const posSec = ticksToSeconds(item.UserData?.PlaybackPositionTicks || 0);
                  const totalSec = ticksToSeconds(item.RunTimeTicks || 0);
                  const remainMin =
                    totalSec > posSec ? Math.max(1, Math.ceil((totalSec - posSec) / 60)) : 0;

                  const epPrefix =
                    item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
                      ? `S${item.ParentIndexNumber}E${item.IndexNumber}`
                      : item.IndexNumber !== undefined
                      ? `第 ${item.IndexNumber} 集`
                      : '';
                  const continueSubtitle = epPrefix
                    ? `${epPrefix}${item.Name ? ` · ${item.Name}` : ''}`
                    : item.ProductionYear
                    ? String(item.ProductionYear)
                    : undefined;

                  return (
                    <div key={item.Id} className="w-[296px] sm:w-[324px] lg:w-[348px] flex-shrink-0">
                      <MediaCard
                        item={item}
                        serverUrl={currentServer.url}
                        onClick={handleSpotlightPlay}
                        aspectRatio="backdrop"
                        subtitle={continueSubtitle}
                        remainingLabel={remainMin > 0 ? `剩余 ${remainMin} 分钟` : undefined}
                      />
                    </div>
                  );
                })}
              </MediaRail>
            )}

            {/* 各媒体库分类单行横滑轨道 (2:3 竖版海报) */}
            {views
              .filter((v) => (latestMap[v.Id] || []).length > 0)
              .map((v, visibleIdx) => {
                const items = latestMap[v.Id] || [];
                const showDivider = continueWatchingItems.length > 0 || visibleIdx > 0;

                return (
                  <div
                    key={v.Id}
                    id={`view-${v.Id}`}
                    className={
                      showDivider
                        ? 'pt-9 border-t border-black/[0.06] dark:border-white/[0.07]'
                        : ''
                    }
                  >
                    <MediaRail
                      title={v.Name}
                      actionLabel="查看全部"
                      onActionClick={() => navigate(`/library/${v.Id}`)}
                    >
                      {items.map((item) => (
                        <div
                          key={item.Id}
                          className="w-[164px] sm:w-[178px] lg:w-[192px] flex-shrink-0"
                        >
                          <MediaCard
                            item={item}
                            serverUrl={currentServer!.url}
                            onClick={handleCardClick}
                            aspectRatio="poster"
                          />
                        </div>
                      ))}
                    </MediaRail>
                  </div>
                );
              })}
          </div>
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
