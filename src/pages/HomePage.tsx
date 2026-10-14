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
  Pencil,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import { DanmuServerModal } from '../components/danmu/DanmuServerModal';
import { EmbyServerModal } from '../components/settings/EmbyServerModal';
import {
  EmbyItem,
  getUserViews,
  getResumeItems,
  getRecentlyPlayedItems,
  getNextUpEpisodes,
  getLatestItems,
  mergeMediaBySeries,
  isVideoMedia,
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
    isLoaded,
    isRefreshing,
    homeScrollY,
    setMediaData,
    updateResumeAndRecent,
    setRefreshing,
    setHomeScrollY,
    clearMediaCache,
  } = useMediaStore();

  const isCached = isLoaded && serverId === currentServer?.id;
  const [loading, setLoading] = useState(!isCached);
  const [isDanmuModalOpen, setIsDanmuModalOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

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
      } catch (err: any) {
        console.error('加载媒体库失败', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentServer, isCached, setMediaData, updateResumeAndRecent, setRefreshing]
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

  return (
    <div className="w-full py-6 px-8 select-none">
      {/* Top Navbar */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>媒体库</span>
            {currentServer && (
              <button
                onClick={() => setIsServerModalOpen(true)}
                className="text-xs px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-full font-normal text-gray-300 hover:text-white transition cursor-pointer flex items-center space-x-1.5 group"
                title="编辑服务器信息"
              >
                <span>{currentServer.name}</span>
                <Pencil className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              </button>
            )}
          </h1>
          <p className="text-xs text-gray-400 mt-1">欢迎回来，{currentServer?.username || '用户'}</p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsServerModalOpen(true)}
            className="p-2 rounded-xl bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="Emby 服务器管理 / 编辑服务器信息"
          >
            <Server className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsDanmuModalOpen(true)}
            className="p-2 rounded-xl bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="弹幕 API 节点设置"
          >
            <MessagesSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => loadData(true)}
            disabled={isRefreshing || loading}
            className="p-2 rounded-xl bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="手动刷新媒体库"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-xl bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="切换服务器 / 登出"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-gray-400">正在同步媒体库信息...</p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Continue Watching Section (按相同媒体合并后的继续观看) */}
          {continueWatchingItems.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Play className="w-4 h-4 text-primary fill-primary" />
                <h2 className="text-lg font-bold text-white tracking-wide">继续观看</h2>
                <span className="text-xs text-gray-400">相同剧集已聚合为最新一集</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {continueWatchingItems.map((item) => {
                  const hasProgress =
                    item.UserData?.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0;
                  return (
                    <MediaCard
                      key={item.Id}
                      item={item}
                      serverUrl={currentServer!.url}
                      onClick={handleCardClick}
                      aspectRatio="backdrop"
                      badge={hasProgress ? undefined : '下一集'}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Recently Played Section (最近观看历史，按相同媒体聚合) */}
          {filteredRecentItems.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <History className="w-4 h-4 text-indigo-400" />
                <h2 className="text-lg font-bold text-white tracking-wide">最近观看</h2>
                <span className="text-xs text-gray-400">历史播放记录</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
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

          {/* Library Categories Shelves */}
          {views.map((v) => {
            const items = latestMap[v.Id] || [];
            if (items.length === 0) return null;

            return (
              <div key={v.Id} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {v.CollectionType === 'tvshows' ? (
                      <Tv className="w-4 h-4 text-primary" />
                    ) : (
                      <Film className="w-4 h-4 text-primary" />
                    )}
                    <h2 className="text-lg font-bold text-white tracking-wide">{v.Name}</h2>
                  </div>
                  <span className="text-xs text-gray-400 font-mono">最新入库</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
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
    </div>
  );
};

export default HomePage;
