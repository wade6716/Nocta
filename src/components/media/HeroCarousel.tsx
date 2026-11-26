import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Info,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Tv,
  Star,
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

  return (
    <section
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative w-full h-[440px] md:h-[490px] xl:h-[540px] overflow-hidden bg-[#0B0E17] group select-none"
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
          className="absolute inset-0 w-full h-full object-cover object-center filter brightness-[0.88] group-hover:scale-[1.03] transition-transform duration-1000 ease-out"
        />
      )}

      {/* Apple TV+ 风格三层电影院级羽化渐变融底遮罩 */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0E17] via-[#0B0E17]/65 via-30% to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0B0E17]/95 via-[#0B0E17]/45 via-50% to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B0E17]/45 via-transparent to-transparent" />

      {/* 右上角轻量刷新按钮 */}
      <div className="absolute top-4 right-6 z-20 flex items-center space-x-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-full bg-black/35 hover:bg-black/55 text-slate-200 hover:text-white backdrop-blur-xl border border-white/10 transition cursor-pointer disabled:opacity-60"
          title="刷新媒体库"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#38BDF8]' : ''}`} />
        </button>
      </div>

      {/* 左右轮播切换箭头（多条候选时悬浮显示） */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={handlePrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/40 hover:bg-black/65 text-white/80 hover:text-white backdrop-blur-xl border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
            title="上一部"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/40 hover:bg-black/65 text-white/80 hover:text-white backdrop-blur-xl border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
            title="下一部"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* 左下角核心焦点信息 */}
      <div className="absolute bottom-14 left-6 right-6 lg:left-10 lg:right-10 z-10 flex flex-col justify-end max-w-2xl">
        {/* 真实元数据徽章行 */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span
            className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold tracking-wide border ${
              isResume
                ? 'bg-[#38BDF8]/20 border-[#38BDF8]/40 text-[#38BDF8]'
                : 'bg-white/12 border-white/15 text-slate-100'
            }`}
          >
            {isResume ? '继续观看' : '精选推荐'}
          </span>

          {rating && (
            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/30 text-amber-300 text-[11px] font-semibold flex items-center space-x-1 tabular-nums">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>{rating}</span>
            </span>
          )}

          {year && (
            <span className="px-2 py-0.5 rounded-md bg-white/[0.08] text-slate-200 text-[11px] font-medium font-mono">
              {year}
            </span>
          )}

          {episodeBadge && (
            <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/30 text-sky-300 text-[11px] font-semibold flex items-center space-x-1">
              <Tv className="w-3 h-3 text-sky-400" />
              <span>{episodeBadge}</span>
            </span>
          )}

          {qualityBadges.map((q) => (
            <span
              key={q}
              className="px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/10 text-slate-200 text-[11px] font-medium font-mono uppercase"
            >
              {q}
            </span>
          ))}
        </div>

        {/* 片名透明 Logo（优先）或高对比度大字排印 */}
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
            className="max-h-20 sm:max-h-24 max-w-[320px] sm:max-w-[400px] w-auto object-contain object-left drop-shadow-2xl mb-1"
          />
        ) : (
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight drop-shadow-xl line-clamp-1">
            {displayTitle}
          </h2>
        )}

        {/* 单集副标题（若为 Episode） */}
        {episodeSubLabel && (
          <p className="text-xs sm:text-sm font-semibold text-[#38BDF8] mt-1.5 drop-shadow">
            {episodeSubLabel}
          </p>
        )}

        {/* 简介 */}
        {currentItem.Overview && (
          <p className="line-clamp-2 max-w-xl text-xs sm:text-sm text-slate-200/85 leading-relaxed mt-2.5 drop-shadow">
            {currentItem.Overview}
          </p>
        )}

        {/* 续播进度条 */}
        {isResume && (
          <div className="mt-3.5 flex items-center space-x-3 max-w-xs">
            <div className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-[#38BDF8] rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-slate-300 tabular-nums flex-shrink-0">
              {remainingMinutes > 0 ? `剩余 ${remainingMinutes} 分钟` : `${progressPercent}%`}
            </span>
          </div>
        )}

        {/* 主行动按钮组（Apple TV+ 风格高对比白胶囊 + 玻璃次按钮） */}
        <div className="flex items-center space-x-3 mt-5">
          <button
            type="button"
            onClick={() => onPlay(currentItem)}
            disabled={startingPlay}
            className="px-7 py-2.5 rounded-full bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs sm:text-sm shadow-xl transition flex items-center space-x-2 cursor-pointer disabled:opacity-60"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {startingPlay ? '准备播放...' : isResume ? '继续播放' : '立即播放'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onDetail(currentItem)}
            className="px-6 py-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white font-medium text-xs sm:text-sm backdrop-blur-xl border border-white/15 transition flex items-center space-x-1.5 cursor-pointer"
          >
            <Info className="w-4 h-4" />
            <span>查看详情</span>
          </button>
        </div>
      </div>

      {/* 右下角轮播指示胶囊 */}
      {items.length > 1 && (
        <div className="absolute bottom-14 right-6 lg:right-10 z-20 flex items-center space-x-1.5">
          {items.map((item, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={item.Id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                aria-label={`切换到第 ${idx + 1} 部推荐`}
                className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                  active ? 'w-7 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'
                }`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};

export default HeroCarousel;
