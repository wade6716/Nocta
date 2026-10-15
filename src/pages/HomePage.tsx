import React, { useEffect, useState, useCallback, useLayoutEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogOut,
  RefreshCw,
  Film,
  Tv,
  Play,
  History,
  Server,
  MessagesSquare,
  Globe,
  Search,
  Settings,
  Pencil,
  TriangleAlert,
  Info,
  Sparkles,
  Star,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import { DanmuServerModal } from '../components/danmu/DanmuServerModal';
import { EmbyServerModal } from '../components/settings/EmbyServerModal';
import { NetworkProxyModal } from '../components/settings/NetworkProxyModal';
import { ServerSwitcherDropdown } from '../components/layout/ServerSwitcherDropdown';
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
  buildItemImageUrl,
  formatSeriesEpisodeBadge,
} from '../api/embyClient';
import { MediaCard } from '../components/media/MediaCard';

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay}天前`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

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

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());

  const {
    serverId,
    resumeItems,
    nextUpItems,
    recentlyPlayedItems,
    views,
    latestMap,
    viewCounts,
    isLoaded,
    isRefreshing,
    homeScrollY,
    setMediaData,
    updateResumeAndRecent,
    updateViewCount,
    setRefreshing,
    setHomeScrollY,
    clearMediaCache,
  } = useMediaStore();

  const isCached = isLoaded && serverId === currentServer?.id;
  const [loading, setLoading] = useState(!isCached);
  const [isDanmuModalOpen, setIsDanmuModalOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);

  const fetchCountsForViews = useCallback(
    (currentViews: EmbyItem[]) => {
      if (!currentServer) return;
      currentViews.forEach((v) => {
        getViewItemCounts(
          currentServer.url,
          currentServer.userId,
          v.Id,
          v.CollectionType,
          currentServer.accessToken
        )
          .then((counts) => {
            updateViewCount(v.Id, counts);
          })
          .catch((e) => {
            console.warn(`[fetchCountsForViews error for ${v.Name}]`, e);
          });
      });
    },
    [currentServer, updateViewCount]
  );

  const loadData = useCallback(
    async (isManualRefresh = false) => {
      if (!currentServer) return;

      if (isManualRefresh) {
        setRefreshing(true);
      }

      try {
        // If we already have cache and it's not a forced manual refresh,
        // quietly update "继续观看" and "最近播放" in background without flashing the UI
        if (!isManualRefresh && isCached) {
          const [resResume, resNextUp, resRecent] = await Promise.all([
            getResumeItems(currentServer.url, currentServer.userId, currentServer.accessToken),
            getNextUpEpisodes(currentServer.url, currentServer.userId, currentServer.accessToken).catch(() => []),
            getRecentlyPlayedItems(currentServer.url, currentServer.userId, currentServer.accessToken).catch(() => []),
          ]);

          updateResumeAndRecent({
            resumeItems: resResume.Items || [],
            nextUpItems: resNextUp || [],
            recentlyPlayedItems: resRecent || [],
          });

          // 缓存模式下也在后台轻量同步各分类统计数
          if (views.length > 0) {
            fetchCountsForViews(views);
          }
          return;
        }

        // Full fetch (initial load or manual refresh button)
        const [resResume, resNextUp, resRecent, resViews] = await Promise.all([
          getResumeItems(currentServer.url, currentServer.userId, currentServer.accessToken),
          getNextUpEpisodes(currentServer.url, currentServer.userId, currentServer.accessToken).catch(() => []),
          getRecentlyPlayedItems(currentServer.url, currentServer.userId, currentServer.accessToken).catch(() => []),
          getUserViews(currentServer.url, currentServer.userId, currentServer.accessToken),
        ]);

        const userViews = resViews.Items || [];
        const latestEntries: Record<string, EmbyItem[]> = {};

        await Promise.all(
          userViews.map(async (v) => {
            try {
              const items = await getLatestItems(
                currentServer.url,
                currentServer.userId,
                v.Id,
                currentServer.accessToken,
                12
              );
              latestEntries[v.Id] = items;
            } catch (e) {
              console.warn(`Fetch latest for ${v.Name} failed`, e);
            }
          })
        );

        setMediaData({
          serverId: currentServer.id,
          resumeItems: resResume.Items || [],
          nextUpItems: resNextUp || [],
          recentlyPlayedItems: resRecent || [],
          views: userViews,
          latestMap: latestEntries,
        });

        // 异步并发拉取每个媒体库的剧集和电影数量
        fetchCountsForViews(userViews);
      } catch (err: any) {
        console.error('加载媒体库失败', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentServer, isCached, views, setMediaData, updateResumeAndRecent, setRefreshing, fetchCountsForViews]
  );

  useEffect(() => {
    if (!currentServer) {
      navigate('/login');
      return;
    }

    if (serverId !== currentServer.id) {
      setLoading(true);
    }

    loadData(false);
    // 服务器地址或令牌被编辑后，即便 id 不变也需重新拉取媒体库
  }, [currentServer?.id, currentServer?.url, currentServer?.accessToken]);

  // Restore scroll position when returning from video/detail pages
  useLayoutEffect(() => {
    if (isCached && homeScrollY > 0) {
      const container = document.getElementById('main-scroll-container');
      if (container) {
        container.scrollTop = homeScrollY;
      }
      const frameId = requestAnimationFrame(() => {
        const el = document.getElementById('main-scroll-container');
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
      const container = document.getElementById('main-scroll-container');
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
  }, [navigate]);

  const handleCardClick = (item: EmbyItem) => {
    const container = document.getElementById('main-scroll-container');
    if (container) {
      setHomeScrollY(container.scrollTop);
    }
    navigate(`/detail/${item.Id}`);
  };

  const handleLogout = () => {
    clearMediaCache();
    navigate('/login');
  };

  // 1. 合并“继续观看”：
  // 综合未完播 (resumeItems) 与待播下一集 (nextUpItems)；
  // 如果这两个都为空（例如用户在第二个服务器上看完后没有未完播内容），回退使用最近播放 (recentlyPlayedItems)
  // 并按相同媒体（剧集按 SeriesId/SeriesName）合并，只展示每部剧集最新进度的一张卡片！
  const continueWatchingItems = useMemo(() => {
    let sourceList: EmbyItem[] = [];
    if (resumeItems.length > 0 || nextUpItems.length > 0) {
      sourceList = [...resumeItems, ...nextUpItems];
    } else if (recentlyPlayedItems.length > 0) {
      // 容灾回退：若服务器未返回断点条目，直接以最近观看历史无缝承接继续观看
      sourceList = recentlyPlayedItems;
    }
    // 坚决过滤非视频（排除音乐、音频、歌单）
    const videoOnly = sourceList.filter(isVideoMedia);
    return mergeMediaBySeries(videoOnly);
  }, [resumeItems, nextUpItems, recentlyPlayedItems]);

  // 2. “最近观看历史”：
  // 从最近播放记录中过滤掉已经在“继续观看”中出现的同一部剧集或电影，同样按相同媒体聚合
  const filteredRecentItems = useMemo(() => {
    const continueKeys = new Set(
      continueWatchingItems.map((it) =>
        it.Type === 'Episode' ? (it.SeriesId || it.SeriesName || it.Id) : it.Id
      )
    );

    const nonDuplicate = recentlyPlayedItems
      .filter(isVideoMedia) // 排除一切音乐与音频
      .filter((it) => {
        const key = it.Type === 'Episode' ? (it.SeriesId || it.SeriesName || it.Id) : it.Id;
        return !continueKeys.has(key);
      });

    return mergeMediaBySeries(nonDuplicate);
  }, [recentlyPlayedItems, continueWatchingItems]);

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
    return buildItemImageUrl(
      currentServer.url,
      spotlightItem.SeriesId || spotlightItem.Id,
      spotlightItem.ImageTags?.Backdrop || spotlightItem.BackdropImageTags?.[0],
      { type: 'Backdrop', maxWidth: 1920, quality: 90 }
    );
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
          {spotlightItem && spotlightBackdropUrl && (
            <div className="h-[360px] md:h-[420px] rounded-2xl overflow-hidden relative border border-white/[0.08] shadow-2xl group">
              {/* 背景剧照 */}
              <img
                src={spotlightBackdropUrl}
                alt={spotlightItem.Name}
                className="absolute inset-0 w-full h-full object-cover object-top filter brightness-90 group-hover:scale-105 transition-transform duration-700 ease-out"
              />

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
                    onClick={() => handleCardClick(spotlightItem)}
                    className="px-6 py-2.5 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-sky-500/25 transition flex items-center space-x-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>立即播放</span>
                  </button>
                  <button
                    onClick={() => handleCardClick(spotlightItem)}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-100 font-medium text-xs sm:text-sm backdrop-blur-md border border-white/10 transition flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                    <span>剧集详情</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. 继续观看泳道 (Continue Watching - 16:9 横版滚动泳道) */}
          {continueWatchingItems.length > 0 && (
            <div id="continue-watching" className="space-y-4">
              <div className="flex items-center space-x-2">
                <Play className="w-4 h-4 text-[#38BDF8] fill-[#38BDF8]" />
                <h2 className="text-lg font-semibold tracking-tight text-slate-100">继续观看</h2>
                <span className="text-xs text-slate-500 font-medium">16:9 剧照与断点进度</span>
              </div>
              <div className="flex space-x-4 overflow-x-auto pb-4 pt-1 custom-scrollbar">
                {continueWatchingItems.map((item) => {
                  const hasProgress =
                    item.UserData?.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0;
                  return (
                    <div key={item.Id} className="w-64 md:w-72 flex-shrink-0">
                      <MediaCard
                        item={item}
                        serverUrl={currentServer!.url}
                        onClick={handleCardClick}
                        aspectRatio="backdrop"
                        badge={hasProgress ? undefined : '下一集'}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. 最近观看历史 (按相同媒体聚合) */}
          {filteredRecentItems.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <History className="w-4 h-4 text-indigo-400" />
                <h2 className="text-lg font-semibold tracking-tight text-slate-100">最近播放记录</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                {filteredRecentItems.map((item) => (
                  <MediaCard
                    key={item.Id}
                    item={item}
                    serverUrl={currentServer!.url}
                    onClick={handleCardClick}
                    aspectRatio="poster"
                    badge={formatRelativeTime(item.UserData?.LastPlayedDate)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 4. 媒体库各分类海报网格 (2:3 纵向海报) */}
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
