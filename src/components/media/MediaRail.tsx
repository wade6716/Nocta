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
      {/* 分区头部（Apple TV 风格：标题本身可点击，后缀轻盈右箭头） */}
      <div className="flex items-center justify-between">
        {onActionClick ? (
          <button
            type="button"
            onClick={onActionClick}
            title={actionLabel || '查看全部'}
            className="group/title inline-flex items-center space-x-1.5 text-left cursor-pointer min-w-0"
          >
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.015em] text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
              {title}
            </h2>
            <ChevronRight className="w-4 h-4 text-[#86868B] dark:text-white/50 group-hover/title:text-[#1D1D1F] dark:group-hover/title:text-white group-hover/title:translate-x-0.5 transition-all flex-shrink-0" />
            {badge}
          </button>
        ) : (
          <div className="flex items-center space-x-2 min-w-0">
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.015em] text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
              {title}
            </h2>
            {badge}
          </div>
        )}
      </div>

      {/* 横向滚动轨道 */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateScrollButtons}
          className="flex items-stretch overflow-x-auto scroll-smooth gap-4 lg:gap-5 pb-3 no-scrollbar"
        >
          {children}
        </div>

        {/* 左侧悬浮翻页按钮 */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByPage('left')}
            className="absolute left-2.5 top-[42%] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/92 dark:bg-[#1C1C1E]/92 text-[#1D1D1F] dark:text-white border border-black/[0.06] dark:border-white/[0.12] backdrop-blur-xl shadow-lg flex items-center justify-center opacity-0 group-hover/rail:opacity-100 hover:scale-105 transition-all cursor-pointer"
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
            className="absolute right-2.5 top-[42%] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/92 dark:bg-[#1C1C1E]/92 text-[#1D1D1F] dark:text-white border border-black/[0.06] dark:border-white/[0.12] backdrop-blur-xl shadow-lg flex items-center justify-center opacity-0 group-hover/rail:opacity-100 hover:scale-105 transition-all cursor-pointer"
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
