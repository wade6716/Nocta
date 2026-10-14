import { create } from 'zustand';
import { DanmuConfig } from '../api/danmuClient';

export interface SavedServer {
  id: string;
  name: string;
  url: string;
  userId: string;
  username: string;
  accessToken: string;
  /** 明文记住的登录密码（仅保存在本机 localStorage，用于查看与自动重新登录） */
  password?: string;
  lastActive: number;
}

interface AuthState {
  servers: SavedServer[];
  currentServerId: string | null;
  danmuConfig: DanmuConfig;

  // Actions
  addOrUpdateServer: (server: Omit<SavedServer, 'lastActive'>) => void;
  updateServer: (id: string, updates: Partial<Omit<SavedServer, 'id' | 'lastActive'>>) => void;
  removeServer: (id: string) => void;
  setCurrentServer: (id: string) => void;
  updateDanmuConfig: (config: Partial<DanmuConfig>) => void;
  getCurrentServer: () => SavedServer | null;
}

const STORAGE_KEY = 'emby_auth_store';
const CURRENT_SERVER_KEY = 'emby_current_server_id';
const DANMU_STORAGE_KEY = 'emby_danmu_config';

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

export const useAuthStore = create<AuthState>((set, get) => {
  const initialServers = loadInitialServers();
  const initialDanmu = loadInitialDanmu();
  const defaultCurrentId = loadInitialCurrentServerId(initialServers);

  return {
    servers: initialServers,
    currentServerId: defaultCurrentId,
    danmuConfig: initialDanmu,

    addOrUpdateServer: (serverData) => {
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

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
          localStorage.setItem(CURRENT_SERVER_KEY, updatedServer.id);
        } catch (e) {
          console.error(e);
        }

        return {
          servers: newServers,
          currentServerId: updatedServer.id,
        };
      });
    },

    /**
     * 就地更新已保存服务器的信息（名称 / 地址 / 账号 / 令牌等）。
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

    getCurrentServer: () => {
      const { servers, currentServerId } = get();
      if (!currentServerId) return servers[0] || null;
      return servers.find((s) => s.id === currentServerId) || null;
    },
  };
});
