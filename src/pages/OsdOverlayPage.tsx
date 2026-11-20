import React, { useCallback, useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { PlayerOsd } from '../components/player/PlayerOsd';
import { DanmakuLayer } from '../components/player/DanmakuLayer';
import { MpvDanmakuBridge } from '../components/player/MpvDanmakuBridge';
import { OutroSkipToast } from '../components/player/OutroSkipToast';
import { SkipNoticeToast } from '../components/player/SkipNoticeToast';
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

  // 浮层是当前 key window，需要自行接管播放器快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = syncRef.current;
      if (!state) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          send({ type: 'toggle-play' });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          send({ type: 'seek', seconds: Math.max(0, state.currentTime - 5) });
          break;
        case 'ArrowRight':
          e.preventDefault();
          send({ type: 'seek', seconds: Math.min(state.duration, state.currentTime + 5) });
          break;
        case 'ArrowUp':
          e.preventDefault();
          send({ type: 'volume', volume: Math.min(100, state.volume + 5) });
          break;
        case 'ArrowDown':
          e.preventDefault();
          send({ type: 'volume', volume: Math.max(0, state.volume - 5) });
          break;
        case 'KeyD':
          e.preventDefault();
          send({ type: 'toggle-danmaku' });
          break;
        case 'KeyF':
        case 'Escape':
          e.preventDefault();
          send({ type: 'toggle-fullscreen' });
          break;
      }
      resetHideTimer();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetHideTimer, send]);

  if (!sync) {
    return <div className="fixed inset-0 bg-transparent pointer-events-none" />;
  }

  return (
    <div className="fixed inset-0 bg-transparent select-none overflow-hidden">
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
        networkSpeed={sync.networkSpeed}
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
