import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBufferingStatusHint,
  computeClampedBridgeElapsed,
  computeStreamPosSpeed,
  decideStallRecoveryAction,
  shouldDanmakuRun,
  shouldExitInitialLoading,
  shouldUseKeyframeSeek,
} from '../src/player/playbackStateGuard.ts';

const fmt = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

test('shouldDanmakuRun freezes danmaku during loading, buffering, unready first frame, pause, or error', () => {
  assert.equal(
    shouldDanmakuRun({
      paused: false,
      isLoadingVideo: false,
      isBuffering: false,
      hasFirstFrame: true,
      hasError: false,
    }),
    true
  );

  assert.equal(
    shouldDanmakuRun({
      paused: false,
      isLoadingVideo: true,
      isBuffering: false,
      hasFirstFrame: false,
      hasError: false,
    }),
    false
  );

  assert.equal(
    shouldDanmakuRun({
      paused: false,
      isLoadingVideo: false,
      isBuffering: true,
      hasFirstFrame: true,
      hasError: false,
    }),
    false
  );

  assert.equal(
    shouldDanmakuRun({
      paused: false,
      isLoadingVideo: false,
      isBuffering: false,
      hasFirstFrame: false,
      hasError: false,
    }),
    false
  );

  assert.equal(
    shouldDanmakuRun({
      paused: true,
      isLoadingVideo: false,
      isBuffering: false,
      hasFirstFrame: true,
      hasError: false,
    }),
    false
  );
});

test('shouldExitInitialLoading prevents exiting loading on static file-loaded time-pos (e.g. 22:30 or 00:00)', () => {
  assert.equal(
    shouldExitInitialLoading({
      hasPlaybackRestarted: false,
      voConfigured: false,
      isSeeking: false,
      pausedForCache: false,
      currentTime: 1350,
      targetInitialTime: 1350,
      timeAdvanced: false,
    }),
    false
  );

  assert.equal(
    shouldExitInitialLoading({
      hasPlaybackRestarted: true,
      voConfigured: false,
      isSeeking: true,
      pausedForCache: false,
      currentTime: 1350,
      targetInitialTime: 1350,
      timeAdvanced: false,
    }),
    false
  );

  assert.equal(
    shouldExitInitialLoading({
      hasPlaybackRestarted: true,
      voConfigured: true,
      isSeeking: false,
      pausedForCache: false,
      currentTime: 1350,
      targetInitialTime: 1350,
      timeAdvanced: false,
    }),
    true
  );

  assert.equal(
    shouldExitInitialLoading({
      hasPlaybackRestarted: false,
      voConfigured: true,
      isSeeking: false,
      pausedForCache: false,
      currentTime: 0.2,
      targetInitialTime: 0,
      timeAdvanced: false,
    }),
    true
  );
});

test('shouldUseKeyframeSeek uses keyframe seek for initial resume and >= 10s jumps, exact for short steps', () => {
  assert.equal(shouldUseKeyframeSeek({ currentTime: 0, targetSeconds: 5, isInitialSeek: true }), true);
  assert.equal(shouldUseKeyframeSeek({ currentTime: 100, targetSeconds: 105 }), false);
  assert.equal(shouldUseKeyframeSeek({ currentTime: 100, targetSeconds: 110 }), true);
  assert.equal(shouldUseKeyframeSeek({ currentTime: 500, targetSeconds: 100 }), true);
});

test('computeClampedBridgeElapsed caps runaway extrapolation without time-pos heartbeats', () => {
  assert.equal(computeClampedBridgeElapsed(-1), 0);
  assert.equal(computeClampedBridgeElapsed(Number.NaN), 0);
  assert.equal(computeClampedBridgeElapsed(0.4, 1.5), 0.4);
  assert.equal(computeClampedBridgeElapsed(18.5, 1.5), 1.5);
});

test('computeStreamPosSpeed reports 20 MB/s sequential reads while ignoring Range seek jumps', () => {
  const spd = computeStreamPosSpeed(0, 1000, 20 * 1024 * 1024, 2000);
  assert.equal(spd, 20 * 1024 * 1024);

  assert.equal(computeStreamPosSpeed(1024, 1000, 1_200_000_000, 1500), null);
  assert.equal(computeStreamPosSpeed(0, 1000, 100_000, 1050), null);
});

test('buildBufferingStatusHint explains seeking and non-Range sequential loading', () => {
  const partialHint = buildBufferingStatusHint({
    partiallySeekable: true,
    isSeeking: true,
    networkSpeed: 20 * 1024 * 1024,
    targetTimeSeconds: 1350,
    formatTime: fmt,
  });
  assert.match(partialHint || '', /分段跳转/);
  assert.match(partialHint || '', /22:30/);

  const seekHint = buildBufferingStatusHint({
    isSeeking: true,
    networkSpeed: 0,
    targetTimeSeconds: 600,
    formatTime: fmt,
  });
  assert.equal(seekHint, '正在定位至 10:00...');
});

test('decideStallRecoveryAction supports virtual Cues, non-Range mid-file, lavf fallback, and speed guard', () => {
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 5000,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      targetInitialTime: 1350,
    }),
    'none'
  );

  // MKV lacking Cues + mid-Range works -> one-step try_relay_virtual_cues
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: false,
      relayVirtualCuesActive: false,
      targetInitialTime: 1350,
    }),
    'try_relay_virtual_cues'
  );

  // Reachable 206 with Cues (or unknown Cues) -> try_relay -> try_lavf -> show_manual_prompt
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: true,
      targetInitialTime: 1350,
    }),
    'try_relay'
  );

  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: true,
      relayAlreadyAttempted: true,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      targetInitialTime: 1350,
    }),
    'try_lavf'
  );

  // Fast sequential download on cueless MKV already inside relay does NOT interrupt with try_lavf
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: true,
      relayAlreadyAttempted: true,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      hasMkvCues: false,
      activeDownloadSpeed: 20 * 1024 * 1024,
      targetInitialTime: 1350,
    }),
    'show_manual_prompt'
  );

  // HTTP 206 on 0-0 but HTTP 200 on mid-file Range -> show_non_range_prompt
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: false,
      targetInitialTime: 1350,
    }),
    'show_non_range_prompt'
  );

  // Truncated MKV with resume past actual EOF -> show_truncated_file_prompt immediately
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: false,
      fileTruncated: true,
      maxPlayableSec: 1090,
      targetInitialTime: 1515,
    }),
    'show_truncated_file_prompt'
  );

  // Truncated MKV with resume WITHIN playable range -> try_relay_virtual_cues
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      lavfAlreadyAttempted: false,
      isMkvContainer: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: false,
      fileTruncated: true,
      maxPlayableSec: 1090,
      targetInitialTime: 600,
    }),
    'try_relay_virtual_cues'
  );
});
