import { create } from 'zustand';
import { httpClient } from '../api/http';
import { recordServerFailure, recordServerSuccess } from '../api/danmuServerHealth';

export interface DanmuServerEntry {
  id: string;
  name: string;
  baseUrl: string; // e.g. "http://127.0.0.1:9321"
  token?: string; // e.g. "87654321"
  preferredPlatform?: string; // "bilibili1" | "qiyi" | "qq" | "youku" | "bahamut"
  latency?: number; // ms
  status?: 'ok' | 'error' | 'idle' | 'testing';
  errorMessage?: string;
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
  importServers: (servers: DanmuServerEntry[], activeId?: string, mode?: 'merge' | 'replace') => void;
  syncServersFromRemote: (
    servers: DanmuServerEntry[],
    activeServerId: string,
    shouldPersist?: boolean
  ) => void;
}

const SERVERS_KEY = 'emby_danmu_servers_v2';
const ACTIVE_SERVER_KEY = 'emby_active_danmu_server_id';
const LEGACY_KEY = 'emby_danmu_config';

const DEFAULT_SERVER: DanmuServerEntry = {
  id: 'default-local',
  name: '本地 Danmu API',
  baseUrl: 'http://127.0.0.1:9321/87654321',
  preferredPlatform: '',
  status: 'idle',
};

function loadInitialServers(): DanmuServerEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [DEFAULT_SERVER];
    }
    const raw = localStorage.getItem(SERVERS_KEY);
    if (raw) {
      const parsed: DanmuServerEntry[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 自动合并历史数据中分离的 token 到 baseUrl 中
        return parsed.map((s) => {
          let cleanBase = (s.baseUrl || '').replace(/\/+$/, '');
          if (s.token && !cleanBase.endsWith(`/${s.token}`)) {
            cleanBase = `${cleanBase}/${s.token.replace(/^\/+|\/+$/g, '')}`;
          }
          return {
            ...s,
            baseUrl: cleanBase || DEFAULT_SERVER.baseUrl,
          };
        });
      }
    }

    // Try migrating legacy single danmuConfig
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const leg = JSON.parse(legacyRaw);
      if (leg?.baseUrl) {
        let base = leg.baseUrl.replace(/\/+$/, '');
        if (leg.token && !base.endsWith(`/${leg.token}`)) {
          base = `${base}/${leg.token.replace(/^\/+|\/+$/g, '')}`;
        }
        return [
          {
            id: 'legacy-migrated',
            name: '默认配置节点',
            baseUrl: base,
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
    if (typeof window === 'undefined' || !window.localStorage) {
      return servers[0]?.id || DEFAULT_SERVER.id;
    }
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

      get().updateServer(id, { status: 'testing', errorMessage: undefined });

      const startTime = performance.now();
      let base = server.baseUrl.trim().replace(/\/+$/, '');
      if (server.token && !base.endsWith(`/${server.token}`)) {
        base = `${base}/${server.token.replace(/^\/+|\/+$/g, '')}`;
      }

      // 提取去除末尾 /api 或 /api/v2 的基础路径，用于探测 /api/config
      const baseWithoutApi = base.replace(/\/api(\/v2)?\/?$/i, '');
      const testUrl = `${baseWithoutApi}/api/config`;

      try {
        const res = await httpClient(testUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const latency = Math.round(performance.now() - startTime);

        if (res.ok) {
          recordServerSuccess(server.baseUrl, latency);
          get().updateServer(id, { status: 'ok', latency, errorMessage: undefined });
          return { ok: true, latency };
        } else if (res.status === 401 || res.status === 403) {
          const errText = `Token 错误或未授权 (HTTP ${res.status})`;
          recordServerFailure(server.baseUrl, errText);
          get().updateServer(id, { status: 'error', latency, errorMessage: errText });
          return { ok: false, latency, error: errText };
        } else {
          // 如果 /api/config 返回 404 等（可能是官方或自建标准弹弹play节点），尝试 POST /api/v2/match
          const fallbackMatchUrl = `${baseWithoutApi}/api/v2/match`;
          try {
            const fbRes = await httpClient(fallbackMatchUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: 'ping' }),
            });
            const fbLatency = Math.round(performance.now() - startTime);
            if (fbRes.ok) {
              recordServerSuccess(server.baseUrl, fbLatency);
              get().updateServer(id, { status: 'ok', latency: fbLatency, errorMessage: undefined });
              return { ok: true, latency: fbLatency };
            } else if (fbRes.status === 401 || fbRes.status === 403) {
              const errText = `Token 错误或未授权 (HTTP ${fbRes.status})`;
              recordServerFailure(server.baseUrl, errText);
              get().updateServer(id, { status: 'error', latency: fbLatency, errorMessage: errText });
              return { ok: false, latency: fbLatency, error: errText };
            }
          } catch {
            // 继续尝试根路径
          }

          // 尝试 GET / 兜底
          try {
            const rootRes = await httpClient(`${baseWithoutApi}/`, { method: 'GET' });
            const rootLatency = Math.round(performance.now() - startTime);
            if (rootRes.ok) {
              recordServerSuccess(server.baseUrl, rootLatency);
              get().updateServer(id, { status: 'ok', latency: rootLatency, errorMessage: undefined });
              return { ok: true, latency: rootLatency };
            }
          } catch {
            // ignore
          }

          const errText = `接口返回 HTTP ${res.status}`;
          recordServerFailure(server.baseUrl, errText);
          get().updateServer(id, { status: 'error', latency, errorMessage: errText });
          return { ok: false, latency, error: errText };
        }
      } catch (err: any) {
        const latency = Math.round(performance.now() - startTime);
        const errText = err?.message || '无法连接到服务器 (请确认服务已启动或地址可达)';
        recordServerFailure(server.baseUrl, errText);
        get().updateServer(id, { status: 'error', latency, errorMessage: errText });
        return { ok: false, latency, error: errText };
      }
    },

    importServers: (imported, activeId, mode = 'merge') => {
      set((state) => {
        let next: DanmuServerEntry[];
        if (mode === 'replace') {
          next = imported.length > 0 ? imported : [DEFAULT_SERVER];
        } else {
          const map = new Map<string, DanmuServerEntry>();
          state.servers.forEach((s) => map.set(s.baseUrl.trim().toLowerCase(), s));
          imported.forEach((s) => {
            const key = s.baseUrl.trim().toLowerCase();
            if (map.has(key)) {
              const old = map.get(key)!;
              map.set(key, { ...old, ...s, token: s.token || old.token });
            } else {
              map.set(key, s);
            }
          });
          next = Array.from(map.values());
        }

        let nextActive = activeId || state.activeServerId;
        if (!next.some((s) => s.id === nextActive)) {
          nextActive = next[0]?.id || DEFAULT_SERVER.id;
        }

        persist(next, nextActive);
        return { servers: next, activeServerId: nextActive };
      });
    },

    syncServersFromRemote: (nextServers, nextActiveId, shouldPersist = false) => {
      const resolvedList = nextServers.length > 0 ? nextServers : [DEFAULT_SERVER];
      const resolvedActive = resolvedList.some((s) => s.id === nextActiveId)
        ? nextActiveId
        : resolvedList[0].id;
      if (shouldPersist) {
        persist(resolvedList, resolvedActive);
      }
      set({ servers: resolvedList, activeServerId: resolvedActive });
    },
  };
});
