import React, { useEffect, useState } from 'react';
import { Play, Check, Server, Tv } from 'lucide-react';
import {
  EmbyItem,
  buildItemImageUrl,
  formatSeriesEpisodeBadge,
  resolveItemBackdropUrl,
  resolveItemPosterUrl,
  stripImageFormatWebp,
} from '../../api/embyClient';

interface MediaCardProps {
  item: EmbyItem;
  serverUrl?: string;
  onClick: (item: EmbyItem) => void;
  aspectRatio?: 'poster' | 'backdrop';
  subtitle?: string;
  badge?: string;
  serverBadge?: string;
  episodeBadge?: string;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  serverUrl = '',
  onClick,
  aspectRatio = 'poster',
  subtitle,
  badge,
  serverBadge,
  episodeBadge,
}) => {
  const isBackdrop = aspectRatio === 'backdrop';
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const effectiveServerUrl = item.ServerUrl || serverUrl;
  const effectiveEpisodeBadge =
    episodeBadge !== undefined ? episodeBadge : formatSeriesEpisodeBadge(item);

  const imageUrl = isBackdrop
    ? resolveItemBackdropUrl(effectiveServerUrl, item, {
        maxWidth: 600,
        quality: 85,
        mode: 'card',
      })
    : resolveItemPosterUrl(effectiveServerUrl, item, {
        maxWidth: 400,
        quality: 85,
      });

  useEffect(() => {
    setIsImageLoaded(false);
  }, [imageUrl]);

  // Calculate resume percentage
  const positionTicks = item.UserData?.PlaybackPositionTicks || 0;
  const totalTicks = item.RunTimeTicks || 0;
  const progressPercent =
    totalTicks > 0 ? Math.min(100, Math.round((positionTicks / totalTicks) * 100)) : 0;

  const isPlayed = item.UserData?.Played && progressPercent === 0;

  return (
    <div
      onClick={() => onClick(item)}
      className="group relative flex flex-col cursor-pointer transition-transform duration-200 hover:-translate-y-1 select-none"
    >
      {/* Poster Image Container */}
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-[#131826] border border-white/[0.08] group-hover:border-[#38BDF8]/45 shadow-lg shadow-black/40 transition-colors duration-300 ${
          isBackdrop ? 'aspect-video' : 'aspect-[2/3]'
        }`}
      >
        {/* Loading skeleton */}
        {imageUrl && !isImageLoaded && (
          <div className="absolute inset-0 bg-[#131826] animate-pulse" />
        )}

        {imageUrl ? (
          <img
            key={imageUrl}
            src={imageUrl}
            alt={item.Name}
            loading="lazy"
            onLoad={() => setIsImageLoaded(true)}
            className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
              isImageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onError={(e) => {
              const target = e.currentTarget;
              const step = target.dataset.fallbackStep;
              if (step === 'done') {
                setIsImageLoaded(true);
                return;
              }

              if (!step) {
                const noWebp = stripImageFormatWebp(target.src);
                if (noWebp) {
                  target.dataset.fallbackStep = '1';
                  target.src = noWebp;
                  return;
                }
              }

              if (step !== '2' && item.SeriesId && item.SeriesPrimaryImageTag) {
                const seriesPrimaryUrl = buildItemImageUrl(
                  effectiveServerUrl,
                  item.SeriesId,
                  item.SeriesPrimaryImageTag,
                  { type: 'Primary', maxWidth: 400, quality: 85 }
                );
                if (seriesPrimaryUrl !== imageUrl && target.src !== seriesPrimaryUrl) {
                  target.dataset.fallbackStep = '2';
                  target.src = seriesPrimaryUrl;
                  return;
                }
              }

              setIsImageLoaded(true);
              target.dataset.fallbackStep = 'done';
              target.src =
                'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="100%" height="100%" fill="%23131826"/><text x="50%" y="50%" fill="%2364748B" font-family="sans-serif" font-size="16" text-anchor="middle" dominant-baseline="middle">暂无海报</text></svg>';
            }}
          />
        ) : (
          <div className="w-full h-full bg-[#131826] flex items-center justify-center text-sm text-slate-500">
            暂无海报
          </div>
        )}

        {/* Hover play icon overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-[#38BDF8]/90 text-white flex items-center justify-center shadow-lg shadow-sky-500/25 transform scale-75 group-hover:scale-100 transition-transform duration-200">
            <Play className="w-5 h-5 fill-white ml-0.5" />
          </div>
        </div>

        {/* Server Badge on top left (if multi-server search or specified) */}
        {(serverBadge || item.ServerName) && (
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[10px] font-medium text-amber-300 border border-amber-500/30 flex items-center space-x-1 shadow-md max-w-[100px] z-10">
            <Server className="w-2.5 h-2.5 flex-shrink-0 text-amber-400" />
            <span className="truncate">{serverBadge || item.ServerName}</span>
          </div>
        )}

        {/* Badge on top right */}
        {badge ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-[#0B0E17]/80 backdrop-blur-md text-[11px] font-semibold text-[#38BDF8] border border-white/10">
            {badge}
          </div>
        ) : isPlayed ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-emerald-600/80 backdrop-blur-md text-[11px] font-semibold text-white flex items-center space-x-1">
            <Check className="w-3 h-3 stroke-[3]" />
            <span>已看</span>
          </div>
        ) : null}

        {/* Episode count badge on bottom right (角标：展示包含多少集/媒体文件) */}
        {effectiveEpisodeBadge && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[10px] font-semibold text-sky-300 border border-sky-400/25 flex items-center space-x-1 shadow-lg z-10 select-none">
            <Tv className="w-2.5 h-2.5 flex-shrink-0 text-sky-400" />
            <span>{effectiveEpisodeBadge}</span>
          </div>
        )}

        {/* Resume progress bar (规范：h-1 w-full bg-white/20, 已看进度条为 bg-[#38BDF8]) */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
            <div
              className="h-full bg-[#38BDF8]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Info labels */}
      <div className="mt-2.5 px-0.5">
        <h3 className="text-sm font-medium text-slate-100 truncate group-hover:text-[#38BDF8] transition-colors">
          {item.Name}
        </h3>
        <p className="text-xs font-medium text-slate-400 mt-0.5 truncate">
          {subtitle
            ? subtitle
            : item.SeriesName
            ? `${item.SeriesName} ${item.IndexNumber !== undefined ? `· 第 ${item.IndexNumber} 集` : ''}`
            : item.ProductionYear || item.PremiereDate?.slice(0, 4) || item.Type}
        </p>
      </div>
    </div>
  );
};

export default MediaCard;

