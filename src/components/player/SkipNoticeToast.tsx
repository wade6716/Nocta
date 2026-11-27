import React from 'react';
import { SkipForward } from 'lucide-react';

interface SkipNoticeToastProps {
  message: string | null;
}

export const SkipNoticeToast: React.FC<SkipNoticeToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.94] dark:bg-[#141416]/[0.92] border border-black/[0.12] dark:border-white/[0.12] text-[#1D1D1F] dark:text-white text-xs font-medium">
        <SkipForward className="w-3.5 h-3.5 text-[#1D1D1F] dark:text-white flex-shrink-0" />
        <span className="tabular-nums">{message}</span>
      </div>
    </div>
  );
};

export default SkipNoticeToast;
