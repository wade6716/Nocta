import { create } from 'zustand';
import { DanmuConfig } from '../api/danmuClient';
import { ProxyConfig, httpClient } from '../api/http';

export interface SavedServer {
  id: string;
  name: string;
  url: string;
  userId: string;
  username: string;
  accessToken: string;
  /** 明文记住的登录密码（仅保存在本机 localStorage，用于查看与自动重新登录） */
  password?: string;
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

export const useAuthStore = create<AuthState>((set, get) => {
  const initialServers = loadInitialServers();
  const initialDanmu = loadInitialDanmu();
  const initialGlobalProxy = loadInitialGlobalProxy();
  const defaultCurrentId = loadInitialCurrentServerId(initialServers);

  return {
    servers: initialServers,
    currentServerId: defaultCurrentId,
    danmuConfig: initialDanmu,
    globalProxyConfig: initialGlobalProxy,

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
    },

    /**
     * 就地更新已保存服务器的信息（名称 / 地址 / 账号 / 令牌 / 代理等）。
     * 不改变当前选中的服务器，也不刷新 lastActive 排序，仅用于"编辑服务器信息"场景。
     */
    updateServer: (id, updates) => {
      set((state) => {
        if (!state.servers.some((s) => s.id === id)) return state;

        const newServers = state.servers.map((s) => (s.id === id ? { ...s, ...updates } : s));

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
        } catch (e) {
          console.error(e);
        }

        return { servers: newServers };
      });
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
    },

    setCurrentServer: (id: string) => {
      set((state) => {
        const found = state.servers.find((s) => s.id === id);
        if (found) {
          found.lastActive = Date.now();
          state.servers.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.servers));
          } catch (e) {
            console.error(e);
          }
        }
        try {
          localStorage.setItem(CURRENT_SERVER_KEY, id);
        } catch (e) {
          console.error(e);
        }
        return { currentServerId: id };
      });
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
    },

    getCurrentServer: () => {
      const { servers, currentServerId } = get();
      if (!currentServerId) return servers[0] || null;
      return servers.find((s) => s.id === currentServerId) || null;
    },

    testProxyConnection: async (proxy, targetUrl) => {
      const startTime = performance.now();
      try {
        const cleanUrl = targetUrl.replace(/\/+$/, '');
        const testEndpoint = `${cleanUrl}/emby/System/Info/Public`;
        const res = await httpClient(testEndpoint, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          proxy,
        });
        const latency = Math.round(performance.now() - startTime);
        if (res.ok) {
          return { ok: true, latency };
        } else {
          return { ok: false, latency, error: `HTTP ${res.status} ${res.statusText}` };
        }
      } catch (err: any) {
        return { ok: false, error: err.message || '连接失败' };
      }
    },
  };
});
