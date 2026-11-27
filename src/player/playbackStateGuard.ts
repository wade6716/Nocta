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

export type MkvCuesStatus = 'valid' | 'partial' | 'missing' | 'broken';

export interface StallRecoveryParams {
  elapsedMs: number;
  hasFirstFrame: boolean;
  cacheDuration: number;
  isMpv: boolean;
  hasError: boolean;
  usingRelay: boolean;
  relayAlreadyAttempted: boolean;
  sliceAlreadyAttempted?: boolean;
  diagnosticReachable?: boolean;
  diagnosticFinalStatus?: number | null;
  midRangeSupported?: boolean | null;
  hasMkvCues?: boolean | null;
  isMkvMedia?: boolean;
  mkvCuesStatus?: MkvCuesStatus | null;
  mkvCuesCoverageSec?: number | null;
  demuxerOpened?: boolean;
  seekable?: boolean;
  isSeeking?: boolean;
  activeDownloadSpeed?: number;
  targetInitialTime: number;
}

export type StallRecoveryAction =
  | 'none'
  | 'try_relay'
  | 'try_mkv_slice'
  | 'show_seeking_prompt'
  | 'show_non_range_prompt'
  | 'show_manual_prompt';

export interface ProactiveSeekSliceParams {
  isTauri: boolean;
  engineType: 'mpv' | 'html5';
  isMkvMedia: boolean;
  activeSliceStartSec: number | null;
  targetSeconds: number;
  currentSeconds: number;
  bufferedEndSeconds?: number;
  midRangeSupported?: boolean | null;
  hasMkvCues?: boolean | null;
  mkvCuesStatus?: MkvCuesStatus | null;
  mkvCuesCoverageSec?: number | null;
}

export type ProactiveSeekSliceDecision = 'normal' | 'slice' | 'exit_slice_to_direct';

export interface MidSeekRecoveryParams {
  elapsedMs: number;
  isMpv: boolean;
  hasFirstFrame: boolean;
  hasError: boolean;
  isSeeking: boolean;
  isBuffering: boolean;
  cacheDuration: number;
  activeDownloadSpeed: number;
  targetSeconds: number;
  isMkvMedia: boolean;
  midRangeSupported?: boolean | null;
  hasMkvCues?: boolean | null;
  mkvCuesStatus?: MkvCuesStatus | null;
  mkvCuesCoverageSec?: number | null;
  usingRelay: boolean;
  sliceAlreadyAttempted: boolean;
  relayAlreadyAttempted: boolean;
}

export type MidSeekRecoveryAction =
  | 'none'
  | 'try_mkv_slice'
  | 'try_relay'
  | 'show_non_range_hint'
  | 'show_manual_hint';

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
 * - 已打开容器且正在寻址（demuxerOpened && seekable && isSeeking）或正在高速拉流：
 *   证明链路已连通，禁止切中转掐断已下载数据重扫，仅给出温和定位提示；
 * - 常规 302/握手卡滞：优先切换内置中转。
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

  // 方式 B：实锤无/坏/残缺 Cues MKV（或 0 KB/s 停滞深跳 MKV）且支持中段 Range -> 自动按需 Cluster 切片直跳
  const partialExceeded =
    params.mkvCuesStatus === 'partial' &&
    typeof params.mkvCuesCoverageSec === 'number' &&
    params.targetInitialTime > params.mkvCuesCoverageSec + 5 &&
    params.targetInitialTime >= 30;
  const stalledDeepMkvSeek =
    Boolean(params.isMkvMedia) &&
    params.targetInitialTime > 180 &&
    params.activeDownloadSpeed !== undefined &&
    params.activeDownloadSpeed < 256 * 1024;
  if (
    params.midRangeSupported !== false &&
    !params.sliceAlreadyAttempted &&
    ((params.hasMkvCues === false && params.targetInitialTime > 180) ||
      partialExceeded ||
      stalledDeepMkvSeek)
  ) {
    return 'try_mkv_slice';
  }

  const activelySeekingOpenedStream =
    Boolean(params.demuxerOpened) &&
    params.seekable !== false &&
    Boolean(params.isSeeking);
  const activelyDownloading =
    Boolean(params.activeDownloadSpeed && params.activeDownloadSpeed >= 256 * 1024);

  if (params.targetInitialTime > 15 && (activelySeekingOpenedStream || activelyDownloading)) {
    return 'show_seeking_prompt';
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

/**
 * 播放中拖动进度条（handleSeek）的主动切片决策：
 * - 切片模式下回拖至 < 30s 自动退出切片模式，重载原流定位；
 * - 已确认缺失/损坏 Cues（或超出残缺 Cues 覆盖范围）且跨度超出缓冲时，主动直切 MKV Cluster，免除从头扫流或卡死。
 */
export function shouldProactivelySliceOnSeek(
  params: ProactiveSeekSliceParams
): ProactiveSeekSliceDecision {
  if (!params.isTauri || params.engineType !== 'mpv') {
    return 'normal';
  }

  const bufferedFar = Math.max(params.currentSeconds, params.bufferedEndSeconds || 0);
  if (params.activeSliceStartSec !== null) {
    if (params.targetSeconds < 30) {
      return 'exit_slice_to_direct';
    }
    if (
      params.targetSeconds < params.activeSliceStartSec - 2 ||
      params.targetSeconds > bufferedFar + 60
    ) {
      return 'slice';
    }
    return 'normal';
  }

  if (!params.isMkvMedia || params.midRangeSupported === false || params.targetSeconds < 30) {
    return 'normal';
  }

  if (
    params.targetSeconds >= params.currentSeconds - 5 &&
    params.targetSeconds <= bufferedFar + 15
  ) {
    return 'normal';
  }

  if (
    params.mkvCuesStatus === 'partial' &&
    typeof params.mkvCuesCoverageSec === 'number'
  ) {
    return params.targetSeconds > params.mkvCuesCoverageSec + 5 ? 'slice' : 'normal';
  }

  const cuesDeficient =
    params.mkvCuesStatus === 'missing' ||
    params.mkvCuesStatus === 'broken' ||
    params.hasMkvCues === false;
  if (
    cuesDeficient &&
    (params.targetSeconds > bufferedFar + 60 || params.targetSeconds < params.currentSeconds - 60)
  ) {
    return 'slice';
  }

  return 'normal';
}

/**
 * 播放中拖动进度条卡滞看门狗（8s / 15s）的恢复决策：
 * 即使片源曾被误判或发生代理半开连接假死，8s 停滞 (< 256 KB/s) 或 15s 慢扫未出帧即切入 Rust 切片或透明中转。
 */
export function decideMidSeekRecoveryAction(
  params: MidSeekRecoveryParams
): MidSeekRecoveryAction {
  if (
    !params.isMpv ||
    !params.hasFirstFrame ||
    params.hasError ||
    params.cacheDuration > 0.2 ||
    (!params.isSeeking && !params.isBuffering) ||
    params.elapsedMs < 8000
  ) {
    return 'none';
  }

  if (params.midRangeSupported === false) {
    return 'show_non_range_hint';
  }

  const isStalled = params.activeDownloadSpeed < 256 * 1024;
  const cuesDeficient =
    params.hasMkvCues === false ||
    params.mkvCuesStatus === 'missing' ||
    params.mkvCuesStatus === 'broken' ||
    (params.mkvCuesStatus === 'partial' &&
      typeof params.mkvCuesCoverageSec === 'number' &&
      params.targetSeconds > params.mkvCuesCoverageSec + 5);

  if (
    params.isMkvMedia &&
    params.targetSeconds >= 30 &&
    !params.sliceAlreadyAttempted &&
    (cuesDeficient || isStalled || params.elapsedMs >= 15000)
  ) {
    return 'try_mkv_slice';
  }

  if (!params.usingRelay && !params.relayAlreadyAttempted && isStalled) {
    return 'try_relay';
  }

  if (
    params.elapsedMs >= 15000 &&
    (params.sliceAlreadyAttempted || params.relayAlreadyAttempted || !params.isMkvMedia)
  ) {
    return 'show_manual_hint';
  }

  return 'none';
}
