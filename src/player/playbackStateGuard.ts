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

export interface BufferingStatusHintParams {
  isSeeking?: boolean;
  partiallySeekable?: boolean;
  networkSpeed: number;
  targetTimeSeconds?: number;
  streamPos?: number;
  fileSize?: number;
  formatTime: (sec: number) => string;
}

export interface StallRecoveryParams {
  elapsedMs: number;
  hasFirstFrame: boolean;
  cacheDuration: number;
  isMpv: boolean;
  hasError: boolean;
  usingRelay: boolean;
  relayAlreadyAttempted: boolean;
  lavfAlreadyAttempted: boolean;
  isMkvContainer: boolean;
  diagnosticReachable?: boolean;
  diagnosticFinalStatus?: number | null;
  midRangeSupported?: boolean | null;
  hasMkvCues?: boolean | null;
  fileTruncated?: boolean;
  maxPlayableSec?: number | null;
  relayVirtualCuesActive?: boolean;
  activeDownloadSpeed?: number;
  targetInitialTime: number;
}

export type StallRecoveryAction =
  | 'none'
  | 'try_relay'
  | 'try_relay_virtual_cues'
  | 'try_lavf'
  | 'show_non_range_prompt'
  | 'show_truncated_file_prompt'
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
 * 生成卡顿/定位期间的明确状态提示文案，避免无信息提示的 "0 KB/s"。
 */
export function buildBufferingStatusHint(
  params: BufferingStatusHintParams
): string | undefined {
  const target = params.targetTimeSeconds;
  if (params.partiallySeekable && target !== undefined && target > 15) {
    return `片源不支持分段跳转，正在顺序加载至 ${params.formatTime(target)}...`;
  }
  if (params.isSeeking) {
    if (target !== undefined && target > 0) {
      return `正在定位至 ${params.formatTime(target)}...`;
    }
    return '正在定位画面...';
  }
  return undefined;
}

/**
 * 8 秒 0 首帧卡滞看门狗的智能恢复决策：
 * - 上游中段不支持 Range：禁止反复重启打断，直接提示从 00:00 播放；
 * - MKV 缺少 Cues 索引但支持中段 Range：一步切换内置虚拟 Cues 索引中转秒开；
 * - 常规 302 卡滞：优先切换内置中转 -> 再尝试 FFmpeg lavf（除非已在高速扫流中）。
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
    params.fileTruncated &&
    typeof params.maxPlayableSec === 'number' &&
    params.maxPlayableSec > 0 &&
    params.targetInitialTime >= params.maxPlayableSec - 5
  ) {
    return 'show_truncated_file_prompt';
  }

  if (
    (params.diagnosticFinalStatus === 200 || params.midRangeSupported === false) &&
    params.targetInitialTime > 15
  ) {
    return 'show_non_range_prompt';
  }

  if (
    params.isMkvContainer &&
    params.hasMkvCues === false &&
    params.midRangeSupported !== false &&
    !params.relayVirtualCuesActive &&
    !params.relayAlreadyAttempted
  ) {
    return 'try_relay_virtual_cues';
  }

  if (
    !params.usingRelay &&
    !params.relayAlreadyAttempted &&
    params.diagnosticReachable &&
    params.diagnosticFinalStatus !== 200
  ) {
    return 'try_relay';
  }

  const fastSequentialDownload =
    Boolean(params.activeDownloadSpeed && params.activeDownloadSpeed >= 1024 * 1024) &&
    params.hasMkvCues === false;
  if (!params.lavfAlreadyAttempted && params.isMkvContainer && !fastSequentialDownload) {
    return 'try_lavf';
  }

  return 'show_manual_prompt';
}
