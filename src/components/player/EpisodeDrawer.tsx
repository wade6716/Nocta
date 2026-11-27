import React, { useEffect, useRef } from 'react';
import {
  X,
  ListVideo,
  CheckCircle2,
  Play,
  Layers,
  HardDrive,
  Sparkles,
} from 'lucide-react';
import {
  EmbyItem,
  EmbyMediaSource,
  resolveEpisodeThumbnailUrl,
  stripImageFormatWebp,
  ticksToSeconds,
  formatFileSize,
  getItemFileSize,
} from '../../api/embyClient';
import { formatMediaSourceMeta } from '../../player/playbackSessionService';

interface EpisodeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentItemId: string;
  seasons: EmbyItem[];
  selectedSeasonId: string | null;
  onSelectSeason: (seasonId: string) => void;
  episodes: EmbyItem[];
  episodesLoading?: boolean;
  serverUrl?: string;
  onSelectEpisode: (ep: EmbyItem) => void;
  availableMediaSources: EmbyMediaSource[];
  activeMediaSourceId?: string;
  onSelectMediaSource: (ms: EmbyMediaSource) => void;
  autoPlayNext: boolean;
  onToggleAutoPlayNext: (val: boolean) => void;
}

function formatDurationBadge(ticks?: number): string {
  const sec = Math.floor(ticksToSeconds(ticks || 0));
  if (sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const EpisodeDrawer: React.FC<EpisodeDrawerProps> = ({
  isOpen,
  onClose,
  currentItemId,
  seasons,
  selectedSeasonId,
  onSelectSeason,
  episodes,
  episodesLoading = false,
  serverUrl,
  onSelectEpisode,
  availableMediaSources,
  activeMediaSourceId,
  onSelectMediaSource,
  autoPlayNext,
  onToggleAutoPlayNext,
}) => {
  const activeEpRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isOpen && activeEpRef.current) {
      setTimeout(() => {
        activeEpRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 80);
    }
  }, [isOpen, currentItemId, episodes.length]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-20 bg-transparent" onClick={onClose} />
      <div className="fixed top-16 bottom-24 right-6 z-30 w-80 md:w-96 rounded-2xl bg-white/[0.96] dark:bg-[#141416]/[0.95] border border-black/[0.12] dark:border-white/[0.12] flex flex-col text-[#1D1D1F] dark:text-white/90 select-none animate-in slide-in-from-right duration-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="flex items-center space-x-2">
            <ListVideo className="w-4 h-4 text-[#1D1D1F] dark:text-white" />
            <h2 className="text-sm font-semibold tracking-wide text-[#1D1D1F] dark:text-white">分集与片源版本</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-black/[0.08] dark:hover:bg-white/10 text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/60 dark:hover:text-white transition cursor-pointer"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 自动连播快捷栏 */}
        <div className="px-4 py-2.5 border-b border-black/[0.08] dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.02] flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-[#48484A] dark:text-white/80">
            <Sparkles className="w-3.5 h-3.5 text-[#1D1D1F] dark:text-white/80" />
            <span>播完自动连播下一集</span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoPlayNext}
              onChange={(e) => onToggleAutoPlayNext(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-black/[0.14] dark:bg-white/15 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1D1D1F] dark:peer-checked:bg-emerald-500" />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
          {/* 多版本片源选择 (如 4K HDR / 1080p 原盘) */}
          {availableMediaSources.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-[#6E6E73] dark:text-white/55 uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5 text-[#1D1D1F] dark:text-white/75" />
                <span>原画片源版本 ({availableMediaSources.length})</span>
              </div>
              <div className="space-y-1.5">
                {availableMediaSources.map((ms) => {
                  const isActive = ms.Id === activeMediaSourceId;
                  const meta = formatMediaSourceMeta(ms);
                  return (
                    <button
                      key={ms.Id}
                      onClick={() => onSelectMediaSource(ms)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition cursor-pointer flex items-center justify-between gap-2 ${
                        isActive
                          ? 'bg-[#1D1D1F] border-[#1D1D1F] text-white dark:bg-white dark:border-white dark:text-[#1D1D1F]'
                          : 'bg-black/[0.04] border-black/[0.08] hover:bg-black/[0.08] text-[#1D1D1F] dark:bg-white/[0.04] dark:border-white/10 dark:hover:bg-white/10 dark:text-white/85'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {ms.Name || meta.resolutionLabel || '默认版本'}
                        </div>
                        <div
                          className={`text-[11px] font-mono flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 ${
                            isActive
                              ? 'text-white/75 dark:text-[#1D1D1F]/70'
                              : 'text-[#6E6E73] dark:text-white/55'
                          }`}
                        >
                          <span>{meta.containerLabel}</span>
                          {meta.resolutionLabel && <span>{meta.resolutionLabel}</span>}
                          {meta.hdrLabel && <span className="font-semibold">{meta.hdrLabel}</span>}
                          {meta.sizeLabel && <span>{meta.sizeLabel}</span>}
                        </div>
                      </div>
                      {isActive && (
                        <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white dark:bg-black/15 dark:text-[#1D1D1F] font-bold">
                          当前
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 季选择器 */}
          {seasons.length > 1 && (
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 custom-scrollbar">
              {seasons.map((s) => {
                const isActive = selectedSeasonId === s.Id;
                return (
                  <button
                    key={s.Id}
                    onClick={() => onSelectSeason(s.Id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer border ${
                      isActive
                        ? 'bg-[#1D1D1F] text-white border-[#1D1D1F] dark:bg-white dark:text-[#1D1D1F] dark:border-white font-semibold'
                        : 'bg-black/[0.05] border-black/[0.08] text-[#48484A] hover:text-[#1D1D1F] dark:bg-white/[0.06] dark:border-white/10 dark:text-white/65 dark:hover:text-white'
                    }`}
                  >
                    {s.Name}
                  </button>
                );
              })}
            </div>
          )}

          {/* 分集列表 */}
          {episodes.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#6E6E73] dark:text-white/55">
                <span className="font-semibold uppercase tracking-wider">剧集选集</span>
                <span className="font-mono">{episodes.length} 集</span>
              </div>

              {episodesLoading ? (
                <div className="py-10 text-center text-xs text-[#6E6E73] dark:text-white/55">正在同步分集...</div>
              ) : (
                <div className="space-y-2">
                  {episodes.map((ep) => {
                    const isCurrent = ep.Id === currentItemId;
                    const thumb = serverUrl
                      ? resolveEpisodeThumbnailUrl(serverUrl, ep, {
                          maxWidth: 320,
                          quality: 80,
                        })
                      : '';
                    const posTicks = ep.UserData?.PlaybackPositionTicks || 0;
                    const totalTicks = ep.RunTimeTicks || 0;
                    const progress =
                      totalTicks > 0 && posTicks > 0
                        ? Math.min(100, Math.round((posTicks / totalTicks) * 100))
                        : 0;
                    const isPlayed = !!ep.UserData?.Played;
                    const epSizeLabel = formatFileSize(getItemFileSize(ep));

                    return (
                      <button
                        key={ep.Id}
                        ref={isCurrent ? activeEpRef : undefined}
                        onClick={() => {
                          if (!isCurrent) onSelectEpisode(ep);
                        }}
                        className={`w-full text-left p-2 rounded-xl border transition flex items-center space-x-3 group cursor-pointer ${
                          isCurrent
                            ? 'bg-black/[0.07] border-black/30 dark:bg-white/[0.12] dark:border-white/35'
                            : 'bg-black/[0.03] border-black/[0.07] hover:bg-black/[0.06] dark:bg-white/[0.04] dark:border-white/[0.08] dark:hover:bg-white/[0.09]'
                        }`}
                      >
                        <div className="preserve-dark w-24 aspect-video rounded-lg overflow-hidden bg-black/20 dark:bg-white/5 shrink-0 relative border border-black/10 dark:border-white/10">
                          {thumb ? (
                            <img
                              key={thumb}
                              src={thumb}
                              alt={ep.Name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
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
                                target.dataset.fallbackStep = 'done';
                                target.src =
                                  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="%231C1C1E"/><text x="50%" y="50%" fill="%238E8E93" font-family="sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle">暂无剧照</text></svg>';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/40">
                              <HardDrive className="w-4 h-4" />
                            </div>
                          )}

                          {isCurrent && (
                            <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                              <Play className="w-4 h-4 text-white fill-white" />
                            </div>
                          )}

                          {progress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                              <div
                                className="h-full bg-white"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`text-[11px] font-mono font-semibold ${
                                isCurrent ? 'text-[#1D1D1F] dark:text-white' : 'text-[#6E6E73] dark:text-white/55'
                              }`}
                            >
                              第 {ep.IndexNumber ?? '?'} 集
                            </span>
                            <div className="flex items-center space-x-1.5">
                              {epSizeLabel && (
                                <span className="text-[10px] font-mono text-[#6E6E73] dark:text-white/60">
                                  {epSizeLabel}
                                </span>
                              )}
                              {totalTicks > 0 && (
                                <span className="text-[10px] font-mono text-[#86868B] dark:text-white/45">
                                  {formatDurationBadge(totalTicks)}
                                </span>
                              )}
                              {isPlayed && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#047857] dark:text-emerald-400 shrink-0" />
                              )}
                            </div>
                          </div>
                          <div
                            className={`text-xs truncate mt-0.5 ${
                              isCurrent
                                ? 'text-[#1D1D1F] dark:text-white font-semibold'
                                : 'text-[#2C2C2E] dark:text-white/85 font-medium'
                            }`}
                            title={ep.Name}
                          >
                            {ep.Name}
                          </div>
                          {ep.Overview && (
                            <p
                              className="text-[11px] text-[#6E6E73] dark:text-white/55 line-clamp-1 mt-0.5 leading-snug"
                              title={ep.Overview}
                            >
                              {ep.Overview}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            availableMediaSources.length <= 1 && (
              <div className="py-12 text-center text-xs text-[#86868B] dark:text-white/45">
                当前影片为独立单部片源，无更多分集。
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
};

export default EpisodeDrawer;
