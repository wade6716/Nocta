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
  Copy,
  Check,
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { useDanmuStore } from '../stores/useDanmuStore';
import { useEmbyHostsStore } from '../stores/useEmbyHostsStore';
import { useThemeStore } from '../stores/useThemeStore';
import { extractHostFromUrl } from '../services/embyHostCollector';
import {
  EmbyChapter,
  EmbyItem,
  EmbyMediaSource,
  ticksToSeconds,
  getItemDetail,
  getSeriesSeasons,
  getSeriesEpisodes,
  mapStreamTracks,
  resolveItemBackdropUrl,
  stripImageFormatWebp,
  buildEmbyStreamHeaders,
  resolveEmbyUserAgent,
  resolveEmbyFallbackStreamCandidates,
  EMBY_USER_AGENT_PRESETS,
  DEFAULT_EMBY_USER_AGENT,
} from '../api/embyClient';
import { resolveMpvProxyDetailed } from '../player/MpvPlayerEngine';
import {
  decideStallRecoveryAction,
  shouldDanmakuRun,
} from '../player/playbackStateGuard';
import {
  IPlayerEngine,
  PlayerTelemetry,
  ResolvedStreamProxyInfo,
  StreamProxyOverride,
  VideoAspectPreset,
} from '../player/types';
import { PlayerEngineFactory } from '../player/PlayerEngineFactory';
import { isTauriEnvironment } from '../api/http';
import { MpvDanmakuBridge } from '../components/player/MpvDanmakuBridge';
import { DanmakuLayer } from '../components/player/DanmakuLayer';
import { PlayerOsd, formatNetworkSpeed, formatTime } from '../components/player/PlayerOsd';
import { DanmakuDrawer } from '../components/player/DanmakuDrawer';
import { PlaybackInfoModal } from '../components/player/PlaybackInfoModal';
import { BufferingIndicator } from '../components/player/BufferingIndicator';
import { MiniActionHud, MiniHudState } from '../components/player/MiniActionHud';
import { PlayerContextMenu } from '../components/player/PlayerContextMenu';
import { ShortcutsModal } from '../components/player/ShortcutsModal';
import { EpisodeDrawer } from '../components/player/EpisodeDrawer';
import { VideoProPanel } from '../components/player/VideoProPanel';
import { NetworkProxyPopover } from '../components/player/NetworkProxyPopover';
import { UpNextOverlay } from '../components/player/UpNextOverlay';
import { NetworkProxyModal } from '../components/settings/NetworkProxyModal';
import { EmbyServerModal } from '../components/settings/EmbyServerModal';
import { OutroSkipToast } from '../components/player/OutroSkipToast';
import { SkipNoticeToast } from '../components/player/SkipNoticeToast';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';
import { OsdCommand, OsdSyncPayload } from '../player/osdOverlaySync';
import {
  buildStreamUrlForEngine,
  fetchAndPreparePlaybackSession,
} from '../player/playbackSessionService';
import { useEmbyPlaybackReporter } from '../player/hooks/useEmbyPlaybackReporter';
import {
  OUTRO_TOAST_MS,
  useSkipSegmentsController,
} from '../player/hooks/useSkipSegmentsController';
import { shouldTriggerAutoNext } from '../player/skipSegmentsUtils';
import { useDanmakuSession } from '../player/hooks/useDanmakuSession';
import { useMacOsdOverlaySync } from '../player/hooks/useMacOsdOverlaySync';
import { useNextEpisodePreloader } from '../player/hooks/useNextEpisodePreloader';
import { useMediaSessionController } from '../player/hooks/useMediaSessionController';

type ActivePanelType =
  | 'none'
  | 'danmaku'
  | 'videoPro'
  | 'episodes'
  | 'network'
  | 'info'
  | 'shortcuts';

interface DiagnosticHop {
  hop: number;
  url: string;
  status?: number | null;
  statusText?: string | null;
  location?: string | null;
  server?: string | null;
  contentType?: string | null;
  contentRange?: string | null;
  acceptRanges?: string | null;
  cfRay?: string | null;
  cfMitigated?: string | null;
  bodySnippet?: string | null;
  error?: string | null;
}

interface StreamDiagnosticReport {
  reachable: boolean;
  finalStatus?: number | null;
  userAgent: string;
  summary: string;
  hops: DiagnosticHop[];
  midRangeSupported?: boolean | null;
  totalSize?: number | null;
  isMkv?: boolean;
}

function redactUrlForReport(raw?: string | null): string {
  if (!raw) return '-';
  try {
    const u = new URL(raw);
    const secretKeys = new Set([
      'api_key',
      'x-emby-token',
      'token',
      'auth',
      'signature',
      'sig',
      'sign',
      'x-amz-signature',
    ]);
    u.searchParams.forEach((_, k) => {
      if (secretKeys.has(k.toLowerCase())) {
        u.searchParams.set(k, '***');
      }
    });
    return u.toString();
  } catch {
    return raw;
  }
}

const IS_MACOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
const RATE_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export const PlayerPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const { getActiveServer } = useDanmuStore();
  const activeDanmuServer = getActiveServer();

  // 精细化 Store 选择器，防止非播放页配置变更或全量订阅扩大渲染范围
  const item = usePlayerStore((s) => s.item);
  const mediaSource = usePlayerStore((s) => s.mediaSource);
  const availableMediaSources = usePlayerStore((s) => s.availableMediaSources);
  const playSessionId = usePlayerStore((s) => s.playSessionId);
  const streamUrl = usePlayerStore((s) => s.streamUrl);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const initialTime = usePlayerStore((s) => s.initialTime);
  const duration = usePlayerStore((s) => s.duration);
  const paused = usePlayerStore((s) => s.paused);
  const volume = usePlayerStore((s) => s.volume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const audioTracks = usePlayerStore((s) => s.audioTracks);
  const subtitleTracks = usePlayerStore((s) => s.subtitleTracks);
  const selectedAudioId = usePlayerStore((s) => s.selectedAudioId);
  const selectedSubtitleId = usePlayerStore((s) => s.selectedSubtitleId);
  const selectedSecondarySubtitleId = usePlayerStore((s) => s.selectedSecondarySubtitleId);
  const videoLayouts = usePlayerStore((s) => s.videoLayouts);
  const playerPreferences = usePlayerStore((s) => s.playerPreferences);
  const skipSegments = usePlayerStore((s) => s.skipSegments);
  const engineType = usePlayerStore((s) => s.engineType);
  const setEngineType = usePlayerStore((s) => s.setEngineType);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);
  const updateTracks = usePlayerStore((s) => s.updateTracks);
  const updateTime = usePlayerStore((s) => s.updateTime);
  const setPaused = usePlayerStore((s) => s.setPaused);
  const setBuffering = usePlayerStore((s) => s.setBuffering);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const selectAudioTrack = usePlayerStore((s) => s.selectAudioTrack);
  const selectSubtitleTrack = usePlayerStore((s) => s.selectSubtitleTrack);
  const selectSecondarySubtitleTrack = usePlayerStore((s) => s.selectSecondarySubtitleTrack);
  const updateDanmakuSettings = usePlayerStore((s) => s.updateDanmakuSettings);
  const setItemOffset = usePlayerStore((s) => s.setItemOffset);
  const setVideoLayout = usePlayerStore((s) => s.setVideoLayout);
  const updatePlayerPreferences = usePlayerStore((s) => s.updatePlayerPreferences);
  const resetPlayer = usePlayerStore((s) => s.resetPlayer);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // Bridge ref for 120Hz interpolation
  const bridgeRef = useRef<MpvDanmakuBridge>(new MpvDanmakuBridge());
  const bridge = bridgeRef.current;

  // Video playback & telemetry status
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(streamUrl);
  const [reloadToken, setReloadToken] = useState(0);
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [stallNotice, setStallNotice] = useState<string | null>(null);
  const [stallReport, setStallReport] = useState<StreamDiagnosticReport | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [diagnosticReport, setDiagnosticReport] = useState<StreamDiagnosticReport | null>(null);
  const [diagnosingStream, setDiagnosingStream] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [usingRelayStream, setUsingRelayStream] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [networkSpeed, setNetworkSpeed] = useState<number>(0);
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [telemetry, setTelemetry] = useState<PlayerTelemetry>({});
  const [proxyOverride, setProxyOverride] = useState<StreamProxyOverride>('follow');
  const [proxyInfo, setProxyInfo] = useState<ResolvedStreamProxyInfo | null>(null);
  const [currentRedirectHosts, setCurrentRedirectHosts] = useState<string[]>([]);
  const probedRedirectKeysRef = useRef<Set<string>>(new Set());
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

  // Refs to prevent stale closures, race conditions & accidental 0s progress wipe
  const hasInitialSeekedRef = useRef(false);
  const hasFirstFrameRef = useRef(false);
  const isLoadingVideoRef = useRef(true);
  const isBufferingRef = useRef(false);
  const pausedRef = useRef(paused);
  const videoErrorRef = useRef<string | null>(null);
  const telemetryRef = useRef<PlayerTelemetry>({});
  const isMountedRef = useRef(true);
  const skipInitialIntroOnceRef = useRef(false);
  const initialTimeRef = useRef<number>(initialTime);
  const lastValidTimeRef = useRef<number>(initialTime);
  const lastStoreTimeUpdateRef = useRef<{ at: number; time: number; dur: number }>({
    at: 0,
    time: 0,
    dur: 0,
  });
  const autoSwitchedItemIdRef = useRef<string | null>(null);
  const appliedPrefTrackUrlRef = useRef<string | null>(null);
  const episodeSwitchReqIdRef = useRef(0);
  const storeRevisionRef = useRef(1);
  const applyingOverlayPatchRef = useRef(false);
  const networkSpeedRef = useRef(0);
  const handleVideoErrorRef = useRef<(errMsg?: string) => void>(() => {});
  const runStreamDiagnosticRef = useRef<(autoRelay: boolean) => void>(() => {});
  const relayFallbackAttemptedRef = useRef(false);
  const altCandidateFallbackAttemptedRef = useRef(false);
  const diagReqIdRef = useRef(0);
  const relayStartReqIdRef = useRef(0);
  const activeRelayTokenRef = useRef<string | null>(null);
  const proxyOverrideRef = useRef<StreamProxyOverride>('follow');
  const upstreamStreamUrlRef = useRef<string | null>(
    streamUrl && !/^https?:\/\/127\.0\.0\.1:\d+\/(stream|relay)\//.test(streamUrl) ? streamUrl : null
  );
  const seekRef = useRef<(targetSeconds: number) => void>(() => {});
  const seekDeltaRef = useRef<(delta: number) => void>(() => {});
  const isSwitchingEpisodeRef = useRef(false);
  const switchingTargetIdRef = useRef<string | null>(null);
  const nextEpisodeRef = useRef<EmbyItem | null>(null);
  const cancelAutoNextRef = useRef(false);
  const switchToEpisodeRef = useRef<(targetEp: EmbyItem) => Promise<void>>(async () => {});

  cancelAutoNextRef.current = cancelAutoNext;
  pausedRef.current = paused;
  videoErrorRef.current = videoError;
  isLoadingVideoRef.current = isLoadingVideo;
  isBufferingRef.current = isBuffering;
  telemetryRef.current = telemetry;

  useEffect(() => {
    proxyOverrideRef.current = proxyOverride;
  }, [proxyOverride]);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (applyingOverlayPatchRef.current) return;
      if (
        state.danmakuSettings !== prev.danmakuSettings ||
        state.playerPreferences !== prev.playerPreferences ||
        state.videoLayouts !== prev.videoLayouts ||
        state.itemOffsets !== prev.itemOffsets ||
        state.seriesOffsets !== prev.seriesOffsets ||
        state.danmakuBindings !== prev.danmakuBindings ||
        state.seriesDanmakuBindings !== prev.seriesDanmakuBindings ||
        state.skipSegments !== prev.skipSegments ||
        state.skipSettings !== prev.skipSettings ||
        state.engineType !== prev.engineType
      ) {
        storeRevisionRef.current += 1;
      }
    });
  }, []);

  // Player Engine and Container refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<IPlayerEngine | null>(null);

  // Per-series or per-item video layout configuration
  const layoutKey = item?.SeriesId ? `series_${item.SeriesId}` : item ? `item_${item.Id}` : '';
  const currentLayout = (layoutKey && videoLayouts[layoutKey]) || {
    bottomAlign: playerPreferences.defaultBottomAlign,
    verticalOffset: 100,
  };
  const videoAspectRatio = videoDimensions
    ? videoDimensions.width / videoDimensions.height
    : undefined;
  const isWidescreen = videoAspectRatio
    ? videoAspectRatio > window.innerWidth / window.innerHeight + 0.05
    : false;

  // 互斥面板 & 弹窗状态
  const [activePanel, setActivePanel] = useState<ActivePanelType>('none');
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [isServerUaModalOpen, setIsServerUaModalOpen] = useState(false);
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
  const preOverlayTempRateRef = useRef<number | null>(null);

  // OSD and Window interaction
  const [isOsdVisible, setIsOsdVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [centerIcon, setCenterIcon] = useState<'play' | 'pause' | null>(null);
  const centerIconTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const isAnyPanelOpen =
    activePanel !== 'none' || isProxyModalOpen || isServerUaModalOpen || contextMenu.visible;

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      episodeSwitchReqIdRef.current += 1;
      diagReqIdRef.current += 1;
      relayStartReqIdRef.current += 1;
      if (miniHudTimerRef.current) {
        window.clearTimeout(miniHudTimerRef.current);
      }
      if (isTauriEnvironment()) {
        invoke('stop_stream_relay', { token: null }).catch(() => {});
      }
    };
  }, []);

  const effectiveDuration = duration || ticksToSeconds(item?.RunTimeTicks || 0);

  const effectiveBitrateBps = useMemo(() => {
    if (mediaSource?.Bitrate && mediaSource.Bitrate > 0) {
      return mediaSource.Bitrate;
    }
    if (mediaSource?.Size && mediaSource.Size > 0 && effectiveDuration > 1) {
      return Math.round((mediaSource.Size * 8) / effectiveDuration);
    }
    return undefined;
  }, [mediaSource?.Bitrate, mediaSource?.Size, effectiveDuration]);

  const effectiveBitrateBpsRef = useRef<number | undefined>(effectiveBitrateBps);
  effectiveBitrateBpsRef.current = effectiveBitrateBps;

  // 领域 Hook 1：弹幕会话（竞态锁、同剧延续、零闪烁格式化与热力曲线）
  const {
    danmakuSettings,
    rawComments,
    matchedTitle,
    sourceDuration,
    danmuToast,
    durationAlert,
    setDurationAlert,
    savedOffset,
    formattedComments,
    danmakuHeatmap,
    triggerDanmakuLoad,
    handleCommentsLoaded,
  } = useDanmakuSession({
    item,
    itemId,
    effectiveDuration,
    bridge,
    activeDanmuServer,
  });

  // 领域 Hook 2：Emby 播放生命周期上报
  const { reportStoppedNow, reportEventProgress } = useEmbyPlaybackReporter({
    serverId: currentServer?.id,
    serverUrl: currentServer?.url,
    serverAccessToken: currentServer?.accessToken,
    item,
    mediaSource,
    playSessionId,
    initialTime,
    initialTimeRef,
    lastValidTimeRef,
    engineRef,
  });

  // 领域 Hook 3：片头/片尾跳过控制与倒计时
  const {
    currentSkipSegments,
    skipSettings,
    showSkipIntro,
    skipNotice,
    outroToast,
    outroRemainingMs,
    resolveInitialPlaybackTime,
    checkOutroAtTime,
    resetOutroForNewStream,
    clearOutroOnEnded,
    handleMarkIntroEnd,
    handleMarkOutroStart,
    handleClearSkipSegment,
    handleSkipOutro,
    handleCancelOutro,
    handleSkipIntro,
  } = useSkipSegmentsController({
    item,
    itemId,
    initialTime,
    effectiveDuration,
    chapters,
    isLoadingVideo,
    videoError,
    currentTime,
    initialTimeRef,
    lastValidTimeRef,
    engineRef,
    onSeek: (target) => seekRef.current(target),
    onSeekDelta: (delta) => seekDeltaRef.current(delta),
    onPlayNextEpisode: () => {
      const ep = nextEpisodeRef.current;
      if (!ep) return false;
      void switchToEpisodeRef.current(ep);
      return true;
    },
    showMiniHud,
  });

  const setLoadingState = useCallback((loading: boolean) => {
    isLoadingVideoRef.current = loading;
    setIsLoadingVideo(loading);
  }, []);

  const setFirstFrameState = useCallback((ready: boolean) => {
    hasFirstFrameRef.current = ready;
    setHasFirstFrame(ready);
  }, []);

  const updateBuffering = useCallback(
    (next: boolean) => {
      isBufferingRef.current = next;
      setIsBuffering(next);
      setBuffering(next);
    },
    [setBuffering]
  );

  const syncBridgePlaybackState = useCallback(() => {
    const canRun = shouldDanmakuRun({
      paused: pausedRef.current,
      isLoadingVideo: isLoadingVideoRef.current,
      isBuffering: isBufferingRef.current,
      hasFirstFrame: hasFirstFrameRef.current,
      hasError: Boolean(videoErrorRef.current),
    });
    bridge.onMpvPauseChange(!canRun);
  }, [bridge]);

  const stopActiveRelay = useCallback(() => {
    relayStartReqIdRef.current += 1;
    if (isTauriEnvironment() && activeRelayTokenRef.current) {
      invoke('stop_stream_relay', { token: activeRelayTokenRef.current }).catch(() => {});
      activeRelayTokenRef.current = null;
    }
    setUsingRelayStream(false);
  }, []);

  // Sync streamUrl when store changes
  useEffect(() => {
    if (streamUrl) {
      if (!/^https?:\/\/127\.0\.0\.1:\d+\/(stream|relay)\//.test(streamUrl)) {
        upstreamStreamUrlRef.current = streamUrl;
      }
      if (!/\/relay\//.test(streamUrl)) {
        relayFallbackAttemptedRef.current = false;
        altCandidateFallbackAttemptedRef.current = false;
        stopActiveRelay();
        setDiagnosticReport(null);
        setDiagnosticCopied(false);
      }
      setCurrentStreamUrl(streamUrl);
      setFirstFrameState(false);
      setLoadingState(true);
      updateBuffering(false);
      setStallNotice(null);
      setStallReport(null);
      setVideoError(null);
      videoErrorRef.current = null;
      setAbLoopA(null);
      setAbLoopB(null);
      setCancelAutoNext(false);
      setAutoNextCountdown(null);
      hasInitialSeekedRef.current = false;
      autoSwitchedItemIdRef.current = null;
      appliedPrefTrackUrlRef.current = null;
      lastStoreTimeUpdateRef.current = { at: 0, time: 0, dur: 0 };
      resetOutroForNewStream();
      syncBridgePlaybackState();
    }
  }, [
    streamUrl,
    resetOutroForNewStream,
    setFirstFrameState,
    setLoadingState,
    stopActiveRelay,
    syncBridgePlaybackState,
    updateBuffering,
  ]);

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
    engine.setBufferConfig?.({
      bufferDurationSeconds: prefs.bufferDurationSeconds,
      mediaBitrateBps: effectiveBitrateBpsRef.current,
      cacheMemoryCapMB: prefs.cacheMemoryCapMB,
    });
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
      if (!active || isSwitchingEpisodeRef.current) return;
      const targetInitSec = initialTimeRef.current;
      // 记忆进度起播防护：首跳未完成且当前仍处于起播 0 秒时拦截，防止 0 秒冲刷全局进度并保持加载层
      if (!hasInitialSeekedRef.current && targetInitSec > 0 && cur < 1) {
        return;
      }
      // MPV 首帧就绪门控：引擎仍处于 loading 且尚未确认首帧/VO 时，禁止仅凭静态 time-pos 撤掉加载页
      if (
        engineType === 'mpv' &&
        engine.state === 'loading' &&
        !telemetryRef.current.firstFrameReady &&
        !telemetryRef.current.voConfigured
      ) {
        return;
      }
      hasInitialSeekedRef.current = true;
      lastValidTimeRef.current = cur;
      setFirstFrameState(true);
      setLoadingState(false);
      setStallNotice(null);
      setStallReport(null);
      syncBridgePlaybackState();
      bridge.onMpvTimePos(cur);
      checkOutroAtTime(cur, dur);

      // 节流 React Store 进度刷新（约 250ms 一次），消除 120Hz 弹幕旁无谓的整页重渲染
      const now = Date.now();
      const last = lastStoreTimeUpdateRef.current;
      if (
        now - last.at >= 250 ||
        Math.abs(cur - last.time) >= 0.5 ||
        (dur !== undefined && dur !== last.dur)
      ) {
        lastStoreTimeUpdateRef.current = {
          at: now,
          time: cur,
          dur: dur !== undefined ? dur : last.dur,
        };
        updateTime(cur, dur);
      }
    });

    const unlistenState = engine.onStateChange((st) => {
      if (!active || isSwitchingEpisodeRef.current) return;
      switch (st) {
        case 'loading':
          setFirstFrameState(false);
          setLoadingState(true);
          updateBuffering(false);
          setVideoError(null);
          videoErrorRef.current = null;
          syncBridgePlaybackState();
          break;
        case 'playing':
          updateBuffering(false);
          pausedRef.current = false;
          setPaused(false);
          if (
            (engineType === 'html5' ||
              telemetryRef.current.firstFrameReady ||
              telemetryRef.current.voConfigured ||
              hasInitialSeekedRef.current) &&
            !(!hasInitialSeekedRef.current && initialTimeRef.current > 0)
          ) {
            setFirstFrameState(true);
            setLoadingState(false);
            setStallNotice(null);
            setStallReport(null);
          }
          syncBridgePlaybackState();
          break;
        case 'paused':
          updateBuffering(false);
          pausedRef.current = true;
          setPaused(true);
          if (
            (hasFirstFrameRef.current || engineType === 'html5') &&
            !(!hasInitialSeekedRef.current && initialTimeRef.current > 0)
          ) {
            setLoadingState(false);
          }
          syncBridgePlaybackState();
          break;
        case 'buffering':
          updateBuffering(true);
          syncBridgePlaybackState();
          break;
        case 'ended':
          setLoadingState(false);
          updateBuffering(false);
          pausedRef.current = true;
          setPaused(true);
          clearOutroOnEnded();
          syncBridgePlaybackState();
          if (
            nextEpisodeRef.current &&
            usePlayerStore.getState().playerPreferences.autoPlayNext &&
            !cancelAutoNextRef.current &&
            autoSwitchedItemIdRef.current !== nextEpisodeRef.current.Id
          ) {
            autoSwitchedItemIdRef.current = nextEpisodeRef.current.Id;
            void switchToEpisodeRef.current(nextEpisodeRef.current);
          }
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
      telemetryRef.current = t;
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
      updateBuffering(false);
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineType, setFirstFrameState, setLoadingState, syncBridgePlaybackState, updateBuffering]);

  // Sync streamUrl / reloadToken into active engine
  useEffect(() => {
    if (currentStreamUrl && engineRef.current) {
      const resolved = skipInitialIntroOnceRef.current
        ? { seconds: 0, skippedIntro: false }
        : resolveInitialPlaybackTime(initialTimeRef.current);
      skipInitialIntroOnceRef.current = false;
      initialTimeRef.current = resolved.seconds;
      const prefs = usePlayerStore.getState().playerPreferences;
      const liveServer = useAuthStore.getState().getCurrentServer();
      const effectiveUserAgent = resolveEmbyUserAgent(liveServer?.userAgent, liveServer?.url);
      const streamHeaders = liveServer
        ? buildEmbyStreamHeaders(liveServer.userId, liveServer.accessToken, {
            userAgent: liveServer.userAgent,
            serverUrl: liveServer.url,
          })
        : undefined;
      isSwitchingEpisodeRef.current = false;
      switchingTargetIdRef.current = null;
      engineRef.current
        .load({
          url: currentStreamUrl,
          upstreamUrl: upstreamStreamUrlRef.current ?? undefined,
          initialTime: resolved.seconds,
          title: item?.Name,
          userAgent: effectiveUserAgent,
          headers: streamHeaders,
          proxyOverride: proxyOverrideRef.current,
          bufferConfig: {
            bufferDurationSeconds: prefs.bufferDurationSeconds,
            mediaBitrateBps: effectiveBitrateBpsRef.current,
            cacheMemoryCapMB: prefs.cacheMemoryCapMB,
          },
        })
        .then(() => {
          applyAllPreferencesToEngine(engineRef.current);
        });
    }
  }, [currentStreamUrl, reloadToken, resolveInitialPlaybackTime]);

  // 收集当前播放涉及的视频直链、.strm 路径、外挂字幕（静态 URL 立即记录，302 并发探测延后至首帧就绪后避免干扰起播）
  useEffect(() => {
    const liveServer = useAuthStore.getState().getCurrentServer();
    if (!liveServer?.id) return;

    const hostsState = useEmbyHostsStore.getState();
    if (!hostsState.settings.enabled) return;

    const targetStreamUrl = upstreamStreamUrlRef.current || currentStreamUrl;
    const toRecord: Array<{ url: string; category: 'stream' | 'redirect' | 'subtitle' }> = [];

    if (targetStreamUrl && /^https?:\/\//i.test(targetStreamUrl)) {
      toRecord.push({ url: targetStreamUrl, category: 'stream' });
    }
    if (mediaSource?.DirectStreamUrl && /^https?:\/\//i.test(mediaSource.DirectStreamUrl)) {
      toRecord.push({ url: mediaSource.DirectStreamUrl, category: 'stream' });
    }
    if (mediaSource?.Path && /^https?:\/\//i.test(mediaSource.Path)) {
      toRecord.push({ url: mediaSource.Path, category: 'redirect' });
    }
    if (mediaSource?.MediaStreams) {
      for (const ms of mediaSource.MediaStreams) {
        if (ms.Type === 'Subtitle' && ms.IsExternal && ms.DeliveryUrl) {
          const fullSubUrl = /^https?:\/\//i.test(ms.DeliveryUrl)
            ? ms.DeliveryUrl
            : `${liveServer.url.replace(/\/+$/, '')}/${ms.DeliveryUrl.replace(/^\/+/, '')}`;
          toRecord.push({ url: fullSubUrl, category: 'subtitle' });
        }
      }
    }

    if (toRecord.length > 0) {
      hostsState.recordUrls(liveServer.id, toRecord);
    }

    setCurrentRedirectHosts([]);
  }, [currentStreamUrl, mediaSource?.Id, item?.Id]);

  // 首帧出画后再静默探测 302 重定向链以收集 CDN/网盘域名，避免起播期并发请求干扰单连接 302 节点
  useEffect(() => {
    if (!hasFirstFrame) return;
    const liveServer = useAuthStore.getState().getCurrentServer();
    if (!liveServer?.id) return;

    const hostsState = useEmbyHostsStore.getState();
    if (!hostsState.settings.enabled || !hostsState.settings.probePlaybackRedirects) return;

    const targetStreamUrl = upstreamStreamUrlRef.current || currentStreamUrl;
    if (!isTauriEnvironment() || !targetStreamUrl || !/^https?:\/\//i.test(targetStreamUrl)) {
      return;
    }

    const dedupeKey = `${liveServer.id}::${item?.Id || ''}::${mediaSource?.Id || targetStreamUrl}`;
    if (probedRedirectKeysRef.current.has(dedupeKey)) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      probedRedirectKeysRef.current.add(dedupeKey);
      try {
        const ua = resolveEmbyUserAgent(liveServer.userAgent, liveServer.url);
        const streamHeaders = buildEmbyStreamHeaders(liveServer.userId, liveServer.accessToken, {
          userAgent: liveServer.userAgent,
          serverUrl: liveServer.url,
        });
        const resolvedProxy = await resolveMpvProxyDetailed(
          targetStreamUrl,
          proxyOverrideRef.current
        );
        const report = await invoke<StreamDiagnosticReport>('diagnose_stream_url', {
          request: {
            url: targetStreamUrl,
            proxyUrl: (resolvedProxy.rustProxy ?? resolvedProxy.effectiveProxy) || null,
            headers: {
              'User-Agent': ua,
              ...streamHeaders,
            },
          },
        });
        if (cancelled || !report?.hops) return;

        const serverHost = extractHostFromUrl(liveServer.url)?.host;
        const foundRedirectHosts: string[] = [];
        for (const hop of report.hops) {
          for (const candidate of [hop.url, hop.location]) {
            if (!candidate) continue;
            const parsed = extractHostFromUrl(candidate);
            if (
              parsed &&
              parsed.host &&
              parsed.host !== serverHost &&
              !foundRedirectHosts.includes(parsed.host)
            ) {
              foundRedirectHosts.push(parsed.host);
            }
          }
        }
        if (foundRedirectHosts.length > 0) {
          setCurrentRedirectHosts(foundRedirectHosts);
        }
      } catch {
        // 静默探测失败不影响正常播放
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasFirstFrame, currentStreamUrl, mediaSource?.Id, item?.Id]);

  // 响应缓冲时长与内存上限实时变化
  useEffect(() => {
    engineRef.current?.setBufferConfig?.({
      bufferDurationSeconds: playerPreferences.bufferDurationSeconds,
      mediaBitrateBps: effectiveBitrateBps,
      cacheMemoryCapMB: playerPreferences.cacheMemoryCapMB,
    });
  }, [
    playerPreferences.bufferDurationSeconds,
    playerPreferences.cacheMemoryCapMB,
    effectiveBitrateBps,
  ]);

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
      let cancelled = false;
      (async () => {
        try {
          setIsLoadingVideo(true);
          const session = await fetchAndPreparePlaybackSession(
            currentServer,
            itemId,
            engineType
          );
          if (cancelled) return;
          setChapters(session.item.Chapters || []);
          setPlaybackContext(session);
        } catch (err: any) {
          if (cancelled) return;
          setVideoError(err.message || '加载媒体失败');
          setIsLoadingVideo(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [item, currentServer, itemId, engineType, setPlaybackContext]);

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
  nextEpisodeRef.current = nextEpisode;

  // 领域 Hook 4：下一集纯内存预加载与片头跳过缓存调度
  const { nextPreloadStatus, consumePreloadedSession, releaseActivePreload } =
    useNextEpisodePreloader({
      currentServer,
      currentItem: item,
      nextEpisode,
      engineType,
      currentTime,
      duration: effectiveDuration,
      paused,
      isLoadingVideo,
      isBuffering,
      hasFirstFrame,
      videoError,
      telemetry,
      proxyOverride,
      playerPreferences,
      skipSegments,
      skipSettings,
    });

  // 原地无缝切换到其它分集（带 ReqId 竞态防护、防并发双击切集锁，不销毁底层 mpv 实例）
  const switchToEpisode = useCallback(
    async (targetEp: EmbyItem) => {
      if (!currentServer || !targetEp) return;
      if (isSwitchingEpisodeRef.current && switchingTargetIdRef.current === targetEp.Id) {
        return;
      }

      isSwitchingEpisodeRef.current = true;
      switchingTargetIdRef.current = targetEp.Id;
      autoSwitchedItemIdRef.current = targetEp.Id;

      const reqId = ++episodeSwitchReqIdRef.current;
      try {
        setFirstFrameState(false);
        setLoadingState(true);
        updateBuffering(false);
        setStallNotice(null);
        setStallReport(null);
        setVideoError(null);
        videoErrorRef.current = null;
        setActivePanel('none');
        setAutoNextCountdown(null);
        syncBridgePlaybackState();

        // 立刻暂停旧流，防止在拉取 Emby 会话期间继续触发旧流进度或 EOF 事件
        engineRef.current?.pause().catch(() => {});

        // 先使用准确现场进度上报上一集停止
        await reportStoppedNow(lastValidTimeRef.current || currentTime);
        if (reqId !== episodeSwitchReqIdRef.current) return;

        const preloaded = await consumePreloadedSession(targetEp.Id);
        if (reqId !== episodeSwitchReqIdRef.current) return;

        if (preloaded) {
          upstreamStreamUrlRef.current = preloaded.session.streamUrl;
          const targetStart = Math.max(
            preloaded.session.initialTime,
            preloaded.skippedIntro ? preloaded.startSec : 0
          );
          hasInitialSeekedRef.current = targetStart <= 0;
          initialTimeRef.current = targetStart;
          lastValidTimeRef.current = targetStart;
          lastStoreTimeUpdateRef.current = { at: 0, time: targetStart, dur: 0 };
          setChapters(preloaded.session.item.Chapters || []);
          updateTime(targetStart, 0);
          setPlaybackContext({
            ...preloaded.session,
            streamUrl: preloaded.localStreamUrl,
            initialTime: targetStart,
          });
          if (preloaded.localStreamUrl === currentStreamUrl) {
            setReloadToken((t) => t + 1);
          }
          navigate(`/player/${preloaded.session.item.Id}`, { replace: true });
          showMiniHud({
            icon: 'info',
            label: '已命中内存预加载',
            subLabel: preloaded.skippedIntro
              ? `已跳过片头 · 从 ${formatTime(preloaded.startSec)} 秒开`
              : `已预载 ${Math.round(preloaded.status.cachedDurationSec)}s · 秒开就绪`,
          });
          return;
        }

        const session = await fetchAndPreparePlaybackSession(
          currentServer,
          targetEp.Id,
          engineType
        );
        if (reqId !== episodeSwitchReqIdRef.current) return;

        upstreamStreamUrlRef.current = session.streamUrl;
        hasInitialSeekedRef.current = session.initialTime <= 0;
        initialTimeRef.current = session.initialTime;
        lastValidTimeRef.current = session.initialTime;
        lastStoreTimeUpdateRef.current = { at: 0, time: session.initialTime, dur: 0 };
        setChapters(session.item.Chapters || []);
        updateTime(session.initialTime, 0);
        setPlaybackContext(session);
        if (session.streamUrl === currentStreamUrl) {
          setReloadToken((t) => t + 1);
        }
        navigate(`/player/${session.item.Id}`, { replace: true });
      } catch (err: any) {
        if (reqId !== episodeSwitchReqIdRef.current) return;
        isSwitchingEpisodeRef.current = false;
        switchingTargetIdRef.current = null;
        setVideoError(err?.message || '切换剧集失败');
        videoErrorRef.current = err?.message || '切换剧集失败';
        setLoadingState(false);
        syncBridgePlaybackState();
      }
    },
    [
      currentServer,
      currentStreamUrl,
      currentTime,
      engineType,
      navigate,
      reportStoppedNow,
      consumePreloadedSession,
      setPlaybackContext,
      setFirstFrameState,
      setLoadingState,
      showMiniHud,
      syncBridgePlaybackState,
      updateBuffering,
      updateTime,
    ]
  );
  switchToEpisodeRef.current = switchToEpisode;

  // 原地切换多版本片源 (4K / 1080p 原画直连热切，保留播放进度)
  const switchMediaSource = useCallback(
    (ms: EmbyMediaSource) => {
      if (!currentServer || !item || !playSessionId) return;
      if (mediaSource?.Id === ms.Id) return;
      releaseActivePreload();
      const liveSec = lastValidTimeRef.current || engineRef.current?.currentTime || currentTime;
      const sUrl = buildStreamUrlForEngine(
        currentServer.url,
        item.Id,
        ms,
        playSessionId,
        currentServer.accessToken,
        engineType
      );
      upstreamStreamUrlRef.current = sUrl;
      const { audioTracks: aTracks, subtitleTracks: sTracks } = mapStreamTracks(
        currentServer.url,
        item.Id,
        ms,
        currentServer.accessToken
      );

      initialTimeRef.current = liveSec;
      hasInitialSeekedRef.current = liveSec <= 0;
      setFirstFrameState(false);
      setLoadingState(true);
      updateBuffering(false);
      setStallNotice(null);
      setStallReport(null);
      setVideoError(null);
      videoErrorRef.current = null;
      syncBridgePlaybackState();
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
    [
      currentServer,
      item,
      mediaSource?.Id,
      playSessionId,
      availableMediaSources,
      currentTime,
      engineType,
      releaseActivePreload,
      setFirstFrameState,
      setLoadingState,
      setPlaybackContext,
      showMiniHud,
      syncBridgePlaybackState,
      updateBuffering,
    ]
  );

  // 自动连播下一集监听（距片尾 <= 15s 出现提示并在倒计时结束切换）
  useEffect(() => {
    if (
      !nextEpisode ||
      !playerPreferences.autoPlayNext ||
      cancelAutoNext ||
      isSwitchingEpisodeRef.current ||
      isLoadingVideo ||
      isBuffering ||
      videoError ||
      effectiveDuration <= 60
    ) {
      setAutoNextCountdown(null);
      return;
    }

    const remaining = effectiveDuration - currentTime;
    if (remaining <= 15 && currentTime > 10) {
      const triggerNow = shouldTriggerAutoNext(remaining, currentTime);
      const secs = triggerNow ? 0 : Math.max(1, Math.ceil(remaining));
      setAutoNextCountdown(secs);
      if (triggerNow && autoSwitchedItemIdRef.current !== nextEpisode.Id) {
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
    isBuffering,
    videoError,
    effectiveDuration,
    currentTime,
    switchToEpisode,
  ]);

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
          if (fs) setIsOsdVisible(true);
        } catch (e) {
          console.warn(e);
        }
      });

      return () => {
        unlistenPromise.then((unlisten) => unlisten());
        win.setFullscreen(false).catch(() => {});
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
  const applyPlaybackPaused = useCallback(
    (nextPaused: boolean, fromKeyboard = false) => {
      if (isLoadingVideo || videoError) return;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
      syncBridgePlaybackState();

      if (engineRef.current) {
        nextPaused ? engineRef.current.pause() : engineRef.current.play();
      }
      triggerCenterIcon(nextPaused ? 'pause' : 'play');
      if (!fromKeyboard) {
        resetHideTimer();
      }

      const liveTime = lastValidTimeRef.current || usePlayerStore.getState().currentTime;
      reportEventProgress(liveTime, nextPaused, nextPaused ? 'Pause' : 'Unpause');
    },
    [
      isLoadingVideo,
      videoError,
      setPaused,
      syncBridgePlaybackState,
      resetHideTimer,
      reportEventProgress,
    ]
  );

  const handleTogglePlay = (fromKeyboard = false) => {
    applyPlaybackPaused(!usePlayerStore.getState().paused, fromKeyboard);
  };

  const handleExplicitPlay = useCallback(() => {
    applyPlaybackPaused(false, false);
  }, [applyPlaybackPaused]);

  const handleExplicitPause = useCallback(() => {
    applyPlaybackPaused(true, false);
  }, [applyPlaybackPaused]);

  const mediaSessionTitle = item?.Name || 'Nocta · 诺塔';
  const mediaSessionSubtitle = item?.SeriesName
    ? `${item.SeriesName} · 第 ${item.IndexNumber || 1} 集`
    : item?.ProductionYear
    ? String(item.ProductionYear)
    : undefined;

  useMediaSessionController({
    isTauri: isTauriEnvironment(),
    itemId: item?.Id,
    title: mediaSessionTitle,
    subtitle: mediaSessionSubtitle,
    duration: effectiveDuration,
    paused,
    isLoadingVideo,
    hasError: Boolean(videoError),
    getCurrentTime: () => lastValidTimeRef.current || usePlayerStore.getState().currentTime,
    pauseOnHeadphoneDisconnect: playerPreferences.pauseOnHeadphoneDisconnect,
    onPlay: handleExplicitPlay,
    onPause: handleExplicitPause,
    onTogglePlay: () => handleTogglePlay(true),
    onNextEpisode: nextEpisode ? () => switchToEpisode(nextEpisode) : undefined,
    onPrevEpisode: prevEpisode ? () => switchToEpisode(prevEpisode) : undefined,
    showMiniHud,
  });

  const handleSeek = (targetSeconds: number) => {
    const clamped = Math.max(0, effectiveDuration > 0 ? Math.min(effectiveDuration, targetSeconds) : targetSeconds);
    lastValidTimeRef.current = clamped;
    lastStoreTimeUpdateRef.current = {
      at: Date.now(),
      time: clamped,
      dur: lastStoreTimeUpdateRef.current.dur,
    };
    updateTime(clamped);
    bridge.onMpvTimePos(clamped);

    if (engineRef.current) {
      engineRef.current.seek(clamped);
    }

    reportEventProgress(clamped, paused, 'Seek');
  };
  seekRef.current = handleSeek;

  // 轻量无打扰 Seek（显示 Mini HUD 而不弹出整套大控制栏）
  const handleSeekDelta = useCallback(
    (delta: number) => {
      const baseTime = lastValidTimeRef.current ?? usePlayerStore.getState().currentTime;
      const target = Math.max(
        0,
        effectiveDuration > 0 ? Math.min(effectiveDuration, baseTime + delta) : baseTime + delta
      );
      seekRef.current(target);

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
    [effectiveDuration, showMiniHud]
  );
  seekDeltaRef.current = handleSeekDelta;

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

  // 主窗口快捷键与 macOS 全屏浮层命令共用的操作实现
  const handleStepRate = useCallback(
    (direction: 'up' | 'down' | 'reset') => {
      if (direction === 'reset') {
        handleRateChange(1.0, true);
        return;
      }
      if (direction === 'down') {
        const idx = RATE_STEPS.findIndex((r) => r >= playbackRate);
        const next = RATE_STEPS[Math.max(0, (idx === -1 ? RATE_STEPS.length : idx) - 1)];
        handleRateChange(next, true);
        return;
      }
      const idx = RATE_STEPS.findIndex((r) => r > playbackRate);
      const next = idx === -1 ? RATE_STEPS[RATE_STEPS.length - 1] : RATE_STEPS[idx];
      handleRateChange(next, true);
    },
    [playbackRate, handleRateChange]
  );

  const handleFrameStep = useCallback(
    (direction: 'forward' | 'backward') => {
      if (isLoadingVideo || engineType !== 'mpv') return;
      engineRef.current?.frameStep?.(direction);
      showMiniHud({
        icon: direction === 'forward' ? 'seek-forward' : 'seek-backward',
        label: direction === 'forward' ? '下一帧' : '上一帧',
      });
    },
    [isLoadingVideo, engineType, showMiniHud]
  );

  const handleToggleDanmakuWithHud = useCallback(() => {
    const nextVis = !danmakuSettings.visible;
    updateDanmakuSettings({ visible: nextVis });
    showMiniHud({
      icon: 'danmaku',
      label: nextVis ? '弹幕已开启' : '弹幕已关闭',
    });
  }, [danmakuSettings.visible, updateDanmakuSettings, showMiniHud]);

  const handleAdjustDanmakuOffset = useCallback(
    (delta: number) => {
      if (!itemId) return;
      const next = Math.round((savedOffset + delta) * 10) / 10;
      bridge.offset = next;
      setItemOffset(itemId, next);
      showMiniHud({
        icon: 'danmaku',
        label: `弹幕偏移 ${next >= 0 ? `+${next.toFixed(1)}` : next.toFixed(1)}s`,
      });
    },
    [itemId, savedOffset, bridge, setItemOffset, showMiniHud]
  );

  const handleAdjustSubDelay = useCallback(
    (delta: number) => {
      if (engineType !== 'mpv') return;
      const next = Math.round((playerPreferences.subDelay + delta) * 10) / 10;
      updatePlayerPreferences({ subDelay: next });
      showMiniHud({
        icon: 'subtitle',
        label: `字幕延迟 ${next >= 0 ? `+${next.toFixed(1)}` : next.toFixed(1)}s`,
      });
    },
    [engineType, playerPreferences.subDelay, updatePlayerPreferences, showMiniHud]
  );

  const handleCycleSubtitle = useCallback(() => {
    if (subtitleTracks.length === 0) return;
    const idx = selectedSubtitleId
      ? subtitleTracks.findIndex((t) => t.id === selectedSubtitleId)
      : -1;
    const nextTrack = idx + 1 < subtitleTracks.length ? subtitleTracks[idx + 1] : null;
    handleSelectSubtitleTrack(nextTrack ? nextTrack.id : null);
    showMiniHud({
      icon: 'subtitle',
      label: nextTrack ? `字幕: ${nextTrack.title}` : '字幕已关闭',
    });
  }, [subtitleTracks, selectedSubtitleId, showMiniHud]);

  const handleCycleAudio = useCallback(() => {
    if (audioTracks.length <= 1) return;
    const idx = selectedAudioId ? audioTracks.findIndex((t) => t.id === selectedAudioId) : 0;
    const nextTrack = audioTracks[(idx + 1) % audioTracks.length];
    handleSelectAudioTrack(nextTrack.id);
    showMiniHud({
      icon: 'volume',
      label: `音轨: ${nextTrack.title}`,
    });
  }, [audioTracks, selectedAudioId, showMiniHud]);

  // 原地热切流代理路由并保留精确当前进度
  const handleHotReloadStreamWithProxy = useCallback(
    (nextOverride: StreamProxyOverride) => {
      setProxyOverride(nextOverride);
      proxyOverrideRef.current = nextOverride;
      if (!currentStreamUrl || !engineRef.current) return;

      diagReqIdRef.current += 1;
      relayFallbackAttemptedRef.current = false;
      altCandidateFallbackAttemptedRef.current = false;
      stopActiveRelay();
      setDiagnosticReport(null);
      setDiagnosticCopied(false);
      setStallNotice(null);
      setStallReport(null);

      const liveSec = lastValidTimeRef.current || engineRef.current.currentTime || currentTime;
      initialTimeRef.current = liveSec;
      hasInitialSeekedRef.current = liveSec <= 0;
      setFirstFrameState(false);
      setLoadingState(true);
      updateBuffering(false);
      setVideoError(null);
      videoErrorRef.current = null;
      syncBridgePlaybackState();
      if (upstreamStreamUrlRef.current && upstreamStreamUrlRef.current !== currentStreamUrl) {
        releaseActivePreload();
        setCurrentStreamUrl(upstreamStreamUrlRef.current);
      } else {
        setReloadToken((t) => t + 1);
      }
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
    [
      currentStreamUrl,
      currentTime,
      releaseActivePreload,
      setFirstFrameState,
      setLoadingState,
      showMiniHud,
      stopActiveRelay,
      syncBridgePlaybackState,
      updateBuffering,
    ]
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
        resetHideTimer();
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
        resetHideTimer();
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

  // 7. Global Keyboard Shortcuts（支持无打扰 Mini HUD 与长按 → 临时倍速）
  useEffect(() => {
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
        case 'BracketLeft':
          e.preventDefault();
          handleStepRate('down');
          break;
        case 'BracketRight':
          e.preventDefault();
          handleStepRate('up');
          break;
        case 'Backslash':
          e.preventDefault();
          handleStepRate('reset');
          break;
        case 'Period':
          if (!isLoadingVideo && engineType === 'mpv') {
            e.preventDefault();
            handleFrameStep('forward');
          }
          break;
        case 'Comma':
          if (!isLoadingVideo && engineType === 'mpv') {
            e.preventDefault();
            handleFrameStep('backward');
          }
          break;
        case 'KeyD':
          e.preventDefault();
          handleToggleDanmakuWithHud();
          break;
        case 'KeyG':
          e.preventDefault();
          handleAdjustDanmakuOffset(-0.5);
          break;
        case 'KeyH':
          e.preventDefault();
          handleAdjustDanmakuOffset(0.5);
          break;
        case 'KeyZ':
          e.preventDefault();
          handleAdjustSubDelay(-0.5);
          break;
        case 'KeyX':
          e.preventDefault();
          handleAdjustSubDelay(0.5);
          break;
        case 'KeyC':
          e.preventDefault();
          handleCycleSubtitle();
          break;
        case 'KeyA':
          e.preventDefault();
          handleCycleAudio();
          break;
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
          if (e.repeat) break;
          handleToggleFullscreen();
          break;
        case 'KeyI':
          e.preventDefault();
          setActivePanel((prev) => (prev === 'info' ? 'none' : 'info'));
          break;
        case 'Escape':
          if (contextMenu.visible) {
            setContextMenu((prev) => ({ ...prev, visible: false }));
          } else if (isServerUaModalOpen) {
            setIsServerUaModalOpen(false);
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
    paused,
    volume,
    playbackRate,
    playerPreferences.longPressSpeed,
    nextEpisode,
    prevEpisode,
    isFullscreen,
    activePanel,
    isProxyModalOpen,
    isServerUaModalOpen,
    contextMenu.visible,
    isLoadingVideo,
    videoError,
    engineType,
    isPinned,
    handleSeekDelta,
    handleVolumeChange,
    handleRateChange,
    handleStepRate,
    handleFrameStep,
    handleToggleDanmakuWithHud,
    handleAdjustDanmakuOffset,
    handleAdjustSubDelay,
    handleCycleSubtitle,
    handleCycleAudio,
    handleSkipIntro,
    switchToEpisode,
  ]);

  // 零转码原画直连策略下的错误处理
  const handleVideoError = useCallback(
    (errMsg?: string) => {
      console.warn('[Video Error Event] engine:', engineType, 'err:', errMsg);

      setLoadingState(false);
      setFirstFrameState(false);
      updateBuffering(false);
      pausedRef.current = true;
      setPaused(true);

      if (!currentServer || !item || !mediaSource || !playSessionId) {
        const msg = '未获取到媒体播放会话信息';
        videoErrorRef.current = msg;
        setVideoError(msg);
        syncBridgePlaybackState();
        return;
      }

      if (engineType === 'html5') {
        const container = (mediaSource.Container || 'MKV').toUpperCase();
        const videoCodec = (
          mediaSource.MediaStreams?.find((s) => s.Type === 'Video')?.Codec || ''
        ).toUpperCase();
        const msg = `当前片源为 ${container}${videoCodec ? ` (${videoCodec})` : ''} 格式，HTML5 浏览器内核无法直接解码播放。客户端已严格禁止触发 Emby 服务端转码以保护服务器性能。请使用 MPV 原生硬解引擎播放原画。`;
        videoErrorRef.current = msg;
        setVideoError(msg);
        syncBridgePlaybackState();
        return;
      }

      if (errMsg && (errMsg.includes('初始化 libmpv') || errMsg.includes('FFI error'))) {
        videoErrorRef.current = errMsg;
        setVideoError(errMsg);
        syncBridgePlaybackState();
        return;
      }

      const msg = errMsg
        ? `直连媒体流播放中断 (${errMsg})。请检查网络连接或代理配置。`
        : '无法打开该媒体直连流，请检查网络连接、代理路由或重试。';
      videoErrorRef.current = msg;
      setVideoError(msg);
      syncBridgePlaybackState();

      if (isTauriEnvironment()) {
        runStreamDiagnosticRef.current(true);
      }
    },
    [
      currentServer,
      item,
      mediaSource,
      playSessionId,
      engineType,
      setFirstFrameState,
      setLoadingState,
      setPaused,
      syncBridgePlaybackState,
      updateBuffering,
    ]
  );

  useEffect(() => {
    handleVideoErrorRef.current = handleVideoError;
  }, [handleVideoError]);

  // 顶部标题旁画质微标（如 4K · HDR）与代理摘要
  const vStream = mediaSource?.MediaStreams?.find((s) => s.Type === 'Video');
  const specParts: string[] = [];
  if (vStream?.Width && vStream.Width >= 3800) specParts.push('4K');
  else if (vStream?.Width && vStream.Width >= 1900) specParts.push('1080p');
  if (vStream?.VideoRange && vStream.VideoRange !== 'SDR') specParts.push(vStream.VideoRange);
  const videoSpecLabel = specParts.join(' · ') || undefined;

  const proxySummaryLabel =
    proxyInfo?.mode === 'system_http' || proxyInfo?.mode === 'manual_http'
      ? 'HTTP 代理'
      : proxyInfo?.mode === 'socks5_bridge'
      ? 'SOCKS5 隧道代理'
      : proxyInfo?.mode === 'lan_bypass'
      ? '绕过直连'
      : '直连';

  const currentUserAgent = resolveEmbyUserAgent(currentServer?.userAgent, currentServer?.url);

  const fallbackStreamCandidates =
    currentServer && item && mediaSource && playSessionId
      ? resolveEmbyFallbackStreamCandidates(
          currentServer.url,
          item.Id,
          mediaSource,
          playSessionId,
          currentServer.accessToken,
          upstreamStreamUrlRef.current || currentStreamUrl
        )
      : [];
  const directStreamCandidate = fallbackStreamCandidates[0] || null;
  const canRetryDirectStreamCandidate = Boolean(directStreamCandidate);

  const startRelayPlayback = useCallback(
    async (targetUrl?: string): Promise<boolean> => {
      const liveServer = useAuthStore.getState().getCurrentServer();
      const target =
        targetUrl ||
        upstreamStreamUrlRef.current ||
        (currentStreamUrl && !/\/relay\//.test(currentStreamUrl) ? currentStreamUrl : null);
      if (!liveServer || !target || !isTauriEnvironment()) return false;

      const reqId = ++relayStartReqIdRef.current;
      const ua = resolveEmbyUserAgent(liveServer.userAgent, liveServer.url);
      const streamHeaders = buildEmbyStreamHeaders(liveServer.userId, liveServer.accessToken, {
        userAgent: liveServer.userAgent,
        serverUrl: liveServer.url,
      });
      const resolvedProxy = await resolveMpvProxyDetailed(target, proxyOverrideRef.current);
      const started = await invoke<{
        token: string;
        localUrl: string;
      }>('start_stream_relay', {
        request: {
          url: target,
          proxyUrl: (resolvedProxy.rustProxy ?? resolvedProxy.effectiveProxy) || null,
          headers: {
            'User-Agent': ua,
            ...streamHeaders,
          },
        },
      });

      if (
        !isMountedRef.current ||
        reqId !== relayStartReqIdRef.current ||
        hasFirstFrameRef.current
      ) {
        invoke('stop_stream_relay', { token: started.token }).catch(() => {});
        return false;
      }

      const prevToken = activeRelayTokenRef.current;
      if (prevToken && prevToken !== started.token) {
        invoke('stop_stream_relay', { token: prevToken }).catch(() => {});
      }

      activeRelayTokenRef.current = started.token;
      setUsingRelayStream(true);
      setVideoError(null);
      videoErrorRef.current = null;
      setDiagnosticReport(null);
      setDiagnosticCopied(false);
      setStallNotice(null);
      setStallReport(null);
      setFirstFrameState(false);
      setLoadingState(true);
      updateBuffering(false);
      hasInitialSeekedRef.current = false;
      resetOutroForNewStream();
      const resolvedInit = skipInitialIntroOnceRef.current
        ? { seconds: 0, skippedIntro: false }
        : resolveInitialPlaybackTime(initialTimeRef.current);
      initialTimeRef.current = resolvedInit.seconds;
      syncBridgePlaybackState();
      setCurrentStreamUrl(started.localUrl);
      setReloadToken((t) => t + 1);
      return true;
    },
    [
      currentStreamUrl,
      resetOutroForNewStream,
      resolveInitialPlaybackTime,
      setFirstFrameState,
      setLoadingState,
      syncBridgePlaybackState,
      updateBuffering,
    ]
  );

  const handlePlayFromStart = useCallback(() => {
    skipInitialIntroOnceRef.current = true;
    relayFallbackAttemptedRef.current = false;
    stopActiveRelay();
    initialTimeRef.current = 0;
    hasInitialSeekedRef.current = true;
    lastValidTimeRef.current = 0;
    updateTime(0);
    setFirstFrameState(false);
    setLoadingState(true);
    updateBuffering(false);
    setStallNotice(null);
    setStallReport(null);
    setVideoError(null);
    videoErrorRef.current = null;
    syncBridgePlaybackState();
    if (upstreamStreamUrlRef.current && upstreamStreamUrlRef.current !== currentStreamUrl) {
      setCurrentStreamUrl(upstreamStreamUrlRef.current);
    } else {
      setReloadToken((t) => t + 1);
    }
    showMiniHud({
      icon: 'info',
      label: '已重置为从 00:00 重新起播',
    });
  }, [
    currentStreamUrl,
    setFirstFrameState,
    setLoadingState,
    showMiniHud,
    stopActiveRelay,
    syncBridgePlaybackState,
    updateBuffering,
    updateTime,
  ]);

  const runStreamDiagnostic = useCallback(
    async (autoRelayIfReachable: boolean) => {
      const liveServer = useAuthStore.getState().getCurrentServer();
      const target =
        upstreamStreamUrlRef.current ||
        (currentStreamUrl && !/\/relay\//.test(currentStreamUrl) ? currentStreamUrl : null);
      if (!liveServer || !target || !isTauriEnvironment()) return;

      const reqId = ++diagReqIdRef.current;
      setDiagnosingStream(true);
      try {
        const ua = resolveEmbyUserAgent(liveServer.userAgent, liveServer.url);
        const streamHeaders = buildEmbyStreamHeaders(liveServer.userId, liveServer.accessToken, {
          userAgent: liveServer.userAgent,
          serverUrl: liveServer.url,
        });
        const resolvedProxy = await resolveMpvProxyDetailed(target, proxyOverrideRef.current);
        const report = await invoke<StreamDiagnosticReport>('diagnose_stream_url', {
          request: {
            url: target,
            proxyUrl: (resolvedProxy.rustProxy ?? resolvedProxy.effectiveProxy) || null,
            headers: {
              'User-Agent': ua,
              ...streamHeaders,
            },
          },
        });
        if (reqId !== diagReqIdRef.current) return;

        if (autoRelayIfReachable && report.reachable && !relayFallbackAttemptedRef.current) {
          relayFallbackAttemptedRef.current = true;
          try {
            const ok = await startRelayPlayback(target);
            if (ok) {
              showMiniHud({
                icon: 'info',
                label: '直连受限，已自动切换内置中转通道播放',
                subLabel: '如仍失败请查看网络代理设置',
              });
              return;
            }
            if (reqId !== diagReqIdRef.current) return;
          } catch (relayErr) {
            console.warn('[Auto Relay Fallback Failed]', relayErr);
          }
        }

        if (
          !report.reachable &&
          autoRelayIfReachable &&
          !altCandidateFallbackAttemptedRef.current &&
          item &&
          mediaSource &&
          playSessionId
        ) {
          const candidates = resolveEmbyFallbackStreamCandidates(
            liveServer.url,
            item.Id,
            mediaSource,
            playSessionId,
            liveServer.accessToken,
            target
          ).slice(0, 2);

          for (const candidateUrl of candidates) {
            const candidateProxy = await resolveMpvProxyDetailed(
              candidateUrl,
              proxyOverrideRef.current
            );
            const altReport = await invoke<StreamDiagnosticReport>('diagnose_stream_url', {
              request: {
                url: candidateUrl,
                proxyUrl: (candidateProxy.rustProxy ?? candidateProxy.effectiveProxy) || null,
                headers: {
                  'User-Agent': ua,
                  ...streamHeaders,
                },
              },
            });
            if (reqId !== diagReqIdRef.current) return;

            if (altReport.reachable) {
              altCandidateFallbackAttemptedRef.current = true;
              relayFallbackAttemptedRef.current = false;
              stopActiveRelay();
              setDiagnosticReport(null);
              setDiagnosticCopied(false);
              setStallNotice(null);
              setStallReport(null);
              setVideoError(null);
              videoErrorRef.current = null;
              setFirstFrameState(false);
              setLoadingState(true);
              updateBuffering(false);
              hasInitialSeekedRef.current = false;
              resetOutroForNewStream();
              upstreamStreamUrlRef.current = candidateUrl;
              setCurrentStreamUrl(candidateUrl);
              setReloadToken((t) => t + 1);
              syncBridgePlaybackState();
              showMiniHud({
                icon: 'info',
                label: '原直连地址异常，已自动切换备用直连链路',
                subLabel: '已通过服务端重新解析有效直连节点',
              });
              return;
            }
          }
        }

        setDiagnosticReport(report);
      } catch (diagErr) {
        console.warn('[Stream Diagnostic Error]', diagErr);
      } finally {
        if (reqId === diagReqIdRef.current) {
          setDiagnosingStream(false);
        }
      }
    },
    [
      currentStreamUrl,
      item,
      mediaSource,
      playSessionId,
      resetOutroForNewStream,
      setFirstFrameState,
      setLoadingState,
      startRelayPlayback,
      stopActiveRelay,
      showMiniHud,
      syncBridgePlaybackState,
      updateBuffering,
    ]
  );

  useEffect(() => {
    runStreamDiagnosticRef.current = runStreamDiagnostic;
  }, [runStreamDiagnostic]);

  // 8 秒 0 首帧卡滞看门狗：探测链路可用性与 Range 支持，必要时切入内置中转并提供从头播放与诊断日志复制
  useEffect(() => {
    if (
      engineType !== 'mpv' ||
      !isTauriEnvironment() ||
      hasFirstFrame ||
      Boolean(videoError) ||
      (!isLoadingVideo && !isBuffering) ||
      !currentStreamUrl
    ) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const timer = window.setTimeout(async () => {
      if (cancelled || hasFirstFrameRef.current || videoErrorRef.current) return;
      const cacheDur = telemetryRef.current.cacheDuration ?? 0;
      if (cacheDur > 0.1) return;

      const liveServer = useAuthStore.getState().getCurrentServer();
      const target =
        upstreamStreamUrlRef.current ||
        (currentStreamUrl && !/\/relay\//.test(currentStreamUrl) ? currentStreamUrl : null);

      let report: StreamDiagnosticReport | null = null;
      if (liveServer && target) {
        const reqId = ++diagReqIdRef.current;
        try {
          const ua = resolveEmbyUserAgent(liveServer.userAgent, liveServer.url);
          const streamHeaders = buildEmbyStreamHeaders(liveServer.userId, liveServer.accessToken, {
            userAgent: liveServer.userAgent,
            serverUrl: liveServer.url,
          });
          const resolvedProxy = await resolveMpvProxyDetailed(target, proxyOverrideRef.current);
          const probed = await invoke<StreamDiagnosticReport>('diagnose_stream_url', {
            request: {
              url: target,
              proxyUrl: (resolvedProxy.rustProxy ?? resolvedProxy.effectiveProxy) || null,
              headers: {
                'User-Agent': ua,
                ...streamHeaders,
              },
            },
          });
          if (cancelled || reqId !== diagReqIdRef.current || hasFirstFrameRef.current) return;
          report = probed;

          const serverHost = extractHostFromUrl(liveServer.url)?.host;
          const foundRedirectHosts: string[] = [];
          for (const hop of probed.hops || []) {
            for (const candidate of [hop.url, hop.location]) {
              if (!candidate) continue;
              const parsed = extractHostFromUrl(candidate);
              if (
                parsed &&
                parsed.host &&
                parsed.host !== serverHost &&
                !foundRedirectHosts.includes(parsed.host)
              ) {
                foundRedirectHosts.push(parsed.host);
              }
            }
          }
          if (foundRedirectHosts.length > 0) {
            setCurrentRedirectHosts(foundRedirectHosts);
          }
        } catch {
          // 忽略探测异常，继续后续降级判定
        }
      }

      if (cancelled || hasFirstFrameRef.current || videoErrorRef.current) return;

      const action = decideStallRecoveryAction({
        elapsedMs: Date.now() - startedAt,
        hasFirstFrame: hasFirstFrameRef.current,
        cacheDuration: telemetryRef.current.cacheDuration ?? 0,
        isMpv: true,
        hasError: Boolean(videoErrorRef.current),
        usingRelay: usingRelayStream,
        relayAlreadyAttempted: relayFallbackAttemptedRef.current,
        diagnosticReachable: report?.reachable,
        diagnosticFinalStatus: report?.finalStatus ?? null,
        midRangeSupported: report?.midRangeSupported ?? null,
        targetInitialTime: initialTimeRef.current,
      });

      if (action === 'try_relay' && target) {
        relayFallbackAttemptedRef.current = true;
        try {
          const ok = await startRelayPlayback(target);
          if (ok) return;
        } catch (relayErr) {
          console.warn('[Stall Watchdog Relay Failed]', relayErr);
        }
      }

      if (cancelled || hasFirstFrameRef.current || videoErrorRef.current) return;

      if (report) {
        setDiagnosticReport(report);
        setStallReport(report);
      }

      if (action === 'show_non_range_prompt') {
        setStallNotice('当前线路不支持分段续播，建议从 00:00 重新播放。');
      } else if (action === 'show_manual_prompt' || action === 'try_relay') {
        setStallNotice(
          initialTimeRef.current > 15
            ? '加载耗时较长，可尝试从 00:00 重新播放或复制诊断日志。'
            : '加载耗时较长，可尝试重新加载或复制诊断日志。'
        );
      }
    }, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    engineType,
    hasFirstFrame,
    videoError,
    isLoadingVideo,
    isBuffering,
    currentStreamUrl,
    reloadToken,
    usingRelayStream,
    startRelayPlayback,
  ]);

  const handleRetryDirect = (overrideMode?: StreamProxyOverride) => {
    if (!currentServer || !item || !mediaSource || !playSessionId) return;
    if (overrideMode) {
      setProxyOverride(overrideMode);
      proxyOverrideRef.current = overrideMode;
    }
    diagReqIdRef.current += 1;
    relayFallbackAttemptedRef.current = false;
    altCandidateFallbackAttemptedRef.current = false;
    stopActiveRelay();
    setDiagnosticReport(null);
    setDiagnosticCopied(false);
    setStallNotice(null);
    setStallReport(null);
    setFirstFrameState(false);
    setLoadingState(true);
    updateBuffering(false);
    setVideoError(null);
    videoErrorRef.current = null;
    hasInitialSeekedRef.current = false;
    resetOutroForNewStream();
    syncBridgePlaybackState();
    const resolved = skipInitialIntroOnceRef.current
      ? { seconds: 0, skippedIntro: false }
      : resolveInitialPlaybackTime(initialTimeRef.current);
    initialTimeRef.current = resolved.seconds;
    const directUrl = buildStreamUrlForEngine(
      currentServer.url,
      item.Id,
      mediaSource,
      playSessionId,
      currentServer.accessToken,
      engineType
    );
    upstreamStreamUrlRef.current = directUrl;
    setCurrentStreamUrl(directUrl);
    setReloadToken((t) => t + 1);
  };

  const handleRetryWithUrl = (targetUrl: string) => {
    diagReqIdRef.current += 1;
    relayFallbackAttemptedRef.current = false;
    altCandidateFallbackAttemptedRef.current = false;
    stopActiveRelay();
    setDiagnosticReport(null);
    setDiagnosticCopied(false);
    setStallNotice(null);
    setStallReport(null);
    setFirstFrameState(false);
    setLoadingState(true);
    updateBuffering(false);
    setVideoError(null);
    videoErrorRef.current = null;
    hasInitialSeekedRef.current = false;
    resetOutroForNewStream();
    syncBridgePlaybackState();
    upstreamStreamUrlRef.current = targetUrl;
    setCurrentStreamUrl(targetUrl);
    setReloadToken((t) => t + 1);
  };

  const renegotiateAndRetryPlayback = async () => {
    const liveServer = useAuthStore.getState().getCurrentServer();
    if (!liveServer || !item) {
      handleRetryDirect();
      return;
    }
    diagReqIdRef.current += 1;
    relayFallbackAttemptedRef.current = false;
    altCandidateFallbackAttemptedRef.current = false;
    stopActiveRelay();
    setDiagnosticReport(null);
    setDiagnosticCopied(false);
    setStallNotice(null);
    setStallReport(null);
    setVideoError(null);
    videoErrorRef.current = null;
    setFirstFrameState(false);
    setLoadingState(true);
    updateBuffering(false);
    hasInitialSeekedRef.current = false;
    resetOutroForNewStream();
    syncBridgePlaybackState();

    try {
      const session = await fetchAndPreparePlaybackSession(
        liveServer,
        item.Id,
        engineType,
        item
      );
      const preserveSec = Math.max(
        0,
        lastValidTimeRef.current || initialTimeRef.current || session.initialTime || 0
      );
      upstreamStreamUrlRef.current = session.streamUrl;
      initialTimeRef.current = preserveSec;
      hasInitialSeekedRef.current = preserveSec <= 0;
      setChapters(session.item.Chapters || []);
      setPlaybackContext({
        ...session,
        initialTime: preserveSec,
      });
      setCurrentStreamUrl(session.streamUrl);
      setReloadToken((t) => t + 1);
    } catch (err) {
      console.warn('[Renegotiate PlaybackInfo Failed, falling back to retry]', err);
      handleRetryDirect();
    }
  };

  const handleQuickSwitchUa = async (nextUa: string) => {
    if (!currentServer) return;
    const normalized = nextUa.trim() || undefined;
    useAuthStore.getState().updateServer(currentServer.id, { userAgent: normalized });
    await renegotiateAndRetryPlayback();
  };

  const handleCopyDiagnostic = async () => {
    const activeReport = diagnosticReport || stallReport;
    const lines = [
      `【Nocta 媒体流错误诊断】`,
      `错误描述: ${videoError || stallNotice || '-'}`,
      `播放内核: ${engineType} (${usingRelayStream ? '内置透明中转' : '直连'} · demuxer=${telemetry.currentDemuxer || 'auto'})`,
      `服务器: ${currentServer?.name || '-'} (${currentServer?.url || '-'})`,
      `代理路线: ${proxyInfo?.configuredProxy || proxyInfo?.effectiveProxy || proxySummaryLabel}`,
      `User-Agent: ${activeReport?.userAgent || currentUserAgent}`,
      `媒体源 Container: ${mediaSource?.Container || '-'} · IsRemote: ${String(Boolean(mediaSource?.IsRemote))}`,
      `DirectStreamUrl: ${redactUrlForReport(mediaSource?.DirectStreamUrl)}`,
      `探测结论: ${activeReport?.summary || (diagnosingStream ? '探测中' : '未探测')}`,
      `中段 Range: midRangeSupported=${String(activeReport?.midRangeSupported ?? 'unknown')} · isMkv=${String(Boolean(activeReport?.isMkv))}`,
      `MPV 遥测快照: state=${engineRef.current?.state || '-'} · vo=${String(telemetry.voConfigured ?? '-')} · seekable=${String(telemetry.seekable ?? '-')} · partial=${String(telemetry.partiallySeekable ?? '-')} · seeking=${String(telemetry.isSeeking ?? '-')} · cacheDur=${(telemetry.cacheDuration ?? 0).toFixed(2)}s · streamPos=${telemetry.streamPos ?? 0} · initialTime=${Math.floor(initialTimeRef.current)}s`,
      ...(activeReport?.hops || []).map((hop) =>
        [
          `[Hop ${hop.hop}] status=${hop.status ?? 'ERR'} ${hop.statusText || ''}`.trim(),
          `  url=${hop.url}`,
          hop.location ? `  location=${hop.location}` : null,
          hop.server ? `  server=${hop.server}` : null,
          hop.cfRay || hop.cfMitigated
            ? `  cf-ray=${hop.cfRay || '-'} cf-mitigated=${hop.cfMitigated || '-'}`
            : null,
          hop.contentType ? `  content-type=${hop.contentType}` : null,
          hop.contentRange ? `  content-range=${hop.contentRange}` : null,
          hop.acceptRanges ? `  accept-ranges=${hop.acceptRanges}` : null,
          hop.error ? `  error=${hop.error}` : null,
          hop.bodySnippet ? `  body=${hop.bodySnippet}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      ),
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setDiagnosticCopied(true);
      window.setTimeout(() => setDiagnosticCopied(false), 2000);
    } catch (e) {
      console.warn('复制诊断日志失败', e);
    }
  };

  const handleSwitchToMpv = () => {
    setVideoError(null);
    videoErrorRef.current = null;
    setFirstFrameState(false);
    setLoadingState(true);
    updateBuffering(false);
    setStallNotice(null);
    setStallReport(null);
    hasInitialSeekedRef.current = false;
    syncBridgePlaybackState();
    setEngineType('mpv');
  };

  // macOS 原生全屏时，mpv 窗口会盖住 WebView；改用独立透明浮层承载 OSD 与弹幕。
  // 其他平台与窗口模式完全沿用原有单窗口渲染路径。
  const canUseMacOsdOverlay = isTauriEnvironment() && IS_MACOS && engineType === 'mpv';

  const livePlayerState = usePlayerStore.getState();
  const osdSyncPayload: OsdSyncPayload | null = item
    ? {
        title: item.Name,
        subtitle: item.SeriesName
          ? `${item.SeriesName} · 第 ${item.IndexNumber || 1} 集`
          : undefined,
        paused,
        currentTime,
        duration: effectiveDuration,
        volume,
        playbackRate,
        networkSpeed,
        engineType,
        videoSpecLabel,
        telemetry,
        proxyInfo,
        chapters,
        danmakuHeatmap,
        showHeatmap: danmakuSettings.showHeatmap,
        showRemainingTime: playerPreferences.showRemainingTime,
        abLoopA,
        abLoopB,
        longPressSpeed: playerPreferences.longPressSpeed,
        miniHud: miniHud
          ? {
              id: miniHud.id,
              icon: miniHud.icon,
              label: miniHud.label,
              subLabel: miniHud.subLabel,
              progress: miniHud.progress,
              progressWarn: miniHud.progressWarn,
            }
          : null,
        fastForwardRate,
        centerIcon,
        danmakuVisible: danmakuSettings.visible,
        danmakuCount: rawComments.length,
        danmakuOffset: savedOffset,
        matchedTitle,
        audioTracks,
        subtitleTracks,
        selectedAudioId,
        selectedSubtitleId,
        selectedSecondarySubtitleId,
        danmakuStyle: {
          speed: danmakuSettings.speed,
          opacity: danmakuSettings.opacity,
          area: danmakuSettings.area,
          maxLines: danmakuSettings.maxLines,
          bottomMargin: danmakuSettings.bottomMargin,
        },
        isLoading: isLoadingVideo,
        isBuffering,
        hasFirstFrame,
        skipSegments: currentSkipSegments || null,
        outroToast: {
          visible: Boolean(outroToast),
          remainingMs: outroRemainingMs,
          totalMs: OUTRO_TOAST_MS,
        },
        skipNotice,
        skipOutroAction: skipSettings.skipOutroAction,
        item,
        mediaSource,
        availableMediaSources,
        streamUrl: upstreamStreamUrlRef.current || currentStreamUrl || streamUrl,
        currentServerName: currentServer?.name,
        currentServerUrl: currentServer?.url,
        userAgent: currentUserAgent,
        seasons,
        selectedSeasonId,
        episodes,
        episodesLoading,
        hasNextEpisode: !!nextEpisode,
        hasPrevEpisode: !!prevEpisode,
        nextEpisode,
        nextPreloadStatus,
        showSkipIntro,
        autoNextCountdown,
        speedHistory,
        proxyOverride,
        proxySummaryLabel,
        layoutKey,
        videoAspectRatio,
        isWidescreen,
        sourceDuration,
        danmuToast,
        durationAlert,
        resolvedTheme,
        storeSnapshot: {
          revision: storeRevisionRef.current,
          danmakuSettings,
          playerPreferences,
          videoLayouts,
          itemOffsets: livePlayerState.itemOffsets,
          seriesOffsets: livePlayerState.seriesOffsets,
          danmakuBindings: livePlayerState.danmakuBindings,
          seriesDanmakuBindings: livePlayerState.seriesDanmakuBindings,
          skipSegments: livePlayerState.skipSegments,
          skipSettings,
          engineType,
        },
      }
    : null;

  const instantSyncKey = [
    paused,
    danmakuSettings.visible,
    savedOffset,
    playbackRate,
    volume,
    selectedAudioId,
    selectedSubtitleId,
    selectedSecondarySubtitleId,
    isLoadingVideo,
    isBuffering,
    hasFirstFrame,
    videoSpecLabel,
    miniHud?.id ?? 0,
    fastForwardRate ?? '',
    centerIcon ?? '',
    outroToast?.deadline ?? 0,
    skipNotice ?? '',
    currentSkipSegments?.introEnd ?? '',
    currentSkipSegments?.outroStart ?? '',
    currentSkipSegments?.outroOffsetFromEnd ?? '',
    danmuToast ?? '',
    durationAlert ?? '',
    autoNextCountdown ?? '',
    showSkipIntro,
    abLoopA ?? '',
    abLoopB ?? '',
    proxyOverride,
    currentUserAgent,
    selectedSeasonId ?? '',
    episodes.length,
    mediaSource?.Id ?? '',
    item?.Id ?? '',
    nextPreloadStatus?.token ?? '',
    nextPreloadStatus?.status ?? '',
    Math.floor(nextPreloadStatus?.cachedDurationSec ?? 0),
    resolvedTheme,
    storeRevisionRef.current,
  ].join('|');

  const handleOsdCommand = (cmd: OsdCommand) => {
    switch (cmd.type) {
      case 'toggle-play':
        handleTogglePlay();
        break;
      case 'seek':
        handleSeek(cmd.seconds);
        break;
      case 'seek-delta':
        handleSeekDelta(cmd.delta);
        break;
      case 'volume':
        handleVolumeChange(cmd.volume);
        break;
      case 'volume-delta':
        handleVolumeChange(volume + cmd.delta, true);
        break;
      case 'toggle-mute':
        handleVolumeChange(volume > 0 ? 0 : 100, true);
        break;
      case 'rate':
        handleRateChange(cmd.rate);
        break;
      case 'rate-step':
        handleStepRate(cmd.direction);
        break;
      case 'rate-temp':
        if (cmd.rate !== null) {
          if (preOverlayTempRateRef.current === null) {
            preOverlayTempRateRef.current = playbackRate;
          }
          setFastForwardRate(cmd.rate);
          handleRateChange(cmd.rate, false);
        } else {
          setFastForwardRate(null);
          if (preOverlayTempRateRef.current !== null) {
            const restore = preOverlayTempRateRef.current;
            preOverlayTempRateRef.current = null;
            handleRateChange(restore, false);
          }
        }
        break;
      case 'frame-step':
        handleFrameStep(cmd.direction);
        break;
      case 'toggle-danmaku':
        handleToggleDanmakuWithHud();
        break;
      case 'danmaku-offset-delta':
        handleAdjustDanmakuOffset(cmd.delta);
        break;
      case 'sub-delay-delta':
        handleAdjustSubDelay(cmd.delta);
        break;
      case 'toggle-fullscreen':
        handleToggleFullscreen();
        break;
      case 'toggle-window-mode':
        handleToggleWindowMode();
        break;
      case 'back':
        handleBack();
        break;
      case 'home':
        handleHome();
        break;
      case 'select-audio':
        handleSelectAudioTrack(cmd.id);
        break;
      case 'cycle-audio':
        handleCycleAudio();
        break;
      case 'select-subtitle':
        handleSelectSubtitleTrack(cmd.id);
        break;
      case 'cycle-subtitle':
        handleCycleSubtitle();
        break;
      case 'select-secondary-subtitle':
        handleSelectSecondarySubtitleTrack(cmd.id);
        break;
      case 'mark-intro-end':
        handleMarkIntroEnd(cmd.seconds);
        break;
      case 'mark-outro-start':
        handleMarkOutroStart(cmd.seconds);
        break;
      case 'clear-skip':
        handleClearSkipSegment(cmd.field);
        break;
      case 'skip-intro':
        handleSkipIntro();
        break;
      case 'skip-outro':
        handleSkipOutro();
        break;
      case 'cancel-outro':
        handleCancelOutro();
        break;
      case 'screenshot':
        handleTakeScreenshot();
        break;
      case 'toggle-remaining-time':
        updatePlayerPreferences({ showRemainingTime: !playerPreferences.showRemainingTime });
        break;
      case 'set-ab-loop':
        handleSetAbLoop(cmd.point);
        break;
      case 'sync-player-store':
        applyingOverlayPatchRef.current = true;
        try {
          usePlayerStore.getState().applyRemoteStoreSnapshot(cmd.patch, true);
        } finally {
          applyingOverlayPatchRef.current = false;
        }
        break;
      case 'sync-danmu-store':
        useDanmuStore.getState().syncServersFromRemote(cmd.servers, cmd.activeServerId, true);
        break;
      case 'sync-proxy-config':
        useAuthStore.getState().updateGlobalProxyConfig(cmd.config);
        handleHotReloadStreamWithProxy(proxyOverride);
        break;
      case 'comments-loaded':
        handleCommentsLoaded(cmd.comments, cmd.sourceDuration, cmd.meta);
        break;
      case 're-auto-match':
        triggerDanmakuLoad(true);
        break;
      case 'dismiss-duration-alert':
        setDurationAlert(null);
        break;
      case 'select-season':
        handleSelectSeasonInDrawer(cmd.seasonId);
        break;
      case 'select-episode': {
        const ep = episodes.find((e) => e.Id === cmd.episodeId);
        if (ep) switchToEpisode(ep);
        break;
      }
      case 'next-episode':
        if (nextEpisode) switchToEpisode(nextEpisode);
        break;
      case 'prev-episode':
        if (prevEpisode) switchToEpisode(prevEpisode);
        break;
      case 'cancel-auto-next':
        setCancelAutoNext(true);
        setAutoNextCountdown(null);
        break;
      case 'select-media-source': {
        const ms = availableMediaSources.find((m) => m.Id === cmd.mediaSourceId);
        if (ms) switchMediaSource(ms);
        break;
      }
      case 'change-proxy-override':
        handleHotReloadStreamWithProxy(cmd.mode);
        break;
      case 'reload-stream':
        handleHotReloadStreamWithProxy(proxyOverride);
        break;
      case 'toggle-bottom-align':
        if (layoutKey) {
          setVideoLayout(layoutKey, { bottomAlign: !currentLayout.bottomAlign });
        }
        break;
      case 'cycle-aspect': {
        const order: VideoAspectPreset[] = ['auto', '16:9', '21:9', '4:3', 'fill'];
        const next = order[(order.indexOf(playerPreferences.videoAspect) + 1) % order.length];
        updatePlayerPreferences({ videoAspect: next });
        break;
      }
    }
  };

  // 领域 Hook 4：macOS 全屏独立透明浮层双窗口双向同步
  const { osdOverlayActive } = useMacOsdOverlaySync({
    canUseMacOsdOverlay,
    isFullscreen,
    videoError,
    syncPayload: osdSyncPayload,
    instantSyncKey,
    liveTimeRef: lastValidTimeRef,
    formattedComments,
    rawComments,
    onCommand: handleOsdCommand,
  });

  if (!item) {
    return (
      <div className="nocta-player-scope w-full h-full min-h-screen bg-[#F5F5F7] dark:bg-[#0A0A0C] flex flex-col items-center justify-center space-y-4 text-[#48484A] dark:text-white/75">
        <div className="w-8 h-8 border-2 border-[#1D1D1F] dark:border-white border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">正在加载媒体信息...</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-black/[0.06] hover:bg-black/[0.12] text-[#1D1D1F] dark:bg-white/10 dark:hover:bg-white/20 dark:text-white rounded-xl text-xs transition cursor-pointer"
        >
          返回首页
        </button>
      </div>
    );
  }

  const backdropUrl = currentServer
    ? resolveItemBackdropUrl(currentServer.url, item, {
        maxWidth: 1920,
        quality: 75,
        mode: 'hero',
        allowPrimaryFallback: true,
      })
    : '';

  return (
    <div
      onWheel={handleVideoWheel}
      onContextMenu={handleContextMenu}
      className="nocta-player-scope relative w-screen h-screen overflow-hidden select-none bg-transparent"
    >
      {/* 屏幕中央播放/暂停瞬时动效徽标 */}
      {centerIcon && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
          <div className="p-5 rounded-full bg-white/[0.92] dark:bg-[#141416]/[0.88] text-[#1D1D1F] dark:text-white border border-black/[0.12] dark:border-white/[0.14] animate-in zoom-in-75 fade-in duration-150">
            {centerIcon === 'play' ? (
              <Play className="w-9 h-9 fill-current translate-x-0.5" />
            ) : (
              <Pause className="w-9 h-9 fill-current" />
            )}
          </div>
        </div>
      )}

      {/* 无打扰 Mini HUD & 长按倍速顶部胶囊 */}
      {!osdOverlayActive && (
        <MiniActionHud hud={miniHud} fastForwardRate={fastForwardRate} />
      )}

      {/* 播放中卡顿/缓冲时仅显示当前加载网速，不遮挡画面 */}
      <BufferingIndicator
        visible={isBuffering && !isLoadingVideo && !videoError && !osdOverlayActive && !centerIcon}
        networkSpeed={networkSpeed}
      />

      {/* 底层：原生视频表面穿透层与交互层 */}
      <div
        ref={containerRef}
        className="absolute inset-0 z-0 cursor-pointer overflow-hidden bg-transparent"
        onClick={handleVideoClick}
        onDoubleClick={handleVideoDoubleClick}
      />

      {/* Loading Overlay */}
      {isLoadingVideo && !videoError && (
        <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center bg-[#F5F5F7]/[0.94] dark:bg-[#0A0A0C]/[0.94] pointer-events-auto px-4">
          {backdropUrl && (
            <img
              key={backdropUrl}
              src={backdropUrl}
              alt={item.SeriesName || item.Name}
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.fallbackStep) {
                  const noWebp = stripImageFormatWebp(target.src);
                  if (noWebp) {
                    target.dataset.fallbackStep = '1';
                    target.src = noWebp;
                    return;
                  }
                }
                target.dataset.fallbackStep = 'done';
                target.style.display = 'none';
              }}
              className="absolute inset-0 w-full h-full object-cover filter blur-2xl opacity-15 dark:opacity-25"
            />
          )}
          <div className="relative z-10 flex flex-col items-center space-y-4 max-w-md w-full pt-16 pb-32 max-h-full overflow-y-auto">
            <div className="w-12 h-12 border-[3px] border-[#1D1D1F] dark:border-white border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="text-center space-y-1.5">
              <h2 className="text-base font-bold text-[#1D1D1F] dark:text-white tracking-wide">{item.Name}</h2>
              <p className="text-xs text-[#6E6E73] dark:text-white/65">
                {engineType === 'mpv'
                  ? '正在通过 MPV 硬解引擎直连原画 (0 转码)...'
                  : '正在通过 HTML5 引擎直连原画 (0 转码)...'}
              </p>
              {proxyInfo && (
                <p className="text-[11px] text-[#48484A] dark:text-white/75 font-mono">
                  网络路线: {proxyInfo.configuredProxy || proxyInfo.effectiveProxy ? `代理 ${proxyInfo.configuredProxy || proxyInfo.effectiveProxy}` : proxySummaryLabel}
                </p>
              )}
              <p className="text-[11px] text-[#047857] dark:text-emerald-300/90 font-mono tabular-nums">
                实时网速: {formatNetworkSpeed(networkSpeed)}
              </p>
            </div>

            {stallNotice && (
              <div className="w-full rounded-2xl bg-white/[0.95] dark:bg-[#141416]/[0.94] border border-black/[0.12] dark:border-white/[0.14] p-3.5 space-y-2.5 text-left">
                <div className="text-xs font-medium text-[#B45309] dark:text-amber-300 leading-relaxed">
                  {stallNotice}
                </div>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {initialTimeRef.current > 15 ? (
                    <button
                      onClick={handlePlayFromStart}
                      className="px-3 py-1.5 rounded-lg bg-[#1D1D1F] hover:bg-black text-white dark:bg-white dark:hover:bg-white/90 dark:text-[#1D1D1F] text-xs font-semibold transition cursor-pointer"
                    >
                      从 00:00 重新播放
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRetryDirect()}
                      className="px-3 py-1.5 rounded-lg bg-[#1D1D1F] hover:bg-black text-white dark:bg-white dark:hover:bg-white/90 dark:text-[#1D1D1F] text-xs font-semibold transition cursor-pointer"
                    >
                      重新加载
                    </button>
                  )}
                  <button
                    onClick={handleCopyDiagnostic}
                    className="px-3 py-1.5 rounded-lg bg-black/[0.05] hover:bg-black/[0.10] border border-black/[0.08] text-[#48484A] dark:bg-white/5 dark:hover:bg-white/15 dark:border-white/10 dark:text-white/80 text-xs transition cursor-pointer"
                  >
                    {diagnosticCopied ? '已复制诊断日志' : '复制诊断日志'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleBack}
              className="mt-2 px-4 py-2 bg-black/[0.06] hover:bg-black/[0.12] text-[#1D1D1F] dark:bg-white/10 dark:hover:bg-white/20 dark:text-white rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回详情页</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Overlay (增强：显示当前代理路线 + 自动逐跳诊断 + 内置中转救援 + 切换 UA) */}
      {videoError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#F5F5F7]/[0.95] dark:bg-[#0A0A0C]/[0.95] p-4 sm:p-6 pointer-events-auto">
          <div className="max-w-lg w-full max-h-[88vh] overflow-y-auto custom-scrollbar bg-white dark:bg-[#161618] border border-rose-500/25 dark:border-red-500/30 rounded-2xl p-5 sm:p-6 space-y-3.5 text-center">
            <div className="w-11 h-11 mx-auto rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">视频无法播放</h3>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{videoError}</p>
            </div>

            {(proxyInfo || engineType === 'mpv') && (
              <div className="p-2.5 rounded-xl bg-black/30 border border-white/10 text-[11px] text-slate-300 font-mono space-y-1 text-left">
                {proxyInfo && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <Wifi className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="truncate">
                        当前路线: {proxyInfo.configuredProxy || proxyInfo.effectiveProxy || proxySummaryLabel}
                      </span>
                    </div>
                    {usingRelayStream && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px] shrink-0 font-sans">
                        内置中转
                      </span>
                    )}
                  </div>
                )}
                {engineType === 'mpv' && (
                  <div className="truncate text-slate-400" title={currentUserAgent}>
                    User-Agent: <span className="text-slate-200">{currentUserAgent}</span>
                  </div>
                )}
              </div>
            )}

            {engineType === 'mpv' && isTauriEnvironment() && (diagnosingStream || diagnosticReport) && (
              <div className="p-2.5 rounded-xl bg-black/35 border border-white/10 space-y-2 text-left text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">
                    {diagnosingStream ? '正在自动逐跳诊断媒体流链路...' : '链路逐跳诊断结果'}
                  </span>
                  <div className="flex items-center space-x-2 shrink-0">
                    {!diagnosingStream && (
                      <button
                        type="button"
                        onClick={() => runStreamDiagnostic(false)}
                        className="text-sky-400 hover:text-sky-300 transition cursor-pointer"
                      >
                        重新诊断
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCopyDiagnostic}
                      className="flex items-center space-x-1 text-slate-300 hover:text-white transition cursor-pointer"
                    >
                      {diagnosticCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>复制日志</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {diagnosingStream && !diagnosticReport && (
                  <div className="flex items-center space-x-2 text-slate-400">
                    <div className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    <span>正在探测 HTTP 状态码与 302 重定向目标...</span>
                  </div>
                )}

                {diagnosticReport && (
                  <>
                    <p
                      className={`leading-relaxed ${
                        diagnosticReport.reachable ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {diagnosticReport.summary}
                    </p>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar font-mono text-[10px]">
                      {diagnosticReport.hops.map((hop) => (
                        <div
                          key={hop.hop}
                          className="p-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-semibold ${
                                hop.status && hop.status >= 200 && hop.status < 300
                                  ? 'text-emerald-400'
                                  : hop.status && hop.status >= 300 && hop.status < 400
                                  ? 'text-sky-400'
                                  : 'text-red-400'
                              }`}
                            >
                              Hop {hop.hop}: {hop.status ? `HTTP ${hop.status} ${hop.statusText || ''}` : '请求失败'}
                            </span>
                            {(hop.cfMitigated || hop.cfRay || hop.server) && (
                              <span className="text-slate-500 truncate">
                                {[
                                  hop.server,
                                  hop.cfMitigated ? `cf-mitigated=${hop.cfMitigated}` : null,
                                  hop.cfRay ? `ray=${hop.cfRay}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </div>
                          <div className="text-slate-400 truncate" title={hop.url}>
                            {hop.url}
                          </div>
                          {hop.location && (
                            <div className="text-sky-300/90 truncate" title={hop.location}>
                              → {hop.location}
                            </div>
                          )}
                          {hop.contentType && (
                            <div className="text-slate-400 truncate">
                              Content-Type: {hop.contentType}
                              {hop.contentRange ? ` · ${hop.contentRange}` : ''}
                            </div>
                          )}
                          {hop.error && <div className="text-red-300 break-all">{hop.error}</div>}
                          {hop.bodySnippet && (
                            <div className="text-amber-200/80 break-all line-clamp-2">
                              {hop.bodySnippet}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {engineType === 'mpv' && currentServer && (
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-2 text-left">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>切换客户端 / User-Agent 重试</span>
                  <button
                    type="button"
                    onClick={() => setIsServerUaModalOpen(true)}
                    className="text-sky-400 hover:text-sky-300 transition cursor-pointer"
                  >
                    自定义
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EMBY_USER_AGENT_PRESETS.map((preset) => {
                    const isSelected = (currentServer.userAgent || '').trim() === preset.value;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleQuickSwitchUa(preset.value)}
                        title={preset.value || DEFAULT_EMBY_USER_AGENT}
                        className={`px-2 py-1 rounded-lg text-[11px] border transition cursor-pointer ${
                          isSelected
                            ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-1 flex flex-col gap-2">
              {engineType === 'html5' ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleSwitchToMpv}
                    className="flex-1 py-2.5 bg-[#1D1D1F] hover:bg-black text-white dark:bg-white dark:hover:bg-white/90 dark:text-[#1D1D1F] rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>一键切换至 MPV 硬解</span>
                  </button>
                  <button
                    onClick={() => handleRetryDirect()}
                    className="py-2.5 px-4 bg-black/[0.06] hover:bg-black/[0.12] text-[#1D1D1F] dark:bg-white/10 dark:hover:bg-white/20 dark:text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>重试</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleRetryDirect()}
                      className="py-2.5 bg-[#1D1D1F] hover:bg-black text-white dark:bg-white dark:hover:bg-white/90 dark:text-[#1D1D1F] rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
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

                  {((diagnosticReport?.reachable && !usingRelayStream) || canRetryDirectStreamCandidate) && (
                    <div className="flex flex-wrap gap-2">
                      {diagnosticReport?.reachable && !usingRelayStream && (
                        <button
                          type="button"
                          onClick={() => startRelayPlayback()}
                          className="flex-1 py-2 px-3 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>使用内置中转播放</span>
                        </button>
                      )}
                      {canRetryDirectStreamCandidate && directStreamCandidate && (
                        <button
                          type="button"
                          onClick={() => handleRetryWithUrl(directStreamCandidate)}
                          className="flex-1 py-2 px-3 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>改用备用直连链路重试</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
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
        visible={danmakuSettings.visible && !osdOverlayActive}
        speed={danmakuSettings.speed}
        opacity={danmakuSettings.opacity}
        area={danmakuSettings.area}
        maxLines={danmakuSettings.maxLines}
        bottomMargin={danmakuSettings.bottomMargin}
      />

      {/* 跳过片头胶囊 & 下一集自动连播倒计时浮窗 */}
      {!osdOverlayActive && (
        <UpNextOverlay
          showSkipIntro={showSkipIntro}
          onSkipIntro={handleSkipIntro}
          nextEpisode={nextEpisode}
          serverUrl={currentServer?.url}
          countdownSeconds={outroToast ? null : autoNextCountdown}
          onPlayNextNow={() => nextEpisode && switchToEpisode(nextEpisode)}
          onCancelAutoNext={() => {
            setCancelAutoNext(true);
            setAutoNextCountdown(null);
          }}
        />
      )}

      {/* 顶层：播放器 OSD 控制栏 */}
      <PlayerOsd
        title={item.Name}
        subtitle={item.SeriesName ? `${item.SeriesName} · 第 ${item.IndexNumber || 1} 集` : undefined}
        visible={!osdOverlayActive && (isOsdVisible || isLoadingVideo || !!videoError)}
        disableCenterClick={isLoadingVideo || !!videoError}
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
        skipSegments={currentSkipSegments}
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
        onToggleDanmaku={handleToggleDanmakuWithHud}
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
        onMarkIntroEnd={() => handleMarkIntroEnd()}
        onMarkOutroStart={() => handleMarkOutroStart()}
        onClearSkipSegment={handleClearSkipSegment}
        onVideoClick={handleVideoClick}
        onVideoDoubleClick={handleVideoDoubleClick}
      />

      {/* 右键快捷菜单（按需挂载，减少空闲渲染） */}
      {contextMenu.visible && (
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
          onToggleDanmaku={handleToggleDanmakuWithHud}
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
          onTogglePin={!isFullscreen ? handleTogglePin : undefined}
          onTakeScreenshot={handleTakeScreenshot}
          onOpenPlaybackInfo={() => setActivePanel('info')}
          onOpenShortcuts={() => setActivePanel('shortcuts')}
        />
      )}

      <OutroSkipToast
        visible={Boolean(outroToast) && !osdOverlayActive}
        remainingMs={outroRemainingMs}
        totalMs={OUTRO_TOAST_MS}
        defaultAction={skipSettings.skipOutroAction}
        hasNextEpisode={Boolean(nextEpisode)}
        onSkip={handleSkipOutro}
        onCancel={handleCancelOutro}
      />

      {/* 弹幕加载或绑定提示 Toast */}
      {danmuToast && (
        <div className="fixed top-20 right-6 z-40 max-w-md bg-white/[0.95] dark:bg-[#141416]/[0.94] border border-black/[0.12] dark:border-white/[0.14] text-[#1D1D1F] dark:text-white text-xs px-4 py-2.5 rounded-xl flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-2">
          <span className="w-2 h-2 rounded-full bg-[#1D1D1F] dark:bg-white animate-ping flex-shrink-0" />
          <span className="font-medium truncate">{danmuToast}</span>
        </div>
      )}

      <SkipNoticeToast message={osdOverlayActive ? null : skipNotice} />

      {/* 时长偏差提示 Banner */}
      {durationAlert && (
        <div className="fixed top-32 right-6 z-40 max-w-sm bg-white/[0.95] dark:bg-[#141416]/[0.94] border border-amber-600/30 dark:border-amber-400/30 text-[#B45309] dark:text-amber-300 text-xs p-3 rounded-xl flex items-start space-x-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#B45309] dark:text-amber-400 mt-0.5" />
          <div className="flex-1 leading-relaxed">{durationAlert}</div>
          <button
            onClick={() => setDurationAlert(null)}
            className="text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/55 dark:hover:text-white ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 右侧专注面板 1: 弹幕控制中心（保留搜索筛选本地状态，非打开态下仅传入 0 避免重绘） */}
      <DanmakuDrawer
        isOpen={activePanel === 'danmaku'}
        onClose={() => setActivePanel('none')}
        bridge={bridge}
        itemId={item.Id}
        seriesId={item.SeriesId}
        itemTitle={item.Name}
        seriesName={item.SeriesName}
        episodeNumber={item.IndexNumber}
        currentMatchedTitle={matchedTitle}
        sourceCommentCount={rawComments.length}
        sourceDuration={sourceDuration}
        videoDuration={effectiveDuration}
        rawComments={rawComments}
        currentTime={activePanel === 'danmaku' ? Math.floor(currentTime) : 0}
        onSeekToTime={(sec) => {
          handleSeek(sec);
          showMiniHud({ icon: 'seek-forward', label: `跳转至 ${formatTime(sec)}` });
        }}
        onCommentsLoaded={handleCommentsLoaded}
        onReAutoMatch={() => triggerDanmakuLoad(true)}
      />

      {/* 右侧专注面板 2: 画质、硬解与音字幕 Pro 调校 */}
      {activePanel === 'videoPro' && (
        <VideoProPanel
          isOpen
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
          hasNextEpisode={!!nextEpisode}
          nextPreloadStatus={nextPreloadStatus}
        />
      )}

      {/* 右侧专注面板 3: 分集列表与多版本原画源 */}
      {activePanel === 'episodes' && (
        <EpisodeDrawer
          isOpen
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
      )}

      {/* 浮动面板 4: 网络缓冲监控与代理快切 */}
      {activePanel === 'network' && (
        <NetworkProxyPopover
          isOpen
          onClose={() => setActivePanel('none')}
          networkSpeed={networkSpeed}
          speedHistory={speedHistory}
          telemetry={telemetry}
          proxyInfo={proxyInfo}
          proxyOverride={proxyOverride}
          redirectHosts={currentRedirectHosts}
          onChangeProxyOverride={handleHotReloadStreamWithProxy}
          onReloadStream={() => handleHotReloadStreamWithProxy(proxyOverride)}
          onOpenProxySettings={() => setIsProxyModalOpen(true)}
        />
      )}

      {/* 居中浮层 5: 实时硬解与媒体技术信息 HUD */}
      {activePanel === 'info' && (
        <PlaybackInfoModal
          isOpen
          onClose={() => setActivePanel('none')}
          item={item}
          mediaSource={mediaSource}
          streamUrl={upstreamStreamUrlRef.current || currentStreamUrl || streamUrl}
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
          userAgent={currentUserAgent}
          nextPreloadStatus={nextPreloadStatus}
        />
      )}

      {/* 居中浮层 6: 快捷键与手势指南 */}
      {activePanel === 'shortcuts' && (
        <ShortcutsModal
          isOpen
          onClose={() => setActivePanel('none')}
        />
      )}

      {/* 详细网络与代理配置弹窗（保存后原地热重载视频流） */}
      {isProxyModalOpen && (
        <NetworkProxyModal
          isOpen
          onClose={() => setIsProxyModalOpen(false)}
          onSaved={() => handleHotReloadStreamWithProxy(proxyOverride)}
        />
      )}

      {/* 当前服务器 User-Agent 与连接配置弹窗（保存后立即重试播放） */}
      {isServerUaModalOpen && currentServer && (
        <EmbyServerModal
          isOpen
          onClose={() => setIsServerUaModalOpen(false)}
          initialEditId={currentServer.id}
          onSaved={() => {
            setIsServerUaModalOpen(false);
            void renegotiateAndRetryPlayback();
          }}
        />
      )}
    </div>
  );
};

export default PlayerPage;
