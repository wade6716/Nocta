import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Heart, ListPlus, Plus, Music } from 'lucide-react';
import { EmbyItem } from '../../api/embyClient';
import {
  formatAudioQualityBadge,
  formatMusicDuration,
  formatTrackArtists,
  getTrackDurationSeconds,
  resolveMusicCoverUrl,
  setItemFavorite,
} from '../../api/embyMusicClient';
import { MusicServerContext, useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { MusicEqualizerBars } from './MusicEqualizerBars';

interface MusicTrackTableProps {
  tracks: EmbyItem[];
  server: MusicServerContext;
  showCover?: boolean;
  showAlbumColumn?: boolean;
  onFavoriteChanged?: (itemId: string, isFavorite: boolean) => void;
}

export const MusicTrackTable: React.FC<MusicTrackTableProps> = ({
  tracks,
  server,
  showCover = false,
  showAlbumColumn = false,
  onFavoriteChanged,
}) => {
  const navigate = useNavigate();
  const currentTrackId = useMusicPlayerStore((s) => s.currentTrack?.Id);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const playTracks = useMusicPlayerStore((s) => s.playTracks);
  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const insertPlayNext = useMusicPlayerStore((s) => s.insertPlayNext);
  const appendToQueue = useMusicPlayerStore((s) => s.appendToQueue);
  const updateTrackFavorite = useMusicPlayerStore((s) => s.updateTrackFavorite);

  const [popHeartId, setPopHeartId] = useState<string | null>(null);
  const [localFavorites, setLocalFavorites] = useState<Record<string, boolean>>({});

  const handleTrackClick = (index: number, track: EmbyItem) => {
    if (currentTrackId === track.Id) {
      togglePlay();
      return;
    }
    playTracks(tracks, index, server);
  };

  const handleToggleFavorite = async (e: React.MouseEvent, track: EmbyItem) => {
    e.stopPropagation();
    const prevFav = localFavorites[track.Id] ?? Boolean(track.UserData?.IsFavorite);
    const nextFav = !prevFav;
    setLocalFavorites((prev) => ({ ...prev, [track.Id]: nextFav }));
    if (nextFav) {
      setPopHeartId(track.Id);
      setTimeout(() => setPopHeartId((id) => (id === track.Id ? null : id)), 400);
    }
    try {
      await setItemFavorite(server.url, server.userId, track.Id, nextFav, server.accessToken);
      updateTrackFavorite(track.Id, nextFav);
      onFavoriteChanged?.(track.Id, nextFav);
    } catch {
      setLocalFavorites((prev) => ({ ...prev, [track.Id]: prevFav }));
    }
  };

  if (tracks.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        暂无曲目
      </div>
    );
  }

  return (
    <div className="w-full space-y-1">
      {tracks.map((track, idx) => {
        const isCurrent = currentTrackId === track.Id;
        const isFav = localFavorites[track.Id] ?? Boolean(track.UserData?.IsFavorite);
        const quality = formatAudioQualityBadge(track);
        const durationSec = getTrackDurationSeconds(track);
        const coverUrl = showCover
          ? resolveMusicCoverUrl(server.url, track, { maxWidth: 120, quality: 80 })
          : '';

        return (
          <div
            key={`${track.Id}-${idx}`}
            onClick={() => handleTrackClick(idx, track)}
            className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer border ${
              isCurrent
                ? 'bg-purple-500/12 border-purple-400/25 text-white'
                : 'border-transparent hover:bg-white/[0.05] text-slate-200'
            }`}
          >
            {/* 序号 / 音柱 / 播放按钮 */}
            <div className="w-8 flex items-center justify-center flex-shrink-0">
              {isCurrent ? (
                <>
                  <div className="group-hover:hidden">
                    <MusicEqualizerBars playing={isPlaying} />
                  </div>
                  <div className="hidden group-hover:flex items-center justify-center text-purple-300">
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </div>
                </>
              ) : (
                <>
                  <span className="text-xs font-mono text-slate-500 tabular-nums group-hover:hidden">
                    {track.IndexNumber ?? idx + 1}
                  </span>
                  <Play className="w-4 h-4 text-white fill-current hidden group-hover:block" />
                </>
              )}
            </div>

            {/* 可选封面 */}
            {showCover && (
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#131826] border border-white/[0.08] flex-shrink-0 flex items-center justify-center">
                {coverUrl ? (
                  <img src={coverUrl} alt={track.Name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <Music className="w-4 h-4 text-slate-500" />
                )}
              </div>
            )}

            {/* 歌名与歌手 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`text-sm font-medium truncate ${
                    isCurrent ? 'text-purple-300 font-semibold' : 'text-slate-100 group-hover:text-white'
                  }`}
                >
                  {track.Name}
                </span>
                {quality && (
                  <span
                    title={quality.detail}
                    className={`hidden sm:inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold flex-shrink-0 border ${
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
              <div className="text-xs text-slate-400 truncate mt-0.5">
                {formatTrackArtists(track)}
              </div>
            </div>

            {/* 专辑名 */}
            {showAlbumColumn && (
              <div className="hidden md:block w-48 min-w-0">
                {track.Album ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (track.AlbumId) navigate(`/music/album/${track.AlbumId}`);
                    }}
                    className="text-xs text-slate-400 hover:text-purple-300 truncate block max-w-full text-left transition cursor-pointer"
                  >
                    {track.Album}
                  </button>
                ) : (
                  <span className="text-xs text-slate-600">-</span>
                )}
              </div>
            )}

            {/* 操作按钮组 */}
            <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => handleToggleFavorite(e, track)}
                className={`p-1.5 rounded-lg hover:bg-white/[0.08] transition cursor-pointer ${
                  isFav ? 'text-rose-400' : 'text-slate-500 hover:text-slate-200'
                }`}
                title={isFav ? '取消喜欢' : '添加到我喜欢的'}
              >
                <Heart
                  className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''} ${
                    popHeartId === track.Id ? 'animate-heart-pop' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  insertPlayNext(track, server);
                }}
                className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                title="下一首播放"
              >
                <ListPlus className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  appendToQueue([track], server);
                }}
                className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                title="添加到播放队列"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 时长 */}
            <div className="w-12 text-right text-xs font-mono text-slate-400 tabular-nums flex-shrink-0">
              {formatMusicDuration(durationSec)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MusicTrackTable;
