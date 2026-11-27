import type { EmbyChapter, EmbyItem, EmbyMediaSource, MappedTrack } from '../api/embyClient';
import type { FormattedDanmakuItem, RawDanmuComment } from '../api/danmuClient';
import type { ProxyConfig } from '../api/http';
import type { DanmuServerEntry } from '../stores/useDanmuStore';
import type { PlayerOverlayStorePatch, SkipSegments } from '../stores/usePlayerStore';
import type { ResolvedTheme } from '../stores/useThemeStore';
import type {
  NextEpisodePreloadStatus,
  PlayerTelemetry,
  ResolvedStreamProxyInfo,
  StreamProxyOverride,
} from './types';
import type { MiniHudIconType } from '../components/player/MiniActionHud';

export const OSD_OVERLAY_SYNC_EVENT = 'osd:sync';
export const OSD_OVERLAY_COMMENTS_EVENT = 'osd:comments';
export const OSD_OVERLAY_RAW_COMMENTS_EVENT = 'osd:raw-comments';
export const OSD_OVERLAY_READY_EVENT = 'osd:ready';
export const OSD_OVERLAY_COMMAND_EVENT = 'osd:command';

export interface OsdDanmakuStyle {
  speed: number;
  opacity: number;
  area: number;
  maxLines: number;
  bottomMargin: number;
}

export interface OsdMiniHudPayload {
  id: number;
  icon: MiniHudIconType;
  label: string;
  subLabel?: string;
  progress?: number;
  progressWarn?: boolean;
}

export type OverlayStoreSnapshot = Required<PlayerOverlayStorePatch> & {
  revision: number;
};

export interface OsdSyncPayload {
  title: string;
  subtitle?: string;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  networkSpeed: number;
  engineType?: 'mpv' | 'html5';
  videoSpecLabel?: string;
  telemetry?: PlayerTelemetry;
  proxyInfo?: ResolvedStreamProxyInfo | null;
  chapters?: EmbyChapter[];
  danmakuHeatmap?: number[];
  showHeatmap?: boolean;
  showRemainingTime?: boolean;
  abLoopA?: number | null;
  abLoopB?: number | null;
  longPressSpeed?: number;
  miniHud?: OsdMiniHudPayload | null;
  fastForwardRate?: number | null;
  centerIcon?: 'play' | 'pause' | null;
  danmakuVisible: boolean;
  danmakuCount: number;
  danmakuOffset: number;
  matchedTitle?: string;
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  selectedAudioId: string | null;
  selectedSubtitleId: string | null;
  selectedSecondarySubtitleId?: string | null;
  danmakuStyle: OsdDanmakuStyle;
  isLoading: boolean;
  isBuffering?: boolean;
  hasFirstFrame?: boolean;
  skipSegments?: SkipSegments | null;
  outroToast?: {
    visible: boolean;
    remainingMs: number;
    totalMs: number;
  };
  skipNotice?: string | null;
  skipOutroAction?: 'ask' | 'auto';
  // 全功能面板/右键菜单/追番同步字段（保证全屏态与窗口态 100% 一致）
  item?: EmbyItem | null;
  mediaSource?: EmbyMediaSource | null;
  availableMediaSources?: EmbyMediaSource[];
  streamUrl?: string | null;
  currentServerName?: string;
  currentServerUrl?: string;
  userAgent?: string;
  seasons?: EmbyItem[];
  selectedSeasonId?: string | null;
  episodes?: EmbyItem[];
  episodesLoading?: boolean;
  hasNextEpisode?: boolean;
  hasPrevEpisode?: boolean;
  nextEpisode?: EmbyItem | null;
  nextPreloadStatus?: NextEpisodePreloadStatus | null;
  showSkipIntro?: boolean;
  autoNextCountdown?: number | null;
  speedHistory?: number[];
  proxyOverride?: StreamProxyOverride;
  proxySummaryLabel?: string;
  layoutKey?: string;
  videoAspectRatio?: number;
  isWidescreen?: boolean;
  sourceDuration?: number;
  danmuToast?: string | null;
  durationAlert?: string | null;
  resolvedTheme?: ResolvedTheme;
  storeSnapshot?: OverlayStoreSnapshot;
}

export type OsdCommand =
  | { type: 'toggle-play' }
  | { type: 'seek'; seconds: number }
  | { type: 'seek-delta'; delta: number }
  | { type: 'volume'; volume: number }
  | { type: 'volume-delta'; delta: number }
  | { type: 'toggle-mute' }
  | { type: 'rate'; rate: number }
  | { type: 'rate-step'; direction: 'up' | 'down' | 'reset' }
  | { type: 'rate-temp'; rate: number | null }
  | { type: 'frame-step'; direction: 'forward' | 'backward' }
  | { type: 'toggle-danmaku' }
  | { type: 'danmaku-offset-delta'; delta: number }
  | { type: 'sub-delay-delta'; delta: number }
  | { type: 'toggle-fullscreen' }
  | { type: 'toggle-window-mode' }
  | { type: 'back' }
  | { type: 'home' }
  | { type: 'select-audio'; id: string | null }
  | { type: 'cycle-audio' }
  | { type: 'select-subtitle'; id: string | null }
  | { type: 'cycle-subtitle' }
  | { type: 'select-secondary-subtitle'; id: string | null }
  | { type: 'mark-intro-end'; seconds: number }
  | { type: 'mark-outro-start'; seconds: number }
  | { type: 'clear-skip'; field: 'introEnd' | 'outroStart' }
  | { type: 'skip-intro' }
  | { type: 'skip-outro' }
  | { type: 'cancel-outro' }
  | { type: 'screenshot' }
  | { type: 'toggle-remaining-time' }
  | { type: 'set-ab-loop'; point: 'a' | 'b' | 'clear' }
  | { type: 'sync-player-store'; patch: PlayerOverlayStorePatch }
  | { type: 'sync-danmu-store'; servers: DanmuServerEntry[]; activeServerId: string }
  | { type: 'sync-proxy-config'; config: ProxyConfig }
  | {
      type: 'comments-loaded';
      comments: RawDanmuComment[];
      sourceDuration?: number;
      meta?: { animeTitle: string; episodeTitle: string; episodeId: number | string };
    }
  | { type: 're-auto-match' }
  | { type: 'dismiss-duration-alert' }
  | { type: 'select-season'; seasonId: string }
  | { type: 'select-episode'; episodeId: string }
  | { type: 'next-episode' }
  | { type: 'prev-episode' }
  | { type: 'cancel-auto-next' }
  | { type: 'select-media-source'; mediaSourceId: string }
  | { type: 'change-proxy-override'; mode: StreamProxyOverride }
  | { type: 'reload-stream' }
  | { type: 'toggle-bottom-align' }
  | { type: 'cycle-aspect' };

export type OsdCommentsPayload = FormattedDanmakuItem[];
export type OsdRawCommentsPayload = RawDanmuComment[];
