import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { MiniHudState } from '../../components/player/MiniActionHud';

interface MediaControlEventPayload {
  action: 'play' | 'pause' | 'toggle' | 'stop' | 'next' | 'previous';
  source: string;
}

interface AudioOutputChangedPayload {
  reason: string;
  shouldPause: boolean;
  previousDeviceName?: string | null;
  currentDeviceName?: string | null;
}

export interface UseMediaSessionControllerOptions {
  isTauri: boolean;
  itemId?: string | null;
  title?: string | null;
  subtitle?: string | null;
  duration: number;
  paused: boolean;
  isLoadingVideo: boolean;
  hasError: boolean;
  getCurrentTime: () => number;
  pauseOnHeadphoneDisconnect: boolean;
  onPlay: () => void;
  onPause: () => void;
  onTogglePlay: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  showMiniHud: (hud: Omit<MiniHudState, 'id'>, durationMs?: number) => void;
}

/**
 * 操作系统媒体会话与耳机/音频输出设备断连监听控制器：
 * - 通过 Rust `souvlaki` (Windows SMTC / macOS Now Playing / Linux MPRIS2) 注册媒体会话并接收蓝牙耳机 AVRCP 摘下暂停及媒体键；
 * - 监听原生音频输出设备切换/断开（Windows WASAPI IMMNotificationClient / macOS CoreAudio / Linux devicechange fallback），
 *   并在检测到耳机断开或退回扬声器时自动暂停播放。
 */
export function useMediaSessionController({
  isTauri,
  itemId,
  title,
  subtitle,
  duration,
  paused,
  isLoadingVideo,
  hasError,
  getCurrentTime,
  pauseOnHeadphoneDisconnect,
  onPlay,
  onPause,
  onTogglePlay,
  onNextEpisode,
  onPrevEpisode,
  showMiniHud,
}: UseMediaSessionControllerOptions) {
  const pausedRef = useRef(paused);
  const loadingRef = useRef(isLoadingVideo);
  const errorRef = useRef(hasError);
  const pauseOnDisconnectRef = useRef(pauseOnHeadphoneDisconnect);
  const getTimeRef = useRef(getCurrentTime);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onToggleRef = useRef(onTogglePlay);
  const onNextRef = useRef(onNextEpisode);
  const onPrevRef = useRef(onPrevEpisode);
  const showMiniHudRef = useRef(showMiniHud);

  pausedRef.current = paused;
  loadingRef.current = isLoadingVideo;
  errorRef.current = hasError;
  pauseOnDisconnectRef.current = pauseOnHeadphoneDisconnect;
  getTimeRef.current = getCurrentTime;
  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;
  onToggleRef.current = onTogglePlay;
  onNextRef.current = onNextEpisode;
  onPrevRef.current = onPrevEpisode;
  showMiniHudRef.current = showMiniHud;

  // 1. 同步当前播放元数据到系统媒体中心与 navigator.mediaSession
  useEffect(() => {
    if (!itemId) return;

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title || 'Nocta · 夜幕',
          artist: subtitle || '',
          album: 'Nocta · 夜幕',
        });
      } catch {
        // 忽略不受支持的 WebView 环境
      }
    }

    if (isTauri) {
      invoke('sync_media_session_metadata', {
        title: title || 'Nocta · 夜幕',
        subtitle: subtitle || null,
        durationSecs: Number.isFinite(duration) && duration > 0 ? duration : null,
      }).catch(() => {});
    }
  }, [isTauri, itemId, title, subtitle, duration]);

  // 2. 同步播放/暂停状态与进度位置（播放中每 5s 刷新一次进度）
  useEffect(() => {
    if (!itemId) return;

    const pushState = () => {
      const stateStr = hasError ? 'stopped' : paused ? 'paused' : 'playing';
      const pos = Math.max(0, getTimeRef.current() || 0);

      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState =
            stateStr === 'playing' ? 'playing' : stateStr === 'paused' ? 'paused' : 'none';
        } catch {
          // 忽略
        }
      }

      if (isTauri) {
        invoke('sync_media_session_playback', {
          playbackState: stateStr,
          positionSecs: stateStr === 'stopped' ? null : pos,
        }).catch(() => {});
      }
    };

    pushState();

    if (paused || isLoadingVideo || hasError || !isTauri) {
      return;
    }

    const timer = window.setInterval(pushState, 5000);
    return () => window.clearInterval(timer);
  }, [isTauri, itemId, paused, isLoadingVideo, hasError]);

  // 离开播放页时通知系统注销活跃播放状态
  useEffect(() => {
    return () => {
      if (isTauri) {
        invoke('sync_media_session_playback', {
          playbackState: 'stopped',
          positionSecs: null,
        }).catch(() => {});
        invoke('sync_media_session_metadata', {
          title: null,
          subtitle: null,
          durationSecs: null,
        }).catch(() => {});
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch {
          // 忽略
        }
      }
    };
  }, [isTauri]);

  // 3. 监听系统媒体键 / 蓝牙 AVRCP 入耳检测事件 & 原生音频设备断连事件
  useEffect(() => {
    const handleAutoPause = (label: string, subLabel?: string) => {
      if (loadingRef.current || errorRef.current || pausedRef.current) return;
      onPauseRef.current();
      showMiniHudRef.current(
        {
          icon: 'headphones',
          label,
          subLabel,
        },
        3000
      );
    };

    const unlisteners: Promise<UnlistenFn>[] = [];

    if (isTauri) {
      unlisteners.push(
        listen<MediaControlEventPayload>('media://control', (event) => {
          const payload = event.payload;
          if (!payload || loadingRef.current || errorRef.current) return;

          switch (payload.action) {
            case 'pause':
            case 'stop':
              if (!pausedRef.current) {
                handleAutoPause('已响应耳机/系统媒体暂停', '按空格或媒体键可恢复播放');
              }
              break;
            case 'play':
              if (pausedRef.current) {
                onPlayRef.current();
              }
              break;
            case 'toggle':
              onToggleRef.current();
              break;
            case 'next':
              onNextRef.current?.();
              break;
            case 'previous':
              onPrevRef.current?.();
              break;
          }
        })
      );

      unlisteners.push(
        listen<AudioOutputChangedPayload>('media://audio-output-changed', (event) => {
          const payload = event.payload;
          if (!payload?.shouldPause || !pauseOnDisconnectRef.current) return;

          const subLabel =
            payload.previousDeviceName && payload.currentDeviceName
              ? `${payload.previousDeviceName} → ${payload.currentDeviceName}`
              : payload.previousDeviceName || '音频输出设备已断开或切换至外放';

          handleAutoPause('检测到耳机断开，已自动暂停', subLabel);
        })
      );
    }

    // Web MediaSession API 兜底（HTML5 / 浏览器调试模式及系统键兼容）
    const registeredWebActions: Array<MediaSessionAction> = [];
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      const bindWebAction = (action: MediaSessionAction, handler: (() => void) | null) => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
          if (handler) registeredWebActions.push(action);
        } catch {
          // 忽略不支持的 action
        }
      };

      bindWebAction('play', () => {
        if (!loadingRef.current && !errorRef.current && pausedRef.current) {
          onPlayRef.current();
        }
      });
      bindWebAction('pause', () => {
        handleAutoPause('已响应耳机/媒体键暂停');
      });
      bindWebAction('nexttrack', () => {
        onNextRef.current?.();
      });
      bindWebAction('previoustrack', () => {
        onPrevRef.current?.();
      });
    }

    // Linux 桌面端或纯浏览器兜底：监听音频输出设备数量减少（如拔下/断开蓝牙或有线耳机）
    let cleanupDeviceChange: (() => void) | undefined;
    const isLinuxDesktop =
      typeof navigator !== 'undefined' &&
      /Linux/i.test(navigator.userAgent) &&
      !/Android/i.test(navigator.userAgent);
    if (
      (!isTauri || isLinuxDesktop) &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.enumerateDevices
    ) {
      let lastOutputCount: number | null = null;
      const updateOutputs = async (isChangeEvent: boolean) => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const outputs = devices.filter((d) => d.kind === 'audiooutput').length;
          if (
            isChangeEvent &&
            lastOutputCount !== null &&
            outputs < lastOutputCount &&
            pauseOnDisconnectRef.current
          ) {
            handleAutoPause('检测到耳机断开，已自动暂停', '音频输出设备已移除');
          }
          lastOutputCount = outputs;
        } catch {
          // 忽略权限受限或不支持的 WebView
        }
      };

      void updateOutputs(false);
      const onDeviceChange = () => {
        void updateOutputs(true);
      };
      navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange);
      cleanupDeviceChange = () => {
        navigator.mediaDevices.removeEventListener?.('devicechange', onDeviceChange);
      };
    }

    return () => {
      unlisteners.forEach((p) => {
        p.then((unlisten) => unlisten()).catch(() => {});
      });
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        registeredWebActions.forEach((action) => {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch {
            // 忽略
          }
        });
      }
      cleanupDeviceChange?.();
    };
  }, [isTauri]);
}
