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
  /** 是否对内网/本地及系统绕过规则命中目标自动旁路代理（默认 true） */
  bypassLan?: boolean;
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

export function registerProxyGetter(fn: () => ProxyConfig | undefined) {
  activeProxyGetter = fn;
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

export function shouldBypassProxy(targetUrl?: string, bypassRules: string[] = []): boolean {
  if (!targetUrl) return false;
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host) return false;

    if (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.lan') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^fe80:/i.test(host) ||
      /^f[cd][0-9a-f]{2}:/i.test(host)
    ) {
      return true;
    }

    const match172 = host.match(/^172\.(\d+)\./);
    if (match172) {
      const secondOctet = Number(match172[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }

    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const hostPort = `${host}:${port}`;

    for (const rawRule of bypassRules) {
      let rule = rawRule.trim().toLowerCase();
      if (!rule) continue;
      rule = rule.replace(/^https?:\/\//i, '').split('/')[0];
      if (rule === '<local>') {
        if (!host.includes('.')) return true;
        continue;
      }
      if (rule === '*') return true;
      if (rule.startsWith('.')) {
        const suffix = rule.slice(1);
        if (host === suffix || host.endsWith(rule)) return true;
        continue;
      }
      const regexStr =
        '^' +
        rule
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$';
      const re = new RegExp(regexStr);
      if (rule.includes(':') ? re.test(hostPort) || re.test(host) : re.test(host)) {
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

  // manual / http / socks5
  return {
    url: formatProxyUrl(targetConfig),
    source: 'manual',
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
      init?.bypassLan !== false &&
      shouldBypassProxy(targetUrlStr, proxyDetail.bypass || []);
    const effectiveProxy = bypassed ? undefined : proxyDetail.url;

    const baseRequestOptions: any = {
      ...init,
      danger: {
        acceptInvalidCerts: true,
        acceptInvalidHostnames: true,
        ...(init as any)?.danger,
      },
    };
    delete baseRequestOptions.proxy;
    delete baseRequestOptions.bypassLan;

    // 显式选择 direct 或命中局域网/绕过规则时，通过 noProxy: '*' 强制旁路 reqwest 内置系统代理探测
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
      return await tauriFetch(input as any, requestOptions);
    } catch (err) {
      // 代理不可用或局域网请求被代理中断时，自动退回无代理直连兜底一次
      if (effectiveProxy && !init?.signal?.aborted) {
        try {
          console.warn('[Tauri HTTP Proxy Fallback -> Direct]', input, err);
          return await tauriFetch(input as any, {
            ...baseRequestOptions,
            proxy: {
              all: {
                url: effectiveProxy,
                noProxy: '*',
              },
            },
          });
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
  return window.fetch(input, init);
}

export default httpClient;
