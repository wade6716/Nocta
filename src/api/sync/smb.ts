// src/api/sync/smb.ts

import { invoke } from '@tauri-apps/api/core';
import { SyncDriverTestResult } from './webdav';

export interface SmbConfig {
  host: string; // 如 "192.168.1.100" 或 "\\192.168.1.100"
  share: string; // 如 "share" 或 "media"
  path?: string; // 如 "nocta"
  username?: string;
  password?: string;
  domain?: string;
  fileName?: string; // 默认 "nocta-sync.json"
}

interface RustSmbTestResult {
  ok: boolean;
  file_exists: boolean;
  latency: number;
  error?: string;
}

export class SmbSyncDriver {
  constructor(private config: SmbConfig) {}

  private getPayload() {
    return {
      host: this.config.host || '',
      share: this.config.share || '',
      path: this.config.path || null,
      username: this.config.username || null,
      password: this.config.password || null,
      domain: this.config.domain || null,
    };
  }

  async testConnection(fileName?: string): Promise<SyncDriverTestResult> {
    try {
      const file = fileName || this.config.fileName || 'nocta-sync.json';
      const res = await invoke<RustSmbTestResult>('sync_smb_test', {
        payload: this.getPayload(),
        fileName: file,
      });

      return {
        ok: res.ok,
        fileExists: res.file_exists,
        latency: res.latency,
        error: res.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        fileExists: false,
        latency: 0,
        error: err?.message || String(err),
      };
    }
  }

  async download(fileName?: string): Promise<string> {
    const file = fileName || this.config.fileName || 'nocta-sync.json';
    return await invoke<string>('sync_smb_read', {
      payload: this.getPayload(),
      fileName: file,
    });
  }

  async upload(content: string, fileName?: string): Promise<void> {
    const file = fileName || this.config.fileName || 'nocta-sync.json';
    await invoke('sync_smb_write', {
      payload: this.getPayload(),
      fileName: file,
      content,
    });
  }
}
