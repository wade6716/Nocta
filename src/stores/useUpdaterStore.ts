import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { isTauriEnvironment, resolveEffectiveProxy } from '../api/http';

export type UpdateChannel = 'stable' | 'prerelease';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'installing'
  | 'ready_to_restart'
  | 'error';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  downloadUrl?: string;
  channel: UpdateChannel;
  usedProxy: boolean;
  target: string;
}

export interface UpdateProgress {
  stage: 'downloading' | 'installing' | 'ready';
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
  speedBps?: number;
}

interface RustUpdaterRuntimeInfo {
  version: string;
  target: string;
  isPrerelease: boolean;
  configured: boolean;
}

interface RustUpdateCheckResult {
  available: boolean;
  currentVersion: string;
  version?: string | null;
  date?: string | null;
  body?: string | null;
  downloadUrl?: string | null;
  channel: string;
  usedProxy: boolean;
  target: string;
}

interface RustUpdateProgressEvent {
  stage: 'downloading' | 'installing' | 'ready';
  downloadedBytes: number;
  totalBytes?: number | null;
  percent?: number | null;
  speedBps?: number | null;
}

interface RustInstallUpdateResult {
  installed: boolean;
  requiresRestart: boolean;
}

export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

export function isPrereleaseVersion(version: string): boolean {
  return /(alpha|beta|rc)/i.test(version);
}

const UPDATER_PREFS_KEY = 'nocta_updater_preferences_v1';

interface UpdaterPreferences {
  autoCheckOnStartup: boolean;
  channel: UpdateChannel;
  mirrorPrefix: string;
  ignoredVersion: string | null;
  lastCheckedAt: number | null;
}

function getDefaultPreferences(): UpdaterPreferences {
  return {
    autoCheckOnStartup: true,
    channel: isPrereleaseVersion(APP_VERSION) ? 'prerelease' : 'stable',
    mirrorPrefix: '',
    ignoredVersion: null,
    lastCheckedAt: null,
  };
}

function loadPreferences(): UpdaterPreferences {
  const defaults = getDefaultPreferences();
  try {
    const raw = localStorage.getItem(UPDATER_PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      autoCheckOnStartup:
        typeof parsed.autoCheckOnStartup === 'boolean'
          ? parsed.autoCheckOnStartup
          : defaults.autoCheckOnStartup,
      channel:
        parsed.channel === 'stable' || parsed.channel === 'prerelease'
          ? parsed.channel
          : defaults.channel,
      mirrorPrefix:
        typeof parsed.mirrorPrefix === 'string' ? parsed.mirrorPrefix : defaults.mirrorPrefix,
      ignoredVersion:
        typeof parsed.ignoredVersion === 'string' ? parsed.ignoredVersion : null,
      lastCheckedAt:
        typeof parsed.lastCheckedAt === 'number' && Number.isFinite(parsed.lastCheckedAt)
          ? parsed.lastCheckedAt
          : null,
    };
  } catch (e) {
    console.warn('[Nocta Updater] 读取更新偏好失败:', e);
    return defaults;
  }
}

function savePreferences(prefs: UpdaterPreferences) {
  try {
    localStorage.setItem(UPDATER_PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[Nocta Updater] 保存更新偏好失败:', e);
  }
}

export interface UpdaterState {
  // 持久化偏好
  autoCheckOnStartup: boolean;
  channel: UpdateChannel;
  mirrorPrefix: string;
  ignoredVersion: string | null;
  lastCheckedAt: number | null;

  // 运行时状态
  runtimeVersion: string;
  platformTarget: string;
  updaterConfigured: boolean;
  status: UpdaterStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  bannerDismissed: boolean;
  detailsModalOpen: boolean;

  // Actions
  initRuntimeInfo: () => Promise<void>;
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
  installUpdate: () => Promise<void>;
  relaunchToApply: () => Promise<void>;
  ignoreCurrentUpdate: () => void;
  clearIgnoredVersion: () => void;
  dismissBanner: () => void;
  setDetailsModalOpen: (open: boolean) => void;
  updatePreferences: (
    partial: Partial<
      Pick<
        UpdaterPreferences,
        'autoCheckOnStartup' | 'channel' | 'mirrorPrefix' | 'ignoredVersion' | 'lastCheckedAt'
      >
    >
  ) => void;
}

export function hasUnignoredUpdate(
  state: Pick<UpdaterState, 'status' | 'updateInfo' | 'ignoredVersion'>
): boolean {
  if (state.status === 'ready_to_restart') return true;
  if (state.status === 'available' && state.updateInfo) {
    return state.ignoredVersion !== state.updateInfo.version;
  }
  return false;
}

export function formatUpdateBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatUpdateSpeed(speedBps?: number): string {
  if (typeof speedBps !== 'number' || !Number.isFinite(speedBps) || speedBps <= 0) {
    return '';
  }
  return `${formatUpdateBytes(speedBps)}/s`;
}

const initialPrefs = loadPreferences();

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  autoCheckOnStartup: initialPrefs.autoCheckOnStartup,
  channel: initialPrefs.channel,
  mirrorPrefix: initialPrefs.mirrorPrefix,
  ignoredVersion: initialPrefs.ignoredVersion,
  lastCheckedAt: initialPrefs.lastCheckedAt,

  runtimeVersion: APP_VERSION,
  platformTarget: '',
  updaterConfigured: true,
  status: 'idle',
  updateInfo: null,
  progress: null,
  error: null,
  bannerDismissed: false,
  detailsModalOpen: false,

  initRuntimeInfo: async () => {
    if (!isTauriEnvironment()) return;
    try {
      const info = await invoke<RustUpdaterRuntimeInfo>('get_updater_runtime_info');
      set({
        runtimeVersion: info.version || APP_VERSION,
        platformTarget: info.target || '',
        updaterConfigured: info.configured,
      });
    } catch (e) {
      console.warn('[Nocta Updater] 获取运行时版本信息失败:', e);
    }
  },

  checkForUpdates: async (options) => {
    const silent = options?.silent ?? false;

    if (!isTauriEnvironment()) {
      if (!silent) {
        set({
          status: 'error',
          error: '仅支持在 Nocta 桌面端应用中检查与安装更新',
        });
      }
      return;
    }

    const currentStatus = get().status;
    if (
      currentStatus === 'checking' ||
      currentStatus === 'downloading' ||
      currentStatus === 'installing'
    ) {
      return;
    }

    if (!silent) {
      set({ status: 'checking', error: null });
    }

    try {
      const proxyUrl = await resolveEffectiveProxy();
      const { channel, mirrorPrefix, ignoredVersion } = get();

      const res = await invoke<RustUpdateCheckResult>('check_app_update', {
        options: {
          channel,
          proxyUrl: proxyUrl || null,
          mirrorPrefix: mirrorPrefix.trim() || null,
        },
      });

      const checkedAt = Date.now();
      const nextPrefs: UpdaterPreferences = {
        autoCheckOnStartup: get().autoCheckOnStartup,
        channel: get().channel,
        mirrorPrefix: get().mirrorPrefix,
        ignoredVersion: get().ignoredVersion,
        lastCheckedAt: checkedAt,
      };
      savePreferences(nextPrefs);

      if (res.available && res.version) {
        const updateInfo: UpdateInfo = {
          version: res.version,
          currentVersion: res.currentVersion || get().runtimeVersion,
          date: res.date || undefined,
          body: res.body || undefined,
          downloadUrl: res.downloadUrl || undefined,
          channel: res.channel === 'prerelease' ? 'prerelease' : 'stable',
          usedProxy: res.usedProxy,
          target: res.target || get().platformTarget,
        };

        const isIgnoredOnSilent = silent && ignoredVersion === res.version;

        set({
          lastCheckedAt: checkedAt,
          runtimeVersion: updateInfo.currentVersion,
          platformTarget: updateInfo.target,
          status: 'available',
          updateInfo,
          progress: null,
          error: null,
          bannerDismissed: isIgnoredOnSilent,
        });
      } else {
        set({
          lastCheckedAt: checkedAt,
          runtimeVersion: res.currentVersion || get().runtimeVersion,
          platformTarget: res.target || get().platformTarget,
          updateInfo: null,
          progress: null,
          error: null,
          status: silent ? 'idle' : 'up_to_date',
        });
      }
    } catch (err: any) {
      const msg = err?.message || (typeof err === 'string' ? err : '检查更新失败，请检查网络连接');
      if (silent) {
        console.warn('[Nocta Updater] 启动静默检查未完成:', msg);
        if (get().status === 'checking') {
          set({ status: 'idle' });
        }
      } else {
        set({
          status: 'error',
          error: msg,
        });
      }
    }
  },

  installUpdate: async () => {
    if (!isTauriEnvironment()) return;
    const currentStatus = get().status;
    if (currentStatus === 'downloading' || currentStatus === 'installing') {
      return;
    }

    let unlisten: UnlistenFn | null = null;
    try {
      // 若此前安装曾失败（Rust 状态已被消费），自动重新探测一次刷新待安装会话
      if (currentStatus === 'error' || !get().updateInfo) {
        const proxyUrl = await resolveEffectiveProxy();
        const { channel, mirrorPrefix } = get();
        const recheck = await invoke<RustUpdateCheckResult>('check_app_update', {
          options: {
            channel,
            proxyUrl: proxyUrl || null,
            mirrorPrefix: mirrorPrefix.trim() || null,
          },
        });
        if (!recheck.available || !recheck.version) {
          set({
            status: 'up_to_date',
            updateInfo: null,
            error: null,
            progress: null,
          });
          return;
        }
      }

      unlisten = await listen<RustUpdateProgressEvent>('updater://progress', (event) => {
        const p = event.payload;
        if (!p) return;
        set({
          status:
            p.stage === 'installing'
              ? 'installing'
              : p.stage === 'ready'
              ? get().status
              : 'downloading',
          progress: {
            stage: p.stage,
            downloadedBytes: p.downloadedBytes,
            totalBytes: p.totalBytes ?? undefined,
            percent: p.percent ?? undefined,
            speedBps: p.speedBps ?? undefined,
          },
        });
      });

      set({
        status: 'downloading',
        error: null,
        bannerDismissed: false,
        progress: {
          stage: 'downloading',
          downloadedBytes: 0,
          percent: 0,
        },
      });

      const res = await invoke<RustInstallUpdateResult>('download_and_install_update');
      set({
        status: res.requiresRestart ? 'ready_to_restart' : 'idle',
        progress: {
          stage: 'ready',
          downloadedBytes: get().progress?.downloadedBytes || 0,
          totalBytes: get().progress?.totalBytes,
          percent: 100,
        },
        error: null,
      });
    } catch (err: any) {
      const msg = err?.message || (typeof err === 'string' ? err : '下载或安装更新失败');
      set({
        status: 'error',
        error: msg,
      });
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  },

  relaunchToApply: async () => {
    if (!isTauriEnvironment()) return;
    try {
      await invoke('relaunch_app');
    } catch (err: any) {
      const msg = err?.message || (typeof err === 'string' ? err : '重启应用失败');
      set({ status: 'error', error: msg });
    }
  },

  ignoreCurrentUpdate: () => {
    const info = get().updateInfo;
    if (!info?.version) return;
    get().updatePreferences({ ignoredVersion: info.version });
    set({ bannerDismissed: true, detailsModalOpen: false });
  },

  clearIgnoredVersion: () => {
    get().updatePreferences({ ignoredVersion: null });
    if (get().updateInfo) {
      set({ bannerDismissed: false });
    }
  },

  dismissBanner: () => {
    set({ bannerDismissed: true });
  },

  setDetailsModalOpen: (open: boolean) => {
    set({ detailsModalOpen: open });
  },

  updatePreferences: (partial) => {
    set((state) => {
      const nextPrefs: UpdaterPreferences = {
        autoCheckOnStartup:
          partial.autoCheckOnStartup ?? state.autoCheckOnStartup,
        channel: partial.channel ?? state.channel,
        mirrorPrefix: partial.mirrorPrefix ?? state.mirrorPrefix,
        ignoredVersion:
          partial.ignoredVersion !== undefined
            ? partial.ignoredVersion
            : state.ignoredVersion,
        lastCheckedAt:
          partial.lastCheckedAt !== undefined ? partial.lastCheckedAt : state.lastCheckedAt,
      };
      savePreferences(nextPrefs);
      return nextPrefs;
    });
  },
}));
