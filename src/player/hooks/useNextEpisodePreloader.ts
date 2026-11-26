import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  buildEmbyStreamHeaders,
  EmbyItem,
  extractIntroRange,
  resolveEmbyUserAgent,
  ticksToSeconds,
} from '../../api/embyClient';
import { isTauriEnvironment } from '../../api/http';
import { SavedServer } from '../../stores/useAuthStore';
import {
  getSkipKey,
  PlayerPreferences,
  SkipSegments,
  SkipSettings,
} from '../../stores/usePlayerStore';
import {
  fetchAndPreparePlaybackSession,
  PreparedPlaybackSession,
} from '../playbackSessionService';
import { resolveMpvProxyDetailed } from '../MpvPlayerEngine';
import {
  NextEpisodePreloadStatus,
  PlayerTelemetry,
  StreamProxyOverride,
} from '../types';

export interface ConsumedPreloadResult {
  session: PreparedPlaybackSession;
  localStreamUrl: string;
  startSec: number;
  skippedIntro: boolean;
  status: NextEpisodePreloadStatus;
}

interface UseNextEpisodePreloaderParams {
  currentServer: SavedServer | null | undefined;
  currentItem: EmbyItem | null;
  nextEpisode: EmbyItem | null;
  engineType: 'mpv' | 'html5';
  currentTime: number;
  duration: number;
  paused: boolean;
  isLoadingVideo: boolean;
  isBuffering: boolean;
  hasFirstFrame: boolean;
  videoError: string | null;
  telemetry: PlayerTelemetry;
  proxyOverride: StreamProxyOverride;
  playerPreferences: PlayerPreferences;
  skipSegments: Record<string, SkipSegments>;
  skipSettings: SkipSettings;
}

interface ActivatedPreloadDto {
  localUrl: string;
  status: NextEpisodePreloadStatus;
}

/**
 * 计算下一集预加载起播位置：
 * - 若下一集已有超过片头结束点的历史进度，优先从历史进度位置预载；
 * - 若开启跳过片头且存在手动标记 / Emby 章节片头，则跳过片头区间；
 * - 否则从 0 秒起预载。
 */
export function resolveNextPreloadStartSeconds(
  targetItem: EmbyItem,
  skipSegments: Record<string, SkipSegments>,
  skipSettings: SkipSettings,
  explicitInitialSec?: number
): { startSec: number; skippedIntro: boolean; durationSec: number } {
  const durationSec = ticksToSeconds(targetItem.RunTimeTicks || 0);
  const resumeSec =
    explicitInitialSec !== undefined
      ? explicitInitialSec
      : ticksToSeconds(targetItem.UserData?.PlaybackPositionTicks || 0);

  if (!skipSettings.skipIntroEnabled) {
    return {
      startSec: resumeSec > 0 ? resumeSec : 0,
      skippedIntro: false,
      durationSec,
    };
  }

  const manualIntro = skipSegments[getSkipKey(targetItem)]?.introEnd;
  const chapterIntro = extractIntroRange(targetItem.Chapters, durationSec)?.end;
  const introEnd =
    manualIntro !== undefined && manualIntro > 1
      ? manualIntro
      : chapterIntro !== undefined && chapterIntro > 1
      ? chapterIntro
      : undefined;

  if (resumeSec > 1 && (!introEnd || resumeSec >= introEnd - 1)) {
    return { startSec: resumeSec, skippedIntro: false, durationSec };
  }

  if (
    introEnd !== undefined &&
    introEnd > 1 &&
    (durationSec <= 0 || introEnd < durationSec - 10)
  ) {
    return { startSec: introEnd, skippedIntro: true, durationSec };
  }

  return {
    startSec: resumeSec > 0 ? resumeSec : 0,
    skippedIntro: false,
    durationSec,
  };
}

/**
 * 协调下一集纯内存预加载全生命周期：
 * - 按用户设置的触发时机静默预热 Emby 会话并启动 Rust 内存分块预加载；
 * - 感知已标记/探测到的片头时长，跳过片头区间直奔正片缓存；
 * - 切集时立即停止下载任务，并在播放进入稳定期后自动释放旧内存分块。
 */
export function useNextEpisodePreloader({
  currentServer,
  currentItem,
  nextEpisode,
  engineType,
  currentTime,
  duration,
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
}: UseNextEpisodePreloaderParams) {
  const [preloadStatus, setPreloadStatus] = useState<NextEpisodePreloadStatus | null>(null);

  const stablePlaySecRef = useRef(0);
  const inFlightKeyRef = useRef<string | null>(null);
  const completedKeyRef = useRef<string | null>(null);
  const lastConfigKeyRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const preparedRef = useRef<{
    token: string;
    itemId: string;
    configKey: string;
    session: PreparedPlaybackSession;
    startSec: number;
    skippedIntro: boolean;
  } | null>(null);

  const activePreloadRef = useRef<{
    token: string;
    itemId: string;
    startedAt: number;
    anchorTime: number;
    released: boolean;
  } | null>(null);

  // 根据下一集 ID、片头标记与跳过开关动态计算预加载配置指纹（变更时自动作废重算）
  const nextIntroHint = useMemo(() => {
    if (!nextEpisode) return null;
    return resolveNextPreloadStartSeconds(nextEpisode, skipSegments, skipSettings);
  }, [nextEpisode, skipSegments, skipSettings]);

  const configKey = useMemo(() => {
    if (!currentServer || !nextEpisode || !playerPreferences.preloadNextEnabled) {
      return null;
    }
    return [
      currentServer.id,
      currentServer.userAgent || '',
      currentItem?.Id || '',
      nextEpisode.Id,
      engineType,
      proxyOverride,
      playerPreferences.preloadNextDurationSeconds,
      playerPreferences.cacheMemoryCapMB,
      skipSettings.skipIntroEnabled ? '1' : '0',
      nextIntroHint?.startSec ?? 0,
    ].join('|');
  }, [
    currentServer?.id,
    currentServer?.userAgent,
    currentItem?.Id,
    nextEpisode?.Id,
    engineType,
    proxyOverride,
    playerPreferences.preloadNextEnabled,
    playerPreferences.preloadNextDurationSeconds,
    playerPreferences.cacheMemoryCapMB,
    skipSettings.skipIntroEnabled,
    nextIntroHint?.startSec,
  ]);

  // 统计当前集有效连续播放秒数（未出首帧或缓冲卡顿时不计入稳定播放）
  useEffect(() => {
    stablePlaySecRef.current = 0;
  }, [currentItem?.Id]);

  useEffect(() => {
    if (isLoadingVideo || isBuffering || !hasFirstFrame || videoError || paused) return;
    const timer = window.setInterval(() => {
      stablePlaySecRef.current += 1;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLoadingVideo, isBuffering, hasFirstFrame, videoError, paused, currentItem?.Id]);

  // 当前集进入持续缓冲（> 2.5s）且后台仍在下载下一集时，立即中止预加载释放全部带宽
  useEffect(() => {
    if (
      !isBuffering ||
      !isTauriEnvironment() ||
      !preloadStatus?.token ||
      (preloadStatus.status !== 'probing' && preloadStatus.status !== 'downloading')
    ) {
      return;
    }

    const token = preloadStatus.token;
    const timer = window.setTimeout(() => {
      inFlightKeyRef.current = null;
      completedKeyRef.current = null;
      preparedRef.current = null;
      requestSeqRef.current += 1;
      setPreloadStatus(null);
      void invoke('cancel_next_episode_preload', { token }).catch(() => {});
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [isBuffering, preloadStatus?.token, preloadStatus?.status]);

  // 当播放稳定于新集后，自动释放已切集会话的内存分块（保留透明代理回源能力）
  useEffect(() => {
    const active = activePreloadRef.current;
    if (!active || active.released || currentItem?.Id !== active.itemId) return;
    if (isLoadingVideo || videoError || !isTauriEnvironment()) return;

    const elapsedWallMs = Date.now() - active.startedAt;
    const playedAdvance = Math.max(0, currentTime - active.anchorTime);
    const cacheReady = engineType === 'mpv' ? (telemetry.cacheDuration ?? 0) >= 10 : true;

    if ((playedAdvance >= 15 && cacheReady) || elapsedWallMs >= 25_000) {
      active.released = true;
      void invoke('release_active_preload_memory', { token: active.token }).catch(() => {});
    }
  }, [
    currentItem?.Id,
    currentTime,
    isLoadingVideo,
    videoError,
    engineType,
    telemetry.cacheDuration,
  ]);

  // 若配置指纹失效/变化（关闭预加载、无下一集、或新标记了片头时长），立刻取消旧后台任务
  useEffect(() => {
    const prevToken = preparedRef.current?.token;
    const prevKey = lastConfigKeyRef.current;
    lastConfigKeyRef.current = configKey;

    if (!configKey || (prevKey && prevKey !== configKey)) {
      inFlightKeyRef.current = null;
      completedKeyRef.current = null;
      preparedRef.current = null;
      requestSeqRef.current += 1;
      setPreloadStatus(null);
      if (isTauriEnvironment()) {
        void invoke('cancel_next_episode_preload', { token: prevToken ?? null }).catch(() => {});
      }
    }
  }, [configKey]);

  // 离开播放页卸载时清空全部预加载会话与内存分块
  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      preparedRef.current = null;
      activePreloadRef.current = null;
      if (isTauriEnvironment()) {
        void invoke('clear_all_preloads').catch(() => {});
      }
    };
  }, []);

  // 判断当前集是否满足配置的触发时机
  const shouldTrigger = useMemo(() => {
    if (
      !configKey ||
      !isTauriEnvironment() ||
      !hasFirstFrame ||
      isLoadingVideo ||
      isBuffering ||
      videoError ||
      !currentItem ||
      !nextEpisode
    ) {
      return false;
    }
    if (inFlightKeyRef.current === configKey || completedKeyRef.current === configKey) {
      return false;
    }

    const mode = playerPreferences.preloadTriggerMode;
    const minWarmup = mode === 'remaining_time' || mode === 'progress' ? 5 : 8;
    if (stablePlaySecRef.current < minWarmup) {
      return false;
    }

    const bufferMet =
      engineType === 'mpv'
        ? (telemetry.cacheDuration ?? 0) >= playerPreferences.preloadTriggerBufferSeconds
        : stablePlaySecRef.current >= Math.min(30, playerPreferences.preloadTriggerBufferSeconds);

    const remainingMet =
      duration > 0 && duration - currentTime <= playerPreferences.preloadTriggerRemainingSeconds;

    const progressMet =
      duration > 0 && (currentTime / duration) * 100 >= playerPreferences.preloadTriggerProgressPercent;

    switch (mode) {
      case 'buffer_ready':
        return bufferMet;
      case 'remaining_time':
        return remainingMet;
      case 'progress':
        return progressMet;
      case 'smart':
      default:
        return bufferMet || remainingMet || progressMet;
    }
  }, [
    configKey,
    hasFirstFrame,
    isLoadingVideo,
    isBuffering,
    videoError,
    currentItem?.Id,
    nextEpisode?.Id,
    engineType,
    currentTime,
    duration,
    telemetry.cacheDuration,
    playerPreferences.preloadTriggerMode,
    playerPreferences.preloadTriggerBufferSeconds,
    playerPreferences.preloadTriggerRemainingSeconds,
    playerPreferences.preloadTriggerProgressPercent,
  ]);

  // 启动下一集预加载任务
  useEffect(() => {
    if (!shouldTrigger || !configKey || !currentServer || !nextEpisode) return;

    const seq = ++requestSeqRef.current;
    inFlightKeyRef.current = configKey;
    completedKeyRef.current = configKey;

    (async () => {
      try {
        const session = await fetchAndPreparePlaybackSession(
          currentServer,
          nextEpisode.Id,
          engineType,
          nextEpisode
        );
        if (seq !== requestSeqRef.current) return;

        // 结合完整章节细节再校准一次片头跳过位置
        const latestState = usePlayerStoreSnapshotForIntro(
          session.item,
          session.initialTime,
          skipSegments,
          skipSettings
        );
        const mediaDurationSec =
          ticksToSeconds(session.item.RunTimeTicks || 0) || latestState.durationSec;

        const proxyInfo = await resolveMpvProxyDetailed(session.streamUrl, proxyOverride);
        if (seq !== requestSeqRef.current) return;

        const initialDto = await invoke<NextEpisodePreloadStatus>('start_next_episode_preload', {
          request: {
            itemId: session.item.Id,
            itemName: session.item.Name,
            episodeNumber: session.item.IndexNumber,
            url: session.streamUrl,
            durationSec: mediaDurationSec,
            startSec: latestState.startSec,
            preloadDurationSec: playerPreferences.preloadNextDurationSeconds,
            maxMemoryBytes: playerPreferences.cacheMemoryCapMB * 1024 * 1024,
            bitrateBps: session.mediaSource.Bitrate ?? null,
            proxyUrl: (proxyInfo.rustProxy ?? proxyInfo.effectiveProxy) || null,
            headers: {
              'User-Agent': resolveEmbyUserAgent(currentServer.userAgent, currentServer.url),
              ...buildEmbyStreamHeaders(currentServer.userId, currentServer.accessToken, {
                userAgent: currentServer.userAgent,
                serverUrl: currentServer.url,
              }),
            },
          },
        });

        if (seq !== requestSeqRef.current) {
          void invoke('cancel_next_episode_preload', { token: initialDto.token }).catch(() => {});
          return;
        }

        preparedRef.current = {
          token: initialDto.token,
          itemId: session.item.Id,
          configKey,
          session,
          startSec: latestState.startSec,
          skippedIntro: latestState.skippedIntro,
        };
        setPreloadStatus(initialDto);
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        inFlightKeyRef.current = null;
        console.warn('[NextEpisodePreloader] start failed:', err);
      }
    })();
  }, [shouldTrigger, configKey]);

  // 轮询 Rust 后台预加载实时状态供 UI 展示（ready / error / cancelled 后停止轮询）
  const activeToken = preloadStatus?.token;
  const activeState = preloadStatus?.status;
  useEffect(() => {
    if (!activeToken || !isTauriEnvironment()) return;
    if (
      activeState === 'ready' ||
      activeState === 'error' ||
      activeState === 'cancelled' ||
      activeState === 'released'
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void invoke<NextEpisodePreloadStatus | null>('get_preload_status', {
        token: activeToken,
      })
        .then((dto) => {
          if (dto && preparedRef.current?.token === activeToken) {
            setPreloadStatus(dto);
          }
        })
        .catch(() => {});
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeToken, activeState]);

  /**
   * 切集瞬间尝试激活已预加载的会话与本地内存代理流。
   * 无论命中与否，都会立即停止后台预载下载并确保不产生多余下载。
   */
  const consumePreloadedSession = useCallback(
    async (targetItemId: string): Promise<ConsumedPreloadResult | null> => {
      const prepared = preparedRef.current;
      preparedRef.current = null;
      inFlightKeyRef.current = null;
      completedKeyRef.current = null;
      requestSeqRef.current += 1;
      setPreloadStatus(null);

      if (!isTauriEnvironment()) {
        return null;
      }

      if (!prepared || prepared.itemId !== targetItemId) {
        await invoke('cancel_next_episode_preload', { token: null }).catch(() => {});
        return null;
      }

      try {
        const activated = await invoke<ActivatedPreloadDto | null>(
          'activate_preloaded_episode',
          {
            token: prepared.token,
            itemId: targetItemId,
          }
        );

        if (!activated) {
          return null;
        }

        activePreloadRef.current = {
          token: activated.status.token,
          itemId: targetItemId,
          startedAt: Date.now(),
          anchorTime: prepared.startSec,
          released: false,
        };

        return {
          session: prepared.session,
          localStreamUrl: activated.localUrl,
          startSec: prepared.startSec,
          skippedIntro: prepared.skippedIntro,
          status: activated.status,
        };
      } catch (err) {
        console.warn('[NextEpisodePreloader] activate failed, falling back to direct stream:', err);
        return null;
      }
    },
    []
  );

  const releaseActivePreload = useCallback(() => {
    const active = activePreloadRef.current;
    if (active && !active.released) {
      active.released = true;
      if (isTauriEnvironment()) {
        void invoke('release_active_preload_memory', { token: active.token }).catch(() => {});
      }
    }
  }, []);

  return {
    nextPreloadStatus: preloadStatus,
    consumePreloadedSession,
    releaseActivePreload,
  };
}

function usePlayerStoreSnapshotForIntro(
  item: EmbyItem,
  initialSec: number,
  skipSegments: Record<string, SkipSegments>,
  skipSettings: SkipSettings
) {
  return resolveNextPreloadStartSeconds(item, skipSegments, skipSettings, initialSec);
}
