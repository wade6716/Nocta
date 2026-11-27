import React from 'react';
import { FastForward, Play, X, SkipForward } from 'lucide-react';
import {
  EmbyItem,
  resolveEpisodeThumbnailUrl,
  stripImageFormatWebp,
} from '../../api/embyClient';

interface UpNextOverlayProps {
  showSkipIntro: boolean;
  onSkipIntro: () => void;
  nextEpisode: EmbyItem | null;
  serverUrl?: string;
  countdownSeconds: number | null;
  onPlayNextNow: () => void;
  onCancelAutoNext: () => void;
}

export const UpNextOverlay: React.FC<UpNextOverlayProps> = ({
  showSkipIntro,
  onSkipIntro,
  nextEpisode,
  serverUrl,
  countdownSeconds,
  onPlayNextNow,
  onCancelAutoNext,
}) => {
  const thumbUrl =
    nextEpisode && serverUrl
      ? resolveEpisodeThumbnailUrl(serverUrl, nextEpisode, {
          maxWidth: 320,
          quality: 80,
        })
      : '';

  return (
    <>
      {/* 左下角：Emby 片头胶囊 */}
      {showSkipIntro && (
        <div className="fixed bottom-32 left-6 z-30 pointer-events-auto select-none animate-in fade-in slide-in-from-left-3 duration-200">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSkipIntro();
            }}
            className="flex items-center space-x-2 px-4 py-2 rounded-full bg-white/[0.95] hover:bg-[#1D1D1F] text-[#1D1D1F] hover:text-white border border-black/[0.12] hover:border-[#1D1D1F] dark:bg-[#141416]/[0.94] dark:hover:bg-white dark:text-white dark:hover:text-[#1D1D1F] dark:border-white/[0.14] dark:hover:border-white text-xs font-semibold transition cursor-pointer group"
          >
            <FastForward className="w-3.5 h-3.5 text-[#1D1D1F] group-hover:text-white dark:text-white dark:group-hover:text-[#1D1D1F] transition" />
            <span>跳过片头</span>
            <kbd className="px-1.5 py-0.2 rounded bg-black/[0.06] group-hover:bg-white/20 text-[10px] font-mono text-[#48484A] group-hover:text-white dark:bg-white/10 dark:group-hover:bg-black/15 dark:text-white/80 dark:group-hover:text-[#1D1D1F]">
              L
            </kbd>
          </button>
        </div>
      )}

      {/* 右下角：下一集自动连播倒计时浮窗 */}
      {nextEpisode && countdownSeconds !== null && (
        <div className="fixed bottom-32 right-6 z-30 w-80 pointer-events-auto select-none animate-in fade-in slide-in-from-right-4 duration-200">
          <div className="rounded-2xl bg-white/[0.95] dark:bg-[#141416]/[0.94] border border-black/[0.12] dark:border-white/[0.14] overflow-hidden">
            <div className="p-3.5 flex items-center space-x-3">
              <div className="preserve-dark w-24 aspect-video rounded-xl overflow-hidden bg-black/15 dark:bg-white/5 shrink-0 relative border border-black/10 dark:border-white/10">
                {thumbUrl ? (
                  <img
                    key={thumbUrl}
                    src={thumbUrl}
                    alt={nextEpisode.Name}
                    className="w-full h-full object-cover"
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
                      target.dataset.fallbackStep = 'done';
                      target.src =
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="%231C1C1E"/><text x="50%" y="50%" fill="%238E8E93" font-family="sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle">暂无剧照</text></svg>';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/40">
                    <SkipForward className="w-5 h-5" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#6E6E73] dark:text-white/70 font-mono tabular-nums">
                    {countdownSeconds > 0
                      ? `${countdownSeconds} 秒后自动连播`
                      : '正在切换下一集...'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelAutoNext();
                    }}
                    className="p-1 rounded-lg text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-black/[0.06] dark:text-white/55 dark:hover:text-white dark:hover:bg-white/10 transition cursor-pointer"
                    title="取消本次自动连播"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="text-xs font-bold text-[#1D1D1F] dark:text-white truncate mt-1">
                  第 {nextEpisode.IndexNumber ?? '?'} 集 · {nextEpisode.Name}
                </div>

                <div className="mt-2.5 flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayNextNow();
                    }}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-[#1D1D1F] hover:bg-black text-white dark:bg-white dark:hover:bg-white/90 dark:text-[#1D1D1F] font-bold text-xs flex items-center justify-center space-x-1 transition cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>立即播放</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelAutoNext();
                    }}
                    className="py-1.5 px-2.5 rounded-lg bg-black/[0.06] hover:bg-black/[0.12] text-[#48484A] dark:bg-white/10 dark:hover:bg-white/15 dark:text-white/80 text-xs transition cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UpNextOverlay;
