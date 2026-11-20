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
}

export interface SystemProxyResult {
  enabled: boolean;
  url: string | null;
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

export async function resolveEffectiveProxyDetailed(config?: ProxyConfig): Promise<{
  url?: string;
  source: 'direct' | 'system' | 'manual';
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
      ? { url: sys.url, source: 'system' }
      : { source: 'direct' };
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
    try {
      const effectiveProxy = await resolveEffectiveProxy(init?.proxy);
      const requestOptions: any = { ...init };
      if (effectiveProxy) {
        requestOptions.proxy = { all: effectiveProxy };
      }
      return await tauriFetch(input as any, requestOptions);
    } catch (err) {
      console.error('[Tauri HTTP Error]', err);
      throw err;
    }
  }

  // 纯浏览器 Dev 模式降级
  return window.fetch(input, init);
}

export default httpClient;
