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
  setEngineType: (type: 'mpv' | 'html5') => void;
  resetPlayer: () => void;
}

const SETTINGS_KEY = 'emby_danmaku_settings';
const OFFSETS_KEY = 'emby_danmaku_offsets';
const BINDINGS_KEY = 'emby_danmaku_bindings';
const VIDEO_LAYOUTS_KEY = 'emby_video_layout_configs';
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
  engineType: loadEngineType(),

  setPlaybackContext: (payload) => {
    const defaultAudio =
      payload.audioTracks.find((t) => t.isDefault)?.id || payload.audioTracks[0]?.id || null;
    const defaultSub = payload.subtitleTracks.find((t) => t.isDefault)?.id || null;

    set({
      item: payload.item,
      mediaSource: payload.mediaSource,
      playSessionId: payload.playSessionId,
      streamUrl: payload.streamUrl,
      audioTracks: payload.audioTracks,
      subtitleTracks: payload.subtitleTracks,
      selectedAudioId: defaultAudio,
      selectedSubtitleId: defaultSub,
      currentTime: payload.initialTime || 0,
      initialTime: payload.initialTime || 0,
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
}));
