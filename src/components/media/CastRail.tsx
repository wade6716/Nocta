import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  EmbyPerson,
  resolvePersonImageUrl,
  stripImageFormatWebp,
} from '../../api/embyClient';

interface CastRailProps {
  people: EmbyPerson[];
  serverUrl: string;
  onSelectPerson?: (person: EmbyPerson) => void;
}

const ROLE_PRIORITY: Record<string, number> = {
  Director: 0,
  Actor: 1,
  Writer: 2,
  Producer: 3,
  GuestStar: 4,
};

function formatPersonRole(person: EmbyPerson): string {
  const role = person.Role?.trim();
  const type = (person.Type || '').trim();
  if (type === 'Director') return '导演';
  if (type === 'Writer') return '编剧';
  if (type === 'Producer') return '制片';
  if (role) return `饰 ${role}`;
  if (type === 'Actor' || type === 'GuestStar') return '演员';
  return type || '主创';
}

const CastAvatarCard: React.FC<{
  person: EmbyPerson;
  serverUrl: string;
  onSelect?: (person: EmbyPerson) => void;
}> = ({ person, serverUrl, onSelect }) => {
  const [imgFailed, setImgFailed] = useState(false);

  const avatarUrl = useMemo(
    () => resolvePersonImageUrl(serverUrl, person, { maxWidth: 240, quality: 85 }),
    [serverUrl, person]
  );

  useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const initialChar = (person.Name || '?').trim().slice(0, 1).toUpperCase();
  const roleLabel = formatPersonRole(person);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(person)}
      title={`搜索「${person.Name}」的更多作品`}
      className="group/cast flex-shrink-0 w-[104px] sm:w-[112px] flex flex-col items-center text-center cursor-pointer focus:outline-none"
    >
      <div className="relative w-[88px] h-[88px] sm:w-[96px] sm:h-[96px] rounded-full overflow-hidden bg-[#EEEEF0] dark:bg-[#1C1C1E] ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.1] shadow-[0_4px_14px_rgba(0,0,0,0.08)] group-hover/cast:shadow-[0_8px_22px_rgba(0,0,0,0.16)] dark:shadow-[0_6px_18px_rgba(0,0,0,0.45)] transition-all duration-300 group-hover/cast:scale-[1.04]">
        {avatarUrl && !imgFailed ? (
          <img
            key={avatarUrl}
            src={avatarUrl}
            alt={person.Name}
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.dataset.fallbackStep !== 'done') {
                const noWebp = stripImageFormatWebp(target.src);
                if (noWebp) {
                  target.dataset.fallbackStep = 'done';
                  target.src = noWebp;
                  return;
                }
              }
              setImgFailed(true);
            }}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl font-semibold text-[#86868B] dark:text-white/45 select-none">
            {initialChar}
          </div>
        )}
      </div>

      <span className="mt-2.5 w-full text-[13px] font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate leading-snug">
        {person.Name}
      </span>
      <span className="mt-0.5 w-full text-[11.5px] text-[#86868B] dark:text-white/55 truncate">
        {roleLabel}
      </span>
    </button>
  );
};

export const CastRail: React.FC<CastRailProps> = ({ people, serverUrl, onSelectPerson }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const displayPeople = useMemo(() => {
    const seen = new Set<string>();
    const deduped: EmbyPerson[] = [];
    for (const p of people) {
      if (!p?.Name) continue;
      const key = p.Id || `${p.Name}-${p.Type || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
    }
    return deduped
      .sort((a, b) => {
        const pa = ROLE_PRIORITY[a.Type || ''] ?? 5;
        const pb = ROLE_PRIORITY[b.Type || ''] ?? 5;
        return pa - pb;
      })
      .slice(0, 20);
  }, [people]);

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
  }, [updateScrollButtons, displayPeople]);

  if (displayPeople.length === 0) return null;

  const scrollByPage = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = Math.max(280, el.clientWidth * 0.78);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  return (
    <section className="space-y-4 group/cast-rail">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.015em] text-[#1D1D1F] dark:text-[#F5F5F7]">
          演职员
        </h2>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateScrollButtons}
          className="flex items-start overflow-x-auto scroll-smooth gap-5 sm:gap-6 pb-2 no-scrollbar"
        >
          {displayPeople.map((person, idx) => (
            <CastAvatarCard
              key={person.Id || `${person.Name}-${idx}`}
              person={person}
              serverUrl={serverUrl}
              onSelect={onSelectPerson}
            />
          ))}
        </div>

        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByPage('left')}
            className="absolute left-1 top-[44px] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/92 dark:bg-[#1C1C1E]/92 text-[#1D1D1F] dark:text-white border border-black/[0.06] dark:border-white/[0.12] backdrop-blur-xl shadow-lg flex items-center justify-center opacity-0 group-hover/cast-rail:opacity-100 hover:scale-105 transition-all cursor-pointer"
            title="向左滚动"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByPage('right')}
            className="absolute right-1 top-[44px] -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/92 dark:bg-[#1C1C1E]/92 text-[#1D1D1F] dark:text-white border border-black/[0.06] dark:border-white/[0.12] backdrop-blur-xl shadow-lg flex items-center justify-center opacity-0 group-hover/cast-rail:opacity-100 hover:scale-105 transition-all cursor-pointer"
            title="向右滚动"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </section>
  );
};

export default CastRail;
