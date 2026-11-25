export interface SkipSegmentLike {
  itemId?: string;
  introEnd?: number;
  outroStart?: number;
  outroOffsetFromEnd?: number;
  updatedAt?: number;
}

/**
 * 计算片尾开始标记写入补丁：
 * 对剧集除记录当前集绝对秒数 outroStart 外，同时计算并保存距片尾秒数 outroOffsetFromEnd，
 * 以便在不同集片长存在差异时仍能按“距片尾倒数秒数”精准复用片尾跳过点。
 */
export function computeOutroSegmentPatch(
  currentSec: number,
  totalDurationSec: number,
  itemId: string,
  isSeries: boolean
): {
  itemId: string;
  outroStart: number;
  outroOffsetFromEnd?: number;
} {
  const rounded = Math.round(currentSec);
  if (isSeries && Number.isFinite(totalDurationSec) && totalDurationSec > rounded + 1) {
    const outroOffsetFromEnd = Math.max(2, Math.round(totalDurationSec - rounded));
    return {
      itemId,
      outroStart: rounded,
      outroOffsetFromEnd,
    };
  }
  return {
    itemId,
    outroStart: rounded,
  };
}

/**
 * 解析当前播放视频的有效片尾触发秒数：
 * 剧集优先使用“当前片长 - outroOffsetFromEnd”动态适配，不可用时回退绝对秒数 outroStart。
 */
export function resolveEffectiveOutroStart(
  segments: SkipSegmentLike | null | undefined,
  currentDurationSec: number,
  isSeries: boolean
): number | undefined {
  if (!segments) return undefined;

  if (
    isSeries &&
    typeof segments.outroOffsetFromEnd === 'number' &&
    Number.isFinite(segments.outroOffsetFromEnd) &&
    segments.outroOffsetFromEnd >= 2 &&
    Number.isFinite(currentDurationSec) &&
    currentDurationSec > 0
  ) {
    const computed = Math.round(currentDurationSec - segments.outroOffsetFromEnd);
    if (computed >= 5 && computed < currentDurationSec - 1) {
      return computed;
    }
  }

  if (
    typeof segments.outroStart === 'number' &&
    Number.isFinite(segments.outroStart) &&
    segments.outroStart >= 5
  ) {
    if (
      !Number.isFinite(currentDurationSec) ||
      currentDurationSec <= 0 ||
      segments.outroStart < currentDurationSec - 1
    ) {
      return segments.outroStart;
    }
  }

  return undefined;
}

/**
 * 判断播放进度是否已抵达自动连播阈值（避免因 Math.ceil(0.25) === 1 永远无法归零）。
 */
export function shouldTriggerAutoNext(
  remainingSec: number,
  currentTimeSec: number
): boolean {
  return (
    Number.isFinite(remainingSec) &&
    Number.isFinite(currentTimeSec) &&
    currentTimeSec > 10 &&
    remainingSec <= 0.5
  );
}
