import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  FastForward,
  Gauge,
  MessageSquare,
  MessageSquareOff,
  ArrowDownToLine,
  Maximize2,
  Sliders,
  Sparkles,
  Globe,
  ListVideo,
  Pin,
  Camera,
  Info,
  HelpCircle,
} from 'lucide-react';
import { VideoAspectPreset } from '../../player/types';

interface PlayerContextMenuProps {
  x: number;
  y: number;
  visible: boolean;
  onClose: () => void;
  paused: boolean;
  hasNextEpisode: boolean;
  hasPrevEpisode: boolean;
  playbackRate: number;
  danmakuVisible: boolean;
  isPinned: boolean;
  isBottomAlign: boolean;
  videoAspect: VideoAspectPreset;
  proxySummary: string;
  showEpisodesEntry: boolean;
  onTogglePlay: () => void;
  onNextEpisode: () => void;
  onPrevEpisode: () => void;
  onSkipIntro: () => void;
  onRateChange: (rate: number) => void;
  onToggleDanmaku: () => void;
  onToggleBottomAlign: () => void;
  onCycleAspect: () => void;
  onOpenDanmakuDrawer: () => void;
  onOpenVideoPro: () => void;
  onOpenNetworkPopover: () => void;
  onOpenEpisodeDrawer: () => void;
  onTogglePin?: () => void;
  onTakeScreenshot: () => void;
  onOpenPlaybackInfo: () => void;
  onOpenShortcuts: () => void;
}

export const PlayerContextMenu: React.FC<PlayerContextMenuProps> = ({
  x,
  y,
  visible,
  onClose,
  paused,
  hasNextEpisode,
  hasPrevEpisode,
  playbackRate,
  danmakuVisible,
  isPinned,
  isBottomAlign,
  videoAspect,
  proxySummary,
  showEpisodesEntry,
  onTogglePlay,
  onNextEpisode,
  onPrevEpisode,
  onSkipIntro,
  onRateChange,
  onToggleDanmaku,
  onToggleBottomAlign,
  onCycleAspect,
  onOpenDanmakuDrawer,
  onOpenVideoPro,
  onOpenNetworkPopover,
  onOpenEpisodeDrawer,
  onTogglePin,
  onTakeScreenshot,
  onOpenPlaybackInfo,
  onOpenShortcuts,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [visible, onClose]);

  if (!visible) return null;

  const menuWidth = 252;
  const menuHeight = 470;
  const left = Math.min(x, Math.max(8, window.innerWidth - menuWidth - 12));
  const top = Math.min(y, Math.max(8, window.innerHeight - menuHeight - 12));

  const quickRates = [0.75, 1.0, 1.25, 1.5, 2.0];

  const runAndClose = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left, top, width: menuWidth }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="fixed z-50 rounded-2xl bg-[#0B0E17]/92 backdrop-blur-2xl border border-white/[0.14] shadow-[0_24px_60px_rgba(0,0,0,0.8)] p-1.5 text-xs text-slate-200 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {/* 播放与连播 */}
      <button
        onClick={() => runAndClose(onTogglePlay)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          {paused ? <Play className="w-3.5 h-3.5 text-sky-400" /> : <Pause className="w-3.5 h-3.5 text-sky-400" />}
          <span>{paused ? '继续播放' : '暂停播放'}</span>
        </span>
        <kbd className="text-[10px] font-mono text-slate-400">Space</kbd>
      </button>

      {(hasPrevEpisode || hasNextEpisode) && (
        <div className="grid grid-cols-2 gap-1 px-1 py-0.5">
          <button
            disabled={!hasPrevEpisode}
            onClick={() => runAndClose(onPrevEpisode)}
            className="flex items-center justify-center space-x-1.5 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
            <span>上一集</span>
          </button>
          <button
            disabled={!hasNextEpisode}
            onClick={() => runAndClose(onNextEpisode)}
            className="flex items-center justify-center space-x-1.5 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span>下一集</span>
          </button>
        </div>
      )}

      <button
        onClick={() => runAndClose(onSkipIntro)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <FastForward className="w-3.5 h-3.5 text-slate-400" />
          <span>快捷跳过片头</span>
        </span>
        <kbd className="text-[10px] font-mono text-slate-400">L</kbd>
      </button>

      {/* 倍速快选条 */}
      <div className="my-1 px-2 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
          <span className="flex items-center space-x-1.5">
            <Gauge className="w-3 h-3 text-sky-400" />
            <span>播放倍速</span>
          </span>
          <span className="font-mono text-sky-300 font-semibold">{playbackRate}x</span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {quickRates.map((r) => (
            <button
              key={r}
              onClick={() => runAndClose(() => onRateChange(r))}
              className={`py-1 rounded-md text-[11px] font-mono transition cursor-pointer ${
                playbackRate === r
                  ? 'bg-primary text-white font-bold'
                  : 'bg-white/5 hover:bg-white/15 text-slate-300'
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      <div className="my-1 border-t border-white/[0.08]" />

      {/* 弹幕 & 画面 */}
      <button
        onClick={() => runAndClose(onToggleDanmaku)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          {danmakuVisible ? (
            <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
          ) : (
            <MessageSquareOff className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span>{danmakuVisible ? '隐藏弹幕' : '显示弹幕'}</span>
        </span>
        <kbd className="text-[10px] font-mono text-slate-400">D</kbd>
      </button>

      <button
        onClick={() => runAndClose(onToggleBottomAlign)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <ArrowDownToLine className={`w-3.5 h-3.5 ${isBottomAlign ? 'text-sky-400' : 'text-slate-400'}`} />
          <span>宽银幕贴底 (顶部留黑)</span>
        </span>
        <span className={`text-[10px] font-mono ${isBottomAlign ? 'text-sky-400' : 'text-slate-500'}`}>
          {isBottomAlign ? '开' : '关'}
        </span>
      </button>

      <button
        onClick={() => runAndClose(onCycleAspect)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
          <span>切换画面比例</span>
        </span>
        <span className="text-[10px] font-mono text-sky-300">
          {videoAspect === 'auto' ? '原比例' : videoAspect === 'fill' ? '铺满' : videoAspect}
        </span>
      </button>

      <div className="my-1 border-t border-white/[0.08]" />

      {/* 面板入口 */}
      <button
        onClick={() => runAndClose(onOpenDanmakuDrawer)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <Sliders className="w-3.5 h-3.5 text-primary" />
          <span>弹幕控制中心</span>
        </span>
        <span className="text-[10px] text-slate-500">搜番/对齐</span>
      </button>

      <button
        onClick={() => runAndClose(onOpenVideoPro)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>画质、硬解与音字幕调校</span>
        </span>
      </button>

      <button
        onClick={() => runAndClose(onOpenNetworkPopover)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <Globe className="w-3.5 h-3.5 text-emerald-400" />
          <span>网络缓冲与代理快切</span>
        </span>
        <span className="text-[10px] font-mono text-emerald-400 truncate max-w-[68px]">
          {proxySummary}
        </span>
      </button>

      {showEpisodesEntry && (
        <button
          onClick={() => runAndClose(onOpenEpisodeDrawer)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
        >
          <span className="flex items-center space-x-2.5">
            <ListVideo className="w-3.5 h-3.5 text-slate-400" />
            <span>分集列表与片源版本</span>
          </span>
        </button>
      )}

      <div className="my-1 border-t border-white/[0.08]" />

      {/* 工具 */}
      {onTogglePin && (
        <button
          onClick={() => runAndClose(onTogglePin)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
        >
          <span className="flex items-center space-x-2.5">
            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'text-sky-400' : 'text-slate-400'}`} />
            <span>{isPinned ? '取消窗口置顶' : '窗口置顶'}</span>
          </span>
          <kbd className="text-[10px] font-mono text-slate-400">T</kbd>
        </button>
      )}

      <button
        onClick={() => runAndClose(onTakeScreenshot)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <Camera className="w-3.5 h-3.5 text-slate-400" />
          <span>截取当前无损画面</span>
        </span>
        <kbd className="text-[10px] font-mono text-slate-400">S</kbd>
      </button>

      <button
        onClick={() => runAndClose(onOpenPlaybackInfo)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <Info className="w-3.5 h-3.5 text-slate-400" />
          <span>实时硬解与媒体信息</span>
        </span>
        <kbd className="text-[10px] font-mono text-slate-400">I</kbd>
      </button>

      <button
        onClick={() => runAndClose(onOpenShortcuts)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
      >
        <span className="flex items-center space-x-2.5">
          <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>快捷键与手势指南</span>
        </span>
        <kbd className="text-[10px] font-mono text-slate-400">?</kbd>
      </button>
    </div>
  );
};

export default PlayerContextMenu;
