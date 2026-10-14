import { create } from 'zustand';
import { EmbyItem } from '../api/embyClient';

interface MediaStoreState {
  serverId: string | null;
  resumeItems: EmbyItem[];
  nextUpItems: EmbyItem[];
  recentlyPlayedItems: EmbyItem[];
  views: EmbyItem[];
  latestMap: Record<string, EmbyItem[]>;
  isLoaded: boolean;
  isRefreshing: boolean;
  homeScrollY: number;

  setMediaData: (params: {
    serverId: string;
    resumeItems: EmbyItem[];
    nextUpItems: EmbyItem[];
    recentlyPlayedItems: EmbyItem[];
    views: EmbyItem[];
    latestMap: Record<string, EmbyItem[]>;
  }) => void;
  updateResumeAndRecent: (params: {
    resumeItems: EmbyItem[];
    nextUpItems: EmbyItem[];
    recentlyPlayedItems: EmbyItem[];
  }) => void;
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
  isLoaded: false,
  isRefreshing: false,
  homeScrollY: 0,

  setMediaData: ({ serverId, resumeItems, nextUpItems, recentlyPlayedItems, views, latestMap }) =>
    set({
      serverId,
      resumeItems,
      nextUpItems,
      recentlyPlayedItems,
      views,
      latestMap,
      isLoaded: true,
      isRefreshing: false,
    }),

  updateResumeAndRecent: ({ resumeItems, nextUpItems, recentlyPlayedItems }) =>
    set({ resumeItems, nextUpItems, recentlyPlayedItems }),

  setRefreshing: (isRefreshing) =>
    set({ isRefreshing }),

  setHomeScrollY: (homeScrollY) =>
    set({ homeScrollY }),

  clearMediaCache: () =>
    set({
      serverId: null,
      resumeItems: [],
      nextUpItems: [],
      recentlyPlayedItems: [],
      views: [],
      latestMap: {},
      isLoaded: false,
      isRefreshing: false,
      homeScrollY: 0,
    }),
}));
