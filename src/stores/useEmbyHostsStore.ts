import { create } from 'zustand';
import {
  type CollectedHostEntry,
  DEFAULT_EMBY_HOST_COLLECTOR_SETTINGS,
  type EmbyHostCategory,
  type EmbyHostCollectorSettings,
  mergeCollectedHostLists,
  normalizeEmbyServerSyncKey,
  upsertCollectedHost,
} from '../services/embyHostCollector';

const STORAGE_KEY = 'emby_collected_hosts_v1';

interface PersistedEmbyHostsPayload {
  settings: EmbyHostCollectorSettings;
  hostsByServerId: Record<string, CollectedHostEntry[]>;
}

export interface ServerIdentityLike {
  id: string;
  url: string;
  username: string;
}

interface EmbyHostsState {
  settings: EmbyHostCollectorSettings;
  hostsByServerId: Record<string, CollectedHostEntry[]>;
  recordUrl: (serverId: string | null | undefined, rawUrl: string, category: EmbyHostCategory) => void;
  recordUrls: (
    serverId: string | null | undefined,
    entries: Array<{ url: string; category: EmbyHostCategory }>
  ) => void;
  removeHost: (serverId: string, host: string) => void;
  clearServerHosts: (serverId: string) => void;
  removeServer: (serverId: string) => void;
  setEnabled: (enabled: boolean) => void;
  setProbePlaybackRedirects: (enabled: boolean) => void;
  setSettings: (partial: Partial<EmbyHostCollectorSettings>) => void;
  exportHostsByServerKey: (servers: ServerIdentityLike[]) => Record<string, CollectedHostEntry[]>;
  importHostsByServerKey: (
    remoteMap: Record<string, CollectedHostEntry[]>,
    servers: ServerIdentityLike[],
    mode: 'merge' | 'replace'
  ) => void;
}

function loadPersistedState(): PersistedEmbyHostsPayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        settings: { ...DEFAULT_EMBY_HOST_COLLECTOR_SETTINGS },
        hostsByServerId: {},
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedEmbyHostsPayload>;
    return {
      settings: {
        ...DEFAULT_EMBY_HOST_COLLECTOR_SETTINGS,
        ...(parsed.settings || {}),
      },
      hostsByServerId:
        parsed.hostsByServerId && typeof parsed.hostsByServerId === 'object'
          ? parsed.hostsByServerId
          : {},
    };
  } catch {
    return {
      settings: { ...DEFAULT_EMBY_HOST_COLLECTOR_SETTINGS },
      hostsByServerId: {},
    };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: PersistedEmbyHostsPayload | null = null;

function writeNow(payload: PersistedEmbyHostsPayload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 忽略存储配额异常，避免影响主播放流程
  }
}

function schedulePersist(payload: PersistedEmbyHostsPayload) {
  pendingPayload = payload;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (pendingPayload) {
      writeNow(pendingPayload);
      pendingPayload = null;
    }
  }, 500);
}

function persistImmediate(payload: PersistedEmbyHostsPayload) {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingPayload = null;
  writeNow(payload);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingPayload) {
      persistImmediate(pendingPayload);
    }
  });
}

const initial = loadPersistedState();

export const useEmbyHostsStore = create<EmbyHostsState>((set, get) => ({
  settings: initial.settings,
  hostsByServerId: initial.hostsByServerId,

  recordUrl: (serverId, rawUrl, category) => {
    if (!serverId || !rawUrl) return;
    const state = get();
    if (!state.settings.enabled) return;

    const current = state.hostsByServerId[serverId] || [];
    const updated = upsertCollectedHost(current, rawUrl, category);
    if (updated === current) return;

    const nextHosts = { ...state.hostsByServerId, [serverId]: updated };
    set({ hostsByServerId: nextHosts });
    schedulePersist({ settings: state.settings, hostsByServerId: nextHosts });
  },

  recordUrls: (serverId, entries) => {
    if (!serverId || !entries || entries.length === 0) return;
    const state = get();
    if (!state.settings.enabled) return;

    const current = state.hostsByServerId[serverId] || [];
    let updated = current;
    const now = Date.now();
    for (const item of entries) {
      if (item?.url) {
        updated = upsertCollectedHost(updated, item.url, item.category, now);
      }
    }
    if (updated === current) return;

    const nextHosts = { ...state.hostsByServerId, [serverId]: updated };
    set({ hostsByServerId: nextHosts });
    schedulePersist({ settings: state.settings, hostsByServerId: nextHosts });
  },

  removeHost: (serverId, host) => {
    const state = get();
    const current = state.hostsByServerId[serverId];
    if (!current) return;

    const normalized = host.trim().toLowerCase();
    const filtered = current.filter((item) => item.host !== normalized);
    if (filtered.length === current.length) return;

    const nextHosts = { ...state.hostsByServerId, [serverId]: filtered };
    set({ hostsByServerId: nextHosts });
    persistImmediate({ settings: state.settings, hostsByServerId: nextHosts });
  },

  clearServerHosts: (serverId) => {
    const state = get();
    if (!(serverId in state.hostsByServerId)) return;
    const nextHosts = { ...state.hostsByServerId };
    delete nextHosts[serverId];
    set({ hostsByServerId: nextHosts });
    persistImmediate({ settings: state.settings, hostsByServerId: nextHosts });
  },

  removeServer: (serverId) => {
    const state = get();
    if (!(serverId in state.hostsByServerId)) return;
    const nextHosts = { ...state.hostsByServerId };
    delete nextHosts[serverId];
    set({ hostsByServerId: nextHosts });
    persistImmediate({ settings: state.settings, hostsByServerId: nextHosts });
  },

  setEnabled: (enabled) => {
    const state = get();
    const nextSettings = { ...state.settings, enabled };
    set({ settings: nextSettings });
    persistImmediate({ settings: nextSettings, hostsByServerId: state.hostsByServerId });
  },

  setProbePlaybackRedirects: (probePlaybackRedirects) => {
    const state = get();
    const nextSettings = { ...state.settings, probePlaybackRedirects };
    set({ settings: nextSettings });
    persistImmediate({ settings: nextSettings, hostsByServerId: state.hostsByServerId });
  },

  setSettings: (partial) => {
    const state = get();
    const nextSettings = { ...state.settings, ...partial };
    set({ settings: nextSettings });
    persistImmediate({ settings: nextSettings, hostsByServerId: state.hostsByServerId });
  },

  exportHostsByServerKey: (servers) => {
    const state = get();
    const result: Record<string, CollectedHostEntry[]> = {};
    for (const srv of servers) {
      const entries = state.hostsByServerId[srv.id];
      if (!entries || entries.length === 0) continue;
      const syncKey = normalizeEmbyServerSyncKey(srv.url, srv.username);
      result[syncKey] = mergeCollectedHostLists(result[syncKey] || [], entries);
    }
    return result;
  },

  importHostsByServerKey: (remoteMap, servers, mode) => {
    if (!remoteMap || typeof remoteMap !== 'object') return;
    const state = get();
    const nextHosts: Record<string, CollectedHostEntry[]> =
      mode === 'replace' ? {} : { ...state.hostsByServerId };

    for (const srv of servers) {
      const syncKey = normalizeEmbyServerSyncKey(srv.url, srv.username);
      const remoteEntries = remoteMap[syncKey];
      if (!remoteEntries || remoteEntries.length === 0) continue;

      if (mode === 'replace') {
        nextHosts[srv.id] = mergeCollectedHostLists([], remoteEntries);
      } else {
        nextHosts[srv.id] = mergeCollectedHostLists(nextHosts[srv.id] || [], remoteEntries);
      }
    }

    set({ hostsByServerId: nextHosts });
    persistImmediate({ settings: state.settings, hostsByServerId: nextHosts });
  },
}));
