import React, { useEffect, useState } from 'react';
import { Play, Check, Server, Loader2 } from 'lucide-react';
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
  isQuickPlaying?: boolean;
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
  isQuickPlaying = false,
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

  const yearValue = item.ProductionYear || item.PremiereDate?.slice(0, 4);
  const genresText = item.Genres?.slice(0, 2).join(' / ');
  const posterMetaText =
    subtitle ||
    (item.SeriesName
      ? `${item.SeriesName} · ${
          item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
            ? `S${item.ParentIndexNumber}E${item.IndexNumber}`
            : item.IndexNumber !== undefined
            ? `第 ${item.IndexNumber} 集`
            : item.Name
        }`
      : [
          yearValue ? String(yearValue) : null,
          effectiveEpisodeBadge || genresText || null,
          ratingValue ? `★ ${ratingValue}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || item.Type);

  const backdropMetaText =
    subtitle ||
    (item.SeriesName
      ? item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
        ? `S${item.ParentIndexNumber}E${item.IndexNumber}${item.Name ? ` · ${item.Name}` : ''}`
        : item.IndexNumber !== undefined
        ? `第 ${item.IndexNumber} 集${item.Name ? ` · ${item.Name}` : ''}`
        : item.Name
      : yearValue
      ? String(yearValue)
      : item.Type);

  return (
    <div
      onClick={() => onClick(item)}
      className="group relative flex flex-col cursor-pointer transition-transform duration-300 ease-out hover:-translate-y-0.5 select-none"
    >
      {/* Poster Image Container (Apple TV+ 双层物理投影 + Specular Sheen + 内嵌浮起进度轨) */}
      <div
        className={`preserve-dark relative w-full overflow-hidden rounded-[14px] bg-[#E5E5EA] dark:bg-[#1C1C1E] ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.09] transition-all duration-300 ${
          isBackdrop
            ? 'aspect-video shadow-[0_2px_8px_rgba(0,0,0,0.06),0_12px_28px_-8px_rgba(0,0,0,0.14)] group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_20px_38px_-10px_rgba(0,0,0,0.24)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] dark:group-hover:shadow-[0_16px_38px_rgba(0,0,0,0.68)]'
            : 'aspect-[2/3] shadow-[0_2px_8px_rgba(0,0,0,0.06),0_12px_28px_-8px_rgba(0,0,0,0.15)] group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_20px_38px_-10px_rgba(0,0,0,0.24)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] dark:group-hover:shadow-[0_16px_38px_rgba(0,0,0,0.68)]'
        }`}
      >
        {/* Loading skeleton */}
        {imageUrl && !isImageLoaded && (
          <div className="absolute inset-0 bg-[#E5E5EA] dark:bg-[#1C1C1E] animate-pulse" />
        )}

        {imageUrl ? (
          <img
            key={imageUrl}
            src={imageUrl}
            alt={item.Name}
            loading="lazy"
            onLoad={() => setIsImageLoaded(true)}
            className={`w-full h-full object-cover transition-all duration-300 ease-out group-hover:scale-[1.03] ${
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
                'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="100%" height="100%" fill="%231C1C1E"/><text x="50%" y="50%" fill="%2386868B" font-family="sans-serif" font-size="16" text-anchor="middle" dominant-baseline="middle">暂无海报</text></svg>';
            }}
          />
        ) : (
          <div className="w-full h-full bg-[#E5E5EA] dark:bg-[#1C1C1E] flex items-center justify-center text-sm text-[#86868B]">
            暂无海报
          </div>
        )}

        {/* Hover overlay: 16:9 横版保留轻柔居中播放球；2:3 竖版保持海报艺术完整 */}
        {isBackdrop ? (
          <>
            <div
              className={`absolute inset-0 bg-black/25 transition-opacity pointer-events-none ${
                isQuickPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            />
            <div
              className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity z-20 ${
                isQuickPlaying
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
              }`}
            >
              <div
                className={`transform transition-transform duration-200 ${
                  isQuickPlaying ? 'scale-100' : 'scale-90 group-hover:scale-100'
                }`}
              >
                {onQuickPlay ? (
                  <button
                    type="button"
                    disabled={isQuickPlaying}
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickPlay(item);
                    }}
                    className="pointer-events-auto w-11 h-11 rounded-full bg-white/95 hover:bg-white text-[#1D1D1F] flex items-center justify-center shadow-xl transform hover:scale-110 active:scale-95 transition-all duration-150 cursor-pointer disabled:cursor-wait"
                    title={isQuickPlaying ? '准备播放...' : '立即播放'}
                    aria-label={isQuickPlaying ? '准备播放...' : '立即播放'}
                  >
                    {isQuickPlaying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>
                ) : (
                  <div className="w-11 h-11 rounded-full bg-white/95 text-[#1D1D1F] flex items-center justify-center shadow-xl">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 via-black/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            {onQuickPlay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickPlay(item);
                }}
                className="absolute bottom-2.5 left-2.5 w-8 h-8 rounded-full bg-white/95 hover:bg-white text-[#1D1D1F] flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transform translate-y-1 group-hover:translate-y-0 transition-all duration-200 cursor-pointer z-20"
                title="立即播放"
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              </button>
            )}
          </>
        )}

        {/* 跨服搜索来源微标（极简黑白半透） */}
        {(serverBadge || item.ServerName) && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md text-[10px] font-medium text-white/90 flex items-center space-x-1 max-w-[110px] z-10">
            <Server className="w-2.5 h-2.5 flex-shrink-0 text-white/80" />
            <span className="truncate">{serverBadge || item.ServerName}</span>
          </div>
        )}

        {/* 右上角仅保留显式来源标签或低调已看小勾 */}
        {badge ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md text-[10px] font-medium text-white/90 z-10">
            {badge}
          </div>
        ) : isPlayed ? (
          <div
            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/55 backdrop-blur-md text-white flex items-center justify-center z-10"
            title="已观看"
          >
            <Check className="w-3 h-3 stroke-[2.5]" />
          </div>
        ) : null}

        {/* 悬停斜向光学光泽 (Specular Sheen) */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 45%)',
          }}
        />

        {/* Up Next 16:9 底部抗亮图三段柔和暗角 + 剩余时长 + 内嵌圆角浮轨 */}
        {isBackdrop && (remainingLabel || progressPercent > 0) && (
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/82 via-black/38 to-transparent pointer-events-none z-10" />
        )}
        {isBackdrop && remainingLabel && (
          <div
            className={`absolute ${
              progressPercent > 0 ? 'bottom-6' : 'bottom-3'
            } left-3.5 flex items-center space-x-1 text-[11px] font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] z-10 select-none tabular-nums`}
          >
            <Play className="w-2.5 h-2.5 fill-current flex-shrink-0" />
            <span>{remainingLabel}</span>
          </div>
        )}

        {isBackdrop && progressPercent > 0 && (
          <div className="absolute left-3.5 right-3.5 bottom-3 h-1 rounded-full bg-white/30 overflow-hidden z-10">
            <div
              className="h-full bg-white rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {!isBackdrop && progressPercent > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/25 z-10">
            <div
              className="h-full bg-white transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Info labels */}
      <div className="mt-2.5 px-0.5">
        <h3 className="text-[13.5px] font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate leading-snug">
          {item.SeriesName && isBackdrop ? item.SeriesName : item.Name}
        </h3>
        <p className="text-[12px] font-normal text-[#86868B] dark:text-white/55 truncate mt-0.5 tabular-nums">
          {isBackdrop ? backdropMetaText : posterMetaText}
        </p>
      </div>
    </div>
  );
};

export const MediaCard = React.memo(MediaCardComponent);
export default MediaCard;

