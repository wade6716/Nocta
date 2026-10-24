import React, { useEffect, useRef, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore, getSkipKey } from '../stores/usePlayerStore';
import { useDanmuStore } from '../stores/useDanmuStore';
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  ticksToSeconds,
  buildDirectStreamUrl,
  buildNativeDirectStreamUrl,
  getItemDetail,
  getPlaybackInfo,
  mapStreamTracks,
  buildItemImageUrl,
} from '../api/embyClient';
import { IPlayerEngine } from '../player/types';
import { PlayerEngineFactory } from '../player/PlayerEngineFactory';
import {
  autoMatchEpisode,
  fetchCommentsById,
  transformToDanmakuItems,
  RawDanmuComment,
  FormattedDanmakuItem,
} from '../api/danmuClient';
import { isTauriEnvironment } from '../api/http';
import { MpvDanmakuBridge } from '../components/player/MpvDanmakuBridge';
import { DanmakuLayer } from '../components/player/DanmakuLayer';
import { PlayerOsd } from '../components/player/PlayerOsd';
import { DanmakuDrawer } from '../components/player/DanmakuDrawer';
import { PlaybackInfoModal } from '../components/player/PlaybackInfoModal';
import { OutroSkipToast } from '../components/player/OutroSkipToast';
import { SkipNoticeToast } from '../components/player/SkipNoticeToast';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  OSD_OVERLAY_COMMENTS_EVENT,
  OSD_OVERLAY_COMMAND_EVENT,
  OSD_OVERLAY_READY_EVENT,
  OSD_OVERLAY_SYNC_EVENT,
  OsdCommand,
  OsdSyncPayload,
} from '../player/osdOverlaySync';

const IS_MACOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
const OUTRO_TOAST_MS = 8000;

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
        .toString()
        .padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const PlayerPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const { getActiveServer, activeServerId } = useDanmuStore();
  const activeDanmuServer = getActiveServer();

  const {
    item,
    mediaSource,
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
    danmakuSettings,
    itemOffsets,
    danmakuBindings,
    videoLayouts,
    skipSegments,
    skipSettings,
    engineType,
    setEngineType,
    setPlaybackContext,
    updateTime,
    setPaused,
    setVolume,
    setPlaybackRate,
    selectAudioTrack,
    selectSubtitleTrack,
    updateDanmakuSettings,
    setSkipSegment,
    clearSkipSegment,
    resetPlayer,
  } = usePlayerStore();

  // Bridge ref for 120Hz interpolation
  const bridgeRef = useRef<MpvDanmakuBridge>(new MpvDanmakuBridge());
  const bridge = bridgeRef.current;

  // Video playback status (100% 原画直连，坚决不向服务端请求转码)
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(streamUrl);
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [networkSpeed, setNetworkSpeed] = useState<number>(0);

  // Initial resume seek flag & live refs for engine callbacks
  const hasInitialSeekedRef = useRef(false);
  const initialTimeRef = useRef<number>(initialTime);
  const handleVideoErrorRef = useRef<(errMsg?: string) => void>(() => {});
  const outroDismissedRef = useRef(false);
  const outroToastShownRef = useRef(false);
  const initialSkipNoticeKeyRef = useRef('');

  const resolveInitialPlaybackTime = useCallback((rawTime: number) => {
    const state = usePlayerStore.getState();
    const currentItem = state.item;
    if (!currentItem || !state.skipSettings.skipIntroEnabled) {
      return { seconds: rawTime, skipped: false };
    }

    const segments = state.skipSegments[getSkipKey(currentItem)];
    const introEnd = segments?.introEnd;
    const runtime = ticksToSeconds(currentItem.RunTimeTicks || 0);
    if (
      introEnd === undefined ||
      introEnd <= 1 ||
      (runtime > 0 && introEnd >= runtime - 5) ||
      rawTime >= introEnd - 1
    ) {
      return { seconds: rawTime, skipped: false };
    }

    return { seconds: introEnd, skipped: true };
  }, []);

  // Player Engine and Container refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<IPlayerEngine | null>(null);

  // Per-series or per-item video layout configuration
  const layoutKey = item?.SeriesId ? `series_${item.SeriesId}` : item ? `item_${item.Id}` : '';
  const currentLayout = (layoutKey && videoLayouts[layoutKey]) || { bottomAlign: false, verticalOffset: 100 };
  const videoAspectRatio = videoDimensions ? videoDimensions.width / videoDimensions.height : undefined;
  const isWidescreen = videoAspectRatio ? videoAspectRatio > (window.innerWidth / window.innerHeight) + 0.05 : false;

  // Danmaku state
  const [rawComments, setRawComments] = useState<RawDanmuComment[]>([]);
  const [formattedComments, setFormattedComments] = useState<FormattedDanmakuItem[]>([]);
  const [matchedTitle, setMatchedTitle] = useState<string>('');
  const [sourceDuration, setSourceDuration] = useState<number | undefined>();
  const [danmuToast, setDanmuToast] = useState<string | null>(null);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const [outroToast, setOutroToast] = useState<{ deadline: number } | null>(null);
  const [outroRemainingMs, setOutroRemainingMs] = useState(OUTRO_TOAST_MS);
  const [durationAlert, setDurationAlert] = useState<string | null>(null);
  const [isDanmakuDrawerOpen, setIsDanmakuDrawerOpen] = useState(false);
  const [isPlaybackInfoOpen, setIsPlaybackInfoOpen] = useState(false);

  // OSD and Mouse interaction
  const [isOsdVisible, setIsOsdVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [osdOverlayActive, setOsdOverlayActive] = useState(false);
  const [centerIcon, setCenterIcon] = useState<'play' | 'pause' | null>(null);
  const centerIconTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const osdSyncPayloadRef = useRef<OsdSyncPayload | null>(null);
  const osdCommentsRef = useRef<FormattedDanmakuItem[]>([]);
  const osdCommandHandlerRef = useRef<(cmd: OsdCommand) => void>(() => {});
  const skipNoticeTimerRef = useRef<number | null>(null);
  const skipOutroRef = useRef<() => void>(() => {});

  // Current item offset
  const savedOffset = (itemId && itemOffsets[itemId]) || 0;
  const skipKey = item ? getSkipKey(item) : '';
  const currentSkipSegments = skipKey ? skipSegments[skipKey] : undefined;
  const videoDuration = duration || (item ? ticksToSeconds(item.RunTimeTicks || 0) : 0);

  const showSkipNotice = useCallback((message: string) => {
    setSkipNotice(message);
    if (skipNoticeTimerRef.current) {
      window.clearTimeout(skipNoticeTimerRef.current);
    }
    skipNoticeTimerRef.current = window.setTimeout(() => {
      setSkipNotice(null);
      skipNoticeTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (skipNoticeTimerRef.current) {
        window.clearTimeout(skipNoticeTimerRef.current);
      }
    };
  }, []);

  // 切换影片/剧集时重置片尾会话级状态
  useEffect(() => {
    outroDismissedRef.current = false;
    outroToastShownRef.current = false;
    initialSkipNoticeKeyRef.current = '';
    setOutroToast(null);
    setOutroRemainingMs(OUTRO_TOAST_MS);
  }, [item?.Id]);

  // 起播阶段统一处理记忆进度与自动跳过片头
  useEffect(() => {
    const resolved = resolveInitialPlaybackTime(initialTime);
    initialTimeRef.current = resolved.seconds;

    if (resolved.skipped && item) {
      const noticeKey = `${item.Id}:${resolved.seconds}`;
      if (initialSkipNoticeKeyRef.current !== noticeKey) {
        initialSkipNoticeKeyRef.current = noticeKey;
        showSkipNotice(`已跳过片头 → ${formatClock(resolved.seconds)}`);
      }
    }
  }, [initialTime, item?.Id, resolveInitialPlaybackTime, showSkipNotice]);

  // Sync streamUrl when store changes
  useEffect(() => {
    if (streamUrl) {
      setCurrentStreamUrl(streamUrl);
      setIsLoadingVideo(true);
      setVideoError(null);
      hasInitialSeekedRef.current = false;
      outroDismissedRef.current = false;
      outroToastShownRef.current = false;
      setOutroToast(null);
    }
  }, [streamUrl]);

  // 0. Player Engine Lifecycle (MpvPlayerEngine / Html5PlayerEngine)
  useEffect(() => {
    let active = true;
    const engine = PlayerEngineFactory.create(engineType);
    engineRef.current = engine;

    engine.init(containerRef.current).catch((err) => {
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
      setIsLoadingVideo(false);
      updateTime(cur, dur);
      bridge.onMpvTimePos(cur);

      const state = usePlayerStore.getState();
      if (
        state.skipSettings.skipOutroEnabled &&
        !outroDismissedRef.current &&
        !outroToastShownRef.current
      ) {
        const currentItem = state.item;
        const segments = currentItem ? state.skipSegments[getSkipKey(currentItem)] : undefined;
        const outroStart = segments?.outroStart;
        const total = dur || (currentItem ? ticksToSeconds(currentItem.RunTimeTicks || 0) : 0);
        if (outroStart !== undefined && cur >= outroStart && (!total || outroStart < total - 2)) {
          outroToastShownRef.current = true;
          setOutroRemainingMs(OUTRO_TOAST_MS);
          setOutroToast({ deadline: Date.now() + OUTRO_TOAST_MS });
        }
      }
    });

    const unlistenState = engine.onStateChange((st) => {
      if (!active) return;
      switch (st) {
        case 'loading':
          setIsLoadingVideo(true);
          setVideoError(null);
          break;
        case 'playing':
          // 若有记忆起播进度且尚未收到真实起播秒数，保持加载中以避免黑屏穿透
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
          setOutroToast(null);
          setOutroRemainingMs(0);
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

    const unlistenSpeed = engine.onNetworkSpeed?.((spd) => {
      if (!active) return;
      setNetworkSpeed(spd);
    });

    return () => {
      active = false;
      unlistenTime();
      unlistenState();
      unlistenError();
      unlistenDim();
      unlistenSpeed?.();
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineType]);

  // 片尾轻提示倒计时：仅提示或按设置自动跳过
  useEffect(() => {
    if (!outroToast) return;

    let completed = false;
    const tick = () => {
      if (completed) return;
      const remaining = Math.max(0, outroToast.deadline - Date.now());
      setOutroRemainingMs(remaining);

      if (remaining <= 0) {
        completed = true;
        setOutroToast(null);
        if (usePlayerStore.getState().skipSettings.skipOutroAction === 'auto') {
          skipOutroRef.current();
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [outroToast]);

  useEffect(() => {
    if (!skipSettings.skipOutroEnabled) {
      setOutroToast(null);
      setOutroRemainingMs(0);
    }
  }, [skipSettings.skipOutroEnabled]);

  // Sync streamUrl into active engine
  useEffect(() => {
    if (currentStreamUrl && engineRef.current) {
      const resolved = resolveInitialPlaybackTime(initialTimeRef.current);
      initialTimeRef.current = resolved.seconds;
      engineRef.current.load({
        url: currentStreamUrl,
        initialTime: resolved.seconds,
        title: item?.Name,
      });
    }
  }, [currentStreamUrl, resolveInitialPlaybackTime, item?.Name]);

  // Sync widescreen bottom-alignment into active engine
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setVideoAlignment(currentLayout.verticalOffset, currentLayout.bottomAlign);
    }
  }, [currentLayout.bottomAlign, currentLayout.verticalOffset]);

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
          const initialTime = ticksToSeconds(detail.UserData?.PlaybackPositionTicks || 0);

          setPlaybackContext({
            item: detail,
            mediaSource: ms,
            playSessionId: pbInfo.PlaySessionId,
            streamUrl: sUrl,
            audioTracks: aTracks,
            subtitleTracks: sTracks,
            initialTime,
          });
        } catch (err: any) {
          setVideoError(err.message || '加载媒体失败');
          setIsLoadingVideo(false);
        }
      })();
    }
  }, [item, currentServer, itemId, engineType]);

  // 1. Window punch-through styling lifecycle (关键避坑点 5 & 10)
  useEffect(() => {
    bridge.offset = savedOffset;
    return () => {
      bridge.reset();
    };
  }, [savedOffset]);

  // 2. Format comments whenever rawComments or danmaku filter settings change
  useEffect(() => {
    if (rawComments.length === 0) {
      setFormattedComments([]);
      return;
    }
    const items = transformToDanmakuItems(rawComments, {
      fontSize: danmakuSettings.fontSize,
      colorMode: danmakuSettings.colorMode,
      blockScroll: danmakuSettings.blockScroll,
      blockTop: danmakuSettings.blockTop,
      blockBottom: danmakuSettings.blockBottom,
      blockColor: danmakuSettings.blockColor,
      blockedWords: danmakuSettings.blockedWords,
    });
    setFormattedComments(items);
  }, [rawComments, danmakuSettings]);

  // 3. Load danmaku: first check persistent binding, then fallback to auto-match
  const triggerDanmakuLoad = useCallback(
    async (forceAuto = false) => {
      if (!item) return;

      const currentBinding = itemId && !forceAuto ? danmakuBindings[itemId] : undefined;

      if (currentBinding) {
        // 1. 命中已保存的手动绑定
        setMatchedTitle(`《${currentBinding.animeTitle}》${currentBinding.episodeTitle}`);
        setSourceDuration(currentBinding.sourceDuration);
        try {
          const res = await fetchCommentsById(activeDanmuServer, currentBinding.episodeId);
          setRawComments(res.comments || []);
          if (res.videoDuration) {
            setSourceDuration(res.videoDuration);
          }
          setDanmuToast(
            `已加载绑定弹幕: 《${currentBinding.animeTitle}》${currentBinding.episodeTitle} (${res.comments?.length || 0}条)`
          );
          setTimeout(() => setDanmuToast(null), 3500);

          const embyDurationSec = ticksToSeconds(item.RunTimeTicks || 0);
          const dur = res.videoDuration || currentBinding.sourceDuration;
          if (dur && embyDurationSec > 0) {
            const diff = Math.round(Math.abs(dur - embyDurationSec));
            if (diff > 15) {
              setDurationAlert(`片源与弹幕源时长相差 ${diff} 秒，建议在右侧抽屉微调时间偏移。`);
            } else {
              setDurationAlert(null);
            }
          }
          return;
        } catch (err) {
          console.warn('加载绑定弹幕失败，尝试自动匹配', err);
        }
      }

      // 2. 未绑定或强制重新匹配，执行智能自动匹配
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
            setDurationAlert(`片源与弹幕源时长相差 ${diff} 秒，建议在右侧抽屉微调时间偏移。`);
          } else {
            setDurationAlert(null);
          }
        }
      } catch (err) {
        console.warn('弹幕自动匹配失败', err);
      }
    },
    [item?.Id, itemId, danmakuBindings, activeDanmuServer]
  );

  useEffect(() => {
    triggerDanmakuLoad();
  }, [triggerDanmakuLoad]);

  // 4. Emby Playback reporting lifecycle
  useEffect(() => {
    if (!currentServer || !item || !mediaSource || !playSessionId) return;

    const startSec =
      initialTimeRef.current > 0 ? initialTimeRef.current : usePlayerStore.getState().currentTime;
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
        engineRef.current?.currentTime ?? usePlayerStore.getState().currentTime;
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
      const stopSeconds =
        engineRef.current?.currentTime ?? usePlayerStore.getState().currentTime;
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

  // 5. Mouse inactivity auto-hide OSD (在加载或报错时不隐藏)
  const resetHideTimer = useCallback(() => {
    setIsOsdVisible(true);
    document.body.style.cursor = 'default';

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }

    if (!isDanmakuDrawerOpen && !paused && !isLoadingVideo && !videoError) {
      hideTimerRef.current = window.setTimeout(() => {
        setIsOsdVisible(false);
        document.body.style.cursor = 'none';
      }, 3500);
    }
  }, [isDanmakuDrawerOpen, paused, isLoadingVideo, videoError]);

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

  // Sync window fullscreen and maximized states
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

  // 6. Playback controls implementation
  const handleTogglePlay = () => {
    if (isLoadingVideo || videoError) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    bridge.onMpvPauseChange(nextPaused);

    if (engineRef.current) {
      nextPaused ? engineRef.current.pause() : engineRef.current.play();
    }
    triggerCenterIcon(nextPaused ? 'pause' : 'play');
    resetHideTimer();

    if (currentServer && item && mediaSource && playSessionId) {
      reportPlaybackProgress(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: currentTime,
          isPaused: nextPaused,
          eventName: nextPaused ? 'Pause' : 'Unpause',
        },
        currentServer.accessToken
      ).catch(console.error);
    }
  };

  const handleSeek = (targetSeconds: number) => {
    updateTime(targetSeconds);
    bridge.onMpvTimePos(targetSeconds);

    if (engineRef.current) {
      engineRef.current.seek(targetSeconds);
    }

    if (currentServer && item && mediaSource && playSessionId) {
      reportPlaybackProgress(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: targetSeconds,
          isPaused: paused,
          eventName: 'Seek',
        },
        currentServer.accessToken
      ).catch(console.error);
    }
  };

  const handleMarkIntroEnd = (secondsOverride?: number) => {
    if (!item || !skipKey) return;

    const state = usePlayerStore.getState();
    const seconds = Math.max(
      0,
      secondsOverride ?? engineRef.current?.currentTime ?? state.currentTime ?? 0
    );
    const total = duration || ticksToSeconds(item.RunTimeTicks || 0);

    if (seconds < 1) {
      showSkipNotice('当前进度太靠前，无法标记片头');
      return;
    }
    if (total > 0 && seconds > total * 0.95) {
      showSkipNotice('片头结束时间不能超过片长的 95%');
      return;
    }

    const existingOutro = state.skipSegments[skipKey]?.outroStart;
    if (existingOutro !== undefined && seconds >= existingOutro - 1) {
      showSkipNotice('片头结束必须早于已标记的片尾开始');
      return;
    }

    const rounded = Math.round(seconds);
    setSkipSegment(skipKey, { itemId: item.Id, introEnd: rounded });
    showSkipNotice(`片头结束已标记：${formatClock(rounded)}`);
  };

  const handleMarkOutroStart = (secondsOverride?: number) => {
    if (!item || !skipKey) return;

    const state = usePlayerStore.getState();
    const seconds = Math.max(
      0,
      secondsOverride ?? engineRef.current?.currentTime ?? state.currentTime ?? 0
    );
    const total = duration || ticksToSeconds(item.RunTimeTicks || 0);

    if (seconds < 5) {
      showSkipNotice('片尾开始时间必须晚于第 5 秒');
      return;
    }
    if (total > 0 && seconds > total - 2) {
      showSkipNotice('片尾开始时间过于接近视频结尾');
      return;
    }

    const existingIntro = state.skipSegments[skipKey]?.introEnd;
    if (existingIntro !== undefined && seconds <= existingIntro + 1) {
      showSkipNotice('片尾开始必须晚于已标记的片头结束');
      return;
    }

    const rounded = Math.round(seconds);
    setSkipSegment(skipKey, { itemId: item.Id, outroStart: rounded });
    outroToastShownRef.current = false;
    outroDismissedRef.current = false;
    showSkipNotice(`片尾开始已标记：${formatClock(rounded)}`);
  };

  const handleClearSkipSegment = (field: 'introEnd' | 'outroStart') => {
    if (!skipKey) return;
    clearSkipSegment(skipKey, field);
    if (field === 'outroStart') {
      outroToastShownRef.current = false;
      outroDismissedRef.current = false;
      setOutroToast(null);
      setOutroRemainingMs(0);
    }
    showSkipNotice(field === 'introEnd' ? '已清除片头标记' : '已清除片尾标记');
  };

  const handleSkipOutro = () => {
    outroDismissedRef.current = true;
    setOutroToast(null);
    setOutroRemainingMs(0);

    const total = videoDuration || ticksToSeconds(item?.RunTimeTicks || 0);
    if (total > 0) {
      handleSeek(Math.max(0, total - 0.25));
      showSkipNotice('已跳过片尾');
    }
  };

  const handleCancelOutro = () => {
    outroDismissedRef.current = true;
    setOutroToast(null);
    setOutroRemainingMs(0);
  };

  skipOutroRef.current = handleSkipOutro;

  const handleVolumeChange = (vol: number) => {
    setVolume(vol);
    if (engineRef.current) {
      engineRef.current.setVolume(vol);
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    bridge.onMpvSpeedChange(rate);
    if (engineRef.current) {
      engineRef.current.setPlaybackRate(rate);
    }
  };

  const handleSelectAudioTrack = (trackId: string | null) => {
    selectAudioTrack(trackId);
    if (trackId && engineRef.current) {
      const track = audioTracks.find((t) => t.id === trackId);
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
      const engineTrackId =
        engineType === 'mpv' && track?.mpvId !== undefined ? String(track.mpvId) : trackId;
      engineRef.current.selectSubtitleTrack(engineTrackId);
    }
  };

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
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const handleVideoClick = () => {
    if (isDanmakuDrawerOpen) {
      setIsDanmakuDrawerOpen(false);
      return;
    }
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    } else {
      clickTimerRef.current = window.setTimeout(() => {
        handleTogglePlay();
        clickTimerRef.current = null;
      }, 250);
    }
  };

  const handleVideoDoubleClick = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (isDanmakuDrawerOpen) {
      setIsDanmakuDrawerOpen(false);
      return;
    }
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    handleToggleFullscreen();
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

  // 7. Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handleTogglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeek(Math.max(0, currentTime - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSeek(Math.min(duration, currentTime + 5));
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(Math.min(100, volume + 5));
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 5));
          break;
        case 'KeyD':
          e.preventDefault();
          updateDanmakuSettings({ visible: !danmakuSettings.visible });
          break;
        case 'KeyF':
          e.preventDefault();
          handleToggleFullscreen();
          break;
        case 'KeyI':
          e.preventDefault();
          setIsPlaybackInfoOpen((prev) => !prev);
          break;
        case 'Escape':
          if (isPlaybackInfoOpen) {
            setIsPlaybackInfoOpen(false);
          } else if (isDanmakuDrawerOpen) {
            setIsDanmakuDrawerOpen(false);
          } else if (isFullscreen) {
            handleToggleFullscreen();
          } else {
            handleBack();
          }
          break;
      }
      resetHideTimer();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentTime,
    duration,
    paused,
    volume,
    danmakuSettings.visible,
    isFullscreen,
    isDanmakuDrawerOpen,
    isPlaybackInfoOpen,
    isLoadingVideo,
    videoError,
    resetHideTimer,
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

      // 若是 HTML5 引擎报错，绝不隐式向 Emby 请求转码或 MP4 重封装
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

      // 若是 libmpv 动态库初始化本身报错
      if (errMsg && (errMsg.includes('初始化 libmpv') || errMsg.includes('FFI error'))) {
        setVideoError(errMsg);
        return;
      }

      setVideoError(
        errMsg
          ? `直连媒体流播放中断 (${errMsg})。请检查网络连接或服务器直链状态。`
          : '无法打开该媒体直连流，请检查网络连接或重试。'
      );
    },
    [currentServer, item, mediaSource, playSessionId, engineType, setPaused]
  );

  useEffect(() => {
    handleVideoErrorRef.current = handleVideoError;
  }, [handleVideoError]);

  // macOS 原生全屏时，mpv 窗口会盖住 WebView；改用独立透明浮层承载 OSD 与弹幕。
  // 其他平台与窗口模式完全沿用原有单窗口渲染路径。
  const canUseMacOsdOverlay = isTauriEnvironment() && IS_MACOS && engineType === 'mpv';

  useEffect(() => {
    if (!canUseMacOsdOverlay) {
      setOsdOverlayActive(false);
      return;
    }

    let cancelled = false;
    if (isFullscreen && !videoError) {
      invoke('open_osd_overlay')
        .then(() => {
          if (cancelled) {
            invoke('close_osd_overlay').catch(() => {});
            return;
          }
          setOsdOverlayActive(true);
        })
        .catch((err) => {
          console.warn('[OSD Overlay] open failed:', err);
          setOsdOverlayActive(false);
        });
    } else {
      invoke('close_osd_overlay').catch(() => {});
      setOsdOverlayActive(false);
    }

    return () => {
      cancelled = true;
    };
  }, [canUseMacOsdOverlay, isFullscreen, videoError]);

  useEffect(() => {
    if (!canUseMacOsdOverlay) return;
    return () => {
      invoke('close_osd_overlay').catch(() => {});
    };
  }, [canUseMacOsdOverlay]);

  useEffect(() => {
    if (!osdOverlayActive) return;

    const pushSync = () => {
      const payload = osdSyncPayloadRef.current;
      if (payload) void emit(OSD_OVERLAY_SYNC_EVENT, payload);
    };

    pushSync();
    const timer = window.setInterval(pushSync, 200);
    const unlistenReady = listen(OSD_OVERLAY_READY_EVENT, () => {
      pushSync();
      void emit(OSD_OVERLAY_COMMENTS_EVENT, osdCommentsRef.current);
    });

    return () => {
      window.clearInterval(timer);
      unlistenReady.then((unlisten) => unlisten());
    };
  }, [osdOverlayActive]);

  useEffect(() => {
    if (!osdOverlayActive) return;
    void emit(OSD_OVERLAY_COMMENTS_EVENT, formattedComments);
  }, [osdOverlayActive, formattedComments]);

  useEffect(() => {
    if (!osdOverlayActive) return;
    const unlisten = listen<OsdCommand>(OSD_OVERLAY_COMMAND_EVENT, (event) => {
      osdCommandHandlerRef.current(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [osdOverlayActive]);

  const handleRetryDirect = () => {
    if (!currentServer || !item || !mediaSource || !playSessionId) return;
    setIsLoadingVideo(true);
    setVideoError(null);
    hasInitialSeekedRef.current = false;
    outroDismissedRef.current = false;
    outroToastShownRef.current = false;
    setOutroToast(null);
    const resolved = resolveInitialPlaybackTime(initialTimeRef.current);
    initialTimeRef.current = resolved.seconds;
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
    if (currentStreamUrl === directUrl && engineRef.current) {
      engineRef.current.load({
        url: directUrl,
        initialTime: resolved.seconds,
        title: item.Name,
      });
    }
  };

  const handleSwitchToMpv = () => {
    setVideoError(null);
    setIsLoadingVideo(true);
    hasInitialSeekedRef.current = false;
    setEngineType('mpv');
  };

  osdCommentsRef.current = formattedComments;
  osdSyncPayloadRef.current = item
    ? {
        title: item.Name,
        subtitle: item.SeriesName
          ? `${item.SeriesName} · 第 ${item.IndexNumber || 1} 集`
          : undefined,
        paused,
        currentTime,
        duration: duration || ticksToSeconds(item.RunTimeTicks || 0),
        volume,
        playbackRate,
        networkSpeed,
        danmakuVisible: danmakuSettings.visible,
        danmakuCount: rawComments.length,
        danmakuOffset: savedOffset,
        matchedTitle,
        audioTracks,
        subtitleTracks,
        selectedAudioId,
        selectedSubtitleId,
        danmakuStyle: {
          speed: danmakuSettings.speed,
          opacity: danmakuSettings.opacity,
          area: danmakuSettings.area,
          maxLines: danmakuSettings.maxLines,
          bottomMargin: danmakuSettings.bottomMargin,
        },
        isLoading: isLoadingVideo,
        skipSegments: currentSkipSegments || null,
        outroToast: {
          visible: Boolean(outroToast),
          remainingMs: outroRemainingMs,
          totalMs: OUTRO_TOAST_MS,
        },
        skipNotice,
        skipOutroAction: skipSettings.skipOutroAction,
      }
    : null;
  osdCommandHandlerRef.current = (cmd: OsdCommand) => {
    switch (cmd.type) {
      case 'toggle-play':
        handleTogglePlay();
        break;
      case 'seek':
        handleSeek(cmd.seconds);
        break;
      case 'volume':
        handleVolumeChange(cmd.volume);
        break;
      case 'rate':
        handleRateChange(cmd.rate);
        break;
      case 'toggle-danmaku':
        updateDanmakuSettings({ visible: !danmakuSettings.visible });
        break;
      case 'toggle-fullscreen':
        handleToggleFullscreen();
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
      case 'select-subtitle':
        handleSelectSubtitleTrack(cmd.id);
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
      case 'skip-outro':
        handleSkipOutro();
        break;
      case 'cancel-outro':
        handleCancelOutro();
        break;
    }
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

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-transparent">
      {/* 哔哩哔哩风格：屏幕中央播放/暂停动效徽标 */}
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

      {/* 底层：原生视频表面穿透层与交互层 (libmpv 底层透明穿透 / HTML5 挂载容器) */}
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

      {/* Error Overlay */}
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
            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              {engineType === 'html5' ? (
                <>
                  <button
                    onClick={handleSwitchToMpv}
                    className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-lg shadow-primary/20"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>一键切换至 MPV 硬解</span>
                  </button>
                  <button
                    onClick={handleRetryDirect}
                    className="py-2.5 px-4 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>重试</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={handleRetryDirect}
                  className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重试原画直连</span>
                </button>
              )}
              <button
                onClick={handleBack}
                className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回详情页</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 中层：Danmaku Canvas 图层 (Z-Index 10, pointer-events-none) */}
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

      {/* 顶层：播放器 OSD 控制栏 (Z-Index 20) */}
      <PlayerOsd
        title={item.Name}
        subtitle={item.SeriesName ? `${item.SeriesName} · 第 ${item.IndexNumber || 1} 集` : undefined}
        visible={!osdOverlayActive && (isOsdVisible || isLoadingVideo || !!videoError)}
        paused={paused}
        currentTime={currentTime}
        duration={duration || ticksToSeconds(item.RunTimeTicks || 0)}
        volume={volume}
        playbackRate={playbackRate}
        networkSpeed={networkSpeed}
        danmakuVisible={danmakuSettings.visible}
        danmakuCount={rawComments.length}
        danmakuOffset={savedOffset}
        matchedTitle={matchedTitle}
        skipSegments={currentSkipSegments}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        selectedAudioId={selectedAudioId}
        selectedSubtitleId={selectedSubtitleId}
        isFullscreen={isFullscreen}
        isMaximized={isMaximized}
        onBack={handleBack}
        onHome={handleHome}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onRateChange={handleRateChange}
        onToggleDanmaku={() => updateDanmakuSettings({ visible: !danmakuSettings.visible })}
        onToggleDanmakuDrawer={() => setIsDanmakuDrawerOpen(!isDanmakuDrawerOpen)}
        onTogglePlaybackInfo={() => setIsPlaybackInfoOpen(!isPlaybackInfoOpen)}
        isPlaybackInfoOpen={isPlaybackInfoOpen}
        onSelectAudioTrack={handleSelectAudioTrack}
        onSelectSubtitleTrack={handleSelectSubtitleTrack}
        onToggleWindowMode={handleToggleWindowMode}
        onToggleFullscreen={handleToggleFullscreen}
        onMarkIntroEnd={() => handleMarkIntroEnd()}
        onMarkOutroStart={() => handleMarkOutroStart()}
        onClearSkipSegment={handleClearSkipSegment}
        onVideoClick={handleVideoClick}
        onVideoDoubleClick={handleVideoDoubleClick}
      />

      <OutroSkipToast
        visible={Boolean(outroToast) && !osdOverlayActive}
        remainingMs={outroRemainingMs}
        totalMs={OUTRO_TOAST_MS}
        defaultAction={skipSettings.skipOutroAction}
        onSkip={handleSkipOutro}
        onCancel={handleCancelOutro}
      />

      {/* 弹幕加载或绑定提示 Toast */}
      {danmuToast && (
        <div className="fixed top-6 right-6 z-40 max-w-md bg-black/85 backdrop-blur-md border border-primary/40 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-ping flex-shrink-0" />
          <span className="font-medium truncate">{danmuToast}</span>
        </div>
      )}

      <SkipNoticeToast message={osdOverlayActive ? null : skipNotice} />

      {/* Duration mismatch non-modal banner (Milestone 4.3) */}
      {durationAlert && (
        <div className="fixed top-20 right-6 z-40 max-w-sm bg-black/80 backdrop-blur-md border border-yellow-500/30 text-yellow-300 text-xs p-3 rounded-xl shadow-xl flex items-start space-x-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-yellow-400 mt-0.5" />
          <div className="flex-1 leading-relaxed">{durationAlert}</div>
          <button
            onClick={() => setDurationAlert(null)}
            className="text-gray-400 hover:text-white ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 右侧弹幕设置与搜番抽屉 (Z-Index 30) */}
      <DanmakuDrawer
        isOpen={isDanmakuDrawerOpen}
        onClose={() => setIsDanmakuDrawerOpen(false)}
        bridge={bridge}
        itemId={item.Id}
        seriesId={item.SeriesId}
        itemTitle={item.Name}
        seriesName={item.SeriesName}
        layoutKey={layoutKey}
        videoAspectRatio={videoAspectRatio}
        isWidescreen={isWidescreen}
        currentMatchedTitle={matchedTitle}
        sourceCommentCount={rawComments.length}
        sourceDuration={sourceDuration}
        videoDuration={duration || ticksToSeconds(item.RunTimeTicks || 0)}
        onCommentsLoaded={(newComments, sDur, meta) => {
          setRawComments(newComments);
          if (sDur) setSourceDuration(sDur);
          if (meta) {
            setMatchedTitle(`《${meta.animeTitle}》${meta.episodeTitle}`);
            setDanmuToast(`已切换并绑定弹幕: 《${meta.animeTitle}》${meta.episodeTitle} (${newComments.length}条)`);
            setTimeout(() => setDanmuToast(null), 3500);
          }
          if (sDur && item.RunTimeTicks) {
            const embyDurationSec = ticksToSeconds(item.RunTimeTicks);
            const diff = Math.round(Math.abs(sDur - embyDurationSec));
            if (diff > 15) {
              setDurationAlert(`重新加载的弹幕源时长相差 ${diff} 秒，建议在右侧抽屉微调时间偏移。`);
            } else {
              setDurationAlert(null);
            }
          }
        }}
        onReAutoMatch={() => {
          triggerDanmakuLoad(true);
        }}
      />

      {/* 详细播放信息 HUD 浮层 (Z-Index 35) */}
      <PlaybackInfoModal
        isOpen={isPlaybackInfoOpen}
        onClose={() => setIsPlaybackInfoOpen(false)}
        item={item}
        mediaSource={mediaSource}
        streamUrl={currentStreamUrl || streamUrl}
        engineType={engineType}
        currentTime={currentTime}
        duration={duration || ticksToSeconds(item.RunTimeTicks || 0)}
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
      />
    </div>
  );
};

export default PlayerPage;
