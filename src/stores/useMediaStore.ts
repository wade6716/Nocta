import { create } from 'zustand';
import { EmbyItem, FederatedHistoryServerStat, ViewCounts } from '../api/embyClient';
import { clearAllPageCaches } from '../services/pageCache';

export interface ContinueWatchingCacheData {
  serverKey: string;
  items: EmbyItem[];
  stats: FederatedHistoryServerStat[];
  fetchedAt: number;
}

interface MediaStoreState {
  serverId: string | null;
  resumeItems: EmbyItem[];
  nextUpItems: EmbyItem[];
  recentlyPlayedItems: EmbyItem[];
  views: EmbyItem[];
  musicViews: EmbyItem[];
  latestMap: Record<string, EmbyItem[]>;
  viewCounts: Record<string, ViewCounts>;
  lastViewCountsSyncAt: number;
  playbackDirtyRevision: number;
  continueWatchingCache: ContinueWatchingCacheData | null;
  isLoaded: boolean;
  isRefreshing: boolean;
  homeScrollY: number;
  cacheVersion: number;

  setMediaData: (params: {
    serverId: string;
    resumeItems: EmbyItem[];
    nextUpItems: EmbyItem[];
    recentlyPlayedItems: EmbyItem[];
    views: EmbyItem[];
    musicViews?: EmbyItem[];
    latestMap: Record<string, EmbyItem[]>;
    viewCounts?: Record<string, ViewCounts>;
  }) => void;
  updateResumeAndRecent: (params: {
    resumeItems: EmbyItem[];
    nextUpItems: EmbyItem[];
    recentlyPlayedItems: EmbyItem[];
  }) => void;
  setViewCounts: (counts: Record<string, ViewCounts>) => void;
  updateViewCount: (viewId: string, count: ViewCounts) => void;
  setContinueWatchingCache: (cache: ContinueWatchingCacheData | null) => void;
  markPlaybackDirty: () => void;
  setRefreshing: (isRefreshing: boolean) => void;
  setHomeScrollY: (y: number) => void;
  clearMediaCache: () => void;
}

export const useMediaStore = create<MediaStoreState>((set) => ({
  serverId: null,
  resumeItems: [],
  nextUpItems: [],
  recentlyPlayedItems: [],
  views: [],
  musicViews: [],
  latestMap: {},
  viewCounts: {},
  lastViewCountsSyncAt: 0,
  playbackDirtyRevision: 0,
  continueWatchingCache: null,
  isLoaded: false,
  isRefreshing: false,
  homeScrollY: 0,
  cacheVersion: 0,

  setMediaData: ({ serverId, resumeItems, nextUpItems, recentlyPlayedItems, views, musicViews, latestMap, viewCounts }) =>
    set((state) => {
      const serverChanged = state.serverId !== serverId;
      return {
        serverId,
        resumeItems,
        nextUpItems,
        recentlyPlayedItems,
        views,
        musicViews:
          musicViews !== undefined ? musicViews : serverChanged ? [] : state.musicViews,
        latestMap,
        viewCounts:
          viewCounts !== undefined ? viewCounts : serverChanged ? {} : state.viewCounts,
        lastViewCountsSyncAt:
          viewCounts !== undefined
            ? Date.now()
            : serverChanged
            ? 0
            : state.lastViewCountsSyncAt,
        isLoaded: true,
        isRefreshing: false,
      };
    }),

  updateResumeAndRecent: ({ resumeItems, nextUpItems, recentlyPlayedItems }) =>
    set({ resumeItems, nextUpItems, recentlyPlayedItems }),

  setViewCounts: (viewCounts) =>
    set({ viewCounts, lastViewCountsSyncAt: Date.now() }),

  updateViewCount: (viewId, count) =>
    set((state) => ({
      viewCounts: {
        ...state.viewCounts,
        [viewId]: count,
      },
    })),

  setContinueWatchingCache: (continueWatchingCache) =>
    set({ continueWatchingCache }),

  markPlaybackDirty: () =>
    set((state) => ({
      playbackDirtyRevision: state.playbackDirtyRevision + 1,
    })),

  setRefreshing: (isRefreshing) =>
    set({ isRefreshing }),

  setHomeScrollY: (homeScrollY) =>
    set({ homeScrollY }),

  clearMediaCache: () => {
    clearAllPageCaches();
    set((state) => ({
      serverId: null,
      resumeItems: [],
      nextUpItems: [],
      recentlyPlayedItems: [],
      views: [],
      musicViews: [],
      latestMap: {},
      viewCounts: {},
      lastViewCountsSyncAt: 0,
      isLoaded: false,
      isRefreshing: false,
      homeScrollY: 0,
      cacheVersion: state.cacheVersion + 1,
    }));
  },
}));

/**
 * 从已缓存的首页/续播列表中零网络延迟反查预览条目，严格校对 serverId 防串服。
 */
export function findCachedItemById(
  serverId: string | undefined,
  itemId: string | undefined
): EmbyItem | null {
  if (!serverId || !itemId) return null;
  const state = useMediaStore.getState();

  if (state.serverId === serverId) {
    const pools = [
      state.resumeItems,
      state.nextUpItems,
      state.recentlyPlayedItems,
      ...Object.values(state.latestMap),
    ];
    for (const list of pools) {
      const hit = list.find((it) => it.Id === itemId);
      if (hit) return hit;
    }
  }

  const cwItems = state.continueWatchingCache?.items;
  if (cwItems?.length) {
    const hit = cwItems.find((it) => it.Id === itemId && it.ServerId === serverId);
    if (hit) return hit;
  }

  return null;
}

