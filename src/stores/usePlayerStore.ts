import { create } from 'zustand';
import { EmbyItem, EmbyMediaSource, MappedTrack } from '../api/embyClient';
import { HwdecMode, ToneMappingMode, VideoAspectPreset } from '../player/types';

export type DanmakuColorMode = 'vibrant' | 'monochrome' | 'blocked';

export interface DanmakuSettings {
  visible: boolean;
  opacity: number;
  area: number;
  maxLines: number; // 0 为不限行数，3, 5, 8 等为限制行数
  speed: number;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  strokeWidth: number;
  bottomMargin: number; // 底部避让字幕距离，默认 48
  colorMode: DanmakuColorMode; // 'vibrant' 彩色原色 | 'monochrome' 统一纯白 | 'blocked' 屏蔽彩色
  blockScroll: boolean;
  blockTop: boolean;
  blockBottom: boolean;
  blockColor: boolean; // 兼容旧字段
  blockedWords: string[];
  mergeDuplicates: boolean; // 3 秒滑动窗口重复弹幕合并防刷屏
  showHeatmap: boolean; // 进度条高能弹幕密度曲线
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

export interface SeriesDanmakuBinding {
  seriesId: string;
  animeId: string | number;
  animeTitle: string;
  episodes: Array<{
    episodeId: number | string;
    episodeTitle: string;
    episodeNumber?: string | number;
  }>;
  boundAt: number;
}

export interface VideoLayoutConfig {
  bottomAlign: boolean; // 是否开启贴底模式
  verticalOffset: number; // 垂直位置百分比: 50(居中) ~ 100(完全贴底)，默认 100
}

export interface ColorAdjustConfig {
  brightness: number; // -50 ~ 50
  contrast: number; // -50 ~ 50
  saturation: number; // -50 ~ 50
  gamma: number; // -50 ~ 50
}

export interface PlayerPreferences {
  hwdecMode: HwdecMode;
  toneMapping: ToneMappingMode;
  deband: boolean;
  videoAspect: VideoAspectPreset;
  colorAdjust: ColorAdjustConfig;
  audioDelay: number; // 秒 (-5 ~ +5)
  nightMode: boolean; // 夜间动态人声均衡
  subDelay: number; // 秒
  subScale: number; // 0.6 ~ 1.8
  subPos: number; // 50 ~ 100
  autoPlayNext: boolean; // 自动连播下一集
  longPressSpeed: 2.0 | 2.5 | 3.0; // 长按右方向键倍速
  skipIntroSeconds: number; // 快捷跳过片头秒数
  showRemainingTime: boolean; // 是否显示剩余时间
  preferredAudioLang?: string;
  preferredSubLang?: string;
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

export interface PlayerOverlayStorePatch {
  danmakuSettings?: DanmakuSettings;
  playerPreferences?: PlayerPreferences;
  videoLayouts?: Record<string, VideoLayoutConfig>;
  itemOffsets?: Record<string, number>;
  seriesOffsets?: Record<string, number>;
  danmakuBindings?: Record<string, DanmakuBinding>;
  seriesDanmakuBindings?: Record<string, SeriesDanmakuBinding>;
  skipSegments?: Record<string, SkipSegments>;
  skipSettings?: SkipSettings;
  engineType?: 'mpv' | 'html5';
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
  availableMediaSources: EmbyMediaSource[];
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
  selectedSecondarySubtitleId: string | null;

  // 弹幕设置与偏好
  danmakuSettings: DanmakuSettings;
  itemOffsets: Record<string, number>; // itemId -> offsetSeconds
  seriesOffsets: Record<string, number>; // seriesId -> offsetSeconds
  danmakuBindings: Record<string, DanmakuBinding>; // itemId -> DanmakuBinding
  seriesDanmakuBindings: Record<string, SeriesDanmakuBinding>; // seriesId -> SeriesDanmakuBinding
  videoLayouts: Record<string, VideoLayoutConfig>; // seriesId/itemId -> VideoLayoutConfig
  playerPreferences: PlayerPreferences;
  skipSegments: Record<string, SkipSegments>; // series_key/item_key -> SkipSegments
  skipSettings: SkipSettings;
  engineType: 'mpv' | 'html5';

  // Actions
  setPlaybackContext: (payload: {
    item: EmbyItem;
    mediaSource: EmbyMediaSource;
    availableMediaSources?: EmbyMediaSource[];
    playSessionId: string;
    streamUrl: string;
    audioTracks: MappedTrack[];
    subtitleTracks: MappedTrack[];
    initialTime?: number;
  }) => void;
  updateTracks: (audioTracks: MappedTrack[], subtitleTracks: MappedTrack[]) => void;
  updateTime: (currentTime: number, duration?: number) => void;
  setPaused: (paused: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (vol: number) => void;
  selectAudioTrack: (id: string | null) => void;
  selectSubtitleTrack: (id: string | null) => void;
  selectSecondarySubtitleTrack: (id: string | null) => void;
  updateDanmakuSettings: (settings: Partial<DanmakuSettings>) => void;
  setItemOffset: (itemId: string, offset: number) => void;
  setSeriesOffset: (seriesId: string, offset: number) => void;
  bindDanmaku: (itemId: string, binding: Omit<DanmakuBinding, 'boundAt'>) => void;
  unbindDanmaku: (itemId: string) => void;
  bindSeriesDanmaku: (seriesId: string, binding: Omit<SeriesDanmakuBinding, 'boundAt'>) => void;
  setVideoLayout: (key: string, config: Partial<VideoLayoutConfig>) => void;
  resetVideoLayout: (key: string) => void;
  updatePlayerPreferences: (prefs: Partial<PlayerPreferences>) => void;
  resetVideoEnhancements: () => void;
  setSkipSegment: (
    key: string,
    patch: { itemId?: string; introEnd?: number; outroStart?: number }
  ) => void;
  clearSkipSegment: (key: string, field: 'introEnd' | 'outroStart') => void;
  updateSkipSettings: (settings: Partial<SkipSettings>) => void;
  setEngineType: (type: 'mpv' | 'html5') => void;
  applyRemoteStoreSnapshot: (patch: PlayerOverlayStorePatch, persist?: boolean) => void;
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
const SERIES_OFFSETS_KEY = 'nocta_series_danmaku_offsets';
const BINDINGS_KEY = 'emby_danmaku_bindings';
const SERIES_BINDINGS_KEY = 'nocta_series_danmaku_bindings';
const VIDEO_LAYOUTS_KEY = 'emby_video_layout_configs';
const SKIP_SEGMENTS_KEY = 'nocta_skip_segments';
const SKIP_SETTINGS_KEY = 'nocta_skip_settings';
const ENGINE_TYPE_KEY = 'emby_player_engine_type';
const VOLUME_KEY = 'nocta_player_volume';
const PREFERENCES_KEY = 'nocta_player_preferences';

const DEFAULT_COLOR_ADJUST: ColorAdjustConfig = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
};

const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  hwdecMode: 'auto-safe',
  toneMapping: 'auto',
  deband: false,
  videoAspect: 'auto',
  colorAdjust: { ...DEFAULT_COLOR_ADJUST },
  audioDelay: 0,
  nightMode: false,
  subDelay: 0,
  subScale: 1.0,
  subPos: 100,
  autoPlayNext: true,
  longPressSpeed: 2.5,
  skipIntroSeconds: 85,
  showRemainingTime: false,
};

function loadEngineType(): 'mpv' | 'html5' {
  try {
    const raw = localStorage.getItem(ENGINE_TYPE_KEY);
    return raw === 'html5' ? 'html5' : 'mpv';
  } catch {
    return 'mpv';
  }
}

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 100;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(200, parsed)) : 100;
  } catch {
    return 100;
  }
}

function loadPlayerPreferences(): PlayerPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_PLAYER_PREFERENCES,
      ...parsed,
      colorAdjust: {
        ...DEFAULT_COLOR_ADJUST,
        ...(parsed.colorAdjust || {}),
      },
    };
  } catch {
    return { ...DEFAULT_PLAYER_PREFERENCES, colorAdjust: { ...DEFAULT_COLOR_ADJUST } };
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
      fontWeight: parsed.fontWeight ?? 'bold',
      strokeWidth: parsed.strokeWidth ?? 2.5,
      bottomMargin: parsed.bottomMargin ?? 48,
      colorMode: parsed.colorMode ?? (parsed.blockColor ? 'blocked' : 'vibrant'),
      blockScroll: parsed.blockScroll ?? false,
      blockTop: parsed.blockTop ?? false,
      blockBottom: parsed.blockBottom ?? false,
      blockColor: parsed.blockColor ?? false,
      blockedWords: parsed.blockedWords ?? [],
      mergeDuplicates: parsed.mergeDuplicates ?? true,
      showHeatmap: parsed.showHeatmap ?? true,
    };
  } catch {
    return {
      visible: true,
      opacity: 0.85,
      area: 0.75,
      maxLines: 0,
      speed: 144,
      fontSize: 24,
      fontWeight: 'bold',
      strokeWidth: 2.5,
      bottomMargin: 48,
      colorMode: 'vibrant',
      blockScroll: false,
      blockTop: false,
      blockBottom: false,
      blockColor: false,
      blockedWords: [],
      mergeDuplicates: true,
      showHeatmap: true,
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

function loadSeriesOffsets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SERIES_OFFSETS_KEY);
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

function loadSeriesBindings(): Record<string, SeriesDanmakuBinding> {
  try {
    const raw = localStorage.getItem(SERIES_BINDINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const pendingStorageWrites = new Map<string, { value: string; timer: number }>();

function writeStorageRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.error(e);
  }
}

function saveStorageDebounced(key: string, value: unknown, delayMs = 200): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof window === 'undefined') {
    writeStorageRaw(key, serialized);
    return;
  }
  const prev = pendingStorageWrites.get(key);
  if (prev) {
    window.clearTimeout(prev.timer);
  }
  const timer = window.setTimeout(() => {
    pendingStorageWrites.delete(key);
    writeStorageRaw(key, serialized);
  }, delayMs);
  pendingStorageWrites.set(key, { value: serialized, timer });
}

function saveStorageImmediate(key: string, value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof window !== 'undefined') {
    const prev = pendingStorageWrites.get(key);
    if (prev) {
      window.clearTimeout(prev.timer);
      pendingStorageWrites.delete(key);
    }
  }
  writeStorageRaw(key, serialized);
}

function flushPendingStorageWrites(): void {
  pendingStorageWrites.forEach(({ value, timer }, key) => {
    if (typeof window !== 'undefined') {
      window.clearTimeout(timer);
    }
    writeStorageRaw(key, value);
  });
  pendingStorageWrites.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingStorageWrites);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  item: null,
  mediaSource: null,
  availableMediaSources: [],
  playSessionId: null,
  streamUrl: null,

  currentTime: 0,
  initialTime: 0,
  duration: 0,
  paused: true,
  buffering: false,
  playbackRate: 1.0,
  volume: loadVolume(),

  audioTracks: [],
  subtitleTracks: [],
  selectedAudioId: null,
  selectedSubtitleId: null,
  selectedSecondarySubtitleId: null,

  danmakuSettings: loadDanmakuSettings(),
  itemOffsets: loadOffsets(),
  seriesOffsets: loadSeriesOffsets(),
  danmakuBindings: loadBindings(),
  seriesDanmakuBindings: loadSeriesBindings(),
  videoLayouts: loadVideoLayouts(),
  playerPreferences: loadPlayerPreferences(),
  skipSegments: loadSkipSegments(),
  skipSettings: loadSkipSettings(),
  engineType: loadEngineType(),

  setPlaybackContext: (payload) => {
    const prefs = get().playerPreferences;
    // 优先匹配用户偏好语言音轨，其次默认音轨，最后首条音轨
    const preferredAudio = prefs.preferredAudioLang
      ? payload.audioTracks.find(
          (t) => t.language && t.language.toLowerCase() === prefs.preferredAudioLang?.toLowerCase()
        )
      : undefined;
    const defaultAudio =
      preferredAudio?.id ||
      payload.audioTracks.find((t) => t.isDefault)?.id ||
      payload.audioTracks[0]?.id ||
      null;

    const preferredSub = prefs.preferredSubLang
      ? payload.subtitleTracks.find(
          (t) => t.language && t.language.toLowerCase() === prefs.preferredSubLang?.toLowerCase()
        )
      : undefined;
    const defaultSub =
      preferredSub?.id || payload.subtitleTracks.find((t) => t.isDefault)?.id || null;

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
      availableMediaSources:
        payload.availableMediaSources && payload.availableMediaSources.length > 0
          ? payload.availableMediaSources
          : payload.mediaSource
          ? [payload.mediaSource]
          : [],
      playSessionId: payload.playSessionId,
      streamUrl: payload.streamUrl,
      audioTracks: payload.audioTracks,
      subtitleTracks: payload.subtitleTracks,
      selectedAudioId: defaultAudio,
      selectedSubtitleId: defaultSub,
      selectedSecondarySubtitleId: null,
      currentTime: safeInitialTime,
      initialTime: safeInitialTime,
      paused: false,
      buffering: false,
    });
  },

  updateTracks: (audioTracks, subtitleTracks) => {
    set((state) => {
      // 保留 Emby 已有外挂字幕 URL（如引擎仅上报内封轨道时合并保留）
      const existingExternalSubs = state.subtitleTracks.filter((t) => t.isExternal);
      const mergedSubs = [...subtitleTracks];
      for (const ext of existingExternalSubs) {
        if (!mergedSubs.some((s) => s.title === ext.title && s.isExternal)) {
          mergedSubs.push(ext);
        }
      }

      const finalAudio = audioTracks.length > 0 ? audioTracks : state.audioTracks;
      const finalSubs = mergedSubs.length > 0 ? mergedSubs : state.subtitleTracks;

      const selectedAudioId =
        state.selectedAudioId && finalAudio.some((t) => t.id === state.selectedAudioId)
          ? state.selectedAudioId
          : finalAudio.find((t) => t.isDefault)?.id || finalAudio[0]?.id || null;

      const selectedSubtitleId =
        state.selectedSubtitleId && finalSubs.some((t) => t.id === state.selectedSubtitleId)
          ? state.selectedSubtitleId
          : state.selectedSubtitleId;

      return {
        audioTracks: finalAudio,
        subtitleTracks: finalSubs,
        selectedAudioId,
        selectedSubtitleId,
      };
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
  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    saveStorageDebounced(VOLUME_KEY, String(clamped));
    set({ volume: clamped });
  },

  selectAudioTrack: (id) => set({ selectedAudioId: id }),
  selectSubtitleTrack: (id) => set({ selectedSubtitleId: id }),
  selectSecondarySubtitleTrack: (id) => set({ selectedSecondarySubtitleId: id }),

  updateDanmakuSettings: (newSettings) => {
    set((state) => {
      const updated = { ...state.danmakuSettings, ...newSettings };
      saveStorageDebounced(SETTINGS_KEY, updated);
      return { danmakuSettings: updated };
    });
  },

  setItemOffset: (itemId, offset) => {
    set((state) => {
      const updated = { ...state.itemOffsets, [itemId]: offset };
      saveStorageDebounced(OFFSETS_KEY, updated);
      return { itemOffsets: updated };
    });
  },

  setSeriesOffset: (seriesId, offset) => {
    set((state) => {
      const updated = { ...state.seriesOffsets, [seriesId]: offset };
      saveStorageDebounced(SERIES_OFFSETS_KEY, updated);
      return { seriesOffsets: updated };
    });
  },

  bindDanmaku: (itemId, binding) => {
    set((state) => {
      const fullBinding: DanmakuBinding = {
        ...binding,
        boundAt: Date.now(),
      };
      const updated = { ...state.danmakuBindings, [itemId]: fullBinding };
      saveStorageImmediate(BINDINGS_KEY, updated);
      return { danmakuBindings: updated };
    });
  },

  unbindDanmaku: (itemId) => {
    set((state) => {
      const updated = { ...state.danmakuBindings };
      delete updated[itemId];
      saveStorageImmediate(BINDINGS_KEY, updated);
      return { danmakuBindings: updated };
    });
  },

  bindSeriesDanmaku: (seriesId, binding) => {
    set((state) => {
      const full: SeriesDanmakuBinding = {
        ...binding,
        boundAt: Date.now(),
      };
      const updated = { ...state.seriesDanmakuBindings, [seriesId]: full };
      saveStorageImmediate(SERIES_BINDINGS_KEY, updated);
      return { seriesDanmakuBindings: updated };
    });
  },

  setVideoLayout: (key, config) => {
    set((state) => {
      const prev = state.videoLayouts[key] || { bottomAlign: false, verticalOffset: 100 };
      const updated = {
        ...state.videoLayouts,
        [key]: { ...prev, ...config },
      };
      saveStorageDebounced(VIDEO_LAYOUTS_KEY, updated);
      return { videoLayouts: updated };
    });
  },

  resetVideoLayout: (key) => {
    set((state) => {
      const updated = { ...state.videoLayouts };
      delete updated[key];
      saveStorageDebounced(VIDEO_LAYOUTS_KEY, updated);
      return { videoLayouts: updated };
    });
  },

  updatePlayerPreferences: (prefs) => {
    set((state) => {
      const updated: PlayerPreferences = {
        ...state.playerPreferences,
        ...prefs,
        colorAdjust: prefs.colorAdjust
          ? { ...state.playerPreferences.colorAdjust, ...prefs.colorAdjust }
          : state.playerPreferences.colorAdjust,
      };
      saveStorageDebounced(PREFERENCES_KEY, updated);
      return { playerPreferences: updated };
    });
  },

  resetVideoEnhancements: () => {
    set((state) => {
      const updated: PlayerPreferences = {
        ...state.playerPreferences,
        toneMapping: 'auto',
        deband: false,
        videoAspect: 'auto',
        colorAdjust: { ...DEFAULT_COLOR_ADJUST },
      };
      saveStorageDebounced(PREFERENCES_KEY, updated);
      return { playerPreferences: updated };
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
      saveStorageDebounced(SKIP_SEGMENTS_KEY, updated);
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

      saveStorageDebounced(SKIP_SEGMENTS_KEY, updated);
      return { skipSegments: updated };
    });
  },

  updateSkipSettings: (settings) => {
    set((state) => {
      const updated = { ...state.skipSettings, ...settings };
      saveStorageDebounced(SKIP_SETTINGS_KEY, updated);
      return { skipSettings: updated };
    });
  },

  setEngineType: (type) => {
    saveStorageImmediate(ENGINE_TYPE_KEY, type);
    set({ engineType: type });
  },

  resetPlayer: () => {
    set({
      item: null,
      mediaSource: null,
      availableMediaSources: [],
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
      selectedSecondarySubtitleId: null,
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

      saveStorageImmediate(SETTINGS_KEY, nextSettings);
      saveStorageImmediate(OFFSETS_KEY, nextOffsets);
      saveStorageImmediate(BINDINGS_KEY, nextBindings);
      saveStorageImmediate(VIDEO_LAYOUTS_KEY, nextLayouts);
      saveStorageImmediate(SKIP_SEGMENTS_KEY, nextSkipSegments);
      saveStorageImmediate(SKIP_SETTINGS_KEY, nextSkipSettings);
      saveStorageImmediate(ENGINE_TYPE_KEY, nextEngine);

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

  applyRemoteStoreSnapshot: (patch, shouldPersist = false) => {
    set((state) => {
      const next: Partial<PlayerState> = {};

      if (patch.danmakuSettings !== undefined) {
        next.danmakuSettings = patch.danmakuSettings;
        if (shouldPersist) saveStorageDebounced(SETTINGS_KEY, patch.danmakuSettings);
      }
      if (patch.playerPreferences !== undefined) {
        next.playerPreferences = patch.playerPreferences;
        if (shouldPersist) saveStorageDebounced(PREFERENCES_KEY, patch.playerPreferences);
      }
      if (patch.videoLayouts !== undefined) {
        next.videoLayouts = patch.videoLayouts;
        if (shouldPersist) saveStorageDebounced(VIDEO_LAYOUTS_KEY, patch.videoLayouts);
      }
      if (patch.itemOffsets !== undefined) {
        next.itemOffsets = patch.itemOffsets;
        if (shouldPersist) saveStorageDebounced(OFFSETS_KEY, patch.itemOffsets);
      }
      if (patch.seriesOffsets !== undefined) {
        next.seriesOffsets = patch.seriesOffsets;
        if (shouldPersist) saveStorageDebounced(SERIES_OFFSETS_KEY, patch.seriesOffsets);
      }
      if (patch.danmakuBindings !== undefined) {
        next.danmakuBindings = patch.danmakuBindings;
        if (shouldPersist) saveStorageImmediate(BINDINGS_KEY, patch.danmakuBindings);
      }
      if (patch.seriesDanmakuBindings !== undefined) {
        next.seriesDanmakuBindings = patch.seriesDanmakuBindings;
        if (shouldPersist) saveStorageImmediate(SERIES_BINDINGS_KEY, patch.seriesDanmakuBindings);
      }
      if (patch.skipSegments !== undefined) {
        next.skipSegments = patch.skipSegments;
        if (shouldPersist) saveStorageDebounced(SKIP_SEGMENTS_KEY, patch.skipSegments);
      }
      if (patch.skipSettings !== undefined) {
        next.skipSettings = patch.skipSettings;
        if (shouldPersist) saveStorageDebounced(SKIP_SETTINGS_KEY, patch.skipSettings);
      }
      if (patch.engineType !== undefined) {
        next.engineType = patch.engineType;
        if (shouldPersist) saveStorageImmediate(ENGINE_TYPE_KEY, patch.engineType);
      }

      return Object.keys(next).length > 0 ? next : state;
    });
  },
}));
