import { MappedTrack } from '../api/embyClient';
import { FormattedDanmakuItem } from '../api/danmuClient';
import { SkipSegments } from '../stores/usePlayerStore';

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

export interface OsdSyncPayload {
  title: string;
  subtitle?: string;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  networkSpeed: number;
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
  | { type: 'volume'; volume: number }
  | { type: 'rate'; rate: number }
  | { type: 'toggle-danmaku' }
  | { type: 'toggle-fullscreen' }
  | { type: 'back' }
  | { type: 'home' }
  | { type: 'select-audio'; id: string | null }
  | { type: 'select-subtitle'; id: string | null }
  | { type: 'mark-intro-end'; seconds: number }
  | { type: 'mark-outro-start'; seconds: number }
  | { type: 'clear-skip'; field: 'introEnd' | 'outroStart' }
  | { type: 'skip-outro' }
  | { type: 'cancel-outro' };

export type OsdCommentsPayload = FormattedDanmakuItem[];
