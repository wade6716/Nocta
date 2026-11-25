import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Disc3, Mic2, Play } from 'lucide-react';
import { EmbyItem } from '../../api/embyClient';
import {
  getArtistAlbums,
  getArtistTopTracks,
  getMusicItemDetail,
  resolveMusicCoverUrl,
} from '../../api/embyMusicClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { MusicServerContext, useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { MusicTrackTable } from '../../components/music/MusicTrackTable';

export const MusicArtistDetailPage: React.FC = () => {
  const { artistId } = useParams<{ artistId: string }>();
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const playTracks = useMusicPlayerStore((s) => s.playTracks);

  const [artist, setArtist] = useState<EmbyItem | null>(null);
  const [topTracks, setTopTracks] = useState<EmbyItem[]>([]);
  const [albums, setAlbums] = useState<EmbyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bioExpanded, setBioExpanded] = useState(false);

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
    if (!currentServer || !artistId) {
      navigate('/music');
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getMusicItemDetail(currentServer.url, currentServer.userId, artistId, currentServer.accessToken),
      getArtistTopTracks(currentServer.url, currentServer.userId, artistId, currentServer.accessToken, 10),
      getArtistAlbums(currentServer.url, currentServer.userId, artistId, currentServer.accessToken),
    ])
      .then(([detail, tracks, albumList]) => {
        if (cancelled) return;
        setArtist(detail);
        setTopTracks(tracks);
        setAlbums(albumList);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [artistId, currentServer?.id, navigate]);

  if (loading || !artist || !serverCtx) {
    return (
      <div className="py-32 flex justify-center">
        <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const avatarUrl = resolveMusicCoverUrl(currentServer!.url, artist, { maxWidth: 600, quality: 90 });

  return (
    <div className="w-full pb-20 px-8 pt-6 select-none relative min-h-full">
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          className="fixed inset-0 -z-10 w-full h-full object-cover opacity-20 blur-3xl scale-110 pointer-events-none"
        />
      )}

      <div className="max-w-6xl mx-auto space-y-10">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-200 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回</span>
        </button>

        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-7">
          <div className="w-44 h-44 rounded-full overflow-hidden bg-[#141828] border-2 border-white/[0.15] shadow-2xl flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={artist.Name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500">
                <Mic2 className="w-14 h-14" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-3 text-center sm:text-left">
            <span className="inline-block text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300">
              艺术家
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">{artist.Name}</h1>
            {artist.Overview && (
              <div>
                <p
                  className={`text-xs text-slate-300 leading-relaxed max-w-2xl ${
                    bioExpanded ? '' : 'line-clamp-3'
                  }`}
                >
                  {artist.Overview}
                </p>
                {artist.Overview.length > 100 && (
                  <button
                    onClick={() => setBioExpanded((v) => !v)}
                    className="mt-1 text-xs text-purple-300 hover:text-purple-200 cursor-pointer"
                  >
                    {bioExpanded ? '收起' : '展开简介'}
                  </button>
                )}
              </div>
            )}
            {topTracks.length > 0 && (
              <div className="pt-1">
                <button
                  onClick={() => playTracks(topTracks, 0, serverCtx)}
                  className="px-6 py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-sky-500 hover:from-purple-400 hover:to-sky-400 text-white text-xs font-bold shadow-lg shadow-purple-500/25 inline-flex items-center gap-2 cursor-pointer transition"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>播放热门歌曲</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {topTracks.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">热门曲目</h2>
            <MusicTrackTable tracks={topTracks} server={serverCtx} showCover showAlbumColumn />
          </section>
        )}

        {albums.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-white">全部专辑 ({albums.length})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
              {albums.map((alb) => {
                const cover = resolveMusicCoverUrl(currentServer!.url, alb, {
                  maxWidth: 400,
                  quality: 85,
                });
                return (
                  <div
                    key={alb.Id}
                    onClick={() => navigate(`/music/album/${alb.Id}`)}
                    className="group cursor-pointer transition-transform duration-200 hover:-translate-y-1"
                  >
                    <div className="aspect-square rounded-2xl overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45 shadow-lg">
                      {cover ? (
                        <img
                          src={cover}
                          alt={alb.Name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                          <Disc3 className="w-10 h-10" />
                        </div>
                      )}
                    </div>
                    <h3 className="mt-2.5 text-sm font-medium text-slate-100 truncate group-hover:text-purple-300 transition">
                      {alb.Name}
                    </h3>
                    {alb.ProductionYear && (
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">{alb.ProductionYear}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default MusicArtistDetailPage;
