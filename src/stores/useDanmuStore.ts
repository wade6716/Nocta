import { create } from 'zustand';
import { httpClient } from '../api/http';

export interface DanmuServerEntry {
  id: string;
  name: string;
  baseUrl: string; // e.g. "http://127.0.0.1:9321"
  token?: string; // e.g. "87654321"
  preferredPlatform?: string; // "bilibili1" | "qiyi" | "qq" | "youku" | "bahamut"
  latency?: number; // ms
  status?: 'ok' | 'error' | 'idle' | 'testing';
}

interface DanmuState {
  servers: DanmuServerEntry[];
  activeServerId: string;

  // Actions
  addServer: (server: Omit<DanmuServerEntry, 'id' | 'status' | 'latency'>) => string;
  updateServer: (id: string, updates: Partial<DanmuServerEntry>) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string) => void;
  getActiveServer: () => DanmuServerEntry;
  testServerConnection: (id: string) => Promise<{ ok: boolean; latency: number; error?: string }>;
}

const SERVERS_KEY = 'emby_danmu_servers_v2';
const ACTIVE_SERVER_KEY = 'emby_active_danmu_server_id';
const LEGACY_KEY = 'emby_danmu_config';

const DEFAULT_SERVER: DanmuServerEntry = {
  id: 'default-local',
  name: '本地 Danmu API',
  baseUrl: 'http://127.0.0.1:9321',
  token: '87654321',
  preferredPlatform: '',
  status: 'idle',
};

function loadInitialServers(): DanmuServerEntry[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    if (raw) {
      const parsed: DanmuServerEntry[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }

    // Try migrating legacy single danmuConfig
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const leg = JSON.parse(legacyRaw);
      if (leg?.baseUrl) {
        return [
          {
            id: 'legacy-migrated',
            name: '默认配置节点',
            baseUrl: leg.baseUrl,
            token: leg.token || '87654321',
            preferredPlatform: leg.preferredPlatform || '',
            status: 'idle',
          },
        ];
      }
    }
  } catch (err) {
    console.warn('Failed to load danmu servers:', err);
  }
  return [DEFAULT_SERVER];
}

function loadInitialActiveId(servers: DanmuServerEntry[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_SERVER_KEY);
    if (saved && servers.some((s) => s.id === saved)) {
      return saved;
    }
  } catch {}
  return servers[0]?.id || DEFAULT_SERVER.id;
}

export const useDanmuStore = create<DanmuState>((set, get) => {
  const initialServers = loadInitialServers();
  const initialActiveId = loadInitialActiveId(initialServers);

  const persist = (servers: DanmuServerEntry[], activeId?: string) => {
    try {
      localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
      if (activeId) {
        localStorage.setItem(ACTIVE_SERVER_KEY, activeId);
      }
    } catch (e) {
      console.error('Failed to persist danmu store:', e);
    }
  };

  return {
    servers: initialServers,
    activeServerId: initialActiveId,

    addServer: (data) => {
      const newId = `danmu-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newEntry: DanmuServerEntry = {
        ...data,
        id: newId,
        status: 'idle',
      };
      set((state) => {
        const next = [...state.servers, newEntry];
        persist(next, state.activeServerId);
        return { servers: next };
      });
      return newId;
    },

    updateServer: (id, updates) => {
      set((state) => {
        const next = state.servers.map((s) => (s.id === id ? { ...s, ...updates } : s));
        persist(next);
        return { servers: next };
      });
    },

    removeServer: (id) => {
      set((state) => {
        const next = state.servers.filter((s) => s.id !== id);
        const resolvedList = next.length > 0 ? next : [DEFAULT_SERVER];
        let nextActive = state.activeServerId;
        if (nextActive === id || !resolvedList.some((s) => s.id === nextActive)) {
          nextActive = resolvedList[0].id;
        }
        persist(resolvedList, nextActive);
        return { servers: resolvedList, activeServerId: nextActive };
      });
    },

    setActiveServer: (id) => {
      set((state) => {
        if (state.servers.some((s) => s.id === id)) {
          persist(state.servers, id);
          return { activeServerId: id };
        }
        return state;
      });
    },

    getActiveServer: () => {
      const { servers, activeServerId } = get();
      return servers.find((s) => s.id === activeServerId) || servers[0] || DEFAULT_SERVER;
    },

    testServerConnection: async (id) => {
      const server = get().servers.find((s) => s.id === id);
      if (!server) return { ok: false, latency: 0, error: '未找到指定节点' };

      get().updateServer(id, { status: 'testing' });

      const startTime = performance.now();
      const base = server.baseUrl.replace(/\/+$/, '');
      const tokenPath = server.token ? `/${server.token.replace(/^\/+|\/+$/g, '')}` : '';
      const testUrl = `${base}${tokenPath}/api/v2/version`;

      try {
        const res = await httpClient(testUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const latency = Math.round(performance.now() - startTime);

        if (res.ok) {
          get().updateServer(id, { status: 'ok', latency });
          return { ok: true, latency };
        } else {
          // If version endpoint returned non-200 (maybe legacy token path), try root or match ping
          const fallbackUrl = `${base}/api/v2/version`;
          const fbRes = await httpClient(fallbackUrl, { method: 'GET' }).catch(() => null);
          if (fbRes?.ok) {
            get().updateServer(id, { status: 'ok', latency });
            return { ok: true, latency };
          }
          const errText = `HTTP ${res.status}`;
          get().updateServer(id, { status: 'error', latency });
          return { ok: false, latency, error: errText };
        }
      } catch (err: any) {
        const latency = Math.round(performance.now() - startTime);
        get().updateServer(id, { status: 'error', latency });
        return { ok: false, latency, error: err.message || '网络连接超时或拒绝连接' };
      }
    },
  };
});
