import { httpClient } from './http';

export interface EmbyServerInfo {
  ServerName?: string;
  Version?: string;
  Id?: string;
  LocalAddress?: string;
  WanAddress?: string;
}

export interface EmbyUser {
  Id: string;
  Name: string;
  ServerId?: string;
  HasPassword?: boolean;
}

export interface EmbyAuthResponse {
  User: EmbyUser;
  AccessToken: string;
  ServerId: string;
  SessionInfo?: any;
}

export interface EmbyMediaStream {
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  DisplayLanguage?: string;
  Type: 'Audio' | 'Video' | 'Subtitle';
  Index: number;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  DeliveryUrl?: string;
  ChannelLayout?: string;
  BitRate?: number;
}

export interface EmbyMediaSource {
  Id: string;
  Container?: string;
  Path?: string;
  Name?: string;
  Size?: number;
  Bitrate?: number;
  IsRemote?: boolean;
  MediaStreams?: EmbyMediaStream[];
}

export interface EmbyItem {
  Id: string;
  Name: string;
  Type: string;
  CollectionType?: string;
  Overview?: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number; // 集数
  ParentIndexNumber?: number; // 季数
  PremiereDate?: string;
  ProductionYear?: number;
  RunTimeTicks?: number;
  PrimaryImageAspectRatio?: number;
  ImageTags?: {
    Primary?: string;
    Backdrop?: string;
    Thumb?: string;
    Banner?: string;
  };
  BackdropImageTags?: string[];
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayCount?: number;
    IsFavorite?: boolean;
    Played?: boolean;
    LastPlayedDate?: string;
    Key?: string;
  };
  MediaType?: string;
  SeriesPrimaryImageTag?: string;
  SeriesThumbImageTag?: string;
  ParentThumbImageTag?: string;
  MediaSources?: EmbyMediaSource[];
}

/**
 * 校验条目是否属于视听影视媒体（电影、剧集分集），坚决排除纯音频、音乐、播客、照片
 */
export function isVideoMedia(item: EmbyItem): boolean {
  if (!item || !item.Type) return false;
  const bannedTypes = [
    'Audio',
    'MusicAlbum',
    'MusicArtist',
    'MusicVideo',
    'AudioBook',
    'Photo',
    'PhotoAlbum',
    'Playlist',
    'Book',
  ];
  if (bannedTypes.includes(item.Type)) return false;
  if (item.MediaType === 'Audio' || item.MediaType === 'Photo' || item.MediaType === 'Book') {
    return false;
  }
  return (
    item.Type === 'Movie' ||
    item.Type === 'Episode' ||
    item.Type === 'Series' ||
    item.MediaType === 'Video'
  );
}

export interface EmbyPlaybackInfoResponse {
  PlaySessionId: string;
  MediaSources: EmbyMediaSource[];
}

export interface MappedTrack {
  id: string; // 唯一标示
  type: 'audio' | 'subtitle';
  mpvId: number | string; // mpv 的 aid 或 sid 或 external url
  title: string;
  language?: string;
  codec?: string;
  isExternal: boolean;
  isDefault: boolean;
  originalIndex: number;
}

/**
 * 构造标准 Emby 认证请求头
 */
export function buildEmbyHeaders(userId?: string, accessToken?: string): Record<string, string> {
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('emby_device_id') || '';
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('emby_device_id', deviceId);
    }
  } catch {
    deviceId = 'desktop-default-id';
  }

  const authParts = [
    'Client="EmbyTauriPlayer"',
    'Device="Desktop"',
    `DeviceId="${deviceId}"`,
    'Version="0.1.0"',
  ];

  if (userId) authParts.push(`UserId="${userId}"`);
  if (accessToken) authParts.push(`Token="${accessToken}"`);

  return {
    'Content-Type': 'application/json',
    'X-Emby-Authorization': `Emby ${authParts.join(', ')}`,
  };
}

/**
 * 格式化清理服务器地址
 */
export function normalizeServerUrl(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `http://${clean}`;
  }
  return clean;
}

/**
 * 测试 Emby 服务器连通性 (GET /emby/System/Info/Public)
 */
export async function testServerConnection(serverUrl: string): Promise<EmbyServerInfo> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/System/Info/Public`, {
    method: 'GET',
    headers: buildEmbyHeaders(),
  });
  if (!res.ok) {
    throw new Error(`连接失败，状态码: ${res.status}`);
  }
  return res.json();
}

/**
 * 用户账号密码登录 (POST /emby/Users/AuthenticateByName)
 */
export async function authenticateByName(
  serverUrl: string,
  username: string,
  password?: string
): Promise<EmbyAuthResponse> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/Users/AuthenticateByName`, {
    method: 'POST',
    headers: buildEmbyHeaders(),
    body: JSON.stringify({
      Username: username.trim(),
      Pw: password || '',
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`登录失败: ${errorText || res.statusText}`);
  }
  return res.json();
}

/**
 * 获取媒体库分类列表 (GET /emby/Users/{UserId}/Views)
 */
export async function getUserViews(
  serverUrl: string,
  userId: string,
  accessToken: string
): Promise<{ Items: EmbyItem[]; TotalRecordCount: number }> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/Users/${userId}/Views`, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken),
  });
  if (!res.ok) throw new Error(`获取媒体库分类失败: ${res.status}`);
  return res.json();
}

/**
 * 获取继续观看列表 (GET /emby/Users/{UserId}/Items/Resume)
 * 支持双重降级兜底，兼容所有 Emby 服务器版本
 */
const PLAYBACK_MEDIA_FIELDS =
  'PrimaryImageAspectRatio,BasicSyncInfo,MediaSources,Path,Overview,UserData,SeriesPrimaryImageTag,SeriesThumbImageTag,ParentThumbImageTag,ImageTags,BackdropImageTags,SeriesInfo';

/**
 * 获取继续观看列表 (GET /emby/Users/{UserId}/Items/Resume)
 * 支持双重降级兜底，兼容所有 Emby 服务器版本，限定 MediaTypes=Video 彻底杜绝音乐
 */
export async function getResumeItems(
  serverUrl: string,
  userId: string,
  accessToken: string,
  limit = 24
): Promise<{ Items: EmbyItem[] }> {
  const base = normalizeServerUrl(serverUrl);
  // 1. 标准 Resume 接口
  try {
    const url = `${base}/emby/Users/${userId}/Items/Resume?MediaTypes=Video&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.Items) && data.Items.length > 0) {
        return {
          Items: data.Items.filter(isVideoMedia),
        };
      }
    }
  } catch (e) {
    console.warn('[getResumeItems endpoint error, falling back]', e);
  }

  // 2. 通用 IsResumable 降级查询
  try {
    const fallbackUrl = `${base}/emby/Users/${userId}/Items?Recursive=true&MediaTypes=Video&IncludeItemTypes=Movie,Episode&IsResumable=true&SortBy=DatePlayed&SortOrder=Descending&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(fallbackUrl, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.Items)) {
        return {
          Items: data.Items.filter(isVideoMedia),
        };
      }
    }
  } catch (e) {
    console.warn('[getResumeItems fallback error]', e);
  }

  return { Items: [] };
}

/**
 * 获取最近播放过的影片和剧集 (GET /emby/Users/{UserId}/Items)
 * 按 DatePlayed 降序排列，严格限定 MediaTypes=Video 且排除任何音乐，并携带 SeriesPrimaryImageTag
 */
export async function getRecentlyPlayedItems(
  serverUrl: string,
  userId: string,
  accessToken: string,
  limit = 30
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  try {
    const url = `${base}/emby/Users/${userId}/Items?Recursive=true&MediaTypes=Video&IncludeItemTypes=Movie,Episode&SortBy=DatePlayed&SortOrder=Descending&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken),
    });
    if (res.ok) {
      const data = await res.json();
      const rawList: EmbyItem[] = data.Items || [];
      // 客户端严格二次过滤：非音乐/音频，且具备播放记录
      return rawList.filter((item) => {
        if (!isVideoMedia(item)) return false;
        const ud = item.UserData;
        if (!ud) return false;
        return (
          !!ud.LastPlayedDate ||
          !!ud.Played ||
          (ud.PlayCount !== undefined && ud.PlayCount > 0) ||
          (ud.PlaybackPositionTicks !== undefined && ud.PlaybackPositionTicks > 0)
        );
      });
    }
  } catch (e) {
    console.warn('[getRecentlyPlayedItems error]', e);
  }
  return [];
}

/**
 * 获取剧集待播下一集 (GET /emby/Shows/NextUp)
 * 当看完了某一集时，Emby 会自动计算下一集在此推荐
 */
export async function getNextUpEpisodes(
  serverUrl: string,
  userId: string,
  accessToken: string,
  limit = 16
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  try {
    const url = `${base}/emby/Shows/NextUp?UserId=${userId}&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken),
    });
    if (res.ok) {
      const data = await res.json();
      const items: EmbyItem[] = data.Items || [];
      return items.filter(isVideoMedia);
    }
  } catch (e) {
    console.warn('[getNextUpEpisodes error]', e);
  }
  return [];
}

/**
 * 按照相同媒体合并（按 SeriesId 或 SeriesName 聚合电视剧）：
 * 保证同一部剧集只展示最近进度的一张卡片，避免同一部剧的多集刷屏
 */
export function mergeMediaBySeries(items: EmbyItem[]): EmbyItem[] {
  const seenKeys = new Set<string>();
  const merged: EmbyItem[] = [];

  for (const item of items) {
    // 电视剧以 SeriesId 或 SeriesName 为聚合 key，电影或其它以 Id 为 key
    const key =
      item.Type === 'Episode'
        ? (item.SeriesId || item.SeriesName || item.Id)
        : item.Id;

    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(item);
    }
  }

  return merged;
}

/**
 * 获取某分类最新入库内容 (GET /emby/Users/{UserId}/Items/Latest)
 */
export async function getLatestItems(
  serverUrl: string,
  userId: string,
  parentId: string,
  accessToken: string,
  limit = 16
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Users/${userId}/Items/Latest?ParentId=${parentId}&Limit=${limit}&Fields=PrimaryImageAspectRatio,BasicSyncInfo,Overview`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken),
  });
  if (!res.ok) throw new Error(`获取最新入库失败: ${res.status}`);
  return res.json();
}

/**
 * 获取指定媒体条目详情 (GET /emby/Users/{UserId}/Items/{ItemId})
 */
export async function getItemDetail(
  serverUrl: string,
  userId: string,
  itemId: string,
  accessToken: string
): Promise<EmbyItem> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Users/${userId}/Items/${itemId}?Fields=Overview,MediaSources,Path,People,Genres`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken),
  });
  if (!res.ok) throw new Error(`获取条目详情失败: ${res.status}`);
  return res.json();
}

/**
 * 获取剧集的季与分集列表 (GET /emby/Shows/{SeriesId}/Episodes)
 */
export async function getSeriesEpisodes(
  serverUrl: string,
  userId: string,
  seriesId: string,
  seasonId: string,
  accessToken: string
): Promise<{ Items: EmbyItem[] }> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Shows/${seriesId}/Episodes?SeasonId=${seasonId}&UserId=${userId}&Fields=Overview,MediaSources,Path,PrimaryImageAspectRatio`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken),
  });
  if (!res.ok) throw new Error(`获取分集列表失败: ${res.status}`);
  return res.json();
}

/**
 * 获取剧集的所有季 (GET /emby/Shows/{SeriesId}/Seasons)
 */
export async function getSeriesSeasons(
  serverUrl: string,
  userId: string,
  seriesId: string,
  accessToken: string
): Promise<{ Items: EmbyItem[] }> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Shows/${seriesId}/Seasons?UserId=${userId}&Fields=Overview,PrimaryImageAspectRatio`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken),
  });
  if (!res.ok) throw new Error(`获取季列表失败: ${res.status}`);
  return res.json();
}

/**
 * 起播前拉取 PlaybackInfo 并获取 DirectPlay 流信息
 * (POST /emby/Items/{ItemId}/PlaybackInfo?UserId={UserId})
 */
export async function getPlaybackInfo(
  serverUrl: string,
  userId: string,
  itemId: string,
  accessToken: string
): Promise<EmbyPlaybackInfoResponse> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Items/${itemId}/PlaybackInfo?UserId=${userId}`;
  const res = await httpClient(url, {
    method: 'POST',
    headers: buildEmbyHeaders(userId, accessToken),
    body: JSON.stringify({
      DeviceProfile: {
        MaxStreamingBitrate: 200000000,
        DirectPlayProfiles: [
          {
            Container: 'mkv,mp4,avi,mov,ts,m2ts,webm,flv,iso,wmv',
            Type: 'Video',
          },
        ],
      },
      EnableDirectPlay: true,
      EnableDirectStream: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
    }),
  });
  if (!res.ok) throw new Error(`获取播放流信息失败: ${res.status}`);
  return res.json();
}

/**
 * 生成直连或兼容播放流地址
 * 对于浏览器/WebView2无法直接硬解的 MKV/TS 等格式，自动请求 Emby 轻量 DirectStream remux，杜绝黑屏
 */
export function buildDirectStreamUrl(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string,
  forceCompatible = false
): string {
  const base = normalizeServerUrl(serverUrl);
  if (mediaSource.IsRemote && mediaSource.Path && mediaSource.Path.startsWith('http')) {
    return mediaSource.Path;
  }
  const rawContainer = (mediaSource.Container || 'mkv').toLowerCase();
  const isChromiumUnsupported = ['mkv', 'avi', 'flv', 'ts', 'm2ts', 'wmv'].includes(rawContainer);

  if (forceCompatible || isChromiumUnsupported) {
    return `${base}/emby/Videos/${itemId}/stream.mp4?MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}&X-Emby-Token=${accessToken}&VideoCodec=copy&AudioCodec=aac&TranscodingMaxAudioChannels=2`;
  }

  return `${base}/emby/Videos/${itemId}/stream.${rawContainer}?static=true&MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}&X-Emby-Token=${accessToken}`;
}

/**
 * 通用兼容转码流 (H.264 + AAC)，保证在任何缺失 HEVC 硬件扩展的 Windows 设备上 100% 可播放
 */
export function buildTranscodeStreamUrl(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string
): string {
  const base = normalizeServerUrl(serverUrl);
  return `${base}/emby/Videos/${itemId}/stream.mp4?MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}&X-Emby-Token=${accessToken}&VideoCodec=h264&AudioCodec=aac&TranscodingMaxAudioChannels=2&MaxStreamingBitrate=20000000`;
}

/**
 * 构造海报封面图片 URL (自动添加 webp 与尺寸优化)
 */
export function buildItemImageUrl(
  serverUrl: string,
  itemId: string,
  imageTag?: string,
  options: {
    type?: 'Primary' | 'Backdrop' | 'Thumb';
    maxWidth?: number;
    quality?: number;
  } = {}
): string {
  const base = normalizeServerUrl(serverUrl);
  const type = options.type || 'Primary';
  const maxWidth = options.maxWidth || (type === 'Backdrop' ? 1920 : 400);
  const quality = options.quality || 85;
  const tagParam = imageTag ? `&tag=${imageTag}` : '';
  const indexSegment = type === 'Backdrop' ? '/0' : '';

  return `${base}/emby/Items/${itemId}/Images/${type}${indexSegment}?maxWidth=${maxWidth}&quality=${quality}&format=webp${tagParam}`;
}

/**
 * 构造外挂字幕下载/挂载 URL
 */
export function buildExternalSubtitleUrl(
  serverUrl: string,
  itemId: string,
  mediaSourceId: string,
  streamIndex: number,
  codec = 'ass',
  accessToken: string
): string {
  const base = normalizeServerUrl(serverUrl);
  return `${base}/emby/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/Stream.${codec}?api_key=${accessToken}`;
}

/**
 * 音轨与字幕轨映射算法 (关键避坑点 6)
 * Emby 的 MediaStream.Index 是全局索引，而 libmpv 的 aid/sid 分别从 1 开始独立自增
 */
export function mapStreamTracks(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  accessToken: string
): {
  audioTracks: MappedTrack[];
  subtitleTracks: MappedTrack[];
} {
  const audioTracks: MappedTrack[] = [];
  const subtitleTracks: MappedTrack[] = [];

  const streams = mediaSource.MediaStreams || [];

  let audioCounter = 1;
  let internalSubCounter = 1;

  for (const stream of streams) {
    if (stream.Type === 'Audio') {
      audioTracks.push({
        id: `audio-${stream.Index}`,
        type: 'audio',
        mpvId: audioCounter++, // 对应 mpv 的 aid
        title: stream.DisplayTitle || stream.Language || `音轨 ${audioCounter - 1}`,
        language: stream.Language || stream.DisplayLanguage,
        codec: stream.Codec,
        isExternal: false,
        isDefault: !!stream.IsDefault,
        originalIndex: stream.Index,
      });
    } else if (stream.Type === 'Subtitle') {
      if (stream.IsExternal) {
        // 外挂字幕：构建 URL 用于 mpv sub-add
        const subUrl = buildExternalSubtitleUrl(
          serverUrl,
          itemId,
          mediaSource.Id,
          stream.Index,
          stream.Codec || 'ass',
          accessToken
        );
        subtitleTracks.push({
          id: `sub-${stream.Index}`,
          type: 'subtitle',
          mpvId: subUrl,
          title: stream.DisplayTitle || `外挂字幕 (${stream.Language || '未知'})`,
          language: stream.Language || stream.DisplayLanguage,
          codec: stream.Codec,
          isExternal: true,
          isDefault: !!stream.IsDefault,
          originalIndex: stream.Index,
        });
      } else {
        // 内封字幕：对应 mpv 的 sid
        subtitleTracks.push({
          id: `sub-${stream.Index}`,
          type: 'subtitle',
          mpvId: internalSubCounter++,
          title: stream.DisplayTitle || stream.Language || `内封字幕 ${internalSubCounter - 1}`,
          language: stream.Language || stream.DisplayLanguage,
          codec: stream.Codec,
          isExternal: false,
          isDefault: !!stream.IsDefault,
          originalIndex: stream.Index,
        });
      }
    }
  }

  return { audioTracks, subtitleTracks };
}

/**
 * 毫秒/秒转换为 Emby 严格整数 Ticks (1 秒 = 10,000,000 Ticks)
 * 关键避坑点 7：严禁传入浮点数
 */
export function secondsToTicks(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 10_000_000);
}

export function ticksToSeconds(ticks: number): number {
  return (ticks || 0) / 10_000_000;
}

/**
 * 播放开始上报 (POST /emby/Sessions/Playing)
 */
export async function reportPlaybackStart(
  serverUrl: string,
  params: {
    itemId: string;
    mediaSourceId: string;
    playSessionId: string;
    seconds: number;
  },
  accessToken: string
) {
  const base = normalizeServerUrl(serverUrl);
  return httpClient(`${base}/emby/Sessions/Playing`, {
    method: 'POST',
    headers: buildEmbyHeaders(undefined, accessToken),
    body: JSON.stringify({
      ItemId: params.itemId,
      MediaSourceId: params.mediaSourceId,
      PlaySessionId: params.playSessionId,
      PositionTicks: secondsToTicks(params.seconds),
    }),
  });
}

/**
 * 播放进度心跳与事件上报 (POST /emby/Sessions/Playing/Progress)
 * 播放中每 10 秒、暂停、恢复、Seek 时调用
 */
export async function reportPlaybackProgress(
  serverUrl: string,
  params: {
    itemId: string;
    mediaSourceId: string;
    playSessionId: string;
    seconds: number;
    isPaused: boolean;
    eventName?: 'TimeUpdate' | 'Pause' | 'Unpause' | 'Seek';
  },
  accessToken: string
) {
  const base = normalizeServerUrl(serverUrl);
  return httpClient(`${base}/emby/Sessions/Playing/Progress`, {
    method: 'POST',
    headers: buildEmbyHeaders(undefined, accessToken),
    body: JSON.stringify({
      ItemId: params.itemId,
      MediaSourceId: params.mediaSourceId,
      PlaySessionId: params.playSessionId,
      PositionTicks: secondsToTicks(params.seconds),
      IsPaused: params.isPaused,
      EventName: params.eventName || 'TimeUpdate',
    }),
  });
}

/**
 * 播放停止上报 (POST /emby/Sessions/Playing/Stopped)
 * 切集或关闭播放页前必调，确保 Emby 控制台与继续观看同步刷新
 */
export async function reportPlaybackStopped(
  serverUrl: string,
  params: {
    itemId: string;
    mediaSourceId: string;
    playSessionId: string;
    seconds: number;
  },
  accessToken: string
) {
  const base = normalizeServerUrl(serverUrl);
  return httpClient(`${base}/emby/Sessions/Playing/Stopped`, {
    method: 'POST',
    headers: buildEmbyHeaders(undefined, accessToken),
    body: JSON.stringify({
      ItemId: params.itemId,
      MediaSourceId: params.mediaSourceId,
      PlaySessionId: params.playSessionId,
      PositionTicks: secondsToTicks(params.seconds),
    }),
  });
}
