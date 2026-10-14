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
} from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import { useDanmuStore } from '../stores/useDanmuStore';
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  ticksToSeconds,
  buildDirectStreamUrl,
  buildNativeDirectStreamUrl,
  buildTranscodeStreamUrl,
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
import { getCurrentWindow } from '@tauri-apps/api/window';

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
    resetPlayer,
  } = usePlayerStore();

  // Bridge ref for 120Hz interpolation
  const bridgeRef = useRef<MpvDanmakuBridge>(new MpvDanmakuBridge());
  const bridge = bridgeRef.current;

  // Video playback status and auto-recovery (0: Direct, 1: Remux MP4, 2: H264 Transcode)
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(streamUrl);
  const [fallbackLevel, setFallbackLevel] = useState<0 | 1 | 2>(0);
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  // Initial resume seek flag
  const hasInitialSeekedRef = useRef(false);

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
  const [durationAlert, setDurationAlert] = useState<string | null>(null);
  const [isDanmakuDrawerOpen, setIsDanmakuDrawerOpen] = useState(false);

  // OSD and Mouse interaction
  const [isOsdVisible, setIsOsdVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [centerIcon, setCenterIcon] = useState<'play' | 'pause' | null>(null);
  const centerIconTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  // Current item offset
  const savedOffset = (itemId && itemOffsets[itemId]) || 0;

  // Sync streamUrl when store changes
  useEffect(() => {
    if (streamUrl) {
      setCurrentStreamUrl(streamUrl);
      setIsLoadingVideo(true);
      setVideoError(null);
      setFallbackLevel(0);
      hasInitialSeekedRef.current = false;
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
      if (!hasInitialSeekedRef.current && initialTime > 0 && cur < 1) {
        return;
      }
      hasInitialSeekedRef.current = true;
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
          setIsLoadingVideo(false);
          setPaused(false);
          bridge.onMpvPauseChange(false);
          break;
        case 'paused':
          setIsLoadingVideo(false);
          setPaused(true);
          bridge.onMpvPauseChange(true);
          break;
        case 'buffering':
          setIsLoadingVideo(true);
          bridge.onMpvPauseChange(true);
          break;
        case 'ended':
          setPaused(true);
          bridge.onMpvPauseChange(true);
          break;
      }
    });

    const unlistenError = engine.onError((errMsg) => {
      if (!active) return;
      console.warn('[Engine Playback Error]', errMsg);
      handleVideoError();
    });

    const unlistenDim = engine.onVideoDimensions((width, height) => {
      if (!active) return;
      setVideoDimensions({ width, height });
    });

    return () => {
      active = false;
      unlistenTime();
      unlistenState();
      unlistenError();
      unlistenDim();
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineType]);

  // Sync streamUrl into active engine
  useEffect(() => {
    if (currentStreamUrl && engineRef.current) {
      engineRef.current.load({
        url: currentStreamUrl,
        initialTime,
        title: item?.Name,
      });
    }
  }, [currentStreamUrl]);

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

    const startSec = initialTime > 0 ? initialTime : usePlayerStore.getState().currentTime;
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
      engineRef.current.selectAudioTrack(trackId);
    }
  };

  const handleSelectSubtitleTrack = (trackId: string | null) => {
    selectSubtitleTrack(trackId);
    if (engineRef.current) {
      engineRef.current.selectSubtitleTrack(trackId);
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
        case 'Escape':
          if (isDanmakuDrawerOpen) {
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
    isLoadingVideo,
    videoError,
    resetHideTimer,
  ]);

  // Two-tier Video error auto-recovery
  const handleVideoError = () => {
    console.warn('[Video Error Event] current level:', fallbackLevel);

    if (!currentServer || !item || !mediaSource || !playSessionId) {
      setIsLoadingVideo(false);
      setVideoError('未获取到媒体播放会话信息');
      return;
    }

    if (fallbackLevel === 0) {
      console.log('[Video Auto-Fallback 1] 尝试 MP4 Remux 直接流模式...');
      setFallbackLevel(1);
      const remuxUrl = buildDirectStreamUrl(
        currentServer.url,
        item.Id,
        mediaSource,
        playSessionId,
        currentServer.accessToken,
        true
      );
      setCurrentStreamUrl(remuxUrl);
      setIsLoadingVideo(true);
      setVideoError(null);
      return;
    }

    if (fallbackLevel === 1) {
      console.log('[Video Auto-Fallback 2] 尝试通用兼容 H.264 模式...');
      setFallbackLevel(2);
      const transcodeUrl = buildTranscodeStreamUrl(
        currentServer.url,
        item.Id,
        mediaSource,
        playSessionId,
        currentServer.accessToken
      );
      setCurrentStreamUrl(transcodeUrl);
      setIsLoadingVideo(true);
      setVideoError(null);
      return;
    }

    setIsLoadingVideo(false);
    setPaused(true);
    setVideoError(
      '无法解码该片源或服务端禁止转码。可能由于当前设备缺少 HEVC 扩展，或服务端直连网络受限。'
    );
  };

  const handleManualRetry = () => {
    if (!currentServer || !item || !mediaSource || !playSessionId) return;
    setFallbackLevel(2);
    setIsLoadingVideo(true);
    setVideoError(null);
    const transcodeUrl = buildTranscodeStreamUrl(
      currentServer.url,
      item.Id,
      mediaSource,
      playSessionId,
      currentServer.accessToken
    );
    setCurrentStreamUrl(transcodeUrl);
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
                {fallbackLevel === 0
                  ? '正在直连原始媒体流...'
                  : fallbackLevel === 1
                  ? '正在进行轻量 MP4 兼容重封装...'
                  : '正在转为通用 H.264 兼容流...'}
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
              <button
                onClick={handleManualRetry}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>尝试兼容流重试</span>
              </button>
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
        visible={danmakuSettings.visible}
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
        visible={isOsdVisible || isLoadingVideo || !!videoError}
        paused={paused}
        currentTime={currentTime}
        duration={duration || ticksToSeconds(item.RunTimeTicks || 0)}
        volume={volume}
        playbackRate={playbackRate}
        danmakuVisible={danmakuSettings.visible}
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
        onSelectAudioTrack={handleSelectAudioTrack}
        onSelectSubtitleTrack={handleSelectSubtitleTrack}
        onToggleWindowMode={handleToggleWindowMode}
        onToggleFullscreen={handleToggleFullscreen}
        onVideoClick={handleVideoClick}
        onVideoDoubleClick={handleVideoDoubleClick}
      />

      {/* 弹幕加载或绑定提示 Toast */}
      {danmuToast && (
        <div className="fixed top-6 right-6 z-40 max-w-md bg-black/85 backdrop-blur-md border border-primary/40 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-ping flex-shrink-0" />
          <span className="font-medium truncate">{danmuToast}</span>
        </div>
      )}

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
    </div>
  );
};

export default PlayerPage;
