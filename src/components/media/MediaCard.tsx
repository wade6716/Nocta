import React, { useEffect, useState } from 'react';
import { Play, Check, Server, Tv, Star } from 'lucide-react';
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
  onQuickPlay?: (item: EmbyItem) => void;
  aspectRatio?: 'poster' | 'backdrop';
  subtitle?: string;
  badge?: string;
  serverBadge?: string;
  episodeBadge?: string;
  remainingLabel?: string;
}

const MediaCardComponent: React.FC<MediaCardProps> = ({
  item,
  serverUrl = '',
  onClick,
  onQuickPlay,
  aspectRatio = 'poster',
  subtitle,
  badge,
  serverBadge,
  episodeBadge,
  remainingLabel,
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
  const ratingValue =
    typeof item.CommunityRating === 'number' && item.CommunityRating > 0
      ? item.CommunityRating.toFixed(1)
      : null;

  return (
    <div
      onClick={() => onClick(item)}
      className="group relative flex flex-col cursor-pointer transition-transform duration-200 hover:-translate-y-1 select-none"
    >
      {/* Poster Image Container */}
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-[#131826] border border-white/[0.08] transition-all duration-300 ${
          isBackdrop
            ? 'aspect-video group-hover:border-[#38BDF8]/50 shadow-lg shadow-black/40'
            : 'aspect-[2/3] group-hover:border-white/30 group-hover:shadow-xl group-hover:shadow-black/60 shadow-lg shadow-black/40'
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

        {/* Hover overlay: 16:9 横版保留居中播放图标；2:3 竖版保持海报主体洁净，仅显示底部柔光与可选快捷播放 */}
        {isBackdrop ? (
          <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="w-11 h-11 rounded-full bg-white/90 text-slate-950 flex items-center justify-center shadow-xl transform scale-75 group-hover:scale-100 transition-transform duration-200">
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </div>
          </div>
        ) : (
          <>
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            {onQuickPlay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickPlay(item);
                }}
                className="absolute bottom-2.5 left-2.5 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-slate-950 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transform translate-y-1 group-hover:translate-y-0 transition-all duration-200 cursor-pointer z-20"
                title="立即播放"
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              </button>
            )}
          </>
        )}

        {/* Server Badge on top left (if multi-server search or specified) */}
        {(serverBadge || item.ServerName) && (
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[10px] font-medium text-amber-300 border border-amber-500/30 flex items-center space-x-1 shadow-md max-w-[100px] z-10">
            <Server className="w-2.5 h-2.5 flex-shrink-0 text-amber-400" />
            <span className="truncate">{serverBadge || item.ServerName}</span>
          </div>
        )}

        {/* Badge on top right */}
        {badge ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[11px] font-semibold text-[#38BDF8] border border-white/10">
            {badge}
          </div>
        ) : isPlayed ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-emerald-600/85 backdrop-blur-md text-[11px] font-semibold text-white flex items-center space-x-1">
            <Check className="w-3 h-3 stroke-[3]" />
            <span>已看</span>
          </div>
        ) : ratingValue ? (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[10px] font-semibold text-amber-300 border border-amber-400/25 flex items-center space-x-0.5 tabular-nums">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            <span>{ratingValue}</span>
          </div>
        ) : null}

        {/* Remaining time on bottom left for backdrop resume cards */}
        {isBackdrop && remainingLabel && (
          <div className="absolute bottom-2.5 left-2 px-1.5 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[10px] font-medium text-slate-200 border border-white/10 z-10 select-none tabular-nums">
            {remainingLabel}
          </div>
        )}

        {/* Episode count badge on bottom right (角标：展示包含多少集/媒体文件) */}
        {effectiveEpisodeBadge && (
          <div
            className={`absolute ${
              progressPercent > 0 ? 'bottom-2.5' : 'bottom-2'
            } right-2 px-1.5 py-0.5 rounded-md bg-[#0B0E17]/85 backdrop-blur-md text-[10px] font-semibold text-sky-300 border border-sky-400/25 flex items-center space-x-1 shadow-lg z-10 select-none`}
          >
            <Tv className="w-2.5 h-2.5 flex-shrink-0 text-sky-400" />
            <span>{effectiveEpisodeBadge}</span>
          </div>
        )}

        {/* Resume progress bar */}
        {progressPercent > 0 && (
          <div
            className={`absolute bottom-0 inset-x-0 bg-white/25 ${
              isBackdrop ? 'h-1.5' : 'h-1'
            }`}
          >
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
          {item.SeriesName && isBackdrop ? item.SeriesName : item.Name}
        </h3>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs font-medium text-slate-400 truncate">
            {subtitle
              ? subtitle
              : item.SeriesName
              ? `${isBackdrop ? '' : `${item.SeriesName} · `}${
                  item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
                    ? `S${item.ParentIndexNumber}E${item.IndexNumber}`
                    : item.IndexNumber !== undefined
                    ? `第 ${item.IndexNumber} 集`
                    : item.Name
                }`
              : item.ProductionYear || item.PremiereDate?.slice(0, 4) || item.Type}
          </p>
          {(isPlayed || badge) && ratingValue && (
            <span className="text-[11px] font-medium text-amber-300/90 flex items-center space-x-0.5 flex-shrink-0 tabular-nums">
              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
              <span>{ratingValue}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const MediaCard = React.memo(MediaCardComponent);
export default MediaCard;

