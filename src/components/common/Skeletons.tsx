import React from 'react';
import { ArrowLeft } from 'lucide-react';

export const EpisodeGridSkeleton: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="w-full space-y-5 animate-pulse select-none">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 rounded-full bg-black/[0.07] dark:bg-white/[0.08]" />
        <div className="h-8 w-20 rounded-full bg-black/[0.05] dark:bg-white/[0.05]" />
      </div>
      <div className="h-7 w-28 rounded-full bg-black/[0.05] dark:bg-white/[0.05]" />
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="space-y-2.5">
          <div className="aspect-video w-full rounded-xl bg-black/[0.07] dark:bg-white/[0.06]" />
          <div className="h-4 w-3/4 rounded bg-black/[0.07] dark:bg-white/[0.06]" />
          <div className="h-3 w-1/2 rounded bg-black/[0.05] dark:bg-white/[0.04]" />
        </div>
      ))}
    </div>
  </div>
);

export const DetailPageSkeleton: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <div className="w-full min-h-full flex flex-col select-none">
    {/* 保持与真实 DetailPage 一致的深色全出血 Hero 区，保证亮色模式下 TitleBar 白色按钮高对比可见 */}
    <section className="preserve-dark relative z-10 w-full overflow-hidden bg-[#121215] min-h-[460px] md:min-h-[500px] flex flex-col">
      <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#121215]/70 to-black/40 pointer-events-none" />
      <div className="relative z-10 w-full max-w-[1440px] mx-auto px-8 lg:px-12 pt-16 pb-9 flex-1 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-4 mb-6">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="px-3.5 py-1.5 rounded-full bg-black/30 hover:bg-white/15 backdrop-blur-xl border border-white/[0.15] text-white/90 hover:text-white transition cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium group"
              title="返回上一页"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
              <span>返回</span>
            </button>
          ) : (
            <div className="h-7 w-16 rounded-full bg-white/10 animate-pulse" />
          )}
          <div className="h-6 w-24 rounded-full bg-white/10 animate-pulse" />
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-end gap-7 animate-pulse">
          <div className="w-40 sm:w-44 lg:w-48 aspect-[2/3] rounded-[14px] bg-white/[0.09] ring-1 ring-inset ring-white/10 shrink-0" />
          <div className="flex-1 min-w-0 w-full space-y-3.5">
            <div className="h-9 w-72 max-w-[80%] rounded-lg bg-white/[0.12]" />
            <div className="h-4 w-52 rounded bg-white/[0.08]" />
            <div className="flex flex-wrap gap-2 pt-0.5">
              <div className="h-6 w-16 rounded-md bg-white/[0.08]" />
              <div className="h-6 w-24 rounded-md bg-white/[0.08]" />
              <div className="h-6 w-20 rounded-md bg-white/[0.08]" />
            </div>
            <div className="space-y-2 max-w-2xl pt-1">
              <div className="h-3.5 w-full rounded bg-white/[0.07]" />
              <div className="h-3.5 w-5/6 rounded bg-white/[0.06]" />
            </div>
            <div className="pt-2 flex items-center gap-3">
              <div className="h-10 w-36 rounded-full bg-white/20" />
              <div className="h-9 w-28 rounded-full bg-white/10" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <div className="w-full max-w-[1440px] mx-auto px-8 lg:px-12 mt-8 pb-16 space-y-10">
      <EpisodeGridSkeleton count={4} />
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-24 rounded bg-black/[0.08] dark:bg-white/[0.07]" />
        <div className="flex gap-5 overflow-hidden">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div key={idx} className="w-24 flex-shrink-0 flex flex-col items-center gap-2">
              <div className="w-20 h-20 rounded-full bg-black/[0.07] dark:bg-white/[0.06]" />
              <div className="h-3 w-16 rounded bg-black/[0.06] dark:bg-white/[0.05]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export const PosterGridSkeleton: React.FC<{
  count?: number;
  variant?: 'poster' | 'square' | 'circle';
}> = ({ count = 18, variant = 'poster' }) => {
  const gridClass =
    variant === 'circle'
      ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-5'
      : variant === 'square'
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5';

  const cardShapeClass =
    variant === 'circle'
      ? 'aspect-square rounded-full'
      : variant === 'square'
      ? 'aspect-square rounded-2xl'
      : 'aspect-[2/3] rounded-xl';

  return (
    <div className={`grid ${gridClass} animate-pulse select-none`}>
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="space-y-2.5">
          <div className={`${cardShapeClass} bg-black/[0.07] dark:bg-white/[0.06]`} />
          <div
            className={`h-4 rounded bg-black/[0.07] dark:bg-white/[0.06] ${
              variant === 'circle' ? 'w-2/3 mx-auto' : 'w-4/5'
            }`}
          />
          {variant !== 'circle' && (
            <div className="h-3 w-1/2 rounded bg-black/[0.05] dark:bg-white/[0.04]" />
          )}
        </div>
      ))}
    </div>
  );
};

export const ContinueWatchingSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="space-y-3 animate-pulse select-none">
    {Array.from({ length: count }).map((_, idx) => (
      <div
        key={idx}
        className="rounded-2xl border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] p-3 flex flex-col sm:flex-row sm:items-center gap-4"
      >
        <div className="w-full sm:w-44 aspect-video rounded-xl bg-black/[0.07] dark:bg-white/[0.06] shrink-0" />
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="h-4 w-48 max-w-[75%] rounded bg-black/[0.08] dark:bg-white/[0.07]" />
          <div className="h-3 w-64 max-w-[90%] rounded bg-black/[0.05] dark:bg-white/[0.05]" />
          <div className="h-1.5 w-full max-w-md rounded-full bg-black/[0.06] dark:bg-white/[0.06]" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-20 rounded-xl bg-black/[0.07] dark:bg-white/[0.07]" />
          <div className="h-8 w-8 rounded-xl bg-black/[0.05] dark:bg-white/[0.05]" />
        </div>
      </div>
    ))}
  </div>
);

export const MusicTrackTableSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="space-y-1.5 animate-pulse select-none">
    {Array.from({ length: rows }).map((_, idx) => (
      <div
        key={idx}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02]"
      >
        <div className="w-5 h-3.5 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
        <div className="w-10 h-10 rounded-lg bg-black/[0.07] dark:bg-white/[0.06] shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-3.5 w-44 max-w-[70%] rounded bg-black/[0.07] dark:bg-white/[0.06]" />
          <div className="h-3 w-28 rounded bg-black/[0.05] dark:bg-white/[0.04]" />
        </div>
        <div className="hidden md:block w-36 h-3 rounded bg-black/[0.05] dark:bg-white/[0.04]" />
        <div className="w-12 h-3 rounded bg-black/[0.05] dark:bg-white/[0.04]" />
      </div>
    ))}
  </div>
);

export const MusicHomeSkeleton: React.FC = () => (
  <div className="space-y-10 animate-pulse select-none">
    <div className="h-64 sm:h-72 rounded-3xl bg-black/[0.07] dark:bg-white/[0.05] p-7 sm:p-9 flex items-center gap-7">
      <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-black/[0.08] dark:bg-white/[0.08] shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="h-5 w-24 rounded-full bg-black/[0.07] dark:bg-white/[0.08]" />
        <div className="h-8 w-64 max-w-[80%] rounded-lg bg-black/[0.08] dark:bg-white/[0.08]" />
        <div className="h-4 w-40 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
        <div className="flex gap-3 pt-2">
          <div className="h-9 w-28 rounded-full bg-black/10 dark:bg-white/10" />
          <div className="h-9 w-28 rounded-full bg-black/[0.06] dark:bg-white/[0.06]" />
        </div>
      </div>
    </div>

    <div className="space-y-4">
      <div className="h-5 w-28 rounded bg-black/[0.07] dark:bg-white/[0.07]" />
      <PosterGridSkeleton count={6} variant="square" />
    </div>

    <div className="space-y-4">
      <div className="h-5 w-24 rounded bg-black/[0.07] dark:bg-white/[0.07]" />
      <PosterGridSkeleton count={7} variant="circle" />
    </div>
  </div>
);

export const MusicDetailSkeleton: React.FC<{
  variant: 'album' | 'artist' | 'playlist';
  onBack?: () => void;
}> = ({ variant, onBack }) => (
  <div className="w-full pb-20 px-8 pt-6 select-none">
    <div className="max-w-6xl mx-auto space-y-8">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="p-2.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06] hover:bg-black/[0.1] dark:hover:bg-white/[0.12] border border-black/[0.08] dark:border-white/[0.08] text-[#1D1D1F] dark:text-slate-200 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回</span>
        </button>
      ) : (
        <div className="h-9 w-20 rounded-full bg-black/[0.06] dark:bg-white/[0.06] animate-pulse" />
      )}

      <div className="flex flex-col md:flex-row items-start md:items-end gap-8 animate-pulse">
        <div
          className={`flex-shrink-0 bg-black/[0.08] dark:bg-white/[0.07] ${
            variant === 'artist'
              ? 'w-44 h-44 rounded-full'
              : 'w-52 h-52 sm:w-60 sm:h-60 rounded-3xl'
          }`}
        />
        <div className="flex-1 min-w-0 w-full space-y-3">
          <div className="h-5 w-16 rounded-full bg-black/[0.07] dark:bg-white/[0.08]" />
          <div className="h-9 w-72 max-w-[85%] rounded-lg bg-black/[0.08] dark:bg-white/[0.08]" />
          <div className="h-4 w-48 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
          <div className="pt-2 flex gap-3">
            <div className="h-10 w-28 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="h-10 w-28 rounded-full bg-black/[0.06] dark:bg-white/[0.06]" />
          </div>
        </div>
      </div>

      <MusicTrackTableSkeleton rows={8} />

      {variant === 'artist' && (
        <div className="space-y-4">
          <div className="h-5 w-28 rounded bg-black/[0.07] dark:bg-white/[0.07]" />
          <PosterGridSkeleton count={6} variant="square" />
        </div>
      )}
    </div>
  </div>
);
