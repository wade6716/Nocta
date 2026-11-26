import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Play,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  LocateFixed,
} from 'lucide-react';
import {
  EmbyItem,
  resolveEpisodeThumbnailUrl,
  resolveItemBackdropUrl,
  stripImageFormatWebp,
  ticksToSeconds,
  formatFileSize,
  getItemFileSize,
} from '../../api/embyClient';

const EPISODES_PER_PAGE = 24;

interface EpisodeGridProps {
  episodes: EmbyItem[];
  serverUrl: string;
  currentEpisodeId?: string;
  selectedEpisodeId?: string;
  seriesItem?: EmbyItem | null;
  onSelectEpisode: (episode: EmbyItem) => void;
  onPlayEpisode?: (episode: EmbyItem) => void;
}

function formatMinutes(ticks?: number): string {
  if (!ticks) return '';
  const mins = Math.round(ticksToSeconds(ticks) / 60);
  return `${mins} 分钟`;
}

/**
 * 解析剧集列表中当前正在观看或最值得定位的目标分集：
 * 1. 显式传入的 currentEpisodeId（从播放页或分集详情页进入）
 * 2. 有断点进度且未完播的最近观看集
 * 3. 已完播的最后一集的下一集（或最后一集）
 */
function resolveActiveEpisode(
  episodes: EmbyItem[],
  currentEpisodeId?: string
): EmbyItem | null {
  if (episodes.length === 0) return null;

  if (currentEpisodeId) {
    const explicit = episodes.find((ep) => ep.Id === currentEpisodeId);
    if (explicit) return explicit;
  }

  let bestInProgress: EmbyItem | null = null;
  let bestInProgressTime = -Infinity;
  let bestInProgressIdx = -1;

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const hasProgress = (ep.UserData?.PlaybackPositionTicks || 0) > 0 && !ep.UserData?.Played;
    if (!hasProgress) continue;

    const playedMs = ep.UserData?.LastPlayedDate ? Date.parse(ep.UserData.LastPlayedDate) : NaN;
    const timestamp = Number.isFinite(playedMs) ? playedMs : -Infinity;
    if (
      !bestInProgress ||
      timestamp > bestInProgressTime ||
      (timestamp === bestInProgressTime && i > bestInProgressIdx)
    ) {
      bestInProgress = ep;
      bestInProgressTime = timestamp;
      bestInProgressIdx = i;
    }
  }
  if (bestInProgress) return bestInProgress;

  for (let i = episodes.length - 1; i >= 0; i--) {
    if (episodes[i].UserData?.Played) {
      return episodes[i + 1] ?? episodes[i];
    }
  }

  return null;
}

function formatEpisodeRangeLabel(
  pageEpisodes: EmbyItem[],
  startIdx: number,
  totalCount: number,
  sortOrder: 'asc' | 'desc'
): string {
  const first = pageEpisodes[0];
  const last = pageEpisodes[pageEpisodes.length - 1];
  if (!first || !last) return '';

  const firstNum = first.IndexNumber;
  const lastNum = last.IndexNumber;
  if (
    typeof firstNum === 'number' &&
    Number.isFinite(firstNum) &&
    firstNum > 0 &&
    typeof lastNum === 'number' &&
    Number.isFinite(lastNum) &&
    lastNum > 0
  ) {
    if (pageEpisodes.length === 1 || firstNum === lastNum) {
      return `第 ${firstNum} 集`;
    }
    return `${firstNum}-${lastNum}`;
  }

  if (sortOrder === 'asc') {
    const from = startIdx + 1;
    const to = startIdx + pageEpisodes.length;
    return from === to ? `第 ${from} 集` : `${from}-${to}`;
  }

  const from = totalCount - startIdx;
  const to = totalCount - startIdx - pageEpisodes.length + 1;
  return from === to ? `第 ${from} 集` : `${from}-${to}`;
}

const EpisodeGridComponent: React.FC<EpisodeGridProps> = ({
  episodes,
  serverUrl,
  currentEpisodeId,
  selectedEpisodeId,
  seriesItem,
  onSelectEpisode,
  onPlayEpisode,
}) => {
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(0);
  const lastAutoLocatedKeyRef = useRef<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const activeEpisode = useMemo(
    () => resolveActiveEpisode(episodes, currentEpisodeId),
    [episodes, currentEpisodeId]
  );

  const sortedEpisodes = useMemo(
    () => (sortOrder === 'asc' ? episodes : [...episodes].reverse()),
    [episodes, sortOrder]
  );

  const totalPages = Math.max(1, Math.ceil(sortedEpisodes.length / EPISODES_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages - 1);

  const activeEpisodeIndexInSorted = useMemo(
    () => (activeEpisode ? sortedEpisodes.findIndex((ep) => ep.Id === activeEpisode.Id) : -1),
    [activeEpisode, sortedEpisodes]
  );

  const activeEpisodePage =
    activeEpisodeIndexInSorted >= 0
      ? Math.floor(activeEpisodeIndexInSorted / EPISODES_PER_PAGE)
      : -1;

  // 进入详情页或切换季拿到新分集列表时，自动跳转至当前播放进度所在页
  const autoLocateKey = `${episodes[0]?.Id ?? ''}:${episodes[episodes.length - 1]?.Id ?? ''}:${episodes.length}:${activeEpisode?.Id ?? ''}`;
  useEffect(() => {
    if (lastAutoLocatedKeyRef.current === autoLocateKey) return;
    lastAutoLocatedKeyRef.current = autoLocateKey;
    setCurrentPage(activeEpisodePage >= 0 ? activeEpisodePage : 0);
  }, [autoLocateKey, activeEpisodePage]);

  const handleToggleSortOrder = (nextOrder: 'asc' | 'desc') => {
    if (nextOrder === sortOrder) return;
    setSortOrder(nextOrder);
    setCurrentPage(0);
  };

  const handleFooterPageChange = (nextPage: number) => {
    setCurrentPage(nextPage);
    toolbarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const visibleEpisodes = useMemo(() => {
    const start = safePage * EPISODES_PER_PAGE;
    return sortedEpisodes.slice(start, start + EPISODES_PER_PAGE);
  }, [sortedEpisodes, safePage]);

  const pageRangeItems = useMemo(() => {
    if (totalPages <= 1) return [];
    return Array.from({ length: totalPages }, (_, page) => {
      const start = page * EPISODES_PER_PAGE;
      const slice = sortedEpisodes.slice(start, start + EPISODES_PER_PAGE);
      return {
        page,
        label: formatEpisodeRangeLabel(slice, start, sortedEpisodes.length, sortOrder),
        hasActive: page === activeEpisodePage,
      };
    });
  }, [totalPages, sortedEpisodes, sortOrder, activeEpisodePage]);

  return (
    <div className="space-y-5 select-none">
      {/* 顶部控制栏：总集数 / 当前页 / 一键定位当前集 / 正序倒序切换 */}
      {episodes.length > 0 && (
        <div ref={toolbarRef} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="text-slate-300 font-medium tabular-nums">
                共 {episodes.length} 集
              </span>
              {totalPages > 1 && (
                <span className="text-slate-400 font-mono tabular-nums">
                  · 第 {safePage + 1} / {totalPages} 页
                </span>
              )}
              {activeEpisode && activeEpisodePage >= 0 && activeEpisodePage !== safePage && (
                <button
                  type="button"
                  onClick={() => setCurrentPage(activeEpisodePage)}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 border border-[#38BDF8]/40 text-[#38BDF8] text-xs font-medium transition cursor-pointer"
                  title={`跳转到当前进度所在的第 ${activeEpisodePage + 1} 页`}
                >
                  <LocateFixed className="w-3.5 h-3.5" />
                  <span>
                    定位当前集
                    {activeEpisode.IndexNumber !== undefined
                      ? ` (E${activeEpisode.IndexNumber})`
                      : ''}
                  </span>
                </button>
              )}
            </div>

            {/* 正序 / 倒序排列开关 */}
            <div className="inline-flex items-center p-0.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs">
              <button
                type="button"
                onClick={() => handleToggleSortOrder('asc')}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                  sortOrder === 'asc'
                    ? 'bg-[#38BDF8] text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowUpNarrowWide className="w-3.5 h-3.5" />
                <span>正序</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleSortOrder('desc')}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                  sortOrder === 'desc'
                    ? 'bg-[#38BDF8] text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowDownWideNarrow className="w-3.5 h-3.5" />
                <span>倒序</span>
              </button>
            </div>
          </div>

          {/* 区间分集分页胶囊栏 */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <button
                type="button"
                disabled={safePage <= 0}
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                title="上一页"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {pageRangeItems.map((pageItem) => {
                const isSelected = pageItem.page === safePage;
                return (
                  <button
                    key={pageItem.page}
                    type="button"
                    onClick={() => setCurrentPage(pageItem.page)}
                    className={`relative inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono tabular-nums border transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8] font-bold shadow-sm shadow-sky-500/15'
                        : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                    }`}
                    title={`第 ${pageItem.page + 1} 页`}
                  >
                    <span>{pageItem.label}</span>
                    {pageItem.hasActive && !isSelected && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]"
                        title="当前观看进度在此页"
                      />
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                title="下一页"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 分集卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {visibleEpisodes.map((ep) => {
          const isCurrent = ep.Id === activeEpisode?.Id;
          const isSelected = ep.Id === selectedEpisodeId;
          const versionCount = ep.MediaSources?.length || 0;
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
                isSelected
                  ? 'border-[#38BDF8] ring-2 ring-[#38BDF8]/40 shadow-lg shadow-sky-500/15'
                  : isCurrent
                  ? 'border-[#38BDF8]/65 ring-1 ring-[#38BDF8]/25 shadow-lg shadow-sky-500/10'
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

                {/* Top-left episode & multi-version badge */}
                <div className="absolute top-2.5 left-2.5 flex items-center space-x-1.5">
                  <div className="px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md border border-white/10 text-xs font-mono font-bold text-[#38BDF8] tabular-nums shadow">
                    {epNum}
                  </div>
                  {versionCount > 1 && (
                    <div className="px-1.5 py-0.5 rounded-md bg-purple-500/25 border border-purple-400/40 backdrop-blur-md text-[10px] font-semibold text-purple-200 shadow">
                      {versionCount} 版本
                    </div>
                  )}
                </div>

                {/* Top-right selected / played / current progress badge */}
                {isSelected ? (
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-[#38BDF8] text-slate-950 text-[11px] font-bold shadow">
                    查看中
                  </div>
                ) : ep.UserData?.Played ? (
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 backdrop-blur-md text-[11px] font-medium text-emerald-300 flex items-center space-x-1">
                    <Check className="w-3 h-3" />
                    <span>已看</span>
                  </div>
                ) : isCurrent ? (
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-[#38BDF8]/20 border border-[#38BDF8]/45 backdrop-blur-md text-[11px] font-medium text-[#38BDF8]">
                    当前进度
                  </div>
                ) : null}

                {/* Hover play icon (click directly plays without opening top detail) */}
                <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      (onPlayEpisode || onSelectEpisode)(ep);
                    }}
                    className="pointer-events-auto cursor-pointer w-11 h-11 rounded-full bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 flex items-center justify-center shadow-xl shadow-sky-500/35 transform scale-75 group-hover:scale-100 transition-transform"
                    title="直接播放此集"
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </button>
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

      {/* 底部翻页栏 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center space-x-3 pt-2">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => handleFooterPageChange(Math.max(0, safePage - 1))}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-medium text-slate-200 transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>上一页</span>
          </button>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            第 {safePage + 1} / {totalPages} 页
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => handleFooterPageChange(Math.min(totalPages - 1, safePage + 1))}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-medium text-slate-200 transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <span>下一页</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export const EpisodeGrid = React.memo(EpisodeGridComponent);
export default EpisodeGrid;
