import React, { useState } from 'react';
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

  const handleToggleMute = () => {
    if (volume > 0) {
      setPrevVolume(volume);
      onVolumeChange(0);
    } else {
      onVolumeChange(prevVolume || 80);
    }
  };

  const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  return (
    <div
      className={`fixed inset-0 z-20 pointer-events-none transition-opacity duration-300 flex flex-col justify-between ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Top Bar (Bilibili Style: 返回、首页与剧集标题，无多余右上角按钮) */}
      <div
        data-tauri-drag-region
        className="pointer-events-auto bg-gradient-to-b from-black/90 via-black/50 to-transparent px-5 py-4 flex items-center justify-between"
      >
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-black/50 hover:bg-black/80 text-white backdrop-blur border border-white/10 transition cursor-pointer flex items-center space-x-1.5 shadow-md"
            title="返回详情页 (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold">返回</span>
          </button>

          {onHome && (
            <button
              onClick={onHome}
              className="p-2 rounded-xl bg-black/50 hover:bg-black/80 text-gray-300 hover:text-white backdrop-blur border border-white/10 transition cursor-pointer flex items-center space-x-1 shadow-md"
              title="直接返回媒体库首页"
            >
              <Home className="w-4 h-4" />
              <span className="text-xs font-semibold">首页</span>
            </button>
          )}

          <div className="ml-2 truncate max-w-xl">
            <h1 className="text-sm md:text-base font-bold text-white tracking-wide truncate drop-shadow">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-gray-300 font-medium truncate drop-shadow">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* 右上角留空：彻底杜绝控制按钮遮挡右侧抽屉 */}
        <div className="flex items-center space-x-2" />
      </div>

      {/* Middle Interactive Layer (双击全屏、单击播放/暂停) */}
      <div
        className="flex-1 w-full pointer-events-auto cursor-pointer"
        onClick={onVideoClick}
        onDoubleClick={onVideoDoubleClick}
      />

      {/* Bottom Controls */}
      <div className="pointer-events-auto bg-gradient-to-t from-black/85 via-black/50 to-transparent px-6 py-4 flex flex-col space-y-3">
        {/* Progress Scrubber */}
        <div className="group relative flex items-center cursor-pointer select-none">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-white/30 rounded-lg cursor-pointer accent-primary hover:h-2.5 transition-all"
          />
        </div>

        {/* Action Controls Row (Bilibili Style Layout) */}
        <div className="flex items-center justify-between text-white select-none">
          {/* Left Zone: Play/Pause, Time */}
          <div className="flex items-center space-x-3.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
              }}
              className="p-2 rounded-full hover:bg-white/20 transition cursor-pointer"
              title="播放/暂停 (空格)"
            >
              {paused ? <Play className="w-5 h-5 fill-white" /> : <Pause className="w-5 h-5 fill-white" />}
            </button>

            {/* Time display */}
            <div className="text-xs font-mono text-gray-300 font-medium tracking-wider">
              <span>{formatTime(currentTime)}</span>
              <span className="mx-1.5 text-gray-500">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Center Zone: Danmaku Controls (Bilibili Style: 弹幕开/关与设置) */}
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleDanmaku();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center space-x-1.5 cursor-pointer ${
                danmakuVisible
                  ? 'bg-primary/25 text-primary border border-primary/40 hover:bg-primary/35 shadow-sm'
                  : 'bg-white/10 text-gray-400 hover:text-white hover:bg-white/20'
              }`}
              title="一键开关弹幕 (快捷键 D)"
            >
              {danmakuVisible ? (
                <MessageSquare className="w-3.5 h-3.5" />
              ) : (
                <MessageSquareOff className="w-3.5 h-3.5" />
              )}
              <span className="text-xs font-mono">{danmakuVisible ? '弹幕开' : '弹幕关'}</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleDanmakuDrawer();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition cursor-pointer flex items-center space-x-1.5 text-xs font-medium border border-transparent hover:border-white/10"
              title="打开弹幕控制中心 (高级过滤、时间微调与手动搜番绑定)"
            >
              <Sliders className="w-3.5 h-3.5 text-primary" />
              <span className="hidden sm:inline">弹幕设置</span>
            </button>
          </div>

          {/* Right Zone: Speed, Tracks, Volume, Window Mode, Fullscreen */}
          <div className="flex items-center space-x-2.5 text-sm">
            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRateMenu(!showRateMenu);
                  setShowAudioMenu(false);
                  setShowSubtitleMenu(false);
                }}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-mono font-medium transition cursor-pointer"
                title="倍速选择"
              >
                {playbackRate}x
              </button>
              {showRateMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-[#161922] border border-white/10 rounded-xl shadow-2xl p-1 w-24 space-y-1 z-30">
                  {rates.map((r) => (
                    <button
                      key={r}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRateChange(r);
                        setShowRateMenu(false);
                      }}
                      className={`w-full text-center py-1.5 rounded text-xs font-mono transition ${
                        playbackRate === r ? 'bg-primary text-white font-bold' : 'hover:bg-white/10 text-gray-300'
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
                  className="p-2 rounded bg-white/10 hover:bg-white/20 text-white transition cursor-pointer flex items-center space-x-1"
                  title="音轨切换"
                >
                  <AudioLines className="w-4 h-4" />
                </button>
                {showAudioMenu && (
                  <div className="absolute bottom-full mb-2 right-0 bg-[#161922] border border-white/10 rounded-xl shadow-2xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto z-30">
                    <span className="text-xs font-semibold text-gray-400 px-2 block mb-1">
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
                        className={`w-full text-left px-3 py-2 rounded text-xs transition truncate ${
                          selectedAudioId === track.id
                            ? 'bg-primary text-white font-semibold'
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
                  className={`p-2 rounded transition cursor-pointer flex items-center space-x-1 ${
                    selectedSubtitleId ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                  title="字幕切换"
                >
                  <Subtitles className="w-4 h-4" />
                </button>
                {showSubtitleMenu && (
                  <div className="absolute bottom-full mb-2 right-0 bg-[#161922] border border-white/10 rounded-xl shadow-2xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto z-30">
                    <span className="text-xs font-semibold text-gray-400 px-2 block mb-1">
                      字幕选择
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSubtitleTrack(null);
                        setShowSubtitleMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded text-xs transition ${
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
                        className={`w-full text-left px-3 py-2 rounded text-xs transition truncate ${
                          selectedSubtitleId === track.id
                            ? 'bg-primary text-white font-semibold'
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

            {/* Episode Drawer */}
            {onToggleEpisodeDrawer && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEpisodeDrawer();
                }}
                className="p-2 rounded bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                title="分集列表"
              >
                <ListVideo className="w-4 h-4" />
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center space-x-2 group">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleMute();
                }}
                className="p-1.5 rounded-lg hover:bg-white/20 transition cursor-pointer"
                title={volume === 0 ? '取消静音' : '静音'}
              >
                {volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
                className="w-18 h-1 bg-white/30 rounded cursor-pointer accent-primary opacity-80 group-hover:opacity-100 transition"
              />
            </div>

            {/* 窗口模式 / 窗口全屏按钮 (Bilibili Style: 窗口全屏与还原) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWindowMode();
              }}
              className="p-2 rounded hover:bg-white/20 text-white transition cursor-pointer"
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

            {/* 全屏按钮 (Bilibili Style: 全屏切换) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFullscreen();
              }}
              className="p-2 rounded hover:bg-white/20 text-white transition cursor-pointer"
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
