import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';

export type ProxyType = 'direct' | 'system' | 'manual' | 'http' | 'socks5';

export interface ProxyConfig {
  type: ProxyType;
  /** 手动指定的代理地址，如 "http://127.0.0.1:7890" 或 "socks5://127.0.0.1:10808" */
  serverUrl?: string;
  server?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface HttpRequestOptions extends RequestInit {
  proxy?: ProxyConfig;
  /** 是否遵循操作系统跳过代理列表（默认 true；代理连通性测速设为 false） */
  respectSystemBypass?: boolean;
  /** 代理请求失败时是否允许静默回退直连（默认 true；强制代理/测速应设为 false） */
  fallbackToDirect?: boolean;
}

export interface SystemProxyResult {
  enabled: boolean;
  url: string | null;
  bypass?: string[];
}

export interface RuntimeServerProxyEntry {
  mode: string;
  manualUrl?: string;
}

export interface RuntimeProxySyncPayload {
  mode: string;
  manualUrl?: string;
  defaultUserAgent?: string;
  serverUserAgents?: Record<string, string>;
  serverProxies?: Record<string, RuntimeServerProxyEntry>;
}

/**
 * 判断当前是否运行在 Tauri 运行时环境下
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 代理配置外部注入解耦机制，避免与 store 产生循环依赖
let activeProxyGetter: (() => ProxyConfig | undefined) | null = null;
let globalProxyGetter: (() => ProxyConfig | undefined) | null = null;

export function registerProxyGetter(fn: () => ProxyConfig | undefined) {
  activeProxyGetter = fn;
}

export function registerGlobalProxyGetter(fn: () => ProxyConfig | undefined) {
  globalProxyGetter = fn;
}

export function getGlobalProxyConfig(): ProxyConfig | undefined {
  return globalProxyGetter
    ? globalProxyGetter()
    : activeProxyGetter
    ? activeProxyGetter()
    : undefined;
}

/**
 * 格式化手动配置代理地址
 */
export function formatProxyUrl(config: ProxyConfig): string | undefined {
  if (config.type === 'direct') return undefined;

  let base = config.serverUrl?.trim();
  if (!base && config.server) {
    const port = config.port ? `:${config.port}` : '';
    const proto = config.type === 'socks5' ? 'socks5' : 'http';
    base = `${proto}://${config.server}${port}`;
  }
  if (!base) return undefined;

  // 补齐协议头
  if (
    !base.startsWith('http://') &&
    !base.startsWith('https://') &&
    !base.startsWith('socks5://') &&
    !base.startsWith('socks5h://') &&
    !base.startsWith('socks://')
  ) {
    base = `http://${base}`;
  } else if (base.startsWith('socks://')) {
    base = base.replace(/^socks:\/\//, 'socks5://');
  }

  // 填充可选用户名与密码
  if (config.username && config.password) {
    try {
      const u = new URL(base);
      u.username = config.username;
      u.password = config.password;
      return u.toString();
    } catch {}
  }

  return base;
}

let cachedSystemProxy: { time: number; result: SystemProxyResult } | null = null;

/**
 * 调用 Rust 后端跨平台获取系统代理 (Windows / macOS / Linux)
 */
export async function fetchSystemProxy(forceRefresh = false): Promise<SystemProxyResult> {
  const now = Date.now();
  if (!forceRefresh && cachedSystemProxy && now - cachedSystemProxy.time < 3000) {
    return cachedSystemProxy.result;
  }

  if (isTauriEnvironment()) {
    try {
      const res = await invoke<SystemProxyResult>('get_system_proxy');
      cachedSystemProxy = { time: now, result: res };
      return res;
    } catch (e) {
      console.warn('[Fetch System Proxy Error]', e);
    }
  }

  const fallback: SystemProxyResult = { enabled: false, url: null };
  cachedSystemProxy = { time: now, result: fallback };
  return fallback;
}

/**
 * 判断 URL 是否指向本机回环地址（仅用于拦截 libmpv 对 Nocta 本地预载/中转流误走外部代理）
 */
export function isLoopbackUrl(targetUrl?: string): boolean {
  if (!targetUrl) return false;
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      /^127\./.test(host)
    );
  } catch {
    return false;
  }
}

function parseIpv4ToUint32(raw: string): number | null {
  const clean = raw.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clean)) return null;
  const parts = clean.split('.');
  let acc = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    acc = acc * 256 + num;
  }
  return acc >>> 0;
}

function parseIpv6ToBigInt(raw: string): bigint | null {
  let clean = raw.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!clean || !clean.includes(':')) return null;

  const doubleColonParts = clean.split('::');
  if (doubleColonParts.length > 2) return null;

  const expandSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(':');
    const groups: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) return null;
      if (tok.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const v4 = parseIpv4ToUint32(tok);
        if (v4 === null) return null;
        groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        groups.push(parseInt(tok, 16));
      }
    }
    return groups;
  };

  let groups: number[] | null = null;
  if (doubleColonParts.length === 2) {
    const left = expandSide(doubleColonParts[0]);
    const right = expandSide(doubleColonParts[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const parsed = expandSide(clean);
    if (!parsed || parsed.length !== 8) return null;
    groups = parsed;
  }

  let acc = 0n;
  for (const g of groups) {
    acc = (acc << 16n) | BigInt(g);
  }
  return acc;
}

function matchCidrRule(targetHost: string, addrPart: string, prefixPart: string): boolean | null {
  const cleanAddr = addrPart.trim().replace(/^\[|\]$/g, '');
  const prefixStr = prefixPart.trim();
  if (!/^\d+$/.test(prefixStr)) return null;
  const prefix = Number(prefixStr);

  const netV4 = parseIpv4ToUint32(cleanAddr);
  if (netV4 !== null) {
    if (prefix < 0 || prefix > 32) return null;
    const targetV4 = parseIpv4ToUint32(targetHost);
    if (targetV4 === null) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return ((targetV4 & mask) >>> 0) === ((netV4 & mask) >>> 0);
  }

  const netV6 = parseIpv6ToBigInt(cleanAddr);
  if (netV6 !== null) {
    if (prefix < 0 || prefix > 128) return null;
    const targetV6 = parseIpv6ToBigInt(targetHost);
    if (targetV6 === null) return false;
    const fullMask = (1n << 128n) - 1n;
    const mask = prefix === 0 ? 0n : (fullMask << BigInt(128 - prefix)) & fullMask;
    return (targetV6 & mask) === (netV6 & mask);
  }

  return null;
}

function splitRuleHostPort(rule: string): [string, string | null] {
  if (rule.startsWith('[')) {
    const closeIdx = rule.indexOf(']');
    if (closeIdx > 0) {
      const inner = rule.slice(1, closeIdx);
      const after = rule.slice(closeIdx + 1);
      if (after.startsWith(':')) {
        return [inner, after.slice(1)];
      }
      return [inner, null];
    }
  }
  const firstColon = rule.indexOf(':');
  if (firstColon !== -1 && firstColon === rule.lastIndexOf(':')) {
    return [rule.slice(0, firstColon), rule.slice(firstColon + 1)];
  }
  return [rule, null];
}

function globMatch(pattern: string, text: string): boolean {
  let pi = 0;
  let ti = 0;
  let starIdx = -1;
  let matchIdx = 0;

  while (ti < text.length) {
    if (pi < pattern.length && (pattern[pi] === '?' || pattern[pi] === text[ti])) {
      pi++;
      ti++;
    } else if (pi < pattern.length && pattern[pi] === '*') {
      starIdx = pi;
      matchIdx = ti;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      ti = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === '*') {
    pi++;
  }
  return pi === pattern.length;
}

/**
 * 严格依据操作系统「跳过代理」列表及 NO_PROXY 规则判断目标 URL 是否旁路代理
 */
export function shouldBypassProxy(targetUrl?: string, bypassRules: string[] = []): boolean {
  if (!targetUrl || !bypassRules || bypassRules.length === 0) return false;
  try {
    const parsed = new URL(targetUrl);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host) return false;

    const port = parsed.port || (scheme === 'https' ? '443' : scheme === 'http' ? '80' : '');
    const hostV4 = parseIpv4ToUint32(host);
    const hostV6 = hostV4 === null ? parseIpv6ToBigInt(host) : null;

    for (const rawRule of bypassRules) {
      let rule = rawRule.trim().toLowerCase();
      if (!rule) continue;

      if (rule.startsWith('http://')) {
        if (scheme !== 'http') continue;
        rule = rule.slice('http://'.length);
      } else if (rule.startsWith('https://')) {
        if (scheme !== 'https') continue;
        rule = rule.slice('https://'.length);
      }

      if (rule === '*') return true;
      if (rule === '<local>') {
        if (!host.includes('.')) return true;
        continue;
      }

      const slashIdx = rule.indexOf('/');
      if (slashIdx !== -1) {
        const addrPart = rule.slice(0, slashIdx);
        const suffixPart = rule.slice(slashIdx + 1);
        const cidrMatch = matchCidrRule(host, addrPart, suffixPart);
        if (cidrMatch !== null) {
          if (cidrMatch) return true;
          continue;
        }
        rule = addrPart;
      }

      const [ruleHost, rulePort] = splitRuleHostPort(rule);
      if (rulePort) {
        if (!port || !globMatch(rulePort, port)) {
          continue;
        }
      }
      if (!ruleHost) continue;

      if (hostV4 !== null) {
        const ruleV4 = parseIpv4ToUint32(ruleHost);
        if (ruleV4 !== null && ruleV4 === hostV4) return true;
      } else if (hostV6 !== null) {
        const ruleV6 = parseIpv6ToBigInt(ruleHost);
        if (ruleV6 !== null && ruleV6 === hostV6) return true;
      }

      if (ruleHost.startsWith('.')) {
        const suffix = ruleHost.slice(1);
        if (host === suffix || host.endsWith(ruleHost)) return true;
        continue;
      }

      if (globMatch(ruleHost, host)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function syncRuntimeProxyToRust(payload: RuntimeProxySyncPayload): Promise<void> {
  if (!isTauriEnvironment()) return;
  try {
    await invoke('sync_runtime_proxy_config', { config: payload });
  } catch (e) {
    console.warn('[Sync Runtime Proxy Error]', e);
  }
}

export async function resolveEffectiveProxyDetailed(config?: ProxyConfig): Promise<{
  url?: string;
  source: 'direct' | 'system' | 'manual';
  bypass?: string[];
}> {
  const targetConfig = config || (activeProxyGetter ? activeProxyGetter() : undefined);
  if (!targetConfig) {
    return { source: 'direct' };
  }

  if (targetConfig.type === 'direct') {
    return { source: 'direct' };
  }

  if (targetConfig.type === 'system') {
    const sys = await fetchSystemProxy();
    return sys.enabled && sys.url
      ? { url: sys.url, source: 'system', bypass: sys.bypass }
      : { source: 'direct', bypass: sys.bypass };
  }

  // manual / http / socks5：同样遵循操作系统的跳过代理列表
  const sys = await fetchSystemProxy();
  return {
    url: formatProxyUrl(targetConfig),
    source: 'manual',
    bypass: sys.bypass,
  };
}

/**
 * 计算当前应该生效的代理 URL 字符串
 * @param config 若传入特定配置则优先解析，否则解析全局/当前活动配置
 */
export async function resolveEffectiveProxy(config?: ProxyConfig): Promise<string | undefined> {
  const detail = await resolveEffectiveProxyDetailed(config);
  return detail.url;
}

export type HttpResponseObserver = (url: string, status: number, finalUrl?: string) => void;
let httpResponseObserver: HttpResponseObserver | null = null;

/**
 * 注册全局 HTTP 响应观察者（用于收集 Emby API / 直链等真实访问域名与重定向目标）
 */
export function registerHttpResponseObserver(observer: HttpResponseObserver | null) {
  httpResponseObserver = observer;
}

/**
 * 统一网络请求函数
 * 在 Tauri 环境下强制使用 @tauri-apps/plugin-http 规避跨域限制（CORS）并自动注入代理
 * 在浏览器开发调试环境下自动降级为原生 window.fetch
 */
export async function httpClient(
  input: string | URL | Request,
  init?: HttpRequestOptions
): Promise<Response> {
  if (isTauriEnvironment()) {
    const proxyDetail = await resolveEffectiveProxyDetailed(init?.proxy);
    const targetUrlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const bypassed =
      Boolean(proxyDetail.url) &&
      init?.respectSystemBypass !== false &&
      shouldBypassProxy(targetUrlStr, proxyDetail.bypass || []);
    const rawEffectiveProxy = bypassed ? undefined : proxyDetail.url;
    // 将 socks5:// 升级为 socks5h://，由代理远端解析 DNS（避免本地 DNS 污染导致域名解析失败）
    const effectiveProxy = rawEffectiveProxy
      ? rawEffectiveProxy.replace(/^socks5:\/\//i, 'socks5h://')
      : undefined;
    const allowFallbackToDirect = init?.fallbackToDirect !== false;

    const baseRequestOptions: any = {
      ...init,
      danger: {
        acceptInvalidCerts: true,
        acceptInvalidHostnames: true,
        ...(init as any)?.danger,
      },
    };
    delete baseRequestOptions.proxy;
    delete baseRequestOptions.respectSystemBypass;
    delete baseRequestOptions.fallbackToDirect;

    // 显式选择 direct 或命中操作系统跳过代理列表时，通过 noProxy: '*' 强制旁路 reqwest 内置系统代理探测
    if ((proxyDetail.source === 'direct' || bypassed) && !effectiveProxy) {
      baseRequestOptions.proxy = {
        all: {
          url: 'http://127.0.0.1:1',
          noProxy: '*',
        },
      };
    }

    const requestOptions: any = { ...baseRequestOptions };
    if (effectiveProxy) {
      requestOptions.proxy = { all: effectiveProxy };
    }

    try {
      const res = await tauriFetch(input as any, requestOptions);
      httpResponseObserver?.(targetUrlStr, res.status, res.url || targetUrlStr);
      return res;
    } catch (err) {
      // 代理不可用或局域网请求被代理中断时，按需回退无代理直连兜底一次
      if (effectiveProxy && allowFallbackToDirect && !init?.signal?.aborted) {
        try {
          console.warn('[Tauri HTTP Proxy Fallback -> Direct]', input, err);
          const fallbackRes = await tauriFetch(input as any, {
            ...baseRequestOptions,
            proxy: {
              all: {
                url: effectiveProxy,
                noProxy: '*',
              },
            },
          });
          httpResponseObserver?.(targetUrlStr, fallbackRes.status, fallbackRes.url || targetUrlStr);
          return fallbackRes;
        } catch (directErr) {
          console.error('[Tauri HTTP Error (after proxy fallback)]', directErr);
          throw err;
        }
      }
      console.error('[Tauri HTTP Error]', err);
      throw err;
    }
  }

  // 纯浏览器 Dev 模式降级
  const browserUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const res = await window.fetch(input, init);
  httpResponseObserver?.(browserUrl, res.status, res.url || browserUrl);
  return res;
}

export default httpClient;
