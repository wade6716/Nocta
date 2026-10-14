import React, { useState } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Sliders,
  MessageSquare,
  MessageSquareOff,
  Settings2,
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

  onBack: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (vol: number) => void;
  onRateChange: (rate: number) => void;
  onToggleDanmaku: () => void;
  onToggleDanmakuDrawer: () => void;
  onToggleEpisodeDrawer?: () => void;
  onSelectAudioTrack: (id: string | null) => void;
  onSelectSubtitleTrack: (id: string | null) => void;
  onToggleFullscreen: () => void;
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
  onBack,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onRateChange,
  onToggleDanmaku,
  onToggleDanmakuDrawer,
  onToggleEpisodeDrawer,
  onSelectAudioTrack,
  onSelectSubtitleTrack,
  onToggleFullscreen,
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
      {/* Top Bar */}
      <div className="pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent p-5 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="p-2 rounded-full hover:bg-white/20 text-white transition cursor-pointer"
            title="返回详情页 (Esc)"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide truncate max-w-xl">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-gray-300 font-medium truncate max-w-md">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onToggleDanmaku}
            className={`p-2 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 cursor-pointer ${
              danmakuVisible
                ? 'bg-primary/20 text-primary border border-primary/40'
                : 'bg-white/10 text-gray-400 hover:text-white'
            }`}
            title="一键开关弹幕 (快捷键 D)"
          >
            {danmakuVisible ? (
              <MessageSquare className="w-4 h-4" />
            ) : (
              <MessageSquareOff className="w-4 h-4" />
            )}
            <span className="text-xs font-mono">{danmakuVisible ? '弹幕开' : '弹幕关'}</span>
          </button>

          <button
            onClick={onToggleDanmakuDrawer}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            title="打开弹幕控制中心"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </div>

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

        {/* Action Controls Row */}
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center space-x-4">
            {/* Play/Pause */}
            <button
              onClick={onTogglePlay}
              className="p-2 rounded-full hover:bg-white/20 transition cursor-pointer"
              title="播放/暂停 (空格)"
            >
              {paused ? <Play className="w-6 h-6 fill-white" /> : <Pause className="w-6 h-6 fill-white" />}
            </button>

            {/* Time display */}
            <div className="text-xs font-mono text-gray-300 font-medium">
              <span>{formatTime(currentTime)}</span>
              <span className="mx-1 text-gray-500">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Volume */}
            <div className="flex items-center space-x-2 group">
              <button
                onClick={handleToggleMute}
                className="p-1.5 rounded-lg hover:bg-white/20 transition cursor-pointer"
              >
                {volume === 0 ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
                className="w-20 h-1 bg-white/30 rounded cursor-pointer accent-primary opacity-80 group-hover:opacity-100 transition"
              />
            </div>
          </div>

          <div className="flex items-center space-x-3 text-sm">
            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowRateMenu(!showRateMenu);
                  setShowAudioMenu(false);
                  setShowSubtitleMenu(false);
                }}
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-mono font-medium transition cursor-pointer"
              >
                {playbackRate}x
              </button>
              {showRateMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-[#161922] border border-white/10 rounded-xl shadow-2xl p-1 w-24 space-y-1">
                  {rates.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
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
                  onClick={() => {
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
                  <div className="absolute bottom-full mb-2 right-0 bg-[#161922] border border-white/10 rounded-xl shadow-2xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto">
                    <span className="text-xs font-semibold text-gray-400 px-2 block mb-1">
                      音轨选择
                    </span>
                    {audioTracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={() => {
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
                  onClick={() => {
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
                  <div className="absolute bottom-full mb-2 right-0 bg-[#161922] border border-white/10 rounded-xl shadow-2xl p-2 w-64 space-y-1 max-h-56 overflow-y-auto">
                    <span className="text-xs font-semibold text-gray-400 px-2 block mb-1">
                      字幕选择
                    </span>
                    <button
                      onClick={() => {
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
                        onClick={() => {
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
                onClick={onToggleEpisodeDrawer}
                className="p-2 rounded bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                title="分集列表"
              >
                <ListVideo className="w-4 h-4" />
              </button>
            )}

            {/* Fullscreen */}
            <button
              onClick={onToggleFullscreen}
              className="p-2 rounded hover:bg-white/20 text-white transition cursor-pointer"
              title="全屏切换 (F)"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerOsd;
