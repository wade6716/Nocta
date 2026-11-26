import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MediaRailProps {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actionLabel?: string;
  onActionClick?: () => void;
  children: React.ReactNode;
}

export const MediaRail: React.FC<MediaRailProps> = ({
  title,
  icon,
  badge,
  actionLabel,
  onActionClick,
  children,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateScrollButtons());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollButtons, children]);

  const scrollByPage = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = Math.max(320, el.clientWidth * 0.82);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  return (
    <section className="space-y-3.5 group/rail">
      {/* 分区头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <h2 className="text-lg font-bold tracking-tight text-slate-100 truncate">
            {title}
          </h2>
          {badge}
        </div>

        {actionLabel && onActionClick && (
          <button
            type="button"
            onClick={onActionClick}
            className="inline-flex items-center space-x-1 text-xs font-medium text-slate-400 hover:text-[#38BDF8] transition cursor-pointer flex-shrink-0"
          >
            <span>{actionLabel}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 横向滚动轨道 */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateScrollButtons}
          className="flex items-stretch overflow-x-auto scroll-smooth gap-4 lg:gap-5 pb-1 no-scrollbar"
        >
          {children}
        </div>

        {/* 左侧悬浮翻页按钮 */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByPage('left')}
            className="absolute left-2 top-[40%] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-[#0B0E17]/85 hover:bg-[#0B0E17] text-white border border-white/15 backdrop-blur-xl shadow-lg flex items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity cursor-pointer"
            title="向左滚动"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* 右侧悬浮翻页按钮 */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByPage('right')}
            className="absolute right-2 top-[40%] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-[#0B0E17]/85 hover:bg-[#0B0E17] text-white border border-white/15 backdrop-blur-xl shadow-lg flex items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity cursor-pointer"
            title="向右滚动"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </section>
  );
};

export default MediaRail;
