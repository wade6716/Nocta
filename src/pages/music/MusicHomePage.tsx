import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Disc3,
  Heart,
  ListMusic,
  Mic2,
  Music,
  Play,
  RefreshCw,
  Shuffle,
  Sparkles,
  Film,
} from 'lucide-react';
import { EmbyItem } from '../../api/embyClient';
import {
  formatMusicDuration,
  formatTrackArtists,
  getAlbumTracks,
  getLatestMusicAlbums,
  getMusicArtists,
  getMusicLibraries,
  getMusicPlaylists,
  getRandomMusicTracks,
  getRecentlyPlayedMusic,
  getTrackDurationSeconds,
  resolveMusicCoverUrl,
} from '../../api/embyMusicClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useMediaStore } from '../../stores/useMediaStore';
import { MusicServerContext, useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import { MusicEqualizerBars } from '../../components/music/MusicEqualizerBars';

export const MusicHomePage: React.FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  const navigate = useNavigate();
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const cacheVersion = useMediaStore((s) => s.cacheVersion);
  const currentTrackId = useMusicPlayerStore((s) => s.currentTrack?.Id);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const playTracks = useMusicPlayerStore((s) => s.playTracks);
  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const setActiveSpace = useMusicPlayerStore((s) => s.setActiveSpace);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [musicLibs, setMusicLibs] = useState<EmbyItem[]>([]);
  const [recentTracks, setRecentTracks] = useState<EmbyItem[]>([]);
  const [latestAlbums, setLatestAlbums] = useState<EmbyItem[]>([]);
  const [artists, setArtists] = useState<EmbyItem[]>([]);
  const [playlists, setPlaylists] = useState<EmbyItem[]>([]);
  const [roamingLoading, setRoamingLoading] = useState(false);

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

  const loadMusicHome = useCallback(
    async (isManual = false) => {
      if (!currentServer) return;
      if (isManual) setRefreshing(true);
      else setLoading(true);

      try {
        const libs = await getMusicLibraries(
          currentServer.url,
          currentServer.userId,
          currentServer.accessToken,
          false
        );
        setMusicLibs(libs);

        if (libs.length === 0) {
          setRecentTracks([]);
          setLatestAlbums([]);
          setArtists([]);
          setPlaylists([]);
          return;
        }

        const scopedParentId = libs.length === 1 ? libs[0].Id : undefined;
        const [recentRes, albumsRes, artistsRes, playlistsRes] = await Promise.allSettled([
          getRecentlyPlayedMusic(
            currentServer.url,
            currentServer.userId,
            currentServer.accessToken,
            10
          ),
          getLatestMusicAlbums(
            currentServer.url,
            currentServer.userId,
            currentServer.accessToken,
            scopedParentId,
            18
          ),
          getMusicArtists(currentServer.url, currentServer.userId, currentServer.accessToken, {
            parentId: scopedParentId,
            limit: 12,
          }),
          getMusicPlaylists(currentServer.url, currentServer.userId, currentServer.accessToken, {
            limit: 12,
          }),
        ]);

        setRecentTracks(recentRes.status === 'fulfilled' ? recentRes.value : []);
        setLatestAlbums(albumsRes.status === 'fulfilled' ? albumsRes.value : []);
        setArtists(artistsRes.status === 'fulfilled' ? artistsRes.value.Items || [] : []);
        setPlaylists(playlistsRes.status === 'fulfilled' ? playlistsRes.value.Items || [] : []);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentServer]
  );

  useEffect(() => {
    if (!currentServer) {
      if (isActive) navigate('/login');
      return;
    }
    loadMusicHome(false);
  }, [currentServer?.id, currentServer?.url, currentServer?.accessToken, cacheVersion]);

  const heroAlbum = latestAlbums[0] || null;
  const heroCover =
    heroAlbum && currentServer
      ? resolveMusicCoverUrl(currentServer.url, heroAlbum, { maxWidth: 900, quality: 90 })
      : '';

  const handlePlayAlbum = async (album: EmbyItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentServer || !serverCtx) return;
    try {
      const tracks = await getAlbumTracks(
        currentServer.url,
        currentServer.userId,
        album.Id,
        currentServer.accessToken
      );
      if (tracks.length > 0) {
        playTracks(tracks, 0, serverCtx);
      } else {
        navigate(`/music/album/${album.Id}`);
      }
    } catch {
      navigate(`/music/album/${album.Id}`);
    }
  };

  const handleRandomRoaming = async () => {
    if (!currentServer || !serverCtx || roamingLoading) return;
    setRoamingLoading(true);
    try {
      const tracks = await getRandomMusicTracks(
        currentServer.url,
        currentServer.userId,
        currentServer.accessToken,
        undefined,
        40
      );
      if (tracks.length > 0) {
        playTracks(tracks, 0, serverCtx);
      }
    } finally {
      setRoamingLoading(false);
    }
  };

  return (
    <div className="w-full py-6 px-8 select-none space-y-10">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>发现音乐</span>
            <span className="text-xs font-normal text-slate-400 font-mono">
              · {currentServer?.name || 'Emby 音乐库'}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/music/favorites')}
            className="px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border border-white/[0.06] transition cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <Heart className="w-3.5 h-3.5 text-rose-400" />
            <span>我喜欢的</span>
          </button>
          <button
            onClick={() => loadMusicHome(true)}
            disabled={refreshing || loading}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.06] transition cursor-pointer"
            title="刷新音乐库"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-purple-400' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-3">
          <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400">正在加载音乐曲库...</p>
        </div>
      ) : musicLibs.length === 0 ? (
        <div className="rounded-3xl bg-white/[0.03] border border-white/[0.07] p-14 text-center max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/15 border border-purple-400/30 mx-auto flex items-center justify-center text-purple-300">
            <Music className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-white">当前服务器暂无音乐库</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            当前连接的服务器「{currentServer?.name}」未配置类型为「音乐 (Music)」的媒体库，您可以切换其他包含音乐的 Emby 服务器或返回影视空间继续追剧。
          </p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              onClick={() => {
                setActiveSpace('video');
                navigate('/');
              }}
              className="px-4 py-2 rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <Film className="w-3.5 h-3.5" />
              <span>返回影视空间</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Hero 精选音乐横幅 */}
          {heroAlbum && (
            <div className="preserve-dark relative h-64 sm:h-72 rounded-3xl overflow-hidden border border-white/[0.08] bg-[#141828] shadow-2xl flex items-center p-7 sm:p-9 group">
              {heroCover && (
                <img
                  src={heroCover}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover opacity-35 blur-3xl scale-125 pointer-events-none"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-[#0B0E17]/95 via-[#0B0E17]/75 to-[#0B0E17]/40" />

              <div className="relative z-10 flex items-center gap-7 w-full">
                <div
                  onClick={() => navigate(`/music/album/${heroAlbum.Id}`)}
                  className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl overflow-hidden border border-white/[0.14] shadow-2xl flex-shrink-0 cursor-pointer bg-[#181E30]"
                >
                  {heroCover ? (
                    <img
                      src={heroCover}
                      alt={heroAlbum.Name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500">
                      <Disc3 className="w-12 h-12" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/35 text-purple-300 text-[11px] font-semibold">
                    <Sparkles className="w-3 h-3" />
                    <span>最新入库专辑</span>
                  </div>
                  <h2
                    onClick={() => navigate(`/music/album/${heroAlbum.Id}`)}
                    className="text-2xl sm:text-3xl font-extrabold text-white truncate cursor-pointer hover:text-purple-300 transition"
                  >
                    {heroAlbum.Name}
                  </h2>
                  <p className="text-sm text-slate-300 truncate">
                    {formatTrackArtists(heroAlbum)}
                    {heroAlbum.ProductionYear ? ` · ${heroAlbum.ProductionYear}` : ''}
                  </p>
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      onClick={(e) => handlePlayAlbum(heroAlbum, e)}
                      className="px-5 py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-sky-500 hover:from-purple-400 hover:to-sky-400 text-white font-bold text-xs shadow-lg shadow-purple-500/25 inline-flex items-center gap-2 cursor-pointer transition active:scale-95"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>立即播放</span>
                    </button>
                    <button
                      onClick={handleRandomRoaming}
                      disabled={roamingLoading}
                      className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-100 border border-white/15 font-medium text-xs inline-flex items-center gap-2 cursor-pointer transition"
                    >
                      <Shuffle className="w-3.5 h-3.5 text-purple-300" />
                      <span>{roamingLoading ? '正在漫游...' : '随机漫游'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 最近常听歌曲 */}
          {recentTracks.length > 0 && serverCtx && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Music className="w-4 h-4 text-purple-400" />
                  <span>最近常听</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {recentTracks.map((track, idx) => {
                  const coverUrl = resolveMusicCoverUrl(currentServer!.url, track, {
                    maxWidth: 120,
                    quality: 80,
                  });
                  const isCurrent = currentTrackId === track.Id;
                  return (
                    <div
                      key={track.Id}
                      onClick={() =>
                        isCurrent ? togglePlay() : playTracks(recentTracks, idx, serverCtx)
                      }
                      className={`group flex items-center gap-3 p-2.5 rounded-2xl border transition cursor-pointer ${
                        isCurrent
                          ? 'bg-purple-500/15 border-purple-400/35'
                          : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.06]'
                      }`}
                    >
                      <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-[#141828] flex-shrink-0 flex items-center justify-center">
                        {coverUrl ? (
                          <img src={coverUrl} alt={track.Name} className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-5 h-5 text-slate-500" />
                        )}
                        <div
                          className={`absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity ${
                            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          {isCurrent ? (
                            <MusicEqualizerBars playing={isPlaying} />
                          ) : (
                            <Play className="w-4 h-4 text-white fill-current" />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {track.Name}
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {formatTrackArtists(track)}
                        </div>
                      </div>
                      <span className="text-xs font-mono text-slate-500 tabular-nums pr-2">
                        {formatMusicDuration(getTrackDurationSeconds(track))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 最新专辑 (1:1 方形封面) */}
          {latestAlbums.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Disc3 className="w-4 h-4 text-purple-400" />
                  <span>最新专辑</span>
                </h2>
                <button
                  onClick={() => navigate('/music/albums')}
                  className="text-xs text-slate-400 hover:text-purple-300 transition cursor-pointer"
                >
                  查看全部
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
                {latestAlbums.slice(0, 12).map((album) => {
                  const coverUrl = resolveMusicCoverUrl(currentServer!.url, album, {
                    maxWidth: 400,
                    quality: 85,
                  });
                  return (
                    <div
                      key={album.Id}
                      onClick={() => navigate(`/music/album/${album.Id}`)}
                      className="group cursor-pointer transition-transform duration-200 hover:-translate-y-1"
                    >
                      <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45 shadow-lg shadow-black/40">
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={album.Name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <Disc3 className="w-10 h-10" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handlePlayAlbum(album, e)}
                          className="absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-sky-500 text-white flex items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 cursor-pointer"
                          title="播放整张专辑"
                        >
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        </button>
                      </div>
                      <h3 className="mt-2.5 text-sm font-medium text-slate-100 truncate group-hover:text-purple-300 transition-colors">
                        {album.Name}
                      </h3>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {formatTrackArtists(album)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 推荐歌手 */}
          {artists.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Mic2 className="w-4 h-4 text-purple-400" />
                  <span>艺术家</span>
                </h2>
                <button
                  onClick={() => navigate('/music/artists')}
                  className="text-xs text-slate-400 hover:text-purple-300 transition cursor-pointer"
                >
                  查看全部
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-5">
                {artists.slice(0, 6).map((artist) => {
                  const avatarUrl = resolveMusicCoverUrl(currentServer!.url, artist, {
                    maxWidth: 320,
                    quality: 85,
                  });
                  return (
                    <div
                      key={artist.Id}
                      onClick={() => navigate(`/music/artist/${artist.Id}`)}
                      className="group cursor-pointer text-center"
                    >
                      <div className="aspect-square rounded-full overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/50 shadow-lg mx-auto">
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
            </section>
          )}

          {/* 歌单 */}
          {playlists.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <ListMusic className="w-4 h-4 text-purple-400" />
                  <span>精选歌单</span>
                </h2>
                <button
                  onClick={() => navigate('/music/playlists')}
                  className="text-xs text-slate-400 hover:text-purple-300 transition cursor-pointer"
                >
                  查看全部
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
                {playlists.slice(0, 6).map((pl) => {
                  const coverUrl = resolveMusicCoverUrl(currentServer!.url, pl, {
                    maxWidth: 400,
                    quality: 85,
                  });
                  return (
                    <div
                      key={pl.Id}
                      onClick={() => navigate(`/music/playlist/${pl.Id}`)}
                      className="group cursor-pointer transition-transform duration-200 hover:-translate-y-1"
                    >
                      <div className="aspect-square rounded-2xl overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45 shadow-lg">
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={pl.Name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <ListMusic className="w-10 h-10" />
                          </div>
                        )}
                      </div>
                      <h3 className="mt-2.5 text-sm font-medium text-slate-100 truncate group-hover:text-purple-300 transition">
                        {pl.Name}
                      </h3>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default MusicHomePage;
