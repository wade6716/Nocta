import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  EmbyItem,
  EmbyMediaSource,
  EmbyMediaStream,
  formatFileSize,
  ticksToSeconds,
} from '../../api/embyClient';
import { formatMediaSourceMeta } from '../../player/playbackSessionService';

interface DetailAboutSectionProps {
  item: EmbyItem;
  seriesItem?: EmbyItem | null;
  activePlayableItem?: EmbyItem | null;
  activeMediaSource?: EmbyMediaSource;
  mediaSourcesCount?: number;
  overviewText?: string;
}

function formatRuntime(ticks?: number): string | null {
  if (!ticks || ticks <= 0) return null;
  const mins = Math.round(ticksToSeconds(ticks) / 60);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function formatClockDuration(ticks?: number): string | null {
  if (!ticks || ticks <= 0) return null;
  const totalSec = Math.round(ticksToSeconds(ticks));
  if (totalSec <= 0) return null;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatBitrate(bps?: number): string | null {
  if (!bps || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} Mbps`;
  return `${Math.round(bps / 1000).toLocaleString()} kbps`;
}

function formatSampleRate(hz?: number): string | null {
  if (!hz || hz <= 0) return null;
  return `${(hz / 1000).toFixed(1).replace(/\.0$/, '')} kHz`;
}

function formatDateYmd(raw?: string): string | null {
  if (!raw) return null;
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : raw.slice(0, 10);
}

function redactMediaPath(rawPath?: string): { fileName: string | null; safePath: string | null } {
  if (!rawPath || !rawPath.trim()) return { fileName: null, safePath: null };
  const trimmed = rawPath.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      parsed.username = '';
      parsed.password = '';
      const sensitiveKeys = ['token', 'api_key', 'x-emby-token', 'sig', 'signature', 'key', 'auth', 'pass'];
      for (const k of Array.from(parsed.searchParams.keys())) {
        const lower = k.toLowerCase();
        if (sensitiveKeys.some((s) => lower.includes(s))) {
          parsed.searchParams.set(k, '***');
        }
      }
      const pathnameParts = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = pathnameParts[pathnameParts.length - 1];
      let decodedName: string | null = null;
      if (lastSegment) {
        try {
          decodedName = decodeURIComponent(lastSegment);
        } catch {
          decodedName = lastSegment;
        }
      }
      return {
        fileName: decodedName,
        safePath: parsed.toString(),
      };
    } catch {
      return { fileName: null, safePath: trimmed };
    }
  }

  const segments = trimmed.split(/[/\\]+/).filter(Boolean);
  const fileName = segments.length > 0 ? segments[segments.length - 1] : null;
  return { fileName, safePath: trimmed };
}

function formatColorRange(range?: string): string | null {
  if (!range) return null;
  const lower = range.trim().toLowerCase();
  if (lower === 'tv' || lower === 'mpeg' || lower === 'limited') return 'Limited (TV 16-235)';
  if (lower === 'pc' || lower === 'jpeg' || lower === 'full') return 'Full (PC 0-255)';
  return range;
}

function formatVideoSpecs(
  videoStream?: EmbyMediaStream,
  mediaSource?: EmbyMediaSource,
  hdrLabel?: string,
  resolutionLabel?: string
) {
  const resolutionDisplay = resolutionLabel
    ? [
        resolutionLabel,
        videoStream?.Width && videoStream?.Height
          ? `${videoStream.Width}×${videoStream.Height}`
          : null,
        videoStream?.AspectRatio || null,
      ]
        .filter(Boolean)
        .join(' · ')
    : videoStream?.Width && videoStream?.Height
    ? [
        `${videoStream.Width}×${videoStream.Height}`,
        videoStream.AspectRatio || null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const levelLabel =
    typeof videoStream?.Level === 'number' && videoStream.Level > 0
      ? `L${videoStream.Level >= 10 ? (videoStream.Level / 10).toFixed(1).replace(/\.0$/, '') : videoStream.Level}`
      : null;

  const videoCodecDisplay = videoStream?.Codec
    ? [
        videoStream.Codec.toUpperCase(),
        videoStream.Profile,
        levelLabel,
        videoStream.CodecTag ? `(${videoStream.CodecTag})` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const videoBitrateDisplay = formatBitrate(videoStream?.BitRate);

  const realFps = videoStream?.RealFrameRate;
  const avgFps = videoStream?.AverageFrameRate;
  let fpsDisplay: string | null = null;
  if (realFps && realFps > 0) {
    const realStr = Number(realFps.toFixed(3)).toString();
    if (avgFps && avgFps > 0 && Math.abs(realFps - avgFps) > 0.05) {
      fpsDisplay = `${realStr} fps (平均 ${Number(avgFps.toFixed(3))} fps · VFR)`;
    } else {
      fpsDisplay = `${realStr} fps`;
    }
  } else if (avgFps && avgFps > 0) {
    fpsDisplay = `${Number(avgFps.toFixed(3))} fps`;
  }

  const scanModeParts: string[] = [];
  if (typeof videoStream?.IsInterlaced === 'boolean') {
    scanModeParts.push(videoStream.IsInterlaced ? '隔行扫描 (Interlaced)' : '逐行扫描 (Progressive)');
  }
  if (typeof videoStream?.RefFrames === 'number' && videoStream.RefFrames > 0) {
    scanModeParts.push(`${videoStream.RefFrames} 参考帧`);
  }
  if (videoStream?.IsAnamorphic) {
    scanModeParts.push('变形像素');
  }
  const scanDisplay = scanModeParts.length > 0 ? scanModeParts.join(' · ') : null;

  const doviDetail = (() => {
    if (videoStream?.VideoDoViTitle) return videoStream.VideoDoViTitle;
    if (typeof videoStream?.DvProfile === 'number') {
      const profileStr = `Profile ${videoStream.DvProfile}${
        typeof videoStream.DvLevel === 'number' ? `.${videoStream.DvLevel}` : ''
      }`;
      const compat =
        typeof videoStream.DvBlSignalCompatibilityId === 'number'
          ? ` (兼容层 ${videoStream.DvBlSignalCompatibilityId})`
          : '';
      return `Dolby Vision ${profileStr}${compat}`;
    }
    return null;
  })();

  const dynamicRangeDisplay =
    Array.from(
      new Set(
        [
          doviDetail || hdrLabel || null,
          videoStream?.VideoRangeType || null,
          videoStream?.VideoRange || null,
        ].filter(Boolean)
      )
    ).join(' · ') || null;

  const pixelDisplay =
    [
      videoStream?.BitDepth ? `${videoStream.BitDepth}-bit` : null,
      videoStream?.PixelFormat || null,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  return {
    streamSummary: videoStream?.DisplayTitle || null,
    resolutionDisplay,
    videoCodecDisplay,
    videoBitrateDisplay,
    fpsDisplay,
    scanDisplay,
    dynamicRangeDisplay,
    pixelDisplay,
    colorPrimaries: videoStream?.ColorPrimaries || null,
    colorTransfer: videoStream?.ColorTransfer || null,
    colorSpace: videoStream?.ColorSpace || null,
    colorRange: formatColorRange(videoStream?.ColorRange),
    totalBitrateDisplay: formatBitrate(mediaSource?.Bitrate),
  };
}

const InfoRow: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({
  label,
  value,
  mono = false,
}) => {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-black/[0.04] dark:border-white/[0.05] last:border-b-0">
      <span className="text-xs text-[#86868B] dark:text-white/50 flex-shrink-0">{label}</span>
      <span
        className={`text-xs font-medium text-[#1D1D1F] dark:text-[#F5F5F7] text-right break-all tabular-nums ${
          mono ? 'font-mono text-[11.5px]' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
};

export const DetailAboutSection: React.FC<DetailAboutSectionProps> = ({
  item,
  seriesItem,
  activePlayableItem,
  activeMediaSource,
  mediaSourcesCount = 0,
  overviewText,
}) => {
  const [copiedInfo, setCopiedInfo] = useState(false);
  const [showAllAudio, setShowAllAudio] = useState(false);
  const [showAllSubtitles, setShowAllSubtitles] = useState(false);

  const entity = item.Type === 'Episode' && seriesItem ? seriesItem : item;
  const titleText = entity.Name || item.Name;
  const originalTitle =
    entity.OriginalTitle && entity.OriginalTitle !== titleText ? entity.OriginalTitle : null;
  const tagline = entity.Taglines?.[0]?.trim() || null;
  const premiereDate =
    formatDateYmd(entity.PremiereDate) ||
    (entity.ProductionYear ? String(entity.ProductionYear) : null);
  const dateCreated = formatDateYmd(activePlayableItem?.DateCreated || entity.DateCreated);
  const runtime = formatRuntime(
    activePlayableItem?.RunTimeTicks || activeMediaSource?.RunTimeTicks || entity.RunTimeTicks
  );
  const clockDuration = formatClockDuration(
    activePlayableItem?.RunTimeTicks || activeMediaSource?.RunTimeTicks || entity.RunTimeTicks
  );
  const genres = entity.Genres?.length ? entity.Genres.join(' / ') : null;
  const studios = entity.Studios?.length
    ? entity.Studios.map((s) => s.Name).filter(Boolean).slice(0, 3).join(' · ')
    : null;
  const locations = entity.ProductionLocations?.length
    ? entity.ProductionLocations.slice(0, 3).join(' / ')
    : null;

  const providerTags = useMemo(() => {
    const pids = entity.ProviderIds || item.ProviderIds;
    if (!pids) return null;
    const entries: string[] = [];
    for (const key of ['Tmdb', 'Imdb', 'Tvdb', 'Douban', 'Bangumi']) {
      const val = pids[key] || pids[key.toLowerCase()];
      if (val) entries.push(`${key.toUpperCase()} ${val}`);
    }
    return entries.length > 0 ? entries.join(' · ') : null;
  }, [entity.ProviderIds, item.ProviderIds]);

  const streams = activeMediaSource?.MediaStreams || activePlayableItem?.MediaStreams || [];
  const videoStream = streams.find((s) => s.Type === 'Video');
  const audioStreams = streams.filter((s) => s.Type === 'Audio');
  const subtitleStreams = streams.filter((s) => s.Type === 'Subtitle');
  const sourceMeta = activeMediaSource ? formatMediaSourceMeta(activeMediaSource) : null;

  const videoSpecs = formatVideoSpecs(
    videoStream,
    activeMediaSource,
    sourceMeta?.hdrLabel,
    sourceMeta?.resolutionLabel
  );

  const rawContainer =
    sourceMeta?.containerLabel ||
    activeMediaSource?.Container?.toUpperCase() ||
    (activeMediaSource?.IsRemote ? 'STRM' : null);
  const protocolLabel = activeMediaSource?.Protocol
    ? activeMediaSource.Protocol === 'File'
      ? '本地 / 挂载直读'
      : activeMediaSource.Protocol === 'Http'
      ? 'HTTP 远程流'
      : activeMediaSource.Protocol
    : activeMediaSource?.IsRemote
    ? '远程直链 (STRM)'
    : null;
  const containerAndProtocol =
    [rawContainer, protocolLabel].filter(Boolean).join(' · ') || null;

  const directCapabilities: string[] = [];
  if (activeMediaSource?.SupportsDirectPlay) directCapabilities.push('DirectPlay');
  if (activeMediaSource?.SupportsDirectStream) directCapabilities.push('DirectStream');
  const directCapabilityText =
    directCapabilities.length > 0 ? directCapabilities.join(' / ') : '100% 零转码直出';

  const fileSizeText =
    activeMediaSource?.Size && activeMediaSource.Size > 0
      ? formatFileSize(activeMediaSource.Size)
      : sourceMeta?.sizeLabel || null;

  const versionDisplay = activeMediaSource?.Name
    ? mediaSourcesCount > 1
      ? `${activeMediaSource.Name}（共 ${mediaSourcesCount} 个版本）`
      : activeMediaSource.Name
    : mediaSourcesCount > 1
    ? `共 ${mediaSourcesCount} 个可选版本`
    : null;

  const { fileName, safePath } = redactMediaPath(
    activeMediaSource?.Path || activePlayableItem?.Path || item.Path
  );

  const hasVideoSection = Boolean(
    videoSpecs.streamSummary ||
      videoSpecs.resolutionDisplay ||
      videoSpecs.videoCodecDisplay ||
      videoSpecs.videoBitrateDisplay ||
      videoSpecs.fpsDisplay ||
      videoSpecs.scanDisplay
  );
  const hasColorSection = Boolean(
    videoSpecs.dynamicRangeDisplay ||
      videoSpecs.pixelDisplay ||
      videoSpecs.colorPrimaries ||
      videoSpecs.colorTransfer ||
      videoSpecs.colorSpace ||
      videoSpecs.colorRange
  );
  const hasContainerSection = Boolean(
    containerAndProtocol ||
      fileSizeText ||
      videoSpecs.totalBitrateDisplay ||
      clockDuration ||
      versionDisplay ||
      fileName ||
      safePath
  );

  const handleCopyMediaInfo = async () => {
    const lines: string[] = [`[${titleText}]`];
    const pushIf = (label: string, val?: string | null) => {
      if (val) lines.push(`${label}: ${val}`);
    };
    pushIf('版本名称', versionDisplay);
    pushIf('视频摘要', videoSpecs.streamSummary);
    pushIf('分辨率/画幅', videoSpecs.resolutionDisplay);
    pushIf('视频编码', videoSpecs.videoCodecDisplay);
    pushIf('视频码率', videoSpecs.videoBitrateDisplay);
    pushIf('帧率', videoSpecs.fpsDisplay);
    pushIf('扫描/参考帧', videoSpecs.scanDisplay);
    pushIf('动态范围/HDR', videoSpecs.dynamicRangeDisplay);
    pushIf('色深/像素格式', videoSpecs.pixelDisplay);
    pushIf('色域原色', videoSpecs.colorPrimaries);
    pushIf('传递函数', videoSpecs.colorTransfer);
    pushIf('色彩矩阵', videoSpecs.colorSpace);
    pushIf('色彩范围', videoSpecs.colorRange);
    pushIf('封装与协议', containerAndProtocol);
    pushIf('直出支持', directCapabilityText);
    pushIf('文件大小', fileSizeText);
    pushIf('总码率', videoSpecs.totalBitrateDisplay);
    pushIf('精确时长', clockDuration);
    pushIf('文件名', fileName);
    pushIf('路径', safePath);
    if (audioStreams.length > 0) {
      lines.push(
        `音频 (${audioStreams.length}): ${audioStreams
          .map((a) =>
            [
              a.DisplayTitle || a.Title || a.DisplayLanguage || a.Language || '音轨',
              a.Codec?.toUpperCase(),
              a.ChannelLayout || (a.Channels ? `${a.Channels}ch` : ''),
              formatSampleRate(a.SampleRate),
              formatBitrate(a.BitRate),
            ]
              .filter(Boolean)
              .join(' ')
          )
          .join(' | ')}`
      );
    }
    if (subtitleStreams.length > 0) {
      lines.push(
        `字幕 (${subtitleStreams.length}): ${subtitleStreams
          .map(
            (s) =>
              `${s.DisplayTitle || s.Title || s.DisplayLanguage || s.Language || '字幕'}${
                s.Codec ? ` (${s.Codec.toUpperCase()})` : ''
              }`
          )
          .join(', ')}`
      );
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedInfo(true);
      window.setTimeout(() => setCopiedInfo(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const displayedAudioStreams = showAllAudio ? audioStreams : audioStreams.slice(0, 6);
  const displayedSubtitleStreams = showAllSubtitles
    ? subtitleStreams
    : subtitleStreams.slice(0, 10);

  return (
    <section className="w-full bg-[#F5F5F7] dark:bg-[#141416] border-t border-black/[0.06] dark:border-white/[0.07] mt-12">
      <div className="max-w-[1440px] mx-auto px-8 lg:px-12 py-10 pb-14 space-y-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.015em] text-[#1D1D1F] dark:text-[#F5F5F7]">
            关于本片
          </h2>
          {tagline && (
            <span className="text-xs italic text-[#6E6E73] dark:text-white/55 truncate max-w-md">
              “{tagline}”
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* 卡片 1：影片信息 (3/12) */}
          <div className="lg:col-span-3 rounded-2xl bg-white dark:bg-[#1C1C1E] p-5 ring-1 ring-black/[0.04] dark:ring-white/[0.07] flex flex-col justify-between space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#86868B] dark:text-white/50 mb-3">
                影片信息
              </h3>
              <div>
                <InfoRow label="片名" value={titleText} />
                <InfoRow label="原名" value={originalTitle} />
                <InfoRow label="上映日期" value={premiereDate} mono />
                <InfoRow label="片长" value={runtime} />
                <InfoRow label="内容分级" value={entity.OfficialRating} mono />
                <InfoRow label="类型" value={genres} />
                <InfoRow label="制片 / 出品" value={studios} />
                <InfoRow label="地区" value={locations} />
                <InfoRow label="入库日期" value={dateCreated} mono />
                <InfoRow label="外部编号" value={providerTags} mono />
                <InfoRow label="Emby ID" value={activePlayableItem?.Id || item.Id} mono />
              </div>
            </div>

            {overviewText && (
              <p className="pt-2 border-t border-black/[0.05] dark:border-white/[0.06] text-xs text-[#6E6E73] dark:text-white/60 leading-relaxed line-clamp-4">
                {overviewText}
              </p>
            )}
          </div>

          {/* 卡片 2：画质与封装 (5/12 重点加宽，结构化展示全维度 MediaInfo) */}
          <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#1C1C1E] p-5 ring-1 ring-black/[0.04] dark:ring-white/[0.07] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#86868B] dark:text-white/50">
                画质与封装
              </h3>

              {(hasVideoSection || hasColorSection || hasContainerSection) && (
                <button
                  type="button"
                  onClick={handleCopyMediaInfo}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#F5F5F7] hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-[11px] font-medium text-[#3A3A3C] dark:text-white/85 transition cursor-pointer"
                  title="复制完整媒体技术参数"
                >
                  {copiedInfo ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制信息</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {hasVideoSection || hasColorSection || hasContainerSection ? (
              <div className="space-y-4">
                {hasVideoSection && (
                  <div>
                    <div className="text-[11px] font-medium text-[#6E6E73] dark:text-white/55 mb-1">
                      视频流规格
                    </div>
                    <InfoRow label="流摘要" value={videoSpecs.streamSummary} />
                    <InfoRow label="分辨率与画幅" value={videoSpecs.resolutionDisplay} mono />
                    <InfoRow label="视频编码" value={videoSpecs.videoCodecDisplay} mono />
                    <InfoRow label="视频轨码率" value={videoSpecs.videoBitrateDisplay} mono />
                    <InfoRow label="帧率" value={videoSpecs.fpsDisplay} mono />
                    <InfoRow label="扫描与参考帧" value={videoSpecs.scanDisplay} />
                  </div>
                )}

                {hasColorSection && (
                  <div className="pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                    <div className="text-[11px] font-medium text-[#6E6E73] dark:text-white/55 mb-1">
                      色彩与动态范围
                    </div>
                    <InfoRow label="动态范围 / HDR" value={videoSpecs.dynamicRangeDisplay} />
                    <InfoRow label="色深与像素格式" value={videoSpecs.pixelDisplay} mono />
                    <InfoRow label="色域原色" value={videoSpecs.colorPrimaries} mono />
                    <InfoRow label="传递函数" value={videoSpecs.colorTransfer} mono />
                    <InfoRow label="色彩矩阵" value={videoSpecs.colorSpace} mono />
                    <InfoRow label="色彩范围" value={videoSpecs.colorRange} mono />
                  </div>
                )}

                {hasContainerSection && (
                  <div className="pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                    <div className="text-[11px] font-medium text-[#6E6E73] dark:text-white/55 mb-1">
                      封装与文件源
                    </div>
                    <InfoRow label="封装与协议" value={containerAndProtocol} />
                    <InfoRow label="直出能力" value={directCapabilityText} mono />
                    <InfoRow label="文件体积" value={fileSizeText} mono />
                    <InfoRow label="容器总码率" value={videoSpecs.totalBitrateDisplay} mono />
                    <InfoRow label="精确片长" value={clockDuration} mono />
                    <InfoRow label="当前版本" value={versionDisplay} />
                    <InfoRow label="文件名" value={fileName} mono />
                    <InfoRow label="媒体路径" value={safePath} mono />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#6E6E73] dark:text-white/55 leading-relaxed">
                当前片源将在起播时自动直连并由硬件解码器实时探测视频参数，支持 100% 原画零转码输出。
              </p>
            )}
          </div>

          {/* 卡片 3：音轨与字幕明细 (4/12) */}
          <div className="lg:col-span-4 rounded-2xl bg-white dark:bg-[#1C1C1E] p-5 ring-1 ring-black/[0.04] dark:ring-white/[0.07] space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#86868B] dark:text-white/50">
              音轨与字幕
            </h3>

            {audioStreams.length > 0 || subtitleStreams.length > 0 ? (
              <div className="space-y-4">
                {audioStreams.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[#6E6E73] dark:text-white/55">
                        音频轨道（{audioStreams.length}）
                      </span>
                      {audioStreams.length > 6 && (
                        <button
                          type="button"
                          onClick={() => setShowAllAudio((v) => !v)}
                          className="text-[11px] font-medium text-[#1D1D1F] dark:text-white/80 hover:underline cursor-pointer"
                        >
                          {showAllAudio ? '收起' : `展开全部 (${audioStreams.length})`}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {displayedAudioStreams.map((a) => {
                        const title =
                          a.DisplayTitle || a.Title || a.DisplayLanguage || a.Language || '音轨';
                        const codec = [
                          a.Codec ? a.Codec.toUpperCase() : null,
                          a.Profile || null,
                          a.AudioSpatialFormat || null,
                        ]
                          .filter(Boolean)
                          .join(' ');
                        const ch = a.ChannelLayout || (a.Channels ? `${a.Channels}ch` : '');
                        const sample = formatSampleRate(a.SampleRate);
                        const br = formatBitrate(a.BitRate);
                        const depth = a.BitDepth ? `${a.BitDepth}-bit` : null;
                        const techSpecs = [codec, ch, sample, br, depth].filter(Boolean).join(' · ');

                        return (
                          <div
                            key={`aud-${a.Index}`}
                            className="py-1.5 border-b border-black/[0.04] dark:border-white/[0.05] last:border-b-0 space-y-0.5"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
                                {title}
                              </span>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {a.IsDefault && (
                                  <span className="px-1.5 py-0.2 rounded bg-black/[0.06] dark:bg-white/[0.12] text-[10px] font-medium text-[#3A3A3C] dark:text-white/85">
                                    默认
                                  </span>
                                )}
                                {a.IsForced && (
                                  <span className="px-1.5 py-0.2 rounded bg-black/[0.06] dark:bg-white/[0.12] text-[10px] font-medium text-[#3A3A3C] dark:text-white/85">
                                    强制
                                  </span>
                                )}
                              </div>
                            </div>
                            {techSpecs && (
                              <div className="text-[11px] font-mono text-[#86868B] dark:text-white/50 tabular-nums">
                                {techSpecs}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {subtitleStreams.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[#6E6E73] dark:text-white/55">
                        内封 / 外挂字幕（{subtitleStreams.length}）
                      </span>
                      {subtitleStreams.length > 10 && (
                        <button
                          type="button"
                          onClick={() => setShowAllSubtitles((v) => !v)}
                          className="text-[11px] font-medium text-[#1D1D1F] dark:text-white/80 hover:underline cursor-pointer"
                        >
                          {showAllSubtitles ? '收起' : `展开全部 (${subtitleStreams.length})`}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      {displayedSubtitleStreams.map((sub) => {
                        const label =
                          sub.DisplayTitle ||
                          sub.Title ||
                          sub.DisplayLanguage ||
                          sub.Language ||
                          '字幕';
                        const flags = [
                          sub.Codec ? sub.Codec.toUpperCase() : null,
                          sub.IsExternal ? '外挂' : '内封',
                          sub.IsDefault ? '默认' : null,
                          sub.IsForced ? '强制' : null,
                          sub.IsHearingImpaired ? '听障' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');

                        return (
                          <div
                            key={`sub-${sub.Index}`}
                            className="flex items-center justify-between gap-2 py-1 border-b border-black/[0.04] dark:border-white/[0.05] last:border-b-0 text-xs"
                          >
                            <span
                              className="text-[#1D1D1F] dark:text-[#F5F5F7] truncate"
                              title={label}
                            >
                              {label}
                            </span>
                            <span className="text-[10.5px] font-mono text-[#86868B] dark:text-white/50 flex-shrink-0">
                              {flags}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#6E6E73] dark:text-white/55 leading-relaxed">
                起播时将自动由播放器解析音轨与内封字幕，支持拖放外挂 `.srt / .ass / .vtt` 字幕及全网弹幕自动匹配。
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default DetailAboutSection;
