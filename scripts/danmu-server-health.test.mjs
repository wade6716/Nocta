import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getServerHealth,
  isRetryableDanmuTransportError,
  orderDanmuServersForAutoMatch,
  recordServerFailure,
  recordServerSuccess,
  resetAllServerHealth,
} from '../src/api/danmuServerHealth.ts';

test('recordServerFailure applies exponential cooldown and resets cleanly on success', () => {
  resetAllServerHealth();
  const baseUrl = 'http://127.0.0.1:9321/token1';
  const t0 = 1_000_000;

  const s1 = recordServerFailure(baseUrl, 'timeout', t0);
  assert.equal(s1.consecutiveFailures, 1);
  assert.equal(s1.cooldownUntil, 0);

  const s2 = recordServerFailure(baseUrl, 'HTTP 502', t0 + 1000);
  assert.equal(s2.consecutiveFailures, 2);
  assert.equal(s2.cooldownUntil, t0 + 1000 + 60_000);

  const s3 = recordServerFailure(baseUrl, 'HTTP 503', t0 + 2000);
  assert.equal(s3.consecutiveFailures, 3);
  assert.equal(s3.cooldownUntil, t0 + 2000 + 180_000);

  const s4 = recordServerFailure(baseUrl, 'HTTP 504', t0 + 3000);
  assert.equal(s4.consecutiveFailures, 4);
  assert.equal(s4.cooldownUntil, t0 + 3000 + 300_000);

  recordServerSuccess(baseUrl, 120);
  const afterSuccess = getServerHealth(baseUrl);
  assert.equal(afterSuccess?.consecutiveFailures, 0);
  assert.equal(afterSuccess?.cooldownUntil, 0);
  assert.equal(afterSuccess?.emaLatencyMs, 120);

  recordServerSuccess(baseUrl, 220);
  assert.equal(getServerHealth(baseUrl)?.emaLatencyMs, Math.round(120 * 0.7 + 220 * 0.3));
});

test('orderDanmuServersForAutoMatch keeps healthy primary first, promotes fast healthy backups when primary cools down, and retains cooldown servers as last resort', () => {
  resetAllServerHealth();
  const now = 2_000_000;
  const primary = { id: 'p', name: 'Primary', baseUrl: 'https://a.example.com/tok', latency: 180, status: 'ok' };
  const slowBackup = { id: 'b1', name: 'SlowBackup', baseUrl: 'https://b.example.com/tok', latency: 320, status: 'ok' };
  const fastBackup = { id: 'b2', name: 'FastBackup', baseUrl: 'https://c.example.com/tok', latency: 90, status: 'ok' };

  const initialOrder = orderDanmuServersForAutoMatch([primary, slowBackup, fastBackup], primary, now);
  assert.deepEqual(
    initialOrder.map((s) => s.id),
    ['p', 'b2', 'b1']
  );

  // Trigger circuit breaker on primary (2 failures -> 60s cooldown)
  recordServerFailure(primary.baseUrl, 'timeout', now);
  recordServerFailure(primary.baseUrl, 'timeout', now + 100);

  const failoverOrder = orderDanmuServersForAutoMatch([primary, slowBackup, fastBackup], primary, now + 500);
  assert.deepEqual(
    failoverOrder.map((s) => s.id),
    ['b2', 'b1', 'p']
  );

  // Even when all servers are cooling down, orderDanmuServersForAutoMatch never returns empty
  recordServerFailure(fastBackup.baseUrl, '500', now + 200);
  recordServerFailure(fastBackup.baseUrl, '500', now + 300);
  recordServerFailure(slowBackup.baseUrl, '500', now + 400);
  recordServerFailure(slowBackup.baseUrl, '500', now + 500);

  const allCooldownOrder = orderDanmuServersForAutoMatch([primary, slowBackup, fastBackup], primary, now + 600);
  assert.equal(allCooldownOrder.length, 3);
  assert.equal(allCooldownOrder[0].id, 'p');
});

test('isRetryableDanmuTransportError distinguishes transport/server failures from 404/400 item errors', () => {
  assert.equal(isRetryableDanmuTransportError({ status: 502 }), true);
  assert.equal(isRetryableDanmuTransportError({ status: 429 }), true);
  assert.equal(isRetryableDanmuTransportError({ status: 401 }), true);
  assert.equal(isRetryableDanmuTransportError({ isTimeout: true, name: 'DanmuHttpError' }), true);
  assert.equal(isRetryableDanmuTransportError({ status: 404 }), false);
  assert.equal(isRetryableDanmuTransportError({ status: 400 }), false);
});
