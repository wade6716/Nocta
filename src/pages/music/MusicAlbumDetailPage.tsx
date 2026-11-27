import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Disc3, Heart, Play, Shuffle } from 'lucide-react';
import { EmbyItem } from '../../api/embyClient';
import {
  formatAudioQualityBadge,
  formatMusicDuration,
  formatTrackArtists,
  getAlbumTracks,
  getMusicItemDetail,
  getTrackDurationSeconds,
  resolveMusicCoverUrl,
  setItemFavorite,
} from '../../api/embyMusicClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { MusicServerContext, useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { MusicTrackTable } from '../../components/music/MusicTrackTable';
import {
  MusicDetailSkeleton,
  MusicTrackTableSkeleton,
} from '../../components/common/Skeletons';
import { buildServerScopedKey, musicDetailCache } from '../../services/pageCache';

export const MusicAlbumDetailPage: React.FC = () => {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const playTracks = useMusicPlayerStore((s) => s.playTracks);

  const routePreview = (location.state as { previewItem?: EmbyItem } | null)?.previewItem ?? null;
  const cacheKey =
    currentServer?.id && albumId
      ? buildServerScopedKey(currentServer.id, 'album', albumId)
      : null;
  const initialCache = cacheKey ? musicDetailCache.get(cacheKey)?.data : null;
  const initialPreview =
    initialCache?.detail || (routePreview?.Id === albumId ? routePreview : null);

  const [album, setAlbum] = useState<EmbyItem | null>(initialPreview);
  const [tracks, setTracks] = useState<EmbyItem[]>(() => initialCache?.tracks ?? []);
  const [loading, setLoading] = useState(!initialPreview);
  const [tracksLoading, setTracksLoading] = useState(!initialCache?.tracks);
  const [isFav, setIsFav] = useState(() => Boolean(initialPreview?.UserData?.IsFavorite));
  const reqIdRef = useRef(0);

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
    if (!currentServer || !albumId) {
      navigate('/music');
      return;
    }
    const reqId = ++reqIdRef.current;
    const isStale = () => reqId !== reqIdRef.current;
    const key = buildServerScopedKey(currentServer.id, 'album', albumId);
    const cached = musicDetailCache.get(key)?.data;
    const preview =
      cached?.detail || (routePreview?.Id === albumId ? routePreview : null);

    setAlbum(preview);
    setIsFav(Boolean(preview?.UserData?.IsFavorite));
    setTracks(cached?.tracks ?? []);
    setLoading(!preview);
    setTracksLoading(!cached?.tracks);

    let nextDetail: EmbyItem | undefined = cached?.detail;
    let nextTracks: EmbyItem[] | undefined = cached?.tracks;
    const flush = () => {
      if (!isStale() && nextDetail) {
        musicDetailCache.set(key, { detail: nextDetail, tracks: nextTracks });
      }
    };

    getMusicItemDetail(currentServer.url, currentServer.userId, albumId, currentServer.accessToken)
      .then((detail) => {
        if (isStale()) return;
        nextDetail = detail;
        setAlbum(detail);
        setIsFav(Boolean(detail.UserData?.IsFavorite));
        setLoading(false);
        flush();
      })
      .catch((err) => {
        console.error(err);
        if (!isStale()) setLoading(false);
      });

    getAlbumTracks(currentServer.url, currentServer.userId, albumId, currentServer.accessToken)
      .then((trackList) => {
        if (isStale()) return;
        nextTracks = trackList;
        setTracks(trackList);
        flush();
      })
      .catch(console.error)
      .finally(() => {
        if (!isStale()) setTracksLoading(false);
      });

    return () => {
      reqIdRef.current += 1;
    };
  }, [albumId, currentServer?.id, navigate]);

  const totalDurationSec = useMemo(
    () => tracks.reduce((sum, t) => sum + getTrackDurationSeconds(t), 0),
    [tracks]
  );

  const qualityBadge = useMemo(
    () => formatAudioQualityBadge(tracks[0] || album),
    [tracks, album]
  );

  // 按多碟片分组
  const discGroups = useMemo(() => {
    const map = new Map<number, EmbyItem[]>();
    for (const t of tracks) {
      const disc = t.ParentIndexNumber || t.DiscNumber || 1;
      if (!map.has(disc)) map.set(disc, []);
      map.get(disc)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [tracks]);

  if (loading || !album || !serverCtx) {
    return <MusicDetailSkeleton variant="album" onBack={() => navigate(-1)} />;
  }

  const coverUrl = resolveMusicCoverUrl(currentServer!.url, album, { maxWidth: 700, quality: 90 });
  const primaryArtistId = album.AlbumArtists?.[0]?.Id || album.ArtistItems?.[0]?.Id;

  const handleToggleAlbumFavorite = async () => {
    const next = !isFav;
    setIsFav(next);
    try {
      await setItemFavorite(
        currentServer!.url,
        currentServer!.userId,
        album.Id,
        next,
        currentServer!.accessToken
      );
    } catch {
      setIsFav(!next);
    }
  };

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
          <div className="w-52 h-52 sm:w-60 sm:h-60 rounded-3xl overflow-hidden bg-[#141828] border border-white/[0.14] shadow-2xl flex-shrink-0">
            {coverUrl ? (
              <img src={coverUrl} alt={album.Name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500">
                <Disc3 className="w-16 h-16" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            <span className="inline-block text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300">
              专辑
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {album.Name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <button
                type="button"
                onClick={() => primaryArtistId && navigate(`/music/artist/${primaryArtistId}`)}
                className={`font-semibold ${
                  primaryArtistId ? 'hover:text-purple-300 cursor-pointer' : 'cursor-default'
                }`}
              >
                {formatTrackArtists(album)}
              </button>
              {album.ProductionYear && <span className="text-slate-500">· {album.ProductionYear}</span>}
              <span className="text-slate-500">· {tracks.length} 首曲目</span>
              {totalDurationSec > 0 && (
                <span className="text-slate-500 font-mono text-xs">
                  · {formatMusicDuration(totalDurationSec)}
                </span>
              )}
              {qualityBadge && (
                <span className="px-2 py-0.5 rounded bg-white/[0.08] border border-white/[0.1] text-[11px] font-mono text-purple-200">
                  {qualityBadge.label}
                </span>
              )}
            </div>

            {album.Overview && (
              <p className="text-xs text-slate-300/90 leading-relaxed max-w-2xl line-clamp-3">
                {album.Overview}
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

              <button
                onClick={handleToggleAlbumFavorite}
                className={`p-2.5 rounded-full border transition cursor-pointer ${
                  isFav
                    ? 'bg-rose-500/20 border-rose-400/40 text-rose-400'
                    : 'bg-white/[0.06] border-white/[0.1] text-slate-300 hover:text-white'
                }`}
                title={isFav ? '取消收藏专辑' : '收藏专辑'}
              >
                <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* 曲目列表 */}
        <div className="pt-4 space-y-6">
          {tracksLoading && tracks.length === 0 ? (
            <MusicTrackTableSkeleton rows={8} />
          ) : discGroups.length > 1 ? (
            discGroups.map(([discNo, discTracks]) => (
              <div key={discNo} className="space-y-2">
                <div className="px-3 text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Disc3 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Disc {discNo}</span>
                </div>
                <MusicTrackTable tracks={discTracks} server={serverCtx} />
              </div>
            ))
          ) : (
            <MusicTrackTable tracks={tracks} server={serverCtx} />
          )}
        </div>
      </div>
    </div>
  );
};

export default MusicAlbumDetailPage;
