import React, { useCallback, useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { PlayerOsd } from '../components/player/PlayerOsd';
import { DanmakuLayer } from '../components/player/DanmakuLayer';
import { MpvDanmakuBridge } from '../components/player/MpvDanmakuBridge';
import { OutroSkipToast } from '../components/player/OutroSkipToast';
import { SkipNoticeToast } from '../components/player/SkipNoticeToast';
import { MiniActionHud } from '../components/player/MiniActionHud';
import {
  OSD_OVERLAY_COMMENTS_EVENT,
  OSD_OVERLAY_COMMAND_EVENT,
  OSD_OVERLAY_READY_EVENT,
  OSD_OVERLAY_SYNC_EVENT,
  OsdCommentsPayload,
  OsdCommand,
  OsdSyncPayload,
} from '../player/osdOverlaySync';

export const OsdOverlayPage: React.FC = () => {
  const [sync, setSync] = useState<OsdSyncPayload | null>(null);
  const [comments, setComments] = useState<OsdCommentsPayload>([]);
  const [osdVisible, setOsdVisible] = useState(true);

  const bridgeRef = useRef(new MpvDanmakuBridge());
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const shownRef = useRef(false);
  const syncRef = useRef<OsdSyncPayload | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressActiveRef = useRef(false);
  syncRef.current = sync;

  const send = useCallback((command: OsdCommand) => {
    void emit(OSD_OVERLAY_COMMAND_EVENT, command);
  }, []);

  // 接收主窗口推送的播放状态与弹幕数据
  useEffect(() => {
    const unlistenSync = listen<OsdSyncPayload>(OSD_OVERLAY_SYNC_EVENT, (event) => {
      const payload = event.payload;
      setSync(payload);

      const bridge = bridgeRef.current;
      bridge.onMpvTimePos(payload.currentTime);
      bridge.onMpvPauseChange(payload.paused || payload.isLoading);
      bridge.onMpvSpeedChange(payload.playbackRate);
      if (bridge.offset !== payload.danmakuOffset) {
        bridge.offset = payload.danmakuOffset;
      }

      if (!shownRef.current) {
        shownRef.current = true;
        invoke('show_osd_overlay').catch((err) =>
          console.warn('[OSD Overlay] show failed:', err)
        );
      }
    });

    const unlistenComments = listen<OsdCommentsPayload>(OSD_OVERLAY_COMMENTS_EVENT, (event) => {
      setComments(event.payload);
    });

    void emit(OSD_OVERLAY_READY_EVENT);

    return () => {
      unlistenSync.then((unlisten) => unlisten());
      unlistenComments.then((unlisten) => unlisten());
    };
  }, []);

  // OSD 自动显隐：与主窗口保持一致的 3.5 秒闲置淡出
  const resetHideTimer = useCallback(() => {
    setOsdVisible(true);
    document.body.style.cursor = 'default';

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }

    if (!syncRef.current?.paused && !syncRef.current?.isLoading) {
      hideTimerRef.current = window.setTimeout(() => {
        setOsdVisible(false);
        document.body.style.cursor = 'none';
      }, 3500);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = () => resetHideTimer();
    window.addEventListener('mousemove', handleMouseMove);
    resetHideTimer();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      document.body.style.cursor = 'default';
    };
  }, [resetHideTimer, sync?.paused, sync?.isLoading]);

  const handleVideoClick = () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      send({ type: 'toggle-play' });
      clickTimerRef.current = null;
    }, 250);
  };

  const handleVideoDoubleClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    send({ type: 'toggle-fullscreen' });
  };

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!syncRef.current || syncRef.current.isLoading) return;
      if (Math.abs(e.deltaY) < 2) return;
      const up = e.deltaY < 0;
      if (e.shiftKey) {
        send({ type: 'seek-delta', delta: up ? 5 : -5 });
      } else {
        send({ type: 'volume-delta', delta: up ? 5 : -5 });
      }
    },
    [send]
  );

  // 浮层是当前 key window，需要自行接管完整播放器快捷键（对齐 PlayerPage）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = syncRef.current;
      if (!state) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      let shouldResetOsdTimer = false;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          send({ type: 'toggle-play' });
          shouldResetOsdTimer = true;
          break;
        case 'ArrowLeft':
          e.preventDefault();
          send({ type: 'seek-delta', delta: -5 });
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.repeat) break;
          if (!longPressActiveRef.current && !longPressTimerRef.current) {
            longPressTimerRef.current = window.setTimeout(() => {
              longPressTimerRef.current = null;
              longPressActiveRef.current = true;
              send({ type: 'rate-temp', rate: syncRef.current?.longPressSpeed ?? 2.5 });
            }, 280);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          send({ type: 'volume-delta', delta: 5 });
          break;
        case 'ArrowDown':
          e.preventDefault();
          send({ type: 'volume-delta', delta: -5 });
          break;
        case 'KeyM':
          e.preventDefault();
          send({ type: 'toggle-mute' });
          break;
        case 'BracketLeft':
          e.preventDefault();
          send({ type: 'rate-step', direction: 'down' });
          break;
        case 'BracketRight':
          e.preventDefault();
          send({ type: 'rate-step', direction: 'up' });
          break;
        case 'Backslash':
          e.preventDefault();
          send({ type: 'rate-step', direction: 'reset' });
          break;
        case 'Period':
          if (!state.isLoading) {
            e.preventDefault();
            send({ type: 'frame-step', direction: 'forward' });
          }
          break;
        case 'Comma':
          if (!state.isLoading) {
            e.preventDefault();
            send({ type: 'frame-step', direction: 'backward' });
          }
          break;
        case 'KeyD':
          e.preventDefault();
          send({ type: 'toggle-danmaku' });
          break;
        case 'KeyG':
          e.preventDefault();
          send({ type: 'danmaku-offset-delta', delta: -0.5 });
          break;
        case 'KeyH':
          e.preventDefault();
          send({ type: 'danmaku-offset-delta', delta: 0.5 });
          break;
        case 'KeyZ':
          e.preventDefault();
          send({ type: 'sub-delay-delta', delta: -0.5 });
          break;
        case 'KeyX':
          e.preventDefault();
          send({ type: 'sub-delay-delta', delta: 0.5 });
          break;
        case 'KeyC':
          e.preventDefault();
          send({ type: 'cycle-subtitle' });
          break;
        case 'KeyA':
          e.preventDefault();
          send({ type: 'cycle-audio' });
          break;
        case 'KeyL':
          e.preventDefault();
          send({ type: 'skip-intro' });
          break;
        case 'KeyS':
          e.preventDefault();
          send({ type: 'screenshot' });
          break;
        case 'KeyF':
        case 'Escape':
          e.preventDefault();
          send({ type: 'toggle-fullscreen' });
          shouldResetOsdTimer = true;
          break;
      }
      if (shouldResetOsdTimer) {
        resetHideTimer();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight') {
        if (longPressTimerRef.current) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          send({ type: 'seek-delta', delta: 5 });
        } else if (longPressActiveRef.current) {
          longPressActiveRef.current = false;
          send({ type: 'rate-temp', rate: null });
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
        send({ type: 'rate-temp', rate: null });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (longPressActiveRef.current) {
        longPressActiveRef.current = false;
        send({ type: 'rate-temp', rate: null });
      }
    };
  }, [resetHideTimer, send]);

  if (!sync) {
    return <div className="fixed inset-0 bg-transparent pointer-events-none" />;
  }

  return (
    <div
      onWheel={handleWheel}
      className="fixed inset-0 bg-transparent select-none overflow-hidden"
    >
      <DanmakuLayer
        bridge={bridgeRef.current}
        comments={comments}
        visible={sync.danmakuVisible}
        speed={sync.danmakuStyle.speed}
        opacity={sync.danmakuStyle.opacity}
        area={sync.danmakuStyle.area}
        maxLines={sync.danmakuStyle.maxLines}
        bottomMargin={sync.danmakuStyle.bottomMargin}
      />

      <MiniActionHud
        hud={sync.miniHud ?? null}
        fastForwardRate={sync.fastForwardRate ?? null}
      />

      <PlayerOsd
        overlayMode
        title={sync.title}
        subtitle={sync.subtitle}
        visible={osdVisible}
        paused={sync.paused}
        currentTime={sync.currentTime}
        duration={sync.duration}
        volume={sync.volume}
        playbackRate={sync.playbackRate}
        engineType={sync.engineType}
        telemetry={sync.telemetry}
        videoSpecLabel={sync.videoSpecLabel}
        networkSpeed={sync.networkSpeed}
        proxyInfo={sync.proxyInfo}
        chapters={sync.chapters}
        danmakuHeatmap={sync.danmakuHeatmap}
        showHeatmap={sync.showHeatmap}
        abLoopA={sync.abLoopA}
        abLoopB={sync.abLoopB}
        showRemainingTime={sync.showRemainingTime}
        onToggleRemainingTime={() => send({ type: 'toggle-remaining-time' })}
        danmakuVisible={sync.danmakuVisible}
        danmakuCount={sync.danmakuCount}
        danmakuOffset={sync.danmakuOffset}
        matchedTitle={sync.matchedTitle}
        skipSegments={sync.skipSegments}
        audioTracks={sync.audioTracks}
        subtitleTracks={sync.subtitleTracks}
        selectedAudioId={sync.selectedAudioId}
        selectedSubtitleId={sync.selectedSubtitleId}
        isFullscreen
        isMaximized={false}
        onBack={() => send({ type: 'back' })}
        onHome={() => send({ type: 'home' })}
        onTogglePlay={() => send({ type: 'toggle-play' })}
        onSeek={(seconds) => send({ type: 'seek', seconds })}
        onVolumeChange={(volume) => send({ type: 'volume', volume })}
        onRateChange={(rate) => send({ type: 'rate', rate })}
        onToggleDanmaku={() => send({ type: 'toggle-danmaku' })}
        onToggleDanmakuDrawer={() => {}}
        onSelectAudioTrack={(id) => send({ type: 'select-audio', id })}
        onSelectSubtitleTrack={(id) => send({ type: 'select-subtitle', id })}
        onToggleWindowMode={() => {}}
        onToggleFullscreen={() => send({ type: 'toggle-fullscreen' })}
        onMarkIntroEnd={() => send({ type: 'mark-intro-end', seconds: sync.currentTime })}
        onMarkOutroStart={() => send({ type: 'mark-outro-start', seconds: sync.currentTime })}
        onClearSkipSegment={(field) => send({ type: 'clear-skip', field })}
        onVideoClick={handleVideoClick}
        onVideoDoubleClick={handleVideoDoubleClick}
      />

      <OutroSkipToast
        visible={Boolean(sync.outroToast?.visible)}
        remainingMs={sync.outroToast?.remainingMs ?? 0}
        totalMs={sync.outroToast?.totalMs ?? 8000}
        defaultAction={sync.skipOutroAction ?? 'ask'}
        onSkip={() => send({ type: 'skip-outro' })}
        onCancel={() => send({ type: 'cancel-outro' })}
      />

      <SkipNoticeToast message={sync.skipNotice ?? null} />
    </div>
  );
};

export default OsdOverlayPage;
