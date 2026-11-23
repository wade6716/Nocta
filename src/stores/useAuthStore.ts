import { create } from 'zustand';
import { DanmuConfig } from '../api/danmuClient';
import {
  DEFAULT_EMBY_USER_AGENT,
  bumpImageProxyRevision,
  normalizeServerUrl,
  registerEmbyUserAgentGetter,
} from '../api/embyClient';
import {
  ProxyConfig,
  RuntimeServerProxyEntry,
  fetchSystemProxy,
  formatProxyUrl,
  httpClient,
  registerProxyGetter,
  syncRuntimeProxyToRust,
} from '../api/http';

export interface SavedServer {
  id: string;
  name: string;
  url: string;
  userId: string;
  username: string;
  accessToken: string;
  /** 明文记住的登录密码（仅保存在本机 localStorage，用于查看与自动重新登录） */
  password?: string;
  /** 自定义 User-Agent（可选，留空使用默认浏览器 UA） */
  userAgent?: string;
  /** 服务器代理配置（若未设置则跟随全局代理） */
  proxyConfig?: ProxyConfig;
  /** 最近一次连接测试是否通过；undefined 表示尚未验证过 */
  lastTestOk?: boolean;
  /** 最近一次连接测试的失败原因 */
  lastTestError?: string;
  /** 最近一次连接测试的时间戳（ms） */
  lastTestAt?: number;
  lastActive: number;
}

interface AuthState {
  servers: SavedServer[];
  currentServerId: string | null;
  danmuConfig: DanmuConfig;
  globalProxyConfig: ProxyConfig;
  imageProxyRevision: number;

  // Actions
  addOrUpdateServer: (
    server: Omit<SavedServer, 'lastActive'>,
    options?: { makeCurrent?: boolean }
  ) => void;
  updateServer: (id: string, updates: Partial<Omit<SavedServer, 'id' | 'lastActive'>>) => void;
  removeServer: (id: string) => void;
  setCurrentServer: (id: string) => void;
  updateDanmuConfig: (config: Partial<DanmuConfig>) => void;
  updateGlobalProxyConfig: (config: ProxyConfig) => void;
  getCurrentServer: () => SavedServer | null;
  testProxyConnection: (
    proxy: ProxyConfig,
    targetUrl: string
  ) => Promise<{ ok: boolean; latency?: number; error?: string }>;
  importServers: (servers: SavedServer[], mode?: 'merge' | 'replace') => void;
}

const STORAGE_KEY = 'emby_auth_store';
const CURRENT_SERVER_KEY = 'emby_current_server_id';
const DANMU_STORAGE_KEY = 'emby_danmu_config';
const GLOBAL_PROXY_KEY = 'nocta_global_proxy';

function loadInitialServers(): SavedServer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: SavedServer[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  } catch {
    return [];
  }
}

function loadInitialCurrentServerId(servers: SavedServer[]): string | null {
  try {
    const savedId = localStorage.getItem(CURRENT_SERVER_KEY);
    if (savedId && servers.some((s) => s.id === savedId)) {
      return savedId;
    }
  } catch {}
  return servers.length > 0 ? servers[0].id : null;
}

function loadInitialDanmu(): DanmuConfig {
  try {
    const raw = localStorage.getItem(DANMU_STORAGE_KEY);
    return raw
      ? JSON.parse(raw)
      : {
          baseUrl: 'http://127.0.0.1:9321/87654321',
          preferredPlatform: '',
        };
  } catch {
    return {
      baseUrl: 'http://127.0.0.1:9321/87654321',
      preferredPlatform: '',
    };
  }
}

function loadInitialGlobalProxy(): ProxyConfig {
  try {
    const raw = localStorage.getItem(GLOBAL_PROXY_KEY);
    return raw ? JSON.parse(raw) : { type: 'system' };
  } catch {
    return { type: 'system' };
  }
}

function buildAndSyncRuntimeProxy(
  globalProxyConfig: ProxyConfig,
  servers: SavedServer[]
) {
  const serverUserAgents: Record<string, string> = {};
  const serverProxies: Record<string, RuntimeServerProxyEntry> = {};

  for (const s of servers) {
    const key = normalizeServerUrl(s.url);
    if (!key) continue;
    const ua = s.userAgent?.trim();
    if (ua) serverUserAgents[key] = ua;
    if (s.proxyConfig) {
      serverProxies[key] = {
        mode: s.proxyConfig.type || 'system',
        manualUrl: formatProxyUrl(s.proxyConfig),
      };
    }
  }

  void syncRuntimeProxyToRust({
    mode: globalProxyConfig.type || 'system',
    manualUrl: formatProxyUrl(globalProxyConfig),
    defaultUserAgent: DEFAULT_EMBY_USER_AGENT,
    serverUserAgents,
    serverProxies,
  });
}

export const useAuthStore = create<AuthState>((set, get) => {
  const initialServers = loadInitialServers();
  const initialDanmu = loadInitialDanmu();
  const initialGlobalProxy = loadInitialGlobalProxy();
  const defaultCurrentId = loadInitialCurrentServerId(initialServers);

  const syncWithOptionalRevision = (bumpImage: boolean) => {
    const state = get();
    buildAndSyncRuntimeProxy(state.globalProxyConfig, state.servers);
    if (bumpImage) {
      const nextRev = bumpImageProxyRevision();
      set({ imageProxyRevision: nextRev });
      if ((state.globalProxyConfig.type || 'system') === 'system') {
        void fetchSystemProxy(true);
      }
    }
  };

  return {
    servers: initialServers,
    currentServerId: defaultCurrentId,
    danmuConfig: initialDanmu,
    globalProxyConfig: initialGlobalProxy,
    imageProxyRevision: 1,

    addOrUpdateServer: (serverData, options) => {
      set((state) => {
        const existingIdx = state.servers.findIndex((s) => s.id === serverData.id);
        const updatedServer: SavedServer = {
          ...serverData,
          lastActive: Date.now(),
        };

        let newServers: SavedServer[];
        if (existingIdx >= 0) {
          newServers = [...state.servers];
          newServers[existingIdx] = updatedServer;
        } else {
          newServers = [updatedServer, ...state.servers];
        }

        // Sort by lastActive descending
        newServers.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));

        // 未验证的服务器（例如离线时保存）不抢占当前选中项，避免首页加载出空媒体库
        const nextCurrentId =
          options?.makeCurrent === false
            ? state.currentServerId || updatedServer.id
            : updatedServer.id;

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
          if (nextCurrentId) {
            localStorage.setItem(CURRENT_SERVER_KEY, nextCurrentId);
          }
        } catch (e) {
          console.error(e);
        }

        return {
          servers: newServers,
          currentServerId: nextCurrentId,
        };
      });
      syncWithOptionalRevision(true);
    },

    /**
     * 就地更新已保存服务器的信息（名称 / 地址 / 账号 / 令牌 / 代理等）。
     * 不改变当前选中的服务器，也不刷新 lastActive 排序，仅用于"编辑服务器信息"场景。
     */
    updateServer: (id, updates) => {
      let changed = false;
      set((state) => {
        if (!state.servers.some((s) => s.id === id)) return state;
        changed = true;
        const newServers = state.servers.map((s) => (s.id === id ? { ...s, ...updates } : s));

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
        } catch (e) {
          console.error(e);
        }

        return { servers: newServers };
      });
      if (changed) {
        syncWithOptionalRevision(true);
      }
    },

    removeServer: (id: string) => {
      set((state) => {
        const newServers = state.servers.filter((s) => s.id !== id);
        const nextId =
          state.currentServerId === id
            ? newServers.length > 0
              ? newServers[0].id
              : null
            : state.currentServerId;

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
          if (nextId) {
            localStorage.setItem(CURRENT_SERVER_KEY, nextId);
          } else {
            localStorage.removeItem(CURRENT_SERVER_KEY);
          }
        } catch (e) {
          console.error(e);
        }

        return {
          servers: newServers,
          currentServerId: nextId,
        };
      });
      syncWithOptionalRevision(true);
    },

    setCurrentServer: (id: string) => {
      set((state) => {
        const now = Date.now();
        const newServers = state.servers
          .map((s) => (s.id === id ? { ...s, lastActive: now } : s))
          .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
          localStorage.setItem(CURRENT_SERVER_KEY, id);
        } catch (e) {
          console.error(e);
        }
        return {
          servers: newServers,
          currentServerId: id,
        };
      });
      syncWithOptionalRevision(false);
    },

    updateDanmuConfig: (config) => {
      set((state) => {
        const newCfg = { ...state.danmuConfig, ...config };
        try {
          localStorage.setItem(DANMU_STORAGE_KEY, JSON.stringify(newCfg));
        } catch (e) {
          console.error(e);
        }
        return { danmuConfig: newCfg };
      });
    },

    updateGlobalProxyConfig: (config) => {
      set({ globalProxyConfig: config });
      try {
        localStorage.setItem(GLOBAL_PROXY_KEY, JSON.stringify(config));
      } catch (e) {
        console.error(e);
      }
      syncWithOptionalRevision(true);
    },

    getCurrentServer: () => {
      const { servers, currentServerId } = get();
      if (!currentServerId) return servers[0] || null;
      return servers.find((s) => s.id === currentServerId) || null;
    },

    testProxyConnection: async (proxy, targetUrl) => {
      const startTime = performance.now();
      try {
        let cleanUrl = targetUrl.trim();
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
          cleanUrl = `https://${cleanUrl}`;
        }
        cleanUrl = cleanUrl.replace(/\/+$/, '');

        // 如果是 Emby 服务器根地址，自动测试 /emby/System/Info/Public
        let testEndpoint = cleanUrl;
        if (!cleanUrl.includes('google.com') && !cleanUrl.includes('/generate_204') && !cleanUrl.includes('/emby/')) {
          testEndpoint = `${cleanUrl}/emby/System/Info/Public`;
        }

        const res = await httpClient(testEndpoint, {
          method: 'GET',
          headers: { Accept: '*/*' },
          proxy,
          bypassLan: false,
        });
        const latency = Math.round(performance.now() - startTime);
        if (res.ok || res.status === 204 || (res.status >= 200 && res.status < 400)) {
          return { ok: true, latency };
        } else {
          return { ok: false, latency, error: `HTTP ${res.status} ${res.statusText}` };
        }
      } catch (err: any) {
        return { ok: false, error: err.message || '连接失败' };
      }
    },

    importServers: (importedServers, mode = 'merge') => {
      set((state) => {
        let newServers: SavedServer[];
        if (mode === 'replace') {
          newServers = [...importedServers];
        } else {
          const map = new Map<string, SavedServer>();
          state.servers.forEach((s) => {
            const key = `${s.url.trim().toLowerCase()}___${s.username.trim().toLowerCase()}`;
            map.set(key, s);
          });

          importedServers.forEach((imp) => {
            const key = `${imp.url.trim().toLowerCase()}___${imp.username.trim().toLowerCase()}`;
            const existing = map.get(key);
            if (existing) {
              map.set(key, {
                ...existing,
                ...imp,
                // 保留已有密码与令牌（若导入的数据处于脱敏状态）
                password: imp.password || existing.password,
                accessToken: imp.accessToken || existing.accessToken,
                userAgent: imp.userAgent !== undefined ? imp.userAgent : existing.userAgent,
                lastActive: Math.max(existing.lastActive || 0, imp.lastActive || 0),
              });
            } else {
              map.set(key, imp);
            }
          });

          newServers = Array.from(map.values());
        }

        newServers.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));

        let nextCurrentId = state.currentServerId;
        if (!nextCurrentId || !newServers.some((s) => s.id === nextCurrentId)) {
          nextCurrentId = newServers[0]?.id || null;
        }

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
          if (nextCurrentId) {
            localStorage.setItem(CURRENT_SERVER_KEY, nextCurrentId);
          }
        } catch (e) {
          console.error(e);
        }

        return {
          servers: newServers,
          currentServerId: nextCurrentId,
        };
      });
      syncWithOptionalRevision(true);
    },
  };
});

// 初始化后立即把当前全局代理与各服务器 UA 同步到 Rust（供 nocta-img 图片协议直接使用）
{
  const initialState = useAuthStore.getState();
  buildAndSyncRuntimeProxy(initialState.globalProxyConfig, initialState.servers);
}

// 全局注册活动代理配置解析器，供 httpClient 和视频播放引擎自动提取
registerProxyGetter(() => {
  const state = useAuthStore.getState();
  const current = state.getCurrentServer();
  return current?.proxyConfig || state.globalProxyConfig;
});

// 全局注册自定义 User-Agent 解析器，按服务器 URL 精确匹配对应配置
registerEmbyUserAgentGetter((serverUrl?: string) => {
  const state = useAuthStore.getState();
  if (serverUrl) {
    const targetUrl = normalizeServerUrl(serverUrl).toLowerCase();
    const matched = state.servers.find(
      (s) => normalizeServerUrl(s.url).toLowerCase() === targetUrl
    );
    if (matched) {
      return matched.userAgent?.trim() || undefined;
    }
  }
  return state.getCurrentServer()?.userAgent?.trim() || undefined;
});
