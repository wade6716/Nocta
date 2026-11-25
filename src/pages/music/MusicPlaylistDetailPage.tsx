import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ListMusic, Play, Shuffle } from 'lucide-react';
import { EmbyItem } from '../../api/embyClient';
import {
  formatMusicDuration,
  getMusicItemDetail,
  getPlaylistTracks,
  getTrackDurationSeconds,
  resolveMusicCoverUrl,
} from '../../api/embyMusicClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { MusicServerContext, useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { MusicTrackTable } from '../../components/music/MusicTrackTable';

export const MusicPlaylistDetailPage: React.FC = () => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const playTracks = useMusicPlayerStore((s) => s.playTracks);

  const [playlist, setPlaylist] = useState<EmbyItem | null>(null);
  const [tracks, setTracks] = useState<EmbyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const serverCtx: MusicServerContext | null = useMemo(() => {
    if (!currentServer) return null;
    return {
      id: currentServer.id,
      name: currentServer.name,
      url: currentServer.url,
      userId: currentServer.userId,
      accessToken: currentServer.accessToken,
    };
  }, [currentServer]);

  useEffect(() => {
    if (!currentServer || !playlistId) {
      navigate('/music');
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getMusicItemDetail(currentServer.url, currentServer.userId, playlistId, currentServer.accessToken),
      getPlaylistTracks(currentServer.url, currentServer.userId, playlistId, currentServer.accessToken),
    ])
      .then(([detail, list]) => {
        if (cancelled) return;
        setPlaylist(detail);
        setTracks(list);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playlistId, currentServer?.id, navigate]);

  const totalSec = useMemo(
    () => tracks.reduce((sum, t) => sum + getTrackDurationSeconds(t), 0),
    [tracks]
  );

  if (loading || !playlist || !serverCtx) {
    return (
      <div className="py-32 flex justify-center">
        <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const coverUrl = resolveMusicCoverUrl(currentServer!.url, playlist, {
    maxWidth: 600,
    quality: 90,
  });

  return (
    <div className="w-full pb-20 px-8 pt-6 select-none relative min-h-full">
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          aria-hidden="true"
          className="fixed inset-0 -z-10 w-full h-full object-cover opacity-20 blur-3xl scale-110 pointer-events-none"
        />
      )}

      <div className="max-w-6xl mx-auto space-y-8">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-200 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回</span>
        </button>

        <div className="flex flex-col md:flex-row items-start md:items-end gap-8">
          <div className="w-52 h-52 rounded-3xl overflow-hidden bg-[#141828] border border-white/[0.14] shadow-2xl flex-shrink-0">
            {coverUrl ? (
              <img src={coverUrl} alt={playlist.Name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500">
                <ListMusic className="w-16 h-16" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            <span className="inline-block text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300">
              歌单
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">{playlist.Name}</h1>
            <div className="text-sm text-slate-400">
              {tracks.length} 首歌曲
              {totalSec > 0 ? ` · ${formatMusicDuration(totalSec)}` : ''}
            </div>
            {playlist.Overview && (
              <p className="text-xs text-slate-300 leading-relaxed max-w-2xl line-clamp-3">
                {playlist.Overview}
              </p>
            )}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={() => tracks.length > 0 && playTracks(tracks, 0, serverCtx)}
                disabled={tracks.length === 0}
                className="px-6 py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-sky-500 hover:from-purple-400 hover:to-sky-400 text-white text-xs font-bold shadow-lg shadow-purple-500/25 inline-flex items-center gap-2 cursor-pointer transition disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>播放全部</span>
              </button>
              <button
                onClick={() => {
                  if (tracks.length === 0) return;
                  const shuffled = [...tracks].sort(() => Math.random() - 0.5);
                  playTracks(shuffled, 0, serverCtx);
                }}
                disabled={tracks.length === 0}
                className="px-5 py-2.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-slate-100 text-xs font-medium inline-flex items-center gap-2 cursor-pointer transition"
              >
                <Shuffle className="w-4 h-4 text-purple-300" />
                <span>随机播放</span>
              </button>
            </div>
          </div>
        </div>

        <MusicTrackTable tracks={tracks} server={serverCtx} showCover showAlbumColumn />
      </div>
    </div>
  );
};

export default MusicPlaylistDetailPage;
