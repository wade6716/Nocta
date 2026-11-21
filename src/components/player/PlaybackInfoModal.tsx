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
  Sparkles,
  Globe,
} from 'lucide-react';
import { EmbyItem, EmbyMediaSource, MappedTrack } from '../../api/embyClient';
import {
  NextEpisodePreloadStatus,
  PlayerTelemetry,
  ResolvedStreamProxyInfo,
} from '../../player/types';
import { formatNetworkSpeed, formatTime } from './PlayerOsd';
import { usePlayerStore } from '../../stores/usePlayerStore';
import {
  formatMemoryCapLabel,
  formatMinutesLabel,
  formatPreloadDurationMMSS,
  formatPreloadStateText,
} from '../../player/preloadUtils';

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
  networkSpeed?: number;
  telemetry?: PlayerTelemetry;
  proxyInfo?: ResolvedStreamProxyInfo | null;
  nextPreloadStatus?: NextEpisodePreloadStatus | null;
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

function formatProxyLabel(info?: ResolvedStreamProxyInfo | null): string {
  if (!info) return '直连';
  switch (info.mode) {
    case 'system_http':
      return `系统 HTTP 代理 (${info.effectiveProxy})`;
    case 'manual_http':
      return `手动 HTTP 代理 (${info.effectiveProxy})`;
    case 'lan_bypass':
      return '局域网自动旁路直连';
    case 'socks5_fallback_direct':
      return `SOCKS5 已配置 (${info.configuredProxy}) · 视频流直连`;
    case 'direct':
    default:
      return info.overrideMode === 'direct' ? '强制直连' : '直连';
  }
}

export const PlaybackInfoModal: React.FC<PlaybackInfoModalProps> = ({
  isOpen,
  onClose,
  item,
  mediaSource,
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
  networkSpeed,
  telemetry,
  proxyInfo,
  nextPreloadStatus,
}) => {
  const [copied, setCopied] = useState(false);
  const playerPreferences = usePlayerStore((s) => s.playerPreferences);

  if (!isOpen || !item) return null;

  // 精确匹配当前选中音轨对应的 Emby MediaStream (修复 audio-<Index> 前缀错位 Bug)
  const currentAudioTrack = audioTracks.find((t) => t.id === selectedAudioId) || audioTracks[0];
  const activeAudioStream = mediaSource?.MediaStreams?.find(
    (s) =>
      s.Type === 'Audio' &&
      (currentAudioTrack
        ? s.Index === currentAudioTrack.originalIndex
        : selectedAudioId
        ? `audio-${s.Index}` === selectedAudioId || String(s.Index) === selectedAudioId
        : s.IsDefault)
  );
  const videoStream = mediaSource?.MediaStreams?.find((s) => s.Type === 'Video');
  const currentSubtitleTrack = subtitleTracks.find((t) => t.id === selectedSubtitleId);

  const progressPercent = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

  const resolutionLabel =
    videoStream?.Width && videoStream?.Height
      ? `${videoStream.Width} × ${videoStream.Height}`
      : '-';

  const is4K = (videoStream?.Width || 0) >= 3800 || (videoStream?.Height || 0) >= 2100;
  const is1080p = (videoStream?.Width || 0) >= 1900 && !is4K;

  const dynamicRange =
    videoStream?.VideoRange ||
    (videoStream?.BitDepth && videoStream.BitDepth >= 10 ? 'HDR' : 'SDR');

  const hwdecLabel =
    engineType !== 'mpv'
      ? '浏览器默认解码'
      : telemetry?.hwdecCurrent && telemetry.hwdecCurrent !== 'no'
      ? `已激活 (${telemetry.hwdecCurrent.toUpperCase()})`
      : telemetry?.hwdecCurrent === 'no'
      ? 'CPU 软解回退 (no)'
      : '探测中 (auto-safe)';

  const handleCopyInfo = async () => {
    const lines = [
      `【Nocta 播放详细信息】`,
      `媒体标题: ${item.Name}`,
      item.SeriesName ? `剧集归属: ${item.SeriesName} (第 ${item.IndexNumber || 1} 集)` : null,
      `来源服务器: ${currentServerName || item.ServerName || '当前服务器'}`,
      `网络代理路线: ${formatProxyLabel(proxyInfo)}`,
      `实时网速: ${formatNetworkSpeed(networkSpeed)}`,
      `前向缓冲: ${telemetry?.cacheDuration !== undefined ? `${telemetry.cacheDuration.toFixed(1)}s` : '-'} / 目标 ${formatMinutesLabel(playerPreferences.bufferDurationSeconds)} (${formatBytes(telemetry?.cacheForwardBytes)} · 单缓存上限 ${formatMemoryCapLabel(playerPreferences.cacheMemoryCapMB)})`,
      nextPreloadStatus
        ? `下一集内存预加载: ${nextPreloadStatus.itemName} · ${formatPreloadStateText(nextPreloadStatus)} (${formatPreloadDurationMMSS(nextPreloadStatus.cachedDurationSec)} / ${formatPreloadDurationMMSS(nextPreloadStatus.targetDurationSec)}, ${formatBytes(nextPreloadStatus.cachedBytes)}${nextPreloadStatus.skippedIntro ? `, 已跳过片头至 ${formatTime(nextPreloadStatus.startSeconds)}` : ''})`
        : `下一集内存预加载: ${playerPreferences.preloadNextEnabled ? `待触发 (${formatMinutesLabel(playerPreferences.preloadNextDurationSeconds)})` : '已关闭'}`,
      `播放内核: ${engineType === 'mpv' ? 'libmpv (原生渲染)' : 'HTML5 Video'}`,
      `实时硬件解码: ${hwdecLabel}`,
      `实时渲染帧率: ${telemetry?.fps ? `${telemetry.fps.toFixed(2)} fps` : '-'} (丢帧: ${telemetry?.droppedFrames ?? 0})`,
      `播放进度: ${formatTime(currentTime)} / ${formatTime(duration)} (${progressPercent}%) · ${playbackRate}x 倍速`,
      `--- 视频流 ---`,
      `视频编码: ${(telemetry?.videoCodec || videoStream?.Codec)?.toUpperCase() || '-'}`,
      `分辨率: ${resolutionLabel} (${videoStream?.AspectRatio || '-'})`,
      `源标称帧率: ${videoStream?.RealFrameRate || videoStream?.AverageFrameRate || '-'} fps`,
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
                <h3 className="text-sm font-bold text-white tracking-tight">实时硬解与媒体技术信息</h3>
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
                  <span>{engineType === 'mpv' ? 'DirectPlay 原画直出' : 'HTML5 引擎'}</span>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar text-xs">
          {/* 1. 播放概览与网络代理状态 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>当前播放与缓冲状态</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-slate-300">
              <div>
                <span className="text-slate-500 block text-[11px]">播放进度</span>
                <span className="font-mono text-white font-medium text-xs tabular-nums">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <span className="text-[10px] text-slate-500 ml-1 font-mono">({progressPercent}%)</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">前向内存缓冲</span>
                <span className="font-mono text-emerald-300 font-medium text-xs tabular-nums">
                  {telemetry?.cacheDuration !== undefined ? `${telemetry.cacheDuration.toFixed(1)}s` : '-'}
                </span>
                <span className="text-[10px] text-slate-400 ml-1 font-mono">
                  / {Math.round(playerPreferences.bufferDurationSeconds / 60)}分
                </span>
                <span className="text-[10px] text-slate-500 block font-mono">
                  {telemetry?.cacheForwardBytes !== undefined && telemetry.cacheForwardBytes > 0
                    ? `${formatBytes(telemetry.cacheForwardBytes)} · `
                    : ''}
                  上限 {formatMemoryCapLabel(playerPreferences.cacheMemoryCapMB)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">实时网速</span>
                <span className="font-mono text-sky-400 font-medium text-xs tabular-nums">
                  {formatNetworkSpeed(networkSpeed)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">倍速</span>
                <span className="font-mono text-white font-medium text-xs">{playbackRate}x</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">来源服务器</span>
                <span className="text-amber-300 font-medium text-xs truncate block" title={currentServerName || item.ServerName}>
                  {currentServerName || item.ServerName || '默认服务器'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-white/[0.04] flex items-center space-x-2 text-[11px] text-slate-300">
              <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-500 shrink-0">网络代理路线:</span>
              <span className="font-mono text-emerald-300 truncate">{formatProxyLabel(proxyInfo)}</span>
            </div>

            {item.Type === 'Episode' && (
              <div className="pt-2 border-t border-white/[0.04] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-300">
                <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-slate-500 shrink-0">下一集内存预加载:</span>
                {nextPreloadStatus ? (
                  <>
                    <span className="text-sky-300 font-medium truncate max-w-[200px]">
                      {nextPreloadStatus.episodeNumber
                        ? `E${nextPreloadStatus.episodeNumber} `
                        : ''}
                      {nextPreloadStatus.itemName}
                    </span>
                    <span className="font-mono text-emerald-300">
                      {formatPreloadStateText(nextPreloadStatus)} (
                      {formatPreloadDurationMMSS(nextPreloadStatus.cachedDurationSec)} /{' '}
                      {formatPreloadDurationMMSS(nextPreloadStatus.targetDurationSec)} ·{' '}
                      {formatBytes(nextPreloadStatus.cachedBytes)})
                    </span>
                    {nextPreloadStatus.skippedIntro && (
                      <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono text-[10px]">
                        已跳片头 {formatTime(nextPreloadStatus.startSeconds)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400 font-mono">
                    {playerPreferences.preloadNextEnabled
                      ? `就绪待触发 (${formatMinutesLabel(playerPreferences.preloadNextDurationSeconds)})`
                      : '已关闭'}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 2. 实时解码遥测与内核 */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>实时解码引擎遥测 (Hardware Telemetry)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4">
              <div>
                <span className="text-slate-500 block text-[11px]">硬件解码 (HWDEC)</span>
                <span
                  className={`font-mono font-semibold ${
                    telemetry?.hwdecCurrent && telemetry.hwdecCurrent !== 'no'
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }`}
                >
                  {hwdecLabel}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">实时渲染帧率</span>
                <span className="font-mono text-white font-semibold tabular-nums">
                  {telemetry?.fps !== undefined ? `${telemetry.fps.toFixed(2)} fps` : '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">累计丢帧数</span>
                <span className="font-mono text-white font-semibold tabular-nums">
                  {telemetry?.droppedFrames ?? 0}
                </span>
              </div>

              <div className="col-span-2 sm:col-span-3">
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

          {/* 3. 视频流参数 */}
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
                <span className="font-mono text-white font-semibold">
                  {(telemetry?.videoCodec || videoStream?.Codec)?.toUpperCase() || '-'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">分辨率与比例</span>
                <span className="font-mono text-white">
                  {resolutionLabel} {videoStream?.AspectRatio ? `(${videoStream.AspectRatio})` : ''}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">源标称帧率</span>
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

          {/* 4. 音频流参数 */}
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

          {/* 5. 字幕与存储容器 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2.5">
              <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
                <Subtitles className="w-3.5 h-3.5 text-rose-400" />
                <span>当前字幕</span>
              </div>
              <div className="text-white font-medium truncate">
                {currentSubtitleTrack ? currentSubtitleTrack.title : '未开启 / 关闭字幕'}
              </div>
              <div className="text-[11px] text-slate-400">
                格式: {currentSubtitleTrack?.codec?.toUpperCase() || '-'} ·{' '}
                {currentSubtitleTrack
                  ? currentSubtitleTrack.isExternal
                    ? '外部外挂'
                    : '容器内嵌'
                  : '-'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2.5">
              <div className="flex items-center space-x-2 text-slate-300 font-semibold text-xs border-b border-white/[0.04] pb-2">
                <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                <span>容器与文件体积</span>
              </div>
              <div className="font-mono text-white font-semibold">
                {mediaSource?.Container?.toUpperCase() || '-'} · {formatBytes(mediaSource?.Size)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                总比特率: {formatBitrate(mediaSource?.Bitrate)}
              </div>
            </div>
          </div>

          {mediaSource?.Path && (
            <div className="p-3 rounded-xl bg-black/30 border border-white/5">
              <span className="text-slate-500 block text-[10px] mb-1">服务器物理路径</span>
              <p className="font-mono text-[11px] text-slate-300 break-all select-text">
                {mediaSource.Path}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlaybackInfoModal;
