import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  RefreshCw,
  Search,
  Server,
  Tv,
  Film,
  History,
  Info,
  CheckCircle2,
  Clock,
  HardDrive,
  TriangleAlert,
  X,
  Loader2,
} from 'lucide-react';
import { useAuthStore, SavedServer } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  EmbyItem,
  FederatedHistoryServerStat,
  FederatedServerTarget,
  formatFileSize,
  formatSeriesEpisodeBadge,
  getFederatedPlaybackHistory,
  getItemFileSize,
  resolveItemBackdropUrl,
  stripImageFormatWebp,
  ticksToSeconds,
} from '../api/embyClient';
import { fetchAndPreparePlaybackSession } from '../player/playbackSessionService';
import { ContinueWatchingSkeleton } from '../components/common/Skeletons';

type HistoryStatusFilter = 'all' | 'in_progress' | 'completed';

function formatClockTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatRelativePlayedTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return '';
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay} 天前`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return '';
  }
}

function formatFullDateTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

function buildContinueThumbnailUrl(item: EmbyItem, serverUrl: string): string {
  return resolveItemBackdropUrl(serverUrl, item, {
    maxWidth: 640,
    quality: 85,
    mode: 'card',
  });
}

function isItemInProgress(item: EmbyItem): boolean {
  const pos = item.UserData?.PlaybackPositionTicks || 0;
  return pos > 0 && !item.UserData?.Played;
}

export const ContinueWatchingPage: React.FC<{ isActive?: boolean }> = ({
  isActive = true,
}) => {
  const navigate = useNavigate();
  const servers = useAuthStore((s) => s.servers);
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const setCurrentServer = useAuthStore((s) => s.setCurrentServer);
  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);
  const continueWatchingCache = useMediaStore((s) => s.continueWatchingCache);
  const setContinueWatchingCache = useMediaStore((s) => s.setContinueWatchingCache);
  const playbackDirtyRevision = useMediaStore((s) => s.playbackDirtyRevision);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);

  const serverKey = useMemo(
    () => servers.map((s) => `${s.id}:${s.url}:${s.userId}`).join('|'),
    [servers]
  );

  const hasValidInitialCache =
    continueWatchingCache !== null && continueWatchingCache.serverKey === serverKey;

  const [items, setItems] = useState<EmbyItem[]>(() =>
    hasValidInitialCache ? continueWatchingCache.items : []
  );
  const [stats, setStats] = useState<FederatedHistoryServerStat[]>(() =>
    hasValidInitialCache ? continueWatchingCache.stats : []
  );
  const [loading, setLoading] = useState(() => !hasValidInitialCache && servers.length > 0);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingItemKey, setPlayingItemKey] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const itemsCountRef = useRef(items.length);
  itemsCountRef.current = items.length;
  const lastSyncedServerKeyRef = useRef<string | null>(
    hasValidInitialCache ? serverKey : null
  );
  const lastHandledDirtyRef = useRef(playbackDirtyRevision);

  useEffect(() => {
    if (isActive && servers.length === 0) {
      navigate('/login');
    }
  }, [isActive, servers.length, navigate]);

  const fetchHistory = useCallback(
    async (isManual = false) => {
      if (servers.length === 0) {
        setItems([]);
        setStats([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const reqId = ++reqIdRef.current;
      if (isManual || itemsCountRef.current > 0) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const targets: FederatedServerTarget[] = servers.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          userId: s.userId,
          accessToken: s.accessToken,
        }));
        const res = await getFederatedPlaybackHistory(targets, 36);
        if (reqId !== reqIdRef.current) return;
        setItems(res.items);
        setStats(res.stats);
        setContinueWatchingCache({
          serverKey,
          items: res.items,
          stats: res.stats,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        console.error('[ContinueWatchingPage] 获取多服播放记录失败:', err);
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [servers, serverKey, setContinueWatchingCache]
  );

  useEffect(() => {
    if (!isActive || servers.length === 0) return;

    const serverChanged = lastSyncedServerKeyRef.current !== serverKey;
    const dirtyChanged = lastHandledDirtyRef.current !== playbackDirtyRevision;
    if (!serverChanged && !dirtyChanged) return;

    lastSyncedServerKeyRef.current = serverKey;
    lastHandledDirtyRef.current = playbackDirtyRevision;
    fetchHistory(false);
  }, [isActive, servers.length, serverKey, playbackDirtyRevision, fetchHistory]);

  const syncServerIfNeeded = (item: EmbyItem): SavedServer | null => {
    if (item.ServerId && item.ServerId !== currentServer?.id) {
      const target = servers.find((s) => s.id === item.ServerId);
      if (target) {
        clearMediaCache();
        setCurrentServer(target.id);
        return target;
      }
    }
    return currentServer;
  };

  const handleOpenDetail = (item: EmbyItem) => {
    syncServerIfNeeded(item);
    navigate(`/detail/${item.Id}`, { state: { previewItem: item } });
  };

  const handlePlayItem = async (item: EmbyItem) => {
    const key = `${item.ServerId || ''}_${item.Id}`;
    if (playingItemKey !== null) return;

    const targetServer =
      (item.ServerId && servers.find((s) => s.id === item.ServerId)) || currentServer;
    if (!targetServer) return;

    try {
      setPlayingItemKey(key);
      const engineType = usePlayerStore.getState().engineType;
      const session = await fetchAndPreparePlaybackSession(
        targetServer,
        item.Id,
        engineType,
        item
      );
      syncServerIfNeeded(item);
      setPlaybackContext(session);
      navigate(`/player/${item.Id}`);
    } catch (err: any) {
      alert(`无法起播: ${err?.message || '请检查服务器连接状态'}`);
    } finally {
      setPlayingItemKey(null);
    }
  };

  const failedStats = useMemo(() => stats.filter((s) => !s.ok), [stats]);

  const filteredByServer = useMemo(() => {
    if (selectedServerId === 'ALL') return items;
    return items.filter((it) => it.ServerId === selectedServerId);
  }, [items, selectedServerId]);

  const statusCounts = useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    for (const it of filteredByServer) {
      if (isItemInProgress(it)) {
        inProgress += 1;
      } else {
        completed += 1;
      }
    }
    return {
      all: filteredByServer.length,
      in_progress: inProgress,
      completed,
    };
  }, [filteredByServer]);

  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return filteredByServer.filter((it) => {
      if (statusFilter === 'in_progress' && !isItemInProgress(it)) return false;
      if (statusFilter === 'completed' && isItemInProgress(it)) return false;
      if (!q) return true;
      return (
        (it.Name || '').toLowerCase().includes(q) ||
        (it.SeriesName || '').toLowerCase().includes(q) ||
        (it.Overview || '').toLowerCase().includes(q) ||
        (it.ServerName || '').toLowerCase().includes(q)
      );
    });
  }, [filteredByServer, statusFilter, searchQuery]);

  const successServerCount = stats.filter((s) => s.ok).length;

  return (
    <div className="w-full py-6 px-8 max-w-6xl mx-auto select-none space-y-6 pb-20">
      {/* 顶部标题与刷新 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center space-x-2.5">
            <History className="w-5 h-5 text-[#38BDF8]" />
            <span>继续观看与最近播放</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            已联合拉取 {successServerCount}/{servers.length} 台 Emby 服务器的断点进度与最近播放记录，共 {items.length} 条记录
          </p>
        </div>

        <button
          onClick={() => fetchHistory(true)}
          disabled={refreshing || loading}
          className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 hover:text-white border border-white/[0.08] text-xs font-medium transition inline-flex items-center space-x-2 cursor-pointer disabled:opacity-50"
          title="重新拉取全部服务器播放记录"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-primary' : ''}`} />
          <span>{refreshing ? '同步中...' : '刷新记录'}</span>
        </button>
      </div>

      {/* 离线/失败服务器提示 */}
      {failedStats.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start space-x-2.5 text-xs text-amber-200/90">
          <TriangleAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span>以下服务器本次未能同步播放记录：</span>
            {failedStats.map((s, idx) => (
              <span key={s.serverId}>
                {idx > 0 ? '、' : ''}
                <strong className="text-amber-100">{s.serverName}</strong>
                {s.error ? ` (${s.error})` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 多服务器筛选与状态/搜索工具条 */}
      <div className="space-y-3 bg-white/[0.02] border border-white/[0.06] rounded-2xl p-3.5">
        {/* 服务器胶囊切换栏 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <button
            onClick={() => setSelectedServerId('ALL')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition border cursor-pointer inline-flex items-center space-x-1.5 ${
              selectedServerId === 'ALL'
                ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>全部服务器 ({items.length})</span>
          </button>

          {servers.map((srv) => {
            const stat = stats.find((s) => s.serverId === srv.id);
            const isSelected = selectedServerId === srv.id;
            const isOnline = stat ? stat.ok : srv.lastTestOk !== false;
            const count = stat?.count ?? items.filter((i) => i.ServerId === srv.id).length;

            return (
              <button
                key={srv.id}
                onClick={() => setSelectedServerId(srv.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition border cursor-pointer inline-flex items-center space-x-2 ${
                  isSelected
                    ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                    : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08]'
                }`}
                title={stat?.error ? `${srv.name}: ${stat.error}` : srv.url}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span>{srv.name}</span>
                <span className="text-[11px] font-mono opacity-75">({count})</span>
              </button>
            );
          })}
        </div>

        {/* 播放状态切换 + 搜索框 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center bg-black/35 p-1 rounded-xl border border-white/[0.06] self-start">
            {(
              [
                { id: 'all', label: `全部 (${statusCounts.all})` },
                { id: 'in_progress', label: `进行中 (${statusCounts.in_progress})` },
                { id: 'completed', label: `已看完 (${statusCounts.completed})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-primary text-white shadow'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="筛选片名、剧名、服务器..."
              className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                title="清除搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 播放记录列表正文 */}
      {loading ? (
        <ContinueWatchingSkeleton count={6} />
      ) : displayedItems.length === 0 ? (
        <div className="py-24 rounded-2xl border border-white/[0.06] bg-white/[0.02] flex flex-col items-center justify-center text-center px-6 space-y-2">
          <History className="w-8 h-8 text-slate-600 mb-1" />
          <p className="text-sm font-medium text-slate-300">暂无符合条件的播放记录</p>
          <p className="text-xs text-slate-500 max-w-md">
            {searchQuery || statusFilter !== 'all' || selectedServerId !== 'ALL'
              ? '可尝试清空关键词、切换「全部」状态或选择「全部服务器」。'
              : '在任意已连接服务器中播放电影或剧集后，将在此集中呈现续播进度与观看历史。'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedItems.map((item) => {
            const effectiveServerUrl = item.ServerUrl || currentServer?.url || '';
            const thumbUrl = buildContinueThumbnailUrl(item, effectiveServerUrl);
            const isEpisode = item.Type === 'Episode';
            const mainTitle = isEpisode ? item.SeriesName || item.Name : item.Name;
            const seasonNum = item.ParentIndexNumber ?? 1;
            const epNum = item.IndexNumber;
            const episodeTag = isEpisode
              ? `${
                  epNum !== undefined
                    ? `S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
                    : '分集'
                }${item.Name && item.Name !== mainTitle ? ` · ${item.Name}` : ''}`
              : item.ProductionYear
              ? String(item.ProductionYear)
              : '';

            const posSec = ticksToSeconds(item.UserData?.PlaybackPositionTicks || 0);
            const totalSec = ticksToSeconds(item.RunTimeTicks || 0);
            const progressPercent =
              totalSec > 0 && posSec > 0
                ? Math.min(100, Math.round((posSec / totalSec) * 100))
                : 0;
            const remainingMin =
              totalSec > posSec ? Math.max(1, Math.round((totalSec - posSec) / 60)) : 0;
            const inProgress = isItemInProgress(item);
            const fileSizeLabel = formatFileSize(getItemFileSize(item));
            const relativePlayed = formatRelativePlayedTime(item.UserData?.LastPlayedDate);
            const fullPlayedTitle = formatFullDateTime(item.UserData?.LastPlayedDate);
            const seriesBadge = formatSeriesEpisodeBadge(item);
            const itemKey = `${item.ServerId || ''}_${item.Id}`;
            const isThisPlaying = playingItemKey === itemKey;

            return (
              <div
                key={itemKey}
                className="group rounded-2xl bg-[#131826]/80 hover:bg-[#171d2e] border border-white/[0.08] hover:border-[#38BDF8]/40 p-3.5 transition-all duration-200 flex flex-col md:flex-row items-stretch md:items-center gap-4 shadow-md shadow-black/25"
              >
                {/* 1. 左侧 16:9 剧照 */}
                <button
                  type="button"
                  onClick={() => handlePlayItem(item)}
                  disabled={playingItemKey !== null}
                  className="preserve-dark relative w-full md:w-52 lg:w-56 aspect-video rounded-xl overflow-hidden bg-black/60 shrink-0 border border-white/10 cursor-pointer group/thumb text-left disabled:cursor-wait"
                  title={`点击立即播放「${mainTitle}」`}
                >
                  {thumbUrl ? (
                    <img
                      key={thumbUrl}
                      src={thumbUrl}
                      alt={mainTitle}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
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
                        target.dataset.fallbackStep = 'done';
                        target.src =
                          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="%23131826"/><text x="50%" y="50%" fill="%2364748B" font-family="sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle">暂无封面</text></svg>';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full bg-[#131826] flex items-center justify-center text-xs text-slate-500">
                      暂无封面
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

                  {/* 左上角服务器微标 */}
                  {item.ServerName && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md border border-white/15 text-[10px] font-medium text-sky-300 flex items-center space-x-1 max-w-[140px] truncate">
                      <Server className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{item.ServerName}</span>
                    </div>
                  )}

                  {/* 右下角时长与体积 */}
                  {(totalSec > 0 || fileSizeLabel) && (
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-white/10 text-[10px] font-mono text-slate-200 tabular-nums inline-flex items-center gap-1">
                      {totalSec > 0 && <span>{formatClockTime(totalSec)}</span>}
                      {totalSec > 0 && fileSizeLabel && <span className="text-slate-500">·</span>}
                      {fileSizeLabel && <span className="text-sky-300/95">{fileSizeLabel}</span>}
                    </div>
                  )}

                  {/* 居中播放悬浮按钮 */}
                  <div className="absolute inset-0 bg-black/35 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-[#38BDF8] text-slate-950 flex items-center justify-center shadow-lg shadow-sky-500/35">
                      {isThisPlaying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      )}
                    </div>
                  </div>

                  {/* 底部进度条 */}
                  {progressPercent > 0 && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                      <div
                        className="h-full bg-[#38BDF8]"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                </button>

                {/* 2. 中部详情区 */}
                <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2 py-0.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] text-slate-300 font-medium">
                        {isEpisode ? (
                          <Tv className="w-3 h-3 text-sky-400" />
                        ) : (
                          <Film className="w-3 h-3 text-indigo-400" />
                        )}
                        <span>{isEpisode ? '剧集' : '电影'}</span>
                      </span>

                      <h2
                        onClick={() => handleOpenDetail(item)}
                        className="text-base font-bold text-slate-50 hover:text-[#38BDF8] transition-colors truncate cursor-pointer max-w-full"
                        title={mainTitle}
                      >
                        {mainTitle}
                      </h2>

                      {episodeTag && (
                        <span className="text-xs font-mono font-semibold text-sky-300 bg-sky-500/15 border border-sky-400/25 px-2 py-0.5 rounded-md truncate max-w-xs">
                          {episodeTag}
                        </span>
                      )}

                      {seriesBadge && !episodeTag && (
                        <span className="text-[11px] font-mono text-slate-300 bg-white/[0.06] px-2 py-0.5 rounded-md">
                          {seriesBadge}
                        </span>
                      )}
                    </div>

                    {item.Overview ? (
                      <p
                        className="text-xs text-slate-300/90 line-clamp-2 leading-relaxed"
                        title={item.Overview}
                      >
                        {item.Overview}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 italic">暂无简介信息</p>
                    )}
                  </div>

                  {/* 底部状态与元数据行 */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400 pt-1">
                    {inProgress ? (
                      <span className="inline-flex items-center space-x-1.5 text-sky-300 font-medium tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-sky-400" />
                        <span>
                          观看至 {formatClockTime(posSec)}
                          {totalSec > 0 ? ` / ${formatClockTime(totalSec)} (${progressPercent}%)` : ''}
                          {remainingMin > 0 ? ` · 剩余约 ${remainingMin} 分钟` : ''}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-emerald-300 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>已看完</span>
                      </span>
                    )}

                    {relativePlayed && (
                      <span
                        className="inline-flex items-center space-x-1 text-slate-400"
                        title={fullPlayedTitle || undefined}
                      >
                        <History className="w-3.5 h-3.5 text-slate-500" />
                        <span>{relativePlayed}播放</span>
                      </span>
                    )}

                    {fileSizeLabel && (
                      <span className="hidden sm:inline-flex items-center space-x-1 text-slate-400 font-mono text-[11px]">
                        <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                        <span>{fileSizeLabel}</span>
                      </span>
                    )}

                    {item.ServerName && (
                      <span className="inline-flex items-center space-x-1 text-slate-400">
                        <Server className="w-3.5 h-3.5 text-slate-500" />
                        <span>{item.ServerName}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* 3. 右侧快捷操作 */}
                <div className="flex md:flex-col items-center md:items-stretch justify-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-white/[0.06]">
                  <button
                    onClick={() => handlePlayItem(item)}
                    disabled={playingItemKey !== null}
                    className="flex-1 md:flex-none px-4 py-2 rounded-xl bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-xs transition flex items-center justify-center space-x-1.5 shadow-lg shadow-sky-500/20 cursor-pointer disabled:opacity-50"
                  >
                    {isThisPlaying ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>{isThisPlaying ? '加载中...' : inProgress ? '继续播放' : '重新播放'}</span>
                  </button>

                  <button
                    onClick={() => handleOpenDetail(item)}
                    className="flex-1 md:flex-none px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 hover:text-white border border-white/[0.08] font-medium text-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Info className="w-3.5 h-3.5" />
                    <span>{isEpisode ? '剧集详情' : '影片详情'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ContinueWatchingPage;
