import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  X,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Minus,
  Maximize,
  Minimize,
  Home,
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
  buildTranscodeStreamUrl,
  getItemDetail,
  getPlaybackInfo,
  mapStreamTracks,
  buildItemImageUrl,
} from '../api/embyClient';
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
  const hideTimerRef = useRef<number | null>(null);
  const videoElemRef = useRef<HTMLVideoElement | null>(null);

  // Current item offset
  const savedOffset = (itemId && itemOffsets[itemId]) || 0;

  // Sync streamUrl when store changes
  useEffect(() => {
    if (streamUrl) {
      setCurrentStreamUrl(streamUrl);
      setIsLoadingVideo(true);
      setVideoError(null);
      setFallbackLevel(0);
    }
  }, [streamUrl]);

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

          const sUrl = buildDirectStreamUrl(
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
  }, [item, currentServer, itemId]);

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

    reportPlaybackStart(
      currentServer.url,
      {
        itemId: item.Id,
        mediaSourceId: mediaSource.Id,
        playSessionId,
        seconds: currentTime,
      },
      currentServer.accessToken
    ).catch(console.error);

    const interval = window.setInterval(() => {
      reportPlaybackProgress(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: currentTime,
          isPaused: paused,
          eventName: 'TimeUpdate',
        },
        currentServer.accessToken
      ).catch(console.error);
    }, 10000);

    return () => {
      clearInterval(interval);
      reportPlaybackStopped(
        currentServer.url,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: currentTime,
        },
        currentServer.accessToken
      ).catch(console.error);
    };
  }, [currentServer?.id, item?.Id, playSessionId]);

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

  // 6. Playback controls implementation
  const handleTogglePlay = () => {
    if (isLoadingVideo || videoError) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    bridge.onMpvPauseChange(nextPaused);

    if (videoElemRef.current) {
      nextPaused ? videoElemRef.current.pause() : videoElemRef.current.play();
    }

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

    if (videoElemRef.current) {
      videoElemRef.current.currentTime = targetSeconds;
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
    if (videoElemRef.current) {
      videoElemRef.current.volume = vol / 100;
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    bridge.onMpvSpeedChange(rate);
    if (videoElemRef.current) {
      videoElemRef.current.playbackRate = rate;
    }
  };

  const handleToggleFullscreen = async () => {
    if (isTauriEnvironment()) {
      try {
        const win = getCurrentWindow();
        const cur = await win.isFullscreen();
        await win.setFullscreen(!cur);
        setIsFullscreen(!cur);
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
    const vErr = videoElemRef.current?.error;
    console.warn('[Video Error Event]', vErr, 'current level:', fallbackLevel);

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
    <div className="relative w-screen h-screen overflow-hidden select-none bg-[#0f1115]">
      {/* 
        永久常驻置顶控制栏（最高层级 Z-50，保证任何时候均可返回与关闭/最小化窗口，绝不被困在黑屏）
      */}
      <div className="fixed top-0 inset-x-0 z-50 h-12 flex items-center justify-between px-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
        <div className="flex items-center space-x-2">
          <button
            onClick={handleBack}
            className="p-2 rounded-xl bg-black/60 hover:bg-black/90 text-white backdrop-blur border border-white/10 transition cursor-pointer flex items-center space-x-1.5 shadow-lg"
            title="返回详情页 (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold">返回</span>
          </button>

          <button
            onClick={() => {
              resetPlayer();
              navigate('/', { replace: true });
            }}
            className="p-2 rounded-xl bg-black/60 hover:bg-black/90 text-gray-300 hover:text-white backdrop-blur border border-white/10 transition cursor-pointer flex items-center space-x-1 shadow-lg"
            title="直接返回媒体库首页"
          >
            <Home className="w-4 h-4" />
            <span className="text-xs font-semibold">首页</span>
          </button>
        </div>

        <div className="flex-1 px-4 truncate pointer-events-none">
          <span className="text-xs font-bold text-gray-200 truncate">
            {item.Name}
            {item.SeriesName ? ` · 第 ${item.IndexNumber || 1} 集` : ''}
          </span>
        </div>

        {/* Window controls for desktop */}
        <div data-tauri-drag-region className="flex items-center space-x-1">
          <button
            onClick={() => isTauriEnvironment() && getCurrentWindow().minimize()}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="最小化"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToggleFullscreen()}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            title="全屏切换"
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => isTauriEnvironment() && getCurrentWindow().close()}
            className="p-2 rounded-lg hover:bg-red-600 text-gray-300 hover:text-white transition cursor-pointer"
            title="关闭窗口"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 底层：HTML5 Video 媒体流 */}
      {currentStreamUrl && (
        <video
          ref={videoElemRef}
          src={currentStreamUrl}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-contain z-0"
          onLoadStart={() => {
            setIsLoadingVideo(true);
            setVideoError(null);
          }}
          onCanPlay={() => {
            setIsLoadingVideo(false);
            setVideoError(null);
          }}
          onWaiting={() => {
            setIsLoadingVideo(true);
            bridge.onMpvPauseChange(true);
          }}
          onPlaying={() => {
            setIsLoadingVideo(false);
            setPaused(false);
            bridge.onMpvPauseChange(false);
          }}
          onError={handleVideoError}
          onTimeUpdate={(e) => {
            const cur = (e.target as HTMLVideoElement).currentTime;
            updateTime(cur);
            bridge.onMpvTimePos(cur);
          }}
          onDurationChange={(e) => {
            const dur = (e.target as HTMLVideoElement).duration;
            if (!isNaN(dur) && dur > 0) {
              updateTime(currentTime, dur);
            }
          }}
          onPlay={() => {
            setPaused(false);
            bridge.onMpvPauseChange(false);
          }}
          onPause={() => {
            setPaused(true);
            bridge.onMpvPauseChange(true);
          }}
        />
      )}

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
        onBack={handleBack}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onRateChange={handleRateChange}
        onToggleDanmaku={() => updateDanmakuSettings({ visible: !danmakuSettings.visible })}
        onToggleDanmakuDrawer={() => setIsDanmakuDrawerOpen(!isDanmakuDrawerOpen)}
        onSelectAudioTrack={selectAudioTrack}
        onSelectSubtitleTrack={selectSubtitleTrack}
        onToggleFullscreen={handleToggleFullscreen}
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
        itemTitle={item.Name}
        seriesName={item.SeriesName}
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
