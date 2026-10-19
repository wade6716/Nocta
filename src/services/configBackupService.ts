// src/services/configBackupService.ts

import { useAuthStore, SavedServer } from '../stores/useAuthStore';
import { useDanmuStore, DanmuServerEntry } from '../stores/useDanmuStore';
import {
  usePlayerStore,
  DanmakuSettings,
  DanmakuBinding,
  VideoLayoutConfig,
} from '../stores/usePlayerStore';
import { useMediaStore } from '../stores/useMediaStore';
import { ProxyConfig, isTauriEnvironment } from '../api/http';
import { invoke } from '@tauri-apps/api/core';
import { encryptData, decryptData } from '../utils/crypto';

export interface NoctaConfigData {
  servers: SavedServer[];
  currentServerId: string | null;
  danmuServers: DanmuServerEntry[];
  activeDanmuServerId: string;
  danmakuSettings: DanmakuSettings;
  globalProxyConfig: ProxyConfig;
  engineType: 'mpv' | 'html5';
  videoLayouts: Record<string, VideoLayoutConfig>;
  itemOffsets: Record<string, number>;
  danmakuBindings: Record<string, DanmakuBinding>;
}

export interface NoctaBackupPayload {
  version: 1;
  exportedAt: number;
  clientVersion: string;
  deviceId: string;
  encrypted?: boolean;
  iv?: string;
  salt?: string;
  ciphertext?: string;
  data?: NoctaConfigData;
}

export interface ConfigStats {
  serverCount: number;
  danmuServerCount: number;
  bindingCount: number;
  layoutCount: number;
  blockedWordCount: number;
}

const CLIENT_VERSION = '0.1.0-alpha.4';

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem('nocta_device_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('nocta_device_id', id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

/**
 * 获取当前本机的完整配置数据快照
 */
export function getLocalConfigSnapshot(options?: { includeSecrets?: boolean }): NoctaConfigData {
  const authState = useAuthStore.getState();
  const danmuState = useDanmuStore.getState();
  const playerState = usePlayerStore.getState();

  const includeSecrets = options?.includeSecrets ?? true;

  // 处理服务器脱敏
  const servers = authState.servers.map((s) => {
    if (includeSecrets) return { ...s };
    return {
      ...s,
      password: '',
      accessToken: '',
    };
  });

  // 处理弹幕节点脱敏 (按规则 Token 在 baseUrl 路径中，若脱敏可选择保留或清空)
  const danmuServers = danmuState.servers.map((s) => ({ ...s }));

  return {
    servers,
    currentServerId: authState.currentServerId,
    danmuServers,
    activeDanmuServerId: danmuState.activeServerId,
    danmakuSettings: { ...playerState.danmakuSettings },
    globalProxyConfig: { ...authState.globalProxyConfig },
    engineType: playerState.engineType,
    videoLayouts: { ...playerState.videoLayouts },
    itemOffsets: { ...playerState.itemOffsets },
    danmakuBindings: { ...playerState.danmakuBindings },
  };
}

/**
 * 导出配置为 NoctaBackupPayload（支持可选加密与脱敏）
 */
export async function exportLocalConfig(options?: {
  includeSecrets?: boolean;
  passphrase?: string;
}): Promise<NoctaBackupPayload> {
  const snapshot = getLocalConfigSnapshot({ includeSecrets: options?.includeSecrets ?? true });
  const deviceId = getOrCreateDeviceId();
  const exportedAt = Date.now();

  if (options?.passphrase && options.passphrase.trim()) {
    const jsonStr = JSON.stringify(snapshot);
    const enc = await encryptData(jsonStr, options.passphrase.trim());

    return {
      version: 1,
      exportedAt,
      clientVersion: CLIENT_VERSION,
      deviceId,
      encrypted: true,
      iv: enc.iv,
      salt: enc.salt,
      ciphertext: enc.ciphertext,
    };
  }

  return {
    version: 1,
    exportedAt,
    clientVersion: CLIENT_VERSION,
    deviceId,
    encrypted: false,
    data: snapshot,
  };
}

/**
 * 解析并解密备份数据对象或字符串
 */
export async function parseBackupPayload(
  rawInput: string | NoctaBackupPayload,
  passphrase?: string
): Promise<{ payload: NoctaBackupPayload; data: NoctaConfigData }> {
  let parsed: NoctaBackupPayload;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      throw new Error('无效的 JSON 配置文件格式');
    }
  } else {
    parsed = rawInput;
  }

  if (!parsed || parsed.version !== 1) {
    throw new Error('不支持的配置文件版本或未知文件格式');
  }

  if (parsed.encrypted) {
    if (!passphrase || !passphrase.trim()) {
      throw new Error('该配置文件已加密，请输入解密密码');
    }
    if (!parsed.ciphertext || !parsed.iv || !parsed.salt) {
      throw new Error('加密配置文件格式损坏');
    }

    const decryptedJson = await decryptData(
      parsed.ciphertext,
      parsed.iv,
      parsed.salt,
      passphrase.trim()
    );

    const decryptedData: NoctaConfigData = JSON.parse(decryptedJson);
    return { payload: parsed, data: decryptedData };
  }

  if (!parsed.data) {
    throw new Error('配置文件中缺少有效配置数据项');
  }

  return { payload: parsed, data: parsed.data };
}

/**
 * 智能双向合并两套配置数据 (Smart Bidirectional Merge)
 */
export function mergeConfigData(local: NoctaConfigData, remote: NoctaConfigData): NoctaConfigData {
  // 1. Emby 服务器合并 (按 URL + 账号去重，保留最新更新及有效密码)
  const serverMap = new Map<string, SavedServer>();
  local.servers.forEach((s) => {
    const key = `${s.url.trim().toLowerCase()}___${s.username.trim().toLowerCase()}`;
    serverMap.set(key, s);
  });
  remote.servers.forEach((r) => {
    const key = `${r.url.trim().toLowerCase()}___${r.username.trim().toLowerCase()}`;
    const existing = serverMap.get(key);
    if (existing) {
      serverMap.set(key, {
        ...existing,
        ...r,
        password: r.password || existing.password,
        accessToken: r.accessToken || existing.accessToken,
        lastActive: Math.max(existing.lastActive || 0, r.lastActive || 0),
      });
    } else {
      serverMap.set(key, r);
    }
  });
  const mergedServers = Array.from(serverMap.values()).sort(
    (a, b) => (b.lastActive || 0) - (a.lastActive || 0)
  );

  // 2. 弹幕 API 节点合并 (按 baseUrl 路径去重)
  const danmuMap = new Map<string, DanmuServerEntry>();
  local.danmuServers.forEach((s) => danmuMap.set(s.baseUrl.trim().toLowerCase(), s));
  remote.danmuServers.forEach((r) => {
    const key = r.baseUrl.trim().toLowerCase();
    if (danmuMap.has(key)) {
      const existing = danmuMap.get(key)!;
      danmuMap.set(key, { ...existing, ...r });
    } else {
      danmuMap.set(key, r);
    }
  });
  const mergedDanmuServers = Array.from(danmuMap.values());

  // 3. 弹幕绑定记录合并 (按 itemId 合并，以最新 boundAt 时间戳为准)
  const mergedBindings: Record<string, DanmakuBinding> = { ...local.danmakuBindings };
  Object.entries(remote.danmakuBindings || {}).forEach(([itemId, binding]) => {
    const existing = mergedBindings[itemId];
    if (!existing || (binding.boundAt || 0) >= (existing.boundAt || 0)) {
      mergedBindings[itemId] = binding;
    }
  });

  // 4. 视频时间偏移合并
  const mergedOffsets = { ...local.itemOffsets, ...(remote.itemOffsets || {}) };

  // 5. 画面排版偏好合并
  const mergedLayouts = { ...local.videoLayouts, ...(remote.videoLayouts || {}) };

  // 6. 弹幕偏好与屏蔽词合并 (屏蔽词去重合并)
  const mergedBlockedWords = Array.from(
    new Set([
      ...(local.danmakuSettings.blockedWords || []),
      ...(remote.danmakuSettings.blockedWords || []),
    ])
  );

  const mergedDanmakuSettings: DanmakuSettings = {
    ...local.danmakuSettings,
    ...remote.danmakuSettings,
    blockedWords: mergedBlockedWords,
  };

  return {
    servers: mergedServers,
    currentServerId: local.currentServerId || remote.currentServerId,
    danmuServers: mergedDanmuServers,
    activeDanmuServerId: local.activeDanmuServerId || remote.activeDanmuServerId,
    danmakuSettings: mergedDanmakuSettings,
    globalProxyConfig: local.globalProxyConfig || remote.globalProxyConfig,
    engineType: local.engineType || remote.engineType,
    videoLayouts: mergedLayouts,
    itemOffsets: mergedOffsets,
    danmakuBindings: mergedBindings,
  };
}

/**
 * 将配置数据应用恢复到本地 Stores
 */
export function applyConfigToStores(data: NoctaConfigData, mode: 'merge' | 'replace'): ConfigStats {
  const authStore = useAuthStore.getState();
  const danmuStore = useDanmuStore.getState();
  const playerStore = usePlayerStore.getState();

  // 1. 恢复 Emby 服务器
  if (data.servers && data.servers.length > 0) {
    authStore.importServers(data.servers, mode);
  }

  // 2. 恢复代理
  if (data.globalProxyConfig) {
    authStore.updateGlobalProxyConfig(data.globalProxyConfig);
  }

  // 3. 恢复弹幕节点
  if (data.danmuServers && data.danmuServers.length > 0) {
    danmuStore.importServers(data.danmuServers, data.activeDanmuServerId, mode);
  }

  // 4. 恢复播放器偏好、绑定与布局
  playerStore.importPlayerConfigs(
    {
      danmakuSettings: data.danmakuSettings,
      itemOffsets: data.itemOffsets,
      danmakuBindings: data.danmakuBindings,
      videoLayouts: data.videoLayouts,
      engineType: data.engineType,
    },
    mode
  );

  // 清除媒体库缓存以触发当前服务器更新
  useMediaStore.getState().clearMediaCache();

  return {
    serverCount: data.servers?.length || 0,
    danmuServerCount: data.danmuServers?.length || 0,
    bindingCount: Object.keys(data.danmakuBindings || {}).length,
    layoutCount: Object.keys(data.videoLayouts || {}).length,
    blockedWordCount: data.danmakuSettings?.blockedWords?.length || 0,
  };
}

export interface BackupFileDownloadResult {
  success: boolean;
  filePath?: string;
  fileName: string;
  directory?: string;
  openedFolder: boolean;
}

/**
 * 触发备份文件保存：
 * - 在桌面端（Tauri 环境）：直接保存至系统下载目录（Downloads），并自动在文件管理器/访达中高亮选中定位；
 * - 在浏览器环境：降级触发标准 Blob 文件下载。
 */
export async function downloadBackupFile(
  payload: NoctaBackupPayload,
  filename?: string
): Promise<BackupFileDownloadResult> {
  const jsonStr = JSON.stringify(payload, null, 2);
  const defaultName = filename || `nocta-backup-${new Date().toISOString().slice(0, 10)}.json`;

  if (isTauriEnvironment()) {
    try {
      const res = await invoke<{
        success: boolean;
        file_path: string;
        file_name: string;
        directory: string;
      }>('save_backup_file', {
        content: jsonStr,
        filename: defaultName,
        reveal: true,
      });

      return {
        success: true,
        filePath: res.file_path,
        fileName: res.file_name,
        directory: res.directory,
        openedFolder: true,
      };
    } catch (err) {
      console.warn('[downloadBackupFile] Tauri native save failed, falling back to blob:', err);
    }
  }

  // 纯浏览器环境或 Tauri 异常降级 fallback
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return {
    success: true,
    fileName: defaultName,
    openedFolder: false,
  };
}

/**
 * 在系统文件管理器或访达中高亮显示文件
 */
export async function revealBackupInFileManager(filePath: string): Promise<void> {
  if (isTauriEnvironment() && filePath) {
    try {
      await invoke('show_in_file_manager', { path: filePath });
    } catch (err) {
      console.warn('[revealBackupInFileManager] failed:', err);
    }
  }
}

/**
 * 复制 JSON 到系统剪贴板
 */
export async function copyBackupToClipboard(payload: NoctaBackupPayload): Promise<void> {
  const jsonStr = JSON.stringify(payload, null, 2);
  await navigator.clipboard.writeText(jsonStr);
}
