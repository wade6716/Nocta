// src/api/sync/s3.ts

import { AwsClient } from 'aws4fetch';
import { httpClient } from '../http';
import { SyncDriverTestResult } from './webdav';

export interface S3Config {
  endpoint: string; // 如 "https://s3.us-east-1.amazonaws.com" 或 "https://<account>.r2.cloudflarestorage.com"
  region?: string; // 默认 "auto" 或 "us-east-1"
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string; // 如 "nocta/"
  fileName?: string; // 默认 "nocta-sync.json"
  forcePathStyle?: boolean; // 默认 true (兼容 MinIO / R2 / 自建 S3)
}

export class S3SyncDriver {
  private aws: AwsClient;

  constructor(private config: S3Config) {
    this.aws = new AwsClient({
      accessKeyId: (this.config.accessKeyId || '').trim(),
      secretAccessKey: (this.config.secretAccessKey || '').trim(),
      region: (this.config.region || '').trim() || 'auto',
      service: 's3',
    });
  }

  private getTargetUrl(fileName?: string): string {
    let endpoint = (this.config.endpoint || '').trim().replace(/\/+$/, '');
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
    }

    const bucket = (this.config.bucket || '').trim();
    let prefix = (this.config.prefix || '').trim().replace(/^\/+/, '');
    if (prefix && !prefix.endsWith('/')) {
      prefix = `${prefix}/`;
    }

    const file = (fileName || this.config.fileName || 'nocta-sync.json').trim().replace(/^\/+/, '');
    const key = `${prefix}${file}`;

    // 默认使用 Path-Style (https://endpoint/bucket/key)
    // 兼容 MinIO、Cloudflare R2、自建 S3、阿里云 OSS、腾讯云 COS
    return `${endpoint}/${bucket}/${key}`;
  }

  private async fetchSigned(
    url: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ): Promise<Response> {
    const signedReq = await this.aws.sign(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });

    const headers: Record<string, string> = {};
    signedReq.headers.forEach((val, key) => {
      headers[key] = val;
    });

    return await httpClient(signedReq.url, {
      method: signedReq.method,
      headers,
      body: options.body,
    });
  }

  async testConnection(fileName?: string): Promise<SyncDriverTestResult> {
    const start = performance.now();
    try {
      const target = this.getTargetUrl(fileName);
      const res = await this.fetchSigned(target, {
        method: 'GET',
        headers: { Accept: 'application/json, */*' },
      });

      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        return { ok: true, fileExists: true, latency };
      }

      if (res.status === 404) {
        // 文件尚未创建，但 S3 桶与身份认证均校验通过
        return { ok: true, fileExists: false, latency };
      }

      if (res.status === 403) {
        return {
          ok: false,
          fileExists: false,
          latency,
          error: 'S3 认证失败 (HTTP 403): AccessKey / SecretKey 错误或无权访问该存储桶',
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
        error: err?.message || '无法连接到 S3 服务节点',
      };
    }
  }

  async download(fileName?: string): Promise<string> {
    const target = this.getTargetUrl(fileName);
    const res = await this.fetchSigned(target, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
    });

    if (res.status === 404) {
      throw new Error('S3 远程配置文件尚未生成或不存在');
    }
    if (res.status === 403) {
      throw new Error('S3 权限不足或密钥错误 (HTTP 403)');
    }
    if (!res.ok) {
      throw new Error(`S3 下载失败: HTTP ${res.status} ${res.statusText}`);
    }

    return await res.text();
  }

  async upload(content: string, fileName?: string): Promise<void> {
    const target = this.getTargetUrl(fileName);
    const res = await this.fetchSigned(target, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: content,
    });

    if (res.status === 403) {
      throw new Error('S3 权限不足或密钥错误 (HTTP 403)');
    }
    if (!res.ok && res.status !== 200 && res.status !== 201) {
      throw new Error(`S3 上传失败: HTTP ${res.status} ${res.statusText}`);
    }
  }
}
