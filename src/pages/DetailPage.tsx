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
    <div className="w-full text-gray-100 select-none pb-20">
      {/* Backdrop Hero Header */}
      <div className="relative w-full h-[480px]">
        <img
          src={backdropUrl}
          alt={item.Name}
          className="w-full h-full object-cover object-top filter brightness-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />

        {/* Back Button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-6 left-8 p-2.5 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur text-white transition z-10 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Hero Information */}
        <div className="absolute bottom-6 left-8 right-8 flex items-end space-x-8">
          {/* Poster */}
          <div className="hidden sm:block w-44 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex-shrink-0">
            <img src={posterUrl} alt={item.Name} className="w-full h-full object-cover" />
          </div>

          {/* Metadata */}
          <div className="flex-1 space-y-3">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {item.Name}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300 font-medium">
              {(item.ProductionYear || item.PremiereDate) && (
                <div className="flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  <span>{item.ProductionYear || item.PremiereDate?.slice(0, 4)}</span>
                </div>
              )}
              {item.RunTimeTicks && (
                <div className="flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  <span>{Math.round(ticksToSeconds(item.RunTimeTicks) / 60)} 分钟</span>
                </div>
              )}
              <span className="px-2 py-0.5 rounded bg-white/10 text-white font-mono uppercase">
                {item.Type}
              </span>
            </div>

            {item.Overview && (
              <p className="text-sm text-gray-300 line-clamp-3 leading-relaxed max-w-3xl">
                {item.Overview}
              </p>
            )}

            {!isSeries && (
              <button
                onClick={() => startPlayback(item)}
                disabled={startingPlay}
                className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold text-sm shadow-xl shadow-primary/25 transition cursor-pointer disabled:opacity-50"
              >
                <Play className="w-5 h-5 fill-white" />
                <span>{startingPlay ? '正在获取直连流...' : '立即播放'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Series Seasons and Episodes */}
      {(isSeries || (item.Type === 'Episode' && !!item.SeriesId)) && (
        <div className="px-8 mt-8 space-y-6">
          {/* Seasons Tab */}
          <div className="flex items-center space-x-2 border-b border-white/10 pb-2 overflow-x-auto">
            {seasons.map((s) => (
              <button
                key={s.Id}
                onClick={() => handleSeasonChange(s.Id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
                  selectedSeasonId === s.Id
                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                    : 'bg-surface hover:bg-white/10 text-gray-300'
                }`}
              >
                {s.Name}
              </button>
            ))}
          </div>

          {/* Episode Grid */}
          {episodesLoading ? (
            <div className="py-20 text-center text-xs text-gray-400">正在加载分集列表...</div>
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
