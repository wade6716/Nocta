import React from 'react';
import { Check, Play } from 'lucide-react';
import {
  EmbyItem,
  resolveEpisodeThumbnailUrl,
  resolveItemBackdropUrl,
  stripImageFormatWebp,
  ticksToSeconds,
  formatFileSize,
  getItemFileSize,
} from '../../api/embyClient';

interface EpisodeGridProps {
  episodes: EmbyItem[];
  serverUrl: string;
  currentEpisodeId?: string;
  seriesItem?: EmbyItem | null;
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
  seriesItem,
  onSelectEpisode,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 select-none">
      {episodes.map((ep) => {
        const isCurrent = ep.Id === currentEpisodeId;
        const imageUrl = resolveEpisodeThumbnailUrl(serverUrl, ep, {
          maxWidth: 640,
          quality: 85,
          seriesItem,
        });
        const seriesFallbackUrl = seriesItem
          ? resolveItemBackdropUrl(serverUrl, seriesItem, {
              maxWidth: 640,
              quality: 85,
              mode: 'hero',
              allowPrimaryFallback: true,
            })
          : '';

        const positionTicks = ep.UserData?.PlaybackPositionTicks || 0;
        const totalTicks = ep.RunTimeTicks || 0;
        const progressPercent =
          totalTicks > 0 ? Math.min(100, Math.round((positionTicks / totalTicks) * 100)) : 0;

        const epNum =
          ep.IndexNumber !== undefined
            ? `E${String(ep.IndexNumber).padStart(2, '0')}`
            : 'EP';

        const epSize = getItemFileSize(ep);
        const epSizeLabel = formatFileSize(epSize);
        const sourcesWithSize = (ep.MediaSources || []).filter(
          (ms) => typeof ms.Size === 'number' && Number.isFinite(ms.Size) && ms.Size > 0
        );
        const primaryContainer =
          sourcesWithSize[0]?.Container || ep.MediaSources?.[0]?.Container;
        const epMetaTooltip = [
          ep.RunTimeTicks ? formatMinutes(ep.RunTimeTicks) : null,
          epSizeLabel
            ? `体积：${epSizeLabel}${
                primaryContainer ? ` (${primaryContainer.toUpperCase()})` : ''
              }${sourcesWithSize.length > 1 ? ` · 共 ${sourcesWithSize.length} 个版本` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

        return (
          <div
            key={ep.Id}
            onClick={() => onSelectEpisode(ep)}
            className={`group relative flex flex-col bg-[#131826]/85 hover:bg-[#161c2e] rounded-2xl overflow-hidden border cursor-pointer transition-all duration-200 ${
              isCurrent
                ? 'border-[#38BDF8] ring-1 ring-[#38BDF8]/40 shadow-lg shadow-sky-500/10'
                : 'border-white/[0.08] hover:border-[#38BDF8]/45 hover:-translate-y-0.5 shadow-md shadow-black/30'
            }`}
          >
            {/* Top 16:9 Wide Thumbnail */}
            <div className="relative w-full aspect-video bg-black/60 overflow-hidden shrink-0">
              {imageUrl ? (
                <img
                  key={imageUrl}
                  src={imageUrl}
                  alt={ep.Name}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onError={(e) => {
                    const target = e.currentTarget;
                    const step = target.dataset.fallbackStep;
                    if (step === 'done') return;

                    if (!step) {
                      const noWebp = stripImageFormatWebp(target.src);
                      if (noWebp) {
                        target.dataset.fallbackStep = '1';
                        target.src = noWebp;
                        return;
                      }
                    }

                    if (
                      step !== '2' &&
                      seriesFallbackUrl &&
                      seriesFallbackUrl !== imageUrl &&
                      target.src !== seriesFallbackUrl
                    ) {
                      target.dataset.fallbackStep = '2';
                      target.src = seriesFallbackUrl;
                      return;
                    }

                    target.dataset.fallbackStep = 'done';
                    target.src =
                      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="%23131826"/><text x="50%" y="50%" fill="%2364748B" font-family="sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle">暂无剧照</text></svg>';
                  }}
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#131826] via-[#172033] to-[#0f1422] flex items-center justify-center text-xs text-slate-500">
                  暂无剧照
                </div>
              )}

              {/* Subtle bottom vignette for badge legibility */}
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />

              {/* Top-left episode badge */}
              <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md border border-white/10 text-xs font-mono font-bold text-[#38BDF8] tabular-nums shadow">
                {epNum}
              </div>

              {/* Top-right played badge */}
              {ep.UserData?.Played && (
                <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 backdrop-blur-md text-[11px] font-medium text-emerald-300 flex items-center space-x-1">
                  <Check className="w-3 h-3" />
                  <span>已看</span>
                </div>
              )}

              {/* Hover play icon */}
              <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <div className="w-11 h-11 rounded-full bg-[#38BDF8] text-slate-950 flex items-center justify-center shadow-xl shadow-sky-500/35 transform scale-75 group-hover:scale-100 transition-transform">
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                </div>
              </div>

              {/* Duration & file size badge */}
              {(ep.RunTimeTicks || epSizeLabel) && (
                <div
                  className="absolute bottom-2.5 right-2.5 max-w-[calc(100%-1.25rem)] px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[11px] font-mono text-slate-200 tabular-nums border border-white/10 inline-flex items-center gap-1.5 truncate"
                  title={epMetaTooltip || undefined}
                >
                  {ep.RunTimeTicks && <span>{formatMinutes(ep.RunTimeTicks)}</span>}
                  {ep.RunTimeTicks && epSizeLabel && <span className="text-slate-500">·</span>}
                  {epSizeLabel && <span className="text-sky-300/95">{epSizeLabel}</span>}
                </div>
              )}

              {/* Progress Bar */}
              {progressPercent > 0 && (
                <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                  <div className="h-full bg-[#38BDF8]" style={{ width: `${progressPercent}%` }} />
                </div>
              )}
            </div>

            {/* Bottom Full-Width Info Details */}
            <div className="p-3.5 flex-1 flex flex-col min-w-0">
              <h3
                className="text-sm font-semibold text-slate-50 group-hover:text-[#38BDF8] transition-colors line-clamp-1"
                title={ep.Name}
              >
                {ep.Name}
              </h3>

              {ep.Overview ? (
                <p
                  className="text-xs text-slate-300/95 mt-1.5 line-clamp-3 leading-relaxed"
                  title={ep.Overview}
                >
                  {ep.Overview}
                </p>
              ) : (
                <p className="text-xs text-slate-500 italic mt-1.5">暂无单集介绍</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default EpisodeGrid;
