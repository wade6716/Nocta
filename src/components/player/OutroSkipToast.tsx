import React from 'react';
import { SkipForward } from 'lucide-react';

interface OutroSkipToastProps {
  visible: boolean;
  remainingMs: number;
  totalMs?: number;
  defaultAction?: 'ask' | 'auto';
  hasNextEpisode?: boolean;
  onSkip: () => void;
  onCancel: () => void;
}

export const OutroSkipToast: React.FC<OutroSkipToastProps> = ({
  visible,
  remainingMs,
  totalMs = 8000,
  defaultAction = 'ask',
  hasNextEpisode = false,
  onSkip,
  onCancel,
}) => {
  if (!visible) return null;

  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progressPercent =
    totalMs > 0 ? Math.min(100, Math.max(0, (remainingMs / totalMs) * 100)) : 0;

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,460px)] pointer-events-auto animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="relative overflow-hidden rounded-2xl border border-black/[0.12] dark:border-white/[0.14] bg-white/[0.95] dark:bg-[#141416]/[0.94] px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-black/[0.06] dark:bg-white/10 border border-black/[0.08] dark:border-white/15 text-[#1D1D1F] dark:text-white flex items-center justify-center">
            <SkipForward className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1D1D1F] dark:text-white">已到片尾</p>
            <p className="text-xs text-[#6E6E73] dark:text-white/60 mt-0.5">
              {defaultAction === 'auto'
                ? hasNextEpisode
                  ? `${remainingSeconds} 秒后自动跳过片尾进入下一集`
                  : `${remainingSeconds} 秒后自动跳到结尾`
                : `${remainingSeconds} 秒内可选择是否跳过`}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-[#48484A] bg-black/[0.05] border border-black/[0.08] hover:bg-black/[0.10] hover:text-[#1D1D1F] dark:text-white/75 dark:bg-white/[0.06] dark:border-white/10 dark:hover:bg-white/[0.12] dark:hover:text-white transition cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={onSkip}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#1D1D1F] hover:bg-black dark:text-[#1D1D1F] dark:bg-white dark:hover:bg-white/90 transition cursor-pointer"
            >
              跳过片尾
            </button>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/[0.10] dark:bg-white/15">
          <div
            className="h-full bg-[#1D1D1F] dark:bg-white transition-[width] duration-200 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default OutroSkipToast;
