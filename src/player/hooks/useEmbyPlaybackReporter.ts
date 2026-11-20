import { MutableRefObject, useCallback, useEffect, useRef } from 'react';
import {
  EmbyItem,
  EmbyMediaSource,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
} from '../../api/embyClient';
import { usePlayerStore } from '../../stores/usePlayerStore';
import { IPlayerEngine } from '../types';

interface UseEmbyPlaybackReporterParams {
  serverId?: string;
  serverUrl?: string;
  serverAccessToken?: string;
  item: EmbyItem | null;
  mediaSource: EmbyMediaSource | null;
  playSessionId: string | null;
  initialTime: number;
  initialTimeRef: MutableRefObject<number>;
  lastValidTimeRef: MutableRefObject<number>;
  engineRef: MutableRefObject<IPlayerEngine | null>;
}

/**
 * 管理 Emby 播放会话的 Start / 10s Progress / Stopped 全生命周期上报，
 * 并通过 sessionKey 防护切集或引擎重置导致的重复上报与 0 秒冲刷。
 */
export function useEmbyPlaybackReporter({
  serverId,
  serverUrl,
  serverAccessToken,
  item,
  mediaSource,
  playSessionId,
  initialTime,
  initialTimeRef,
  lastValidTimeRef,
  engineRef,
}: UseEmbyPlaybackReporterParams) {
  const reportedStoppedSessionRef = useRef<string | null>(null);
  const mediaSourceIdRef = useRef(mediaSource?.Id);
  const serverUrlRef = useRef(serverUrl);
  const tokenRef = useRef(serverAccessToken);

  mediaSourceIdRef.current = mediaSource?.Id;
  serverUrlRef.current = serverUrl;
  tokenRef.current = serverAccessToken;

  useEffect(() => {
    const activeMediaSourceId = mediaSourceIdRef.current;
    const activeUrl = serverUrlRef.current;
    const activeToken = tokenRef.current;
    if (!activeUrl || !activeToken || !item || !activeMediaSourceId || !playSessionId) return;

    const itemId = item.Id;
    const sessionKey = `${itemId}_${playSessionId}`;
    const startSec =
      initialTimeRef.current > 0 ? initialTimeRef.current : lastValidTimeRef.current;

    reportPlaybackStart(
      activeUrl,
      {
        itemId,
        mediaSourceId: activeMediaSourceId,
        playSessionId,
        seconds: startSec,
      },
      activeToken
    ).catch(console.error);

    const interval = window.setInterval(() => {
      const liveUrl = serverUrlRef.current;
      const liveToken = tokenRef.current;
      const liveMediaSourceId = mediaSourceIdRef.current;
      if (!liveUrl || !liveToken || !liveMediaSourceId) return;

      const liveSeconds =
        lastValidTimeRef.current ??
        engineRef.current?.currentTime ??
        usePlayerStore.getState().currentTime;

      reportPlaybackProgress(
        liveUrl,
        {
          itemId,
          mediaSourceId: liveMediaSourceId,
          playSessionId,
          seconds: liveSeconds,
          isPaused: usePlayerStore.getState().paused,
          eventName: 'TimeUpdate',
        },
        liveToken
      ).catch(console.error);
    }, 10000);

    return () => {
      window.clearInterval(interval);
      if (reportedStoppedSessionRef.current === sessionKey) {
        return;
      }
      reportedStoppedSessionRef.current = sessionKey;
      const liveUrl = serverUrlRef.current;
      const liveToken = tokenRef.current;
      const liveMediaSourceId = mediaSourceIdRef.current;
      if (!liveUrl || !liveToken || !liveMediaSourceId) return;

      const stopSeconds =
        lastValidTimeRef.current ??
        engineRef.current?.currentTime ??
        usePlayerStore.getState().currentTime;

      reportPlaybackStopped(
        liveUrl,
        {
          itemId,
          mediaSourceId: liveMediaSourceId,
          playSessionId,
          seconds: stopSeconds,
        },
        liveToken
      ).catch(console.error);
    };
  }, [serverId, item?.Id, playSessionId, initialTime, initialTimeRef, lastValidTimeRef, engineRef]);

  const reportStoppedNow = useCallback(
    async (secondsOverride?: number) => {
      if (!serverUrl || !serverAccessToken || !item || !mediaSource || !playSessionId) return;
      const sessionKey = `${item.Id}_${playSessionId}`;
      reportedStoppedSessionRef.current = sessionKey;
      const stopSeconds =
        secondsOverride ??
        lastValidTimeRef.current ??
        engineRef.current?.currentTime ??
        usePlayerStore.getState().currentTime;

      await reportPlaybackStopped(
        serverUrl,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds: stopSeconds,
        },
        serverAccessToken
      ).catch(() => {});
    },
    [
      serverUrl,
      serverAccessToken,
      item?.Id,
      mediaSource?.Id,
      playSessionId,
      lastValidTimeRef,
      engineRef,
    ]
  );

  const reportEventProgress = useCallback(
    (seconds: number, isPaused: boolean, eventName: 'Pause' | 'Unpause' | 'Seek') => {
      if (!serverUrl || !serverAccessToken || !item || !mediaSource || !playSessionId) return;
      reportPlaybackProgress(
        serverUrl,
        {
          itemId: item.Id,
          mediaSourceId: mediaSource.Id,
          playSessionId,
          seconds,
          isPaused,
          eventName,
        },
        serverAccessToken
      ).catch(console.error);
    },
    [serverUrl, serverAccessToken, item?.Id, mediaSource?.Id, playSessionId]
  );

  return {
    reportStoppedNow,
    reportEventProgress,
  };
}
