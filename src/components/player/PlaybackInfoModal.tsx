import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Info,
  Film,
  Volume2,
  Subtitles,
  Cpu,
  HardDrive,
  Activity,
  Server,
  Layers,
  Sparkles,
} from 'lucide-react';
import { EmbyItem, EmbyMediaSource, MappedTrack } from '../../api/embyClient';

interface PlaybackInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: EmbyItem | null;
  mediaSource: EmbyMediaSource | null;
  streamUrl: string | null;
  engineType: 'mpv' | 'html5';
  currentTime: number;
  duration: number;
  playbackRate: number;
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  selectedAudioId: string | null;
  selectedSubtitleId: string | null;
  currentServerName?: string;
  danmakuMatchedTitle?: string;
  danmakuCount?: number;
  danmakuOffset?: number;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatBitrate(bps?: number): string {
  if (!bps || bps <= 0) return '-';
  const mbps = bps / 1000000;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = Math.round(bps / 1000);
  return `${kbps} kbps`;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const PlaybackInfoModal: React.FC<PlaybackInfoModalProps> = ({
  isOpen,
  onClose,
  item,
  mediaSource,
  streamUrl,
  engineType,
  currentTime,
  duration,
  playbackRate,
  audioTracks,
  subtitleTracks,
  selectedAudioId,
  selectedSubtitleId,
  currentServerName,
  danmakuMatchedTitle,
  danmakuCount,
  danmakuOffset,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !item) return null;

  // 提取视频流与音频流元数据
  const videoStream = mediaSource?.MediaStreams?.find((s) => s.Type === 'Video');
  const activeAudioStream = mediaSource?.MediaStreams?.find(
    (s) => s.Type === 'Audio' && (selectedAudioId ? String(s.Index) === selectedAudioId : s.IsDefault)
  );
  const currentAudioTrack = audioTracks.find((t) => t.id === selectedAudioId) || audioTracks[0];
  const currentSubtitleTrack = subtitleTracks.find((t) => t.id === selectedSubtitleId);

  // 进度计算
  const progressPercent = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

  // 规格推断
  const resolutionLabel =
    videoStream?.Width && videoStream?.Height
      ? `${videoStream.Width} × ${videoStream.Height}`
      : '-';

  const is4K = (videoStream?.Width || 0) >= 3800 || (videoStream?.Height || 0) >= 2100;
  const is1080p = (videoStream?.Width || 0) >= 1900 && !is4K;

  const dynamicRange =
    videoStream?.VideoRange ||
    (videoStream?.BitDepth && videoStream.BitDepth >= 10 ? 'HDR' : 'SDR');

  // 一键复制播放统计信息文本
  const handleCopyInfo = async () => {
    const lines = [
      `【Nocta 播放详细信息】`,
      `媒体标题: ${item.Name}`,
      item.SeriesName ? `剧集归属: ${item.SeriesName} (第 ${item.IndexNumber || 1} 集)` : null,
      `来源服务器: ${currentServerName || item.ServerName || '当前服务器'}`,
      `播放内核: ${engineType === 'mpv' ? 'libmpv (原生 GPU 硬解加速)' : 'HTML5 Video'}`,
      `播放进度: ${formatTime(currentTime)} / ${formatTime(duration)} (${progressPercent}%) · ${playbackRate}x 倍速`,
      `--- 视频流 ---`,
      `视频编码: ${videoStream?.Codec?.toUpperCase() || '-'}`,
      `分辨率: ${resolutionLabel} (${videoStream?.AspectRatio || '-'})`,
      `帧率: ${videoStream?.RealFrameRate || videoStream?.AverageFrameRate || '-'} fps`,
      `色深与范围: ${videoStream?.BitDepth ? `${videoStream.BitDepth}-bit` : '-'} · ${dynamicRange}`,
      `色彩空间: ${videoStream?.ColorSpace || videoStream?.ColorPrimaries || '-'}`,
      `Profile: ${videoStream?.Profile || '-'} (Level ${videoStream?.Level || '-'})`,
      `视频码率: ${formatBitrate(videoStream?.BitRate)}`,
      `--- 音频流 ---`,
      `当前音轨: ${currentAudioTrack?.title || activeAudioStream?.DisplayTitle || '-'}`,
      `音频编码: ${activeAudioStream?.Codec?.toUpperCase() || currentAudioTrack?.codec?.toUpperCase() || '-'}`,
      `声道配置: ${activeAudioStream?.ChannelLayout || (activeAudioStream?.Channels ? `${activeAudioStream.Channels} 声道` : '-')}`,
      `采样率: ${activeAudioStream?.SampleRate ? `${activeAudioStream.SampleRate} Hz` : '-'}`,
      `音频码率: ${formatBitrate(activeAudioStream?.BitRate)}`,
      `--- 字幕流 ---`,
      `当前字幕: ${currentSubtitleTrack ? currentSubtitleTrack.title : '未开启 / 关闭'}`,
      `字幕格式: ${currentSubtitleTrack?.codec?.toUpperCase() || '-'}`,
      `--- 文件与存储 ---`,
      `容器格式: ${mediaSource?.Container?.toUpperCase() || '-'}`,
      `文件大小: ${formatBytes(mediaSource?.Size)}`,
      `总比特率: ${formatBitrate(mediaSource?.Bitrate)}`,
      `文件路径: ${mediaSource?.Path || '-'}`,
      danmakuMatchedTitle ? `弹幕绑定: ${danmakuMatchedTitle} (${danmakuCount || 0}条，偏移 ${danmakuOffset || 0}s)` : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('复制播放信息失败', e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[88vh] bg-[#0E121D]/95 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-400/25 text-sky-400">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white tracking-tight">播放详细信息</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium border flex items-center space-x-1 ${
                    engineType === 'mpv'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-primary/15 text-primary border-primary/30'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      engineType === 'mpv' ? 'bg-emerald-400 animate-pulse' : 'bg-primary'
                    }`}
                  />
                  <span>{engineType === 'mpv' ? 'libmpv 硬解直出' : 'HTML5 引擎'}</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-md">
                {item.SeriesName ? `${item.SeriesName} · ` : ''}{item.Name}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyInfo}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer border flex items-center space-x-1.5 ${
                copied
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/10'
              }`}
              title="复制全部技术信息"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制' : '复制信息'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer border border-white/5"
              title="关闭 (Esc / I)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body content with smooth scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-xs">
          {/* 1. 播放概览卡片 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>当前播放状态</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-300">
              <div>
                <span className="text-slate-500 block text-[11px]">播放进度</span>
                <span className="font-mono text-white font-medium text-xs">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <span className="text-[10px] text-slate-500 ml-1 font-mono">({progressPercent}%)</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">当前倍速</span>
                <span className="font-mono text-white font-medium text-xs">{playbackRate}x</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">传输协议</span>
                <span className="text-emerald-400 font-medium text-xs">DirectStream 直链</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">来源服务器</span>
                <span className="text-amber-300 font-medium text-xs truncate block" title={currentServerName || item.ServerName}>
                  {currentServerName || item.ServerName || '默认服务器'}
                </span>
              </div>
            </div>
          </div>

          {/* 2. 视频流参数 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Film className="w-3.5 h-3.5 text-primary" />
              <span>视频流技术规格 (Video Stream)</span>
              {is4K && (
                <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold">
                  4K UHD
                </span>
              )}
              {is1080p && (
                <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                  1080p FHD
                </span>
              )}
              {dynamicRange !== 'SDR' && (
                <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">
                  {dynamicRange}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4">
              <div>
                <span className="text-slate-500 block text-[11px]">编码格式</span>
                <span className="font-mono text-white font-semibold">{videoStream?.Codec?.toUpperCase() || '-'}</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">分辨率与比例</span>
                <span className="font-mono text-white">
                  {resolutionLabel} {videoStream?.AspectRatio ? `(${videoStream.AspectRatio})` : ''}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">帧率</span>
                <span className="font-mono text-white">
                  {videoStream?.RealFrameRate || videoStream?.AverageFrameRate || '-'} fps
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">色深与动态范围</span>
                <span className="font-mono text-white">
                  {videoStream?.BitDepth ? `${videoStream.BitDepth}-bit` : '-'} · {dynamicRange}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">色彩空间 / 色域</span>
                <span className="font-mono text-white truncate block">
                  {videoStream?.ColorSpace || videoStream?.ColorPrimaries || '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">规格档次 (Profile)</span>
                <span className="font-mono text-white truncate block">
                  {videoStream?.Profile || '-'} {videoStream?.Level ? `@ L${videoStream.Level}` : ''}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">视频码率</span>
                <span className="font-mono text-sky-400 font-medium">
                  {formatBitrate(videoStream?.BitRate)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">像素格式</span>
                <span className="font-mono text-white">{videoStream?.PixelFormat || '-'}</span>
              </div>
            </div>
          </div>

          {/* 3. 音频流参数 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              <span>当前音频配置 (Audio Stream)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4">
              <div className="col-span-2">
                <span className="text-slate-500 block text-[11px]">音轨名称</span>
                <span className="text-white font-medium truncate block">
                  {currentAudioTrack?.title || activeAudioStream?.DisplayTitle || '默认音轨'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">音频编码</span>
                <span className="font-mono text-white font-semibold">
                  {activeAudioStream?.Codec?.toUpperCase() || currentAudioTrack?.codec?.toUpperCase() || '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">声道布局</span>
                <span className="font-mono text-white">
                  {activeAudioStream?.ChannelLayout || (activeAudioStream?.Channels ? `${activeAudioStream.Channels} 声道` : '-')}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">采样率</span>
                <span className="font-mono text-white">
                  {activeAudioStream?.SampleRate ? `${activeAudioStream.SampleRate} Hz` : '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">音频码率</span>
                <span className="font-mono text-amber-300 font-medium">
                  {formatBitrate(activeAudioStream?.BitRate)}
                </span>
              </div>
            </div>
          </div>

          {/* 4. 字幕配置 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Subtitles className="w-3.5 h-3.5 text-rose-400" />
              <span>当前字幕属性 (Subtitles)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4">
              <div className="col-span-2">
                <span className="text-slate-500 block text-[11px]">字幕名称</span>
                <span className="text-white font-medium truncate block">
                  {currentSubtitleTrack ? currentSubtitleTrack.title : '未开启 / 关闭字幕'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">字幕格式</span>
                <span className="font-mono text-white">
                  {currentSubtitleTrack?.codec?.toUpperCase() || '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">载入方式</span>
                <span className="text-white">
                  {currentSubtitleTrack
                    ? currentSubtitleTrack.isExternal
                      ? '外部外挂字幕'
                      : '容器内嵌字幕'
                    : '-'}
                </span>
              </div>
            </div>
          </div>

          {/* 5. 播放内核与弹幕状态 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>播放内核与弹幕状态 (Engine & Danmaku)</span>
            </div>

            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div>
                <span className="text-slate-500 block text-[11px]">渲染架构</span>
                <span className="text-white font-medium">
                  {engineType === 'mpv'
                    ? 'Native libmpv 2.0 (Direct3D11 / Vulkan 硬件表面)'
                    : 'HTML5 Video (Web Audio API)'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">硬件解码 (HWDEC)</span>
                <span className="text-emerald-400 font-medium">
                  {engineType === 'mpv' ? '已启用 (auto-safe)' : '浏览器默认'}
                </span>
              </div>

              <div className="col-span-2">
                <span className="text-slate-500 block text-[11px]">弹幕源绑定</span>
                <span className="text-sky-300 font-medium">
                  {danmakuMatchedTitle ? (
                    <span className="flex items-center space-x-1.5">
                      <Sparkles className="w-3 h-3 text-sky-400" />
                      <span>
                        {danmakuMatchedTitle} ({danmakuCount || 0} 条弹幕
                        {danmakuOffset ? ` · 偏移 ${danmakuOffset > 0 ? `+${danmakuOffset}` : danmakuOffset}s` : ''})
                      </span>
                    </span>
                  ) : (
                    '未绑定弹幕库'
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* 6. 文件与服务器 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
              <span>存储与文件详情 (Storage & Source)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4">
              <div>
                <span className="text-slate-500 block text-[11px]">容器格式</span>
                <span className="font-mono text-white font-semibold">
                  {mediaSource?.Container?.toUpperCase() || '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">文件体积</span>
                <span className="font-mono text-white font-semibold">
                  {formatBytes(mediaSource?.Size)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">总比特率</span>
                <span className="font-mono text-white">
                  {formatBitrate(mediaSource?.Bitrate)}
                </span>
              </div>

              {mediaSource?.Path && (
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-slate-500 block text-[11px]">服务器物理路径</span>
                  <p className="font-mono text-[11px] text-slate-300 break-all bg-black/30 p-2 rounded-lg border border-white/5 select-text">
                    {mediaSource.Path}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaybackInfoModal;
