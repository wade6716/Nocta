import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOutroSegmentPatch,
  resolveEffectiveOutroStart,
  shouldTriggerAutoNext,
} from '../src/player/skipSegmentsUtils.ts';

test('computeOutroSegmentPatch stores both outroStart and outroOffsetFromEnd for series episodes, and only outroStart for movies', () => {
  const seriesPatch = computeOutroSegmentPatch(1410, 1500, 'ep-1', true);
  assert.deepEqual(seriesPatch, {
    itemId: 'ep-1',
    outroStart: 1410,
    outroOffsetFromEnd: 90,
  });

  const moviePatch = computeOutroSegmentPatch(7000, 7200, 'mv-1', false);
  assert.deepEqual(moviePatch, {
    itemId: 'mv-1',
    outroStart: 7000,
  });
});

test('resolveEffectiveOutroStart adapts outro trigger point across episodes of varying lengths', () => {
  // 剧集第 1 集总长 25:00 (1500s)，在 23:30 (1410s) 标记片尾 -> 距片尾 90s
  const stored = {
    itemId: 'ep-1',
    outroStart: 1410,
    outroOffsetFromEnd: 90,
  };

  // 第 2 集总长 28:00 (1680s)，即使 > 1410s，仍应按 1680 - 90 = 1590s 触发，避免正片还没播完就误弹
  assert.equal(resolveEffectiveOutroStart(stored, 1680, true), 1590);

  // 第 3 集总长仅 22:00 (1320s < 原绝对值 1410s)，应按 1320 - 90 = 1230s 触发，不失效
  assert.equal(resolveEffectiveOutroStart(stored, 1320, true), 1230);

  // 旧版仅含绝对 outroStart（无 outroOffsetFromEnd）的剧集标记应保持兼容
  const legacyStored = { itemId: 'ep-1', outroStart: 1400 };
  assert.equal(resolveEffectiveOutroStart(legacyStored, 1500, true), 1400);
  // 若新集总长小于旧绝对 outroStart，安全返回 undefined
  assert.equal(resolveEffectiveOutroStart(legacyStored, 1300, true), undefined);

  // 电影严格使用 outroStart
  assert.equal(resolveEffectiveOutroStart(stored, 1680, false), 1410);
});

test('shouldTriggerAutoNext triggers at remaining <= 0.5s including seek(total - 0.25) edge case', () => {
  assert.equal(shouldTriggerAutoNext(0.25, 1499.75), true);
  assert.equal(shouldTriggerAutoNext(0.5, 1499.5), true);
  assert.equal(shouldTriggerAutoNext(0, 1500), true);
  assert.equal(shouldTriggerAutoNext(1.2, 1498.8), false);
  // 起播 10s 内即便 remaining <= 0.5 也不误触连播
  assert.equal(shouldTriggerAutoNext(0.2, 5), false);
});
