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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 select-none">
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

        const epNum =
          ep.IndexNumber !== undefined
            ? `E${String(ep.IndexNumber).padStart(2, '0')}`
            : 'EP';

        return (
          <div
            key={ep.Id}
            onClick={() => onSelectEpisode(ep)}
            className={`group relative flex items-center p-2.5 bg-[#131826]/80 hover:bg-[#131826] rounded-xl overflow-hidden border cursor-pointer transition-all duration-200 ${
              isCurrent
                ? 'border-[#38BDF8] ring-1 ring-[#38BDF8]/40 shadow-lg shadow-sky-500/10'
                : 'border-white/[0.08] hover:border-[#38BDF8]/45 hover:-translate-y-0.5 shadow-md shadow-black/30'
            }`}
          >
            {/* Left Thumbnail (w-36 aspect-video) */}
            <div className="relative w-36 aspect-video bg-black/60 rounded-lg overflow-hidden flex-shrink-0">
              <img
                src={imageUrl}
                alt={ep.Name}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170" viewBox="0 0 300 170"><rect width="100%" height="100%" fill="%23131826"/><text x="50%" y="50%" fill="%2364748B" font-family="sans-serif" font-size="12" text-anchor="middle" dominant-baseline="middle">暂无剧照</text></svg>';
                }}
              />

              {/* Hover play icon */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-[#38BDF8] text-slate-950 flex items-center justify-center shadow-lg shadow-sky-500/30 transform scale-75 group-hover:scale-100 transition-transform">
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </div>
              </div>

              {/* Duration badge */}
              {ep.RunTimeTicks && (
                <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.2 rounded bg-black/80 backdrop-blur text-[10px] font-mono text-slate-300 tabular-nums">
                  {formatMinutes(ep.RunTimeTicks)}
                </div>
              )}

              {/* Progress Bar (规范: h-1 bg-white/20, 已看进度 bg-[#38BDF8]) */}
              {progressPercent > 0 && (
                <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                  <div className="h-full bg-[#38BDF8]" style={{ width: `${progressPercent}%` }} />
                </div>
              )}
            </div>

            {/* Right Info Details */}
            <div className="ml-3 min-w-0 flex-1 flex flex-col justify-center">
              <div className="flex items-center space-x-1.5 text-xs font-semibold">
                <span className="font-mono text-[#38BDF8] tabular-nums tracking-wide">
                  {epNum}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-100 truncate group-hover:text-[#38BDF8] transition-colors">
                  {ep.Name}
                </span>
              </div>

              {ep.Overview ? (
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {ep.Overview}
                </p>
              ) : (
                <p className="text-[11px] text-slate-500 italic mt-1">暂无单集介绍</p>
              )}

              {ep.UserData?.Played && (
                <span className="text-[10px] text-emerald-400 font-medium mt-1 inline-block">
                  ✓ 已看完
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default EpisodeGrid;
