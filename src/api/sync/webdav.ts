// src/api/sync/webdav.ts

import { httpClient } from '../http';

export interface WebDavConfig {
  url: string; // e.g. "https://dav.jianguoyun.com/dav/nocta/"
  username: string;
  password?: string;
  fileName?: string; // 默认 "nocta-sync.json"
}

export interface SyncDriverTestResult {
  ok: bool;
  fileExists: boolean;
  latency: number;
  error?: string;
}

type bool = boolean;

export class WebDavSyncDriver {
  constructor(private config: WebDavConfig) {}

  private getAuthHeader(): Record<string, string> {
    if (this.config.username || this.config.password) {
      const raw = `${this.config.username || ''}:${this.config.password || ''}`;
      const token = btoa(unescape(encodeURIComponent(raw)));
      return { Authorization: `Basic ${token}` };
    }
    return {};
  }

  private getTargetUrl(fileName?: string): string {
    let base = (this.config.url || '').trim().replace(/\/+$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `https://${base}`;
    }
    const file = (fileName || this.config.fileName || 'nocta-sync.json').trim().replace(/^\/+/, '');
    return `${base}/${file}`;
  }

  async testConnection(fileName?: string): Promise<SyncDriverTestResult> {
    const start = performance.now();
    try {
      const target = this.getTargetUrl(fileName);

      const res = await httpClient(target, {
        method: 'GET',
        headers: {
          ...this.getAuthHeader(),
          Accept: 'application/json, */*',
        },
      });

      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        return { ok: true, fileExists: true, latency };
      }

      if (res.status === 404) {
        // 文件尚未创建，但说明服务可达且鉴权已通过
        return { ok: true, fileExists: false, latency };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          fileExists: false,
          latency,
          error: `认证失败 (HTTP ${res.status}): 请核对 WebDAV 用户名或应用密码`,
        };
      }

      return {
        ok: false,
        fileExists: false,
        latency,
        error: `HTTP ${res.status} ${res.statusText}`,
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
    const target = this.getTargetUrl(fileName);
    const res = await httpClient(target, {
      method: 'GET',
      headers: {
        ...this.getAuthHeader(),
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (res.status === 404) {
      throw new Error('WebDAV 远程配置文件尚未生成或不存在');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 认证失败 (HTTP ${res.status})，请检查账号密码`);
    }
    if (!res.ok) {
      throw new Error(`WebDAV 下载失败: HTTP ${res.status} ${res.statusText}`);
    }

    return await res.text();
  }

  async upload(content: string, fileName?: string): Promise<void> {
    const target = this.getTargetUrl(fileName);
    const res = await httpClient(target, {
      method: 'PUT',
      headers: {
        ...this.getAuthHeader(),
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: content,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`WebDAV 认证失败 (HTTP ${res.status})，请检查账号密码`);
    }
    if (res.status === 409) {
      throw new Error('WebDAV 上传失败: 父级目录不存在，请先在网盘中创建对应子文件夹');
    }
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`WebDAV 上传失败: HTTP ${res.status} ${res.statusText}`);
    }
  }
}
