import { create } from 'zustand';
import { EmbyItem } from '../api/embyClient';

export type ActiveSpace = 'video' | 'music';
export type MusicPlayMode = 'sequence' | 'loop' | 'single' | 'shuffle';
export type NowPlayingVisualMode = 'cover' | 'vinyl';

export interface MusicServerContext {
  id: string;
  name: string;
  url: string;
  userId: string;
  accessToken: string;
}

interface PersistedMusicPrefs {
  activeSpace: ActiveSpace;
  volume: number;
  muted: boolean;
  playMode: MusicPlayMode;
  nowPlayingVisualMode: NowPlayingVisualMode;
}

const PREFS_STORAGE_KEY = 'nocta_music_prefs_v1';

function loadPrefs(): PersistedMusicPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        activeSpace: parsed.activeSpace === 'music' ? 'music' : 'video',
        volume:
          typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
            ? parsed.volume
            : 0.8,
        muted: Boolean(parsed.muted),
        playMode: ['sequence', 'loop', 'single', 'shuffle'].includes(parsed.playMode)
          ? parsed.playMode
          : 'loop',
        nowPlayingVisualMode: parsed.nowPlayingVisualMode === 'vinyl' ? 'vinyl' : 'cover',
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    activeSpace: 'video',
    volume: 0.8,
    muted: false,
    playMode: 'loop',
    nowPlayingVisualMode: 'cover',
  };
}

function savePrefs(prefs: PersistedMusicPrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

interface MusicPlayerState {
  activeSpace: ActiveSpace;
  queue: EmbyItem[];
  currentIndex: number;
  currentTrack: EmbyItem | null;
  sourceServer: MusicServerContext | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  playMode: MusicPlayMode;
  error: string | null;
  isNowPlayingOpen: boolean;
  isQueueOpen: boolean;
  nowPlayingVisualMode: NowPlayingVisualMode;
  seekRequest: { time: number; seq: number } | null;

  setActiveSpace: (space: ActiveSpace) => void;
  playTracks: (tracks: EmbyItem[], startIndex: number, server: MusicServerContext) => void;
  appendToQueue: (tracks: EmbyItem[], server: MusicServerContext) => void;
  insertPlayNext: (track: EmbyItem, server: MusicServerContext) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  playNext: (autoEnded?: boolean) => void;
  playPrev: () => void;
  requestSeek: (seconds: number) => void;
  setCurrentTime: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setBuffered: (seconds: number) => void;
  setPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  cyclePlayMode: () => void;
  setNowPlayingOpen: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  setNowPlayingVisualMode: (mode: NowPlayingVisualMode) => void;
  updateTrackFavorite: (itemId: string, isFavorite: boolean) => void;
}

const initialPrefs = loadPrefs();
let seekSeqCounter = 0;

function persistFromState(s: MusicPlayerState) {
  savePrefs({
    activeSpace: s.activeSpace,
    volume: s.volume,
    muted: s.muted,
    playMode: s.playMode,
    nowPlayingVisualMode: s.nowPlayingVisualMode,
  });
}

export const useMusicPlayerStore = create<MusicPlayerState>((set, get) => ({
  activeSpace: initialPrefs.activeSpace,
  queue: [],
  currentIndex: -1,
  currentTrack: null,
  sourceServer: null,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: initialPrefs.volume,
  muted: initialPrefs.muted,
  playMode: initialPrefs.playMode,
  error: null,
  isNowPlayingOpen: false,
  isQueueOpen: false,
  nowPlayingVisualMode: initialPrefs.nowPlayingVisualMode,
  seekRequest: null,

  setActiveSpace: (activeSpace) =>
    set((s) => {
      const next = { ...s, activeSpace };
      persistFromState(next);
      return { activeSpace };
    }),

  playTracks: (tracks, startIndex, server) => {
    const validTracks = tracks.filter((t) => t && t.Id);
    if (validTracks.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(startIndex, validTracks.length - 1));
    set({
      queue: validTracks,
      currentIndex: clampedIdx,
      currentTrack: validTracks[clampedIdx],
      sourceServer: server,
      isPlaying: true,
      isLoading: true,
      currentTime: 0,
      duration: validTracks[clampedIdx].RunTimeTicks
        ? validTracks[clampedIdx].RunTimeTicks / 10_000_000
        : 0,
      buffered: 0,
      error: null,
    });
  },

  appendToQueue: (tracks, server) => {
    const valid = tracks.filter((t) => t && t.Id);
    if (valid.length === 0) return;
    const state = get();
    if (state.queue.length === 0) {
      state.playTracks(valid, 0, server);
      return;
    }
    const existingIds = new Set(state.queue.map((t) => t.Id));
    const additions = valid.filter((t) => !existingIds.has(t.Id));
    if (additions.length === 0) return;
    set({ queue: [...state.queue, ...additions] });
  },

  insertPlayNext: (track, server) => {
    if (!track || !track.Id) return;
    const state = get();
    if (state.queue.length === 0 || state.currentIndex < 0) {
      state.playTracks([track], 0, server);
      return;
    }
    if (state.currentTrack?.Id === track.Id) return;
    const filtered = state.queue.filter((t) => t.Id !== track.Id);
    const currIdx = filtered.findIndex((t) => t.Id === state.currentTrack?.Id);
    const insertAt = currIdx >= 0 ? currIdx + 1 : 0;
    filtered.splice(insertAt, 0, track);
    set({
      queue: filtered,
      currentIndex: currIdx >= 0 ? currIdx : 0,
    });
  },

  removeFromQueue: (index) => {
    const state = get();
    if (index < 0 || index >= state.queue.length) return;
    const nextQueue = [...state.queue];
    nextQueue.splice(index, 1);

    if (nextQueue.length === 0) {
      set({
        queue: [],
        currentIndex: -1,
        currentTrack: null,
        isPlaying: false,
        isLoading: false,
        currentTime: 0,
        duration: 0,
        buffered: 0,
        isNowPlayingOpen: false,
      });
      return;
    }

    if (index === state.currentIndex) {
      const nextIdx = Math.min(index, nextQueue.length - 1);
      set({
        queue: nextQueue,
        currentIndex: nextIdx,
        currentTrack: nextQueue[nextIdx],
        currentTime: 0,
        buffered: 0,
        isLoading: true,
        error: null,
      });
    } else if (index < state.currentIndex) {
      set({
        queue: nextQueue,
        currentIndex: state.currentIndex - 1,
      });
    } else {
      set({ queue: nextQueue });
    }
  },

  clearQueue: () =>
    set({
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      isPlaying: false,
      isLoading: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      error: null,
      isNowPlayingOpen: false,
      isQueueOpen: false,
    }),

  togglePlay: () => {
    const state = get();
    if (!state.currentTrack) return;
    set({ isPlaying: !state.isPlaying });
  },

  play: () => {
    if (!get().currentTrack) return;
    set({ isPlaying: true });
  },

  pause: () => set({ isPlaying: false }),

  playNext: (autoEnded = false) => {
    const state = get();
    const { queue, currentIndex, playMode } = state;
    if (queue.length === 0) return;

    if (autoEnded && playMode === 'single') {
      seekSeqCounter += 1;
      set({
        currentTime: 0,
        seekRequest: { time: 0, seq: seekSeqCounter },
        isPlaying: true,
      });
      return;
    }

    let nextIndex = currentIndex + 1;
    if (playMode === 'shuffle' && queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * queue.length);
      } while (nextIndex === currentIndex);
    } else if (nextIndex >= queue.length) {
      if (autoEnded && playMode === 'sequence') {
        set({ isPlaying: false, currentTime: 0 });
        return;
      }
      nextIndex = 0;
    }

    const nextTrack = queue[nextIndex];
    set({
      currentIndex: nextIndex,
      currentTrack: nextTrack,
      isPlaying: true,
      isLoading: true,
      currentTime: 0,
      duration: nextTrack.RunTimeTicks ? nextTrack.RunTimeTicks / 10_000_000 : 0,
      buffered: 0,
      error: null,
    });
  },

  playPrev: () => {
    const state = get();
    const { queue, currentIndex, currentTime, playMode } = state;
    if (queue.length === 0) return;

    if (currentTime > 4) {
      seekSeqCounter += 1;
      set({
        currentTime: 0,
        seekRequest: { time: 0, seq: seekSeqCounter },
        isPlaying: true,
      });
      return;
    }

    let prevIndex = currentIndex - 1;
    if (playMode === 'shuffle' && queue.length > 1) {
      do {
        prevIndex = Math.floor(Math.random() * queue.length);
      } while (prevIndex === currentIndex);
    } else if (prevIndex < 0) {
      prevIndex = queue.length - 1;
    }

    const prevTrack = queue[prevIndex];
    set({
      currentIndex: prevIndex,
      currentTrack: prevTrack,
      isPlaying: true,
      isLoading: true,
      currentTime: 0,
      duration: prevTrack.RunTimeTicks ? prevTrack.RunTimeTicks / 10_000_000 : 0,
      buffered: 0,
      error: null,
    });
  },

  requestSeek: (seconds) => {
    seekSeqCounter += 1;
    const clamped = Math.max(0, seconds);
    set({
      currentTime: clamped,
      seekRequest: { time: clamped, seq: seekSeqCounter },
    });
  },

  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setBuffered: (buffered) => set({ buffered }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setVolume: (volume) =>
    set((s) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const next = { ...s, volume: clamped, muted: clamped === 0 ? s.muted : false };
      persistFromState(next);
      return { volume: clamped, muted: next.muted };
    }),

  toggleMute: () =>
    set((s) => {
      const next = { ...s, muted: !s.muted };
      persistFromState(next);
      return { muted: next.muted };
    }),

  cyclePlayMode: () =>
    set((s) => {
      const order: MusicPlayMode[] = ['loop', 'shuffle', 'single', 'sequence'];
      const nextMode = order[(order.indexOf(s.playMode) + 1) % order.length];
      const next = { ...s, playMode: nextMode };
      persistFromState(next);
      return { playMode: nextMode };
    }),

  setNowPlayingOpen: (isNowPlayingOpen) => set({ isNowPlayingOpen }),
  setQueueOpen: (isQueueOpen) => set({ isQueueOpen }),

  setNowPlayingVisualMode: (nowPlayingVisualMode) =>
    set((s) => {
      const next = { ...s, nowPlayingVisualMode };
      persistFromState(next);
      return { nowPlayingVisualMode };
    }),

  updateTrackFavorite: (itemId, isFavorite) =>
    set((s) => {
      const patchItem = (it: EmbyItem): EmbyItem =>
        it.Id === itemId
          ? {
              ...it,
              UserData: {
                ...(it.UserData || {}),
                IsFavorite: isFavorite,
              },
            }
          : it;

      return {
        queue: s.queue.map(patchItem),
        currentTrack: s.currentTrack ? patchItem(s.currentTrack) : null,
      };
    }),
}));
