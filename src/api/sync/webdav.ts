// src/api/sync/webdav.ts

import { getGlobalProxyConfig, httpClient, isTauriEnvironment } from '../http';

export interface WebDavConfig {
  url: string; // e.g. "https://dav.jianguoyun.com/dav/nocta/"
  username: string;
  password?: string;
  fileName?: string; // 默认 "nocta-sync.json"
}

export interface SyncDriverTestResult {
  ok: boolean;
  fileExists: boolean;
  latency: number;
  error?: string;
  upgradedUrl?: string;
}

export interface WebDavDriverOptions {
  onUrlUpgraded?: (newUrl: string) => void;
}

async function readErrorSnippet(res: Response): Promise<string> {
  try {
    const text = (await res.text()).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return '';
  }
}

export class WebDavSyncDriver {
  private resolvedBaseUrl: string | null = null;

  constructor(private config: WebDavConfig, private options?: WebDavDriverOptions) {}

  private getAuthHeader(): Record<string, string> {
    if (this.config.username || this.config.password) {
      const raw = `${this.config.username || ''}:${this.config.password || ''}`;
      const token = btoa(unescape(encodeURIComponent(raw)));
      return { Authorization: `Basic ${token}` };
    }
    return {};
  }

  private getNormalizedBaseUrl(forceHttps = false): string {
    let base = (this.resolvedBaseUrl || this.config.url || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (!/^https?:\/\//i.test(base)) {
      base = `https://${base}`;
    }
    if (forceHttps && /^http:\/\//i.test(base)) {
      base = base.replace(/^http:\/\//i, 'https://');
    }
    return base;
  }

  private getTargetUrl(fileName?: string, forceHttps = false): string {
    const base = this.getNormalizedBaseUrl(forceHttps);
    const file = (fileName || this.config.fileName || 'nocta-sync.json')
      .trim()
      .replace(/^\/+/, '');
    return `${base}/${file}`;
  }

  private getDirectoryUrl(fileName?: string, forceHttps = false): string {
    const target = this.getTargetUrl(fileName, forceHttps);
    const schemeEnd = target.indexOf('://');
    const hostEnd = schemeEnd >= 0 ? target.indexOf('/', schemeEnd + 3) : -1;
    const lastSlash = target.lastIndexOf('/');
    if (hostEnd >= 0 && lastSlash > hostEnd) {
      return target.slice(0, lastSlash);
    }
    return this.getNormalizedBaseUrl(forceHttps);
  }

  /**
   * 统一发送 WebDAV 请求：
   * - 在 Tauri 环境移除默认 Origin 头，避免 WebDAV 服务校验拒收
   * - 跟随全局代理配置（不受 Emby 单服代理覆写劫持），并遵循操作系统跳过代理列表
   * - 当用户填 http:// 连向实际为 HTTPS 的端口（如 5006 返回 400 或 TLS 协议错）时，自动升级为 https:// 重试并回写配置
   */
  private async request(
    buildUrl: (forceHttps: boolean) => string,
    init: RequestInit
  ): Promise<{ res: Response; upgradedUrl?: string }> {
    const currentBase = this.getNormalizedBaseUrl(false);
    const canUpgradeToHttps = /^http:\/\//i.test(currentBase);

    const sendOnce = (forceHttps: boolean) => {
      const url = buildUrl(forceHttps);
      const headers: Record<string, string> = {
        ...(isTauriEnvironment() ? { Origin: '' } : {}),
        ...this.getAuthHeader(),
        ...((init.headers as Record<string, string>) || {}),
      };
      return httpClient(url, {
        ...init,
        headers,
        proxy: getGlobalProxyConfig(),
      });
    };

    let res: Response;
    try {
      res = await sendOnce(false);
    } catch (err) {
      if (!canUpgradeToHttps) throw err;
      res = await sendOnce(true);
      const httpsBase = this.getNormalizedBaseUrl(true);
      this.resolvedBaseUrl = httpsBase;
      this.options?.onUrlUpgraded?.(httpsBase);
      return { res, upgradedUrl: httpsBase };
    }

    if (res.status === 400 && canUpgradeToHttps) {
      const bodyText = await res
        .clone()
        .text()
        .catch(() => '');
      if (!bodyText || /https|ssl|tls|plain\s+http/i.test(bodyText)) {
        try {
          const retryRes = await sendOnce(true);
          if (retryRes.status !== 400) {
            const httpsBase = this.getNormalizedBaseUrl(true);
            this.resolvedBaseUrl = httpsBase;
            this.options?.onUrlUpgraded?.(httpsBase);
            return { res: retryRes, upgradedUrl: httpsBase };
          }
        } catch {
          // HTTPS 重试亦失败时，返回原始 400 供上层展示详细信息
        }
      }
    }

    return { res };
  }

  private async ensureDirectory(fileName?: string): Promise<void> {
    try {
      await this.request(
        (forceHttps) => this.getDirectoryUrl(fileName, forceHttps),
        { method: 'MKCOL' }
      );
    } catch (e) {
      console.warn('[WebDAV MKCOL ignore]', e);
    }
  }

  async testConnection(fileName?: string): Promise<SyncDriverTestResult> {
    const start = performance.now();
    try {
      if (!this.getNormalizedBaseUrl(false)) {
        return {
          ok: false,
          fileExists: false,
          latency: 0,
          error: '请填写 WebDAV 目录地址',
        };
      }

      const { res, upgradedUrl } = await this.request(
        (forceHttps) => this.getTargetUrl(fileName, forceHttps),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json, */*',
          },
        }
      );

      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        return { ok: true, fileExists: true, latency, upgradedUrl };
      }

      if (res.status === 404) {
        // 文件尚未创建，但说明服务可达且鉴权已通过
        return { ok: true, fileExists: false, latency, upgradedUrl };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          fileExists: false,
          latency,
          upgradedUrl,
          error: `认证失败 (HTTP ${res.status}): 请核对 WebDAV 用户名或应用密码`,
        };
      }

      const detail = await readErrorSnippet(res);
      return {
        ok: false,
        fileExists: false,
        latency,
        upgradedUrl,
        error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${
          detail ? ` - ${detail}` : ''
        }`,
      };
    } catch (err: any) {
      return {
        ok: false,
        fileExists: false,
        latency: Math.round(performance.now() - start),
        error: err?.message || '无法连接到 WebDAV 服务器',
      };
    }
  }

  async download(fileName?: string): Promise<string> {
    const { res } = await this.request(
      (forceHttps) => this.getTargetUrl(fileName, forceHttps),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      }
    );

    if (res.status === 404) {
      throw new Error('WebDAV 远程配置文件尚未生成或不存在');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 认证失败 (HTTP ${res.status})，请检查账号密码`);
    }
    if (!res.ok) {
      const detail = await readErrorSnippet(res);
      throw new Error(
        `WebDAV 下载失败: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${
          detail ? ` - ${detail}` : ''
        }`
      );
    }

    return await res.text();
  }

  async upload(content: string, fileName?: string): Promise<void> {
    const putHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
    };

    let { res } = await this.request(
      (forceHttps) => this.getTargetUrl(fileName, forceHttps),
      {
        method: 'PUT',
        headers: putHeaders,
        body: content,
      }
    );

    if (res.status === 404 || res.status === 409) {
      // 首次写入若子目录尚未创建，自动尝试 MKCOL 建目录后重试一次 PUT
      await this.ensureDirectory(fileName);
      ({ res } = await this.request(
        (forceHttps) => this.getTargetUrl(fileName, forceHttps),
        {
          method: 'PUT',
          headers: putHeaders,
          body: content,
        }
      ));
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 认证失败 (HTTP ${res.status})，请检查账号密码`);
    }
    if (res.status === 409) {
      throw new Error('WebDAV 上传失败: 父级目录不存在，请先在网盘中创建对应子文件夹');
    }
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      const detail = await readErrorSnippet(res);
      throw new Error(
        `WebDAV 上传失败: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${
          detail ? ` - ${detail}` : ''
        }`
      );
    }
  }
}
