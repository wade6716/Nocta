import React from 'react';
import { Loader2 } from 'lucide-react';
import { formatNetworkSpeed } from './PlayerOsd';

interface BufferingIndicatorProps {
  visible: boolean;
  networkSpeed: number;
  isSeeking?: boolean;
}

/**
 * 卡顿/缓冲时的轻量网速指示胶囊：无全屏背景遮罩，pointer-events-none 穿透交互，仅展示加载旋转与实时网速。
 */
export const BufferingIndicator: React.FC<BufferingIndicatorProps> = ({
  visible,
  networkSpeed,
  isSeeking = false,
}) => {
  if (!visible) return null;

  const statusText =
    (!networkSpeed || networkSpeed <= 0) && isSeeking
      ? '定位中'
      : formatNetworkSpeed(networkSpeed);

  return (
    <div className="fixed inset-0 z-30 pointer-events-none select-none flex items-center justify-center">
      <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/[0.94] dark:bg-[#141416]/[0.92] border border-black/[0.12] dark:border-white/[0.12]">
        <Loader2 className="w-3.5 h-3.5 text-[#1D1D1F] dark:text-white animate-spin shrink-0" />
        <span className="text-xs font-mono font-semibold tabular-nums text-[#1D1D1F] dark:text-white tracking-wide">
          {statusText}
        </span>
      </div>
    </div>
  );
};

export default BufferingIndicator;
