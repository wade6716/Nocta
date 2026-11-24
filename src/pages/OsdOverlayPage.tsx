import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { AlertCircle, Pause, Play, X } from 'lucide-react';
import { PlayerOsd } from '../components/player/PlayerOsd';
import { DanmakuLayer } from '../components/player/DanmakuLayer';
import { MpvDanmakuBridge } from '../components/player/MpvDanmakuBridge';
import { OutroSkipToast } from '../components/player/OutroSkipToast';
import { SkipNoticeToast } from '../components/player/SkipNoticeToast';
import { BufferingIndicator } from '../components/player/BufferingIndicator';
import { MiniActionHud, MiniHudState } from '../components/player/MiniActionHud';
import { PlayerContextMenu } from '../components/player/PlayerContextMenu';
import { ShortcutsModal } from '../components/player/ShortcutsModal';
import { EpisodeDrawer } from '../components/player/EpisodeDrawer';
import { VideoProPanel } from '../components/player/VideoProPanel';
import { NetworkProxyPopover } from '../components/player/NetworkProxyPopover';
import { PlaybackInfoModal } from '../components/player/PlaybackInfoModal';
import { UpNextOverlay } from '../components/player/UpNextOverlay';
import { DanmakuDrawer } from '../components/player/DanmakuDrawer';
import { NetworkProxyModal } from '../components/settings/NetworkProxyModal';
import { useAuthStore } from '../stores/useAuthStore';
import { useDanmuStore } from '../stores/useDanmuStore';
import { PlayerOverlayStorePatch, usePlayerStore } from '../stores/usePlayerStore';
import {
  OSD_OVERLAY_COMMENTS_EVENT,
  OSD_OVERLAY_COMMAND_EVENT,
  OSD_OVERLAY_RAW_COMMENTS_EVENT,
  OSD_OVERLAY_READY_EVENT,
  OSD_OVERLAY_SYNC_EVENT,
  OsdCommentsPayload,
  OsdCommand,
  OsdRawCommentsPayload,
  OsdSyncPayload,
} from '../player/osdOverlaySync';

type ActivePanelType =
  | 'none'
  | 'danmaku'
  | 'videoPro'
  | 'episodes'
  | 'network'
  | 'info'
  | 'shortcuts';

export const OsdOverlayPage: React.FC = () => {
  const [sync, setSync] = useState<OsdSyncPayload | null>(null);
  const [comments, setComments] = useState<OsdCommentsPayload>([]);
  const [rawComments, setRawComments] = useState<OsdRawCommentsPayload>([]);
  const [osdVisible, setOsdVisible] = useState(true);

  const [activePanel, setActivePanel] = useState<ActivePanelType>('none');
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  });

  // 从本地镜像 Store 实时读取弹幕/调校/布局状态，保证全屏下拉动滑块 60fps 零等待反馈
  const danmakuSettings = usePlayerStore((s) => s.danmakuSettings);
  const playerPreferences = usePlayerStore((s) => s.playerPreferences);
  const videoLayouts = usePlayerStore((s) => s.videoLayouts);
  const itemOffsets = usePlayerStore((s) => s.itemOffsets);
  const seriesOffsets = usePlayerStore((s) => s.seriesOffsets);

  const bridgeRef = useRef(new MpvDanmakuBridge());
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const shownRef = useRef(false);
  const syncRef = useRef<OsdSyncPayload | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressActiveRef = useRef(false);
  const applyingRemoteStoreRef = useRef(false);
  const lastStoreRevisionRef = useRef<number>(0);
  const isAnyPanelOpenRef = useRef(false);

  syncRef.current = sync;
  const isAnyPanelOpen =
    activePanel !== 'none' || isProxyModalOpen || contextMenu.visible;
  isAnyPanelOpenRef.current = isAnyPanelOpen;

  const send = useCallback((command: OsdCommand) => {
    void emit(OSD_OVERLAY_COMMAND_EVENT, command);
  }, []);

  // 双向 Store 同步桥：将全屏内各面板的设置变更实时回传主窗口持久化并作用于 libmpv
  useEffect(() => {
    const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
      if (applyingRemoteStoreRef.current) return;
      const patch: PlayerOverlayStorePatch = {};
      let changed = false;

      if (state.danmakuSettings !== prev.danmakuSettings) {
        patch.danmakuSettings = state.danmakuSettings;
        changed = true;
      }
      if (state.playerPreferences !== prev.playerPreferences) {
        patch.playerPreferences = state.playerPreferences;
        changed = true;
      }
      if (state.videoLayouts !== prev.videoLayouts) {
        patch.videoLayouts = state.videoLayouts;
        changed = true;
      }
      if (state.itemOffsets !== prev.itemOffsets) {
        patch.itemOffsets = state.itemOffsets;
        changed = true;
      }
      if (state.seriesOffsets !== prev.seriesOffsets) {
        patch.seriesOffsets = state.seriesOffsets;
        changed = true;
      }
      if (state.danmakuBindings !== prev.danmakuBindings) {
        patch.danmakuBindings = state.danmakuBindings;
        changed = true;
      }
      if (state.seriesDanmakuBindings !== prev.seriesDanmakuBindings) {
        patch.seriesDanmakuBindings = state.seriesDanmakuBindings;
        changed = true;
      }
      if (state.skipSegments !== prev.skipSegments) {
        patch.skipSegments = state.skipSegments;
        changed = true;
      }
      if (state.skipSettings !== prev.skipSettings) {
        patch.skipSettings = state.skipSettings;
        changed = true;
      }
      if (state.engineType !== prev.engineType) {
        patch.engineType = state.engineType;
        changed = true;
      }

      if (changed) {
        send({ type: 'sync-player-store', patch });
      }
    });

    const unsubDanmu = useDanmuStore.subscribe((state, prev) => {
      if (state.servers !== prev.servers || state.activeServerId !== prev.activeServerId) {
        send({
          type: 'sync-danmu-store',
          servers: state.servers,
          activeServerId: state.activeServerId,
        });
      }
    });

    return () => {
      unsubPlayer();
      unsubDanmu();
    };
  }, [send]);

  // 接收主窗口推送的播放状态、格式化弹幕与原始弹幕列表
  useEffect(() => {
    const unlistenSync = listen<OsdSyncPayload>(OSD_OVERLAY_SYNC_EVENT, (event) => {
      const payload = event.payload;
      setSync(payload);

      if (
        payload.storeSnapshot &&
        payload.storeSnapshot.revision !== lastStoreRevisionRef.current
      ) {
        lastStoreRevisionRef.current = payload.storeSnapshot.revision;
        applyingRemoteStoreRef.current = true;
        try {
          usePlayerStore
            .getState()
            .applyRemoteStoreSnapshot(payload.storeSnapshot, false);
        } finally {
          applyingRemoteStoreRef.current = false;
        }
      }

      const bridge = bridgeRef.current;
      bridge.onMpvTimePos(payload.currentTime);
      bridge.onMpvPauseChange(payload.paused || payload.isLoading || Boolean(payload.isBuffering));
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

    const unlistenRawComments = listen<OsdRawCommentsPayload>(
      OSD_OVERLAY_RAW_COMMENTS_EVENT,
      (event) => {
        setRawComments(event.payload);
      }
    );

    void emit(OSD_OVERLAY_READY_EVENT);

    return () => {
      unlistenSync.then((unlisten) => unlisten());
      unlistenComments.then((unlisten) => unlisten());
      unlistenRawComments.then((unlisten) => unlisten());
    };
  }, []);

  // OSD 自动显隐：与主窗口保持一致（开启任意抽屉/菜单或暂停时不自动隐藏，闲置 3.5 秒淡出）
  const resetHideTimer = useCallback(() => {
    setOsdVisible(true);
    document.body.style.cursor = 'default';

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }

    if (!isAnyPanelOpenRef.current && !syncRef.current?.paused && !syncRef.current?.isLoading) {
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
  }, [resetHideTimer, sync?.paused, sync?.isLoading, isAnyPanelOpen]);

  const handleVideoClick = useCallback(() => {
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
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      send({ type: 'toggle-play' });
      clickTimerRef.current = null;
    }, 240);
  }, [contextMenu.visible, activePanel, send]);

  const handleVideoDoubleClick = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (activePanel !== 'none') {
        setActivePanel('none');
        return;
      }
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      send({ type: 'toggle-fullscreen' });
    },
    [activePanel, send]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (isAnyPanelOpenRef.current || !syncRef.current || syncRef.current.isLoading) return;
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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  // 浮层是当前 key window，完整接管与 PlayerPage 一致的全部快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = syncRef.current;
      if (!state) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        e.preventDefault();
        setActivePanel((prev) => (prev === 'shortcuts' ? 'none' : 'shortcuts'));
        return;
      }

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
        case 'KeyN':
          if (state.hasNextEpisode) {
            e.preventDefault();
            send({ type: 'next-episode' });
          }
          break;
        case 'KeyP':
          if (state.hasPrevEpisode) {
            e.preventDefault();
            send({ type: 'prev-episode' });
          }
          break;
        case 'KeyS':
          e.preventDefault();
          send({ type: 'screenshot' });
          break;
        case 'KeyI':
          e.preventDefault();
          setActivePanel((prev) => (prev === 'info' ? 'none' : 'info'));
          break;
        case 'KeyF':
          e.preventDefault();
          send({ type: 'toggle-fullscreen' });
          shouldResetOsdTimer = true;
          break;
        case 'Escape':
          e.preventDefault();
          if (contextMenu.visible) {
            setContextMenu((prev) => ({ ...prev, visible: false }));
          } else if (isProxyModalOpen) {
            setIsProxyModalOpen(false);
          } else if (activePanel !== 'none') {
            setActivePanel('none');
          } else {
            send({ type: 'toggle-fullscreen' });
            shouldResetOsdTimer = true;
          }
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
  }, [resetHideTimer, send, contextMenu.visible, isProxyModalOpen, activePanel]);

  const effectiveDanmakuStyle = sync?.storeSnapshot ? danmakuSettings : sync?.danmakuStyle;
  const effectiveDanmakuVisible = sync?.storeSnapshot
    ? danmakuSettings.visible
    : sync?.danmakuVisible ?? true;
  const effectiveShowHeatmap = sync?.storeSnapshot
    ? danmakuSettings.showHeatmap
    : sync?.showHeatmap ?? true;
  const effectiveShowRemainingTime = sync?.storeSnapshot
    ? playerPreferences.showRemainingTime
    : sync?.showRemainingTime ?? false;
  const effectiveVideoAspect = sync?.storeSnapshot
    ? playerPreferences.videoAspect
    : 'auto';

  const effectiveOffset = useMemo(() => {
    if (!sync) return 0;
    const itemId = sync.item?.Id;
    const seriesId = sync.item?.SeriesId;
    if (itemId && itemOffsets[itemId] !== undefined) return itemOffsets[itemId];
    if (seriesId && seriesOffsets[seriesId] !== undefined) return seriesOffsets[seriesId];
    return sync.danmakuOffset;
  }, [sync, itemOffsets, seriesOffsets]);

  const layoutKey = sync?.layoutKey || '';
  const currentLayout = (layoutKey && videoLayouts[layoutKey]) || {
    bottomAlign: playerPreferences.defaultBottomAlign,
    verticalOffset: 100,
  };

  if (!sync) {
    return <div className="fixed inset-0 bg-transparent pointer-events-none" />;
  }

  const seasons = sync.seasons || [];
  const episodes = sync.episodes || [];
  const availableMediaSources = sync.availableMediaSources || [];
  const miniHudState: MiniHudState | null = sync.miniHud
    ? {
        ...sync.miniHud,
        ...(sync.miniHud.icon === 'screenshot' && sync.miniHud.subLabel
          ? {
              actionLabel: '打开目录',
              onAction: () =>
                invoke('show_in_file_manager', { path: sync.miniHud!.subLabel! }).catch(() => {}),
            }
          : {}),
      }
    : null;

  return (
    <div
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      className="fixed inset-0 bg-transparent select-none overflow-hidden"
    >
      {/* 屏幕中央播放/暂停瞬时动效徽标 */}
      {sync.centerIcon && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
          <div className="p-5 rounded-full bg-black/60 backdrop-blur-md text-white border border-white/10 animate-in zoom-in-75 fade-in duration-150">
            {sync.centerIcon === 'play' ? (
              <Play className="w-9 h-9 fill-white translate-x-0.5" />
            ) : (
              <Pause className="w-9 h-9 fill-white" />
            )}
          </div>
        </div>
      )}

      <MiniActionHud hud={miniHudState} fastForwardRate={sync.fastForwardRate ?? null} />

      <BufferingIndicator
        visible={Boolean(sync.isBuffering) && !sync.isLoading && !sync.centerIcon}
        networkSpeed={sync.networkSpeed}
      />

      <DanmakuLayer
        bridge={bridgeRef.current}
        comments={comments}
        visible={effectiveDanmakuVisible}
        speed={effectiveDanmakuStyle?.speed ?? sync.danmakuStyle.speed}
        opacity={effectiveDanmakuStyle?.opacity ?? sync.danmakuStyle.opacity}
        area={effectiveDanmakuStyle?.area ?? sync.danmakuStyle.area}
        maxLines={effectiveDanmakuStyle?.maxLines ?? sync.danmakuStyle.maxLines}
        bottomMargin={effectiveDanmakuStyle?.bottomMargin ?? sync.danmakuStyle.bottomMargin}
      />

      {/* 跳过片头胶囊 & 下一集自动连播倒计时浮窗 */}
      <UpNextOverlay
        showSkipIntro={Boolean(sync.showSkipIntro)}
        onSkipIntro={() => send({ type: 'skip-intro' })}
        nextEpisode={sync.nextEpisode ?? null}
        serverUrl={sync.currentServerUrl}
        countdownSeconds={sync.outroToast?.visible ? null : sync.autoNextCountdown ?? null}
        onPlayNextNow={() => send({ type: 'next-episode' })}
        onCancelAutoNext={() => send({ type: 'cancel-auto-next' })}
      />

      <PlayerOsd
        overlayMode
        title={sync.title}
        subtitle={sync.subtitle}
        visible={osdVisible || sync.isLoading}
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
        showHeatmap={effectiveShowHeatmap}
        abLoopA={sync.abLoopA}
        abLoopB={sync.abLoopB}
        showRemainingTime={effectiveShowRemainingTime}
        onToggleRemainingTime={() => send({ type: 'toggle-remaining-time' })}
        hasNextEpisode={Boolean(sync.hasNextEpisode)}
        onNextEpisode={() => send({ type: 'next-episode' })}
        availableMediaSources={availableMediaSources}
        activeMediaSourceId={sync.mediaSource?.Id}
        onSelectMediaSource={(ms) => send({ type: 'select-media-source', mediaSourceId: ms.Id })}
        danmakuVisible={effectiveDanmakuVisible}
        danmakuCount={rawComments.length > 0 ? rawComments.length : sync.danmakuCount}
        danmakuOffset={effectiveOffset}
        matchedTitle={sync.matchedTitle}
        skipSegments={sync.skipSegments}
        audioTracks={sync.audioTracks}
        subtitleTracks={sync.subtitleTracks}
        selectedAudioId={sync.selectedAudioId}
        selectedSubtitleId={sync.selectedSubtitleId}
        selectedSecondarySubtitleId={sync.selectedSecondarySubtitleId}
        isFullscreen
        isMaximized={false}
        isDanmakuDrawerOpen={activePanel === 'danmaku'}
        isVideoProPanelOpen={activePanel === 'videoPro'}
        isEpisodeDrawerOpen={activePanel === 'episodes'}
        isNetworkPopoverOpen={activePanel === 'network'}
        isPlaybackInfoOpen={activePanel === 'info'}
        onBack={() => send({ type: 'back' })}
        onHome={() => send({ type: 'home' })}
        onTogglePlay={() => send({ type: 'toggle-play' })}
        onSeek={(seconds) => send({ type: 'seek', seconds })}
        onVolumeChange={(volume) => send({ type: 'volume', volume })}
        onRateChange={(rate) => send({ type: 'rate', rate })}
        onToggleDanmaku={() => send({ type: 'toggle-danmaku' })}
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
        onTogglePlaybackInfo={() =>
          setActivePanel((p) => (p === 'info' ? 'none' : 'info'))
        }
        onSelectAudioTrack={(id) => send({ type: 'select-audio', id })}
        onSelectSubtitleTrack={(id) => send({ type: 'select-subtitle', id })}
        onToggleWindowMode={() => send({ type: 'toggle-window-mode' })}
        onToggleFullscreen={() => send({ type: 'toggle-fullscreen' })}
        onMarkIntroEnd={() => send({ type: 'mark-intro-end', seconds: sync.currentTime })}
        onMarkOutroStart={() => send({ type: 'mark-outro-start', seconds: sync.currentTime })}
        onClearSkipSegment={(field) => send({ type: 'clear-skip', field })}
        onVideoClick={handleVideoClick}
        onVideoDoubleClick={handleVideoDoubleClick}
      />

      {/* 右键快捷菜单 */}
      {contextMenu.visible && (
        <PlayerContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
          paused={sync.paused}
          hasNextEpisode={Boolean(sync.hasNextEpisode)}
          hasPrevEpisode={Boolean(sync.hasPrevEpisode)}
          playbackRate={sync.playbackRate}
          danmakuVisible={effectiveDanmakuVisible}
          isPinned={false}
          isBottomAlign={currentLayout.bottomAlign}
          videoAspect={effectiveVideoAspect}
          proxySummary={sync.proxySummaryLabel || '直连'}
          showEpisodesEntry={episodes.length > 0 || availableMediaSources.length > 1}
          onTogglePlay={() => send({ type: 'toggle-play' })}
          onNextEpisode={() => send({ type: 'next-episode' })}
          onPrevEpisode={() => send({ type: 'prev-episode' })}
          onSkipIntro={() => send({ type: 'skip-intro' })}
          onRateChange={(rate) => send({ type: 'rate', rate })}
          onToggleDanmaku={() => send({ type: 'toggle-danmaku' })}
          onToggleBottomAlign={() => send({ type: 'toggle-bottom-align' })}
          onCycleAspect={() => send({ type: 'cycle-aspect' })}
          onOpenDanmakuDrawer={() => setActivePanel('danmaku')}
          onOpenVideoPro={() => setActivePanel('videoPro')}
          onOpenNetworkPopover={() => setActivePanel('network')}
          onOpenEpisodeDrawer={() => setActivePanel('episodes')}
          onTakeScreenshot={() => send({ type: 'screenshot' })}
          onOpenPlaybackInfo={() => setActivePanel('info')}
          onOpenShortcuts={() => setActivePanel('shortcuts')}
        />
      )}

      <OutroSkipToast
        visible={Boolean(sync.outroToast?.visible)}
        remainingMs={sync.outroToast?.remainingMs ?? 0}
        totalMs={sync.outroToast?.totalMs ?? 8000}
        defaultAction={sync.skipOutroAction ?? 'ask'}
        onSkip={() => send({ type: 'skip-outro' })}
        onCancel={() => send({ type: 'cancel-outro' })}
      />

      {/* 弹幕加载或绑定提示 Toast */}
      {sync.danmuToast && (
        <div className="fixed top-20 right-6 z-40 max-w-md bg-black/85 backdrop-blur-md border border-primary/40 text-white text-xs px-4 py-2.5 rounded-xl flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-ping flex-shrink-0" />
          <span className="font-medium truncate">{sync.danmuToast}</span>
        </div>
      )}

      <SkipNoticeToast message={sync.skipNotice ?? null} />

      {/* 时长偏差提示 Banner */}
      {sync.durationAlert && (
        <div className="fixed top-32 right-6 z-40 max-w-sm bg-black/80 backdrop-blur-md border border-yellow-500/30 text-yellow-300 text-xs p-3 rounded-xl flex items-start space-x-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-yellow-400 mt-0.5" />
          <div className="flex-1 leading-relaxed">{sync.durationAlert}</div>
          <button
            onClick={() => send({ type: 'dismiss-duration-alert' })}
            className="text-gray-400 hover:text-white ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 右侧专注面板 1: 弹幕控制中心 */}
      {sync.item && (
        <DanmakuDrawer
          isOpen={activePanel === 'danmaku'}
          onClose={() => setActivePanel('none')}
          bridge={bridgeRef.current}
          itemId={sync.item.Id}
          seriesId={sync.item.SeriesId}
          itemTitle={sync.item.Name}
          seriesName={sync.item.SeriesName}
          episodeNumber={sync.item.IndexNumber}
          currentMatchedTitle={sync.matchedTitle}
          sourceCommentCount={
            rawComments.length > 0 ? rawComments.length : sync.danmakuCount
          }
          sourceDuration={sync.sourceDuration}
          videoDuration={sync.duration}
          rawComments={rawComments}
          currentTime={activePanel === 'danmaku' ? Math.floor(sync.currentTime) : 0}
          onSeekToTime={(sec) => send({ type: 'seek', seconds: sec })}
          onCommentsLoaded={(newComments, sourceDuration, meta) =>
            send({
              type: 'comments-loaded',
              comments: newComments,
              sourceDuration,
              meta,
            })
          }
          onReAutoMatch={() => send({ type: 're-auto-match' })}
        />
      )}

      {/* 右侧专注面板 2: 画质、硬解与音字幕 Pro 调校 */}
      {activePanel === 'videoPro' && sync.item && (
        <VideoProPanel
          isOpen
          onClose={() => setActivePanel('none')}
          layoutKey={layoutKey}
          seriesName={sync.item.SeriesName}
          videoAspectRatio={sync.videoAspectRatio}
          isWidescreen={Boolean(sync.isWidescreen)}
          telemetry={sync.telemetry || {}}
          subtitleTracks={sync.subtitleTracks}
          selectedSubtitleId={sync.selectedSubtitleId}
          selectedSecondarySubtitleId={sync.selectedSecondarySubtitleId ?? null}
          onSelectSubtitleTrack={(id) => send({ type: 'select-subtitle', id })}
          onSelectSecondarySubtitleTrack={(id) =>
            send({ type: 'select-secondary-subtitle', id })
          }
          abLoopA={sync.abLoopA ?? null}
          abLoopB={sync.abLoopB ?? null}
          onSetAbLoop={(point) => send({ type: 'set-ab-loop', point })}
          onTakeScreenshot={() => send({ type: 'screenshot' })}
          volume={sync.volume}
          onVolumeChange={(volume) => send({ type: 'volume', volume })}
          hasNextEpisode={Boolean(sync.hasNextEpisode)}
          nextPreloadStatus={sync.nextPreloadStatus ?? null}
        />
      )}

      {/* 右侧专注面板 3: 分集列表与多版本原画源 */}
      {activePanel === 'episodes' && sync.item && (
        <EpisodeDrawer
          isOpen
          onClose={() => setActivePanel('none')}
          currentItemId={sync.item.Id}
          seasons={seasons}
          selectedSeasonId={sync.selectedSeasonId ?? null}
          onSelectSeason={(seasonId) => send({ type: 'select-season', seasonId })}
          episodes={episodes}
          episodesLoading={Boolean(sync.episodesLoading)}
          serverUrl={sync.currentServerUrl}
          onSelectEpisode={(ep) => send({ type: 'select-episode', episodeId: ep.Id })}
          availableMediaSources={availableMediaSources}
          activeMediaSourceId={sync.mediaSource?.Id}
          onSelectMediaSource={(ms) =>
            send({ type: 'select-media-source', mediaSourceId: ms.Id })
          }
          autoPlayNext={playerPreferences.autoPlayNext}
          onToggleAutoPlayNext={(val) =>
            usePlayerStore.getState().updatePlayerPreferences({ autoPlayNext: val })
          }
        />
      )}

      {/* 浮动面板 4: 网络缓冲监控与代理快切 */}
      {activePanel === 'network' && (
        <NetworkProxyPopover
          isOpen
          onClose={() => setActivePanel('none')}
          networkSpeed={sync.networkSpeed}
          speedHistory={sync.speedHistory || []}
          telemetry={sync.telemetry || {}}
          proxyInfo={sync.proxyInfo ?? null}
          proxyOverride={sync.proxyOverride || 'follow'}
          onChangeProxyOverride={(mode) => send({ type: 'change-proxy-override', mode })}
          onReloadStream={() => send({ type: 'reload-stream' })}
          onOpenProxySettings={() => setIsProxyModalOpen(true)}
        />
      )}

      {/* 居中浮层 5: 实时硬解与媒体技术信息 HUD */}
      {activePanel === 'info' && sync.item && (
        <PlaybackInfoModal
          isOpen
          onClose={() => setActivePanel('none')}
          item={sync.item}
          mediaSource={sync.mediaSource ?? null}
          streamUrl={sync.streamUrl ?? null}
          engineType={sync.engineType || 'mpv'}
          currentTime={sync.currentTime}
          duration={sync.duration}
          playbackRate={sync.playbackRate}
          audioTracks={sync.audioTracks}
          subtitleTracks={sync.subtitleTracks}
          selectedAudioId={sync.selectedAudioId}
          selectedSubtitleId={sync.selectedSubtitleId}
          currentServerName={sync.currentServerName}
          danmakuMatchedTitle={sync.matchedTitle}
          danmakuCount={
            rawComments.length > 0 ? rawComments.length : sync.danmakuCount
          }
          danmakuOffset={effectiveOffset}
          networkSpeed={sync.networkSpeed}
          telemetry={sync.telemetry}
          proxyInfo={sync.proxyInfo}
          userAgent={sync.userAgent}
          nextPreloadStatus={sync.nextPreloadStatus ?? null}
        />
      )}

      {/* 居中浮层 6: 快捷键与手势指南 */}
      {activePanel === 'shortcuts' && (
        <ShortcutsModal isOpen onClose={() => setActivePanel('none')} />
      )}

      {/* 详细网络与代理配置弹窗（保存后回传主窗口原地热重载视频流） */}
      {isProxyModalOpen && (
        <NetworkProxyModal
          isOpen
          onClose={() => setIsProxyModalOpen(false)}
          onSaved={() =>
            send({
              type: 'sync-proxy-config',
              config: useAuthStore.getState().globalProxyConfig,
            })
          }
        />
      )}
    </div>
  );
};

export default OsdOverlayPage;
