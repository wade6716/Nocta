import type { EmbyChapter, MappedTrack } from '../api/embyClient';
import type { FormattedDanmakuItem } from '../api/danmuClient';
import type { SkipSegments } from '../stores/usePlayerStore';
import type { PlayerTelemetry, ResolvedStreamProxyInfo } from './types';
import type { MiniHudIconType } from '../components/player/MiniActionHud';

export const OSD_OVERLAY_SYNC_EVENT = 'osd:sync';
export const OSD_OVERLAY_COMMENTS_EVENT = 'osd:comments';
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
  danmakuVisible: boolean;
  danmakuCount: number;
  danmakuOffset: number;
  matchedTitle?: string;
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  selectedAudioId: string | null;
  selectedSubtitleId: string | null;
  danmakuStyle: OsdDanmakuStyle;
  isLoading: boolean;
  skipSegments?: SkipSegments | null;
  outroToast?: {
    visible: boolean;
    remainingMs: number;
    totalMs: number;
  };
  skipNotice?: string | null;
  skipOutroAction?: 'ask' | 'auto';
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
  | { type: 'back' }
  | { type: 'home' }
  | { type: 'select-audio'; id: string | null }
  | { type: 'cycle-audio' }
  | { type: 'select-subtitle'; id: string | null }
  | { type: 'cycle-subtitle' }
  | { type: 'mark-intro-end'; seconds: number }
  | { type: 'mark-outro-start'; seconds: number }
  | { type: 'clear-skip'; field: 'introEnd' | 'outroStart' }
  | { type: 'skip-intro' }
  | { type: 'skip-outro' }
  | { type: 'cancel-outro' }
  | { type: 'screenshot' }
  | { type: 'toggle-remaining-time' };

export type OsdCommentsPayload = FormattedDanmakuItem[];
