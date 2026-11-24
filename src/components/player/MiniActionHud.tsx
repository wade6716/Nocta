import React from 'react';
import {
  Volume2,
  VolumeX,
  FastForward,
  Rewind,
  Gauge,
  MessageSquare,
  Subtitles,
  Pin,
  Camera,
  Repeat,
  Info,
  FolderOpen,
  Headphones,
} from 'lucide-react';

export type MiniHudIconType =
  | 'volume'
  | 'mute'
  | 'seek-forward'
  | 'seek-backward'
  | 'speed'
  | 'danmaku'
  | 'subtitle'
  | 'pin'
  | 'screenshot'
  | 'loop'
  | 'headphones'
  | 'info';

export interface MiniHudState {
  id: number;
  icon: MiniHudIconType;
  label: string;
  subLabel?: string;
  progress?: number; // 0 ~ 100
  progressWarn?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

interface MiniActionHudProps {
  hud: MiniHudState | null;
  fastForwardRate: number | null;
}

function renderIcon(icon: MiniHudIconType, progressWarn?: boolean) {
  const cls = `w-4 h-4 shrink-0 ${progressWarn ? 'text-amber-400' : 'text-sky-400'}`;
  switch (icon) {
    case 'volume':
      return <Volume2 className={cls} />;
    case 'mute':
      return <VolumeX className="w-4 h-4 shrink-0 text-rose-400" />;
    case 'seek-forward':
      return <FastForward className={cls} />;
    case 'seek-backward':
      return <Rewind className={cls} />;
    case 'speed':
      return <Gauge className={cls} />;
    case 'danmaku':
      return <MessageSquare className={cls} />;
    case 'subtitle':
      return <Subtitles className={cls} />;
    case 'pin':
      return <Pin className={cls} />;
    case 'screenshot':
      return <Camera className={cls} />;
    case 'loop':
      return <Repeat className={cls} />;
    case 'headphones':
      return <Headphones className={cls} />;
    case 'info':
    default:
      return <Info className={cls} />;
  }
}

export const MiniActionHud: React.FC<MiniActionHudProps> = ({ hud, fastForwardRate }) => {
  return (
    <>
      {/* 顶部居中：长按 → 临时倍速快进常驻动效胶囊 */}
      {fastForwardRate !== null && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-[#0B0E17]/95 backdrop-blur-2xl border border-sky-400/40 text-xs font-semibold text-white">
            <FastForward className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
            <span className="font-mono tabular-nums text-sky-300 font-bold">
              {fastForwardRate}x
            </span>
            <span className="text-slate-200">倍速快进中</span>
          </div>
        </div>
      )}

      {/* 屏幕中上方：无打扰轻量交互反馈胶囊 */}
      {hud && (
        <div
          key={hud.id}
          className="fixed top-[20%] left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="min-w-[180px] max-w-sm px-4 py-2.5 rounded-2xl bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 flex flex-col space-y-2">
            <div className="flex items-center justify-between space-x-3">
              <div className="flex items-center space-x-2.5 min-w-0">
                {renderIcon(hud.icon, hud.progressWarn)}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white font-mono tabular-nums truncate">
                    {hud.label}
                  </div>
                  {hud.subLabel && (
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {hud.subLabel}
                    </div>
                  )}
                </div>
              </div>

              {hud.actionLabel && hud.onAction && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    hud.onAction?.();
                  }}
                  className="pointer-events-auto shrink-0 px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/35 text-sky-300 text-[11px] font-medium transition flex items-center space-x-1 cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>{hud.actionLabel}</span>
                </button>
              )}
            </div>

            {hud.progress !== undefined && (
              <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    hud.progressWarn
                      ? 'bg-gradient-to-r from-sky-400 to-amber-400'
                      : 'bg-sky-400'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, hud.progress))}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default MiniActionHud;
