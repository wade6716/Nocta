import {
  EmbyItem,
  EmbyMediaSource,
  MappedTrack,
  buildDirectStreamUrl,
  buildNativeDirectStreamUrl,
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
 */
export async function fetchAndPreparePlaybackSession(
  server: PlaybackServerTarget,
  targetItemId: string,
  engineType: 'mpv' | 'html5',
  existingDetail?: EmbyItem
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

  const mediaSource = pbInfo.MediaSources?.[0];
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
    availableMediaSources: pbInfo.MediaSources,
    playSessionId: pbInfo.PlaySessionId,
    streamUrl,
    audioTracks,
    subtitleTracks,
    initialTime,
  };
}
