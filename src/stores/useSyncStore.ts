// src/stores/useSyncStore.ts

import { create } from 'zustand';
import { WebDavConfig, WebDavSyncDriver, SyncDriverTestResult } from '../api/sync/webdav';
import { S3Config, S3SyncDriver } from '../api/sync/s3';
import { SmbConfig, SmbSyncDriver } from '../api/sync/smb';
import {
  getLocalConfigSnapshot,
  exportLocalConfig,
  parseBackupPayload,
  mergeConfigData,
  applyConfigToStores,
  NoctaBackupPayload,
} from '../services/configBackupService';

export type SyncProviderType = 'webdav' | 's3' | 'smb';

export interface SyncState {
  enabled: boolean;
  provider: SyncProviderType;
  webdav: WebDavConfig;
  s3: S3Config;
  smb: SmbConfig;
  encryptionPassphrase: string;
  autoSyncOnStartup: boolean;

  // 状态追踪
  isSyncing: boolean;
  lastSyncTime: number | null;
  lastSyncStatus: 'success' | 'error' | 'idle' | 'syncing';
  lastSyncMessage: string | null;

  // Actions
  updateSyncConfig: (partial: Partial<Omit<SyncState, 'webdav' | 's3' | 'smb'>>) => void;
  updateWebDavConfig: (partial: Partial<WebDavConfig>) => void;
  updateS3Config: (partial: Partial<S3Config>) => void;
  updateSmbConfig: (partial: Partial<SmbConfig>) => void;
  testConnection: () => Promise<SyncDriverTestResult>;
  syncNow: (
    mode?: 'smart_merge' | 'upload_only' | 'download_only'
  ) => Promise<{ success: boolean; message: string }>;
}

const SYNC_CONFIG_KEY = 'nocta_sync_configuration_v1';

const DEFAULT_WEBDAV: WebDavConfig = {
  url: '',
  username: '',
  password: '',
  fileName: 'nocta-sync.json',
};

const DEFAULT_S3: S3Config = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  prefix: 'nocta/',
  fileName: 'nocta-sync.json',
  forcePathStyle: true,
};

const DEFAULT_SMB: SmbConfig = {
  host: '',
  share: '',
  path: 'nocta',
  username: '',
  password: '',
  domain: '',
  fileName: 'nocta-sync.json',
};

function loadInitialSyncState() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled ?? false,
        provider: parsed.provider ?? 'webdav',
        webdav: { ...DEFAULT_WEBDAV, ...(parsed.webdav || {}) },
        s3: { ...DEFAULT_S3, ...(parsed.s3 || {}) },
        smb: { ...DEFAULT_SMB, ...(parsed.smb || {}) },
        encryptionPassphrase: parsed.encryptionPassphrase ?? '',
        autoSyncOnStartup: parsed.autoSyncOnStartup ?? false,
        lastSyncTime: parsed.lastSyncTime ?? null,
        lastSyncStatus: parsed.lastSyncStatus ?? 'idle',
        lastSyncMessage: parsed.lastSyncMessage ?? null,
      };
    }
  } catch (e) {
    console.error('Failed to load sync store:', e);
  }

  return {
    enabled: false,
    provider: 'webdav' as SyncProviderType,
    webdav: DEFAULT_WEBDAV,
    s3: DEFAULT_S3,
    smb: DEFAULT_SMB,
    encryptionPassphrase: '',
    autoSyncOnStartup: false,
    lastSyncTime: null,
    lastSyncStatus: 'idle' as const,
    lastSyncMessage: null,
  };
}

function persistSyncState(state: Partial<SyncState>) {
  try {
    const payload = {
      enabled: state.enabled,
      provider: state.provider,
      webdav: state.webdav,
      s3: state.s3,
      smb: state.smb,
      encryptionPassphrase: state.encryptionPassphrase,
      autoSyncOnStartup: state.autoSyncOnStartup,
      lastSyncTime: state.lastSyncTime,
      lastSyncStatus: state.lastSyncStatus,
      lastSyncMessage: state.lastSyncMessage,
    };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error('Failed to persist sync state:', e);
  }
}

function getSyncDriver(
  state: SyncState,
  onWebDavUrlUpgraded?: (newUrl: string) => void
) {
  switch (state.provider) {
    case 'webdav':
      return new WebDavSyncDriver(state.webdav, { onUrlUpgraded: onWebDavUrlUpgraded });
    case 's3':
      return new S3SyncDriver(state.s3);
    case 'smb':
      return new SmbSyncDriver(state.smb);
  }
}

export const useSyncStore = create<SyncState>((set, get) => {
  const initial = loadInitialSyncState();

  return {
    ...initial,
    isSyncing: false,

    updateSyncConfig: (partial) => {
      set((state) => {
        const next = { ...state, ...partial };
        persistSyncState(next);
        return next;
      });
    },

    updateWebDavConfig: (partial) => {
      set((state) => {
        const next = { ...state, webdav: { ...state.webdav, ...partial } };
        persistSyncState(next);
        return next;
      });
    },

    updateS3Config: (partial) => {
      set((state) => {
        const next = { ...state, s3: { ...state.s3, ...partial } };
        persistSyncState(next);
        return next;
      });
    },

    updateSmbConfig: (partial) => {
      set((state) => {
        const next = { ...state, smb: { ...state.smb, ...partial } };
        persistSyncState(next);
        return next;
      });
    },

    testConnection: async () => {
      const state = get();
      const driver = getSyncDriver(state, (upgradedUrl) => {
        get().updateWebDavConfig({ url: upgradedUrl });
      });
      return await driver.testConnection();
    },

    syncNow: async (mode = 'smart_merge') => {
      const state = get();
      if (state.isSyncing) {
        return { success: false, message: '同步任务正在进行中，请勿重复操作' };
      }

      set({ isSyncing: true, lastSyncStatus: 'syncing' });
      const driver = getSyncDriver(state, (upgradedUrl) => {
        get().updateWebDavConfig({ url: upgradedUrl });
      });
      const passphrase = state.encryptionPassphrase?.trim() || undefined;

      try {
        if (mode === 'upload_only') {
          // 单向强制推送到远端
          const payload = await exportLocalConfig({ includeSecrets: true, passphrase });
          await driver.upload(JSON.stringify(payload, null, 2));

          const msg = '本地配置已成功上传并覆盖远端备份';
          const now = Date.now();
          set({
            isSyncing: false,
            lastSyncTime: now,
            lastSyncStatus: 'success',
            lastSyncMessage: msg,
          });
          persistSyncState({ ...get(), lastSyncTime: now, lastSyncStatus: 'success', lastSyncMessage: msg });
          return { success: true, message: msg };
        }

        if (mode === 'download_only') {
          // 单向强制从远端拉取覆盖本机
          const raw = await driver.download();
          const { data: remoteData } = await parseBackupPayload(raw, passphrase);
          const stats = applyConfigToStores(remoteData, 'replace');

          const msg = `已从远端拉取并全量还原配置 (${stats.serverCount} 个服务器, ${stats.danmuServerCount} 个弹幕节点, ${stats.bindingCount} 个弹幕绑定)`;
          const now = Date.now();
          set({
            isSyncing: false,
            lastSyncTime: now,
            lastSyncStatus: 'success',
            lastSyncMessage: msg,
          });
          persistSyncState({ ...get(), lastSyncTime: now, lastSyncStatus: 'success', lastSyncMessage: msg });
          return { success: true, message: msg };
        }

        // smart_merge (双向智能合并)
        let remoteRaw: string | null = null;
        try {
          remoteRaw = await driver.download();
        } catch (e: any) {
          // 如果远端文件不存在 (404)，则执行初次全量推送
          if (
            e?.message?.includes('不存在') ||
            e?.message?.includes('404') ||
            e?.message?.includes('NoSuchKey')
          ) {
            remoteRaw = null;
          } else {
            throw e;
          }
        }

        if (!remoteRaw) {
          // 远端文件尚未生成，初始化推送
          const payload = await exportLocalConfig({ includeSecrets: true, passphrase });
          await driver.upload(JSON.stringify(payload, null, 2));

          const msg = '远端尚无配置文件，已自动完成首次全量上传';
          const now = Date.now();
          set({
            isSyncing: false,
            lastSyncTime: now,
            lastSyncStatus: 'success',
            lastSyncMessage: msg,
          });
          persistSyncState({ ...get(), lastSyncTime: now, lastSyncStatus: 'success', lastSyncMessage: msg });
          return { success: true, message: msg };
        }

        // 远端存在配置文件，执行解析并智能合并
        const { data: remoteData } = await parseBackupPayload(remoteRaw, passphrase);
        const localData = getLocalConfigSnapshot({ includeSecrets: true });
        const mergedData = mergeConfigData(localData, remoteData);

        // 应用到本地 stores
        const stats = applyConfigToStores(mergedData, 'merge');

        // 回写更新远端
        const mergedPayload = await exportLocalConfig({ includeSecrets: true, passphrase });
        // 确保写回的是合并后的完整数据
        if (mergedPayload.encrypted) {
          // exportLocalConfig 会自动读取当前 store 数据 (刚才已 applyConfigToStores)，所以直接导出的就是 merged 数据
        } else {
          mergedPayload.data = mergedData;
        }

        await driver.upload(JSON.stringify(mergedPayload, null, 2));

        const msg = `智能同步完成：已合并双端配置 (${stats.serverCount} 个服务器, ${stats.danmuServerCount} 个弹幕节点, ${stats.bindingCount} 个弹幕绑定)`;
        const now = Date.now();
        set({
          isSyncing: false,
          lastSyncTime: now,
          lastSyncStatus: 'success',
          lastSyncMessage: msg,
        });
        persistSyncState({ ...get(), lastSyncTime: now, lastSyncStatus: 'success', lastSyncMessage: msg });
        return { success: true, message: msg };
      } catch (err: any) {
        const errorMsg = err?.message || '同步失败，请检查网络或配置信息';
        set({
          isSyncing: false,
          lastSyncStatus: 'error',
          lastSyncMessage: errorMsg,
        });
        persistSyncState({ ...get(), lastSyncStatus: 'error', lastSyncMessage: errorMsg });
        return { success: false, message: errorMsg };
      }
    },
  };
});
