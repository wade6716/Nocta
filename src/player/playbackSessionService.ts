import {
  EmbyItem,
  EmbyMediaSource,
  MappedTrack,
  buildDirectStreamUrl,
  buildNativeDirectStreamUrl,
  formatFileSize,
  getItemDetail,
  getPlaybackInfo,
  mapStreamTracks,
  ticksToSeconds,
} from '../api/embyClient';
import { isTauriEnvironment } from '../api/http';

export interface PlaybackServerTarget {
  url: string;
  userId: string;
  accessToken: string;
}

export interface MediaSourceQualityScore {
  resolutionTier: number;
  pixelArea: number;
  dynamicRangeRank: number;
  bitrate: number;
  size: number;
}

export interface MediaSourceMeta {
  resolutionLabel?: string;
  hdrLabel?: string;
  containerLabel: string;
  sizeLabel?: string;
}

export interface PreparedPlaybackSession {
  item: EmbyItem;
  mediaSource: EmbyMediaSource;
  availableMediaSources: EmbyMediaSource[];
  playSessionId: string;
  streamUrl: string;
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
  initialTime: number;
}

/**
 * 提取单个媒体源的画质权重，用于在多版本时自动优先挑选高分辨率/高规格片源。
 */
export function getMediaSourceQualityScore(ms: EmbyMediaSource): MediaSourceQualityScore {
  const vStream = ms.MediaStreams?.find((s) => s.Type === 'Video');
  const width = vStream?.Width && vStream.Width > 0 ? vStream.Width : 0;
  const height = vStream?.Height && vStream.Height > 0 ? vStream.Height : 0;

  let resolutionTier = 0;
  if (width > 0 || height > 0) {
    if (width >= 7000 || height >= 4000) {
      resolutionTier = 4320;
    } else if (width >= 3600 || height >= 2000) {
      resolutionTier = 2160;
    } else if (width >= 2400 || height >= 1350) {
      resolutionTier = 1440;
    } else if (width >= 1800 || height >= 950) {
      resolutionTier = 1080;
    } else if (width >= 1200 || height >= 650) {
      resolutionTier = 720;
    } else {
      resolutionTier = Math.max(height, Math.round((width * 9) / 16));
    }
  } else {
    const labelText = `${ms.Name || ''} ${ms.Path || ''}`;
    if (/(?:^|[^a-z0-9])(?:8k|4320p)(?:[^a-z0-9]|$)/i.test(labelText)) {
      resolutionTier = 4320;
    } else if (/(?:^|[^a-z0-9])(?:4k|2160p|uhd)(?:[^a-z0-9]|$)/i.test(labelText)) {
      resolutionTier = 2160;
    } else if (/(?:^|[^a-z0-9])(?:2k|1440p|qhd)(?:[^a-z0-9]|$)/i.test(labelText)) {
      resolutionTier = 1440;
    } else if (/(?:^|[^a-z0-9])(?:1080p|1080i|fhd)(?:[^a-z0-9]|$)/i.test(labelText)) {
      resolutionTier = 1080;
    } else if (/(?:^|[^a-z0-9])(?:720p)(?:[^a-z0-9]|$)/i.test(labelText)) {
      resolutionTier = 720;
    } else if (/(?:^|[^a-z0-9])(?:576p|480p)(?:[^a-z0-9]|$)/i.test(labelText)) {
      resolutionTier = 480;
    }
  }

  const pixelArea = width > 0 && height > 0 ? width * height : 0;

  const rangeText = `${vStream?.VideoRange || ''} ${vStream?.ColorTransfer || ''} ${
    vStream?.DisplayTitle || ''
  } ${ms.Name || ''}`;
  let dynamicRangeRank = 0;
  if (/(?:dolby\s*vision|dovi|\bdv\b)/i.test(rangeText)) {
    dynamicRangeRank = 3;
  } else if (/(?:hdr10\+|hdr10|\bhdr\b|\bhlg\b|smpte2084|arib-std-b67)/i.test(rangeText)) {
    dynamicRangeRank = 2;
  } else if ((vStream?.BitDepth ?? 0) >= 10) {
    dynamicRangeRank = 1;
  }

  const bitrate =
    ms.Bitrate && ms.Bitrate > 0
      ? ms.Bitrate
      : vStream?.BitRate && vStream.BitRate > 0
      ? vStream.BitRate
      : 0;
  const size = ms.Size && ms.Size > 0 ? ms.Size : 0;

  return {
    resolutionTier,
    pixelArea,
    dynamicRangeRank,
    bitrate,
    size,
  };
}

/**
 * 将 Emby 多版本片源按清晰度与综合规格从高到低排序（完全相同时保持原序）。
 */
export function sortMediaSourcesByQuality(sources: EmbyMediaSource[]): EmbyMediaSource[] {
  if (!sources || sources.length <= 1) return sources ? [...sources] : [];

  return sources
    .map((source, index) => ({
      source,
      index,
      score: getMediaSourceQualityScore(source),
    }))
    .sort((a, b) => {
      if (b.score.resolutionTier !== a.score.resolutionTier) {
        return b.score.resolutionTier - a.score.resolutionTier;
      }
      if (b.score.pixelArea !== a.score.pixelArea) {
        return b.score.pixelArea - a.score.pixelArea;
      }
      if (b.score.dynamicRangeRank !== a.score.dynamicRangeRank) {
        return b.score.dynamicRangeRank - a.score.dynamicRangeRank;
      }
      if (b.score.bitrate !== a.score.bitrate) {
        return b.score.bitrate - a.score.bitrate;
      }
      if (b.score.size !== a.score.size) {
        return b.score.size - a.score.size;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.source);
}

/**
 * 在多版本中选择指定版本；未指定或不存在时自动选中清晰度最高版本。
 */
export function selectBestMediaSource(
  sources: EmbyMediaSource[],
  preferredMediaSourceId?: string
): EmbyMediaSource | undefined {
  const sorted = sortMediaSourcesByQuality(sources);
  if (sorted.length === 0) return undefined;
  if (preferredMediaSourceId) {
    const preferred = sorted.find((s) => s.Id === preferredMediaSourceId);
    if (preferred) return preferred;
  }
  return sorted[0];
}

/**
 * 格式化多版本片源展示标签（分辨率、HDR/DV、封装容器、文件体积）。
 */
export function formatMediaSourceMeta(ms: EmbyMediaSource): MediaSourceMeta {
  const vStream = ms.MediaStreams?.find((s) => s.Type === 'Video');
  const { resolutionTier, dynamicRangeRank } = getMediaSourceQualityScore(ms);

  let resolutionLabel: string | undefined;
  if (resolutionTier >= 4320) {
    resolutionLabel = '8K';
  } else if (resolutionTier >= 2160) {
    resolutionLabel = '4K';
  } else if (resolutionTier >= 1440) {
    resolutionLabel = '2K';
  } else if (resolutionTier >= 1080) {
    resolutionLabel = '1080p';
  } else if (resolutionTier >= 720) {
    resolutionLabel = '720p';
  } else if (resolutionTier >= 480) {
    resolutionLabel = '480p';
  } else if (vStream?.Height && vStream.Height > 0) {
    resolutionLabel = `${vStream.Height}p`;
  }

  const hdrLabel =
    dynamicRangeRank === 3 ? 'DV' : dynamicRangeRank === 2 ? 'HDR' : undefined;

  return {
    resolutionLabel,
    hdrLabel,
    containerLabel: (ms.Container || 'MKV').toUpperCase(),
    sizeLabel: formatFileSize(ms.Size) || undefined,
  };
}

/**
 * 根据当前播放器引擎与运行环境构建零转码原画直连地址。
 */
export function buildStreamUrlForEngine(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string,
  engineType: 'mpv' | 'html5'
): string {
  return engineType === 'mpv' && isTauriEnvironment()
    ? buildNativeDirectStreamUrl(serverUrl, itemId, mediaSource, playSessionId, accessToken)
    : buildDirectStreamUrl(serverUrl, itemId, mediaSource, playSessionId, accessToken);
}

/**
 * 统一拉取 Emby 条目详情与 PlaybackInfo，装配直连地址、音字幕轨道及初始播放秒数。
 * 默认按清晰度与画质规格从高到低排序，并自动选中最高画质版本（支持传入 preferredMediaSourceId 覆盖）。
 */
export async function fetchAndPreparePlaybackSession(
  server: PlaybackServerTarget,
  targetItemId: string,
  engineType: 'mpv' | 'html5',
  existingDetail?: EmbyItem,
  preferredMediaSourceId?: string
): Promise<PreparedPlaybackSession> {
  const [detail, pbInfo] = existingDetail
    ? [
        existingDetail,
        await getPlaybackInfo(server.url, server.userId, targetItemId, server.accessToken),
      ]
    : await Promise.all([
        getItemDetail(server.url, server.userId, targetItemId, server.accessToken),
        getPlaybackInfo(server.url, server.userId, targetItemId, server.accessToken),
      ]);

  const sortedSources = sortMediaSourcesByQuality(pbInfo.MediaSources || []);
  const mediaSource = preferredMediaSourceId
    ? sortedSources.find((s) => s.Id === preferredMediaSourceId) ?? sortedSources[0]
    : sortedSources[0];
  if (!mediaSource) {
    throw new Error('未检测到可用的媒体源 (MediaSource)');
  }

  const streamUrl = buildStreamUrlForEngine(
    server.url,
    detail.Id,
    mediaSource,
    pbInfo.PlaySessionId,
    server.accessToken,
    engineType
  );

  const { audioTracks, subtitleTracks } = mapStreamTracks(
    server.url,
    detail.Id,
    mediaSource,
    server.accessToken
  );

  const initialTime = ticksToSeconds(detail.UserData?.PlaybackPositionTicks || 0);

  return {
    item: detail,
    mediaSource,
    availableMediaSources: sortedSources,
    playSessionId: pbInfo.PlaySessionId,
    streamUrl,
    audioTracks,
    subtitleTracks,
    initialTime,
  };
}
