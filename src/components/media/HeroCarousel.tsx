import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Info,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  EmbyItem,
  extractVideoQualityBadges,
  formatSeriesEpisodeBadge,
  resolveItemBackdropUrl,
  resolveItemLogoUrl,
  resolveItemPosterUrl,
  stripImageFormatWebp,
  ticksToSeconds,
} from '../../api/embyClient';

interface HeroCarouselProps {
  items: EmbyItem[];
  serverUrl: string;
  startingPlay: boolean;
  isRefreshing: boolean;
  onPlay: (item: EmbyItem) => void;
  onDetail: (item: EmbyItem) => void;
  onRefresh: () => void;
}

function formatRuntimeLabel(ticks?: number): string | null {
  if (!ticks || ticks <= 0) return null;
  const mins = Math.round(ticksToSeconds(ticks) / 60);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins}分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}

export const HeroCarousel: React.FC<HeroCarouselProps> = ({
  items,
  serverUrl,
  startingPlay,
  isRefreshing,
  onPlay,
  onDetail,
  onRefresh,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [logoFailedIds, setLogoFailedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(0);
    }
  }, [items.length, activeIndex]);

  // 自动轮播（鼠标悬停时暂停）
  useEffect(() => {
    if (items.length <= 1 || isPaused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [items.length, isPaused]);

  const currentItem = items[activeIndex] || items[0];

  const backdropUrl = useMemo(() => {
    if (!currentItem || !serverUrl) return '';
    return resolveItemBackdropUrl(serverUrl, currentItem, {
      maxWidth: 1920,
      quality: 90,
      mode: 'hero',
      allowPrimaryFallback: true,
    });
  }, [currentItem, serverUrl]);

  const primaryFallbackUrl = useMemo(() => {
    if (!currentItem || !serverUrl) return '';
    return resolveItemPosterUrl(serverUrl, currentItem, {
      maxWidth: 1200,
      quality: 85,
    });
  }, [currentItem, serverUrl]);

  const logoUrl = useMemo(() => {
    if (!currentItem || !serverUrl || logoFailedIds[currentItem.Id]) return '';
    return resolveItemLogoUrl(serverUrl, currentItem, {
      maxWidth: 640,
      quality: 90,
    });
  }, [currentItem, serverUrl, logoFailedIds]);

  if (!currentItem) return null;

  const positionTicks = currentItem.UserData?.PlaybackPositionTicks || 0;
  const totalTicks = currentItem.RunTimeTicks || 0;
  const progressPercent =
    totalTicks > 0 ? Math.min(100, Math.round((positionTicks / totalTicks) * 100)) : 0;
  const remainingMinutes =
    totalTicks > positionTicks
      ? Math.max(1, Math.ceil((ticksToSeconds(totalTicks) - ticksToSeconds(positionTicks)) / 60))
      : 0;
  const isResume = progressPercent > 0;

  const qualityBadges = extractVideoQualityBadges(currentItem);
  const episodeBadge = formatSeriesEpisodeBadge(currentItem);
  const year = currentItem.ProductionYear || currentItem.PremiereDate?.slice(0, 4);
  const rating =
    typeof currentItem.CommunityRating === 'number' && currentItem.CommunityRating > 0
      ? currentItem.CommunityRating.toFixed(1)
      : null;

  const displayTitle = currentItem.SeriesName || currentItem.Name;
  const episodeSubLabel =
    currentItem.Type === 'Episode' && currentItem.IndexNumber !== undefined
      ? `${currentItem.ParentIndexNumber !== undefined ? `S${currentItem.ParentIndexNumber}E${currentItem.IndexNumber}` : `第 ${currentItem.IndexNumber} 集`}${
          currentItem.Name ? ` · ${currentItem.Name}` : ''
        }`
      : '';

  const handlePrev = () => {
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % items.length);
  };

  const kickerLabel = isResume
    ? '继续观看'
    : currentItem.Type === 'Series'
    ? '精选剧集'
    : currentItem.Type === 'Movie'
    ? '精选电影'
    : '精选推荐';

  const runtimeLabel = formatRuntimeLabel(currentItem.RunTimeTicks);
  const genresText = currentItem.Genres?.slice(0, 2).join(' / ');

  const heroMetaParts: string[] = [];
  if (episodeSubLabel) {
    heroMetaParts.push(episodeSubLabel);
    if (runtimeLabel) heroMetaParts.push(runtimeLabel);
  } else {
    if (year) heroMetaParts.push(String(year));
    if (genresText) heroMetaParts.push(genresText);
    if (episodeBadge) heroMetaParts.push(episodeBadge);
    if (runtimeLabel) heroMetaParts.push(runtimeLabel);
  }
  if (rating) {
    heroMetaParts.push(`★ ${rating}`);
  }
  const heroTechBadges = qualityBadges.slice(0, 2);

  return (
    <div className="relative w-full">
      {/* 动态剧照环境色柔光过渡带：将银幕光影自然羽化进纯白/影院黑画廊 */}
      {backdropUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 inset-x-0 h-32 overflow-hidden z-0"
          style={{
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)',
          }}
        >
          <img
            src={backdropUrl}
            alt=""
            className="w-full h-full object-cover object-bottom scale-110 blur-[48px] saturate-150 opacity-[0.22] dark:opacity-[0.35]"
          />
        </div>
      )}

      <section
        onClick={() => onDetail(currentItem)}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="preserve-dark relative z-10 w-full h-[clamp(400px,58vh,560px)] overflow-hidden bg-[#0A0A0C] group select-none cursor-pointer"
      >
        {/* 背景剧照层 */}
        {backdropUrl && (
          <img
            key={backdropUrl}
            src={backdropUrl}
            alt={displayTitle}
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
                primaryFallbackUrl &&
                primaryFallbackUrl !== backdropUrl &&
                target.src !== primaryFallbackUrl
              ) {
                target.dataset.fallbackStep = '2';
                target.src = primaryFallbackUrl;
                return;
              }

              target.dataset.fallbackStep = 'done';
              target.style.display = 'none';
            }}
            className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-1000 ease-out"
          />
        )}

        {/* 光学三层暗角遮罩：顶部护航悬浮顶栏、底部电影融底、左侧文字可读区 */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/52 via-black/18 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/26 via-42% to-transparent dark:from-[#0A0A0C] dark:via-[#0A0A0C]/45 dark:via-42% dark:to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/72 via-black/22 via-48% to-transparent pointer-events-none" />

        {/* 右上角轻量刷新按钮（悬停剧照时柔和显现） */}
        <div
          className={`absolute top-14 right-6 lg:right-10 z-20 transition-opacity duration-300 ${
            isRefreshing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            disabled={isRefreshing}
            className="p-2 rounded-full bg-black/35 hover:bg-black/55 text-white/90 hover:text-white backdrop-blur-2xl border border-white/20 transition cursor-pointer disabled:opacity-60"
            title="刷新媒体库"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-white' : ''}`} />
          </button>
        </div>

        {/* 左右边缘轻量翻页箭头（悬停剧照时出现） */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/35 hover:bg-black/55 text-white/90 hover:text-white backdrop-blur-xl border border-white/15 items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              title="上一部"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/35 hover:bg-black/55 text-white/90 hover:text-white backdrop-blur-xl border border-white/15 items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              title="下一部"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {/* 左下角核心焦点信息（克制 4 层 Apple TV+ 电影排印） */}
        <div className="absolute bottom-11 left-8 right-8 lg:left-12 lg:right-24 z-10 flex flex-col justify-end max-w-xl">
          {/* 第 1 层：无框微型导语 */}
          <div className="text-[11px] sm:text-xs font-semibold tracking-[0.06em] uppercase text-white/80 mb-1.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
            {kickerLabel}
          </div>

          {/* 第 2 层：片名透明 Logo（优先）或紧字距大字排印 */}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={displayTitle}
              onError={() =>
                setLogoFailedIds((prev) => ({
                  ...prev,
                  [currentItem.Id]: true,
                }))
              }
              className="max-h-14 sm:max-h-20 max-w-[280px] sm:max-w-[360px] w-auto object-contain object-left drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)] mb-2"
            />
          ) : (
            <h2 className="text-3xl sm:text-5xl font-bold text-white tracking-[-0.025em] drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)] line-clamp-1 mb-1.5">
              {displayTitle}
            </h2>
          )}

          {/* 第 3 层：纯白圆点排版元数据 + 极简无彩框技术微标 */}
          {(heroMetaParts.length > 0 || heroTechBadges.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-[13px] font-medium text-white/88 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
              {heroMetaParts.map((part, idx) => (
                <React.Fragment key={`${part}-${idx}`}>
                  {idx > 0 && <span className="text-white/45">·</span>}
                  <span>{part}</span>
                </React.Fragment>
              ))}
              {heroTechBadges.map((q) => (
                <span
                  key={q}
                  className="px-1.5 py-[1px] rounded-[4px] border border-white/35 text-[10px] font-semibold tracking-wide text-white/85 uppercase leading-tight"
                >
                  {q}
                </span>
              ))}
            </div>
          )}

          {/* 简介（最多两行） */}
          {currentItem.Overview && (
            <p className="line-clamp-2 max-w-lg text-[13px] sm:text-sm text-white/80 leading-relaxed mt-2 drop-shadow-[0_1px_6px_rgba(0,0,0,0.45)]">
              {currentItem.Overview}
            </p>
          )}

          {/* 第 4 层：厚润实心纯白主按钮 + 圆形玻璃详情钮 + 轻量续播细轨 */}
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(currentItem);
              }}
              disabled={startingPlay}
              className="px-8 py-2.5 rounded-full bg-white hover:bg-white/90 text-[#1D1D1F] font-semibold text-xs sm:text-sm shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition flex items-center space-x-2 cursor-pointer disabled:opacity-60"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>
                {startingPlay ? '准备播放...' : isResume ? '继续播放' : '立即播放'}
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetail(currentItem);
              }}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-2xl border border-white/20 transition flex items-center justify-center cursor-pointer"
              title="查看详情"
              aria-label="查看详情"
            >
              <Info className="w-4 h-4" />
            </button>

            {isResume && (
              <div className="flex items-center space-x-2.5 pl-1">
                <div className="w-20 sm:w-24 h-1 rounded-full bg-white/25 overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-white/80 tabular-nums whitespace-nowrap drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
                  {remainingMinutes > 0 ? `剩余 ${remainingMinutes} 分钟` : `${progressPercent}%`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 底部居中动态轮播进度胶囊 */}
        {items.length > 1 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center space-x-1.5"
          >
            {items.map((item, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={item.Id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveIndex(idx);
                  }}
                  aria-label={`切换到第 ${idx + 1} 部推荐`}
                  className={`relative h-1.5 rounded-full overflow-hidden transition-all duration-300 cursor-pointer ${
                    active ? 'w-7 bg-white/30' : 'w-1.5 bg-white/40 hover:bg-white/75'
                  }`}
                >
                  {active && (
                    <span
                      key={`${activeIndex}-${items.length}`}
                      style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
                      className="absolute inset-0 rounded-full bg-white animate-hero-pill-progress"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default HeroCarousel;
