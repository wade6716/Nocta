import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export type ProxyType = 'direct' | 'system' | 'http' | 'socks5';

export interface ProxyConfig {
  type: ProxyType;
  server?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface HttpRequestOptions extends RequestInit {
  proxy?: ProxyConfig;
}

/**
 * 判断当前是否运行在 Tauri 运行时环境下
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 统一网络请求函数
 * 在 Tauri 环境下强制使用 @tauri-apps/plugin-http 规避跨域限制（CORS）
 * 在浏览器开发调试环境下自动降级为原生 window.fetch
 */
export async function httpClient(
  input: string | URL | Request,
  init?: HttpRequestOptions
): Promise<Response> {
  if (isTauriEnvironment()) {
    try {
      return await tauriFetch(input as any, init as any);
    } catch (err) {
      console.error('[Tauri HTTP Error]', err);
      throw err;
    }
  }

  // 纯浏览器 Dev 模式降级
  return window.fetch(input, init);
}

export default httpClient;
