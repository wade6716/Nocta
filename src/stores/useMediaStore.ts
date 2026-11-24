import { create } from 'zustand';
import { EmbyItem, FederatedHistoryServerStat, ViewCounts } from '../api/embyClient';

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
  latestMap: {},
  viewCounts: {},
  lastViewCountsSyncAt: 0,
  playbackDirtyRevision: 0,
  continueWatchingCache: null,
  isLoaded: false,
  isRefreshing: false,
  homeScrollY: 0,
  cacheVersion: 0,

  setMediaData: ({ serverId, resumeItems, nextUpItems, recentlyPlayedItems, views, latestMap, viewCounts }) =>
    set((state) => {
      const serverChanged = state.serverId !== serverId;
      return {
        serverId,
        resumeItems,
        nextUpItems,
        recentlyPlayedItems,
        views,
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

  clearMediaCache: () =>
    set((state) => ({
      serverId: null,
      resumeItems: [],
      nextUpItems: [],
      recentlyPlayedItems: [],
      views: [],
      latestMap: {},
      viewCounts: {},
      lastViewCountsSyncAt: 0,
      isLoaded: false,
      isRefreshing: false,
      homeScrollY: 0,
      cacheVersion: state.cacheVersion + 1,
    })),
}));

