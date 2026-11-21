import type { PreloadTriggerMode } from '../stores/usePlayerStore';
import type { NextEpisodePreloadStatus } from './types';

export const BUFFER_DURATION_PRESETS_SEC = [60, 180, 300, 600, 900] as const;

export const MEMORY_CAP_PRESETS_MB = [
  { mb: 256, label: '256M' },
  { mb: 512, label: '512M' },
  { mb: 1024, label: '1G' },
  { mb: 1536, label: '1.5G' },
  { mb: 2048, label: '2G' },
] as const;

export const PRELOAD_TRIGGER_MODE_OPTIONS: Array<{
  id: PreloadTriggerMode;
  label: string;
  shortLabel: string;
  desc: string;
}> = [
  {
    id: 'smart',
    label: '智能综合 (推荐)',
    shortLabel: '智能',
    desc: '稳定播放后，满足缓冲达标、临近片尾或进度阈值任一条件即静默触发',
  },
  {
    id: 'buffer_ready',
    label: '缓冲达标后',
    shortLabel: '缓冲达标',
    desc: '优先保证当前集前向缓冲达到设定时长后再下载下一集，不抢首帧带宽',
  },
  {
    id: 'remaining_time',
    label: '临近片尾剩余时间',
    shortLabel: '临近片尾',
    desc: '仅当距离本集结束不足指定分钟数时才开始内存预加载',
  },
  {
    id: 'progress',
    label: '按本集播放进度',
    shortLabel: '按进度',
    desc: '本集观看进度达到指定百分比后启动下一集内存预加载',
  },
];

export const TRIGGER_BUFFER_PRESETS_SEC = [15, 30, 60, 120] as const;
export const TRIGGER_REMAINING_PRESETS_SEC = [60, 180, 300, 600] as const;
export const TRIGGER_PROGRESS_PRESETS_PCT = [30, 50, 60, 80] as const;

export function formatMinutesLabel(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return `${Math.max(1, mins)} 分钟`;
}

export function formatShortMinutesLabel(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return `${Math.max(1, mins)}分`;
}

export function formatMemoryCapLabel(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb}G` : `${gb.toFixed(1)}G`;
  }
  return `${mb}M`;
}

export function formatPreloadDurationMMSS(seconds?: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '00:00';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatPreloadStateText(status?: NextEpisodePreloadStatus | null): string {
  if (!status) return '等待触发条件';
  switch (status.status) {
    case 'probing':
      return '正在探测直链...';
    case 'downloading':
      return '正在写入内存...';
    case 'ready':
      return '已就绪 (内存驻留)';
    case 'active':
      return '播放命中';
    case 'released':
      return '已自动释放内存';
    case 'error':
      return status.error || '预加载失败';
    case 'cancelled':
      return '已取消';
    default:
      return '等待触发';
  }
}
