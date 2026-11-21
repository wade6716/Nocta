import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, HardDrive } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  EmbyItem,
  getItemDetail,
  getSeriesSeasons,
  getSeriesEpisodes,
  resolveItemBackdropUrl,
  resolveItemPosterUrl,
  stripImageFormatWebp,
  ticksToSeconds,
  formatFileSize,
  getItemFileSize,
} from '../api/embyClient';
import { fetchAndPreparePlaybackSession } from '../player/playbackSessionService';
import { EpisodeGrid } from '../components/media/EpisodeGrid';

export const DetailPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);

  const cachedPlayerItem = usePlayerStore((s) => s.item);
  const isCachedItem = cachedPlayerItem?.Id === itemId;
  const [item, setItem] = useState<EmbyItem | null>(() => (isCachedItem ? cachedPlayerItem : null));
  const [seriesItem, setSeriesItem] = useState<EmbyItem | null>(null);
  const [backdropStage, setBackdropStage] = useState(0);
  const [loading, setLoading] = useState(!isCachedItem);
  const [seasons, setSeasons] = useState<EmbyItem[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EmbyItem[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [startingPlay, setStartingPlay] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const loadReqIdRef = useRef(0);

  useEffect(() => {
    setOverviewExpanded(false);
    setSeriesItem(null);
    setBackdropStage(0);
    if (!currentServer || !itemId) {
      navigate('/');
      return;
    }
    loadItemDetail();
    return () => {
      loadReqIdRef.current += 1;
    };
  }, [itemId, currentServer?.id]);

  const loadItemDetail = async () => {
    if (!currentServer || !itemId) return;
    const reqId = ++loadReqIdRef.current;
    const isStale = () => reqId !== loadReqIdRef.current;

    try {
      if (!item || item.Id !== itemId) {
        setLoading(true);
      }
      const detail = await getItemDetail(
        currentServer.url,
        currentServer.userId,
        itemId,
        currentServer.accessToken
      );
      if (isStale()) return;
      setItem(detail);
      setBackdropStage(0);

      // If it's a TV Series or Episode, fetch seasons, episode list & parent series detail
      const targetSeriesId = detail.Type === 'Series' ? detail.Id : detail.SeriesId;
      if (targetSeriesId) {
        const [seasonsRes, parentSeries] = await Promise.all([
          getSeriesSeasons(
            currentServer.url,
            currentServer.userId,
            targetSeriesId,
            currentServer.accessToken
          ),
          detail.Type === 'Episode' && detail.SeriesId
            ? getItemDetail(
                currentServer.url,
                currentServer.userId,
                detail.SeriesId,
                currentServer.accessToken
              ).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (isStale()) return;
        setSeriesItem(parentSeries);

        const seasonList = seasonsRes.Items || [];
        setSeasons(seasonList);
        if (seasonList.length > 0) {
          const matchSeason =
            seasonList.find((s) => s.Id === detail.SeasonId) || seasonList[0];
          setSelectedSeasonId(matchSeason.Id);
          loadEpisodes(targetSeriesId, matchSeason.Id, reqId);
        } else {
          setSelectedSeasonId(null);
          setEpisodes([]);
        }
      } else {
        setSeriesItem(null);
        setSeasons([]);
        setSelectedSeasonId(null);
        setEpisodes([]);
      }
    } catch (err: any) {
      if (!isStale()) {
        console.error('获取条目详情失败', err);
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  };

  const loadEpisodes = async (seriesId: string, seasonId: string, reqId?: number) => {
    if (!currentServer) return;
    try {
      setEpisodesLoading(true);
      const res = await getSeriesEpisodes(
        currentServer.url,
        currentServer.userId,
        seriesId,
        seasonId,
        currentServer.accessToken
      );
      if (reqId !== undefined && reqId !== loadReqIdRef.current) return;
      setEpisodes(res.Items || []);
    } catch (err: any) {
      if (reqId === undefined || reqId === loadReqIdRef.current) {
        console.error('获取分集失败', err);
      }
    } finally {
      if (reqId === undefined || reqId === loadReqIdRef.current) {
        setEpisodesLoading(false);
      }
    }
  };

  const handleSeasonChange = (seasonId: string) => {
    setSelectedSeasonId(seasonId);
    if (item) {
      const targetSeriesId = item.Type === 'Series' ? item.Id : item.SeriesId;
      if (targetSeriesId) {
        loadEpisodes(targetSeriesId, seasonId);
      }
    }
  };

  // Launch Playback for an item (movie or episode)
  const startPlayback = async (targetItem: EmbyItem) => {
    if (!currentServer) return;
    try {
      setStartingPlay(true);
      const engineType = usePlayerStore.getState().engineType;
      const session = await fetchAndPreparePlaybackSession(
        currentServer,
        targetItem.Id,
        engineType,
        targetItem
      );

      setPlaybackContext(session);
      navigate(`/player/${targetItem.Id}`);
    } catch (err: any) {
      alert(`无法起播: ${err.message}`);
    } finally {
      setStartingPlay(false);
    }
  };

  if (loading || !item) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isSeries = item.Type === 'Series';
  const isEpisodeWithSeries = item.Type === 'Episode' && !!item.SeriesId;
  const displayTitle = isEpisodeWithSeries
    ? seriesItem?.Name || item.SeriesName || item.Name
    : item.Name;
  const displayYear =
    seriesItem?.ProductionYear ||
    seriesItem?.PremiereDate?.slice(0, 4) ||
    item.ProductionYear ||
    item.PremiereDate?.slice(0, 4);
  const displayOverview = isEpisodeWithSeries
    ? seriesItem?.Overview || item.Overview
    : item.Overview;
  const hasResumeTicks = (item.UserData?.PlaybackPositionTicks || 0) > 0;
  const playButtonLabel = startingPlay
    ? '正在获取直连流...'
    : isEpisodeWithSeries
    ? `${hasResumeTicks ? '继续播放' : '立即播放'} 第 ${item.IndexNumber || 1} 集`
    : '立即播放';

  const fileSizeSummary: { label: string; tooltip: string } | null = (() => {
    if (!isSeries) {
      const sourcesWithSize = (item.MediaSources || []).filter(
        (ms) => typeof ms.Size === 'number' && Number.isFinite(ms.Size) && ms.Size > 0
      );
      const primarySize = getItemFileSize(item);
      if (!primarySize) return null;

      if (sourcesWithSize.length > 1) {
        const lines = sourcesWithSize.map(
          (ms) =>
            `${ms.Name || '默认版本'}${
              ms.Container ? ` (${ms.Container.toUpperCase()})` : ''
            }: ${formatFileSize(ms.Size)}`
        );
        return {
          label: `${formatFileSize(primarySize)} · ${sourcesWithSize.length} 版本`,
          tooltip: lines.join('\n'),
        };
      }

      const container = sourcesWithSize[0]?.Container || item.MediaSources?.[0]?.Container;
      const formatted = formatFileSize(primarySize);
      return {
        label: formatted,
        tooltip: `视频文件体积：${formatted}${container ? ` (${container.toUpperCase()})` : ''}`,
      };
    }

    if (episodesLoading || episodes.length === 0) return null;
    const sizedEpisodes = episodes
      .map((ep) => getItemFileSize(ep))
      .filter((size): size is number => typeof size === 'number' && size > 0);
    if (sizedEpisodes.length === 0) return null;

    const totalBytes = sizedEpisodes.reduce((sum, size) => sum + size, 0);
    const prefix = seasons.length > 1 ? '本季' : '共';
    const totalLabel = formatFileSize(totalBytes);
    const avgLabel = formatFileSize(totalBytes / sizedEpisodes.length);
    return {
      label: `${prefix} ${totalLabel}`,
      tooltip: `当前季共 ${episodes.length} 集（已统计 ${sizedEpisodes.length} 集），总体积 ${totalLabel}，单集均约 ${avgLabel}`,
    };
  })();

  const posterUrl = resolveItemPosterUrl(currentServer!.url, item, {
    maxWidth: 500,
    quality: 90,
    seriesItem,
  });

  const rawBackdropUrl = resolveItemBackdropUrl(currentServer!.url, item, {
    maxWidth: 1920,
    quality: 90,
    seriesItem,
    mode: 'hero',
    allowPrimaryFallback: false,
  });
  const backdropCandidates = [
    rawBackdropUrl,
    stripImageFormatWebp(rawBackdropUrl),
    posterUrl,
    stripImageFormatWebp(posterUrl),
  ].filter((url, idx, arr): url is string => !!url && arr.indexOf(url) === idx);
  const effectiveBackdropUrl = backdropCandidates[backdropStage] || '';

  return (
    <div className="w-full text-slate-100 select-none pb-24 relative min-h-full">
      {/* 1. 全屏氛围背景 (Ambient Backdrop - 3xl blur, scale-110, pointer-events-none) */}
      {effectiveBackdropUrl && (
        <img
          key={effectiveBackdropUrl}
          src={effectiveBackdropUrl}
          alt=""
          aria-hidden="true"
          onError={() => setBackdropStage((prev) => prev + 1)}
          className="fixed inset-0 -z-10 w-full h-full object-cover opacity-20 blur-3xl scale-110 pointer-events-none"
        />
      )}

      {/* 2. 上半部信息头 (Header Split with Ambient Backing) */}
      <div className="relative w-full pt-8 px-8 max-w-7xl mx-auto">
        {/* 返回按钮 */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 p-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur-xl border border-white/[0.08] text-slate-200 hover:text-white transition cursor-pointer flex items-center space-x-1.5 text-xs font-medium group"
          title="返回上一页"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>返回</span>
        </button>

        <div className="flex flex-col md:flex-row items-start gap-8">
          {/* 左侧：高清竖版海报 (w-52 aspect-[2/3] rounded-2xl) */}
          <div className="w-48 sm:w-56 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/[0.12] shrink-0 bg-[#131826]">
            {posterUrl ? (
              <img
                key={posterUrl}
                src={posterUrl}
                alt={displayTitle}
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
                    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="100%" height="100%" fill="%23131826"/><text x="50%" y="50%" fill="%2364748B" font-family="sans-serif" font-size="18" text-anchor="middle" dominant-baseline="middle">暂无海报</text></svg>';
                }}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-[#131826] flex items-center justify-center text-sm text-slate-500">
                暂无海报
              </div>
            )}
          </div>

          {/* 右侧：标题、规格标签组与行动栏 */}
          <div className="flex-1 space-y-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-50 tracking-tight drop-shadow-md">
              {displayTitle}
            </h1>

            {isEpisodeWithSeries && (
              <p className="text-sm text-[#38BDF8] font-medium -mt-2">
                {[
                  item.ParentIndexNumber !== undefined
                    ? `第 ${item.ParentIndexNumber} 季`
                    : item.SeasonName || null,
                  item.IndexNumber !== undefined ? `第 ${item.IndexNumber} 集` : null,
                  item.Name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}

            {/* 流媒体规格标签组 */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-medium">
              {displayYear && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                  {displayYear}
                </span>
              )}
              {item.RunTimeTicks && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300 tabular-nums">
                  {Math.round(ticksToSeconds(item.RunTimeTicks) / 60)} 分钟
                </span>
              )}
              {fileSizeSummary && (
                <span
                  className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-200 tabular-nums inline-flex items-center space-x-1.5"
                  title={fileSizeSummary.tooltip}
                >
                  <HardDrive className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                  <span>{fileSizeSummary.label}</span>
                </span>
              )}
              <span className="px-2.5 py-1 rounded-md bg-[#38BDF8]/15 border border-[#38BDF8]/30 text-[#38BDF8] font-bold">
                4K HDR
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                10-bit HEVC
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                多音轨 / 封装字幕
              </span>
            </div>

            {/* 弹幕预检状态条 */}
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center space-x-2.5 max-w-2xl">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-xs text-slate-300">
                全网弹幕引擎已就绪 · 支持 Bilibili / 优爱腾全域弹幕自动匹配与时间轴微调
              </span>
            </div>

            {/* 剧情简介 */}
            {displayOverview && (
              <div className="max-w-3xl">
                <p
                  className={`text-sm text-slate-200/95 leading-7 whitespace-pre-line ${
                    overviewExpanded ? '' : 'line-clamp-4'
                  }`}
                >
                  {displayOverview}
                </p>
                {displayOverview.length > 120 && (
                  <button
                    onClick={() => setOverviewExpanded((v) => !v)}
                    className="mt-1.5 text-xs font-medium text-[#38BDF8] hover:text-sky-300 transition cursor-pointer"
                  >
                    {overviewExpanded ? '收起简介' : '展开全部'}
                  </button>
                )}
              </div>
            )}

            {/* 电影或指定单集直接起播按钮 */}
            {!isSeries && (
              <div className="pt-2">
                <button
                  onClick={() => startPlayback(item)}
                  disabled={startingPlay}
                  className="px-8 py-3 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-sm shadow-xl shadow-sky-500/25 transition cursor-pointer flex items-center space-x-2 disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{playButtonLabel}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. 下半部季与集选择器 (Season & Episode Grid) */}
      {(isSeries || (item.Type === 'Episode' && !!item.SeriesId)) && (
        <div className="px-8 mt-12 max-w-7xl mx-auto space-y-6">
          {/* 横向季胶囊 Tab 栏 */}
          {seasons.length > 0 && (
            <div className="flex items-center space-x-2 border-b border-white/[0.06] pb-3 overflow-x-auto custom-scrollbar">
              {seasons.map((s) => {
                const isActive = selectedSeasonId === s.Id;
                return (
                  <button
                    key={s.Id}
                    onClick={() => handleSeasonChange(s.Id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer whitespace-nowrap border ${
                      isActive
                        ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8] shadow-md shadow-sky-500/10'
                        : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                    }`}
                  >
                    {s.Name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Episode Grid */}
          {episodesLoading ? (
            <div className="py-24 text-center text-xs text-slate-400">正在同步分集列表...</div>
          ) : (
            <EpisodeGrid
              episodes={episodes}
              serverUrl={currentServer!.url}
              currentEpisodeId={item.Type === 'Episode' ? item.Id : undefined}
              seriesItem={isSeries ? item : seriesItem}
              onSelectEpisode={(ep) => startPlayback(ep)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default DetailPage;

