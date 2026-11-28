import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmbyChapter, EmbyItem, extractIntroRange, ticksToSeconds } from '../../api/embyClient';
import { formatTime } from '../../components/player/PlayerOsd';
import { MiniHudState } from '../../components/player/MiniActionHud';
import { getSkipKey, usePlayerStore } from '../../stores/usePlayerStore';
import {
  computeOutroSegmentPatch,
  OUTRO_AUTO_COUNTDOWN_MS,
  resolveEffectiveOutroStart,
  resolveOutroTriggerSpec,
} from '../skipSegmentsUtils';
import { IPlayerEngine } from '../types';

export const OUTRO_TOAST_MS = OUTRO_AUTO_COUNTDOWN_MS;

export interface OutroToastState {
  deadline: number;
  totalMs: number;
  triggerAtSec: number;
  action: 'ask' | 'auto';
}

interface UseSkipSegmentsControllerParams {
  item: EmbyItem | null;
  itemId?: string;
  initialTime: number;
  effectiveDuration: number;
  chapters: EmbyChapter[];
  isLoadingVideo: boolean;
  videoError: string | null;
  currentTime: number;
  initialTimeRef: MutableRefObject<number>;
  lastValidTimeRef: MutableRefObject<number>;
  engineRef: MutableRefObject<IPlayerEngine | null>;
  onSeek: (targetSeconds: number) => void;
  onSeekDelta: (delta: number) => void;
  onPlayNextEpisode?: () => boolean;
  showMiniHud: (payload: Omit<MiniHudState, 'id'>, durationMs?: number) => void;
}

/**
 * 统一管理片头自动跳过、Emby 章节片头识别、手动片头/片尾标记、片尾倒计时轻提示。
 */
export function useSkipSegmentsController({
  item,
  itemId,
  initialTime,
  effectiveDuration,
  chapters,
  isLoadingVideo,
  videoError,
  currentTime,
  initialTimeRef,
  lastValidTimeRef,
  engineRef,
  onSeek,
  onSeekDelta,
  onPlayNextEpisode,
  showMiniHud,
}: UseSkipSegmentsControllerParams) {
  const skipSegments = usePlayerStore((s) => s.skipSegments);
  const skipSettings = usePlayerStore((s) => s.skipSettings);
  const skipIntroSeconds = usePlayerStore((s) => s.playerPreferences.skipIntroSeconds);
  const setSkipSegment = usePlayerStore((s) => s.setSkipSegment);
  const clearSkipSegment = usePlayerStore((s) => s.clearSkipSegment);

  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const [outroToast, setOutroToast] = useState<OutroToastState | null>(null);
  const [outroRemainingMs, setOutroRemainingMs] = useState(OUTRO_TOAST_MS);

  const outroToastRef = useRef<OutroToastState | null>(null);
  const outroDismissedRef = useRef(false);
  const outroToastShownRef = useRef(false);
  const initialSkipNoticeKeyRef = useRef('');
  const skipNoticeTimerRef = useRef<number | null>(null);
  const skipOutroRef = useRef<() => void>(() => {});

  const onSeekRef = useRef(onSeek);
  const onSeekDeltaRef = useRef(onSeekDelta);
  const onPlayNextEpisodeRef = useRef(onPlayNextEpisode);
  const showMiniHudRef = useRef(showMiniHud);
  const effectiveDurationRef = useRef(effectiveDuration);

  onSeekRef.current = onSeek;
  onSeekDeltaRef.current = onSeekDelta;
  onPlayNextEpisodeRef.current = onPlayNextEpisode;
  showMiniHudRef.current = showMiniHud;
  effectiveDurationRef.current = effectiveDuration;

  const skipKey = item ? getSkipKey(item) : '';
  const rawSkipSegments = useMemo(() => {
    if (!item || !skipKey) return undefined;
    return skipSegments[skipKey] || skipSegments[`item_${item.Id}`];
  }, [item?.Id, skipKey, skipSegments]);

  const isSeries = Boolean(item?.SeriesId || item?.Type === 'Series');
  const effectiveTotalDuration =
    effectiveDuration || (item ? ticksToSeconds(item.RunTimeTicks || 0) : 0);
  const resolvedOutroStart = resolveEffectiveOutroStart(
    rawSkipSegments,
    effectiveTotalDuration,
    isSeries
  );
  const currentSkipSegments = useMemo(() => {
    if (!rawSkipSegments) return undefined;
    if (resolvedOutroStart !== undefined && resolvedOutroStart !== rawSkipSegments.outroStart) {
      return { ...rawSkipSegments, outroStart: resolvedOutroStart };
    }
    return rawSkipSegments;
  }, [rawSkipSegments, resolvedOutroStart]);

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

  const resetOutroForNewStream = useCallback(() => {
    outroDismissedRef.current = false;
    outroToastShownRef.current = false;
    outroToastRef.current = null;
    setOutroToast(null);
    setOutroRemainingMs(OUTRO_TOAST_MS);
  }, []);

  const clearOutroOnEnded = useCallback(() => {
    outroToastRef.current = null;
    setOutroToast(null);
    setOutroRemainingMs(0);
  }, []);

  const resolveInitialPlaybackTime = useCallback((rawTime: number) => {
    const state = usePlayerStore.getState();
    const currentItem = state.item;
    if (!currentItem || !state.skipSettings.skipIntroEnabled) {
      return { seconds: rawTime, skipped: false };
    }

    const segments =
      state.skipSegments[getSkipKey(currentItem)] || state.skipSegments[`item_${currentItem.Id}`];
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

  // 切换影片/剧集时重置片尾会话级状态
  useEffect(() => {
    outroDismissedRef.current = false;
    outroToastShownRef.current = false;
    initialSkipNoticeKeyRef.current = '';
    outroToastRef.current = null;
    setOutroToast(null);
    setOutroRemainingMs(OUTRO_TOAST_MS);
  }, [item?.Id]);

  // 起播阶段统一处理记忆进度与自动跳过片头
  useEffect(() => {
    const resolved = resolveInitialPlaybackTime(initialTime);
    initialTimeRef.current = resolved.seconds;
    lastValidTimeRef.current = resolved.seconds;

    if (resolved.skipped && item) {
      const noticeKey = `${item.Id}:${resolved.seconds}`;
      if (initialSkipNoticeKeyRef.current !== noticeKey) {
        initialSkipNoticeKeyRef.current = noticeKey;
        showSkipNotice(`已跳过片头 → ${formatTime(resolved.seconds)}`);
      }
    }
  }, [initialTime, item?.Id, itemId, resolveInitialPlaybackTime, showSkipNotice, initialTimeRef, lastValidTimeRef]);

  // 同步于真实 onTimeUpdate 检查片尾起点（不依赖 React 节流时钟）
  const checkOutroAtTime = useCallback((cur: number, dur: number) => {
    if (outroToastRef.current && cur < outroToastRef.current.triggerAtSec - 1.5) {
      outroToastRef.current = null;
      setOutroToast(null);
      setOutroRemainingMs(0);
      outroToastShownRef.current = false;
      return;
    }

    const state = usePlayerStore.getState();
    if (
      !state.skipSettings.skipOutroEnabled ||
      outroDismissedRef.current ||
      outroToastShownRef.current
    ) {
      return;
    }
    const currentItem = state.item;
    const segments = currentItem
      ? state.skipSegments[getSkipKey(currentItem)] || state.skipSegments[`item_${currentItem.Id}`]
      : undefined;
    const total = dur || (currentItem ? ticksToSeconds(currentItem.RunTimeTicks || 0) : 0);
    const isCurrentSeries = Boolean(currentItem?.SeriesId || currentItem?.Type === 'Series');
    const outroStart = resolveEffectiveOutroStart(segments, total, isCurrentSeries);
    const spec = resolveOutroTriggerSpec(outroStart, total, state.skipSettings.skipOutroAction);
    if (spec && cur >= spec.triggerAtSec) {
      outroToastShownRef.current = true;
      const nextToast: OutroToastState = {
        deadline: Date.now() + spec.countdownMs,
        totalMs: spec.countdownMs,
        triggerAtSec: spec.triggerAtSec,
        action: state.skipSettings.skipOutroAction,
      };
      outroToastRef.current = nextToast;
      setOutroRemainingMs(spec.countdownMs);
      setOutroToast(nextToast);
    }
  }, []);

  // 片尾轻提示倒计时：暂停播放时同步暂停倒计时，结束后按设置自动跳过
  useEffect(() => {
    if (!outroToast) return;

    let completed = false;
    let remaining = outroToast.totalMs;
    let lastTickAt = Date.now();

    const tick = () => {
      if (completed) return;
      const now = Date.now();
      const dt = Math.max(0, now - lastTickAt);
      lastTickAt = now;

      if (!usePlayerStore.getState().paused) {
        remaining = Math.max(0, remaining - dt);
      }
      setOutroRemainingMs(remaining);

      if (remaining <= 0) {
        completed = true;
        outroToastRef.current = null;
        setOutroToast(null);
        if (usePlayerStore.getState().skipSettings.skipOutroAction === 'auto') {
          skipOutroRef.current();
        }
      }
    };

    setOutroRemainingMs(remaining);
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [outroToast]);

  useEffect(() => {
    if (!skipSettings.skipOutroEnabled) {
      outroToastRef.current = null;
      setOutroToast(null);
      setOutroRemainingMs(0);
    }
  }, [skipSettings.skipOutroEnabled]);

  const handleMarkIntroEnd = useCallback(
    (secondsOverride?: number) => {
      if (!item || !skipKey) return;

      const state = usePlayerStore.getState();
      const seconds = Math.max(
        0,
        secondsOverride ??
          lastValidTimeRef.current ??
          engineRef.current?.currentTime ??
          state.currentTime ??
          0
      );
      const total = effectiveDurationRef.current || ticksToSeconds(item.RunTimeTicks || 0);

      if (seconds < 1) {
        showSkipNotice('当前进度太靠前，无法标记片头');
        return;
      }
      if (total > 0 && seconds > total * 0.95) {
        showSkipNotice('片头结束时间不能超过片长的 95%');
        return;
      }

      const existingSegments = state.skipSegments[skipKey] || state.skipSegments[`item_${item.Id}`];
      const existingOutro = resolveEffectiveOutroStart(
        existingSegments,
        total,
        Boolean(item.SeriesId || item.Type === 'Series')
      );
      if (existingOutro !== undefined && seconds >= existingOutro - 1) {
        showSkipNotice('片头结束必须早于已标记的片尾开始');
        return;
      }

      const rounded = Math.round(seconds);
      setSkipSegment(skipKey, { itemId: item.Id, introEnd: rounded });
      showSkipNotice(`片头结束已标记：${formatTime(rounded)}`);
    },
    [item?.Id, item?.SeriesId, item?.Type, skipKey, setSkipSegment, showSkipNotice, lastValidTimeRef, engineRef]
  );

  const handleMarkOutroStart = useCallback(
    (secondsOverride?: number) => {
      if (!item || !skipKey) return;

      const state = usePlayerStore.getState();
      const seconds = Math.max(
        0,
        secondsOverride ??
          lastValidTimeRef.current ??
          engineRef.current?.currentTime ??
          state.currentTime ??
          0
      );
      const total = effectiveDurationRef.current || ticksToSeconds(item.RunTimeTicks || 0);

      if (seconds < 5) {
        showSkipNotice('片尾开始时间必须晚于第 5 秒');
        return;
      }
      if (total > 0 && seconds > total - 2) {
        showSkipNotice('片尾开始时间过于接近视频结尾');
        return;
      }

      const existingIntro = (
        state.skipSegments[skipKey] || state.skipSegments[`item_${item.Id}`]
      )?.introEnd;
      if (existingIntro !== undefined && seconds <= existingIntro + 1) {
        showSkipNotice('片尾开始必须晚于已标记的片头结束');
        return;
      }

      const isCurrentSeries = Boolean(item.SeriesId || item.Type === 'Series');
      const patch = computeOutroSegmentPatch(seconds, total, item.Id, isCurrentSeries);
      setSkipSegment(skipKey, patch);
      outroToastShownRef.current = false;
      outroDismissedRef.current = false;
      showSkipNotice(
        patch.outroOffsetFromEnd
          ? `片尾开始已标记：${formatTime(patch.outroStart)}（距结尾 ${formatTime(patch.outroOffsetFromEnd)}）`
          : `片尾开始已标记：${formatTime(patch.outroStart)}`
      );
    },
    [item?.Id, item?.SeriesId, item?.Type, skipKey, setSkipSegment, showSkipNotice, lastValidTimeRef, engineRef]
  );

  const handleClearSkipSegment = useCallback(
    (field: 'introEnd' | 'outroStart') => {
      if (!skipKey) return;
      clearSkipSegment(skipKey, field);
      if (item?.Id && skipKey !== `item_${item.Id}`) {
        clearSkipSegment(`item_${item.Id}`, field);
      }
      if (field === 'outroStart') {
        outroToastShownRef.current = false;
        outroDismissedRef.current = false;
        outroToastRef.current = null;
        setOutroToast(null);
        setOutroRemainingMs(0);
      }
      showSkipNotice(field === 'introEnd' ? '已清除片头标记' : '已清除片尾标记');
    },
    [item?.Id, skipKey, clearSkipSegment, showSkipNotice]
  );

  const handleSkipOutro = useCallback(() => {
    outroDismissedRef.current = true;
    outroToastRef.current = null;
    setOutroToast(null);
    setOutroRemainingMs(0);

    // 若存在下一集，跳过片尾时直接触发无缝切换下一集，避免 seek 到片尾造成卡顿停滞
    if (onPlayNextEpisodeRef.current?.()) {
      showSkipNotice('已跳过片尾，正在进入下一集');
      return;
    }

    const total = effectiveDurationRef.current || ticksToSeconds(item?.RunTimeTicks || 0);
    if (total > 0) {
      onSeekRef.current(Math.max(0, total - 1));
      showSkipNotice('已跳过片尾');
    }
  }, [item?.RunTimeTicks, showSkipNotice]);

  const handleCancelOutro = useCallback(() => {
    outroDismissedRef.current = true;
    outroToastRef.current = null;
    setOutroToast(null);
    setOutroRemainingMs(0);
  }, []);

  skipOutroRef.current = handleSkipOutro;

  // 检测 Emby 片头区间（显示跳过片头胶囊）
  const introRange = useMemo(
    () => extractIntroRange(chapters, effectiveDuration),
    [chapters, effectiveDuration]
  );

  const showSkipIntro =
    !!introRange &&
    !isLoadingVideo &&
    !videoError &&
    currentTime >= introRange.start &&
    currentTime < introRange.end - 3;

  const handleSkipIntro = useCallback(() => {
    const manualIntroEnd = currentSkipSegments?.introEnd;
    const liveSec = lastValidTimeRef.current ?? usePlayerStore.getState().currentTime;
    if (manualIntroEnd && liveSec < manualIntroEnd - 1) {
      onSeekRef.current(manualIntroEnd);
      showMiniHudRef.current({
        icon: 'seek-forward',
        label: '已跳至标记片头结束',
        subLabel: formatTime(manualIntroEnd),
      });
    } else if (introRange) {
      onSeekRef.current(introRange.end);
      showMiniHudRef.current({
        icon: 'seek-forward',
        label: '已跳过片头至正片',
        subLabel: formatTime(introRange.end),
      });
    } else {
      onSeekDeltaRef.current(skipIntroSeconds);
    }
  }, [currentSkipSegments?.introEnd, introRange, skipIntroSeconds, lastValidTimeRef]);

  return {
    currentSkipSegments,
    skipSettings,
    introRange,
    showSkipIntro,
    skipNotice,
    outroToast,
    outroRemainingMs,
    resolveInitialPlaybackTime,
    checkOutroAtTime,
    resetOutroForNewStream,
    clearOutroOnEnded,
    handleMarkIntroEnd,
    handleMarkOutroStart,
    handleClearSkipSegment,
    handleSkipOutro,
    handleCancelOutro,
    handleSkipIntro,
  };
}
