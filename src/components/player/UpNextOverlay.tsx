import React from 'react';
import { FastForward, Play, X, SkipForward } from 'lucide-react';
import { EmbyItem, buildItemImageUrl } from '../../api/embyClient';

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
      ? buildItemImageUrl(
          serverUrl,
          nextEpisode.Id,
          nextEpisode.ImageTags?.Primary || nextEpisode.ParentThumbImageTag,
          { type: 'Primary', maxWidth: 320, quality: 80 }
        )
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
            className="flex items-center space-x-2 px-4 py-2 rounded-full bg-[#0B0E17]/88 hover:bg-primary text-white border border-white/20 hover:border-primary shadow-2xl backdrop-blur-2xl text-xs font-semibold transition cursor-pointer group"
          >
            <FastForward className="w-3.5 h-3.5 text-sky-400 group-hover:text-white transition" />
            <span>跳过片头</span>
            <kbd className="px-1.5 py-0.2 rounded bg-white/10 text-[10px] font-mono text-slate-300 group-hover:text-white">
              L
            </kbd>
          </button>
        </div>
      )}

      {/* 右下角：下一集自动连播倒计时浮窗 */}
      {nextEpisode && countdownSeconds !== null && (
        <div className="fixed bottom-32 right-6 z-30 w-80 pointer-events-auto select-none animate-in fade-in slide-in-from-right-4 duration-200">
          <div className="rounded-2xl bg-[#0B0E17]/92 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-3.5 flex items-center space-x-3">
              <div className="w-24 aspect-video rounded-xl overflow-hidden bg-white/5 shrink-0 relative border border-white/10">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={nextEpisode.Name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-500">
                    <SkipForward className="w-5 h-5" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-sky-400 font-mono tabular-nums">
                    {countdownSeconds > 0
                      ? `${countdownSeconds} 秒后自动连播`
                      : '正在切换下一集...'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelAutoNext();
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                    title="取消本次自动连播"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="text-xs font-bold text-white truncate mt-1">
                  第 {nextEpisode.IndexNumber ?? '?'} 集 · {nextEpisode.Name}
                </div>

                <div className="mt-2.5 flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayNextNow();
                    }}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center space-x-1 transition cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>立即播放</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelAutoNext();
                    }}
                    className="py-1.5 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-300 text-xs transition cursor-pointer"
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
