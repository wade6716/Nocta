import { create } from 'zustand';
import { EmbyItem, EmbyMediaSource, MappedTrack } from '../api/embyClient';

export type DanmakuColorMode = 'vibrant' | 'monochrome' | 'blocked';

export interface DanmakuSettings {
  visible: boolean;
  opacity: number;
  area: number;
  maxLines: number; // 0 为不限行数，3, 5, 8 等为限制行数
  speed: number;
  fontSize: number;
  bottomMargin: number; // 底部避让字幕距离，默认 48
  colorMode: DanmakuColorMode; // 'vibrant' 彩色原色 | 'monochrome' 统一纯白 | 'blocked' 屏蔽彩色
  blockScroll: boolean;
  blockTop: boolean;
  blockBottom: boolean;
  blockColor: boolean; // 兼容旧字段
  blockedWords: string[];
}

export interface DanmakuBinding {
  itemId: string;
  seriesId?: string;
  animeTitle: string;
  episodeId: number | string;
  episodeTitle: string;
  sourcePlatform?: string;
  commentCount: number;
  sourceDuration?: number;
  boundAt: number;
}

export interface VideoLayoutConfig {
  bottomAlign: boolean; // 是否开启贴底模式
  verticalOffset: number; // 垂直位置百分比: 50(居中) ~ 100(完全贴底)，默认 100
}

export type SkipOutroAction = 'ask' | 'auto';

export interface SkipSegments {
  itemId: string;
  introEnd?: number;
  outroStart?: number;
  updatedAt: number;
}

export interface SkipSettings {
  skipIntroEnabled: boolean;
  skipOutroEnabled: boolean;
  skipOutroAction: SkipOutroAction;
}

export const DEFAULT_SKIP_SETTINGS: SkipSettings = {
  skipIntroEnabled: true,
  skipOutroEnabled: true,
  skipOutroAction: 'ask',
};

export function getSkipKey(item: { Id: string; SeriesId?: string }): string {
  return item.SeriesId ? `series_${item.SeriesId}` : `item_${item.Id}`;
}

interface PlayerState {
  // 播放项信息
  item: EmbyItem | null;
  mediaSource: EmbyMediaSource | null;
  playSessionId: string | null;
  streamUrl: string | null;

  // 播放状态
  currentTime: number;
  initialTime: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  playbackRate: number;
  volume: number;

  // 轨道状态
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  selectedAudioId: string | null;
  selectedSubtitleId: string | null;

  // 弹幕设置与偏好
  danmakuSettings: DanmakuSettings;
  itemOffsets: Record<string, number>; // itemId -> offsetSeconds
  danmakuBindings: Record<string, DanmakuBinding>; // itemId -> DanmakuBinding
  videoLayouts: Record<string, VideoLayoutConfig>; // seriesId/itemId -> VideoLayoutConfig
  skipSegments: Record<string, SkipSegments>; // series_key/item_key -> SkipSegments
  skipSettings: SkipSettings;
  engineType: 'mpv' | 'html5';

  // Actions
  setPlaybackContext: (payload: {
    item: EmbyItem;
    mediaSource: EmbyMediaSource;
    playSessionId: string;
    streamUrl: string;
    audioTracks: MappedTrack[];
    subtitleTracks: MappedTrack[];
    initialTime?: number;
  }) => void;
  updateTime: (currentTime: number, duration?: number) => void;
  setPaused: (paused: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (vol: number) => void;
  selectAudioTrack: (id: string | null) => void;
  selectSubtitleTrack: (id: string | null) => void;
  updateDanmakuSettings: (settings: Partial<DanmakuSettings>) => void;
  setItemOffset: (itemId: string, offset: number) => void;
  bindDanmaku: (itemId: string, binding: Omit<DanmakuBinding, 'boundAt'>) => void;
  unbindDanmaku: (itemId: string) => void;
  setVideoLayout: (key: string, config: Partial<VideoLayoutConfig>) => void;
  resetVideoLayout: (key: string) => void;
  setSkipSegment: (
    key: string,
    patch: { itemId?: string; introEnd?: number; outroStart?: number }
  ) => void;
  clearSkipSegment: (key: string, field: 'introEnd' | 'outroStart') => void;
  updateSkipSettings: (settings: Partial<SkipSettings>) => void;
  setEngineType: (type: 'mpv' | 'html5') => void;
  resetPlayer: () => void;
  importPlayerConfigs: (
    configs: {
      danmakuSettings?: Partial<DanmakuSettings>;
      itemOffsets?: Record<string, number>;
      danmakuBindings?: Record<string, DanmakuBinding>;
      videoLayouts?: Record<string, VideoLayoutConfig>;
      skipSegments?: Record<string, SkipSegments>;
      skipSettings?: Partial<SkipSettings>;
      engineType?: 'mpv' | 'html5';
    },
    mode?: 'merge' | 'replace'
  ) => void;
}

const SETTINGS_KEY = 'emby_danmaku_settings';
const OFFSETS_KEY = 'emby_danmaku_offsets';
const BINDINGS_KEY = 'emby_danmaku_bindings';
const VIDEO_LAYOUTS_KEY = 'emby_video_layout_configs';
const SKIP_SEGMENTS_KEY = 'nocta_skip_segments';
const SKIP_SETTINGS_KEY = 'nocta_skip_settings';
const ENGINE_TYPE_KEY = 'emby_player_engine_type';

function loadEngineType(): 'mpv' | 'html5' {
  try {
    const raw = localStorage.getItem(ENGINE_TYPE_KEY);
    return raw === 'html5' ? 'html5' : 'mpv';
  } catch {
    return 'mpv';
  }
}

function loadVideoLayouts(): Record<string, VideoLayoutConfig> {
  try {
    const raw = localStorage.getItem(VIDEO_LAYOUTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadSkipSegments(): Record<string, SkipSegments> {
  try {
    const raw = localStorage.getItem(SKIP_SEGMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadSkipSettings(): SkipSettings {
  try {
    const raw = localStorage.getItem(SKIP_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_SKIP_SETTINGS,
      ...parsed,
      skipOutroAction: parsed.skipOutroAction === 'auto' ? 'auto' : 'ask',
    };
  } catch {
    return { ...DEFAULT_SKIP_SETTINGS };
  }
}

function loadDanmakuSettings(): DanmakuSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      visible: parsed.visible ?? true,
      opacity: parsed.opacity ?? 0.85,
      area: parsed.area ?? 0.75,
      maxLines: parsed.maxLines ?? 0,
      speed: parsed.speed ?? 144,
      fontSize: parsed.fontSize ?? 24,
      bottomMargin: parsed.bottomMargin ?? 48,
      colorMode: parsed.colorMode ?? (parsed.blockColor ? 'blocked' : 'vibrant'),
      blockScroll: parsed.blockScroll ?? false,
      blockTop: parsed.blockTop ?? false,
      blockBottom: parsed.blockBottom ?? false,
      blockColor: parsed.blockColor ?? false,
      blockedWords: parsed.blockedWords ?? [],
    };
  } catch {
    return {
      visible: true,
      opacity: 0.85,
      area: 0.75,
      maxLines: 0,
      speed: 144,
      fontSize: 24,
      bottomMargin: 48,
      colorMode: 'vibrant',
      blockScroll: false,
      blockTop: false,
      blockBottom: false,
      blockColor: false,
      blockedWords: [],
    };
  }
}

function loadOffsets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OFFSETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadBindings(): Record<string, DanmakuBinding> {
  try {
    const raw = localStorage.getItem(BINDINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  item: null,
  mediaSource: null,
  playSessionId: null,
  streamUrl: null,

  currentTime: 0,
  initialTime: 0,
  duration: 0,
  paused: true,
  buffering: false,
  playbackRate: 1.0,
  volume: 100,

  audioTracks: [],
  subtitleTracks: [],
  selectedAudioId: null,
  selectedSubtitleId: null,

  danmakuSettings: loadDanmakuSettings(),
  itemOffsets: loadOffsets(),
  danmakuBindings: loadBindings(),
  videoLayouts: loadVideoLayouts(),
  skipSegments: loadSkipSegments(),
  skipSettings: loadSkipSettings(),
  engineType: loadEngineType(),

  setPlaybackContext: (payload) => {
    const defaultAudio =
      payload.audioTracks.find((t) => t.isDefault)?.id || payload.audioTracks[0]?.id || null;
    const defaultSub = payload.subtitleTracks.find((t) => t.isDefault)?.id || null;

    // 完播防回滚：当进度距片尾不足 15 秒或超过 98% 时，视为完播，下次重新起播从 0:00 开始
    const runTimeSec = payload.item.RunTimeTicks ? payload.item.RunTimeTicks / 10000000 : 0;
    let safeInitialTime = payload.initialTime || 0;
    if (runTimeSec > 0 && safeInitialTime > 0) {
      if (runTimeSec - safeInitialTime < 15 || safeInitialTime / runTimeSec > 0.98) {
        safeInitialTime = 0;
      }
    }

    set({
      item: payload.item,
      mediaSource: payload.mediaSource,
      playSessionId: payload.playSessionId,
      streamUrl: payload.streamUrl,
      audioTracks: payload.audioTracks,
      subtitleTracks: payload.subtitleTracks,
      selectedAudioId: defaultAudio,
      selectedSubtitleId: defaultSub,
      currentTime: safeInitialTime,
      initialTime: safeInitialTime,
      paused: false,
      buffering: false,
    });
  },

  updateTime: (currentTime, duration) => {
    set((state) => ({
      currentTime,
      duration: duration !== undefined ? duration : state.duration,
    }));
  },

  setPaused: (paused) => set({ paused }),
  setBuffering: (buffering) => set({ buffering }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(100, volume)) }),

  selectAudioTrack: (id) => set({ selectedAudioId: id }),
  selectSubtitleTrack: (id) => set({ selectedSubtitleId: id }),

  updateDanmakuSettings: (newSettings) => {
    set((state) => {
      const updated = { ...state.danmakuSettings, ...newSettings };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { danmakuSettings: updated };
    });
  },

  setItemOffset: (itemId, offset) => {
    set((state) => {
      const updated = { ...state.itemOffsets, [itemId]: offset };
      try {
        localStorage.setItem(OFFSETS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { itemOffsets: updated };
    });
  },

  bindDanmaku: (itemId, binding) => {
    set((state) => {
      const fullBinding: DanmakuBinding = {
        ...binding,
        boundAt: Date.now(),
      };
      const updated = { ...state.danmakuBindings, [itemId]: fullBinding };
      try {
        localStorage.setItem(BINDINGS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { danmakuBindings: updated };
    });
  },

  unbindDanmaku: (itemId) => {
    set((state) => {
      const updated = { ...state.danmakuBindings };
      delete updated[itemId];
      try {
        localStorage.setItem(BINDINGS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { danmakuBindings: updated };
    });
  },

  setVideoLayout: (key, config) => {
    set((state) => {
      const prev = state.videoLayouts[key] || { bottomAlign: false, verticalOffset: 100 };
      const updated = {
        ...state.videoLayouts,
        [key]: { ...prev, ...config },
      };
      try {
        localStorage.setItem(VIDEO_LAYOUTS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { videoLayouts: updated };
    });
  },

  resetVideoLayout: (key) => {
    set((state) => {
      const updated = { ...state.videoLayouts };
      delete updated[key];
      try {
        localStorage.setItem(VIDEO_LAYOUTS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { videoLayouts: updated };
    });
  },

  setSkipSegment: (key, patch) => {
    set((state) => {
      const prev = state.skipSegments[key];
      const next: SkipSegments = {
        ...(prev || { itemId: patch.itemId || '', updatedAt: 0 }),
        ...patch,
        updatedAt: Date.now(),
      };
      const updated = { ...state.skipSegments, [key]: next };
      try {
        localStorage.setItem(SKIP_SEGMENTS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { skipSegments: updated };
    });
  },

  clearSkipSegment: (key, field) => {
    set((state) => {
      const prev = state.skipSegments[key];
      if (!prev) return state;

      const next: SkipSegments = { ...prev, updatedAt: Date.now() };
      delete next[field];

      const updated = { ...state.skipSegments };
      if (next.introEnd === undefined && next.outroStart === undefined) {
        delete updated[key];
      } else {
        updated[key] = next;
      }

      try {
        localStorage.setItem(SKIP_SEGMENTS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { skipSegments: updated };
    });
  },

  updateSkipSettings: (settings) => {
    set((state) => {
      const updated = { ...state.skipSettings, ...settings };
      try {
        localStorage.setItem(SKIP_SETTINGS_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return { skipSettings: updated };
    });
  },

  setEngineType: (type) => {
    try {
      localStorage.setItem(ENGINE_TYPE_KEY, type);
    } catch (e) {
      console.error(e);
    }
    set({ engineType: type });
  },

  resetPlayer: () => {
    set({
      item: null,
      mediaSource: null,
      playSessionId: null,
      streamUrl: null,
      currentTime: 0,
      initialTime: 0,
      duration: 0,
      paused: true,
      buffering: false,
      audioTracks: [],
      subtitleTracks: [],
      selectedAudioId: null,
      selectedSubtitleId: null,
    });
  },

  importPlayerConfigs: (configs, mode = 'merge') => {
    set((state) => {
      let nextSettings = state.danmakuSettings;
      let nextOffsets = state.itemOffsets;
      let nextBindings = state.danmakuBindings;
      let nextLayouts = state.videoLayouts;
      let nextSkipSegments = state.skipSegments;
      let nextSkipSettings = state.skipSettings;
      let nextEngine = state.engineType;

      if (mode === 'replace') {
        if (configs.danmakuSettings) {
          nextSettings = { ...loadDanmakuSettings(), ...configs.danmakuSettings };
        }
        nextOffsets = configs.itemOffsets ?? {};
        nextBindings = configs.danmakuBindings ?? {};
        nextLayouts = configs.videoLayouts ?? {};
        nextSkipSegments = configs.skipSegments ?? {};
        nextSkipSettings = configs.skipSettings
          ? { ...DEFAULT_SKIP_SETTINGS, ...configs.skipSettings }
          : { ...DEFAULT_SKIP_SETTINGS };
        if (configs.engineType) {
          nextEngine = configs.engineType;
        }
      } else {
        // merge mode
        if (configs.danmakuSettings) {
          const mergedBlockedWords = Array.from(
            new Set([
              ...(state.danmakuSettings.blockedWords || []),
              ...(configs.danmakuSettings.blockedWords || []),
            ])
          );
          nextSettings = {
            ...state.danmakuSettings,
            ...configs.danmakuSettings,
            blockedWords: mergedBlockedWords,
          };
        }

        if (configs.itemOffsets) {
          nextOffsets = { ...state.itemOffsets, ...configs.itemOffsets };
        }

        if (configs.danmakuBindings) {
          nextBindings = { ...state.danmakuBindings };
          Object.entries(configs.danmakuBindings).forEach(([itemId, binding]) => {
            const existing = nextBindings[itemId];
            if (!existing || (binding.boundAt || 0) >= (existing.boundAt || 0)) {
              nextBindings[itemId] = binding;
            }
          });
        }

        if (configs.videoLayouts) {
          nextLayouts = { ...state.videoLayouts, ...configs.videoLayouts };
        }

        if (configs.skipSegments) {
          nextSkipSegments = { ...state.skipSegments };
          Object.entries(configs.skipSegments).forEach(([key, segments]) => {
            const existing = nextSkipSegments[key];
            if (!existing || (segments.updatedAt || 0) >= (existing.updatedAt || 0)) {
              nextSkipSegments[key] = segments;
            }
          });
        }

        if (configs.skipSettings) {
          nextSkipSettings = { ...state.skipSettings, ...configs.skipSettings };
        }

        if (configs.engineType) {
          nextEngine = configs.engineType;
        }
      }

      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
        localStorage.setItem(OFFSETS_KEY, JSON.stringify(nextOffsets));
        localStorage.setItem(BINDINGS_KEY, JSON.stringify(nextBindings));
        localStorage.setItem(VIDEO_LAYOUTS_KEY, JSON.stringify(nextLayouts));
        localStorage.setItem(SKIP_SEGMENTS_KEY, JSON.stringify(nextSkipSegments));
        localStorage.setItem(SKIP_SETTINGS_KEY, JSON.stringify(nextSkipSettings));
        localStorage.setItem(ENGINE_TYPE_KEY, nextEngine);
      } catch (e) {
        console.error('Failed to save imported player configs:', e);
      }

      return {
        danmakuSettings: nextSettings,
        itemOffsets: nextOffsets,
        danmakuBindings: nextBindings,
        videoLayouts: nextLayouts,
        skipSegments: nextSkipSegments,
        skipSettings: nextSkipSettings,
        engineType: nextEngine,
      };
    });
  },
}));
