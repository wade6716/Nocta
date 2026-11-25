import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  ArrowRight,
  ListMusic,
  Volume2,
  VolumeX,
  Heart,
  Maximize2,
  Music,
  Mic2,
} from 'lucide-react';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import {
  formatAudioQualityBadge,
  formatMusicDuration,
  formatTrackArtists,
  resolveMusicCoverUrl,
  setItemFavorite,
} from '../../api/embyMusicClient';
import { MusicEqualizerBars } from './MusicEqualizerBars';

export const MusicPlayerDock: React.FC = () => {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const sourceServer = useMusicPlayerStore((s) => s.sourceServer);
  const queue = useMusicPlayerStore((s) => s.queue);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isLoading = useMusicPlayerStore((s) => s.isLoading);
  const currentTime = useMusicPlayerStore((s) => s.currentTime);
  const duration = useMusicPlayerStore((s) => s.duration);
  const volume = useMusicPlayerStore((s) => s.volume);
  const muted = useMusicPlayerStore((s) => s.muted);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const error = useMusicPlayerStore((s) => s.error);
  const isQueueOpen = useMusicPlayerStore((s) => s.isQueueOpen);

  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const playNext = useMusicPlayerStore((s) => s.playNext);
  const playPrev = useMusicPlayerStore((s) => s.playPrev);
  const requestSeek = useMusicPlayerStore((s) => s.requestSeek);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);
  const toggleMute = useMusicPlayerStore((s) => s.toggleMute);
  const cyclePlayMode = useMusicPlayerStore((s) => s.cyclePlayMode);
  const setNowPlayingOpen = useMusicPlayerStore((s) => s.setNowPlayingOpen);
  const setQueueOpen = useMusicPlayerStore((s) => s.setQueueOpen);
  const updateTrackFavorite = useMusicPlayerStore((s) => s.updateTrackFavorite);

  const [popHeart, setPopHeart] = useState(false);
  const [draggingPercent, setDraggingPercent] = useState<number | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  if (!currentTrack) return null;

  const coverUrl = sourceServer
    ? resolveMusicCoverUrl(sourceServer.url, currentTrack, { maxWidth: 160, quality: 85 })
    : '';
  const quality = formatAudioQualityBadge(currentTrack);
  const isFav = Boolean(currentTrack.UserData?.IsFavorite);
  const progressPercent =
    draggingPercent !== null
      ? draggingPercent
      : duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;

  const handleToggleFav = async () => {
    if (!sourceServer) return;
    const nextFav = !isFav;
    updateTrackFavorite(currentTrack.Id, nextFav);
    if (nextFav) {
      setPopHeart(true);
      setTimeout(() => setPopHeart(false), 380);
    }
    try {
      await setItemFavorite(
        sourceServer.url,
        sourceServer.userId,
        currentTrack.Id,
        nextFav,
        sourceServer.accessToken
      );
    } catch {
      updateTrackFavorite(currentTrack.Id, isFav);
    }
  };

  const computePercentFromPointer = (clientX: number) => {
    const el = progressBarRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pct = computePercentFromPointer(e.clientX);
    setDraggingPercent(pct);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingPercent === null) return;
    setDraggingPercent(computePercentFromPointer(e.clientX));
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingPercent === null) return;
    const pct = computePercentFromPointer(e.clientX);
    setDraggingPercent(null);
    if (duration > 0) {
      requestSeek((pct / 100) * duration);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const playModeMeta = {
    loop: { icon: Repeat, label: '列表循环' },
    shuffle: { icon: Shuffle, label: '随机播放' },
    single: { icon: Repeat1, label: '单曲循环' },
    sequence: { icon: ArrowRight, label: '顺序播放' },
  }[playMode];
  const PlayModeIcon = playModeMeta.icon;

  return (
    <div className="relative h-[76px] flex-shrink-0 w-full bg-[#0F1422]/95 backdrop-blur-2xl border-t border-white/[0.08] px-4 flex items-center justify-between gap-4 z-30 select-none">
      {/* 顶部微光可拖拽进度条 */}
      <div
        ref={progressBarRef}
        onPointerDown={handleProgressPointerDown}
        onPointerMove={handleProgressPointerMove}
        onPointerUp={handleProgressPointerUp}
        className="group absolute -top-[3px] left-0 right-0 h-2.5 cursor-pointer flex items-center"
        title="拖拽调整播放进度"
      >
        <div className="w-full h-[2.5px] group-hover:h-[4px] bg-white/[0.08] transition-all relative overflow-visible">
          <div
            className="h-full bg-gradient-to-r from-purple-400 via-sky-400 to-cyan-300 relative transition-[width] duration-75"
            style={{ width: `${progressPercent}%` }}
          >
            <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-md shadow-purple-500/50 opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all" />
          </div>
        </div>
      </div>

      {/* 左侧：封面、歌名、歌手、音质与红心 */}
      <div className="flex items-center gap-3 min-w-0 w-[30%] max-w-[360px]">
        <button
          type="button"
          onClick={() => setNowPlayingOpen(true)}
          className="relative w-12 h-12 rounded-xl overflow-hidden bg-[#161D2F] border border-white/[0.1] flex-shrink-0 group cursor-pointer shadow-lg shadow-black/40"
          title="展开沉浸式正在播放界面"
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={currentTrack.Name}
              className={`w-full h-full object-cover transition-transform duration-500 ${
                isPlaying ? 'scale-100' : 'scale-95 brightness-90'
              } group-hover:scale-105`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-500">
              <Music className="w-5 h-5" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Maximize2 className="w-4 h-4 text-white" />
          </div>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setNowPlayingOpen(true)}
              className="text-sm font-semibold text-slate-100 hover:text-purple-300 truncate transition cursor-pointer text-left"
            >
              {currentTrack.Name}
            </button>
            {isPlaying && <MusicEqualizerBars playing className="flex-shrink-0" />}
            {quality && (
              <span
                title={quality.detail}
                className={`hidden xl:inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold flex-shrink-0 border ${
                  quality.isHiRes
                    ? 'bg-amber-500/15 border-amber-400/35 text-amber-300'
                    : quality.isLossless
                    ? 'bg-purple-500/15 border-purple-400/30 text-purple-300'
                    : 'bg-white/[0.06] border-white/[0.08] text-slate-400'
                }`}
              >
                {quality.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 truncate mt-0.5">
            {error ? (
              <span className="text-rose-400 truncate">{error}</span>
            ) : (
              <span className="truncate">{formatTrackArtists(currentTrack)}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleFav}
          className={`p-1.5 rounded-lg hover:bg-white/[0.08] transition cursor-pointer flex-shrink-0 ${
            isFav ? 'text-rose-400' : 'text-slate-400 hover:text-slate-200'
          }`}
          title={isFav ? '取消喜欢' : '添加到我喜欢的'}
        >
          <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''} ${popHeart ? 'animate-heart-pop' : ''}`} />
        </button>
      </div>

      {/* 中部：主播放控制与时间 */}
      <div className="flex flex-col items-center justify-center gap-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cyclePlayMode}
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-purple-300 transition cursor-pointer"
            title={playModeMeta.label}
          >
            <PlayModeIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={playPrev}
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-200 hover:text-white transition cursor-pointer active:scale-95"
            title="上一首"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-gradient-to-r from-purple-500 to-sky-500 hover:from-purple-400 hover:to-sky-400 text-white flex items-center justify-center shadow-lg shadow-purple-500/30 transition cursor-pointer active:scale-95"
            title={isPlaying ? '暂停' : '播放'}
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => playNext(false)}
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-200 hover:text-white transition cursor-pointer active:scale-95"
            title="下一首"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>

          <span className="hidden sm:inline-block text-[11px] font-mono text-slate-400 tabular-nums min-w-[82px] text-center">
            {formatMusicDuration(currentTime)} / {formatMusicDuration(duration)}
          </span>
        </div>
      </div>

      {/* 右侧：全屏歌词入口、队列抽屉、音量控制 */}
      <div className="flex items-center justify-end gap-2 w-[30%] max-w-[320px]">
        <button
          type="button"
          onClick={() => setNowPlayingOpen(true)}
          className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] text-xs text-slate-300 hover:text-white transition cursor-pointer inline-flex items-center gap-1.5"
          title="沉浸式播放与歌词"
        >
          <Mic2 className="w-3.5 h-3.5 text-purple-300" />
          <span className="hidden lg:inline">歌词</span>
        </button>

        <button
          type="button"
          onClick={() => setQueueOpen(!isQueueOpen)}
          className={`px-2.5 py-1.5 rounded-lg border text-xs transition cursor-pointer inline-flex items-center gap-1.5 ${
            isQueueOpen
              ? 'bg-purple-500/20 border-purple-400/40 text-purple-200'
              : 'bg-white/[0.04] hover:bg-white/[0.09] border-white/[0.06] text-slate-300 hover:text-white'
          }`}
          title="播放队列"
        >
          <ListMusic className="w-3.5 h-3.5" />
          <span className="font-mono text-[11px] tabular-nums">{queue.length}</span>
        </button>

        <div className="hidden md:flex items-center gap-1.5 pl-1">
          <button
            type="button"
            onClick={toggleMute}
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
            title={muted ? '取消静音' : '静音'}
          >
            {muted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20 h-1 cursor-pointer accent-purple-400"
            title={`音量 ${Math.round((muted ? 0 : volume) * 100)}%`}
          />
        </div>
      </div>
    </div>
  );
};

export default MusicPlayerDock;
