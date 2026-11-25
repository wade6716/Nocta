import React from 'react';
import { X, Trash2, Music } from 'lucide-react';
import { useMusicPlayerStore } from '../../stores/useMusicPlayerStore';
import {
  formatMusicDuration,
  formatTrackArtists,
  getTrackDurationSeconds,
  resolveMusicCoverUrl,
} from '../../api/embyMusicClient';
import { MusicEqualizerBars } from './MusicEqualizerBars';

export const MusicQueueDrawer: React.FC = () => {
  const isQueueOpen = useMusicPlayerStore((s) => s.isQueueOpen);
  const queue = useMusicPlayerStore((s) => s.queue);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const sourceServer = useMusicPlayerStore((s) => s.sourceServer);
  const setQueueOpen = useMusicPlayerStore((s) => s.setQueueOpen);
  const playTracks = useMusicPlayerStore((s) => s.playTracks);
  const removeFromQueue = useMusicPlayerStore((s) => s.removeFromQueue);
  const clearQueue = useMusicPlayerStore((s) => s.clearQueue);

  if (!isQueueOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end select-none">
      <div
        className="flex-1 bg-black/45 backdrop-blur-xs"
        onClick={() => setQueueOpen(false)}
      />

      <aside className="w-96 max-w-[90vw] h-full bg-[#0F1422]/95 backdrop-blur-2xl border-l border-white/[0.1] flex flex-col shadow-2xl">
        <div className="h-14 px-5 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">播放队列</h3>
            <p className="text-[11px] text-slate-400">共 {queue.length} 首曲目</p>
          </div>
          <div className="flex items-center gap-1">
            {queue.length > 0 && (
              <button
                type="button"
                onClick={clearQueue}
                className="p-2 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-rose-400 transition cursor-pointer"
                title="清空队列"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setQueueOpen(false)}
              className="p-2 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {queue.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
              <Music className="w-8 h-8 opacity-40" />
              <span>播放队列空空如也</span>
            </div>
          ) : (
            queue.map((track, idx) => {
              const isCurrent = idx === currentIndex;
              const coverUrl = sourceServer
                ? resolveMusicCoverUrl(sourceServer.url, track, { maxWidth: 100, quality: 80 })
                : '';

              return (
                <div
                  key={`${track.Id}-${idx}`}
                  onClick={() => sourceServer && playTracks(queue, idx, sourceServer)}
                  className={`group flex items-center gap-3 p-2 rounded-xl cursor-pointer transition border ${
                    isCurrent
                      ? 'bg-purple-500/15 border-purple-400/30'
                      : 'border-transparent hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#161D2F] border border-white/[0.08] flex-shrink-0 flex items-center justify-center relative">
                    {coverUrl ? (
                      <img src={coverUrl} alt={track.Name} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-4 h-4 text-slate-500" />
                    )}
                    {isCurrent && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <MusicEqualizerBars playing={isPlaying} />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-xs font-semibold truncate ${
                        isCurrent ? 'text-purple-300' : 'text-slate-100'
                      }`}
                    >
                      {track.Name}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {formatTrackArtists(track)}
                    </div>
                  </div>

                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {formatMusicDuration(getTrackDurationSeconds(track))}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromQueue(idx);
                    }}
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/[0.1] text-slate-400 hover:text-rose-400 transition cursor-pointer"
                    title="从队列移除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};

export default MusicQueueDrawer;
