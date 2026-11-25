import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Home,
  Play,
  Pause,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  AppWindow,
  Sliders,
  MessageSquare,
  MessageSquareOff,
  ListVideo,
  AudioLines,
  Subtitles,
  Info,
  ArrowDown,
  Sparkles,
  Pin,
  Minus,
  X,
  Layers,
  Cpu,
  Crosshair,
} from 'lucide-react';
import {
  EmbyChapter,
  EmbyMediaSource,
  MappedTrack,
  ticksToSeconds,
} from '../../api/embyClient';
import { PlayerTelemetry, ResolvedStreamProxyInfo } from '../../player/types';
import { formatMediaSourceMeta } from '../../player/playbackSessionService';
import { SkipSegments } from '../../stores/usePlayerStore';

const IS_MACOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);

interface PlayerOsdProps {
  title: string;
  subtitle?: string;
  visible: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  engineType?: 'mpv' | 'html5';
  telemetry?: PlayerTelemetry;
  videoSpecLabel?: string;
  danmakuVisible: boolean;
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  selectedAudioId: string | null;
  selectedSubtitleId: string | null;
  selectedSecondarySubtitleId?: string | null;
  isFullscreen: boolean;
  isMaximized?: boolean;
  isPinned?: boolean;
  isTauri?: boolean;
  overlayMode?: boolean;
  networkSpeed?: number;
  proxyInfo?: ResolvedStreamProxyInfo | null;

  chapters?: EmbyChapter[];
  danmakuHeatmap?: number[];
  showHeatmap?: boolean;
  abLoopA?: number | null;
  abLoopB?: number | null;
  showRemainingTime?: boolean;
  onToggleRemainingTime?: () => void;

  hasNextEpisode?: boolean;
  onNextEpisode?: () => void;

  availableMediaSources?: EmbyMediaSource[];
  activeMediaSourceId?: string;
  onSelectMediaSource?: (ms: EmbyMediaSource) => void;

  danmakuCount?: number;
  danmakuOffset?: number;
  matchedTitle?: string;
  skipSegments?: SkipSegments | null;

  isDanmakuDrawerOpen?: boolean;
  isVideoProPanelOpen?: boolean;
  isEpisodeDrawerOpen?: boolean;
  isNetworkPopoverOpen?: boolean;
  isPlaybackInfoOpen?: boolean;

  onBack: () => void;
  onHome?: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (vol: number) => void;
  onRateChange: (rate: number) => void;
  onToggleDanmaku: () => void;
  onToggleDanmakuDrawer: () => void;
  onToggleVideoProPanel?: () => void;
  onToggleEpisodeDrawer?: () => void;
  onToggleNetworkPopover?: () => void;
  onTogglePlaybackInfo?: () => void;
  onSelectAudioTrack: (id: string | null) => void;
  onSelectSubtitleTrack: (id: string | null) => void;
  onTogglePin?: () => void;
  onMinimizeWindow?: () => void;
  onCloseWindow?: () => void;
  onToggleWindowMode: () => void;
  onToggleFullscreen: () => void;
  onMarkIntroEnd?: () => void;
  onMarkOutroStart?: () => void;
  onClearSkipSegment?: (field: 'introEnd' | 'outroStart') => void;
  onVideoClick?: () => void;
  onVideoDoubleClick?: (e?: React.MouseEvent) => void;
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatNetworkSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || isNaN(bytesPerSec) || bytesPerSec <= 0) {
    return '0 KB/s';
  }
  if (bytesPerSec < 1024) {
    return `${Math.round(bytesPerSec)} B/s`;
  }
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function getProxyShortBadge(info?: ResolvedStreamProxyInfo | null): {
  text: string;
  cls: string;
} {
  if (!info) return { text: '网络', cls: 'text-slate-400' };
  switch (info.mode) {
    case 'system_http':
    case 'manual_http':
      return { text: '代理', cls: 'text-emerald-400' };
    case 'lan_bypass':
      return { text: '旁路', cls: 'text-teal-400' };
    case 'socks5_fallback_direct':
      return { text: '直连*', cls: 'text-amber-400' };
    case 'direct':
    default:
      return { text: '直连', cls: 'text-slate-400' };
  }
}

interface SkipSegmentRowProps {
  label: string;
  value?: number;
  hint?: string;
  onMark?: () => void;
  onClear?: () => void;
  onSeek: (seconds: number) => void;
}

const SkipSegmentRow: React.FC<SkipSegmentRowProps> = ({
  label,
  value,
  hint,
  onMark,
  onClear,
  onSeek,
}) => (
  <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-medium text-gray-400 shrink-0">{label}</span>
        {hint && (
          <span className="text-[10px] font-mono tabular-nums text-sky-300/80 bg-sky-500/10 border border-sky-400/20 px-1.5 py-0.2 rounded truncate">
            {hint}
          </span>
        )}
      </div>
      {value !== undefined ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSeek(value);
          }}
          className="text-xs font-mono tabular-nums text-sky-400 hover:text-sky-300 transition cursor-pointer"
          title="跳转到该标记位置"
        >
          {formatTime(value)}
        </button>
      ) : (
        <span className="text-[11px] text-gray-500">未标记</span>
      )}
    </div>

    <div className="flex items-center gap-1.5 mt-2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMark?.();
        }}
        disabled={!onMark}
        className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold text-gray-200 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
      >
        <Crosshair className="w-3 h-3" />
        <span>标记当前</span>
      </button>
      {value !== undefined && onClear && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="p-1.5 rounded-lg text-gray-400 bg-white/5 border border-white/10 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
          title="清除该标记"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  </div>
);

export const PlayerOsd: React.FC<PlayerOsdProps> = ({
  title,
  subtitle,
  visible,
  paused,
  currentTime,
  duration,
  volume,
  playbackRate,
  engineType = 'mpv',
  telemetry,
  videoSpecLabel,
  danmakuVisible,
  audioTracks,
  subtitleTracks,
  selectedAudioId,
  selectedSubtitleId,
  selectedSecondarySubtitleId,
  isFullscreen,
  isMaximized = false,
  isPinned = false,
  isTauri = false,
  overlayMode = false,
  networkSpeed = 0,
  proxyInfo,
  chapters = [],
  danmakuHeatmap = [],
  showHeatmap = true,
  abLoopA = null,
  abLoopB = null,
  showRemainingTime = false,
  onToggleRemainingTime,
  hasNextEpisode = false,
  onNextEpisode,
  availableMediaSources = [],
  activeMediaSourceId,
  onSelectMediaSource,
  danmakuCount,
  danmakuOffset,
  matchedTitle,
  isDanmakuDrawerOpen = false,
  isVideoProPanelOpen = false,
  isEpisodeDrawerOpen = false,
  isNetworkPopoverOpen = false,
  isPlaybackInfoOpen = false,
  skipSegments,
  onBack,
  onHome,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onRateChange,
  onToggleDanmaku,
  onToggleDanmakuDrawer,
  onToggleVideoProPanel,
  onToggleEpisodeDrawer,
  onToggleNetworkPopover,
  onTogglePlaybackInfo,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
  onTogglePin,
  onMinimizeWindow,
  onCloseWindow,
  onToggleWindowMode,
  onToggleFullscreen,
  onMarkIntroEnd,
  onMarkOutroStart,
  onClearSkipSegment,
  onVideoClick,
  onVideoDoubleClick,
}) => {
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [showSkipMenu, setShowSkipMenu] = useState(false);
  const [prevVolume, setPrevVolume] = useState(100);

  // 实时时钟
  const [clockText, setClockText] = useState(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setClockText(
        `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  // 进度条拖拽防抖状态
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const isScrubbingRef = useRef(false);
  const scrubTimeRef = useRef(0);

  // Scrubber Hover Timestamp Preview
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const isMac =
    typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent);

  const closeAllDropdowns = () => {
    setShowRateMenu(false);
    setShowAudioMenu(false);
    setShowSubtitleMenu(false);
    setShowSourceMenu(false);
    setShowSkipMenu(false);
  };

  const handleMouseMoveProgress = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * duration);
  };

  const handleMouseLeaveProgress = () => {
    setHoverTime(null);
  };

  const commitScrub = () => {
    if (isScrubbingRef.current) {
      isScrubbingRef.current = false;
      setIsScrubbing(false);
      onSeek(scrubTimeRef.current);
    }
  };

  const handleToggleMute = () => {
    if (volume > 0) {
      setPrevVolume(volume);
      onVolumeChange(0);
    } else {
      onVolumeChange(prevVolume || 80);
    }
  };

  const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  const displayTime = isScrubbing ? scrubTime : currentTime;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;
  const hasSkipSegments = Boolean(
    skipSegments?.introEnd || skipSegments?.outroStart || skipSegments?.outroOffsetFromEnd
  );

  const bufferedPercent =
    duration > 0 && telemetry?.bufferedEnd && telemetry.bufferedEnd > displayTime
      ? Math.min(100, Math.max(progressPercent, (telemetry.bufferedEnd / duration) * 100))
      : 0;

  // 章节列表预处理
  const chapterMarkers =
    duration > 0
      ? chapters
          .map((c) => ({
            time: ticksToSeconds(c.StartPositionTicks || 0),
            name: c.Name || '章节',
          }))
          .filter((c) => c.time > 0 && c.time < duration)
          .sort((a, b) => a.time - b.time)
      : [];

  // 当前鼠标悬停时间点所在章节名
  let hoveredChapterName: string | null = null;
  if (hoverTime !== null && chapters.length > 0) {
    const sorted = [...chapters]
      .map((c) => ({
        time: ticksToSeconds(c.StartPositionTicks || 0),
        name: c.Name || '',
      }))
      .sort((a, b) => a.time - b.time);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (hoverTime >= sorted[i].time) {
        hoveredChapterName = sorted[i].name || null;
        break;
      }
    }
  }

  // 高能弹幕密度 SVG Path
  const heatmapPath = React.useMemo(() => {
    if (!showHeatmap || danmakuHeatmap.length < 2) return null;
    const w = 1000;
    const h = 24;
    const pts = danmakuHeatmap.map((val, i) => {
      const x = (i / (danmakuHeatmap.length - 1)) * w;
      const y = h - val * (h - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M0,${h} L${pts.join(' L')} L${w},${h} Z`;
  }, [showHeatmap, danmakuHeatmap]);

  // 硬解标签
  const hwdecActive = telemetry?.hwdecCurrent && telemetry.hwdecCurrent !== 'no';
  const proxyBadge = getProxyShortBadge(proxyInfo);

  // A-B 循环区间百分比
  const abStartPct =
    duration > 0 && abLoopA !== null ? Math.min(100, Math.max(0, (abLoopA / duration) * 100)) : null;
  const abEndPct =
    duration > 0 && abLoopB !== null ? Math.min(100, Math.max(0, (abLoopB / duration) * 100)) : null;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between overflow-hidden select-none">
      {/* 顶部悬浮毛玻璃胶囊栏：外层开启可拖拽区域 (window drag region)，仅保留顶部 60px 高度 */}
      <div
        data-tauri-drag-region={overlayMode ? undefined : ''}
        onDoubleClick={(e) => {
          if (!overlayMode && e.target === e.currentTarget) {
            onToggleWindowMode();
          }
        }}
        className={`fixed top-0 left-0 right-0 pt-4 pb-2 pr-5 ${
          (isMac || IS_MACOS) && !isFullscreen ? 'pl-20' : 'pl-5'
        } flex items-center justify-between transition-all duration-300 ${
          visible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-3 pointer-events-none'
        }`}
      >
        {/* 左侧胶囊：返回、首页、标题与实时硬解/画质徽章 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center space-x-2.5 px-3.5 py-2 rounded-2xl bg-[#0B0E17]/90 backdrop-blur-2xl border border-white/15 max-w-[55vw]"
        >
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer flex items-center space-x-1 shrink-0"
            title="返回详情页 (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold">返回</span>
          </button>

          {onHome && (
            <button
              onClick={onHome}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition cursor-pointer shrink-0"
              title="返回媒体库首页"
            >
              <Home className="w-4 h-4" />
            </button>
          )}

          <div className="h-4 w-px bg-white/15 shrink-0" />

          <div className="truncate min-w-0">
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-white tracking-wide truncate">{title}</h1>
              {videoSpecLabel && (
                <span className="hidden md:inline-flex shrink-0 px-1.5 py-0.2 rounded bg-sky-500/15 border border-sky-400/30 text-[10px] font-mono font-bold text-sky-300">
                  {videoSpecLabel}
                </span>
              )}
              {engineType === 'mpv' && telemetry?.hwdecCurrent !== undefined && (
                <span
                  className={`hidden sm:inline-flex shrink-0 items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold border ${
                    hwdecActive
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  }`}
                  title={
                    hwdecActive
                      ? `硬件解码已激活: ${telemetry?.hwdecCurrent}`
                      : '当前正处于 CPU 软解模式'
                  }
                >
                  <Cpu className="w-2.5 h-2.5" />
                  <span>
                    {hwdecActive ? telemetry?.hwdecCurrent?.toUpperCase() : '软解'}
                  </span>
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-gray-300 font-medium truncate tabular-nums">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* 右侧胶囊：实时时钟、弹幕状态、置顶、窗口控制 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center space-x-2 px-3 py-2 rounded-2xl bg-[#0B0E17]/90 backdrop-blur-2xl border border-white/15 text-xs text-gray-300 shrink-0"
        >
          {/* 系统时间 */}
          <span className="hidden sm:inline font-mono tabular-nums text-slate-300 px-1.5 font-medium">
            {clockText}
          </span>

          <div className="hidden sm:block h-3.5 w-px bg-white/15" />

          {/* 弹幕载入徽章（窗口态与全屏态均可点击打开弹幕控制中心） */}
          <button
            onClick={onToggleDanmakuDrawer}
            className="cursor-pointer transition"
            title="点击打开弹幕控制中心"
          >
            {danmakuCount !== undefined && danmakuCount > 0 ? (
              <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 hover:bg-emerald-500/25 transition">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="tabular-nums">{danmakuCount.toLocaleString()} 弹幕</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 text-xs text-gray-400 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 hover:text-white transition">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
                <span>{matchedTitle ? '已匹配' : '搜弹幕'}</span>
              </div>
            )}
          </button>

          {/* 置顶 Pin */}
          {isTauri && !overlayMode && !isFullscreen && onTogglePin && (
            <button
              onClick={onTogglePin}
              className={`p-1.5 rounded-xl transition cursor-pointer ${
                isPinned
                  ? 'bg-sky-500/25 text-sky-300 border border-sky-400/40'
                  : 'bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white'
              }`}
              title={isPinned ? '取消窗口置顶 (T)' : '置顶播放窗口 (T)'}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Windows/Linux 窗口态下的最小化与关闭按钮 */}
          {isTauri && !overlayMode && !isMac && !isFullscreen && onMinimizeWindow && onCloseWindow && (
            <>
              <div className="h-3.5 w-px bg-white/15" />
              <button
                onClick={onMinimizeWindow}
                className="p-1.5 rounded-xl hover:bg-white/15 text-gray-300 hover:text-white transition cursor-pointer"
                title="最小化"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onCloseWindow}
                className="p-1.5 rounded-xl hover:bg-red-500/80 text-gray-300 hover:text-white transition cursor-pointer"
                title="关闭窗口"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 画面中间透明交互区 */}
      <div
        className="flex-1 w-full pointer-events-auto cursor-pointer"
        onClick={() => {
          closeAllDropdowns();
          onVideoClick?.();
        }}
        onDoubleClick={onVideoDoubleClick}
      />

      {/* 底部悬浮毛玻璃胶囊控制舱 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 w-[min(95vw,1060px)] rounded-2xl bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 px-5 py-3.5 z-20 transition-all duration-300 pointer-events-auto flex flex-col space-y-2.5 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {/* 高能多维智能进度条 */}
        <div
          ref={progressBarRef}
          onMouseMove={handleMouseMoveProgress}
          onMouseLeave={handleMouseLeaveProgress}
          className="group relative flex items-center cursor-pointer select-none pt-3 pb-1"
        >
          {/* Hover 预览气泡：时间 + 章节名 */}
          {hoverTime !== null && (
            <div
              className="absolute bottom-7 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#0B0E17]/95 backdrop-blur-xl border border-white/20 text-xs font-mono tabular-nums text-white pointer-events-none z-30 whitespace-nowrap flex flex-col items-center"
              style={{ left: `${hoverPosition}%` }}
            >
              {hoveredChapterName && (
                <span className="text-[10px] font-sans text-sky-300 font-medium max-w-[180px] truncate mb-0.5">
                  {hoveredChapterName}
                </span>
              )}
              <span>{formatTime(hoverTime)}</span>
            </div>
          )}

          {/* 零内边距轨道锚定容器：保证圆点圆心与弹幕热力图严格对齐轨道中线/上沿 */}
          <div className="relative w-full flex items-center">
            {/* 高能弹幕密度 SVG 曲线（严格贴合轨道上沿） */}
            {heatmapPath && (
              <svg
                viewBox="0 0 1000 24"
                preserveAspectRatio="none"
                className="absolute left-0 right-0 bottom-full h-5 w-full pointer-events-none opacity-45 group-hover:opacity-85 transition-opacity"
              >
                <defs>
                  <linearGradient id="danmuHeatGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                <path d={heatmapPath} fill="url(#danmuHeatGrad)" />
              </svg>
            )}

            {/* 轨道容器 */}
            <div
              className={`relative w-full ${
                isScrubbing ? 'h-2.5' : 'h-1.5 group-hover:h-2.5'
              } bg-white/15 rounded-full transition-[height] duration-200 overflow-hidden`}
            >
              {/* 前向缓冲条 */}
              {bufferedPercent > progressPercent && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-white/25 pointer-events-none transition-[width] duration-300"
                  style={{ width: `${bufferedPercent}%` }}
                />
              )}

              {/* Hover preview ghost */}
              {hoverTime !== null && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-white/20 pointer-events-none"
                  style={{ width: `${hoverPosition}%` }}
                />
              )}

              {/* A-B 循环区间高亮 */}
              {abStartPct !== null && abEndPct !== null && abEndPct > abStartPct && (
                <div
                  className="absolute top-0 bottom-0 bg-amber-400/60 pointer-events-none"
                  style={{ left: `${abStartPct}%`, width: `${abEndPct - abStartPct}%` }}
                />
              )}

              {/* Active progress fill */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-sky-400 to-[#38BDF8] rounded-full"
                style={{ width: `${progressPercent}%` }}
              />

              {/* Emby 章节分隔刻度点 */}
              {chapterMarkers.map((c, idx) => (
                <div
                  key={`${c.time}-${idx}`}
                  className="absolute top-0 bottom-0 w-0.5 bg-white/75 pointer-events-none"
                  style={{ left: `${(c.time / duration) * 100}%` }}
                />
              ))}
            </div>

            {/* 发光拖拽手柄（圆心垂直锚定在轨道正中央 top-1/2 -translate-y-1/2） */}
            <div
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-full border-2 border-primary shadow-[0_0_12px_rgba(56,189,248,0.9)] transition-[transform,width,height,box-shadow] duration-150 pointer-events-none ${
                isScrubbing
                  ? 'w-4 h-4 scale-100'
                  : 'w-3 h-3 group-hover:w-4 group-hover:h-4 scale-100'
              }`}
              style={{ left: `${progressPercent}%` }}
            />
          </div>

          {/* 防抖 Drag & Seek 输入层 */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={displayTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              isScrubbingRef.current = true;
              scrubTimeRef.current = val;
              setIsScrubbing(true);
              setScrubTime(val);
            }}
            onPointerUp={commitScrub}
            onTouchEnd={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between text-white select-none gap-2">
          {/* Left Zone: Play/Pause, Next, Time, Net/Proxy Pill, Volume */}
          <div className="flex items-center space-x-2.5 min-w-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
              }}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer shrink-0"
              title="播放/暂停 (空格)"
            >
              {paused ? (
                <Play className="w-4 h-4 fill-white translate-x-0.5" />
              ) : (
                <Pause className="w-4 h-4 fill-white" />
              )}
            </button>

            {hasNextEpisode && onNextEpisode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNextEpisode();
                }}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer shrink-0"
                title="播放下一集 (N)"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}

            {/* Time readout (点击总时长可切换显示 -剩余时间) */}
            <div className="flex items-center text-xs font-mono font-medium tracking-wider text-gray-300 px-0.5 shrink-0">
              <span className="tabular-nums text-white font-semibold">{formatTime(displayTime)}</span>
              <span className="mx-1 text-gray-500">/</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleRemainingTime?.();
                }}
                className="tabular-nums text-gray-400 hover:text-sky-300 transition cursor-pointer"
                title="点击切换 总时长 / 剩余时间"
              >
                {showRemainingTime && duration > 0
                  ? `-${formatTime(Math.max(0, duration - displayTime))}`
                  : formatTime(duration)}
              </button>
            </div>

            {/* 实时网速 & 代理路由胶囊（点击打开 NetworkProxyPopover） */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeAllDropdowns();
                onToggleNetworkPopover?.();
              }}
              className={`hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono font-medium select-none shadow-sm transition cursor-pointer shrink-0 ${
                isNetworkPopoverOpen
                  ? 'bg-sky-500/20 border-sky-400/40 text-sky-300'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-sky-400'
              }`}
              title="点击查看实时缓冲监控与代理路由快切"
            >
              <ArrowDown className="w-3 h-3 text-sky-400 shrink-0 animate-pulse" />
              <span className="tabular-nums">{formatNetworkSpeed(networkSpeed)}</span>
              <span className="text-white/20">·</span>
              <span className={`font-sans text-[11px] font-semibold ${proxyBadge.cls}`}>
                {proxyBadge.text}
              </span>
            </button>

            {/* Volume slider (支持最高 200% 软件增益) */}
            <div className="flex items-center space-x-1.5 group/vol shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleMute();
                }}
                className="p-1.5 rounded-xl hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
                title={volume === 0 ? '取消静音 (M)' : '静音 (M)'}
              >
                {volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className={`w-4 h-4 ${volume > 100 ? 'text-amber-400' : ''}`} />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={engineType === 'mpv' ? 200 : 100}
                value={volume}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
                className="w-16 md:w-20 h-1 bg-white/30 rounded-lg cursor-pointer accent-primary opacity-75 group-hover/vol:opacity-100 transition"
                title={`音量: ${volume}%`}
              />
              {volume > 100 && (
                <span className="hidden lg:inline text-[10px] font-mono font-bold text-amber-400 tabular-nums">
                  {volume}%
                </span>
              )}
            </div>
          </div>

          {/* Center Zone: 弹幕控制区 */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleDanmaku();
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
                danmakuVisible
                  ? 'bg-primary/25 text-primary border border-primary/40 shadow-[0_0_15px_rgba(56,189,248,0.2)] hover:bg-primary/35'
                  : 'bg-white/5 text-gray-400 border border-white/5 hover:text-white hover:bg-white/10'
              }`}
              title="一键开关弹幕 (快捷键 D)"
            >
              {danmakuVisible ? (
                <MessageSquare className="w-3.5 h-3.5" />
              ) : (
                <MessageSquareOff className="w-3.5 h-3.5" />
              )}
              <span>{danmakuVisible ? '弹幕 开' : '弹幕 关'}</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                closeAllDropdowns();
                onToggleDanmakuDrawer();
              }}
              className={`px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center space-x-1.5 text-xs font-medium border ${
                isDanmakuDrawerOpen
                  ? 'bg-primary/25 text-white border-primary/50'
                  : 'bg-white/5 hover:bg-white/15 text-gray-200 hover:text-white border-white/10'
              }`}
              title="打开弹幕控制中心 (换源绑定、时间微调、防刷屏与弹幕列表)"
            >
              <Sliders className="w-3.5 h-3.5 text-primary" />
              <span>弹幕</span>
              {danmakuOffset !== undefined && danmakuOffset !== 0 && (
                <span className="px-1.5 py-0.2 rounded bg-primary/20 text-primary font-mono text-[11px] tabular-nums font-semibold">
                  {danmakuOffset > 0 ? `+${danmakuOffset}s` : `${danmakuOffset}s`}
                </span>
              )}
            </button>
          </div>

          {/* Right Zone: 片头片尾标记, 版本源, 倍速, 音轨, 字幕, 画质调校, 选集, 信息, 窗口, 全屏 */}
          <div className="flex items-center space-x-1.5 text-sm shrink-0">
            {/* Intro / Outro Segment Marking */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const next = !showSkipMenu;
                  closeAllDropdowns();
                  setShowSkipMenu(next);
                }}
                className={`relative p-1.5 rounded-xl transition cursor-pointer border ${
                  showSkipMenu || hasSkipSegments
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-white/5 text-white hover:bg-white/15 border-white/5'
                }`}
                title="标记片头结束与片尾开始"
              >
                <Crosshair className="w-4 h-4" />
                {hasSkipSegments && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(56,189,248,0.9)]" />
                )}
              </button>

              {showSkipMenu && (
                <div className="absolute bottom-full mb-3 right-0 w-72 rounded-xl bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 p-2.5 space-y-2 z-40">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-white">片头片尾标记</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSkipMenu(false);
                      }}
                      className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      title="关闭"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <SkipSegmentRow
                    label="片头结束"
                    value={skipSegments?.introEnd}
                    onMark={onMarkIntroEnd}
                    onClear={() => onClearSkipSegment?.('introEnd')}
                    onSeek={onSeek}
                  />
                  <SkipSegmentRow
                    label="片尾开始"
                    value={skipSegments?.outroStart}
                    hint={
                      skipSegments?.outroOffsetFromEnd
                        ? `距结尾 ${formatTime(skipSegments.outroOffsetFromEnd)}`
                        : undefined
                    }
                    onMark={onMarkOutroStart}
                    onClear={() => onClearSkipSegment?.('outroStart')}
                    onSeek={onSeek}
                  />
                </div>
              )}
            </div>

            {/* 多版本原画源快捷菜单 */}
            {availableMediaSources.length > 1 && onSelectMediaSource && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !showSourceMenu;
                    closeAllDropdowns();
                    setShowSourceMenu(next);
                  }}
                  className="px-2 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-xs font-medium transition cursor-pointer border border-white/5 flex items-center space-x-1"
                  title="切换多版本原画片源"
                >
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden lg:inline">版本</span>
                </button>
                {showSourceMenu && (
                  <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl p-2 w-72 space-y-1 max-h-64 overflow-y-auto z-30">
                    <span className="text-[11px] font-semibold text-gray-400 px-2 block mb-1">
                      切换原画版本 (0 转码直连)
                    </span>
                    {availableMediaSources.map((ms) => {
                      const isActive = activeMediaSourceId === ms.Id;
                      const meta = formatMediaSourceMeta(ms);
                      const specLine = [
                        meta.resolutionLabel,
                        meta.hdrLabel,
                        meta.containerLabel,
                        meta.sizeLabel,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <button
                          key={ms.Id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectMediaSource(ms);
                            setShowSourceMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition cursor-pointer flex items-center justify-between gap-2 ${
                            isActive
                              ? 'bg-primary text-white'
                              : 'hover:bg-white/10 text-gray-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate">
                              {ms.Name || meta.resolutionLabel || meta.containerLabel || '默认版本'}
                            </div>
                            {specLine && (
                              <div
                                className={`text-[10px] font-mono truncate mt-0.5 ${
                                  isActive ? 'text-white/80' : 'text-gray-400'
                                }`}
                              >
                                {specLine}
                              </div>
                            )}
                          </div>
                          {isActive && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/20 text-white font-bold">
                              当前
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const next = !showRateMenu;
                  closeAllDropdowns();
                  setShowRateMenu(next);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-xs font-mono font-medium transition cursor-pointer border border-white/5"
                title="倍速选择 ([ / ] / \)"
              >
                {playbackRate}x
              </button>
              {showRateMenu && (
                <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl p-1.5 w-24 space-y-1 z-30">
                  {rates.map((r) => (
                    <button
                      key={r}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRateChange(r);
                        setShowRateMenu(false);
                      }}
                      className={`w-full text-center py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                        playbackRate === r
                          ? 'bg-primary text-white font-bold shadow-md'
                          : 'hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {r}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Audio Track Selector */}
            {audioTracks.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !showAudioMenu;
                    closeAllDropdowns();
                    setShowAudioMenu(next);
                  }}
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer border border-white/5"
                  title="音轨切换 (快捷键 A)"
                >
                  <AudioLines className="w-4 h-4" />
                </button>
                {showAudioMenu && (
                  <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto z-30">
                    <span className="text-[11px] font-semibold text-gray-400 px-2 block mb-1">
                      音轨选择
                    </span>
                    {audioTracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAudioTrack(track.id);
                          setShowAudioMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition truncate cursor-pointer ${
                          selectedAudioId === track.id
                            ? 'bg-primary text-white font-semibold shadow-md'
                            : 'hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        {track.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Subtitle Track Selector */}
            {subtitleTracks.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !showSubtitleMenu;
                    closeAllDropdowns();
                    setShowSubtitleMenu(next);
                  }}
                  className={`p-1.5 rounded-xl transition cursor-pointer border relative ${
                    selectedSubtitleId || selectedSecondarySubtitleId
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-white/5 text-white hover:bg-white/15 border-white/5'
                  }`}
                  title="字幕切换 (快捷键 C)"
                >
                  <Subtitles className="w-4 h-4" />
                  {selectedSecondarySubtitleId && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-sky-400 text-[9px] text-slate-950 font-bold flex items-center justify-center">
                      2
                    </span>
                  )}
                </button>
                {showSubtitleMenu && (
                  <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl p-2 w-64 space-y-1 max-h-60 overflow-y-auto z-30">
                    <span className="text-[11px] font-semibold text-gray-400 px-2 block mb-1">
                      主字幕选择 (双语次字幕可在调校面板设置)
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSubtitleTrack(null);
                        setShowSubtitleMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition cursor-pointer ${
                        selectedSubtitleId === null
                          ? 'bg-primary text-white font-semibold'
                          : 'hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      关闭字幕
                    </button>
                    {subtitleTracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSubtitleTrack(track.id);
                          setShowSubtitleMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition truncate cursor-pointer ${
                          selectedSubtitleId === track.id
                            ? 'bg-primary text-white font-semibold shadow-md'
                            : 'hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        {track.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 画质、硬解与音字幕 Pro 调校面板开关 */}
            {onToggleVideoProPanel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeAllDropdowns();
                  onToggleVideoProPanel();
                }}
                className={`p-1.5 rounded-xl transition cursor-pointer border ${
                  isVideoProPanelOpen
                    ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                    : 'bg-white/5 text-white hover:bg-white/15 border-white/5'
                }`}
                title="画质、硬解、宽银幕贴底、双语字幕与音频增益调校"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
              </button>
            )}

            {/* Episode Drawer Shortcut */}
            {onToggleEpisodeDrawer && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeAllDropdowns();
                  onToggleEpisodeDrawer();
                }}
                className={`p-1.5 rounded-xl transition cursor-pointer border ${
                  isEpisodeDrawerOpen
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-white/5 text-white hover:bg-white/15 border-white/5'
                }`}
                title="分集与片源版本"
              >
                <ListVideo className="w-4 h-4" />
              </button>
            )}

            {/* Playback Info Modal Trigger */}
            {onTogglePlaybackInfo && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeAllDropdowns();
                  onTogglePlaybackInfo();
                }}
                className={`p-1.5 rounded-xl transition cursor-pointer border ${
                  isPlaybackInfoOpen
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-white/5 text-white hover:bg-white/15 border-white/5'
                }`}
                title="实时硬解与媒体技术信息 (快捷键 I)"
              >
                <Info className="w-4 h-4" />
              </button>
            )}

            {/* Window Mode Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWindowMode();
              }}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer border border-white/5"
              title={
                isFullscreen
                  ? '恢复窗口 (退出全屏)'
                  : isMaximized
                  ? '还原窗口'
                  : '最大化窗口'
              }
            >
              <AppWindow className="w-4 h-4" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFullscreen();
              }}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer border border-white/5"
              title={isFullscreen ? '退出全屏 (F / Esc)' : '全屏 (F)'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerOsd;
