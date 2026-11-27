export interface DanmakuRunState {
  paused: boolean;
  isLoadingVideo: boolean;
  isBuffering: boolean;
  hasFirstFrame: boolean;
  hasError: boolean;
}

export interface InitialLoadingExitState {
  hasPlaybackRestarted: boolean;
  voConfigured: boolean;
  isSeeking: boolean;
  pausedForCache: boolean;
  currentTime: number;
  targetInitialTime: number;
  timeAdvanced: boolean;
}

export interface KeyframeSeekParams {
  currentTime: number;
  targetSeconds: number;
  isInitialSeek?: boolean;
}

export interface StallRecoveryParams {
  elapsedMs: number;
  hasFirstFrame: boolean;
  cacheDuration: number;
  isMpv: boolean;
  hasError: boolean;
  usingRelay: boolean;
  relayAlreadyAttempted: boolean;
  diagnosticReachable?: boolean;
  diagnosticFinalStatus?: number | null;
  midRangeSupported?: boolean | null;
  targetInitialTime: number;
}

export type StallRecoveryAction =
  | 'none'
  | 'try_relay'
  | 'show_non_range_prompt'
  | 'show_manual_prompt';

const MAX_STREAM_POS_SPEED_BYTES_PER_SEC = 300 * 1024 * 1024;

/**
 * 仅当播放非暂停、非起播加载、非缓冲、首帧已就绪且无错误时才允许弹幕前进。
 */
export function shouldDanmakuRun(state: DanmakuRunState): boolean {
  return (
    !state.paused &&
    !state.isLoadingVideo &&
    !state.isBuffering &&
    state.hasFirstFrame &&
    !state.hasError
  );
}

/**
 * 首帧与加载遮罩退出判定：
 * 禁止仅凭 file-loaded 的静态目标 time-pos 撤掉 Loading，必须确认真实出帧或时间推进且未处于 Seek/缺缓冲状态。
 */
export function shouldExitInitialLoading(state: InitialLoadingExitState): boolean {
  if (state.isSeeking || state.pausedForCache) {
    return false;
  }
  if (state.targetInitialTime > 0 && state.currentTime < 1) {
    return false;
  }
  return state.hasPlaybackRestarted || state.voConfigured || state.timeAdvanced;
}

/**
 * 起播续播与大跨度（>= 10s）跳转优先走关键帧快速寻址，避免 4K HDR10 长 GOP 逐帧解码阻塞黑屏。
 */
export function shouldUseKeyframeSeek(params: KeyframeSeekParams): boolean {
  if (params.isInitialSeek) {
    return true;
  }
  return Math.abs(params.targetSeconds - params.currentTime) >= 10;
}

/**
 * 限制 MpvDanmakuBridge 在失去底层 time-pos 心跳后的最大自由外推时间，防止画面卡死时弹幕独自滚完。
 */
export function computeClampedBridgeElapsed(
  rawElapsedSec: number,
  maxExtrapolationSec = 1.5
): number {
  if (!Number.isFinite(rawElapsedSec) || rawElapsedSec <= 0) {
    return 0;
  }
  if (!Number.isFinite(maxExtrapolationSec) || maxExtrapolationSec <= 0) {
    return 0;
  }
  return Math.min(rawElapsedSec, maxExtrapolationSec);
}

/**
 * 根据底层 stream-pos 增量估算网络读取速率；自动过滤 HTTP Range 瞬间跳转（> 300 MB/s）和过短采样间隔。
 */
export function computeStreamPosSpeed(
  prevPos: number,
  prevAtMs: number,
  nextPos: number,
  nextAtMs: number
): number | null {
  const dtMs = nextAtMs - prevAtMs;
  if (!Number.isFinite(dtMs) || dtMs < 200) {
    return null;
  }
  const deltaBytes = nextPos - prevPos;
  if (!Number.isFinite(deltaBytes) || deltaBytes <= 0) {
    return null;
  }
  const speed = (deltaBytes * 1000) / dtMs;
  if (!Number.isFinite(speed) || speed <= 0 || speed > MAX_STREAM_POS_SPEED_BYTES_PER_SEC) {
    return null;
  }
  return Math.round(speed);
}

/**
 * 8 秒 0 首帧卡滞看门狗的恢复决策：
 * - 上游中段不支持 Range：禁止反复重启打断，直接提示从 00:00 播放；
 * - 常规 302 卡滞：优先切换内置中转。
 */
export function decideStallRecoveryAction(
  params: StallRecoveryParams
): StallRecoveryAction {
  if (
    !params.isMpv ||
    params.hasFirstFrame ||
    params.hasError ||
    params.elapsedMs < 8000 ||
    params.cacheDuration > 0.1
  ) {
    return 'none';
  }

  if (
    (params.diagnosticFinalStatus === 200 || params.midRangeSupported === false) &&
    params.targetInitialTime > 15
  ) {
    return 'show_non_range_prompt';
  }

  if (
    !params.usingRelay &&
    !params.relayAlreadyAttempted &&
    params.diagnosticReachable &&
    params.diagnosticFinalStatus !== 200
  ) {
    return 'try_relay';
  }

  return 'show_manual_prompt';
}
