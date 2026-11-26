import React from 'react';
import { Loader2 } from 'lucide-react';
import { formatNetworkSpeed } from './PlayerOsd';

interface BufferingIndicatorProps {
  visible: boolean;
  networkSpeed: number;
  hint?: string;
}

/**
 * 卡顿/缓冲时的轻量网速指示胶囊：无全屏背景遮罩，pointer-events-none 穿透交互，仅展示加载旋转、状态提示与实时网速。
 */
export const BufferingIndicator: React.FC<BufferingIndicatorProps> = ({
  visible,
  networkSpeed,
  hint,
}) => {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-30 pointer-events-none select-none flex items-center justify-center">
      <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#0B0E17]/85 border border-white/15">
        <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
        {hint && (
          <span className="text-xs font-medium text-slate-200 tracking-wide">
            {hint}
          </span>
        )}
        {(!hint || networkSpeed > 0) && (
          <span className="text-xs font-mono font-semibold tabular-nums text-white tracking-wide">
            {formatNetworkSpeed(networkSpeed)}
          </span>
        )}
      </div>
    </div>
  );
};

export default BufferingIndicator;
