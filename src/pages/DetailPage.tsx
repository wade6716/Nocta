import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { findCachedItemById, useMediaStore } from '../stores/useMediaStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  DetailPageSkeleton,
  EpisodeGridSkeleton,
} from '../components/common/Skeletons';
import {
  buildServerScopedKey,
  detailPageCache,
  DetailPageCacheData,
} from '../services/pageCache';
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

interface InitialDetailSnapshot {
  fromCache: boolean;
  item: EmbyItem | null;
  seriesItem: EmbyItem | null;
  seasons: EmbyItem[];
  selectedSeasonId: string | null;
  episodes: EmbyItem[];
  similarItems: EmbyItem[];
  loading: boolean;
  episodesLoading: boolean;
}

function resolveInitialDetailSnapshot(
  serverId: string | undefined,
  itemId: string | undefined,
  routePreview: EmbyItem | null,
  cachedPlayerItem: EmbyItem | null
): InitialDetailSnapshot {
  if (serverId && itemId) {
    const cacheHit = detailPageCache.get(buildServerScopedKey(serverId, itemId));
    if (cacheHit) {
      return {
        fromCache: true,
        item: cacheHit.data.item,
        seriesItem: cacheHit.data.seriesItem,
        seasons: cacheHit.data.seasons,
        selectedSeasonId: cacheHit.data.selectedSeasonId,
        episodes: cacheHit.data.episodes,
        similarItems: cacheHit.data.similarItems,
        loading: false,
        episodesLoading: false,
      };
    }
  }

  const preview =
    (routePreview?.Id === itemId ? routePreview : null) ||
    (cachedPlayerItem?.Id === itemId ? cachedPlayerItem : null) ||
    findCachedItemById(serverId, itemId);

  if (preview) {
    const hasSeries =
      preview.Type === 'Series' || (preview.Type === 'Episode' && !!preview.SeriesId);
    return {
      fromCache: false,
      item: preview,
      seriesItem: null,
      seasons: [],
      selectedSeasonId: null,
      episodes: [],
      similarItems: [],
      loading: false,
      episodesLoading: hasSeries,
    };
  }

  return {
    fromCache: false,
    item: null,
    seriesItem: null,
    seasons: [],
    selectedSeasonId: null,
    episodes: [],
    similarItems: [],
    loading: true,
    episodesLoading: false,
  };
}

export const DetailPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);
  const playbackDirtyRevision = useMediaStore((s) => s.playbackDirtyRevision);

  const cachedPlayerItem = usePlayerStore((s) => s.item);
  const routePreview = (location.state as { previewItem?: EmbyItem } | null)?.previewItem ?? null;

  const bootSnapRef = useRef<InitialDetailSnapshot | null>(null);
  if (!bootSnapRef.current) {
    bootSnapRef.current = resolveInitialDetailSnapshot(
      currentServer?.id,
      itemId,
      routePreview,
      cachedPlayerItem
    );
  }
  const bootSnap = bootSnapRef.current;

  const [item, setItem] = useState<EmbyItem | null>(bootSnap.item);
  const [seriesItem, setSeriesItem] = useState<EmbyItem | null>(bootSnap.seriesItem);
  const [backdropStage, setBackdropStage] = useState(0);
  const [loading, setLoading] = useState(bootSnap.loading);
  const [seasons, setSeasons] = useState<EmbyItem[]>(bootSnap.seasons);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(
    bootSnap.selectedSeasonId
  );
  const [episodes, setEpisodes] = useState<EmbyItem[]>(bootSnap.episodes);
  const [episodesLoading, setEpisodesLoading] = useState(bootSnap.episodesLoading);
  const [similarItems, setSimilarItems] = useState<EmbyItem[]>(bootSnap.similarItems);
  const [startingPlay, setStartingPlay] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [overviewMode, setOverviewMode] = useState<'episode' | 'series'>('episode');
  const [selectedEpisode, setSelectedEpisode] = useState<EmbyItem | null>(() =>
    bootSnap.item?.Type === 'Episode' ? bootSnap.item : null
  );
  const [loadingEpisodeDetail, setLoadingEpisodeDetail] = useState(false);
  const [selectedMediaSourceId, setSelectedMediaSourceId] = useState<string | undefined>(undefined);
  const loadReqIdRef = useRef(0);
  const episodeDetailReqIdRef = useRef(0);
  const prevVersionItemIdRef = useRef<string | undefined>(undefined);
  const prevRouteKeyRef = useRef<string | null>(null);
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
    if (!currentServer || !itemId) {
      navigate('/');
      return;
    }

    const routeKey = `${currentServer.id}::${itemId}`;
    const routeChanged = prevRouteKeyRef.current !== routeKey;
    prevRouteKeyRef.current = routeKey;

    if (routeChanged) {
      setOverviewExpanded(false);
      setOverviewMode('episode');
      setLoadingEpisodeDetail(false);
      setBackdropStage(0);

      const snap = resolveInitialDetailSnapshot(
        currentServer.id,
        itemId,
        routePreview,
        cachedPlayerItem
      );
      setItem(snap.item);
      setSeriesItem(snap.seriesItem);
      setSeasons(snap.seasons);
      setSelectedSeasonId(snap.selectedSeasonId);
      setEpisodes(snap.episodes);
      setSimilarItems(snap.similarItems);
      setLoading(snap.loading);
      setEpisodesLoading(snap.episodesLoading);
      setSelectedEpisode(snap.item?.Type === 'Episode' ? snap.item : null);

      loadItemDetail(snap.item, snap.fromCache);
    } else {
      // 仅 playbackDirtyRevision 变更（从播放页返回）：静默刷新最新进度，不闪烁骨架屏
      loadItemDetail(item, true);
    }

    return () => {
      loadReqIdRef.current += 1;
      episodeDetailReqIdRef.current += 1;
    };
  }, [itemId, currentServer?.id, playbackDirtyRevision]);

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

  const loadItemDetail = async (
    initialPreview: EmbyItem | null,
    isBackgroundRefresh: boolean
  ) => {
    if (!currentServer || !itemId) return;
    const reqId = ++loadReqIdRef.current;
    const isStale = () => reqId !== loadReqIdRef.current;
    const cacheKey = buildServerScopedKey(currentServer.id, itemId);
    const existingCache = detailPageCache.get(cacheKey)?.data;

    const cacheSnap: Partial<DetailPageCacheData> = existingCache
      ? { ...existingCache }
      : initialPreview
      ? { item: initialPreview }
      : {};

    const flushCache = () => {
      if (isStale() || !cacheSnap.item) return;
      detailPageCache.set(cacheKey, {
        item: cacheSnap.item,
        seriesItem: cacheSnap.seriesItem ?? null,
        seasons: cacheSnap.seasons ?? [],
        selectedSeasonId: cacheSnap.selectedSeasonId ?? null,
        episodes: cacheSnap.episodes ?? [],
        similarItems: cacheSnap.similarItems ?? [],
      });
    };

    if (!initialPreview && !isBackgroundRefresh) {
      setLoading(true);
    }

    const similarPromise = getSimilarItems(
      currentServer.url,
      currentServer.userId,
      itemId,
      currentServer.accessToken,
      14
    )
      .then((sim) => {
        if (!isStale()) {
          setSimilarItems(sim);
          cacheSnap.similarItems = sim;
          flushCache();
        }
        return sim;
      })
      .catch(() => [] as EmbyItem[]);

    let startedSeriesForId: string | null = null;
    const seasonHint = {
      seasonId: initialPreview?.SeasonId,
      seasonNumber: initialPreview?.ParentIndexNumber,
    };
    const seriesSyncState: {
      seasons: EmbyItem[] | null;
      pickedSeasonId: string | null;
    } = {
      seasons: null,
      pickedSeasonId: null,
    };

    const matchSeasonFromList = (
      seasonList: EmbyItem[],
      seasonIdHint?: string,
      seasonNumberHint?: number
    ): EmbyItem | undefined => {
      const effectiveSeasonId = seasonHint.seasonId || seasonIdHint;
      if (effectiveSeasonId) {
        const byId = seasonList.find((s) => s.Id === effectiveSeasonId);
        if (byId) return byId;
      }
      const effectiveSeasonNum = seasonHint.seasonNumber ?? seasonNumberHint;
      if (typeof effectiveSeasonNum === 'number') {
        const byNumber = seasonList.find((s) => s.IndexNumber === effectiveSeasonNum);
        if (byNumber) return byNumber;
      }
      return seasonList[0];
    };

    const runSeriesContext = async (
      targetSeriesId: string,
      isEpisode: boolean,
      seasonIdHint?: string,
      hasInitialEpisode?: boolean,
      seasonNumberHint?: number
    ) => {
      try {
        const [seasonsRes, parentSeries] = await Promise.all([
          getSeriesSeasons(
            currentServer.url,
            currentServer.userId,
            targetSeriesId,
            currentServer.accessToken
          ),
          isEpisode
            ? getItemDetail(
                currentServer.url,
                currentServer.userId,
                targetSeriesId,
                currentServer.accessToken
              ).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (isStale()) return;

        if (isEpisode) {
          setSeriesItem(parentSeries);
          cacheSnap.seriesItem = parentSeries;
        }

        const seasonList = seasonsRes.Items || [];
        setSeasons(seasonList);
        cacheSnap.seasons = seasonList;

        if (seasonList.length > 0) {
          seriesSyncState.seasons = seasonList;
          const matchSeason =
            matchSeasonFromList(seasonList, seasonIdHint, seasonNumberHint) || seasonList[0];
          seriesSyncState.pickedSeasonId = matchSeason.Id;
          setSelectedSeasonId(matchSeason.Id);
          cacheSnap.selectedSeasonId = matchSeason.Id;
          flushCache();
          loadEpisodes(
            targetSeriesId,
            matchSeason.Id,
            reqId,
            !hasInitialEpisode,
            isBackgroundRefresh,
            (eps) => {
              cacheSnap.episodes = eps;
              flushCache();
            }
          );
        } else {
          seriesSyncState.seasons = [];
          seriesSyncState.pickedSeasonId = null;
          setSelectedSeasonId(null);
          setEpisodes([]);
          setEpisodesLoading(false);
          cacheSnap.selectedSeasonId = null;
          cacheSnap.episodes = [];
          flushCache();
        }
      } catch (err) {
        if (!isStale()) {
          console.error('获取剧集季信息失败', err);
          setEpisodesLoading(false);
        }
      }
    };

    const previewSeriesId = initialPreview
      ? initialPreview.Type === 'Series'
        ? initialPreview.Id
        : initialPreview.SeriesId
      : undefined;

    if (previewSeriesId && !isBackgroundRefresh) {
      startedSeriesForId = previewSeriesId;
      void runSeriesContext(
        previewSeriesId,
        initialPreview?.Type === 'Episode',
        initialPreview?.SeasonId,
        initialPreview?.Type === 'Episode',
        initialPreview?.ParentIndexNumber
      );
    }

    try {
      const detail = await getItemDetail(
        currentServer.url,
        currentServer.userId,
        itemId,
        currentServer.accessToken
      );
      if (isStale()) return;

      setItem(detail);
      setLoading(false);
      setBackdropStage(0);
      cacheSnap.item = detail;

      const initialEp = detail.Type === 'Episode' ? detail : null;
      if (initialEp) {
        setSelectedEpisode((prev) => (prev && prev.Id !== initialEp.Id ? prev : initialEp));
      }
      flushCache();

      if (detail.SeasonId) seasonHint.seasonId = detail.SeasonId;
      if (detail.ParentIndexNumber !== undefined) {
        seasonHint.seasonNumber = detail.ParentIndexNumber;
      }

      const targetSeriesId = detail.Type === 'Series' ? detail.Id : detail.SeriesId;
      if (targetSeriesId) {
        if (startedSeriesForId !== targetSeriesId) {
          void runSeriesContext(
            targetSeriesId,
            detail.Type === 'Episode' && Boolean(detail.SeriesId),
            detail.SeasonId,
            Boolean(initialEp),
            detail.ParentIndexNumber
          );
        } else if (
          detail.Type === 'Episode' &&
          seriesSyncState.seasons &&
          seriesSyncState.seasons.length > 0
        ) {
          const resolvedSeason = matchSeasonFromList(
            seriesSyncState.seasons,
            detail.SeasonId,
            detail.ParentIndexNumber
          );
          if (resolvedSeason && resolvedSeason.Id !== seriesSyncState.pickedSeasonId) {
            seriesSyncState.pickedSeasonId = resolvedSeason.Id;
            setSelectedSeasonId(resolvedSeason.Id);
            cacheSnap.selectedSeasonId = resolvedSeason.Id;
            flushCache();
            loadEpisodes(
              targetSeriesId,
              resolvedSeason.Id,
              reqId,
              false,
              isBackgroundRefresh,
              (eps) => {
                cacheSnap.episodes = eps;
                flushCache();
              }
            );
          }
        }
        if (detail.Type === 'Episode' && detail.SeriesId) {
          const initialSimilar = await similarPromise;
          if (!isStale() && initialSimilar.length === 0) {
            const seriesSimilar = await getSimilarItems(
              currentServer.url,
              currentServer.userId,
              detail.SeriesId,
              currentServer.accessToken,
              14
            ).catch(() => [] as EmbyItem[]);
            if (!isStale() && seriesSimilar.length > 0) {
              setSimilarItems(seriesSimilar);
              cacheSnap.similarItems = seriesSimilar;
              flushCache();
            }
          }
        }
      } else {
        setSeriesItem(null);
        setSeasons([]);
        setSelectedSeasonId(null);
        setEpisodes([]);
        setEpisodesLoading(false);
        cacheSnap.seriesItem = null;
        cacheSnap.seasons = [];
        cacheSnap.selectedSeasonId = null;
        cacheSnap.episodes = [];
        flushCache();
      }
    } catch (err: any) {
      if (!isStale()) {
        console.error('获取条目详情失败', err);
        setLoading(false);
      }
    }
  };

  const loadEpisodes = async (
    seriesId: string,
    seasonId: string,
    reqId?: number,
    autoFocusDefault = false,
    silent = false,
    onLoaded?: (eps: EmbyItem[]) => void
  ) => {
    if (!currentServer) return;
    try {
      if (!silent) {
        setEpisodesLoading(true);
      }
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
      onLoaded?.(list);

      if (autoFocusDefault && list.length > 0) {
        const defaultEp = resolveDefaultEpisode(list);
        if (defaultEp) {
          setSelectedEpisode((prev) =>
            prev && list.some((e) => e.Id === prev.Id) ? prev : defaultEp
          );
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
    return <DetailPageSkeleton onBack={() => navigate(-1)} />;
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
            <EpisodeGridSkeleton count={8} />
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
                      onClick={(clicked) =>
                        navigate(`/detail/${clicked.Id}`, {
                          state: { previewItem: clicked },
                        })
                      }
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
