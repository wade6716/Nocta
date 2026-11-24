export interface DanmuServerLike {
  id: string;
  name: string;
  baseUrl: string;
  latency?: number;
  status?: string;
}

export interface DanmuServerHealthSnapshot {
  consecutiveFailures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  emaLatencyMs?: number;
  lastError?: string;
}

const serverHealthMap = new Map<string, DanmuServerHealthSnapshot>();

export function normalizeDanmuServerKey(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * 识别属于节点/传输层不稳定（可故障转移）的异常；正常 200 OK 空结果不惩罚节点健康度
 */
export function isRetryableDanmuTransportError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const anyErr = err as {
    name?: string;
    status?: number;
    isTimeout?: boolean;
    message?: string;
  };
  if (anyErr.isTimeout || anyErr.name === 'AbortError' || anyErr.name === 'TypeError') {
    return true;
  }
  if (typeof anyErr.status === 'number') {
    return (
      anyErr.status === 401 ||
      anyErr.status === 403 ||
      anyErr.status === 408 ||
      anyErr.status === 429 ||
      anyErr.status >= 500
    );
  }
  const msg = String(anyErr.message || '');
  if (/(?:timeout|timed out|abort|network|failed to fetch|connection|econnrefused|reset|http\s*(?:401|403|408|429|5\d\d))/i.test(msg)) {
    return true;
  }
  return !msg.includes('404') && !msg.includes('400');
}

/**
 * 记录节点健康响应：立即重置失败计数与熔断状态，并更新 EMA 延迟估值
 */
export function recordServerSuccess(baseUrl: string, latencyMs?: number): void {
  const key = normalizeDanmuServerKey(baseUrl);
  if (!key) return;
  const prev = serverHealthMap.get(key);
  let nextEma = prev?.emaLatencyMs;
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
    const rounded = Math.round(latencyMs);
    nextEma =
      typeof prev?.emaLatencyMs === 'number'
        ? Math.round(prev.emaLatencyMs * 0.7 + rounded * 0.3)
        : rounded;
  }
  serverHealthMap.set(key, {
    consecutiveFailures: 0,
    lastFailureAt: prev?.lastFailureAt ?? 0,
    cooldownUntil: 0,
    emaLatencyMs: nextEma,
    lastError: undefined,
  });
}

/**
 * 记录节点传输/服务端异常，并按指数退避策略触发熔断冷却（0 -> 60s -> 180s -> 300s）
 */
export function recordServerFailure(
  baseUrl: string,
  errorMessage?: string,
  now = Date.now()
): DanmuServerHealthSnapshot {
  const key = normalizeDanmuServerKey(baseUrl);
  const prev = serverHealthMap.get(key);
  const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;

  const cooldownMs =
    consecutiveFailures === 1
      ? 0
      : consecutiveFailures === 2
      ? 60_000
      : consecutiveFailures === 3
      ? 180_000
      : 300_000;

  const snapshot: DanmuServerHealthSnapshot = {
    consecutiveFailures,
    lastFailureAt: now,
    cooldownUntil: cooldownMs > 0 ? now + cooldownMs : 0,
    emaLatencyMs: prev?.emaLatencyMs,
    lastError: errorMessage,
  };

  if (key) {
    serverHealthMap.set(key, snapshot);
  }
  return snapshot;
}

export function getServerHealth(baseUrl: string): DanmuServerHealthSnapshot | undefined {
  const key = normalizeDanmuServerKey(baseUrl);
  return key ? serverHealthMap.get(key) : undefined;
}

export function resetAllServerHealth(): void {
  serverHealthMap.clear();
}

/**
 * 为自动匹配排序弹幕节点：
 * 1. 未冷却的当前活跃主节点优先；
 * 2. 其余未冷却备用节点按「无近期失败 + 非 error 状态 + 低延迟」升序排列；
 * 3. 处于冷却期的节点排到末尾作兜底，避免全网波动时彻底无节点可用。
 */
export function orderDanmuServersForAutoMatch<T extends DanmuServerLike>(
  servers: T[],
  activeServer: T,
  now = Date.now()
): T[] {
  const primaryKey = normalizeDanmuServerKey(activeServer.baseUrl);
  const deduped: T[] = [];
  const seenKeys = new Set<string>();

  for (const srv of [activeServer, ...(servers || [])]) {
    const key = normalizeDanmuServerKey(srv?.baseUrl || '');
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(srv);
  }

  const healthyOrWarm: T[] = [];
  const coolingDown: Array<{ server: T; cooldownUntil: number }> = [];

  for (const srv of deduped) {
    const key = normalizeDanmuServerKey(srv.baseUrl);
    const snap = serverHealthMap.get(key);
    const cooldownUntil = snap?.cooldownUntil ?? 0;
    if (cooldownUntil > now) {
      coolingDown.push({ server: srv, cooldownUntil });
    } else {
      healthyOrWarm.push(srv);
    }
  }

  healthyOrWarm.sort((a, b) => {
    const keyA = normalizeDanmuServerKey(a.baseUrl);
    const keyB = normalizeDanmuServerKey(b.baseUrl);
    const isPrimaryA = keyA === primaryKey;
    const isPrimaryB = keyB === primaryKey;
    if (isPrimaryA !== isPrimaryB) {
      return isPrimaryA ? -1 : 1;
    }

    const snapA = serverHealthMap.get(keyA);
    const snapB = serverHealthMap.get(keyB);
    const isCleanA = (snapA?.consecutiveFailures ?? 0) === 0 && a.status !== 'error';
    const isCleanB = (snapB?.consecutiveFailures ?? 0) === 0 && b.status !== 'error';
    if (isCleanA !== isCleanB) {
      return isCleanA ? -1 : 1;
    }

    const latA = snapA?.emaLatencyMs ?? (typeof a.latency === 'number' && a.latency > 0 ? a.latency : Number.POSITIVE_INFINITY);
    const latB = snapB?.emaLatencyMs ?? (typeof b.latency === 'number' && b.latency > 0 ? b.latency : Number.POSITIVE_INFINITY);
    return latA - latB;
  });

  coolingDown.sort((a, b) => a.cooldownUntil - b.cooldownUntil);

  return [...healthyOrWarm, ...coolingDown.map((entry) => entry.server)];
}
