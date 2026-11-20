import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  X,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Play,
  Pause,
  Zap,
  Globe,
  Wifi,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { useDanmuStore } from '../stores/useDanmuStore';
import {
  EmbyChapter,
  EmbyItem,
  EmbyMediaSource,
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  ticksToSeconds,
  buildDirectStreamUrl,
  buildNativeDirectStreamUrl,
  getItemDetail,
  getSeriesSeasons,
  getSeriesEpisodes,
  getPlaybackInfo,
  mapStreamTracks,
  buildItemImageUrl,
  extractIntroRange,
} from '../api/embyClient';
import {
  IPlayerEngine,
  PlayerTelemetry,
  ResolvedStreamProxyInfo,
  StreamProxyOverride,
  VideoAspectPreset,
} from '../player/types';
import { PlayerEngineFactory } from '../player/PlayerEngineFactory';
import {
  autoMatchEpisode,
  fetchCommentsById,
  transformToDanmakuItems,
  computeDanmakuHeatmap,
  RawDanmuComment,
} from '../api/danmuClient';
import { isTauriEnvironment } from '../api/http';
import { MpvDanmakuBridge } from '../components/player/MpvDanmakuBridge';
import { DanmakuLayer } from '../components/player/DanmakuLayer';
import { PlayerOsd, formatTime } from '../components/player/PlayerOsd';
import { DanmakuDrawer } from '../components/player/DanmakuDrawer';
import { PlaybackInfoModal } from '../components/player/PlaybackInfoModal';
import { MiniActionHud, MiniHudState } from '../components/player/MiniActionHud';
import { PlayerContextMenu } from '../components/player/PlayerContextMenu';
import { ShortcutsModal } from '../components/player/ShortcutsModal';
import { EpisodeDrawer } from '../components/player/EpisodeDrawer';
import { VideoProPanel } from '../components/player/VideoProPanel';
import { NetworkProxyPopover } from '../components/player/NetworkProxyPopover';
import { UpNextOverlay } from '../components/player/UpNextOverlay';
import { NetworkProxyModal } from '../components/settings/NetworkProxyModal';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';

type ActivePanelType =
  | 'none'
  | 'danmaku'
  | 'videoPro'
  | 'episodes'
  | 'network'
  | 'info'
  | 'shortcuts';

export const PlayerPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const { getActiveServer } = useDanmuStore();
  const activeDanmuServer = getActiveServer();

  const {
    item,
    mediaSource,
    availableMediaSources,
    playSessionId,
    streamUrl,
    currentTime,
    initialTime,
    duration,
    paused,
    volume,
    playbackRate,
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubtitleId,
    selectedSecondarySubtitleId,
    danmakuSettings,
    itemOffsets,
    seriesOffsets,
    danmakuBindings,
    seriesDanmakuBindings,
    videoLayouts,
    playerPreferences,
    engineType,
    setEngineType,
    setPlaybackContext,
    updateTracks,
    updateTime,
    setPaused,
    setVolume,
    setPlaybackRate,
    selectAudioTrack,
    selectSubtitleTrack,
    selectSecondarySubtitleTrack,
    updateDanmakuSettings,
    setItemOffset,
    setVideoLayout,
    updatePlayerPreferences,
    resetPlayer,
  } = usePlayerStore();

  // Bridge ref for 120Hz interpolation
  const bridgeRef = useRef<MpvDanmakuBridge>(new MpvDanmakuBridge());
  const bridge = bridgeRef.current;

  // Video playback & telemetry status
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(streamUrl);
  const [reloadToken, setReloadToken] = useState(0);
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [networkSpeed, setNetworkSpeed] = useState<number>(0);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [telemetry, setTelemetry] = useState<PlayerTelemetry>({});
  const [proxyOverride, setProxyOverride] = useState<StreamProxyOverride>('follow');
  const [proxyInfo, setProxyInfo] = useState<ResolvedStreamProxyInfo | null>(null);
  const [abLoopA, setAbLoopA] = useState<number | null>(null);
  const [abLoopB, setAbLoopB] = useState<number | null>(null);

  // Chapters & Series Episodes state
  const [chapters, setChapters] = useState<EmbyChapter[]>(item?.Chapters || []);
  const [seasons, setSeasons] = useState<EmbyItem[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EmbyItem[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [cancelAutoNext, setCancelAutoNext] = useState(false);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);

  // Refs to prevent stale closures & accidental 0s progress wipe
  const hasInitialSeekedRef = useRef(false);
  const initialTimeRef = useRef<number>(initialTime);
  const lastValidTimeRef = useRef<number>(initialTime);
  const reportedStoppedSessionRef = useRef<string | null>(null);
  const autoSwitchedItemIdRef = useRef<string | null>(null);
  const appliedPrefTrackUrlRef = useRef<string | null>(null);
  const networkSpeedRef = useRef(0);
  const handleVideoErrorRef = useRef<(errMsg?: string) => void>(() => {});
  const proxyOverrideRef = useRef<StreamProxyOverride>('follow');

  useEffect(() => {
    initialTimeRef.current = initialTime;
    lastValidTimeRef.current = initialTime;
  }, [initialTime, itemId]);

  useEffect(() => {
    proxyOverrideRef.current = proxyOverride;
  }, [proxyOverride]);

  // Player Engine and Container refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<IPlayerEngine | null>(null);

  // Per-series or per-item video layout configuration
  const layoutKey = item?.SeriesId ? `series_${item.SeriesId}` : item ? `item_${item.Id}` : '';
  const currentLayout = (layoutKey && videoLayouts[layoutKey]) || {
    bottomAlign: false,
    verticalOffset: 100,
  };
  const videoAspectRatio = videoDimensions
    ? videoDimensions.width / videoDimensions.height
    : undefined;
  const isWidescreen = videoAspectRatio
    ? videoAspectRatio > window.innerWidth / window.innerHeight + 0.05
    : false;

  // Danmaku state
  const [rawComments, setRawComments] = useState<RawDanmuComment[]>([]);
  const [matchedTitle, setMatchedTitle] = useState<string>('');
  const [sourceDuration, setSourceDuration] = useState<number | undefined>();
  const [danmuToast, setDanmuToast] = useState<string | null>(null);
  const [durationAlert, setDurationAlert] = useState<string | null>(null);

  // 互斥面板 & 弹窗状态
  const [activePanel, setActivePanel] = useState<ActivePanelType>('none');
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  });

  // Mini HUD & Long-Press Fast Forward
  const [miniHud, setMiniHud] = useState<MiniHudState | null>(null);
  const [fastForwardRate, setFastForwardRate] = useState<number | null>(null);
  const miniHudIdRef = useRef(1);
  const miniHudTimerRef = useRef<number | null>(null);
  const seekAccumRef = useRef<{ delta: number; lastAt: number }>({ delta: 0, lastAt: 0 });
  const longPressTimerRef = useRef<number | null>(null);
  const longPressActiveRef = useRef(false);
  const preLongPressRateRef = useRef(1.0);

  // OSD and Window interaction
  const [isOsdVisible, setIsOsdVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [centerIcon, setCenterIcon] = useState<'play' | 'pause' | null>(null);
  const centerIconTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  // Current item offset (单集偏移优先，否则继承整剧偏移)
  const savedOffset =
    (itemId && itemOffsets[itemId] !== undefined
      ? itemOffsets[itemId]
      : item?.SeriesId
      ? seriesOffsets[item.SeriesId]
      : 0) || 0;

  const isAnyPanelOpen =
    activePanel !== 'none' || isProxyModalOpen || contextMenu.visible;

  const showMiniHud = useCallback(
    (payload: Omit<MiniHudState, 'id'>, durationMs = 1500) => {
      const id = ++miniHudIdRef.current;
      setMiniHud({ ...payload, id });
      if (miniHudTimerRef.current) {
        window.clearTimeout(miniHudTimerRef.current);
      }
      miniHudTimerRef.current = window.setTimeout(() => {
        setMiniHud(null);
      }, durationMs);
    },
    []
  );

  // Sync streamUrl when store changes
  useEffect(() => {
    if (streamUrl) {
      setCurrentStreamUrl(streamUrl);
      setIsLoadingVideo(true);
      setVideoError(null);
      setAbLoopA(null);
      setAbLoopB(null);
      setCancelAutoNext(false);
      setAutoNextCountdown(null);
      hasInitialSeekedRef.current = false;
      autoSwitchedItemIdRef.current = null;
      appliedPrefTrackUrlRef.current = null;
    }
  }, [streamUrl]);

  // 采样 30 秒实时下载速率历史曲线
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSpeedHistory((prev) => [...prev.slice(-29), networkSpeedRef.current]);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 应用持久化 Pro 偏好到底层播放引擎的辅助函数
  const applyAllPreferencesToEngine = useCallback((engine: IPlayerEngine | null) => {
    if (!engine) return;
    const state = usePlayerStore.getState();
    const prefs = state.playerPreferences;
    engine.setVolume(state.volume);
    engine.setHwdecMode?.(prefs.hwdecMode);
    engine.setVideoAspect?.(prefs.videoAspect);
    engine.setVideoEnhancement?.({
      toneMapping: prefs.toneMapping,
      deband: prefs.deband,
      brightness: prefs.colorAdjust.brightness,
      contrast: prefs.colorAdjust.contrast,
      saturation: prefs.colorAdjust.saturation,
      gamma: prefs.colorAdjust.gamma,
    });
    engine.setAudioEnhancement?.({
      audioDelay: prefs.audioDelay,
      nightMode: prefs.nightMode,
      volumeMax: 200,
    });
    engine.setSubtitleStyle?.({
      delay: prefs.subDelay,
      scale: prefs.subScale,
      pos: prefs.subPos,
    });
  }, []);

  // 0. Player Engine Lifecycle (MpvPlayerEngine / Html5PlayerEngine)
  useEffect(() => {
    let active = true;
    const engine = PlayerEngineFactory.create(engineType);
    engineRef.current = engine;

    engine
      .init(containerRef.current)
      .then(() => {
        if (!active) return;
        applyAllPreferencesToEngine(engine);
      })
      .catch((err) => {
        console.warn('[Engine Init Warning]', err);
      });

    const unlistenTime = engine.onTimeUpdate((cur, dur) => {
      if (!active) return;
      const targetInitSec = initialTimeRef.current;
      // 记忆进度起播防护：首跳未完成且当前仍处于起播 0 秒时拦截，防止 0 秒冲刷全局进度并保持加载层
      if (!hasInitialSeekedRef.current && targetInitSec > 0 && cur < 1) {
        return;
      }
      hasInitialSeekedRef.current = true;
      lastValidTimeRef.current = cur;
      setIsLoadingVideo(false);
      updateTime(cur, dur);
      bridge.onMpvTimePos(cur);
    });

    const unlistenState = engine.onStateChange((st) => {
      if (!active) return;
      switch (st) {
        case 'loading':
          setIsLoadingVideo(true);
          setVideoError(null);
          break;
        case 'playing':
          if (!hasInitialSeekedRef.current && initialTimeRef.current > 0) {
            setPaused(false);
            bridge.onMpvPauseChange(false);
            break;
          }
          setIsLoadingVideo(false);
          setPaused(false);
          bridge.onMpvPauseChange(false);
          break;
        case 'paused':
          if (!hasInitialSeekedRef.current && initialTimeRef.current > 0) {
            setPaused(true);
            bridge.onMpvPauseChange(true);
            break;
          }
          setIsLoadingVideo(false);
          setPaused(true);
          bridge.onMpvPauseChange(true);
          break;
        case 'buffering':
          setIsLoadingVideo(true);
          bridge.onMpvPauseChange(true);
          break;
        case 'ended':
          setIsLoadingVideo(false);
          setPaused(true);
          bridge.onMpvPauseChange(true);
          break;
      }
    });

    const unlistenError = engine.onError((errMsg) => {
      if (!active) return;
      console.warn('[Engine Playback Error]', errMsg);
      handleVideoErrorRef.current(errMsg);
    });

    const unlistenDim = engine.onVideoDimensions((width, height) => {
      if (!active) return;
      setVideoDimensions({ width, height });
    });

    const unlistenTracks = engine.onTracksLoaded((aTracks, sTracks) => {
      if (!active) return;
      updateTracks(aTracks, sTracks);

      // 根据用户上次选择的偏好语言自动匹配音轨与字幕（仅在每次新片源加载时应用一次）
      const streamKey = currentStreamUrl || '';
      if (appliedPrefTrackUrlRef.current !== streamKey) {
        appliedPrefTrackUrlRef.current = streamKey;
        const prefs = usePlayerStore.getState().playerPreferences;
        if (prefs.preferredAudioLang && aTracks.length > 0) {
          const matchAudio = aTracks.find(
            (t) => t.language?.toLowerCase() === prefs.preferredAudioLang?.toLowerCase()
          );
          if (matchAudio) {
            selectAudioTrack(matchAudio.id);
            engine.selectAudioTrack(String(matchAudio.mpvId));
          }
        }
        if (prefs.preferredSubLang && sTracks.length > 0) {
          const matchSub = sTracks.find(
            (t) => t.language?.toLowerCase() === prefs.preferredSubLang?.toLowerCase()
          );
          if (matchSub) {
            selectSubtitleTrack(matchSub.id);
            engine.selectSubtitleTrack(String(matchSub.mpvId));
          }
        }
      }
    });

    const unlistenSpeed = engine.onNetworkSpeed?.((spd) => {
      if (!active) return;
      networkSpeedRef.current = spd;
      setNetworkSpeed(spd);
    });

    const unlistenTelemetry = engine.onTelemetry?.((t) => {
      if (!active) return;
      setTelemetry(t);
    });

    const unlistenProxy = engine.onProxyResolved?.((info) => {
      if (!active) return;
      setProxyInfo(info);
    });

    return () => {
      active = false;
      unlistenTime();
      unlistenState();
      unlistenError();
      unlistenDim();
      unlistenTracks();
      unlistenSpeed?.();
      unlistenTelemetry?.();
      unlistenProxy?.();
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineType]);

  // Sync streamUrl / reloadToken into active engine
  useEffect(() => {
    if (currentStreamUrl && engineRef.current) {
      engineRef.current
        .load({
          url: currentStreamUrl,
          initialTime: initialTimeRef.current,
          title: item?.Name,
          proxyOverride: proxyOverrideRef.current,
        })
        .then(() => {
          applyAllPreferencesToEngine(engineRef.current);
        });
    }
  }, [currentStreamUrl, reloadToken]);

  // 响应 Pro 画质/字幕/音频偏好实时变化
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setHwdecMode?.(playerPreferences.hwdecMode);
  }, [playerPreferences.hwdecMode]);

  useEffect(() => {
    engineRef.current?.setVideoAspect?.(playerPreferences.videoAspect);
  }, [playerPreferences.videoAspect]);

  useEffect(() => {
    engineRef.current?.setVideoEnhancement?.({
      toneMapping: playerPreferences.toneMapping,
      deband: playerPreferences.deband,
      brightness: playerPreferences.colorAdjust.brightness,
      contrast: playerPreferences.colorAdjust.contrast,
      saturation: playerPreferences.colorAdjust.saturation,
      gamma: playerPreferences.colorAdjust.gamma,
    });
  }, [
    playerPreferences.toneMapping,
    playerPreferences.deband,
    playerPreferences.colorAdjust,
  ]);

  useEffect(() => {
    engineRef.current?.setAudioEnhancement?.({
      audioDelay: playerPreferences.audioDelay,
      nightMode: playerPreferences.nightMode,
      volumeMax: 200,
    });
  }, [playerPreferences.audioDelay, playerPreferences.nightMode]);

  useEffect(() => {
    engineRef.current?.setSubtitleStyle?.({
      delay: playerPreferences.subDelay,
      scale: playerPreferences.subScale,
      pos: playerPreferences.subPos,
    });
  }, [playerPreferences.subDelay, playerPreferences.subScale, playerPreferences.subPos]);

  // Sync widescreen bottom-alignment into active engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setVideoAlignment(
        currentLayout.verticalOffset,
        currentLayout.bottomAlign
      );
    }
  }, [currentLayout.bottomAlign, currentLayout.verticalOffset]);

  // Tauri 本地外挂字幕文件拖放加载
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          const subExts = /\.(srt|ass|ssa|vtt|sub|sup|idx)$/i;
          const subPath = event.payload.paths.find((p) => subExts.test(p));
          if (subPath && engineRef.current?.addExternalSubtitle) {
            try {
              await engineRef.current.addExternalSubtitle(subPath);
              const fileName = subPath.split(/[/\\]/).pop() || subPath;
              showMiniHud({
                icon: 'subtitle',
                label: '已加载本地外挂字幕',
                subLabel: fileName,
              });
            } catch (e: any) {
              showMiniHud({
                icon: 'info',
                label: '加载外挂字幕失败',
                subLabel: e?.message || '请确认使用 MPV 硬解内核',
                progressWarn: true,
              });
            }
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenFn = fn;
      })
      .catch(console.warn);

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [showMiniHud]);

  // Restore playback context if item was not loaded (e.g. page refresh)
  useEffect(() => {
    if (!item && currentServer && itemId) {
      (async () => {
        try {
          setIsLoadingVideo(true);
          const detail = await getItemDetail(
            currentServer.url,
            currentServer.userId,
            itemId,
            currentServer.accessToken
          );
          const pbInfo = await getPlaybackInfo(
            currentServer.url,
            currentServer.userId,
            detail.Id,
            currentServer.accessToken
          );
          const ms = pbInfo.MediaSources?.[0];
          if (!ms) throw new Error('未找到可用媒体源');

          const sUrl =
            engineType === 'mpv' && isTauriEnvironment()
              ? buildNativeDirectStreamUrl(
                  currentServer.url,
                  detail.Id,
                  ms,
                  pbInfo.PlaySessionId,
                  currentServer.accessToken
                )
              : buildDirectStreamUrl(
                  currentServer.url,
                  detail.Id,
                  ms,
                  pbInfo.PlaySessionId,
                  currentServer.accessToken
                );
          const { audioTracks: aTracks, subtitleTracks: sTracks } = mapStreamTracks(
            currentServer.url,
            detail.Id,
            ms,
            currentServer.accessToken
          );
          const initSec = ticksToSeconds(detail.UserData?.PlaybackPositionTicks || 0);

          setChapters(detail.Chapters || []);
          setPlaybackContext({
            item: detail,
            mediaSource: ms,
            availableMediaSources: pbInfo.MediaSources,
            playSessionId: pbInfo.PlaySessionId,
            streamUrl: sUrl,
            audioTracks: aTracks,
            subtitleTracks: sTracks,
            initialTime: initSec,
          });
        } catch (err: any) {
          setVideoError(err.message || '加载媒体失败');
          setIsLoadingVideo(false);
        }
      })();
    }
  }, [item, currentServer, itemId, engineType]);

  // 补充拉取 Emby Chapters（从首页继续观看直达时可能缺少 Chapters 与全部版本列表）
  useEffect(() => {
    if (!item || !currentServer) return;
    if (item.Chapters) {
      setChapters(item.Chapters);
      return;
    }
    let cancelled = false;
    getItemDetail(currentServer.url, currentServer.userId, item.Id, currentServer.accessToken)
      .then((detail) => {
        if (!cancelled && detail.Chapters) {
          setChapters(detail.Chapters);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item?.Id, currentServer?.id]);

  // 若当前是剧集，后台加载全部季与当前季分集，支持选集列表与自动连播下一集
  useEffect(() => {
    if (!item || !currentServer) {
      setSeasons([]);
      setEpisodes([]);
      return;
    }
    const targetSeriesId = item.Type === 'Series' ? item.Id : item.SeriesId;
    if (!targetSeriesId) {
      setSeasons([]);
      setEpisodes([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const seasonsRes = await getSeriesSeasons(
          currentServer.url,
          currentServer.userId,
          targetSeriesId,
          currentServer.accessToken
        );
        if (cancelled) return;
        const seasonList = seasonsRes.Items || [];
        setSeasons(seasonList);

        const matchSeason =
          seasonList.find((s) => s.Id === item.SeasonId) || seasonList[0];
        if (matchSeason) {
          setSelectedSeasonId(matchSeason.Id);
          setEpisodesLoading(true);
          const epRes = await getSeriesEpisodes(
            currentServer.url,
            currentServer.userId,
            targetSeriesId,
            matchSeason.Id,
            currentServer.accessToken
          );
          if (!cancelled) {
            setEpisodes(epRes.Items || []);
            setEpisodesLoading(false);
          }
        }
      } catch (e) {
        if (!cancelled) setEpisodesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item?.SeriesId, item?.SeasonId, currentServer?.id]);

  const handleSelectSeasonInDrawer = async (seasonId: string) => {
    setSelectedSeasonId(seasonId);
    const targetSeriesId = item?.Type === 'Series' ? item.Id : item?.SeriesId;
    if (!currentServer || !targetSeriesId) return;
    try {
      setEpisodesLoading(true);
      const epRes = await getSeriesEpisodes(
        currentServer.url,
        currentServer.userId,
        targetSeriesId,
        seasonId,
        currentServer.accessToken
      );
      setEpisodes(epRes.Items || []);
    } catch (e) {
      console.warn(e);
    } finally {
      setEpisodesLoading(false);
    }
  };

  // 计算上一集 / 下一集
  const currentEpisodeIndex = useMemo(() => {
    if (!item || episodes.length === 0) return -1;
    return episodes.findIndex((e) => e.Id === item.Id);
  }, [item?.Id, episodes]);

  const prevEpisode =
    currentEpisodeIndex > 0 ? episodes[currentEpisodeIndex - 1] : null;
  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex + 1 < episodes.length
      ? episodes[currentEpisodeIndex + 1]
      : null;

  // 1. Danmaku bridge offset lifecycle
  useEffect(() => {
    bridge.offset = savedOffset;
    return () => {
      bridge.reset();
    };
  }, [savedOffset]);

  // 2. 精确拆分 useMemo 依赖，彻底消除调节透明度/速度/行数/区域/显示开关时的 Canvas 重建闪烁 Bug！
  const formattedComments = useMemo(() => {
    if (rawComments.length === 0) return [];
    return transformToDanmakuItems(rawComments, {
      fontSize: danmakuSettings.fontSize,
      fontWeight: danmakuSettings.fontWeight,
      strokeWidth: danmakuSettings.strokeWidth,
      colorMode: danmakuSettings.colorMode,
      blockScroll: danmakuSettings.blockScroll,
      blockTop: danmakuSettings.blockTop,
      blockBottom: danmakuSettings.blockBottom,
      blockColor: danmakuSettings.blockColor,
      blockedWords: danmakuSettings.blockedWords,
      mergeDuplicates: danmakuSettings.mergeDuplicates,
    });
  }, [
    rawComments,
    danmakuSettings.fontSize,
    danmakuSettings.fontWeight,
    danmakuSettings.strokeWidth,
    danmakuSettings.colorMode,
    danmakuSettings.blockScroll,
    danmakuSettings.blockTop,
    danmakuSettings.blockBottom,
    danmakuSettings.blockColor,
    danmakuSettings.blockedWords,
    danmakuSettings.mergeDuplicates,
  ]);

  const effectiveDuration = duration || ticksToSeconds(item?.RunTimeTicks || 0);

  // 计算进度条高能弹幕密度曲线
  const danmakuHeatmap = useMemo(() => {
    if (!danmakuSettings.showHeatmap || rawComments.length === 0 || effectiveDuration <= 0) {
      return [];
    }
    return computeDanmakuHeatmap(rawComments, effectiveDuration, 100);
  }, [rawComments, effectiveDuration, danmakuSettings.showHeatmap]);

  // 3. Load danmaku: 单集手动绑定 -> 同剧集延续绑定 -> 智能自动匹配
  const triggerDanmakuLoad = useCallback(
    async (forceAuto = false) => {
      if (!item) return;

      const currentBinding = itemId && !forceAuto ? danmakuBindings[itemId] : undefined;

      if (currentBinding) {
        setMatchedTitle(`《${currentBinding.animeTitle}》${currentBinding.episodeTitle}`);
        setSourceDuration(currentBinding.sourceDuration);
        try {
          const res = await fetchCommentsById(activeDanmuServer, currentBinding.episodeId);
          setRawComments(res.comments || []);
          if (res.videoDuration) setSourceDuration(res.videoDuration);
          setDanmuToast(
            `已加载绑定弹幕: 《${currentBinding.animeTitle}》${currentBinding.episodeTitle} (${res.comments?.length || 0}条)`
          );
          setTimeout(() => setDanmuToast(null), 3500);

          const embyDurationSec = ticksToSeconds(item.RunTimeTicks || 0);
          const dur = res.videoDuration || currentBinding.sourceDuration;
          if (dur && embyDurationSec > 0) {
            const diff = Math.round(Math.abs(dur - embyDurationSec));
            if (diff > 15) {
              setDurationAlert(`片源与弹幕源时长相差 ${diff} 秒，可在弹幕抽屉「校准」中一键对齐。`);
            } else {
              setDurationAlert(null);
            }
          }
          return;
        } catch (err) {
          console.warn('加载绑定弹幕失败，尝试同剧/自动匹配', err);
        }
      }

      // 优先检查同剧集番剧绑定延续（无需每集手动重复搜番）
      const seriesBinding =
        !forceAuto && item.SeriesId ? seriesDanmakuBindings[item.SeriesId] : undefined;
      if (seriesBinding && seriesBinding.episodes?.length > 0 && item.IndexNumber !== undefined) {
        const epNum = item.IndexNumber;
        const matchedEp =
          seriesBinding.episodes.find((ep) => {
            const m = ep.episodeTitle.match(/(\d+)/);
            return m && Number(m[1]) === epNum;
          }) || seriesBinding.episodes[epNum - 1];

        if (matchedEp) {
          try {
            const res = await fetchCommentsById(activeDanmuServer, matchedEp.episodeId);
            setMatchedTitle(`《${seriesBinding.animeTitle}》${matchedEp.episodeTitle}`);
            setSourceDuration(res.videoDuration);
            setRawComments(res.comments || []);
            if (res.comments && res.comments.length > 0) {
              setDanmuToast(
                `同剧延续弹幕: 《${seriesBinding.animeTitle}》${matchedEp.episodeTitle} (${res.comments.length}条)`
              );
              setTimeout(() => setDanmuToast(null), 3500);
            }
            return;
          } catch (err) {
            console.warn('同剧延续弹幕失败，回退自动匹配', err);
          }
        }
      }

      // 智能自动匹配
      try {
        const match = await autoMatchEpisode(activeDanmuServer, {
          seriesName: item.SeriesName,
          seasonNumber: item.ParentIndexNumber,
          episodeNumber: item.IndexNumber,
          fileName: item.Name,
        });

        if (!match) {
          setMatchedTitle('');
          setRawComments([]);
          return;
        }

        const titleText =
          `${match.animeTitle || ''} ${match.episodeTitle || ''}`.trim() || `ID: ${match.episodeId}`;
        setMatchedTitle(titleText);

        const res = await fetchCommentsById(activeDanmuServer, match.episodeId);
        setRawComments(res.comments || []);
        setSourceDuration(res.videoDuration);

        if (res.comments && res.comments.length > 0) {
          setDanmuToast(
            `已自动匹配弹幕: ${match.animeTitle ? `《${match.animeTitle}》` : ''} (${res.comments.length}条)`
          );
          setTimeout(() => setDanmuToast(null), 3500);
        }

        const embyDurationSec = ticksToSeconds(item.RunTimeTicks || 0);
        if (res.videoDuration && embyDurationSec > 0) {
          const diff = Math.round(Math.abs(res.videoDuration - embyDurationSec));
          if (diff > 15) {
            setDurationAlert(`片源与弹幕源时长相差 ${diff} 秒，可在弹幕抽屉「校准」中一键对齐。`);
          } else {
            setDurationAlert(null);
          }
        }
      } catch (err) {
        console.warn('弹幕自动匹配失败', err);
      }
    },
    [item?.Id, itemId, danmakuBindings, seriesDanmakuBindings, activeDanmuServer]
  );

  useEffect(() => {
    triggerDanmakuLoad();
  }, [triggerDanmakuLoad]);

  // 4. Emby Playback reporting lifecycle
  useEffect(() => {
    if (!currentServer || !item || !mediaSource || !playSessionId) return;

    const sessionKey = `${item.Id}_${playSessionId}`;
    const startSec = initialTime > 0 ? initialTime : lastValidTimeRef.current;

    reportPlaybackStart(
      currentServer.url,
      {
        itemId: item.Id,
        mediaSourceId: mediaSource.Id,
        playSessionId,
        seconds: startSec,
      },
      currentServer.accessToken
    ).catch(console.error);

    const interval = window.setInterval(() => {
      const liveSeconds =
        lastValidTimeRef.current ??
        engineRef.current?.currentTime ??
        usePlayerStore.getState().currentTime;
      reportPlaybackProgress(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: liveSeconds,
          isPaused: usePlayerStore.getState().paused,
          eventName: 'TimeUpdate',
        },
        currentServer.accessToken
      ).catch(console.error);
    }, 10000);

    return () => {
      clearInterval(interval);
      if (reportedStoppedSessionRef.current === sessionKey) {
        return;
      }
      reportedStoppedSessionRef.current = sessionKey;
      const stopSeconds =
        lastValidTimeRef.current ??
        engineRef.current?.currentTime ??
        usePlayerStore.getState().currentTime;
      reportPlaybackStopped(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: stopSeconds,
        },
        currentServer.accessToken
      ).catch(console.error);
    };
  }, [currentServer?.id, item?.Id, playSessionId, initialTime]);

  // 原地无缝切换到其它分集（不销毁底层 mpv 实例）
  const switchToEpisode = useCallback(
    async (targetEp: EmbyItem) => {
      if (!currentServer || !targetEp) return;
      try {
        setIsLoadingVideo(true);
        setVideoError(null);
        setActivePanel('none');
        setAutoNextCountdown(null);

        // 先使用准确现场进度上报上一集停止
        if (item && mediaSource && playSessionId) {
          const sessionKey = `${item.Id}_${playSessionId}`;
          reportedStoppedSessionRef.current = sessionKey;
          await reportPlaybackStopped(
            currentServer.url,
            {
              itemId: item.Id,
              mediaSourceId: mediaSource.Id,
              playSessionId,
              seconds: lastValidTimeRef.current || currentTime,
            },
            currentServer.accessToken
          ).catch(() => {});
        }

        const [detail, pbInfo] = await Promise.all([
          getItemDetail(
            currentServer.url,
            currentServer.userId,
            targetEp.Id,
            currentServer.accessToken
          ),
          getPlaybackInfo(
            currentServer.url,
            currentServer.userId,
            targetEp.Id,
            currentServer.accessToken
          ),
        ]);

        const ms = pbInfo.MediaSources?.[0];
        if (!ms) throw new Error('未检测到可用媒体源');

        const sUrl =
          engineType === 'mpv' && isTauriEnvironment()
            ? buildNativeDirectStreamUrl(
                currentServer.url,
                detail.Id,
                ms,
                pbInfo.PlaySessionId,
                currentServer.accessToken
              )
            : buildDirectStreamUrl(
                currentServer.url,
                detail.Id,
                ms,
                pbInfo.PlaySessionId,
                currentServer.accessToken
              );

        const { audioTracks: aTracks, subtitleTracks: sTracks } = mapStreamTracks(
          currentServer.url,
          detail.Id,
          ms,
          currentServer.accessToken
        );
        const initSec = ticksToSeconds(detail.UserData?.PlaybackPositionTicks || 0);

        setChapters(detail.Chapters || []);
        setPlaybackContext({
          item: detail,
          mediaSource: ms,
          availableMediaSources: pbInfo.MediaSources,
          playSessionId: pbInfo.PlaySessionId,
          streamUrl: sUrl,
          audioTracks: aTracks,
          subtitleTracks: sTracks,
          initialTime: initSec,
        });
        navigate(`/player/${detail.Id}`, { replace: true });
      } catch (err: any) {
        setVideoError(err?.message || '切换剧集失败');
        setIsLoadingVideo(false);
      }
    },
    [currentServer, item, mediaSource, playSessionId, currentTime, engineType, navigate, setPlaybackContext]
  );

  // 原地切换多版本片源 (4K / 1080p 原画直连热切，保留播放进度)
  const switchMediaSource = useCallback(
    (ms: EmbyMediaSource) => {
      if (!currentServer || !item || !playSessionId) return;
      const liveSec = lastValidTimeRef.current || engineRef.current?.currentTime || currentTime;
      const sUrl =
        engineType === 'mpv' && isTauriEnvironment()
          ? buildNativeDirectStreamUrl(
              currentServer.url,
              item.Id,
              ms,
              playSessionId,
              currentServer.accessToken
            )
          : buildDirectStreamUrl(
              currentServer.url,
              item.Id,
              ms,
              playSessionId,
              currentServer.accessToken
            );
      const { audioTracks: aTracks, subtitleTracks: sTracks } = mapStreamTracks(
        currentServer.url,
        item.Id,
        ms,
        currentServer.accessToken
      );

      initialTimeRef.current = liveSec;
      hasInitialSeekedRef.current = liveSec <= 0;
      setIsLoadingVideo(true);
      setVideoError(null);
      setPlaybackContext({
        item,
        mediaSource: ms,
        availableMediaSources,
        playSessionId,
        streamUrl: sUrl,
        audioTracks: aTracks,
        subtitleTracks: sTracks,
        initialTime: liveSec,
      });
      setReloadToken((t) => t + 1);
      showMiniHud({
        icon: 'info',
        label: '正在切换原画版本',
        subLabel: ms.Name || ms.Container?.toUpperCase(),
      });
    },
    [currentServer, item, playSessionId, availableMediaSources, currentTime, engineType, setPlaybackContext, showMiniHud]
  );

  // 自动连播下一集监听（距片尾 <= 15s 出现提示并在倒计时结束切换）
  useEffect(() => {
    if (
      !nextEpisode ||
      !playerPreferences.autoPlayNext ||
      cancelAutoNext ||
      isLoadingVideo ||
      videoError ||
      effectiveDuration <= 60
    ) {
      setAutoNextCountdown(null);
      return;
    }

    const remaining = effectiveDuration - currentTime;
    if (remaining <= 15 && currentTime > 10) {
      const secs = Math.max(0, Math.ceil(remaining));
      setAutoNextCountdown(secs);
      if (secs === 0 && autoSwitchedItemIdRef.current !== nextEpisode.Id) {
        autoSwitchedItemIdRef.current = nextEpisode.Id;
        switchToEpisode(nextEpisode);
      }
    } else if (autoNextCountdown !== null) {
      setAutoNextCountdown(null);
    }
  }, [
    nextEpisode?.Id,
    playerPreferences.autoPlayNext,
    cancelAutoNext,
    isLoadingVideo,
    videoError,
    effectiveDuration,
    currentTime,
    switchToEpisode,
  ]);

  // 检测 Emby 片头区间（显示跳过片头胶囊）
  const introRange = useMemo(
    () => extractIntroRange(chapters, effectiveDuration),
    [chapters, effectiveDuration]
  );
  const showSkipIntro =
    !!introRange &&
    !isLoadingVideo &&
    !videoError &&
    currentTime >= introRange.start &&
    currentTime < introRange.end - 3;

  // 5. Mouse inactivity auto-hide OSD
  const resetHideTimer = useCallback(() => {
    setIsOsdVisible(true);
    document.body.style.cursor = 'default';

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }

    if (!isAnyPanelOpen && !paused && !isLoadingVideo && !videoError) {
      hideTimerRef.current = window.setTimeout(() => {
        setIsOsdVisible(false);
        document.body.style.cursor = 'none';
      }, 3500);
    }
  }, [isAnyPanelOpen, paused, isLoadingVideo, videoError]);

  useEffect(() => {
    const handleMouseMove = () => resetHideTimer();
    window.addEventListener('mousemove', handleMouseMove);
    resetHideTimer();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      document.body.style.cursor = 'default';
    };
  }, [resetHideTimer]);

  // Sync window fullscreen, maximized & alwaysOnTop states
  useEffect(() => {
    if (!isTauriEnvironment()) {
      const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', handleFs);
      return () => document.removeEventListener('fullscreenchange', handleFs);
    }

    try {
      const win = getCurrentWindow();
      win.isFullscreen().then(setIsFullscreen);
      win.isMaximized().then(setIsMaximized);
      win.isAlwaysOnTop?.().then(setIsPinned).catch(() => {});

      const unlistenPromise = win.onResized(async () => {
        try {
          const [fs, max] = await Promise.all([win.isFullscreen(), win.isMaximized()]);
          setIsFullscreen(fs);
          setIsMaximized(max);
        } catch (e) {
          console.warn(e);
        }
      });

      return () => {
        unlistenPromise.then((unlisten) => unlisten());
      };
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const triggerCenterIcon = (type: 'play' | 'pause') => {
    setCenterIcon(type);
    if (centerIconTimerRef.current) clearTimeout(centerIconTimerRef.current);
    centerIconTimerRef.current = window.setTimeout(() => {
      setCenterIcon(null);
    }, 600);
  };

  // 6. Playback controls
  const handleTogglePlay = (fromKeyboard = false) => {
    if (isLoadingVideo || videoError) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    bridge.onMpvPauseChange(nextPaused);

    if (engineRef.current) {
      nextPaused ? engineRef.current.pause() : engineRef.current.play();
    }
    triggerCenterIcon(nextPaused ? 'pause' : 'play');
    if (!fromKeyboard) {
      resetHideTimer();
    }

    if (currentServer && item && mediaSource && playSessionId) {
      reportPlaybackProgress(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: lastValidTimeRef.current || currentTime,
          isPaused: nextPaused,
          eventName: nextPaused ? 'Pause' : 'Unpause',
        },
        currentServer.accessToken
      ).catch(console.error);
    }
  };

  const handleSeek = (targetSeconds: number) => {
    const clamped = Math.max(0, effectiveDuration > 0 ? Math.min(effectiveDuration, targetSeconds) : targetSeconds);
    lastValidTimeRef.current = clamped;
    updateTime(clamped);
    bridge.onMpvTimePos(clamped);

    if (engineRef.current) {
      engineRef.current.seek(clamped);
    }

    if (currentServer && item && mediaSource && playSessionId) {
      reportPlaybackProgress(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: clamped,
          isPaused: paused,
          eventName: 'Seek',
        },
        currentServer.accessToken
      ).catch(console.error);
    }
  };

  // 轻量无打扰 Seek（显示 Mini HUD 而不弹出整套大控制栏）
  const handleSeekDelta = useCallback(
    (delta: number) => {
      const target = Math.max(
        0,
        effectiveDuration > 0 ? Math.min(effectiveDuration, currentTime + delta) : currentTime + delta
      );
      handleSeek(target);

      const now = Date.now();
      if (
        now - seekAccumRef.current.lastAt < 800 &&
        Math.sign(seekAccumRef.current.delta) === Math.sign(delta)
      ) {
        seekAccumRef.current.delta += delta;
      } else {
        seekAccumRef.current.delta = delta;
      }
      seekAccumRef.current.lastAt = now;

      const totalDelta = seekAccumRef.current.delta;
      showMiniHud({
        icon: totalDelta >= 0 ? 'seek-forward' : 'seek-backward',
        label: `${totalDelta >= 0 ? `+${totalDelta}s` : `${totalDelta}s`}`,
        subLabel: `${formatTime(target)} / ${formatTime(effectiveDuration)}`,
      });
    },
    [currentTime, effectiveDuration, showMiniHud]
  );

  const handleVolumeChange = useCallback(
    (vol: number, withHud = false) => {
      const maxVol = engineType === 'mpv' ? 200 : 100;
      const clamped = Math.max(0, Math.min(maxVol, Math.round(vol)));
      setVolume(clamped);
      engineRef.current?.setVolume(clamped);

      if (withHud) {
        showMiniHud({
          icon: clamped === 0 ? 'mute' : 'volume',
          label: clamped === 0 ? '已静音' : `音量 ${clamped}%`,
          progress: (clamped / maxVol) * 100,
          progressWarn: clamped > 100,
        });
      }
    },
    [engineType, setVolume, showMiniHud]
  );

  const handleRateChange = useCallback(
    (rate: number, withHud = false) => {
      const clamped = Math.max(0.5, Math.min(3.0, Math.round(rate * 100) / 100));
      setPlaybackRate(clamped);
      bridge.onMpvSpeedChange(clamped);
      engineRef.current?.setPlaybackRate(clamped);
      if (withHud) {
        showMiniHud({
          icon: 'speed',
          label: `播放倍速 ${clamped}x`,
        });
      }
    },
    [bridge, setPlaybackRate, showMiniHud]
  );

  const handleSelectAudioTrack = (trackId: string | null) => {
    selectAudioTrack(trackId);
    if (trackId && engineRef.current) {
      const track = audioTracks.find((t) => t.id === trackId);
      if (track?.language) {
        updatePlayerPreferences({ preferredAudioLang: track.language });
      }
      const engineTrackId =
        engineType === 'mpv' && track?.mpvId !== undefined ? String(track.mpvId) : trackId;
      engineRef.current.selectAudioTrack(engineTrackId);
    }
  };

  const handleSelectSubtitleTrack = (trackId: string | null) => {
    selectSubtitleTrack(trackId);
    if (engineRef.current) {
      if (!trackId) {
        engineRef.current.selectSubtitleTrack(null);
        return;
      }
      const track = subtitleTracks.find((t) => t.id === trackId);
      if (track?.language) {
        updatePlayerPreferences({ preferredSubLang: track.language });
      }
      const engineTrackId =
        engineType === 'mpv' && track?.mpvId !== undefined ? String(track.mpvId) : trackId;
      engineRef.current.selectSubtitleTrack(engineTrackId);
    }
  };

  const handleSelectSecondarySubtitleTrack = (trackId: string | null) => {
    selectSecondarySubtitleTrack(trackId);
    if (!engineRef.current?.selectSecondarySubtitleTrack) return;
    if (!trackId) {
      engineRef.current.selectSecondarySubtitleTrack(null);
      return;
    }
    const track = subtitleTracks.find((t) => t.id === trackId);
    const engineTrackId = track?.mpvId !== undefined ? String(track.mpvId) : trackId;
    engineRef.current.selectSecondarySubtitleTrack(engineTrackId);
  };

  const handleTogglePin = async () => {
    if (!isTauriEnvironment()) return;
    try {
      const win = getCurrentWindow();
      const next = !isPinned;
      await win.setAlwaysOnTop(next);
      setIsPinned(next);
      showMiniHud({
        icon: 'pin',
        label: next ? '窗口已置顶' : '已取消窗口置顶',
      });
    } catch (e) {
      console.warn(e);
    }
  };

  const handleTakeScreenshot = async () => {
    if (engineType !== 'mpv' || !engineRef.current?.takeScreenshot) {
      showMiniHud({
        icon: 'screenshot',
        label: '仅 MPV 硬解内核支持无损截图',
        progressWarn: true,
      });
      return;
    }
    try {
      const dir = isTauriEnvironment() ? await invoke<string>('get_screenshot_dir') : '';
      await engineRef.current.takeScreenshot(dir, 'subtitles');
      showMiniHud(
        {
          icon: 'screenshot',
          label: '无损 PNG 截图已保存',
          subLabel: dir || undefined,
          actionLabel: dir ? '打开目录' : undefined,
          onAction: dir ? () => invoke('show_in_file_manager', { path: dir }).catch(() => {}) : undefined,
        },
        3500
      );
    } catch (e: any) {
      showMiniHud({
        icon: 'screenshot',
        label: '截图失败',
        subLabel: e?.message,
        progressWarn: true,
      });
    }
  };

  const handleSetAbLoop = async (point: 'a' | 'b' | 'clear') => {
    const live = lastValidTimeRef.current || currentTime;
    if (point === 'a') {
      setAbLoopA(live);
      await engineRef.current?.setAbLoop?.('a', live);
      showMiniHud({ icon: 'loop', label: `已设 A 点: ${formatTime(live)}` });
    } else if (point === 'b') {
      setAbLoopB(live);
      await engineRef.current?.setAbLoop?.('b', live);
      showMiniHud({ icon: 'loop', label: `A-B 片段循环开始 (${formatTime(abLoopA || 0)} → ${formatTime(live)})` });
    } else {
      setAbLoopA(null);
      setAbLoopB(null);
      await engineRef.current?.setAbLoop?.('clear');
      showMiniHud({ icon: 'loop', label: '已清除 A-B 循环' });
    }
  };

  const handleSkipIntro = () => {
    if (introRange) {
      handleSeek(introRange.end);
      showMiniHud({
        icon: 'seek-forward',
        label: '已跳过片头至正片',
        subLabel: formatTime(introRange.end),
      });
    } else {
      handleSeekDelta(playerPreferences.skipIntroSeconds);
    }
  };

  // 原地热切流代理路由并保留精确当前进度
  const handleHotReloadStreamWithProxy = useCallback(
    (nextOverride: StreamProxyOverride) => {
      setProxyOverride(nextOverride);
      proxyOverrideRef.current = nextOverride;
      if (!currentStreamUrl || !engineRef.current) return;

      const liveSec = lastValidTimeRef.current || engineRef.current.currentTime || currentTime;
      initialTimeRef.current = liveSec;
      hasInitialSeekedRef.current = liveSec <= 0;
      setIsLoadingVideo(true);
      setVideoError(null);
      setReloadToken((t) => t + 1);
      showMiniHud({
        icon: 'info',
        label:
          nextOverride === 'direct'
            ? '正在切换直连模式重连...'
            : nextOverride === 'proxy'
            ? '正在切换代理通道重连...'
            : '正按全局代理配置重连...',
      });
    },
    [currentStreamUrl, currentTime, showMiniHud]
  );

  const handleToggleFullscreen = async () => {
    if (isTauriEnvironment()) {
      try {
        const win = getCurrentWindow();
        const cur = await win.isFullscreen();
        await win.setFullscreen(!cur);
        setIsFullscreen(!cur);
        if (cur) {
          const max = await win.isMaximized();
          setIsMaximized(max);
        }
      } catch (e) {
        console.warn(e);
      }
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const handleToggleWindowMode = async () => {
    if (isTauriEnvironment()) {
      try {
        const win = getCurrentWindow();
        const full = await win.isFullscreen();
        if (full) {
          await win.setFullscreen(false);
          setIsFullscreen(false);
          const max = await win.isMaximized();
          setIsMaximized(max);
        } else {
          await win.toggleMaximize();
          const max = await win.isMaximized();
          setIsMaximized(max);
        }
      } catch (e) {
        console.warn(e);
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleVideoClick = () => {
    if (contextMenu.visible) {
      setContextMenu((prev) => ({ ...prev, visible: false }));
      return;
    }
    if (activePanel !== 'none') {
      setActivePanel('none');
      return;
    }
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    } else {
      clickTimerRef.current = window.setTimeout(() => {
        handleTogglePlay();
        clickTimerRef.current = null;
      }, 240);
    }
  };

  const handleVideoDoubleClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activePanel !== 'none') {
      setActivePanel('none');
      return;
    }
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    handleToggleFullscreen();
  };

  const handleVideoWheel = (e: React.WheelEvent) => {
    if (isAnyPanelOpen || isLoadingVideo || videoError) return;
    if (Math.abs(e.deltaY) < 2) return;
    const up = e.deltaY < 0;
    if (e.shiftKey) {
      handleSeekDelta(up ? 5 : -5);
    } else {
      handleVolumeChange(volume + (up ? 5 : -5), true);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleBack = () => {
    resetPlayer();
    if (item) {
      navigate(`/detail/${item.Id}`, { replace: true });
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
  };

  const handleHome = () => {
    resetPlayer();
    navigate('/', { replace: true });
  };

  // 7. Global Keyboard Shortcuts（支持无打扰 Mini HUD 与长按 → 临时 2.5x 倍速）
  useEffect(() => {
    const rateSteps = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      // 优先允许 ? 呼出/关闭快捷键清单
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        e.preventDefault();
        setActivePanel((prev) => (prev === 'shortcuts' ? 'none' : 'shortcuts'));
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handleTogglePlay(true);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeekDelta(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.repeat) break;
          if (!longPressActiveRef.current && !longPressTimerRef.current) {
            preLongPressRateRef.current = playbackRate;
            longPressTimerRef.current = window.setTimeout(() => {
              longPressTimerRef.current = null;
              longPressActiveRef.current = true;
              const targetRate = playerPreferences.longPressSpeed;
              setFastForwardRate(targetRate);
              handleRateChange(targetRate, false);
            }, 280);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(volume + 5, true);
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(volume - 5, true);
          break;
        case 'KeyM':
          e.preventDefault();
          handleVolumeChange(volume > 0 ? 0 : 100, true);
          break;
        case 'BracketLeft': {
          e.preventDefault();
          const idx = rateSteps.findIndex((r) => r >= playbackRate);
          const next = rateSteps[Math.max(0, (idx === -1 ? rateSteps.length : idx) - 1)];
          handleRateChange(next, true);
          break;
        }
        case 'BracketRight': {
          e.preventDefault();
          const idx = rateSteps.findIndex((r) => r > playbackRate);
          const next = idx === -1 ? rateSteps[rateSteps.length - 1] : rateSteps[idx];
          handleRateChange(next, true);
          break;
        }
        case 'Backslash':
          e.preventDefault();
          handleRateChange(1.0, true);
          break;
        case 'Period':
          if (!isLoadingVideo && engineType === 'mpv') {
            e.preventDefault();
            engineRef.current?.frameStep?.('forward');
            showMiniHud({ icon: 'seek-forward', label: '下一帧' });
          }
          break;
        case 'Comma':
          if (!isLoadingVideo && engineType === 'mpv') {
            e.preventDefault();
            engineRef.current?.frameStep?.('backward');
            showMiniHud({ icon: 'seek-backward', label: '上一帧' });
          }
          break;
        case 'KeyD': {
          e.preventDefault();
          const nextVis = !danmakuSettings.visible;
          updateDanmakuSettings({ visible: nextVis });
          showMiniHud({
            icon: 'danmaku',
            label: nextVis ? '弹幕已开启' : '弹幕已关闭',
          });
          break;
        }
        case 'KeyG':
        case 'KeyH': {
          if (!itemId) break;
          e.preventDefault();
          const delta = e.code === 'KeyG' ? -0.5 : 0.5;
          const next = Math.round((savedOffset + delta) * 10) / 10;
          bridge.offset = next;
          setItemOffset(itemId, next);
          showMiniHud({
            icon: 'danmaku',
            label: `弹幕偏移 ${next >= 0 ? `+${next.toFixed(1)}` : next.toFixed(1)}s`,
          });
          break;
        }
        case 'KeyZ':
        case 'KeyX': {
          if (engineType !== 'mpv') break;
          e.preventDefault();
          const delta = e.code === 'KeyZ' ? -0.5 : 0.5;
          const next = Math.round((playerPreferences.subDelay + delta) * 10) / 10;
          updatePlayerPreferences({ subDelay: next });
          showMiniHud({
            icon: 'subtitle',
            label: `字幕延迟 ${next >= 0 ? `+${next.toFixed(1)}` : next.toFixed(1)}s`,
          });
          break;
        }
        case 'KeyC': {
          if (subtitleTracks.length === 0) break;
          e.preventDefault();
          const idx = selectedSubtitleId
            ? subtitleTracks.findIndex((t) => t.id === selectedSubtitleId)
            : -1;
          const nextTrack =
            idx + 1 < subtitleTracks.length ? subtitleTracks[idx + 1] : null;
          handleSelectSubtitleTrack(nextTrack ? nextTrack.id : null);
          showMiniHud({
            icon: 'subtitle',
            label: nextTrack ? `字幕: ${nextTrack.title}` : '字幕已关闭',
          });
          break;
        }
        case 'KeyA': {
          if (audioTracks.length <= 1) break;
          e.preventDefault();
          const idx = selectedAudioId
            ? audioTracks.findIndex((t) => t.id === selectedAudioId)
            : 0;
          const nextTrack = audioTracks[(idx + 1) % audioTracks.length];
          handleSelectAudioTrack(nextTrack.id);
          showMiniHud({
            icon: 'volume',
            label: `音轨: ${nextTrack.title}`,
          });
          break;
        }
        case 'KeyL':
          e.preventDefault();
          handleSkipIntro();
          break;
        case 'KeyN':
          if (nextEpisode) {
            e.preventDefault();
            switchToEpisode(nextEpisode);
          }
          break;
        case 'KeyP':
          if (prevEpisode) {
            e.preventDefault();
            switchToEpisode(prevEpisode);
          }
          break;
        case 'KeyT':
          e.preventDefault();
          handleTogglePin();
          break;
        case 'KeyS':
          e.preventDefault();
          handleTakeScreenshot();
          break;
        case 'KeyF':
          e.preventDefault();
          handleToggleFullscreen();
          break;
        case 'KeyI':
          e.preventDefault();
          setActivePanel((prev) => (prev === 'info' ? 'none' : 'info'));
          break;
        case 'Escape':
          if (contextMenu.visible) {
            setContextMenu((prev) => ({ ...prev, visible: false }));
          } else if (isProxyModalOpen) {
            setIsProxyModalOpen(false);
          } else if (activePanel !== 'none') {
            setActivePanel('none');
          } else if (isFullscreen) {
            handleToggleFullscreen();
          } else {
            handleBack();
          }
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight') {
        if (longPressTimerRef.current) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          handleSeekDelta(5);
        } else if (longPressActiveRef.current) {
          longPressActiveRef.current = false;
          setFastForwardRate(null);
          handleRateChange(preLongPressRateRef.current, false);
        }
      }
    };

    const handleWindowBlur = () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (longPressActiveRef.current) {
        longPressActiveRef.current = false;
        setFastForwardRate(null);
        handleRateChange(preLongPressRateRef.current, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    currentTime,
    effectiveDuration,
    paused,
    volume,
    playbackRate,
    danmakuSettings.visible,
    savedOffset,
    playerPreferences.subDelay,
    playerPreferences.longPressSpeed,
    playerPreferences.skipIntroSeconds,
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubtitleId,
    nextEpisode,
    prevEpisode,
    isFullscreen,
    activePanel,
    isProxyModalOpen,
    contextMenu.visible,
    isLoadingVideo,
    videoError,
    engineType,
    itemId,
    isPinned,
    handleSeekDelta,
    handleVolumeChange,
    handleRateChange,
    switchToEpisode,
    showMiniHud,
  ]);

  // 零转码原画直连策略下的错误处理
  const handleVideoError = useCallback(
    (errMsg?: string) => {
      console.warn('[Video Error Event] engine:', engineType, 'err:', errMsg);

      setIsLoadingVideo(false);
      setPaused(true);

      if (!currentServer || !item || !mediaSource || !playSessionId) {
        setVideoError('未获取到媒体播放会话信息');
        return;
      }

      if (engineType === 'html5') {
        const container = (mediaSource.Container || 'MKV').toUpperCase();
        const videoCodec = (
          mediaSource.MediaStreams?.find((s) => s.Type === 'Video')?.Codec || ''
        ).toUpperCase();
        setVideoError(
          `当前片源为 ${container}${videoCodec ? ` (${videoCodec})` : ''} 格式，HTML5 浏览器内核无法直接解码播放。客户端已严格禁止触发 Emby 服务端转码以保护服务器性能。请使用 MPV 原生硬解引擎播放原画。`
        );
        return;
      }

      if (errMsg && (errMsg.includes('初始化 libmpv') || errMsg.includes('FFI error'))) {
        setVideoError(errMsg);
        return;
      }

      setVideoError(
        errMsg
          ? `直连媒体流播放中断 (${errMsg})。请检查网络连接或代理配置。`
          : '无法打开该媒体直连流，请检查网络连接、代理路由或重试。'
      );
    },
    [currentServer, item, mediaSource, playSessionId, engineType, setPaused]
  );

  useEffect(() => {
    handleVideoErrorRef.current = handleVideoError;
  }, [handleVideoError]);

  const handleRetryDirect = (overrideMode?: StreamProxyOverride) => {
    if (!currentServer || !item || !mediaSource || !playSessionId) return;
    if (overrideMode) {
      setProxyOverride(overrideMode);
      proxyOverrideRef.current = overrideMode;
    }
    setIsLoadingVideo(true);
    setVideoError(null);
    hasInitialSeekedRef.current = false;
    const directUrl =
      engineType === 'mpv' && isTauriEnvironment()
        ? buildNativeDirectStreamUrl(
            currentServer.url,
            item.Id,
            mediaSource,
            playSessionId,
            currentServer.accessToken
          )
        : buildDirectStreamUrl(
            currentServer.url,
            item.Id,
            mediaSource,
            playSessionId,
            currentServer.accessToken
          );
    setCurrentStreamUrl(directUrl);
    setReloadToken((t) => t + 1);
  };

  const handleSwitchToMpv = () => {
    setVideoError(null);
    setIsLoadingVideo(true);
    hasInitialSeekedRef.current = false;
    setEngineType('mpv');
  };

  if (!item) {
    return (
      <div className="w-full h-full min-h-screen bg-[#0f1115] flex flex-col items-center justify-center space-y-4 text-gray-300">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">正在加载媒体信息...</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs transition cursor-pointer"
        >
          返回首页
        </button>
      </div>
    );
  }

  const backdropUrl = currentServer
    ? buildItemImageUrl(
        currentServer.url,
        item.Id,
        item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop || item.ImageTags?.Primary,
        { type: 'Backdrop', maxWidth: 1920, quality: 75 }
      )
    : '';

  // 顶部标题旁画质微标（如 4K · HDR）
  const vStream = mediaSource?.MediaStreams?.find((s) => s.Type === 'Video');
  const specParts: string[] = [];
  if (vStream?.Width && vStream.Width >= 3800) specParts.push('4K');
  else if (vStream?.Width && vStream.Width >= 1900) specParts.push('1080p');
  if (vStream?.VideoRange && vStream.VideoRange !== 'SDR') specParts.push(vStream.VideoRange);
  const videoSpecLabel = specParts.join(' · ') || undefined;

  const proxySummaryLabel =
    proxyInfo?.mode === 'system_http' || proxyInfo?.mode === 'manual_http'
      ? 'HTTP 代理'
      : proxyInfo?.mode === 'lan_bypass'
      ? 'LAN 直通'
      : '直连';

  return (
    <div
      onWheel={handleVideoWheel}
      onContextMenu={handleContextMenu}
      className="relative w-screen h-screen overflow-hidden select-none bg-transparent"
    >
      {/* 屏幕中央播放/暂停瞬时动效徽标 */}
      {centerIcon && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
          <div className="p-5 rounded-full bg-black/60 backdrop-blur-md text-white shadow-2xl border border-white/10 animate-in zoom-in-75 fade-in duration-150">
            {centerIcon === 'play' ? (
              <Play className="w-9 h-9 fill-white translate-x-0.5" />
            ) : (
              <Pause className="w-9 h-9 fill-white" />
            )}
          </div>
        </div>
      )}

      {/* 无打扰 Mini HUD & 长按倍速顶部胶囊 */}
      <MiniActionHud hud={miniHud} fastForwardRate={fastForwardRate} />

      {/* 底层：原生视频表面穿透层与交互层 */}
      <div
        ref={containerRef}
        className="absolute inset-0 z-0 cursor-pointer overflow-hidden bg-transparent"
        onClick={handleVideoClick}
        onDoubleClick={handleVideoDoubleClick}
      />

      {/* Loading Overlay */}
      {isLoadingVideo && !videoError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0f1115]/90 backdrop-blur-sm pointer-events-auto">
          {backdropUrl && (
            <img
              src={backdropUrl}
              alt={item.Name}
              className="absolute inset-0 w-full h-full object-cover filter blur-2xl opacity-25"
            />
          )}
          <div className="relative z-10 flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <h2 className="text-base font-bold text-white tracking-wide">{item.Name}</h2>
              <p className="text-xs text-gray-400 mt-1">
                {engineType === 'mpv'
                  ? '正在通过 MPV 硬解引擎直连原画 (0 转码)...'
                  : '正在通过 HTML5 引擎直连原画 (0 转码)...'}
              </p>
              {proxyInfo && (
                <p className="text-[11px] text-sky-400/90 font-mono mt-1.5">
                  网络路线: {proxyInfo.effectiveProxy ? `代理 ${proxyInfo.effectiveProxy}` : proxySummaryLabel}
                </p>
              )}
            </div>
            <button
              onClick={handleBack}
              className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回详情页</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Overlay (增强：显示当前代理路线 + 强制直连重试 + 代理配置入口) */}
      {videoError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0f1115]/95 p-6 pointer-events-auto">
          <div className="max-w-md w-full bg-[#161922] border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">视频无法播放</h3>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">{videoError}</p>
            </div>

            {proxyInfo && (
              <div className="p-2.5 rounded-xl bg-black/30 border border-white/10 text-[11px] text-slate-300 font-mono flex items-center justify-center space-x-2">
                <Wifi className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">
                  当前路线: {proxyInfo.effectiveProxy || proxySummaryLabel}
                </span>
              </div>
            )}

            <div className="pt-1 flex flex-col gap-2">
              {engineType === 'html5' ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleSwitchToMpv}
                    className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-lg shadow-primary/20"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>一键切换至 MPV 硬解</span>
                  </button>
                  <button
                    onClick={() => handleRetryDirect()}
                    className="py-2.5 px-4 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>重试</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleRetryDirect()}
                    className="py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>重试原画直连</span>
                  </button>
                  <button
                    onClick={() => handleRetryDirect('direct')}
                    className="py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    <span>强制直连重试</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setIsProxyModalOpen(true)}
                  className="py-2 bg-white/5 hover:bg-white/15 text-sky-300 rounded-xl text-xs font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer border border-white/10"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>代理设置与测速</span>
                </button>
                <button
                  onClick={handleBack}
                  className="py-2 bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white rounded-xl text-xs font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer border border-white/10"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回详情页</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 中层：Danmaku Canvas 120Hz 零闪烁渲染层 */}
      <DanmakuLayer
        bridge={bridge}
        comments={formattedComments}
        visible={danmakuSettings.visible}
        speed={danmakuSettings.speed}
        opacity={danmakuSettings.opacity}
        area={danmakuSettings.area}
        maxLines={danmakuSettings.maxLines}
        bottomMargin={danmakuSettings.bottomMargin}
      />

      {/* 跳过片头胶囊 & 下一集自动连播倒计时浮窗 */}
      <UpNextOverlay
        showSkipIntro={showSkipIntro}
        onSkipIntro={handleSkipIntro}
        nextEpisode={nextEpisode}
        serverUrl={currentServer?.url}
        countdownSeconds={autoNextCountdown}
        onPlayNextNow={() => nextEpisode && switchToEpisode(nextEpisode)}
        onCancelAutoNext={() => {
          setCancelAutoNext(true);
          setAutoNextCountdown(null);
        }}
      />

      {/* 顶层：播放器 OSD 控制栏 */}
      <PlayerOsd
        title={item.Name}
        subtitle={item.SeriesName ? `${item.SeriesName} · 第 ${item.IndexNumber || 1} 集` : undefined}
        visible={isOsdVisible || isLoadingVideo || !!videoError}
        paused={paused}
        currentTime={currentTime}
        duration={effectiveDuration}
        volume={volume}
        playbackRate={playbackRate}
        engineType={engineType}
        telemetry={telemetry}
        videoSpecLabel={videoSpecLabel}
        networkSpeed={networkSpeed}
        proxyInfo={proxyInfo}
        chapters={chapters}
        danmakuHeatmap={danmakuHeatmap}
        showHeatmap={danmakuSettings.showHeatmap}
        abLoopA={abLoopA}
        abLoopB={abLoopB}
        showRemainingTime={playerPreferences.showRemainingTime}
        onToggleRemainingTime={() =>
          updatePlayerPreferences({ showRemainingTime: !playerPreferences.showRemainingTime })
        }
        hasNextEpisode={!!nextEpisode}
        onNextEpisode={() => nextEpisode && switchToEpisode(nextEpisode)}
        availableMediaSources={availableMediaSources}
        activeMediaSourceId={mediaSource?.Id}
        onSelectMediaSource={switchMediaSource}
        danmakuVisible={danmakuSettings.visible}
        danmakuCount={rawComments.length}
        danmakuOffset={savedOffset}
        matchedTitle={matchedTitle}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        selectedAudioId={selectedAudioId}
        selectedSubtitleId={selectedSubtitleId}
        selectedSecondarySubtitleId={selectedSecondarySubtitleId}
        isFullscreen={isFullscreen}
        isMaximized={isMaximized}
        isPinned={isPinned}
        isTauri={isTauriEnvironment()}
        isDanmakuDrawerOpen={activePanel === 'danmaku'}
        isVideoProPanelOpen={activePanel === 'videoPro'}
        isEpisodeDrawerOpen={activePanel === 'episodes'}
        isNetworkPopoverOpen={activePanel === 'network'}
        isPlaybackInfoOpen={activePanel === 'info'}
        onBack={handleBack}
        onHome={handleHome}
        onTogglePlay={() => handleTogglePlay(false)}
        onSeek={handleSeek}
        onVolumeChange={(v) => handleVolumeChange(v, false)}
        onRateChange={(r) => handleRateChange(r, false)}
        onToggleDanmaku={() => updateDanmakuSettings({ visible: !danmakuSettings.visible })}
        onToggleDanmakuDrawer={() =>
          setActivePanel((p) => (p === 'danmaku' ? 'none' : 'danmaku'))
        }
        onToggleVideoProPanel={() =>
          setActivePanel((p) => (p === 'videoPro' ? 'none' : 'videoPro'))
        }
        onToggleEpisodeDrawer={
          episodes.length > 0 || availableMediaSources.length > 1
            ? () => setActivePanel((p) => (p === 'episodes' ? 'none' : 'episodes'))
            : undefined
        }
        onToggleNetworkPopover={() =>
          setActivePanel((p) => (p === 'network' ? 'none' : 'network'))
        }
        onTogglePlaybackInfo={() => setActivePanel((p) => (p === 'info' ? 'none' : 'info'))}
        onSelectAudioTrack={handleSelectAudioTrack}
        onSelectSubtitleTrack={handleSelectSubtitleTrack}
        onTogglePin={handleTogglePin}
        onMinimizeWindow={() => getCurrentWindow().minimize().catch(() => {})}
        onCloseWindow={() => getCurrentWindow().close().catch(() => {})}
        onToggleWindowMode={handleToggleWindowMode}
        onToggleFullscreen={handleToggleFullscreen}
        onVideoClick={handleVideoClick}
        onVideoDoubleClick={handleVideoDoubleClick}
      />

      {/* 右键快捷菜单 */}
      <PlayerContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        paused={paused}
        hasNextEpisode={!!nextEpisode}
        hasPrevEpisode={!!prevEpisode}
        playbackRate={playbackRate}
        danmakuVisible={danmakuSettings.visible}
        isPinned={isPinned}
        isBottomAlign={currentLayout.bottomAlign}
        videoAspect={playerPreferences.videoAspect}
        proxySummary={proxySummaryLabel}
        showEpisodesEntry={episodes.length > 0 || availableMediaSources.length > 1}
        onTogglePlay={() => handleTogglePlay(false)}
        onNextEpisode={() => nextEpisode && switchToEpisode(nextEpisode)}
        onPrevEpisode={() => prevEpisode && switchToEpisode(prevEpisode)}
        onSkipIntro={handleSkipIntro}
        onRateChange={(r) => handleRateChange(r, true)}
        onToggleDanmaku={() => updateDanmakuSettings({ visible: !danmakuSettings.visible })}
        onToggleBottomAlign={() =>
          layoutKey && setVideoLayout(layoutKey, { bottomAlign: !currentLayout.bottomAlign })
        }
        onCycleAspect={() => {
          const order: VideoAspectPreset[] = ['auto', '16:9', '21:9', '4:3', 'fill'];
          const next = order[(order.indexOf(playerPreferences.videoAspect) + 1) % order.length];
          updatePlayerPreferences({ videoAspect: next });
        }}
        onOpenDanmakuDrawer={() => setActivePanel('danmaku')}
        onOpenVideoPro={() => setActivePanel('videoPro')}
        onOpenNetworkPopover={() => setActivePanel('network')}
        onOpenEpisodeDrawer={() => setActivePanel('episodes')}
        onTogglePin={handleTogglePin}
        onTakeScreenshot={handleTakeScreenshot}
        onOpenPlaybackInfo={() => setActivePanel('info')}
        onOpenShortcuts={() => setActivePanel('shortcuts')}
      />

      {/* 弹幕加载或绑定提示 Toast */}
      {danmuToast && (
        <div className="fixed top-20 right-6 z-40 max-w-md bg-black/85 backdrop-blur-md border border-primary/40 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-ping flex-shrink-0" />
          <span className="font-medium truncate">{danmuToast}</span>
        </div>
      )}

      {/* 时长偏差提示 Banner */}
      {durationAlert && (
        <div className="fixed top-32 right-6 z-40 max-w-sm bg-black/80 backdrop-blur-md border border-yellow-500/30 text-yellow-300 text-xs p-3 rounded-xl shadow-xl flex items-start space-x-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-yellow-400 mt-0.5" />
          <div className="flex-1 leading-relaxed">{durationAlert}</div>
          <button
            onClick={() => setDurationAlert(null)}
            className="text-gray-400 hover:text-white ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 右侧专注面板 1: 弹幕控制中心 */}
      <DanmakuDrawer
        isOpen={activePanel === 'danmaku'}
        onClose={() => setActivePanel('none')}
        bridge={bridge}
        itemId={item.Id}
        seriesId={item.SeriesId}
        itemTitle={item.Name}
        seriesName={item.SeriesName}
        currentMatchedTitle={matchedTitle}
        sourceCommentCount={rawComments.length}
        sourceDuration={sourceDuration}
        videoDuration={effectiveDuration}
        rawComments={rawComments}
        currentTime={currentTime}
        onSeekToTime={(sec) => {
          handleSeek(sec);
          showMiniHud({ icon: 'seek-forward', label: `跳转至 ${formatTime(sec)}` });
        }}
        onCommentsLoaded={(newComments, sDur, meta) => {
          setRawComments(newComments);
          if (sDur) setSourceDuration(sDur);
          if (meta) {
            setMatchedTitle(`《${meta.animeTitle}》${meta.episodeTitle}`);
            setDanmuToast(
              `已切换并绑定弹幕: 《${meta.animeTitle}》${meta.episodeTitle} (${newComments.length}条)`
            );
            setTimeout(() => setDanmuToast(null), 3500);
          }
          if (sDur && item.RunTimeTicks) {
            const embyDurationSec = ticksToSeconds(item.RunTimeTicks);
            const diff = Math.round(Math.abs(sDur - embyDurationSec));
            if (diff > 15) {
              setDurationAlert(`弹幕源时长相差 ${diff} 秒，可在校准页面一键按时长差对齐。`);
            } else {
              setDurationAlert(null);
            }
          }
        }}
        onReAutoMatch={() => triggerDanmakuLoad(true)}
      />

      {/* 右侧专注面板 2: 画质、硬解与音字幕 Pro 调校 */}
      <VideoProPanel
        isOpen={activePanel === 'videoPro'}
        onClose={() => setActivePanel('none')}
        layoutKey={layoutKey}
        seriesName={item.SeriesName}
        videoAspectRatio={videoAspectRatio}
        isWidescreen={isWidescreen}
        telemetry={telemetry}
        subtitleTracks={subtitleTracks}
        selectedSubtitleId={selectedSubtitleId}
        selectedSecondarySubtitleId={selectedSecondarySubtitleId}
        onSelectSubtitleTrack={handleSelectSubtitleTrack}
        onSelectSecondarySubtitleTrack={handleSelectSecondarySubtitleTrack}
        abLoopA={abLoopA}
        abLoopB={abLoopB}
        onSetAbLoop={handleSetAbLoop}
        onTakeScreenshot={handleTakeScreenshot}
        volume={volume}
        onVolumeChange={(v) => handleVolumeChange(v, false)}
      />

      {/* 右侧专注面板 3: 分集列表与多版本原画源 */}
      <EpisodeDrawer
        isOpen={activePanel === 'episodes'}
        onClose={() => setActivePanel('none')}
        currentItemId={item.Id}
        seasons={seasons}
        selectedSeasonId={selectedSeasonId}
        onSelectSeason={handleSelectSeasonInDrawer}
        episodes={episodes}
        episodesLoading={episodesLoading}
        serverUrl={currentServer?.url}
        onSelectEpisode={switchToEpisode}
        availableMediaSources={availableMediaSources}
        activeMediaSourceId={mediaSource?.Id}
        onSelectMediaSource={switchMediaSource}
        autoPlayNext={playerPreferences.autoPlayNext}
        onToggleAutoPlayNext={(val) => updatePlayerPreferences({ autoPlayNext: val })}
      />

      {/* 浮动面板 4: 网络缓冲监控与代理快切 */}
      <NetworkProxyPopover
        isOpen={activePanel === 'network'}
        onClose={() => setActivePanel('none')}
        networkSpeed={networkSpeed}
        speedHistory={speedHistory}
        telemetry={telemetry}
        proxyInfo={proxyInfo}
        proxyOverride={proxyOverride}
        onChangeProxyOverride={handleHotReloadStreamWithProxy}
        onReloadStream={() => handleHotReloadStreamWithProxy(proxyOverride)}
        onOpenProxySettings={() => setIsProxyModalOpen(true)}
      />

      {/* 居中浮层 5: 实时硬解与媒体技术信息 HUD */}
      <PlaybackInfoModal
        isOpen={activePanel === 'info'}
        onClose={() => setActivePanel('none')}
        item={item}
        mediaSource={mediaSource}
        streamUrl={currentStreamUrl || streamUrl}
        engineType={engineType}
        currentTime={currentTime}
        duration={effectiveDuration}
        playbackRate={playbackRate}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        selectedAudioId={selectedAudioId}
        selectedSubtitleId={selectedSubtitleId}
        currentServerName={currentServer?.name}
        danmakuMatchedTitle={matchedTitle}
        danmakuCount={rawComments.length}
        danmakuOffset={savedOffset}
        networkSpeed={networkSpeed}
        telemetry={telemetry}
        proxyInfo={proxyInfo}
      />

      {/* 居中浮层 6: 快捷键与手势指南 */}
      <ShortcutsModal
        isOpen={activePanel === 'shortcuts'}
        onClose={() => setActivePanel('none')}
      />

      {/* 详细网络与代理配置弹窗（保存后原地热重载视频流） */}
      <NetworkProxyModal
        isOpen={isProxyModalOpen}
        onClose={() => setIsProxyModalOpen(false)}
        onSaved={() => handleHotReloadStreamWithProxy(proxyOverride)}
      />
    </div>
  );
};

export default PlayerPage;
