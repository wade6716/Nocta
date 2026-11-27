import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Cpu,
  Subtitles,
  Volume2,
  ArrowDownToLine,
  RotateCcw,
  Camera,
  Repeat,
  FileUp,
  Layers,
  Clock,
} from 'lucide-react';
import {
  HwdecMode,
  NextEpisodePreloadStatus,
  PlayerTelemetry,
  ToneMappingMode,
  VideoAspectPreset,
} from '../../player/types';
import { MappedTrack } from '../../api/embyClient';
import { usePlayerStore } from '../../stores/usePlayerStore';
import {
  BUFFER_DURATION_PRESETS_SEC,
  MEMORY_CAP_PRESETS_MB,
  PRELOAD_TRIGGER_MODE_OPTIONS,
  formatMemoryCapLabel,
  formatMinutesLabel,
  formatPreloadDurationMMSS,
  formatPreloadStateText,
  formatShortMinutesLabel,
} from '../../player/preloadUtils';

interface VideoProPanelProps {
  isOpen: boolean;
  onClose: () => void;
  layoutKey: string;
  seriesName?: string;
  videoAspectRatio?: number;
  isWidescreen: boolean;
  telemetry: PlayerTelemetry;
  subtitleTracks: MappedTrack[];
  selectedSubtitleId: string | null;
  selectedSecondarySubtitleId: string | null;
  onSelectSubtitleTrack: (id: string | null) => void;
  onSelectSecondarySubtitleTrack: (id: string | null) => void;
  abLoopA: number | null;
  abLoopB: number | null;
  onSetAbLoop: (point: 'a' | 'b' | 'clear') => void;
  onTakeScreenshot: () => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  hasNextEpisode?: boolean;
  nextPreloadStatus?: NextEpisodePreloadStatus | null;
}

function formatSec(s: number | null): string {
  if (s === null || Number.isNaN(s)) return '--:--';
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export const VideoProPanel: React.FC<VideoProPanelProps> = ({
  isOpen,
  onClose,
  layoutKey,
  seriesName,
  videoAspectRatio,
  isWidescreen,
  telemetry,
  subtitleTracks,
  selectedSubtitleId,
  selectedSecondarySubtitleId,
  onSelectSubtitleTrack,
  onSelectSecondarySubtitleTrack,
  abLoopA,
  abLoopB,
  onSetAbLoop,
  onTakeScreenshot,
  volume,
  onVolumeChange,
  hasNextEpisode,
  nextPreloadStatus,
}) => {
  const [activeTab, setActiveTab] = useState<'video' | 'subtitle' | 'audio'>('video');

  const engineType = usePlayerStore((s) => s.engineType);
  const setEngineType = usePlayerStore((s) => s.setEngineType);
  const videoLayouts = usePlayerStore((s) => s.videoLayouts);
  const setVideoLayout = usePlayerStore((s) => s.setVideoLayout);
  const playerPreferences = usePlayerStore((s) => s.playerPreferences);
  const updatePlayerPreferences = usePlayerStore((s) => s.updatePlayerPreferences);
  const resetVideoEnhancements = usePlayerStore((s) => s.resetVideoEnhancements);

  if (!isOpen) return null;

  const currentLayout = (layoutKey && videoLayouts[layoutKey]) || {
    bottomAlign: playerPreferences.defaultBottomAlign,
    verticalOffset: 100,
  };
  const isMpv = engineType === 'mpv';

  // 次字幕仅支持内封或数字 ID 轨道
  const internalSubTracks = subtitleTracks.filter((t) => !t.isExternal && typeof t.mpvId === 'number');

  return (
    <>
      <div className="fixed inset-0 z-20 bg-transparent" onClick={onClose} />
      <div className="fixed top-16 bottom-24 right-6 z-30 w-80 md:w-96 rounded-2xl bg-white/[0.96] dark:bg-[#141416]/[0.95] border border-black/[0.12] dark:border-white/[0.12] flex flex-col text-[#1D1D1F] dark:text-white/90 select-none animate-in slide-in-from-right duration-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#B45309] dark:text-amber-400" />
            <h2 className="text-sm font-semibold tracking-wide text-[#1D1D1F] dark:text-white">画质、硬解与音字幕调校</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-black/[0.08] dark:hover:bg-white/10 text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/60 dark:hover:text-white transition cursor-pointer"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3-Tab Switcher */}
        <div className="p-3 border-b border-black/[0.08] dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.01]">
          <div className="flex bg-black/[0.05] dark:bg-white/[0.06] p-1 rounded-xl border border-black/[0.06] dark:border-white/[0.06] text-xs font-medium">
            <button
              onClick={() => setActiveTab('video')}
              className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'video'
                  ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/60 dark:hover:text-white'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>画面硬解</span>
            </button>
            <button
              onClick={() => setActiveTab('subtitle')}
              className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'subtitle'
                  ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/60 dark:hover:text-white'
              }`}
            >
              <Subtitles className="w-3.5 h-3.5" />
              <span>字幕增强</span>
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'audio'
                  ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F] dark:text-white/60 dark:hover:text-white'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>音频工具</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar text-xs">
          {activeTab === 'video' && (
            <>
              {/* 真实硬件解码状态与策略 */}
              <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center space-x-1.5">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>硬件解码状态</span>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold ${
                      telemetry.hwdecCurrent && telemetry.hwdecCurrent !== 'no'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {telemetry.hwdecCurrent && telemetry.hwdecCurrent !== 'no'
                      ? `${telemetry.hwdecCurrent.toUpperCase()} 硬解中`
                      : isMpv
                      ? '软件解码'
                      : '浏览器解码'}
                  </span>
                </div>

                {isMpv && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { mode: 'auto-safe', label: '安全硬解' },
                        { mode: 'auto', label: '强力硬解' },
                        { mode: 'auto-copy', label: '零拷贝备选' },
                        { mode: 'no', label: '纯软解' },
                      ] as { mode: HwdecMode; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.mode}
                        onClick={() => updatePlayerPreferences({ hwdecMode: opt.mode })}
                        className={`py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                          playerPreferences.hwdecMode === opt.mode
                            ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                            : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {telemetry.fps !== undefined && (
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/5 font-mono">
                    <span>实时帧率: {telemetry.fps.toFixed(1)} fps</span>
                    <span>丢帧: {telemetry.droppedFrames ?? 0}</span>
                  </div>
                )}
              </div>

              {/* 画面比例与裁切 */}
              {isMpv && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-gray-300">
                    <span className="font-medium">画面比例与填充</span>
                    <span className="font-mono text-primary font-semibold">
                      {playerPreferences.videoAspect === 'auto'
                        ? '原始比例'
                        : playerPreferences.videoAspect === 'fill'
                        ? '全屏裁切填充'
                        : playerPreferences.videoAspect}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(
                      [
                        { id: 'auto', label: '原比例' },
                        { id: '16:9', label: '16:9' },
                        { id: '21:9', label: '21:9' },
                        { id: '4:3', label: '4:3' },
                        { id: 'fill', label: '铺满' },
                      ] as { id: VideoAspectPreset; label: string }[]
                    ).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => updatePlayerPreferences({ videoAspect: p.id })}
                        className={`py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                          playerPreferences.videoAspect === p.id
                            ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                            : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 宽银幕画面沉浸贴底（从弹幕抽屉迁移至此处，保持每剧/每集独立记忆） */}
              <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ArrowDownToLine className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-white">宽银幕贴底 (顶部留黑)</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentLayout.bottomAlign}
                      onChange={(e) =>
                        layoutKey && setVideoLayout(layoutKey, { bottomAlign: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-black/[0.14] dark:bg-white/15 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1D1D1F] dark:peer-checked:bg-emerald-500" />
                  </label>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-black/[0.06] dark:border-white/5">
                  <span className="text-gray-400">画幅检测:</span>
                  {videoAspectRatio ? (
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-medium ${
                        isWidescreen
                          ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                          : 'bg-white/10 text-gray-300'
                      }`}
                    >
                      {videoAspectRatio.toFixed(2)}:1 {isWidescreen ? '· 宽银幕推荐' : '· 标准'}
                    </span>
                  ) : (
                    <span className="text-gray-500 font-mono">检测中...</span>
                  )}
                </div>

                {currentLayout.bottomAlign && layoutKey && (
                  <div className="space-y-2.5 pt-2 border-t border-white/10">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-gray-300">垂直对齐锚点</span>
                      <span className="font-mono text-primary font-bold">
                        {currentLayout.verticalOffset}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="1"
                      value={currentLayout.verticalOffset}
                      onChange={(e) =>
                        setVideoLayout(layoutKey, {
                          verticalOffset: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { val: 100, label: '完全贴底' },
                        { val: 95, label: '微浮避让' },
                        { val: 50, label: '居中' },
                      ].map((item) => (
                        <button
                          key={item.val}
                          onClick={() => setVideoLayout(layoutKey, { verticalOffset: item.val })}
                          className={`py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                            currentLayout.verticalOffset === item.val
                              ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                              : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {seriesName ? `已记住为《${seriesName}》全剧设置` : '已保存为本视频设置'}
                    </div>
                  </div>
                )}
              </div>

              {/* HDR 色调映射 & 去色带 & 色彩调校 */}
              {isMpv && (
                <div className="space-y-4 pt-2 border-t border-white/10">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-gray-300">
                      <span className="font-medium">HDR 色调映射 (SDR 屏幕观感优化)</span>
                      <span className="font-mono text-primary text-[11px]">
                        {playerPreferences.toneMapping}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {(
                        [
                          { id: 'auto', label: '自动' },
                          { id: 'bt.2446a', label: '2446a' },
                          { id: 'spline', label: 'Spline' },
                          { id: 'hable', label: 'Hable' },
                          { id: 'clip', label: '直出' },
                        ] as { id: ToneMappingMode; label: string }[]
                      ).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => updatePlayerPreferences({ toneMapping: t.id })}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                            playerPreferences.toneMapping === t.id
                              ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                              : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 去色带开关 */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/10">
                    <div>
                      <div className="font-medium text-white">动画去色带 (Deband)</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        平滑暗部色彩断层，观看动漫暗场更纯净
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={playerPreferences.deband}
                        onChange={(e) => updatePlayerPreferences({ deband: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-black/[0.14] dark:bg-white/15 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1D1D1F] dark:peer-checked:bg-emerald-500" />
                    </label>
                  </div>

                  {/* 色彩微调 */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-300">实时画面色彩微调</span>
                      <button
                        onClick={resetVideoEnhancements}
                        className="text-[11px] text-sky-400 hover:underline flex items-center space-x-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重置全部画质</span>
                      </button>
                    </div>
                    {(
                      [
                        { key: 'brightness', label: '亮度' },
                        { key: 'contrast', label: '对比度' },
                        { key: 'saturation', label: '饱和度' },
                        { key: 'gamma', label: '伽马' },
                      ] as const
                    ).map((item) => (
                      <div key={item.key} className="space-y-1">
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>{item.label}</span>
                          <span className="font-mono text-white">
                            {playerPreferences.colorAdjust[item.key]}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="-30"
                          max="30"
                          step="1"
                          value={playerPreferences.colorAdjust[item.key]}
                          onChange={(e) =>
                            updatePlayerPreferences({
                              colorAdjust: {
                                ...playerPreferences.colorAdjust,
                                [item.key]: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 内存缓冲与下一集智能预加载 */}
              <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span>内存缓冲与预加载</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-mono">
                    上限 {formatMemoryCapLabel(playerPreferences.cacheMemoryCapMB)}
                  </span>
                </div>

                {/* 当前播放缓冲时长 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-gray-300">
                    <span>当前播放缓冲时长</span>
                    <span className="font-mono text-primary font-semibold">
                      {formatMinutesLabel(playerPreferences.bufferDurationSeconds)}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {BUFFER_DURATION_PRESETS_SEC.map((sec) => (
                      <button
                        key={sec}
                        onClick={() => updatePlayerPreferences({ bufferDurationSeconds: sec })}
                        className={`py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                          playerPreferences.bufferDurationSeconds === sec
                            ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                            : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                        }`}
                      >
                        {formatShortMinutesLabel(sec)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 单缓存内存上限 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-gray-300">
                    <span>单缓存内存安全上限</span>
                    <span className="font-mono text-slate-300">
                      {formatMemoryCapLabel(playerPreferences.cacheMemoryCapMB)}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {MEMORY_CAP_PRESETS_MB.map((cap) => (
                      <button
                        key={cap.mb}
                        onClick={() => updatePlayerPreferences({ cacheMemoryCapMB: cap.mb })}
                        className={`py-1 rounded-lg text-[10px] font-mono font-medium transition cursor-pointer ${
                          playerPreferences.cacheMemoryCapMB === cap.mb
                            ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                            : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                        }`}
                      >
                        {cap.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 下一集内存预加载开关与时长 */}
                <div className="pt-2.5 border-t border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-white">下一集内存预加载</div>
                      <div className="text-[10px] text-slate-400">
                        跳过已标记片头时长，切集自动停下释放内存
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={playerPreferences.preloadNextEnabled}
                        onChange={(e) =>
                          updatePlayerPreferences({ preloadNextEnabled: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-black/[0.14] dark:bg-white/15 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1D1D1F] dark:peer-checked:bg-emerald-500" />
                    </label>
                  </div>

                  {playerPreferences.preloadNextEnabled && (
                    <>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-gray-300">
                          <span>下一集预载时长</span>
                          <span className="font-mono text-primary font-semibold">
                            {formatMinutesLabel(playerPreferences.preloadNextDurationSeconds)}
                          </span>
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {BUFFER_DURATION_PRESETS_SEC.map((sec) => (
                            <button
                              key={sec}
                              onClick={() =>
                                updatePlayerPreferences({ preloadNextDurationSeconds: sec })
                              }
                              className={`py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                                playerPreferences.preloadNextDurationSeconds === sec
                                  ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                                  : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                              }`}
                            >
                              {formatShortMinutesLabel(sec)}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-gray-300">
                          <span>预加载触发时机</span>
                          <span className="text-[10px] text-sky-300">
                            {PRELOAD_TRIGGER_MODE_OPTIONS.find(
                              (o) => o.id === playerPreferences.preloadTriggerMode
                            )?.shortLabel || '智能'}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {PRELOAD_TRIGGER_MODE_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              onClick={() =>
                                updatePlayerPreferences({ preloadTriggerMode: opt.id })
                              }
                              className={`py-1 rounded-lg text-[10px] font-medium transition cursor-pointer ${
                                playerPreferences.preloadTriggerMode === opt.id
                                  ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                                  : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                              }`}
                            >
                              {opt.shortLabel}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 实时下一集预加载进度条 */}
                      {(hasNextEpisode || nextPreloadStatus) && (
                        <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-medium text-white truncate">
                              {nextPreloadStatus
                                ? `下集${
                                    nextPreloadStatus.episodeNumber
                                      ? ` E${nextPreloadStatus.episodeNumber}`
                                      : ''
                                  } · ${nextPreloadStatus.itemName}`
                                : '下一集就绪待预载'}
                            </span>
                            <span
                              className={`text-[10px] font-mono shrink-0 ${
                                nextPreloadStatus?.status === 'ready'
                                  ? 'text-emerald-400'
                                  : nextPreloadStatus?.status === 'error'
                                  ? 'text-rose-400'
                                  : 'text-sky-300'
                              }`}
                            >
                              {formatPreloadStateText(nextPreloadStatus)}
                            </span>
                          </div>

                          {nextPreloadStatus && (
                            <>
                              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-300 ${
                                    nextPreloadStatus.status === 'ready'
                                      ? 'bg-emerald-400'
                                      : nextPreloadStatus.status === 'error'
                                      ? 'bg-rose-400'
                                      : 'bg-sky-400'
                                  }`}
                                  style={{
                                    width: `${
                                      nextPreloadStatus.targetDurationSec > 0
                                        ? Math.min(
                                            100,
                                            Math.round(
                                              (nextPreloadStatus.cachedDurationSec /
                                                nextPreloadStatus.targetDurationSec) *
                                                100
                                            )
                                          )
                                        : 0
                                    }%`,
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                                <span>
                                  {formatPreloadDurationMMSS(nextPreloadStatus.cachedDurationSec)} /{' '}
                                  {formatPreloadDurationMMSS(nextPreloadStatus.targetDurationSec)}
                                </span>
                                <span>
                                  {(nextPreloadStatus.cachedBytes / (1024 * 1024)).toFixed(1)} MB
                                </span>
                              </div>
                              {(nextPreloadStatus.skippedIntro || nextPreloadStatus.cappedByMemory) && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {nextPreloadStatus.skippedIntro && (
                                    <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 text-[10px] font-mono">
                                      已跳过片头 {formatSec(nextPreloadStatus.startSeconds)}
                                    </span>
                                  )}
                                  {nextPreloadStatus.cappedByMemory && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">
                                      已触及内存上限保护
                                    </span>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 播放内核切换（迁移自弹幕抽屉） */}
              <div className="space-y-2 pt-3 border-t border-white/10">
                <div className="flex justify-between items-center text-gray-300">
                  <span className="font-medium">播放器内核 (切换即生效)</span>
                  <span className="font-mono text-primary font-bold text-[11px]">
                    {isMpv ? 'libmpv 原生硬解' : 'WebView 兼容'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEngineType('mpv')}
                    className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isMpv
                        ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                        : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                    }`}
                  >
                    libmpv 原生硬解
                  </button>
                  <button
                    onClick={() => setEngineType('html5')}
                    className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      !isMpv
                        ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-semibold'
                        : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                    }`}
                  >
                    WebView 兼容
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'subtitle' && (
            <div className="space-y-5">
              {/* 主字幕快捷选择 */}
              <div className="space-y-2">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
                  主字幕轨道 (快捷键 C 轮换)
                </span>
                <select
                  value={selectedSubtitleId || ''}
                  onChange={(e) => onSelectSubtitleTrack(e.target.value || null)}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-primary"
                >
                  <option value="">关闭字幕</option>
                  {subtitleTracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* 双语次字幕 */}
              {isMpv && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center space-x-1">
                      <Layers className="w-3.5 h-3.5 text-sky-400" />
                      <span>双语次字幕 (顶部显示)</span>
                    </span>
                  </div>
                  <select
                    value={selectedSecondarySubtitleId || ''}
                    onChange={(e) => onSelectSecondarySubtitleTrack(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-primary"
                  >
                    <option value="">关闭双语次字幕</option>
                    {internalSubTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 字幕时间延迟校准 */}
              {isMpv && (
                <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">字幕时间延迟 (Z / X)</span>
                    <span className="font-mono text-primary font-bold">
                      {playerPreferences.subDelay > 0
                        ? `+${playerPreferences.subDelay.toFixed(1)}`
                        : playerPreferences.subDelay.toFixed(1)}
                      s
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { d: -5, label: '-5s' },
                      { d: -0.5, label: '-0.5s' },
                      { d: 0, label: '归零' },
                      { d: 0.5, label: '+0.5s' },
                      { d: 5, label: '+5s' },
                    ].map((btn) => (
                      <button
                        key={btn.label}
                        onClick={() =>
                          updatePlayerPreferences({
                            subDelay:
                              btn.d === 0
                                ? 0
                                : Math.round((playerPreferences.subDelay + btn.d) * 10) / 10,
                          })
                        }
                        className={`py-1.5 rounded-lg font-mono text-[11px] font-semibold transition cursor-pointer ${
                          btn.d === 0
                            ? 'bg-primary/20 text-primary hover:bg-primary hover:text-white'
                            : 'bg-white/5 hover:bg-white/15 text-gray-200'
                        }`}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 字幕缩放与位置 */}
              {isMpv && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-300">
                      <span>字幕字体缩放</span>
                      <span className="font-mono text-primary font-bold">
                        {playerPreferences.subScale.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.6"
                      max="1.8"
                      step="0.05"
                      value={playerPreferences.subScale}
                      onChange={(e) =>
                        updatePlayerPreferences({ subScale: parseFloat(e.target.value) })
                      }
                      className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-300">
                      <span>字幕垂直位置</span>
                      <span className="font-mono text-primary font-bold">
                        {playerPreferences.subPos}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="1"
                      value={playerPreferences.subPos}
                      onChange={(e) =>
                        updatePlayerPreferences({ subPos: parseInt(e.target.value, 10) })
                      }
                      className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                    />
                  </div>
                </div>
              )}

              {/* 拖放本地外挂字幕提示 */}
              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-400/25 flex items-start space-x-2.5 text-sky-200">
                <FileUp className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  支持直接将电脑上的 <code className="text-white">.srt / .ass / .ssa / .vtt</code> 字幕文件拖入播放窗口，无需上传服务器即可即时叠加显示。
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-5">
              {/* 软件音量增益 */}
              <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-white">软件音量增益 (最高 200%)</span>
                  <span
                    className={`font-mono font-bold ${
                      volume > 100 ? 'text-amber-400' : 'text-primary'
                    }`}
                  >
                    {volume}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={isMpv ? 200 : 100}
                  step="5"
                  value={volume}
                  onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                />
                <p className="text-[10px] text-slate-400">
                  针对 5.1/7.1 原盘电影人声偏小场景，支持突破系统 100% 限制进行放大。
                </p>
              </div>

              {isMpv && (
                <>
                  {/* 夜间动态人声均衡 */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-black/30 border border-white/10">
                    <div>
                      <div className="font-medium text-white">夜间人声均衡 (Dynamic Norm)</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        压缩爆炸巨大声差、放大清晰人声对白
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={playerPreferences.nightMode}
                        onChange={(e) =>
                          updatePlayerPreferences({ nightMode: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-black/[0.14] dark:bg-white/15 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1D1D1F] dark:peer-checked:bg-emerald-500" />
                    </label>
                  </div>

                  {/* 音频延迟校准 */}
                  <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">音频延迟校准 (蓝牙耳机对齐)</span>
                      <span className="font-mono text-primary font-bold">
                        {playerPreferences.audioDelay > 0
                          ? `+${playerPreferences.audioDelay.toFixed(1)}`
                          : playerPreferences.audioDelay.toFixed(1)}
                        s
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[
                        { d: -0.5, label: '-0.5s' },
                        { d: -0.1, label: '-0.1s' },
                        { d: 0, label: '归零' },
                        { d: 0.1, label: '+0.1s' },
                        { d: 0.5, label: '+0.5s' },
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          onClick={() =>
                            updatePlayerPreferences({
                              audioDelay:
                                btn.d === 0
                                  ? 0
                                  : Math.round((playerPreferences.audioDelay + btn.d) * 10) / 10,
                            })
                          }
                          className={`py-1.5 rounded-lg font-mono text-[11px] font-semibold transition cursor-pointer ${
                            btn.d === 0
                              ? 'bg-primary/20 text-primary hover:bg-primary hover:text-white'
                              : 'bg-white/5 hover:bg-white/15 text-gray-200'
                          }`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* 长按右方向键倍率 & A-B 循环 & 截图 */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300 font-medium">长按 → 临时加速倍率</span>
                  <div className="flex space-x-1.5">
                    {([2.0, 2.5, 3.0] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => updatePlayerPreferences({ longPressSpeed: r })}
                        className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition cursor-pointer ${
                          playerPreferences.longPressSpeed === r
                            ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] font-bold'
                            : 'bg-black/[0.05] hover:bg-black/[0.10] text-[#48484A] dark:bg-white/[0.06] dark:hover:bg-white/10 dark:text-white/75'
                        }`}
                      >
                        {r}x
                      </button>
                    ))}
                  </div>
                </div>

                {isMpv && (
                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white flex items-center space-x-1.5">
                        <Repeat className="w-3.5 h-3.5 text-sky-400" />
                        <span>A-B 片段复读循环</span>
                      </span>
                      <span className="font-mono text-[11px] text-sky-300">
                        {formatSec(abLoopA)} → {formatSec(abLoopB)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => onSetAbLoop('a')}
                        className="py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer"
                      >
                        设为 A 点
                      </button>
                      <button
                        onClick={() => onSetAbLoop('b')}
                        className="py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer"
                      >
                        设为 B 点
                      </button>
                      <button
                        onClick={() => onSetAbLoop('clear')}
                        className="py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-medium cursor-pointer"
                      >
                        清除循环
                      </button>
                    </div>
                  </div>
                )}

                {isMpv && (
                  <button
                    onClick={onTakeScreenshot}
                    className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium flex items-center justify-center space-x-2 transition cursor-pointer border border-white/10"
                  >
                    <Camera className="w-4 h-4 text-sky-400" />
                    <span>截取当前无损 PNG 画面 (快捷键 S)</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VideoProPanel;
