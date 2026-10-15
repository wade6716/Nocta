import React, { useState, useRef } from 'react';
import {
  ArrowLeft,
  Home,
  Play,
  Pause,
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
} from 'lucide-react';
import { MappedTrack } from '../../api/embyClient';

interface PlayerOsdProps {
  title: string;
  subtitle?: string;
  visible: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  danmakuVisible: boolean;
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  selectedAudioId: string | null;
  selectedSubtitleId: string | null;
  isFullscreen: boolean;
  isMaximized?: boolean;

  danmakuCount?: number;
  danmakuOffset?: number;
  matchedTitle?: string;

  onBack: () => void;
  onHome?: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (vol: number) => void;
  onRateChange: (rate: number) => void;
  onToggleDanmaku: () => void;
  onToggleDanmakuDrawer: () => void;
  onToggleEpisodeDrawer?: () => void;
  onSelectAudioTrack: (id: string | null) => void;
  onSelectSubtitleTrack: (id: string | null) => void;
  onToggleWindowMode: () => void;
  onToggleFullscreen: () => void;
  onVideoClick?: () => void;
  onVideoDoubleClick?: (e?: React.MouseEvent) => void;
}

function formatTime(seconds: number): string {
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

export const PlayerOsd: React.FC<PlayerOsdProps> = ({
  title,
  subtitle,
  visible,
  paused,
  currentTime,
  duration,
  volume,
  playbackRate,
  danmakuVisible,
  audioTracks,
  subtitleTracks,
  selectedAudioId,
  selectedSubtitleId,
  isFullscreen,
  isMaximized = false,
  danmakuCount,
  danmakuOffset,
  matchedTitle,
  onBack,
  onHome,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onRateChange,
  onToggleDanmaku,
  onToggleDanmakuDrawer,
  onToggleEpisodeDrawer,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
  onToggleWindowMode,
  onToggleFullscreen,
  onVideoClick,
  onVideoDoubleClick,
}) => {
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const [prevVolume, setPrevVolume] = useState(100);

  // Scrubber Hover Timestamp Preview
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

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

  const handleToggleMute = () => {
    if (volume > 0) {
      setPrevVolume(volume);
      onVolumeChange(0);
    } else {
      onVolumeChange(prevVolume || 80);
    }
  };

  const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between overflow-hidden select-none">
      {/* 顶部悬浮毛玻璃胶囊栏 (双胶囊：左侧导航与标题，右侧弹幕载入状态与快捷设置) */}
      <div
        data-tauri-drag-region
        className={`fixed top-5 left-5 right-5 flex items-center justify-between pointer-events-none transition-all duration-300 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3 pointer-events-none'
        }`}
      >
        {/* 左侧胶囊：返回、首页、剧集标题 */}
        <div className="pointer-events-auto flex items-center space-x-3 px-4 py-2.5 rounded-2xl bg-[#0B0E17]/80 backdrop-blur-2xl border border-white/[0.12] shadow-xl">
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer flex items-center space-x-1.5"
            title="返回详情页 (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold">返回</span>
          </button>

          {onHome && (
            <button
              onClick={onHome}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition cursor-pointer flex items-center space-x-1"
              title="返回媒体库首页"
            >
              <Home className="w-4 h-4" />
            </button>
          )}

          <div className="h-4 w-px bg-white/15" />

          <div className="truncate max-w-xs sm:max-w-md lg:max-w-xl">
            <h1 className="text-sm font-bold text-white tracking-wide truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-gray-300 font-medium truncate tabular-nums">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* 右侧胶囊：弹幕实时载入徽章与快速抽屉开关 */}
        <div className="pointer-events-auto flex items-center space-x-2.5 px-3.5 py-2 rounded-2xl bg-[#0B0E17]/80 backdrop-blur-2xl border border-white/[0.12] shadow-xl text-xs text-gray-300">
          {danmakuCount !== undefined && danmakuCount > 0 ? (
            <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="tabular-nums">弹幕已载入 {danmakuCount.toLocaleString()} 条</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 text-xs text-gray-400 px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0" />
              <span>{matchedTitle ? '已匹配弹幕' : '未关联弹幕'}</span>
            </div>
          )}

          <button
            onClick={onToggleDanmakuDrawer}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition cursor-pointer"
            title="打开弹幕设置与时间校准"
          >
            <Sliders className="w-4 h-4 text-primary" />
          </button>
        </div>
      </div>

      {/* 画面中间透明交互区 (双击全屏、单击播放/暂停) */}
      <div
        className="flex-1 w-full pointer-events-auto cursor-pointer"
        onClick={onVideoClick}
        onDoubleClick={onVideoDoubleClick}
      />

      {/* 底部悬浮毛玻璃胶囊控制舱 (Floating Glass Pill OSD) */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 w-[min(94vw,980px)] rounded-2xl bg-[#0B0E17]/80 backdrop-blur-2xl border border-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.7)] px-5 py-3.5 z-20 transition-all duration-300 pointer-events-auto flex flex-col space-y-3 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {/* Progress Scrubber with Precision Hover Tooltip */}
        <div
          ref={progressBarRef}
          onMouseMove={handleMouseMoveProgress}
          onMouseLeave={handleMouseLeaveProgress}
          className="group relative flex items-center cursor-pointer select-none py-1"
        >
          {/* Hover Time Tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute bottom-6 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#0B0E17]/90 backdrop-blur-xl border border-white/20 text-xs font-mono tabular-nums text-white shadow-xl pointer-events-none z-30"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}

          {/* Track Bar */}
          <div className="relative w-full h-1.5 group-hover:h-2.5 bg-white/20 rounded-full transition-all duration-200 overflow-hidden">
            {/* Hover ghost preview */}
            {hoverTime !== null && (
              <div
                className="absolute top-0 bottom-0 left-0 bg-white/20 pointer-events-none transition-[width] duration-75"
                style={{ width: `${hoverPosition}%` }}
              />
            )}
            {/* Active progress fill */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-sky-400 to-[#38BDF8] rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Glowing Thumb on hover */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 group-hover:w-4 group-hover:h-4 bg-white rounded-full border-2 border-primary shadow-[0_0_12px_rgba(56,189,248,0.9)] transition-all duration-75 pointer-events-none scale-0 group-hover:scale-100"
            style={{ left: `${progressPercent}%` }}
          />

          {/* Native range input for drag & seek */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between text-white select-none">
          {/* Left Zone: Play/Pause, Volume, Time Readout */}
          <div className="flex items-center space-x-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
              }}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer"
              title="播放/暂停 (空格)"
            >
              {paused ? (
                <Play className="w-4 h-4 fill-white translate-x-0.5" />
              ) : (
                <Pause className="w-4 h-4 fill-white" />
              )}
            </button>

            {/* Time display with tabular-nums */}
            <div className="flex items-center text-xs font-mono font-medium tracking-wider text-gray-300 px-1">
              <span className="tabular-nums text-white font-semibold">{formatTime(currentTime)}</span>
              <span className="mx-1 text-gray-500">/</span>
              <span className="tabular-nums text-gray-400">{formatTime(duration)}</span>
            </div>

            {/* Volume slider */}
            <div className="flex items-center space-x-1.5 group/vol">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleMute();
                }}
                className="p-1.5 rounded-xl hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
                title={volume === 0 ? '取消静音' : '静音'}
              >
                {volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
                className="w-16 md:w-20 h-1 bg-white/30 rounded-lg cursor-pointer accent-primary opacity-75 group-hover/vol:opacity-100 transition"
              />
            </div>
          </div>

          {/* Center Zone: Danmaku Quick Toggle & Setting Drawer Trigger */}
          <div className="flex items-center space-x-2">
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
                onToggleDanmakuDrawer();
              }}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-gray-200 hover:text-white transition cursor-pointer flex items-center space-x-1.5 text-xs font-medium border border-white/10"
              title="打开弹幕控制中心 (换源绑定、时间微调与样式过滤)"
            >
              <Sliders className="w-3.5 h-3.5 text-primary" />
              <span>弹幕设置</span>
              {danmakuOffset !== undefined && danmakuOffset !== 0 && (
                <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono text-[11px] tabular-nums font-semibold">
                  {danmakuOffset > 0 ? `+${danmakuOffset}s` : `${danmakuOffset}s`}
                </span>
              )}
            </button>
          </div>

          {/* Right Zone: Speed, Tracks, Episode Drawer, Window, Fullscreen */}
          <div className="flex items-center space-x-2 text-sm">
            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRateMenu(!showRateMenu);
                  setShowAudioMenu(false);
                  setShowSubtitleMenu(false);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-xs font-mono font-medium transition cursor-pointer border border-white/5"
                title="倍速选择"
              >
                {playbackRate}x
              </button>
              {showRateMenu && (
                <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl p-1.5 w-24 space-y-1 z-30">
                  {rates.map((r) => (
                    <button
                      key={r}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRateChange(r);
                        setShowRateMenu(false);
                      }}
                      className={`w-full text-center py-1.5 rounded-lg text-xs font-mono transition ${
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
                    setShowAudioMenu(!showAudioMenu);
                    setShowRateMenu(false);
                    setShowSubtitleMenu(false);
                  }}
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer border border-white/5"
                  title="音轨切换"
                >
                  <AudioLines className="w-4 h-4" />
                </button>
                {showAudioMenu && (
                  <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto z-30">
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
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition truncate ${
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
                    setShowSubtitleMenu(!showSubtitleMenu);
                    setShowRateMenu(false);
                    setShowAudioMenu(false);
                  }}
                  className={`p-1.5 rounded-xl transition cursor-pointer border ${
                    selectedSubtitleId
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-white/5 text-white hover:bg-white/15 border-white/5'
                  }`}
                  title="字幕切换"
                >
                  <Subtitles className="w-4 h-4" />
                </button>
                {showSubtitleMenu && (
                  <div className="absolute bottom-full mb-3 right-0 bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto z-30">
                    <span className="text-[11px] font-semibold text-gray-400 px-2 block mb-1">
                      字幕选择
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSubtitleTrack(null);
                        setShowSubtitleMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition ${
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
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition truncate ${
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

            {/* Episode Drawer Shortcut */}
            {onToggleEpisodeDrawer && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEpisodeDrawer();
                }}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white transition cursor-pointer border border-white/5"
                title="分集列表"
              >
                <ListVideo className="w-4 h-4" />
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
                  : '窗口全屏 / 最大化'
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
