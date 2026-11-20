import { create } from 'zustand';
import { EmbyItem, ViewCounts } from '../api/embyClient';

interface MediaStoreState {
  serverId: string | null;
  resumeItems: EmbyItem[];
  nextUpItems: EmbyItem[];
  recentlyPlayedItems: EmbyItem[];
  views: EmbyItem[];
  latestMap: Record<string, EmbyItem[]>;
  viewCounts: Record<string, ViewCounts>;
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
  isLoaded: false,
  isRefreshing: false,
  homeScrollY: 0,
  cacheVersion: 0,

  setMediaData: ({ serverId, resumeItems, nextUpItems, recentlyPlayedItems, views, latestMap, viewCounts }) =>
    set((state) => ({
      serverId,
      resumeItems,
      nextUpItems,
      recentlyPlayedItems,
      views,
      latestMap,
      viewCounts: viewCounts !== undefined ? viewCounts : state.viewCounts,
      isLoaded: true,
      isRefreshing: false,
    })),

  updateResumeAndRecent: ({ resumeItems, nextUpItems, recentlyPlayedItems }) =>
    set({ resumeItems, nextUpItems, recentlyPlayedItems }),

  setViewCounts: (viewCounts) =>
    set({ viewCounts }),

  updateViewCount: (viewId, count) =>
    set((state) => ({
      viewCounts: {
        ...state.viewCounts,
        [viewId]: count,
      },
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
      isLoaded: false,
      isRefreshing: false,
      homeScrollY: 0,
      cacheVersion: state.cacheVersion + 1,
    })),
}));

