import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Disc3,
  Globe,
  History,
  ListMusic,
  Loader2,
  Mic2,
  Music,
  Play,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { EmbyItem, FederatedServerTarget } from '../../api/embyClient';
import {
  formatMusicDuration,
  formatTrackArtists,
  getTrackDurationSeconds,
  MusicSearchFilterType,
  resolveMusicCoverUrl,
  searchFederatedMusicItems,
} from '../../api/embyMusicClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useMediaStore } from '../../stores/useMediaStore';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';

const MUSIC_HISTORY_KEY = 'emby_music_search_history';
const MAX_HISTORY = 15;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(MUSIC_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem(MUSIC_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

export const MusicSearchPage: React.FC = () => {
  const navigate = useNavigate();
  const servers = useAuthStore((s) => s.servers);
  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const setCurrentServer = useAuthStore((s) => s.setCurrentServer);
  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);
  const playTracks = useMusicPlayerStore((s) => s.playTracks);

  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState<MusicSearchFilterType>('All');
  const [searchScope, setSearchScope] = useState<string>('ALL');
  const [results, setResults] = useState<EmbyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);

  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const executeSearch = useCallback(
    async (term: string, type: MusicSearchFilterType, scope: string) => {
      const reqId = ++reqIdRef.current;
      const cleanTerm = term.trim();
      if (!cleanTerm || servers.length === 0) {
        setResults([]);
        setLoading(false);
        setHasSearched(false);
        return;
      }

      setLoading(true);
      setHasSearched(true);
      setResults([]);

      const targets: FederatedServerTarget[] = (
        scope === 'ALL' ? servers : servers.filter((s) => s.id === scope)
      ).map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        userId: s.userId,
        accessToken: s.accessToken,
      }));

      try {
        const res = await searchFederatedMusicItems(targets, {
          keyword: cleanTerm,
          filterType: type,
          limitPerServer: 60,
          onServerResult: ({ items }) => {
            if (reqId !== reqIdRef.current || items.length === 0) return;
            setResults((prev) => [...prev, ...items]);
          },
        });
        if (reqId !== reqIdRef.current) return;
        setResults(res.items);

        setHistory((prev) => {
          const updated = [
            cleanTerm,
            ...prev.filter((h) => h.toLowerCase() !== cleanTerm.toLowerCase()),
          ].slice(0, MAX_HISTORY);
          saveHistory(updated);
          return updated;
        });
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
        }
      }
    },
    [servers]
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!keyword.trim()) {
      reqIdRef.current += 1;
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      executeSearch(keyword, filterType, searchScope);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [keyword, filterType, searchScope, executeSearch]);

  const songs = useMemo(() => results.filter((r) => r.Type === 'Audio'), [results]);
  const albums = useMemo(() => results.filter((r) => r.Type === 'MusicAlbum'), [results]);
  const artists = useMemo(() => results.filter((r) => r.Type === 'MusicArtist'), [results]);
  const playlists = useMemo(() => results.filter((r) => r.Type === 'Playlist'), [results]);

  const ensureServerForItem = (item: EmbyItem) => {
    if (item.ServerId && item.ServerId !== currentServer?.id) {
      const target = servers.find((s) => s.id === item.ServerId);
      if (target) {
        clearMediaCache();
        setCurrentServer(target.id);
        return target;
      }
    }
    return currentServer;
  };

  const handlePlaySong = (song: EmbyItem) => {
    const srv = servers.find((s) => s.id === song.ServerId) || currentServer;
    if (!srv) return;
    const sameServerSongs = songs.filter((s) => (s.ServerId || srv.id) === srv.id);
    const idx = Math.max(
      0,
      sameServerSongs.findIndex((s) => s.Id === song.Id)
    );
    playTracks(sameServerSongs.length > 0 ? sameServerSongs : [song], idx, {
      id: srv.id,
      name: srv.name,
      url: srv.url,
      userId: srv.userId,
      accessToken: srv.accessToken,
    });
  };

  return (
    <div className="w-full py-6 px-8 select-none space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/music')}
          className="p-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-300 hover:text-white cursor-pointer transition"
          title="返回音乐首页"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-purple-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌曲、专辑、歌手、歌单..."
            className="w-full h-11 pl-11 pr-10 rounded-2xl bg-white/[0.05] border border-white/[0.1] focus:border-purple-400/60 focus:outline-none text-sm text-white placeholder:text-slate-500 transition"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/[0.1] text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {servers.length > 1 && (
          <select
            value={searchScope}
            onChange={(e) => setSearchScope(e.target.value)}
            className="h-11 px-3 rounded-2xl bg-[#131826] border border-white/[0.1] text-xs text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">全部服务器 ({servers.length})</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 类型筛选 Tab */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'All', label: '全部', icon: Globe },
          { key: 'Audio', label: '歌曲', icon: Music },
          { key: 'MusicAlbum', label: '专辑', icon: Disc3 },
          { key: 'MusicArtist', label: '歌手', icon: Mic2 },
          { key: 'Playlist', label: '歌单', icon: ListMusic },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = filterType === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilterType(tab.key as MusicSearchFilterType)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border transition cursor-pointer ${
                active
                  ? 'bg-purple-500/20 border-purple-400/45 text-purple-200'
                  : 'bg-white/[0.04] border-white/[0.06] text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 搜索历史 */}
      {!hasSearched && history.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              <span>最近搜索</span>
            </span>
            <button
              onClick={() => {
                setHistory([]);
                localStorage.removeItem(MUSIC_HISTORY_KEY);
              }}
              className="hover:text-rose-400 inline-flex items-center gap-1 cursor-pointer transition"
            >
              <Trash2 className="w-3 h-3" />
              <span>清空</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((term) => (
              <button
                key={term}
                onClick={() => setKeyword(term)}
                className="px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs text-slate-200 cursor-pointer transition"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && results.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3 text-slate-400 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span>正在搜索音乐曲库...</span>
        </div>
      ) : hasSearched && results.length === 0 ? (
        <div className="py-24 text-center text-sm text-slate-400">
          未找到与「{keyword}」相关的歌曲、专辑或歌手
        </div>
      ) : (
        <div className="space-y-8">
          {/* 歌曲结果 */}
          {songs.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-white">歌曲 ({songs.length})</h2>
              <div className="space-y-1">
                {songs.map((song) => {
                  const srvUrl = song.ServerUrl || currentServer?.url || '';
                  const coverUrl = resolveMusicCoverUrl(srvUrl, song, { maxWidth: 120, quality: 80 });
                  return (
                    <div
                      key={`${song.ServerId || 'local'}-${song.Id}`}
                      onClick={() => handlePlaySong(song)}
                      className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.06] cursor-pointer transition"
                    >
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#141828] flex-shrink-0 flex items-center justify-center">
                        {coverUrl ? (
                          <img src={coverUrl} alt={song.Name} className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-4 h-4 text-slate-500" />
                        )}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Play className="w-4 h-4 text-white fill-current" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {song.Name}
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          {formatTrackArtists(song)}
                          {song.Album ? ` · ${song.Album}` : ''}
                        </div>
                      </div>
                      {song.ServerName && servers.length > 1 && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <Server className="w-2.5 h-2.5" />
                          <span>{song.ServerName}</span>
                        </span>
                      )}
                      <span className="text-xs font-mono text-slate-500 tabular-nums">
                        {formatMusicDuration(getTrackDurationSeconds(song))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 专辑结果 */}
          {albums.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-white">专辑 ({albums.length})</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {albums.map((alb) => {
                  const srvUrl = alb.ServerUrl || currentServer?.url || '';
                  const cover = resolveMusicCoverUrl(srvUrl, alb, { maxWidth: 360, quality: 85 });
                  return (
                    <div
                      key={`${alb.ServerId || 'local'}-${alb.Id}`}
                      onClick={() => {
                        ensureServerForItem(alb);
                        navigate(`/music/album/${alb.Id}`);
                      }}
                      className="group cursor-pointer"
                    >
                      <div className="aspect-square rounded-2xl overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45">
                        {cover ? (
                          <img src={cover} alt={alb.Name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <Disc3 className="w-9 h-9" />
                          </div>
                        )}
                      </div>
                      <h3 className="mt-2 text-xs font-semibold text-slate-100 truncate group-hover:text-purple-300">
                        {alb.Name}
                      </h3>
                      <p className="text-[11px] text-slate-400 truncate">
                        {formatTrackArtists(alb)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 歌手结果 */}
          {artists.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-white">歌手 ({artists.length})</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-4">
                {artists.map((art) => {
                  const srvUrl = art.ServerUrl || currentServer?.url || '';
                  const avatar = resolveMusicCoverUrl(srvUrl, art, { maxWidth: 300, quality: 85 });
                  return (
                    <div
                      key={`${art.ServerId || 'local'}-${art.Id}`}
                      onClick={() => {
                        ensureServerForItem(art);
                        navigate(`/music/artist/${art.Id}`);
                      }}
                      className="group cursor-pointer text-center"
                    >
                      <div className="aspect-square rounded-full overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45">
                        {avatar ? (
                          <img src={avatar} alt={art.Name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <Mic2 className="w-7 h-7" />
                          </div>
                        )}
                      </div>
                      <h3 className="mt-2 text-xs font-medium text-slate-100 truncate group-hover:text-purple-300">
                        {art.Name}
                      </h3>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 歌单结果 */}
          {playlists.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-white">歌单 ({playlists.length})</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                {playlists.map((pl) => {
                  const srvUrl = pl.ServerUrl || currentServer?.url || '';
                  const cover = resolveMusicCoverUrl(srvUrl, pl, { maxWidth: 360, quality: 85 });
                  return (
                    <div
                      key={`${pl.ServerId || 'local'}-${pl.Id}`}
                      onClick={() => {
                        ensureServerForItem(pl);
                        navigate(`/music/playlist/${pl.Id}`);
                      }}
                      className="group cursor-pointer"
                    >
                      <div className="aspect-square rounded-2xl overflow-hidden bg-[#141828] border border-white/[0.08] group-hover:border-purple-400/45">
                        {cover ? (
                          <img src={cover} alt={pl.Name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <ListMusic className="w-9 h-9" />
                          </div>
                        )}
                      </div>
                      <h3 className="mt-2 text-xs font-medium text-slate-100 truncate group-hover:text-purple-300">
                        {pl.Name}
                      </h3>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default MusicSearchPage;
