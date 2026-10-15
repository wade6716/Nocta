import React, { useState } from 'react';
import { Play, Check } from 'lucide-react';
import { EmbyItem, buildItemImageUrl } from '../../api/embyClient';

interface MediaCardProps {
  item: EmbyItem;
  serverUrl: string;
  onClick: (item: EmbyItem) => void;
  aspectRatio?: 'poster' | 'backdrop';
  subtitle?: string;
  badge?: string;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  serverUrl,
  onClick,
  aspectRatio = 'poster',
  subtitle,
  badge,
}) => {
  const isBackdrop = aspectRatio === 'backdrop';
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  // 智能图片寻址：
  // 1. 如果是剧集分集（Episode）在竖版海报（poster）模式下，使用父级剧集的 SeriesPrimaryImageTag
  // 2. 如果是横版海报（backdrop），优先使用分集的 Backdrop/Thumb/Primary，若没有则回退至剧集背景
  let imageItemId = item.Id;
  let imageType: 'Primary' | 'Backdrop' | 'Thumb' = isBackdrop ? 'Backdrop' : 'Primary';
  let imageTag: string | undefined = undefined;

  if (isBackdrop) {
    if (item.ImageTags?.Backdrop || item.BackdropImageTags?.[0]) {
      imageType = 'Backdrop';
      imageTag = item.ImageTags?.Backdrop || item.BackdropImageTags?.[0];
    } else if (item.ImageTags?.Thumb || item.ParentThumbImageTag || item.SeriesThumbImageTag) {
      imageType = 'Thumb';
      imageTag = item.ImageTags?.Thumb || item.ParentThumbImageTag || item.SeriesThumbImageTag;
    } else if (item.ImageTags?.Primary) {
      imageType = 'Primary';
      imageTag = item.ImageTags?.Primary;
    } else if (item.SeriesId) {
      imageItemId = item.SeriesId;
      imageType = 'Backdrop';
    }
  } else {
    // 竖版海报 (2:3)
    if (item.Type === 'Episode' && item.SeriesId) {
      imageItemId = item.SeriesId;
      imageType = 'Primary';
      imageTag = item.SeriesPrimaryImageTag || item.ImageTags?.Primary;
    } else {
      imageType = 'Primary';
      imageTag = item.ImageTags?.Primary;
    }
  }

  const imageUrl = buildItemImageUrl(serverUrl, imageItemId, imageTag, {
    type: imageType,
    maxWidth: isBackdrop ? 600 : 400,
    quality: 85,
  });

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
        {!isImageLoaded && (
          <div className="absolute inset-0 bg-[#131826] animate-pulse" />
        )}

        <img
          src={imageUrl}
          alt={item.Name}
          loading="lazy"
          onLoad={() => setIsImageLoaded(true)}
          className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
            isImageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onError={(e) => {
            setIsImageLoaded(true);
            const target = e.target as HTMLImageElement;
            // 针对分集海报未命中时的两级平滑降级：尝试取剧集封面
            if (item.SeriesId && imageItemId !== item.SeriesId) {
              target.src = buildItemImageUrl(serverUrl, item.SeriesId, item.SeriesPrimaryImageTag, {
                type: 'Primary',
                maxWidth: 400,
                quality: 85,
              });
              return;
            }
            // 最终兜底图
            target.src =
              'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="100%" height="100%" fill="%23131826"/><text x="50%" y="50%" fill="%2364748B" font-family="sans-serif" font-size="16" text-anchor="middle" dominant-baseline="middle">暂无海报</text></svg>';
          }}
        />

        {/* Hover play icon overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-[#38BDF8]/90 text-white flex items-center justify-center shadow-lg shadow-sky-500/25 transform scale-75 group-hover:scale-100 transition-transform duration-200">
            <Play className="w-5 h-5 fill-white ml-0.5" />
          </div>
        </div>

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

