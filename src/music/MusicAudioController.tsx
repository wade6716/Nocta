import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useMusicPlayerStore } from '../stores/useMusicPlayerStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  buildAudioStreamCandidates,
  formatTrackArtists,
} from '../api/embyMusicClient';
import {
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
} from '../api/embyClient';
import { isTauriEnvironment } from '../api/http';

interface MediaControlEventPayload {
  action: 'play' | 'pause' | 'toggle' | 'stop' | 'next' | 'previous';
  source: string;
}

interface AudioOutputChangedPayload {
  reason: string;
  shouldPause: boolean;
}

export const MusicAudioController: React.FC = () => {
  const location = useLocation();
  const isVideoPlayerRoute = location.pathname.startsWith('/player');
  const isTauri = isTauriEnvironment();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);

  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const queue = useMusicPlayerStore((s) => s.queue);
  const sourceServer = useMusicPlayerStore((s) => s.sourceServer);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const volume = useMusicPlayerStore((s) => s.volume);
  const muted = useMusicPlayerStore((s) => s.muted);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const seekRequest = useMusicPlayerStore((s) => s.seekRequest);
  const duration = useMusicPlayerStore((s) => s.duration);

  const candidatesRef = useRef<string[]>([]);
  const candidateIndexRef = useRef(0);
  const playSessionIdRef = useRef<string>('');
  const preloadedTrackIdRef = useRef<string | null>(null);
  const activeReportRef = useRef<{
    serverUrl: string;
    accessToken: string;
    itemId: string;
    mediaSourceId: string;
    playSessionId: string;
  } | null>(null);

  // 1. 进入视频播放页时自动暂停音乐
  useEffect(() => {
    if (isVideoPlayerRoute && useMusicPlayerStore.getState().isPlaying) {
      useMusicPlayerStore.getState().pause();
    }
  }, [isVideoPlayerRoute]);

  // 2. 同步音量与静音状态
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
    audio.muted = muted;
  }, [volume, muted]);

  // 3. 响应进度拖拽 Seek 请求
  useEffect(() => {
    if (!seekRequest) return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.currentTime = seekRequest.time;
      const rep = activeReportRef.current;
      if (rep) {
        reportPlaybackProgress(
          rep.serverUrl,
          {
            itemId: rep.itemId,
            mediaSourceId: rep.mediaSourceId,
            playSessionId: rep.playSessionId,
            seconds: seekRequest.time,
            isPaused: !useMusicPlayerStore.getState().isPlaying,
            eventName: 'Seek',
          },
          rep.accessToken
        ).catch(() => {});
      }
    } catch {
      // ignore seek errors before metadata loaded
    }
  }, [seekRequest]);

  // 4. 切换歌曲并加载音频流 + Emby 上报
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // 停止上一首 Emby 会话上报
    const prevReport = activeReportRef.current;
    if (prevReport) {
      const lastSec = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      reportPlaybackStopped(
        prevReport.serverUrl,
        {
          itemId: prevReport.itemId,
          mediaSourceId: prevReport.mediaSourceId,
          playSessionId: prevReport.playSessionId,
          seconds: lastSec,
        },
        prevReport.accessToken
      ).catch(() => {});
      activeReportRef.current = null;
    }

    if (!currentTrack || !sourceServer) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }

    const candidates = buildAudioStreamCandidates(
      sourceServer.url,
      sourceServer.userId,
      currentTrack,
      sourceServer.accessToken
    );
    candidatesRef.current = candidates;
    candidateIndexRef.current = 0;
    preloadedTrackIdRef.current = null;

    const sessionId = `nocta-music-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    playSessionIdRef.current = sessionId;
    const mediaSourceId = currentTrack.MediaSources?.[0]?.Id || currentTrack.Id;

    activeReportRef.current = {
      serverUrl: sourceServer.url,
      accessToken: sourceServer.accessToken,
      itemId: currentTrack.Id,
      mediaSourceId,
      playSessionId: sessionId,
    };

    useMusicPlayerStore.getState().setLoading(true);
    useMusicPlayerStore.getState().setError(null);

    audio.src = candidates[0] || '';
    audio.load();

    if (useMusicPlayerStore.getState().isPlaying) {
      audio.play().catch((err) => {
        console.warn('[MusicAudioController] play rejected:', err);
      });
    }

    reportPlaybackStart(
      sourceServer.url,
      {
        itemId: currentTrack.Id,
        mediaSourceId,
        playSessionId: sessionId,
        seconds: 0,
      },
      sourceServer.accessToken
    ).catch(() => {});
  }, [currentTrack?.Id, sourceServer?.id]);

  // 5. 同步播放 / 暂停控制
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      if (audio.paused && audio.src) {
        audio.play().catch((err) => {
          console.warn('[MusicAudioController] resume play error:', err);
        });
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
    }

    const rep = activeReportRef.current;
    if (rep) {
      reportPlaybackProgress(
        rep.serverUrl,
        {
          itemId: rep.itemId,
          mediaSourceId: rep.mediaSourceId,
          playSessionId: rep.playSessionId,
          seconds: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
          isPaused: !isPlaying,
          eventName: isPlaying ? 'Unpause' : 'Pause',
        },
        rep.accessToken
      ).catch(() => {});
    }
  }, [isPlaying, currentTrack?.Id]);

  // 6. 每 10 秒 Emby 播放心跳上报
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const timer = window.setInterval(() => {
      const rep = activeReportRef.current;
      const audio = audioRef.current;
      if (!rep || !audio) return;
      reportPlaybackProgress(
        rep.serverUrl,
        {
          itemId: rep.itemId,
          mediaSourceId: rep.mediaSourceId,
          playSessionId: rep.playSessionId,
          seconds: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
          isPaused: audio.paused,
          eventName: 'TimeUpdate',
        },
        rep.accessToken
      ).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [isPlaying, currentTrack?.Id]);

  // 7. 非视频页时同步系统媒体会话（SMTC / Now Playing / MPRIS2）
  useEffect(() => {
    if (isVideoPlayerRoute || !currentTrack) return;
    const title = currentTrack.Name || '未知曲目';
    const artist = formatTrackArtists(currentTrack);

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album: currentTrack.Album || 'Nocta · 诺塔音乐',
        });
      } catch {
        // ignore
      }
    }

    if (isTauri) {
      invoke('sync_media_session_metadata', {
        title,
        subtitle: artist,
        durationSecs: Number.isFinite(duration) && duration > 0 ? duration : null,
      }).catch(() => {});
    }
  }, [isTauri, isVideoPlayerRoute, currentTrack?.Id, currentTrack?.Name, duration]);

  useEffect(() => {
    if (isVideoPlayerRoute || !currentTrack) return;
    const stateStr = isPlaying ? 'playing' : 'paused';

    const pushPlayback = () => {
      const pos = Math.max(0, audioRef.current?.currentTime || 0);
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = stateStr;
        } catch {
          // ignore
        }
      }
      if (isTauri) {
        invoke('sync_media_session_playback', {
          playbackState: stateStr,
          positionSecs: pos,
        }).catch(() => {});
      }
    };

    pushPlayback();
    if (!isPlaying || !isTauri) return;
    const timer = window.setInterval(pushPlayback, 5000);
    return () => window.clearInterval(timer);
  }, [isTauri, isVideoPlayerRoute, currentTrack?.Id, isPlaying]);

  // 8. 监听系统媒体键与耳机断连自动暂停（仅非视频页生效）
  useEffect(() => {
    if (isVideoPlayerRoute) return;

    const unlisteners: Promise<UnlistenFn>[] = [];
    if (isTauri) {
      unlisteners.push(
        listen<MediaControlEventPayload>('media://control', (event) => {
          const store = useMusicPlayerStore.getState();
          if (!store.currentTrack) return;
          switch (event.payload?.action) {
            case 'play':
              store.play();
              break;
            case 'pause':
            case 'stop':
              store.pause();
              break;
            case 'toggle':
              store.togglePlay();
              break;
            case 'next':
              store.playNext(false);
              break;
            case 'previous':
              store.playPrev();
              break;
          }
        })
      );

      unlisteners.push(
        listen<AudioOutputChangedPayload>('media://audio-output-changed', (event) => {
          const pausePref = usePlayerStore.getState().playerPreferences.pauseOnHeadphoneDisconnect;
          if (event.payload?.shouldPause && pausePref) {
            useMusicPlayerStore.getState().pause();
          }
        })
      );
    }

    return () => {
      unlisteners.forEach((p) => p.then((u) => u()).catch(() => {}));
    };
  }, [isTauri, isVideoPlayerRoute]);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const d = Number.isFinite(audio.duration) ? audio.duration : 0;
    const store = useMusicPlayerStore.getState();
    store.setCurrentTime(t);
    if (d > 0 && Math.abs(d - store.duration) > 0.5) {
      store.setDuration(d);
    }
    if (audio.buffered.length > 0) {
      const end = audio.buffered.end(audio.buffered.length - 1);
      store.setBuffered(end);
    }

    // 剩余不到 20s 时预加载下一首
    if (
      d > 0 &&
      d - t < 20 &&
      queue.length > 1 &&
      sourceServer &&
      playMode !== 'single' &&
      preloadRef.current
    ) {
      const nextIdx = (currentIndex + 1) % queue.length;
      const nextTrack = queue[nextIdx];
      if (nextTrack && preloadedTrackIdRef.current !== nextTrack.Id) {
        preloadedTrackIdRef.current = nextTrack.Id;
        const nextCandidates = buildAudioStreamCandidates(
          sourceServer.url,
          sourceServer.userId,
          nextTrack,
          sourceServer.accessToken
        );
        if (nextCandidates[0]) {
          preloadRef.current.src = nextCandidates[0];
          preloadRef.current.load();
        }
      }
    }
  };

  const handleAudioError = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    const nextCandidateIdx = candidateIndexRef.current + 1;
    if (nextCandidateIdx < candidatesRef.current.length) {
      candidateIndexRef.current = nextCandidateIdx;
      audio.src = candidatesRef.current[nextCandidateIdx];
      audio.load();
      if (useMusicPlayerStore.getState().isPlaying) {
        audio.play().catch(() => {});
      }
      return;
    }

    const store = useMusicPlayerStore.getState();
    store.setLoading(false);
    store.setPlaying(false);
    store.setError('无法播放该音频流，请检查服务器状态或格式支持');
  };

  return (
    <>
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
            useMusicPlayerStore.getState().setDuration(audio.duration);
          }
          useMusicPlayerStore.getState().setLoading(false);
        }}
        onCanPlay={() => {
          useMusicPlayerStore.getState().setLoading(false);
        }}
        onWaiting={() => {
          useMusicPlayerStore.getState().setLoading(true);
        }}
        onPlaying={() => {
          useMusicPlayerStore.getState().setLoading(false);
          useMusicPlayerStore.getState().setPlaying(true);
        }}
        onPause={() => {
          const audio = audioRef.current;
          if (audio && !audio.ended) {
            useMusicPlayerStore.getState().setPlaying(false);
          }
        }}
        onEnded={() => {
          useMusicPlayerStore.getState().playNext(true);
        }}
        onError={handleAudioError}
        className="hidden"
      />
      <audio ref={preloadRef} preload="metadata" muted className="hidden" />
    </>
  );
};
