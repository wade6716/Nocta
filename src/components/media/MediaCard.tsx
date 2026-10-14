import React from 'react';
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
      className="group relative flex flex-col cursor-pointer transition-transform duration-200 hover:-translate-y-1"
    >
      {/* Poster Image Container */}
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-surface border border-white/5 shadow-lg ${
          isBackdrop ? 'aspect-video' : 'aspect-[2/3]'
        }`}
      >
        <img
          src={imageUrl}
          alt={item.Name}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={(e) => {
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
              'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="100%" height="100%" fill="%23161922"/><text x="50%" y="50%" fill="%23666" font-family="sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle">暂无海报</text></svg>';
          }}
        />

        {/* Hover play icon overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/90 text-white flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform">
            <Play className="w-6 h-6 fill-white ml-0.5" />
          </div>
        </div>

        {/* Badge on top right */}
        {badge ? (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-semibold text-gray-200 border border-white/10">
            {badge}
          </div>
        ) : isPlayed ? (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-emerald-600/80 backdrop-blur-md text-[10px] font-semibold text-white flex items-center space-x-0.5">
            <Check className="w-3 h-3 stroke-[3]" />
            <span>已看</span>
          </div>
        ) : null}

        {/* Resume progress bar */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/60">
            <div
              className="h-full bg-primary"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Info labels */}
      <div className="mt-2.5 px-0.5">
        <h3 className="text-sm font-semibold text-gray-100 truncate group-hover:text-primary transition-colors">
          {item.Name}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
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
