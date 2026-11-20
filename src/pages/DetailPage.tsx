import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Calendar, Clock, Film } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { usePlayerStore } from '../stores/usePlayerStore';
import {
  EmbyItem,
  getItemDetail,
  getSeriesSeasons,
  getSeriesEpisodes,
  getPlaybackInfo,
  buildDirectStreamUrl,
  buildNativeDirectStreamUrl,
  mapStreamTracks,
  buildItemImageUrl,
  ticksToSeconds,
} from '../api/embyClient';
import { isTauriEnvironment } from '../api/http';
import { EpisodeGrid } from '../components/media/EpisodeGrid';

export const DetailPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const currentServer = useAuthStore((s) => s.getCurrentServer());
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);

  const cachedPlayerItem = usePlayerStore((s) => s.item);
  const isCachedItem = cachedPlayerItem?.Id === itemId;
  const [item, setItem] = useState<EmbyItem | null>(() => (isCachedItem ? cachedPlayerItem : null));
  const [loading, setLoading] = useState(!isCachedItem);
  const [seasons, setSeasons] = useState<EmbyItem[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EmbyItem[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [startingPlay, setStartingPlay] = useState(false);

  useEffect(() => {
    if (!currentServer || !itemId) {
      navigate('/');
      return;
    }
    loadItemDetail();
  }, [itemId, currentServer?.id]);

  const loadItemDetail = async () => {
    if (!currentServer || !itemId) return;
    try {
      if (!item) {
        setLoading(true);
      }
      const detail = await getItemDetail(
        currentServer.url,
        currentServer.userId,
        itemId,
        currentServer.accessToken
      );
      setItem(detail);

      // If it's a TV Series or Episode, fetch seasons and episode list
      const targetSeriesId = detail.Type === 'Series' ? detail.Id : detail.SeriesId;
      if (targetSeriesId) {
        const seasonsRes = await getSeriesSeasons(
          currentServer.url,
          currentServer.userId,
          targetSeriesId,
          currentServer.accessToken
        );
        const seasonList = seasonsRes.Items || [];
        setSeasons(seasonList);
        if (seasonList.length > 0) {
          const matchSeason =
            seasonList.find((s) => s.Id === detail.SeasonId) || seasonList[0];
          setSelectedSeasonId(matchSeason.Id);
          loadEpisodes(targetSeriesId, matchSeason.Id);
        }
      }
    } catch (err: any) {
      console.error('获取条目详情失败', err);
    } finally {
      setLoading(false);
    }
  };

  const loadEpisodes = async (seriesId: string, seasonId: string) => {
    if (!currentServer) return;
    try {
      setEpisodesLoading(true);
      const res = await getSeriesEpisodes(
        currentServer.url,
        currentServer.userId,
        seriesId,
        seasonId,
        currentServer.accessToken
      );
      setEpisodes(res.Items || []);
    } catch (err: any) {
      console.error('获取分集失败', err);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const handleSeasonChange = (seasonId: string) => {
    setSelectedSeasonId(seasonId);
    if (item) {
      const targetSeriesId = item.Type === 'Series' ? item.Id : item.SeriesId;
      if (targetSeriesId) {
        loadEpisodes(targetSeriesId, seasonId);
      }
    }
  };

  // Launch Playback for an item (movie or episode)
  const startPlayback = async (targetItem: EmbyItem) => {
    if (!currentServer) return;
    try {
      setStartingPlay(true);
      const pbInfo = await getPlaybackInfo(
        currentServer.url,
        currentServer.userId,
        targetItem.Id,
        currentServer.accessToken
      );

      const mediaSource = pbInfo.MediaSources?.[0];
      if (!mediaSource) {
        throw new Error('未检测到可用的媒体源 (MediaSource)');
      }

      const engineType = usePlayerStore.getState().engineType;
      const streamUrl =
        engineType === 'mpv' && isTauriEnvironment()
          ? buildNativeDirectStreamUrl(
              currentServer.url,
              targetItem.Id,
              mediaSource,
              pbInfo.PlaySessionId,
              currentServer.accessToken
            )
          : buildDirectStreamUrl(
              currentServer.url,
              targetItem.Id,
              mediaSource,
              pbInfo.PlaySessionId,
              currentServer.accessToken
            );

      const { audioTracks, subtitleTracks } = mapStreamTracks(
        currentServer.url,
        targetItem.Id,
        mediaSource,
        currentServer.accessToken
      );

      const initialTime = ticksToSeconds(targetItem.UserData?.PlaybackPositionTicks || 0);

      setPlaybackContext({
        item: targetItem,
        mediaSource,
        availableMediaSources: pbInfo.MediaSources,
        playSessionId: pbInfo.PlaySessionId,
        streamUrl,
        audioTracks,
        subtitleTracks,
        initialTime,
      });

      navigate(`/player/${targetItem.Id}`);
    } catch (err: any) {
      alert(`无法起播: ${err.message}`);
    } finally {
      setStartingPlay(false);
    }
  };

  if (loading || !item) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isSeries = item.Type === 'Series';
  const backdropUrl = buildItemImageUrl(
    currentServer!.url,
    item.Id,
    item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop,
    { type: 'Backdrop', maxWidth: 1920, quality: 90 }
  );
  const posterUrl = buildItemImageUrl(currentServer!.url, item.Id, item.ImageTags?.Primary, {
    type: 'Primary',
    maxWidth: 500,
    quality: 90,
  });

  return (
    <div className="w-full text-slate-100 select-none pb-24 relative min-h-full">
      {/* 1. 全屏氛围背景 (Ambient Backdrop - 3xl blur, scale-110, pointer-events-none) */}
      <img
        src={backdropUrl}
        alt=""
        aria-hidden="true"
        className="fixed inset-0 -z-10 w-full h-full object-cover opacity-20 blur-3xl scale-110 pointer-events-none"
      />

      {/* 2. 上半部信息头 (Header Split with Ambient Backing) */}
      <div className="relative w-full pt-8 px-8 max-w-7xl mx-auto">
        {/* 返回按钮 */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 p-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur-xl border border-white/[0.08] text-slate-200 hover:text-white transition cursor-pointer flex items-center space-x-1.5 text-xs font-medium group"
          title="返回上一页"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>返回</span>
        </button>

        <div className="flex flex-col md:flex-row items-start gap-8">
          {/* 左侧：高清竖版海报 (w-52 aspect-[2/3] rounded-2xl) */}
          <div className="w-48 sm:w-56 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/[0.12] shrink-0 bg-[#131826]">
            <img src={posterUrl} alt={item.Name} className="w-full h-full object-cover" />
          </div>

          {/* 右侧：标题、规格标签组与行动栏 */}
          <div className="flex-1 space-y-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-50 tracking-tight drop-shadow-md">
              {item.Name}
            </h1>

            {/* 流媒体规格标签组 */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-medium">
              {(item.ProductionYear || item.PremiereDate) && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                  {item.ProductionYear || item.PremiereDate?.slice(0, 4)}
                </span>
              )}
              {item.RunTimeTicks && (
                <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300 tabular-nums">
                  {Math.round(ticksToSeconds(item.RunTimeTicks) / 60)} 分钟
                </span>
              )}
              <span className="px-2.5 py-1 rounded-md bg-[#38BDF8]/15 border border-[#38BDF8]/30 text-[#38BDF8] font-bold">
                4K HDR
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                10-bit HEVC
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-slate-300">
                多音轨 / 封装字幕
              </span>
            </div>

            {/* 弹幕预检状态条 */}
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center space-x-2.5 max-w-2xl">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-xs text-slate-300">
                全网弹幕引擎已就绪 · 支持 Bilibili / 优爱腾全域弹幕自动匹配与时间轴微调
              </span>
            </div>

            {/* 剧情简介 */}
            {item.Overview && (
              <p className="text-sm text-slate-300 leading-relaxed max-w-3xl line-clamp-4">
                {item.Overview}
              </p>
            )}

            {/* 电影直接起播按钮 */}
            {!isSeries && (
              <div className="pt-2">
                <button
                  onClick={() => startPlayback(item)}
                  disabled={startingPlay}
                  className="px-8 py-3 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-sm shadow-xl shadow-sky-500/25 transition cursor-pointer flex items-center space-x-2 disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{startingPlay ? '正在获取直连流...' : '立即播放'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. 下半部季与集选择器 (Season & Episode Grid) */}
      {(isSeries || (item.Type === 'Episode' && !!item.SeriesId)) && (
        <div className="px-8 mt-12 max-w-7xl mx-auto space-y-6">
          {/* 横向季胶囊 Tab 栏 */}
          {seasons.length > 0 && (
            <div className="flex items-center space-x-2 border-b border-white/[0.06] pb-3 overflow-x-auto custom-scrollbar">
              {seasons.map((s) => {
                const isActive = selectedSeasonId === s.Id;
                return (
                  <button
                    key={s.Id}
                    onClick={() => handleSeasonChange(s.Id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer whitespace-nowrap border ${
                      isActive
                        ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8] shadow-md shadow-sky-500/10'
                        : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                    }`}
                  >
                    {s.Name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Episode Grid */}
          {episodesLoading ? (
            <div className="py-24 text-center text-xs text-slate-400">正在同步分集列表...</div>
          ) : (
            <EpisodeGrid
              episodes={episodes}
              serverUrl={currentServer!.url}
              onSelectEpisode={(ep) => startPlayback(ep)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default DetailPage;

