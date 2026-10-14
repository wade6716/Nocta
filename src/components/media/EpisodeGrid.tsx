import React from 'react';
import { Play } from 'lucide-react';
import { EmbyItem, buildItemImageUrl, ticksToSeconds } from '../../api/embyClient';

interface EpisodeGridProps {
  episodes: EmbyItem[];
  serverUrl: string;
  currentEpisodeId?: string;
  onSelectEpisode: (episode: EmbyItem) => void;
}

function formatMinutes(ticks?: number): string {
  if (!ticks) return '';
  const mins = Math.round(ticksToSeconds(ticks) / 60);
  return `${mins} 分钟`;
}

export const EpisodeGrid: React.FC<EpisodeGridProps> = ({
  episodes,
  serverUrl,
  currentEpisodeId,
  onSelectEpisode,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {episodes.map((ep) => {
        const isCurrent = ep.Id === currentEpisodeId;
        const imageUrl = buildItemImageUrl(
          serverUrl,
          ep.Id,
          ep.ImageTags?.Primary || ep.BackdropImageTags?.[0],
          { type: 'Primary', maxWidth: 400, quality: 80 }
        );

        const positionTicks = ep.UserData?.PlaybackPositionTicks || 0;
        const totalTicks = ep.RunTimeTicks || 0;
        const progressPercent =
          totalTicks > 0 ? Math.min(100, Math.round((positionTicks / totalTicks) * 100)) : 0;

        return (
          <div
            key={ep.Id}
            onClick={() => onSelectEpisode(ep)}
            className={`group relative flex flex-col bg-surface rounded-xl overflow-hidden border cursor-pointer transition-all ${
              isCurrent
                ? 'border-primary ring-1 ring-primary'
                : 'border-white/5 hover:border-white/20 hover:-translate-y-0.5'
            }`}
          >
            {/* Thumbnail */}
            <div className="relative aspect-video w-full bg-black/40 overflow-hidden">
              <img
                src={imageUrl}
                alt={ep.Name}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170" viewBox="0 0 300 170"><rect width="100%" height="100%" fill="%23161922"/><text x="50%" y="50%" fill="%23666" font-family="sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">暂无分集缩略图</text></svg>';
                }}
              />

              {/* Episode index pill */}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-xs font-mono font-semibold text-white">
                第 {ep.IndexNumber ?? '-'} 集
              </div>

              {/* Hover play icon */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shadow-lg">
                  <Play className="w-5 h-5 fill-white ml-0.5" />
                </div>
              </div>

              {/* Progress Bar */}
              {progressPercent > 0 && (
                <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
                  <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-3 flex-1 flex flex-col justify-between">
              <div>
                <h4
                  className={`text-sm font-semibold truncate ${
                    isCurrent ? 'text-primary' : 'text-gray-200 group-hover:text-primary transition-colors'
                  }`}
                >
                  {ep.Name}
                </h4>
                {ep.Overview && (
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                    {ep.Overview}
                  </p>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400 font-mono">
                <span>{formatMinutes(ep.RunTimeTicks)}</span>
                {ep.UserData?.Played && <span className="text-green-400">已看完</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default EpisodeGrid;
