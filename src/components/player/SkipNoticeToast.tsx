import React from 'react';
import { SkipForward } from 'lucide-react';

interface SkipNoticeToastProps {
  message: string | null;
}

export const SkipNoticeToast: React.FC<SkipNoticeToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0B0E17]/95 backdrop-blur-md border border-primary/40 text-white text-xs font-medium">
        <SkipForward className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="tabular-nums">{message}</span>
      </div>
    </div>
  );
};

export default SkipNoticeToast;
