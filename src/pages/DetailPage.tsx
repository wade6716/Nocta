import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Film,
  HardDrive,
  Layers,
  Loader2,
  Play,
  Star,
  Subtitles,
  Volume2,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  EmbyItem,
  EmbyMediaSource,
  getItemDetail,
  getSimilarItems,
  getSeriesSeasons,
  getSeriesEpisodes,
  resolveItemBackdropUrl,
  resolveItemPosterUrl,
  stripImageFormatWebp,
  ticksToSeconds,
  formatFileSize,
  getItemFileSize,
  formatSeriesEpisodeBadge,
} from '../api/embyClient';
import {
  fetchAndPreparePlaybackSession,
  formatMediaSourceMeta,
  sortMediaSourcesByQuality,
} from '../player/playbackSessionService';
import { EpisodeGrid } from '../components/media/EpisodeGrid';
import { CastRail } from '../components/media/CastRail';
import { MediaRail } from '../components/media/MediaRail';
import { MediaCard } from '../components/media/MediaCard';
import { DetailAboutSection } from '../components/media/DetailAboutSection';

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

function resolveDefaultEpisode(episodes: EmbyItem[]): EmbyItem | null {
  if (episodes.length === 0) return null;

  const inProgress = episodes.find(
    (ep) => (ep.UserData?.PlaybackPositionTicks || 0) > 0 && !ep.UserData?.Played
  );
  if (inProgress) return inProgress;

  for (let i = episodes.length - 1; i >= 0; i--) {
    if (episodes[i].UserData?.Played) {
      return episodes[i + 1] ?? episodes[i];
    }
  }
  return episodes[0];
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
  const [similarItems, setSimilarItems] = useState<EmbyItem[]>([]);
  const [startingPlay, setStartingPlay] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [overviewMode, setOverviewMode] = useState<'episode' | 'series'>('episode');
  const [selectedEpisode, setSelectedEpisode] = useState<EmbyItem | null>(null);
  const [loadingEpisodeDetail, setLoadingEpisodeDetail] = useState(false);
  const [selectedMediaSourceId, setSelectedMediaSourceId] = useState<string | undefined>(undefined);
  const loadReqIdRef = useRef(0);
  const episodeDetailReqIdRef = useRef(0);
  const prevVersionItemIdRef = useRef<string | undefined>(undefined);
  const heroRef = useRef<HTMLElement | null>(null);

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
    setOverviewMode('episode');
    setSeriesItem(null);
    setSelectedEpisode(null);
    setSimilarItems([]);
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

  const fetchEpisodeFullDetail = async (ep: EmbyItem) => {
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

  const loadItemDetail = async () => {
    if (!currentServer || !itemId) return;
    const reqId = ++loadReqIdRef.current;
    const isStale = () => reqId !== loadReqIdRef.current;

    try {
      if (!item || item.Id !== itemId) {
        setLoading(true);
      }
      const [detail, initialSimilar] = await Promise.all([
        getItemDetail(
          currentServer.url,
          currentServer.userId,
          itemId,
          currentServer.accessToken
        ),
        getSimilarItems(
          currentServer.url,
          currentServer.userId,
          itemId,
          currentServer.accessToken,
          14
        ).catch(() => [] as EmbyItem[]),
      ]);
      if (isStale()) return;
      setItem(detail);
      setSimilarItems(initialSimilar);
      const initialEp = detail.Type === 'Episode' ? detail : null;
      setSelectedEpisode(initialEp);
      setBackdropStage(0);

      // If it's a TV Series or Episode, fetch seasons, episode list & parent series detail
      const targetSeriesId = detail.Type === 'Series' ? detail.Id : detail.SeriesId;
      if (targetSeriesId) {
        const [seasonsRes, parentSeries, seriesSimilar] = await Promise.all([
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
          detail.Type === 'Episode' && detail.SeriesId && initialSimilar.length === 0
            ? getSimilarItems(
                currentServer.url,
                currentServer.userId,
                detail.SeriesId,
                currentServer.accessToken,
                14
              ).catch(() => [] as EmbyItem[])
            : Promise.resolve(null),
        ]);
        if (isStale()) return;
        setSeriesItem(parentSeries);
        if (seriesSimilar && seriesSimilar.length > 0) {
          setSimilarItems(seriesSimilar);
        }

        const seasonList = seasonsRes.Items || [];
        setSeasons(seasonList);
        if (seasonList.length > 0) {
          const matchSeason =
            seasonList.find((s) => s.Id === detail.SeasonId) || seasonList[0];
          setSelectedSeasonId(matchSeason.Id);
          loadEpisodes(targetSeriesId, matchSeason.Id, reqId, !initialEp);
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

  const loadEpisodes = async (
    seriesId: string,
    seasonId: string,
    reqId?: number,
    autoFocusDefault = false
  ) => {
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
      const list = res.Items || [];
      setEpisodes(list);

      if (autoFocusDefault && list.length > 0) {
        const defaultEp = resolveDefaultEpisode(list);
        if (defaultEp) {
          setSelectedEpisode(defaultEp);
          fetchEpisodeFullDetail(defaultEp);
        }
      }
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
        loadEpisodes(targetSeriesId, seasonId, undefined, true);
      }
    }
  };

  // 点击分集卡片：顶部 Hero 局部信息原地切换为本集（仅当 Hero 已滚出视口时平滑回滚）
  const handleSelectEpisode = (ep: EmbyItem) => {
    setSelectedEpisode(ep);
    setOverviewExpanded(false);
    if (ep.Overview?.trim()) {
      setOverviewMode('episode');
    }

    if (heroRef.current) {
      const rect = heroRef.current.getBoundingClientRect();
      if (rect.top < -60) {
        heroRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    fetchEpisodeFullDetail(ep);
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
  const heroEntity = isEpisodeWithSeries ? seriesItem || item : item;

  const displayTitle = isEpisodeWithSeries
    ? seriesItem?.Name || item.SeriesName || item.Name
    : item.Name;
  const displayYear =
    seriesItem?.ProductionYear ||
    seriesItem?.PremiereDate?.slice(0, 4) ||
    item.ProductionYear ||
    item.PremiereDate?.slice(0, 4);
  const seriesOverview = (isEpisodeWithSeries ? seriesItem?.Overview : item.Overview)?.trim() || '';
  const episodeOverview = hasSeriesContext ? selectedEpisode?.Overview?.trim() || '' : '';
  const canToggleOverview = Boolean(hasSeriesContext && seriesOverview && episodeOverview);
  const effectiveOverviewMode =
    hasSeriesContext && overviewMode === 'episode' && episodeOverview
      ? 'episode'
      : hasSeriesContext && seriesOverview
      ? 'series'
      : episodeOverview
      ? 'episode'
      : 'series';
  const activeOverviewText = hasSeriesContext
    ? effectiveOverviewMode === 'episode'
      ? episodeOverview
      : seriesOverview
    : item.Overview?.trim() || '';

  const heroRating =
    typeof heroEntity.CommunityRating === 'number' && heroEntity.CommunityRating > 0
      ? heroEntity.CommunityRating.toFixed(1)
      : null;
  const heroOfficialRating = heroEntity.OfficialRating;
  const heroGenres = (heroEntity.Genres || []).slice(0, 3);
  const seriesEpisodeBadge = hasSeriesContext ? formatSeriesEpisodeBadge(heroEntity) : null;

  const activeMediaSource =
    sortedItemMediaSources.find((ms) => ms.Id === selectedMediaSourceId) ||
    sortedItemMediaSources[0];
  const activeSpecs = extractDetailedSourceSpecs(activeMediaSource);

  const activePlayableProgress =
    activePlayableItem?.RunTimeTicks && activePlayableItem?.UserData?.PlaybackPositionTicks
      ? Math.min(
          100,
          Math.round(
            (activePlayableItem.UserData.PlaybackPositionTicks / activePlayableItem.RunTimeTicks) *
              100
          )
        )
      : 0;
  const activeHasResume =
    (activePlayableItem?.UserData?.PlaybackPositionTicks || 0) > 0 &&
    !activePlayableItem?.UserData?.Played;

  const activeEpCode =
    hasSeriesContext && selectedEpisode
      ? `${
          selectedEpisode.ParentIndexNumber !== undefined
            ? `S${selectedEpisode.ParentIndexNumber}`
            : selectedEpisode.SeasonName || 'S1'
        }${
          selectedEpisode.IndexNumber !== undefined
            ? `E${String(selectedEpisode.IndexNumber).padStart(2, '0')}`
            : ''
        }`
      : '';

  const primaryPlayLabel = startingPlay
    ? '正在获取直连流...'
    : hasSeriesContext
    ? activePlayableItem
      ? `${activeHasResume ? '继续播放' : '立即播放'} 第 ${activePlayableItem.IndexNumber ?? 1} 集${
          activeSpecs.resolution ? ` · ${activeSpecs.resolution}` : ''
        }`
      : '正在加载分集...'
    : `${activeHasResume ? '继续播放' : '立即播放'}${
        activeSpecs.resolution ? ` · ${activeSpecs.resolution}` : ''
      }`;

  const seasonTotalSizeSummary: { label: string; tooltip: string } | null = (() => {
    if (!hasSeriesContext || episodesLoading || episodes.length === 0) return null;
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
  const isPosterBackdropFallback =
    !rawBackdropUrl ||
    (effectiveBackdropUrl !== '' && effectiveBackdropUrl === posterUrl) ||
    backdropStage >= 2;

  const seriesMetaParts: string[] = [];
  if (displayYear) seriesMetaParts.push(String(displayYear));
  if (hasSeriesContext) {
    if (seasons.length > 1) {
      seriesMetaParts.push(`共 ${seasons.length} 季`);
    }
    if (seriesEpisodeBadge) {
      seriesMetaParts.push(seriesEpisodeBadge);
    } else if (episodes.length > 0) {
      seriesMetaParts.push(`共 ${episodes.length} 集`);
    }
  }
  if (heroGenres.length > 0) {
    seriesMetaParts.push(heroGenres.join(' / '));
  }

  const heroPeople =
    isEpisodeWithSeries && seriesItem?.People?.length
      ? seriesItem.People
      : item.People || [];

  return (
    <div className="w-full text-[#1D1D1F] dark:text-[#F5F5F7] select-none relative min-h-full flex flex-col">
      {/* 1. 全出血 Apple TV+ / Infuse 一体化沉浸 Hero */}
      <div className="relative w-full">
        {/* 动态剧照环境色柔光过渡带 */}
        {effectiveBackdropUrl && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-20 inset-x-0 h-32 overflow-hidden z-0"
            style={{
              maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)',
            }}
          >
            <img
              src={effectiveBackdropUrl}
              alt=""
              className="w-full h-full object-cover object-bottom scale-110 blur-[48px] saturate-150 opacity-[0.20] dark:opacity-[0.32]"
            />
          </div>
        )}

        <section
          ref={heroRef}
          className={`preserve-dark relative z-10 w-full overflow-hidden bg-[#0A0A0C] ${
            !hasSeriesContext ? 'min-h-[460px] md:min-h-[500px] flex flex-col' : ''
          }`}
        >
          {/* 真实剧照背景层 */}
          {effectiveBackdropUrl && (
            <img
              key={effectiveBackdropUrl}
              src={effectiveBackdropUrl}
              alt=""
              aria-hidden="true"
              onError={() => setBackdropStage((prev) => prev + 1)}
              className={`absolute inset-0 w-full h-full object-cover object-center pointer-events-none transition-opacity duration-500 ${
                isPosterBackdropFallback
                  ? 'opacity-30 blur-2xl scale-110'
                  : 'opacity-58 scale-[1.02]'
              }`}
            />
          )}

          {/* 光学三层暗角遮罩 */}
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 via-black/18 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/48 via-42% to-transparent dark:from-[#0A0A0C] dark:via-[#0A0A0C]/55 dark:via-42% dark:to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/52 via-55% to-transparent pointer-events-none" />

          {/* Hero 前景内容（顶部留白避让悬浮顶栏） */}
          <div
            className={`relative z-10 w-full max-w-[1440px] mx-auto px-8 lg:px-12 pt-16 pb-9 ${
              !hasSeriesContext ? 'flex-1 flex flex-col justify-between' : ''
            }`}
          >
          {/* 顶部导航与极简弹幕状态微标 */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-3.5 py-1.5 rounded-full bg-black/30 hover:bg-white/15 backdrop-blur-xl border border-white/[0.15] text-white/90 hover:text-white transition cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium group"
              title="返回上一页"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
              <span>返回</span>
            </button>

            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/30 backdrop-blur-xl border border-white/[0.12] text-[11px] text-white/80"
              title="支持 Bilibili / 优爱腾全域弹幕自动匹配与时间轴微调"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span>弹幕引擎就绪</span>
            </div>
          </div>

          {/* 均衡双栏 Hero：左海报定锚 + 右侧一体化信息流 */}
          <div className="flex flex-col md:flex-row items-start md:items-end gap-7">
            {/* 左侧：剧集/电影竖版海报（稳定锚点，不重复显示单集封面图） */}
            <div className="w-40 sm:w-44 lg:w-48 aspect-[2/3] rounded-[14px] overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.68)] ring-1 ring-inset ring-white/[0.16] shrink-0 bg-[#1C1C1E]">
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
                      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="100%" height="100%" fill="%231C1C1E"/><text x="50%" y="50%" fill="%2386868B" font-family="sans-serif" font-size="18" text-anchor="middle" dominant-baseline="middle">暂无海报</text></svg>';
                  }}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-[#1C1C1E] flex items-center justify-center text-sm text-white/50">
                  暂无海报
                </div>
              )}
            </div>

            {/* 右侧：一体化信息流（主体身份 -> 当前分集 -> 紧凑技术规格 -> 智能简介 -> 唯一主行动行） */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Row 1: 剧集/电影主体标题 + 评分 + 轻量点分隔元信息 */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-[-0.02em] drop-shadow-md">
                    {displayTitle}
                  </h1>
                  {heroRating && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.12] border border-white/[0.18] text-white/95 text-xs font-mono font-semibold tabular-nums">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span>{heroRating}</span>
                    </span>
                  )}
                  {heroOfficialRating && (
                    <span className="px-1.5 py-[1px] rounded-[4px] border border-white/30 text-[10px] font-semibold font-mono text-white/85">
                      {heroOfficialRating}
                    </span>
                  )}
                </div>

                {/* 轻量主体元信息行（点分隔，无沉重边框堆叠） */}
                {(seriesMetaParts.length > 0 || seasonTotalSizeSummary) && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/80">
                    {seriesMetaParts.map((part, idx) => (
                      <React.Fragment key={`${part}-${idx}`}>
                        {idx > 0 && <span className="text-white/40">·</span>}
                        <span>{part}</span>
                      </React.Fragment>
                    ))}
                    {seasonTotalSizeSummary && (
                      <>
                        {seriesMetaParts.length > 0 && <span className="text-white/40">·</span>}
                        <span
                          className="font-mono tabular-nums text-white/65"
                          title={seasonTotalSizeSummary.tooltip}
                        >
                          {seasonTotalSizeSummary.label}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Row 2: 剧集当前聚焦分集行（点击下方分集时平滑切换） */}
              {hasSeriesContext && selectedEpisode && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.14] border border-white/[0.22] text-white text-xs font-mono font-semibold tabular-nums">
                    {activeEpCode}
                  </span>
                  <h2 className="text-base sm:text-lg font-semibold text-white truncate max-w-2xl">
                    {selectedEpisode.Name}
                  </h2>
                  {selectedEpisode.UserData?.Played ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.12] border border-white/[0.18] text-white/90 text-[11px] font-medium">
                      <Check className="w-3 h-3" />
                      <span>已看</span>
                    </span>
                  ) : activePlayableProgress > 0 ? (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.12] border border-white/[0.18] text-white/90 text-[11px] font-mono tabular-nums">
                      已播 {activePlayableProgress}%
                    </span>
                  ) : null}
                  {selectedEpisode.PremiereDate && (
                    <span className="text-[11px] font-mono text-white/60">
                      {selectedEpisode.PremiereDate.slice(0, 10)}
                    </span>
                  )}
                  {loadingEpisodeDetail && (
                    <Loader2 className="w-3.5 h-3.5 text-white/80 animate-spin shrink-0" />
                  )}
                </div>
              )}

              {/* Row 3: Infuse 风格单行紧凑媒体技术规格标（极简半透黑白微标） */}
              {activePlayableItem && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                  {activePlayableItem.RunTimeTicks && (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-white/90 tabular-nums">
                      {Math.round(ticksToSeconds(activePlayableItem.RunTimeTicks) / 60)} 分钟
                    </span>
                  )}
                  {activeSpecs.resolution && (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.14] border border-white/[0.22] text-white font-semibold">
                      {activeSpecs.resolution}
                      {activeSpecs.dimensions ? ` (${activeSpecs.dimensions})` : ''}
                    </span>
                  )}
                  {(activeSpecs.hdr || activeSpecs.bitDepth) && (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-white/90">
                      {[activeSpecs.hdr, activeSpecs.bitDepth].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {(activeSpecs.videoCodec || activeSpecs.fps || activeSpecs.bitrate) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-white/85">
                      <Film className="w-3 h-3 text-white/65" />
                      <span>
                        {[activeSpecs.videoCodec, activeSpecs.fps, activeSpecs.bitrate]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  )}
                  {(activeSpecs.container || activeSpecs.size) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-white/85 tabular-nums">
                      <HardDrive className="w-3 h-3 text-white/65" />
                      <span>
                        {[activeSpecs.container, activeSpecs.size].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  )}
                  {activeSpecs.audioSummary && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-white/85">
                      <Volume2 className="w-3 h-3 text-white/65" />
                      <span>{activeSpecs.audioSummary}</span>
                    </span>
                  )}
                  {activeSpecs.subtitleCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.12] text-white/85">
                      <Subtitles className="w-3 h-3 text-white/65" />
                      <span>{activeSpecs.subtitleCount} 条字幕</span>
                    </span>
                  )}
                </div>
              )}

              {/* Row 4: 智能切换简介区（支持极简「本集简介 / 剧集简介」切换） */}
              {(activeOverviewText || canToggleOverview) && (
                <div className="max-w-3xl space-y-1">
                  {activeOverviewText && (
                    <p
                      className={`text-sm text-white/85 leading-relaxed whitespace-pre-line ${
                        overviewExpanded ? '' : 'line-clamp-3'
                      }`}
                    >
                      {activeOverviewText}
                    </p>
                  )}

                  <div className="flex items-center gap-3 text-xs">
                    {activeOverviewText.length > 130 && (
                      <button
                        type="button"
                        onClick={() => setOverviewExpanded((v) => !v)}
                        className="font-medium text-white/90 hover:text-white underline-offset-2 hover:underline transition cursor-pointer"
                      >
                        {overviewExpanded ? '收起' : '展开全部'}
                      </button>
                    )}

                    {canToggleOverview && (
                      <div className="inline-flex items-center gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setOverviewMode('episode');
                            setOverviewExpanded(false);
                          }}
                          className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                            effectiveOverviewMode === 'episode'
                              ? 'bg-white/[0.16] text-white font-medium'
                              : 'text-white/60 hover:text-white/90'
                          }`}
                        >
                          本集简介
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverviewMode('series');
                            setOverviewExpanded(false);
                          }}
                          className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                            effectiveOverviewMode === 'series'
                              ? 'bg-white/[0.16] text-white font-medium'
                              : 'text-white/60 hover:text-white/90'
                          }`}
                        >
                          剧集简介
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Row 5: 唯一主行动行（实心纯白主播放胶囊 + 同行紧凑多清晰度版本切换胶囊） */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!activePlayableItem) return;
                    startPlayback(activePlayableItem, selectedMediaSourceId);
                  }}
                  disabled={startingPlay || !activePlayableItem}
                  className="px-8 py-2.5 rounded-full bg-white hover:bg-white/90 text-[#1D1D1F] font-semibold text-sm shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition cursor-pointer inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{primaryPlayLabel}</span>
                </button>

                {sortedItemMediaSources.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span
                      className="inline-flex items-center gap-1 text-[11px] text-white/60 mr-0.5"
                      title="切换清晰度 / 封装版本"
                    >
                      <Layers className="w-3.5 h-3.5 text-white/75" />
                    </span>
                    {sortedItemMediaSources.map((ms, idx) => {
                      const isSelected =
                        ms.Id === (selectedMediaSourceId ?? sortedItemMediaSources[0]?.Id);
                      const meta = formatMediaSourceMeta(ms);
                      const compactLabel =
                        [meta.resolutionLabel, meta.hdrLabel, meta.sizeLabel]
                          .filter(Boolean)
                          .join(' · ') ||
                        ms.Name ||
                        `版本 ${idx + 1}`;
                      const tooltipText = [
                        ms.Name,
                        [meta.resolutionLabel, meta.hdrLabel, meta.containerLabel, meta.sizeLabel]
                          .filter(Boolean)
                          .join(' · '),
                      ]
                        .filter(Boolean)
                        .join('\n');

                      return (
                        <button
                          key={ms.Id}
                          type="button"
                          onClick={() => setSelectedMediaSourceId(ms.Id)}
                          title={tooltipText}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-mono transition cursor-pointer ${
                            isSelected
                              ? 'bg-white border-white text-[#1D1D1F] font-semibold shadow-sm'
                              : 'bg-white/[0.08] border-white/[0.15] text-white/85 hover:bg-white/[0.16] hover:text-white'
                          }`}
                        >
                          <span>{compactLabel}</span>
                          {idx === 0 && (
                            <span
                              className={`px-1.5 py-0.2 rounded-full text-[10px] font-sans font-bold leading-4 ${
                                isSelected
                                  ? 'bg-[#1D1D1F]/10 text-[#1D1D1F]'
                                  : 'bg-white/15 text-white'
                              }`}
                            >
                              最高
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        </section>
      </div>

      {/* 2. 剧集选集网格（紧贴 Hero 下方直接占据首屏） */}
      {hasSeriesContext && (
        <div className="w-full max-w-[1440px] mx-auto px-8 lg:px-12 mt-8">
          {episodesLoading ? (
            <div className="py-16 text-center text-xs text-slate-400">正在同步分集列表...</div>
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
              seasons={seasons}
              selectedSeasonId={selectedSeasonId}
              onSeasonChange={handleSeasonChange}
              onSelectEpisode={handleSelectEpisode}
              onPlayEpisode={(ep) => startPlayback(ep)}
            />
          )}
        </div>
      )}

      {/* 3. 演职员横滑轨道 & 相关推荐海报墙 */}
      {(heroPeople.length > 0 || similarItems.length > 0) && (
        <div className="relative z-10 w-full max-w-[1440px] mx-auto px-8 lg:px-12 mt-10 space-y-10">
          {heroPeople.length > 0 && currentServer && (
            <CastRail
              people={heroPeople}
              serverUrl={currentServer.url}
              onSelectPerson={(person) =>
                navigate(`/search?q=${encodeURIComponent(person.Name)}`)
              }
            />
          )}

          {similarItems.length > 0 && currentServer && (
            <div
              className={
                heroPeople.length > 0
                  ? 'pt-9 border-t border-black/[0.06] dark:border-white/[0.07]'
                  : ''
              }
            >
              <MediaRail title="相关推荐">
                {similarItems.map((sim) => (
                  <div
                    key={sim.Id}
                    className="w-[164px] sm:w-[178px] lg:w-[192px] flex-shrink-0"
                  >
                    <MediaCard
                      item={sim}
                      serverUrl={currentServer.url}
                      onClick={(clicked) => navigate(`/detail/${clicked.Id}`)}
                      aspectRatio="poster"
                    />
                  </div>
                ))}
              </MediaRail>
            </div>
          )}
        </div>
      )}

      {/* 4. Apple TV 风格「关于本片与媒体规格」底区 */}
      <div className="mt-auto">
        <DetailAboutSection
          item={item}
          seriesItem={seriesItem}
          activePlayableItem={activePlayableItem}
          activeMediaSource={activeMediaSource}
          mediaSourcesCount={sortedItemMediaSources.length}
          overviewText={seriesOverview || activeOverviewText}
        />
      </div>
    </div>
  );
};

export default DetailPage;
