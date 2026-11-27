import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Disc3, Heart, ListMusic, Mic2, Play, Shuffle } from 'lucide-react';
import { EmbyItem } from '../../api/embyClient';
import {
  formatTrackArtists,
  getFavoriteMusicSongs,
  getMusicAlbums,
  getMusicArtists,
  getMusicPlaylists,
  resolveMusicCoverUrl,
} from '../../api/embyMusicClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useMediaStore } from '../../stores/useMediaStore';
import { MusicServerContext, useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { MusicTrackTable } from '../../components/music/MusicTrackTable';
import {
  MusicTrackTableSkeleton,
  PosterGridSkeleton,
} from '../../components/common/Skeletons';
import { buildServerScopedKey, musicBrowseCache } from '../../services/pageCache';

export type MusicBrowseMode = 'albums' | 'artists' | 'playlists' | 'favorites' | 'library';

export const MusicBrowsePage: React.FC<{ mode: MusicBrowseMode }> = ({ mode }) => {
  const { libraryId } = useParams<{ libraryId?: string }>();
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const musicViews = useMediaStore((s) => s.musicViews);
  const playTracks = useMusicPlayerStore((s) => s.playTracks);

  const [items, setItems] = useState<EmbyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<'DateCreated' | 'SortName' | 'ProductionYear'>('DateCreated');
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

  const currentLibName = useMemo(() => {
    if (mode !== 'library' || !libraryId) return '';
    return musicViews.find((v) => v.Id === libraryId)?.Name || '音乐库';
  }, [mode, libraryId, musicViews]);

  const titleMap: Record<MusicBrowseMode, { title: string; icon: React.ReactNode }> = {
    albums: { title: '全部专辑', icon: <Disc3 className="w-5 h-5 text-purple-400" /> },
    artists: { title: '全部歌手', icon: <Mic2 className="w-5 h-5 text-purple-400" /> },
    playlists: { title: '歌单', icon: <ListMusic className="w-5 h-5 text-purple-400" /> },
    favorites: { title: '我喜欢的音乐', icon: <Heart className="w-5 h-5 text-rose-400" /> },
    library: { title: currentLibName || '音乐库', icon: <Disc3 className="w-5 h-5 text-purple-400" /> },
  };

  const fetchPage = useCallback(
    async (startIndex: number, append: boolean) => {
      if (!currentServer) return;
      const reqId = ++reqIdRef.current;
      const cacheKey = buildServerScopedKey(currentServer.id, mode, libraryId, sortBy);

      if (append) {
        setLoadingMore(true);
      } else {
        const cached = musicBrowseCache.get(cacheKey);
        if (cached) {
          setItems(cached.data.items);
          setTotal(cached.data.total);
          setLoading(false);
        } else {
          setLoading(true);
        }
      }

      try {
        let res: { Items: EmbyItem[]; TotalRecordCount: number };
        const sortOrder = sortBy === 'SortName' ? 'Ascending' : 'Descending';

        if (mode === 'artists') {
          res = await getMusicArtists(currentServer.url, currentServer.userId, currentServer.accessToken, {
            sortBy: sortBy === 'DateCreated' ? 'SortName' : sortBy,
            sortOrder: sortBy === 'DateCreated' ? 'Ascending' : sortOrder,
            startIndex,
            limit: 48,
          });
        } else if (mode === 'playlists') {
          res = await getMusicPlaylists(currentServer.url, currentServer.userId, currentServer.accessToken, {
            startIndex,
            limit: 48,
          });
        } else if (mode === 'favorites') {
          res = await getFavoriteMusicSongs(
            currentServer.url,
            currentServer.userId,
            currentServer.accessToken,
            { startIndex, limit: 100 }
          );
        } else {
          res = await getMusicAlbums(currentServer.url, currentServer.userId, currentServer.accessToken, {
            parentId: mode === 'library' ? libraryId : undefined,
            sortBy,
            sortOrder,
            startIndex,
            limit: 48,
          });
        }

        if (reqId !== reqIdRef.current) return;
        const fetched = res.Items || [];
        const nextTotal = res.TotalRecordCount || fetched.length;
        setTotal(nextTotal);
        setItems((prev) => (append ? [...prev, ...fetched] : fetched));
        if (!append) {
          musicBrowseCache.set(cacheKey, { items: fetched, total: nextTotal });
        }
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [currentServer, mode, libraryId, sortBy]
  );

  useEffect(() => {
    if (!currentServer) {
      navigate('/login');
      return;
    }
    fetchPage(0, false);
  }, [currentServer?.id, mode, libraryId, sortBy, fetchPage, navigate]);

  const handlePlayAllFavorites = () => {
    if (!serverCtx || items.length === 0) return;
    playTracks(items, 0, serverCtx);
  };

  const handleShuffleFavorites = () => {
    if (!serverCtx || items.length === 0) return;
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    playTracks(shuffled, 0, serverCtx);
  };

  return (
    <div className="w-full py-6 px-8 select-none space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          {titleMap[mode].icon}
          <h1 className="text-xl font-bold text-white">{titleMap[mode].title}</h1>
          {total > 0 && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 tabular-nums">
              {total}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {mode === 'favorites' && items.length > 0 && (
            <>
              <button
                onClick={handlePlayAllFavorites}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-purple-500 to-sky-500 hover:from-purple-400 hover:to-sky-400 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>播放全部</span>
              </button>
              <button
                onClick={handleShuffleFavorites}
                className="px-4 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition"
              >
                <Shuffle className="w-3.5 h-3.5 text-purple-300" />
                <span>随机播放</span>
              </button>
            </>
          )}

          {(mode === 'albums' || mode === 'library') && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs">
              {[
                { key: 'DateCreated', label: '最新添加' },
                { key: 'SortName', label: '名称' },
                { key: 'ProductionYear', label: '年份' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSortBy(opt.key as typeof sortBy)}
                  className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                    sortBy === opt.key
                      ? 'bg-purple-500/20 text-purple-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        mode === 'favorites' ? (
          <MusicTrackTableSkeleton rows={10} />
        ) : mode === 'artists' ? (
          <PosterGridSkeleton count={14} variant="circle" />
        ) : (
          <PosterGridSkeleton count={18} variant="square" />
        )
      ) : items.length === 0 ? (
        <div className="py-24 text-center text-sm text-slate-400">暂无内容</div>
      ) : mode === 'favorites' && serverCtx ? (
        <MusicTrackTable
          tracks={items}
          server={serverCtx}
          showCover
          showAlbumColumn
          onFavoriteChanged={(id, fav) => {
            if (!fav) {
              setItems((prev) => prev.filter((it) => it.Id !== id));
              setTotal((t) => Math.max(0, t - 1));
            }
          }}
        />
      ) : mode === 'artists' ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-5">
          {items.map((artist) => {
            const avatarUrl = resolveMusicCoverUrl(currentServer!.url, artist, {
              maxWidth: 320,
              quality: 85,
            });
            return (
              <div
                key={artist.Id}
                onClick={() => navigate(`/music/artist/${artist.Id}`, { state: { previewItem: artist } })}
                className="group cursor-pointer text-center"
              >
                <div className="aspect-square rounded-full overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/50 shadow-lg">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={artist.Name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500">
                      <Mic2 className="w-8 h-8" />
                    </div>
                  )}
                </div>
                <h3 className="mt-2.5 text-sm font-medium text-slate-100 truncate group-hover:text-purple-300 transition">
                  {artist.Name}
                </h3>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
          {items.map((item) => {
            const coverUrl = resolveMusicCoverUrl(currentServer!.url, item, {
              maxWidth: 400,
              quality: 85,
            });
            const targetPath =
              mode === 'playlists' ? `/music/playlist/${item.Id}` : `/music/album/${item.Id}`;
            return (
              <div
                key={item.Id}
                onClick={() => navigate(targetPath, { state: { previewItem: item } })}
                className="group cursor-pointer transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="aspect-square rounded-2xl overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45 shadow-lg">
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={item.Name}
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
                  {item.Name}
                </h3>
                {mode !== 'playlists' && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {formatTrackArtists(item)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {items.length < total && (
        <div className="pt-4 flex justify-center">
          <button
            onClick={() => fetchPage(items.length, true)}
            disabled={loadingMore}
            className="px-6 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-slate-200 cursor-pointer transition disabled:opacity-50"
          >
            {loadingMore ? '加载中...' : `加载更多 (${items.length} / ${total})`}
          </button>
        </div>
      )}
    </div>
  );
};

export default MusicBrowsePage;
