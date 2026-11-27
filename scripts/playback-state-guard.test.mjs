import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeClampedBridgeElapsed,
  computeStreamPosSpeed,
  decideStallRecoveryAction,
  shouldDanmakuRun,
  shouldExitInitialLoading,
  shouldUseKeyframeSeek,
} from '../src/player/playbackStateGuard.ts';

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

test('decideStallRecoveryAction supports relay fallback, non-Range mid-file, and manual prompt', () => {
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 5000,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      targetInitialTime: 1350,
    }),
    'none'
  );

  // Reachable 206 -> try_relay -> show_manual_prompt
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
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
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
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
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: false,
      targetInitialTime: 1350,
    }),
    'show_non_range_prompt'
  );

  // Container already opened & actively seeking on direct stream -> DO NOT interrupt with try_relay
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      demuxerOpened: true,
      seekable: true,
      isSeeking: true,
      targetInitialTime: 110,
    }),
    'show_seeking_prompt'
  );

  // Actively downloading at high speed -> DO NOT interrupt with try_relay
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      activeDownloadSpeed: 4 * 1024 * 1024,
      targetInitialTime: 110,
    }),
    'show_seeking_prompt'
  );

  // Mode B: Cue-less MKV with deep resume (> 180s, e.g. 28:00) -> auto try_mkv_slice
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      sliceAlreadyAttempted: false,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: false,
      demuxerOpened: true,
      seekable: true,
      isSeeking: true,
      targetInitialTime: 1680,
    }),
    'try_mkv_slice'
  );

  // Mode B: Cue-less MKV with short skip (<= 180s, e.g. 01:50 intro skip) -> keep natural scan (show_seeking_prompt)
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: false,
      relayAlreadyAttempted: false,
      sliceAlreadyAttempted: false,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: false,
      demuxerOpened: true,
      seekable: true,
      isSeeking: true,
      targetInitialTime: 110,
    }),
    'show_seeking_prompt'
  );

  // Already attempted slice -> do NOT loop try_mkv_slice
  assert.equal(
    decideStallRecoveryAction({
      elapsedMs: 8500,
      hasFirstFrame: false,
      cacheDuration: 0,
      isMpv: true,
      hasError: false,
      usingRelay: true,
      relayAlreadyAttempted: true,
      sliceAlreadyAttempted: true,
      diagnosticReachable: true,
      diagnosticFinalStatus: 206,
      midRangeSupported: true,
      hasMkvCues: false,
      demuxerOpened: true,
      seekable: true,
      isSeeking: true,
      targetInitialTime: 1680,
    }),
    'show_seeking_prompt'
  );
});
