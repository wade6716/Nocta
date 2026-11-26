import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, HardDrive, Layers, X, Loader2, Film, Volume2, Subtitles, Check } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  EmbyItem,
  EmbyMediaSource,
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
import {
  fetchAndPreparePlaybackSession,
  formatMediaSourceMeta,
  sortMediaSourcesByQuality,
} from '../player/playbackSessionService';
import { EpisodeGrid } from '../components/media/EpisodeGrid';

interface DetailedSourceSpecs {
  resolution?: string;
  dimensions?: string;
  hdr?: string;
  bitDepth?: string;
  videoCodec?: string;
  fps?: string;
  bitrate?: string;
  container?: string;
  size?: string;
  audioSummary?: string;
  subtitleCount: number;
}

function extractDetailedSourceSpecs(source?: EmbyMediaSource): DetailedSourceSpecs {
  if (!source) return { subtitleCount: 0 };
  const streams = source.MediaStreams || [];
  const videoStream = streams.find((s) => s.Type === 'Video');
  const audioStreams = streams.filter((s) => s.Type === 'Audio');
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle');

  const meta = formatMediaSourceMeta(source);
  const width = videoStream?.Width || 0;
  const height = videoStream?.Height || 0;
  const dimensions = width > 0 && height > 0 ? `${width}×${height}` : undefined;
  const bitDepth = videoStream?.BitDepth ? `${videoStream.BitDepth}-bit` : undefined;
  const videoCodec = videoStream?.Codec ? videoStream.Codec.toUpperCase() : undefined;

  const rawFps = videoStream?.RealFrameRate || videoStream?.AverageFrameRate;
  const fps = rawFps && rawFps > 0 ? `${Number(rawFps.toFixed(2))} fps` : undefined;

  const rawBitrate = source.Bitrate || videoStream?.BitRate;
  const bitrate =
    rawBitrate && rawBitrate > 0
      ? rawBitrate >= 1_000_000
        ? `${(rawBitrate / 1_000_000).toFixed(1)} Mbps`
        : `${Math.round(rawBitrate / 1000)} kbps`
      : undefined;

  let audioSummary: string | undefined;
  if (audioStreams.length > 0) {
    const primaryAudio = audioStreams.find((a) => a.IsDefault) || audioStreams[0];
    const codecPart = primaryAudio?.Codec ? primaryAudio.Codec.toUpperCase() : '';
    const chPart =
      primaryAudio?.ChannelLayout ||
      (primaryAudio?.Channels ? `${primaryAudio.Channels}ch` : '');
    const spec = [codecPart, chPart].filter(Boolean).join(' ');
    audioSummary =
      audioStreams.length > 1
        ? `${audioStreams.length} 条音轨${spec ? ` · ${spec}` : ''}`
        : spec || '1 条音轨';
  }

  return {
    resolution: meta.resolutionLabel,
    dimensions,
    hdr: meta.hdrLabel,
    bitDepth,
    videoCodec,
    fps,
    bitrate,
    container: meta.containerLabel || undefined,
    size: meta.sizeLabel,
    audioSummary,
    subtitleCount: subtitleStreams.length,
  };
}

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
  const [selectedEpisode, setSelectedEpisode] = useState<EmbyItem | null>(null);
  const [loadingEpisodeDetail, setLoadingEpisodeDetail] = useState(false);
  const [selectedMediaSourceId, setSelectedMediaSourceId] = useState<string | undefined>(undefined);
  const loadReqIdRef = useRef(0);
  const episodeDetailReqIdRef = useRef(0);
  const prevVersionItemIdRef = useRef<string | undefined>(undefined);
  const topRef = useRef<HTMLDivElement | null>(null);

  const hasSeriesContext =
    item?.Type === 'Series' || (item?.Type === 'Episode' && !!item?.SeriesId);
  const activePlayableItem = hasSeriesContext
    ? selectedEpisode || (item?.Type === 'Episode' ? item : null)
    : item;

  const sortedItemMediaSources = useMemo(
    () => sortMediaSourcesByQuality(activePlayableItem?.MediaSources || []),
    [activePlayableItem?.MediaSources]
  );

  useEffect(() => {
    const itemChanged = prevVersionItemIdRef.current !== activePlayableItem?.Id;
    prevVersionItemIdRef.current = activePlayableItem?.Id;
    if (sortedItemMediaSources.length === 0) {
      setSelectedMediaSourceId(undefined);
      return;
    }
    setSelectedMediaSourceId((prev) => {
      if (!itemChanged && prev && sortedItemMediaSources.some((ms) => ms.Id === prev)) {
        return prev;
      }
      return sortedItemMediaSources[0].Id;
    });
  }, [activePlayableItem?.Id, sortedItemMediaSources]);

  useEffect(() => {
    setOverviewExpanded(false);
    setSeriesItem(null);
    setSelectedEpisode(null);
    setLoadingEpisodeDetail(false);
    setBackdropStage(0);
    if (!currentServer || !itemId) {
      navigate('/');
      return;
    }
    loadItemDetail();
    return () => {
      loadReqIdRef.current += 1;
      episodeDetailReqIdRef.current += 1;
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
      setSelectedEpisode(detail.Type === 'Episode' ? detail : null);
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

  // 点击分集卡片：在顶部展示该集详细参数、介绍与清晰度版本，并同步拉取完整 MediaSources
  const handleSelectEpisode = async (ep: EmbyItem) => {
    setSelectedEpisode(ep);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!currentServer) return;
    const reqId = ++episodeDetailReqIdRef.current;
    setLoadingEpisodeDetail(true);
    try {
      const fullEp = await getItemDetail(
        currentServer.url,
        currentServer.userId,
        ep.Id,
        currentServer.accessToken
      );
      if (reqId !== episodeDetailReqIdRef.current) return;
      setSelectedEpisode(fullEp);
    } catch (err) {
      console.warn('[DetailPage] 获取单集完整详情失败:', err);
    } finally {
      if (reqId === episodeDetailReqIdRef.current) {
        setLoadingEpisodeDetail(false);
      }
    }
  };

  // Launch Playback for an item (movie or episode)
  const startPlayback = async (targetItem: EmbyItem, preferredMediaSourceId?: string) => {
    if (!currentServer) return;
    try {
      setStartingPlay(true);
      const engineType = usePlayerStore.getState().engineType;
      const session = await fetchAndPreparePlaybackSession(
        currentServer,
        targetItem.Id,
        engineType,
        targetItem,
        preferredMediaSourceId
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
      const sourcesWithSize = sortedItemMediaSources.filter(
        (ms) => typeof ms.Size === 'number' && Number.isFinite(ms.Size) && ms.Size > 0
      );
      const primarySize =
        sourcesWithSize[0]?.Size || sortedItemMediaSources[0]?.Size || getItemFileSize(item);
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

      const container = sourcesWithSize[0]?.Container || sortedItemMediaSources[0]?.Container;
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

  const activeMediaSource =
    sortedItemMediaSources.find((ms) => ms.Id === selectedMediaSourceId) ||
    sortedItemMediaSources[0];
  const activeSpecs = extractDetailedSourceSpecs(activeMediaSource);
  const selectedEpProgress =
    selectedEpisode && selectedEpisode.RunTimeTicks && selectedEpisode.UserData?.PlaybackPositionTicks
      ? Math.min(
          100,
          Math.round(
            (selectedEpisode.UserData.PlaybackPositionTicks / selectedEpisode.RunTimeTicks) * 100
          )
        )
      : 0;

  return (
    <div ref={topRef} className="w-full text-slate-100 select-none pb-24 relative min-h-full">
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

            {/* 流媒体规格标签组（全部来自真实元数据，无硬编码） */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-medium">
              {displayYear && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                  {displayYear}
                </span>
              )}
              {!isSeries && item.RunTimeTicks && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300 tabular-nums">
                  {Math.round(ticksToSeconds(item.RunTimeTicks) / 60)} 分钟
                </span>
              )}
              {isSeries && seasons.length > 0 && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300 tabular-nums">
                  共 {seasons.length} 季{episodes.length > 0 ? ` · 本季 ${episodes.length} 集` : ''}
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
              {!isSeries && activeSpecs.resolution && (
                <span className="px-2.5 py-1 rounded-md bg-[#38BDF8]/15 border border-[#38BDF8]/30 text-[#38BDF8] font-bold">
                  {activeSpecs.resolution}
                </span>
              )}
              {!isSeries && (activeSpecs.hdr || activeSpecs.bitDepth || activeSpecs.videoCodec) && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                  {[activeSpecs.hdr, activeSpecs.bitDepth, activeSpecs.videoCodec]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
              {!isSeries && activeSpecs.audioSummary && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                  {activeSpecs.audioSummary}
                </span>
              )}
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

            {/* 剧集选中分集详情面板（点击下方某一集后在顶部展示本集参数、介绍与多清晰度版本） */}
            {(isSeries || isEpisodeWithSeries) && selectedEpisode && (
              <div className="mt-4 p-5 rounded-2xl bg-[#131826]/90 border border-[#38BDF8]/35 shadow-xl shadow-black/40 space-y-4 max-w-3xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-[#38BDF8]/20 border border-[#38BDF8]/40 text-[#38BDF8] text-[11px] font-mono font-bold">
                        {selectedEpisode.ParentIndexNumber !== undefined
                          ? `S${selectedEpisode.ParentIndexNumber}`
                          : selectedEpisode.SeasonName || 'S1'}
                        {selectedEpisode.IndexNumber !== undefined
                          ? `E${String(selectedEpisode.IndexNumber).padStart(2, '0')}`
                          : ''}
                      </span>
                      <h2 className="text-base sm:text-lg font-bold text-white truncate">
                        {selectedEpisode.Name}
                      </h2>
                      {selectedEpisode.UserData?.Played ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/35 text-emerald-300 text-[11px] font-medium">
                          <Check className="w-3 h-3" />
                          <span>已看</span>
                        </span>
                      ) : selectedEpProgress > 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/35 text-sky-300 text-[11px] font-medium tabular-nums">
                          已播 {selectedEpProgress}%
                        </span>
                      ) : null}
                      {loadingEpisodeDetail && (
                        <Loader2 className="w-3.5 h-3.5 text-[#38BDF8] animate-spin" />
                      )}
                    </div>
                    {selectedEpisode.PremiereDate && (
                      <p className="text-[11px] font-mono text-slate-400">
                        首播日期：{selectedEpisode.PremiereDate.slice(0, 10)}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedEpisode(null)}
                    className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] text-slate-400 hover:text-white transition cursor-pointer shrink-0"
                    title="收起单集详情"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* 本集真实媒体参数徽章 */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                  {selectedEpisode.RunTimeTicks && (
                    <span className="px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-200 tabular-nums">
                      {Math.round(ticksToSeconds(selectedEpisode.RunTimeTicks) / 60)} 分钟
                    </span>
                  )}
                  {activeSpecs.resolution && (
                    <span className="px-2 py-1 rounded-md bg-[#38BDF8]/15 border border-[#38BDF8]/35 text-[#38BDF8] font-bold">
                      {activeSpecs.resolution}
                      {activeSpecs.dimensions ? ` (${activeSpecs.dimensions})` : ''}
                    </span>
                  )}
                  {(activeSpecs.hdr || activeSpecs.bitDepth) && (
                    <span className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-300">
                      {[activeSpecs.hdr, activeSpecs.bitDepth].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {(activeSpecs.videoCodec || activeSpecs.fps || activeSpecs.bitrate) && (
                    <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                      <Film className="w-3 h-3 text-slate-400" />
                      <span>
                        {[activeSpecs.videoCodec, activeSpecs.fps, activeSpecs.bitrate]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  )}
                  {(activeSpecs.container || activeSpecs.size) && (
                    <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300 tabular-nums">
                      <HardDrive className="w-3 h-3 text-[#38BDF8]" />
                      <span>
                        {[activeSpecs.container, activeSpecs.size].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  )}
                  {activeSpecs.audioSummary && (
                    <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                      <Volume2 className="w-3 h-3 text-slate-400" />
                      <span>{activeSpecs.audioSummary}</span>
                    </span>
                  )}
                  {activeSpecs.subtitleCount > 0 && (
                    <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                      <Subtitles className="w-3 h-3 text-slate-400" />
                      <span>{activeSpecs.subtitleCount} 条内封字幕</span>
                    </span>
                  )}
                </div>

                {/* 本集介绍 */}
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                  {selectedEpisode.Overview || '暂无本集剧情介绍'}
                </p>

                {/* 清晰度与多版本状态 */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
                    <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
                    {sortedItemMediaSources.length > 1 ? (
                      <span>
                        存在 {sortedItemMediaSources.length} 个清晰度/封装版本（默认已选最高画质，点击切换）
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">
                        当前仅 1 个清晰度版本（无其他版本）
                      </span>
                    )}
                  </div>

                  {sortedItemMediaSources.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {sortedItemMediaSources.map((ms, idx) => {
                        const isSelected =
                          ms.Id === (selectedMediaSourceId ?? sortedItemMediaSources[0]?.Id);
                        const meta = formatMediaSourceMeta(ms);
                        const specLine = [
                          meta.resolutionLabel,
                          meta.hdrLabel,
                          meta.containerLabel,
                          meta.sizeLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ');

                        return (
                          <button
                            key={ms.Id}
                            type="button"
                            onClick={() => setSelectedMediaSourceId(ms.Id)}
                            className={`text-left px-3.5 py-2 rounded-xl border text-xs transition cursor-pointer max-w-xs ${
                              isSelected
                                ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-white shadow-md shadow-sky-500/15'
                                : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08] hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <span className="font-semibold truncate">
                                {ms.Name || meta.resolutionLabel || '默认版本'}
                              </span>
                              {idx === 0 && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#38BDF8]/20 text-[#38BDF8] text-[10px] font-bold">
                                  最高画质
                                </span>
                              )}
                            </div>
                            {specLine && (
                              <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                                {specLine}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 本集起播按钮 */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => startPlayback(selectedEpisode, selectedMediaSourceId)}
                    disabled={startingPlay}
                    className="px-7 py-2.5 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-xs sm:text-sm shadow-xl shadow-sky-500/25 transition cursor-pointer inline-flex items-center space-x-2 disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>
                      {startingPlay
                        ? '正在获取直连流...'
                        : `${selectedEpProgress > 0 ? '继续播放' : '立即播放'} 第 ${
                            selectedEpisode.IndexNumber ?? 1
                          } 集${activeSpecs.resolution ? ` · ${activeSpecs.resolution}` : ''}`}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* 电影或独立单视频版本选择与直接起播按钮 */}
            {!isSeries && !isEpisodeWithSeries && (
              <div className="pt-2 space-y-3">
                {sortedItemMediaSources.length > 1 && (
                  <div className="space-y-2 max-w-3xl">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
                      <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
                      <span>选择播放版本（默认已选最高清晰度，共 {sortedItemMediaSources.length} 个版本）</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {sortedItemMediaSources.map((ms, idx) => {
                        const isSelected = ms.Id === (selectedMediaSourceId ?? sortedItemMediaSources[0]?.Id);
                        const meta = formatMediaSourceMeta(ms);
                        const specLine = [
                          meta.resolutionLabel,
                          meta.hdrLabel,
                          meta.containerLabel,
                          meta.sizeLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ');

                        return (
                          <button
                            key={ms.Id}
                            type="button"
                            onClick={() => setSelectedMediaSourceId(ms.Id)}
                            className={`text-left px-3.5 py-2 rounded-xl border text-xs transition cursor-pointer max-w-xs ${
                              isSelected
                                ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-white shadow-md shadow-sky-500/15'
                                : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08] hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <span className="font-semibold truncate">
                                {ms.Name || meta.resolutionLabel || '默认版本'}
                              </span>
                              {idx === 0 && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#38BDF8]/20 text-[#38BDF8] text-[10px] font-bold">
                                  最高画质
                                </span>
                              )}
                            </div>
                            {specLine && (
                              <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                                {specLine}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <button
                    onClick={() => startPlayback(item, selectedMediaSourceId)}
                    disabled={startingPlay}
                    className="px-8 py-3 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-sm shadow-xl shadow-sky-500/25 transition cursor-pointer flex items-center space-x-2 disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{playButtonLabel}</span>
                  </button>
                </div>
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
              currentEpisodeId={
                item.Type === 'Episode'
                  ? item.Id
                  : cachedPlayerItem?.Type === 'Episode' && cachedPlayerItem.SeriesId === item.Id
                  ? cachedPlayerItem.Id
                  : undefined
              }
              selectedEpisodeId={selectedEpisode?.Id}
              seriesItem={isSeries ? item : seriesItem}
              onSelectEpisode={handleSelectEpisode}
              onPlayEpisode={(ep) => startPlayback(ep)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default DetailPage;

