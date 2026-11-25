import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Disc3,
  Heart,
  Image as ImageIcon,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  ArrowRight,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
} from 'lucide-react';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import {
  formatAudioQualityBadge,
  formatMusicDuration,
  formatTrackArtists,
  getAudioLyrics,
  resolveMusicCoverUrl,
  setItemFavorite,
} from '../../api/embyMusicClient';
import { findActiveLyricIndex, LyricLine } from '../../music/lyricsUtils';

export const NowPlayingOverlay: React.FC = () => {
  const isNowPlayingOpen = useMusicPlayerStore((s) => s.isNowPlayingOpen);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const sourceServer = useMusicPlayerStore((s) => s.sourceServer);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isLoading = useMusicPlayerStore((s) => s.isLoading);
  const currentTime = useMusicPlayerStore((s) => s.currentTime);
  const duration = useMusicPlayerStore((s) => s.duration);
  const volume = useMusicPlayerStore((s) => s.volume);
  const muted = useMusicPlayerStore((s) => s.muted);
  const playMode = useMusicPlayerStore((s) => s.playMode);
  const visualMode = useMusicPlayerStore((s) => s.nowPlayingVisualMode);

  const setNowPlayingOpen = useMusicPlayerStore((s) => s.setNowPlayingOpen);
  const setNowPlayingVisualMode = useMusicPlayerStore((s) => s.setNowPlayingVisualMode);
  const setQueueOpen = useMusicPlayerStore((s) => s.setQueueOpen);
  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const playNext = useMusicPlayerStore((s) => s.playNext);
  const playPrev = useMusicPlayerStore((s) => s.playPrev);
  const requestSeek = useMusicPlayerStore((s) => s.requestSeek);
  const cyclePlayMode = useMusicPlayerStore((s) => s.cyclePlayMode);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);
  const toggleMute = useMusicPlayerStore((s) => s.toggleMute);
  const updateTrackFavorite = useMusicPlayerStore((s) => s.updateTrackFavorite);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [popHeart, setPopHeart] = useState(false);
  const [manualScrolling, setManualScrolling] = useState(false);

  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const manualScrollTimerRef = useRef<number | null>(null);

  // Escape 关闭沉浸播放页
  useEffect(() => {
    if (!isNowPlayingOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNowPlayingOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isNowPlayingOpen, setNowPlayingOpen]);

  // 加载当前歌曲 LRC 歌词
  useEffect(() => {
    if (!isNowPlayingOpen || !currentTrack || !sourceServer) return;
    let cancelled = false;
    setLyricsLoading(true);
    getAudioLyrics(sourceServer.url, sourceServer.userId, currentTrack.Id, sourceServer.accessToken)
      .then((lines) => {
        if (!cancelled) setLyrics(lines);
      })
      .catch(() => {
        if (!cancelled) setLyrics([]);
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNowPlayingOpen, currentTrack?.Id, sourceServer?.id]);

  const activeLyricIdx = useMemo(
    () => findActiveLyricIndex(lyrics, currentTime),
    [lyrics, currentTime]
  );

  // 自动滚动当前歌词到中央焦点区域
  useEffect(() => {
    if (!isNowPlayingOpen || manualScrolling || activeLyricIdx < 0) return;
    const container = lyricsContainerRef.current;
    const lineEl = activeLineRef.current;
    if (!container || !lineEl) return;

    const targetTop = lineEl.offsetTop - container.clientHeight / 2 + lineEl.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [isNowPlayingOpen, activeLyricIdx, manualScrolling]);

  if (!isNowPlayingOpen || !currentTrack) return null;

  const coverUrl = sourceServer
    ? resolveMusicCoverUrl(sourceServer.url, currentTrack, { maxWidth: 900, quality: 92 })
    : '';
  const quality = formatAudioQualityBadge(currentTrack);
  const isFav = Boolean(currentTrack.UserData?.IsFavorite);
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

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

  const handleManualWheel = () => {
    setManualScrolling(true);
    if (manualScrollTimerRef.current) {
      window.clearTimeout(manualScrollTimerRef.current);
    }
    manualScrollTimerRef.current = window.setTimeout(() => {
      setManualScrolling(false);
    }, 3500);
  };

  const playModeMeta = {
    loop: { icon: Repeat, label: '列表循环' },
    shuffle: { icon: Shuffle, label: '随机播放' },
    single: { icon: Repeat1, label: '单曲循环' },
    sequence: { icon: ArrowRight, label: '顺序播放' },
  }[playMode];
  const PlayModeIcon = playModeMeta.icon;

  return (
    <div className="fixed inset-0 z-50 bg-[#080B13] text-slate-100 flex flex-col overflow-hidden select-none animate-music-overlay-in">
      {/* 动态流光氛围背景 */}
      {coverUrl && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            key={coverUrl}
            src={coverUrl}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover opacity-35 blur-[95px] saturate-150 animate-ambient-drift"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#080B13]/60 via-[#080B13]/55 to-[#080B13]/92" />
        </div>
      )}

      {/* 顶部栏 */}
      <header
        data-tauri-drag-region
        className="relative z-10 h-16 px-6 flex items-center justify-between"
      >
        <button
          type="button"
          onClick={() => setNowPlayingOpen(false)}
          className="p-2.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-slate-200 hover:text-white transition cursor-pointer"
          title="收起正在播放 (Esc)"
        >
          <ChevronDown className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 px-1 py-1 rounded-full bg-white/[0.06] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setNowPlayingVisualMode('cover')}
            className={`px-3 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              visualMode === 'cover'
                ? 'bg-white/[0.14] text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>封面</span>
          </button>
          <button
            type="button"
            onClick={() => setNowPlayingVisualMode('vinyl')}
            className={`px-3 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              visualMode === 'vinyl'
                ? 'bg-white/[0.14] text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>黑胶</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setQueueOpen(true)}
          className="p-2.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-slate-200 hover:text-white transition cursor-pointer"
          title="打开播放队列"
        >
          <ListMusic className="w-5 h-5" />
        </button>
      </header>

      {/* 主体左右分栏：左侧主视觉 + 控制，右侧焦点歌词 */}
      <div className="relative z-10 flex-1 min-h-0 max-w-6xl w-full mx-auto px-8 pb-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* 左侧：专辑封面 / 黑胶唱片 + 曲目信息 + 播控 */}
        <div className="lg:col-span-5 flex flex-col items-center lg:items-start">
          {/* 视觉展示区 */}
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 flex items-center justify-center mb-7">
            {visualMode === 'cover' ? (
              <div
                className={`w-full h-full rounded-3xl overflow-hidden border border-white/[0.14] bg-[#141A29] shadow-2xl shadow-black/70 transition-transform duration-500 ease-out ${
                  isPlaying ? 'scale-100' : 'scale-[0.92] brightness-90'
                }`}
              >
                {coverUrl ? (
                  <img src={coverUrl} alt={currentTrack.Name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-500">
                    <Music className="w-16 h-16" />
                  </div>
                )}
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center">
                {/* 唱针臂 */}
                <div
                  className={`absolute -top-3 right-6 z-20 origin-top-right transition-transform duration-500 ease-out pointer-events-none ${
                    isPlaying ? 'rotate-[22deg]' : 'rotate-0'
                  }`}
                >
                  <div className="w-3.5 h-3.5 rounded-full bg-slate-300 border-2 border-slate-500 shadow" />
                  <div className="w-1 h-24 bg-gradient-to-b from-slate-300 to-slate-400 mx-auto rounded-full -mt-1 origin-top" />
                  <div className="w-3 h-4 bg-slate-200 rounded-sm mx-auto -mt-1 shadow" />
                </div>

                {/* 黑胶唱片圆盘 */}
                <div
                  className="w-64 h-64 sm:w-76 sm:h-76 rounded-full p-7 bg-[radial-gradient(circle_at_center,#1b1f2a_0%,#0b0d13_55%,#171b24_57%,#090b10_100%)] border border-white/15 shadow-2xl shadow-black/80 flex items-center justify-center animate-vinyl-spin"
                  style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                >
                  <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-full overflow-hidden border-4 border-black/70 shadow-inner bg-[#141A29] flex items-center justify-center">
                    {coverUrl ? (
                      <img src={coverUrl} alt={currentTrack.Name} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-10 h-10 text-slate-500" />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 曲目名称、歌手、音质与红心 */}
          <div className="w-full max-w-sm flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold text-white truncate tracking-tight">
                {currentTrack.Name}
              </h2>
              <p className="text-sm text-slate-300 truncate mt-1">
                {formatTrackArtists(currentTrack)}
                {currentTrack.Album ? ` · ${currentTrack.Album}` : ''}
              </p>
              {quality && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.1] text-[11px] font-mono text-purple-200">
                  <span>{quality.label}</span>
                  {quality.detail && <span className="text-slate-400">· {quality.detail}</span>}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleToggleFav}
              className={`p-2 rounded-full hover:bg-white/[0.1] transition cursor-pointer ${
                isFav ? 'text-rose-400' : 'text-slate-400 hover:text-white'
              }`}
              title={isFav ? '取消喜欢' : '添加到我喜欢的'}
            >
              <Heart className={`w-5 h-5 ${isFav ? 'fill-current' : ''} ${popHeart ? 'animate-heart-pop' : ''}`} />
            </button>
          </div>

          {/* 进度条 */}
          <div className="w-full max-w-sm space-y-1.5 mb-5">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.5}
              value={Math.min(currentTime, duration > 0 ? duration : 1)}
              onChange={(e) => requestSeek(parseFloat(e.target.value))}
              className="w-full h-1.5 cursor-pointer accent-purple-400"
            />
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
              <span>{formatMusicDuration(currentTime)}</span>
              <span>{formatMusicDuration(duration)}</span>
            </div>
          </div>

          {/* 控制按钮组 */}
          <div className="w-full max-w-sm flex items-center justify-between">
            <button
              type="button"
              onClick={cyclePlayMode}
              className="p-2 rounded-full hover:bg-white/[0.08] text-slate-300 hover:text-purple-300 transition cursor-pointer"
              title={playModeMeta.label}
            >
              <PlayModeIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={playPrev}
                className="p-2.5 rounded-full hover:bg-white/[0.08] text-white transition cursor-pointer active:scale-95"
                title="上一首"
              >
                <SkipBack className="w-6 h-6 fill-current" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-white text-slate-950 hover:scale-105 transition-transform flex items-center justify-center shadow-xl shadow-white/20 cursor-pointer active:scale-95"
                title={isPlaying ? '暂停' : '播放'}
              >
                {isLoading ? (
                  <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => playNext(false)}
                className="p-2.5 rounded-full hover:bg-white/[0.08] text-white transition cursor-pointer active:scale-95"
                title="下一首"
              >
                <SkipForward className="w-6 h-6 fill-current" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="p-2 rounded-full hover:bg-white/[0.08] text-slate-300 hover:text-white transition cursor-pointer"
                title={muted ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-16 h-1 cursor-pointer accent-purple-400"
              />
            </div>
          </div>
        </div>

        {/* 右侧：Apple Music 风格焦点滚动歌词 */}
        <div
          ref={lyricsContainerRef}
          onWheel={handleManualWheel}
          className="lg:col-span-7 h-[42vh] lg:h-[68vh] overflow-y-auto px-4 custom-scrollbar flex flex-col"
        >
          {lyricsLoading ? (
            <div className="m-auto text-sm text-slate-400 animate-pulse">正在匹配同步歌词...</div>
          ) : lyrics.length > 0 ? (
            <div className="py-[24vh] space-y-5">
              {lyrics.map((line, idx) => {
                const isActive = idx === activeLyricIdx;
                return (
                  <button
                    key={`${line.time}-${idx}`}
                    ref={isActive ? activeLineRef : undefined}
                    type="button"
                    onClick={() => requestSeek(line.time)}
                    className={`block w-full text-left transition-all duration-300 ease-out cursor-pointer rounded-xl px-3 py-1.5 hover:bg-white/[0.04] ${
                      isActive
                        ? 'text-2xl sm:text-3xl font-bold text-white scale-[1.02] origin-left drop-shadow-md'
                        : 'text-lg sm:text-xl font-medium text-slate-400/65 hover:text-slate-200'
                    }`}
                  >
                    {line.text}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="m-auto text-center space-y-3 max-w-md">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/[0.1] mx-auto flex items-center justify-center text-slate-400">
                <Music className="w-7 h-7" />
              </div>
              <p className="text-base font-semibold text-slate-200">纯音乐或暂未匹配到时间轴歌词</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Emby 服务端若在同目录放置同名 `.lrc` 文件并启用歌词插件，此处将自动呈现逐句焦点滚动歌词。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 底部进度百分比微光指示 */}
      <div className="relative z-10 h-1 w-full bg-white/[0.04]">
        <div
          className="h-full bg-gradient-to-r from-purple-500 via-sky-400 to-cyan-300 transition-[width] duration-150"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
};

export default NowPlayingOverlay;
