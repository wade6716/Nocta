import { httpClient, ProxyConfig } from './http';

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
  Width?: number;
  Height?: number;
  AspectRatio?: string;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  Profile?: string;
  Level?: number;
  BitDepth?: number;
  ColorSpace?: string;
  ColorRange?: string;
  ColorPrimaries?: string;
  ColorTransfer?: string;
  PixelFormat?: string;
  VideoRange?: string;
  Channels?: number;
  SampleRate?: number;
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
  LibraryName?: string;
  LibraryId?: string;
  ServerId?: string;
  ServerName?: string;
  ServerUrl?: string;
  ChildCount?: number;
  RecursiveItemCount?: number;
  Status?: string;
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

/**
 * 格式化剧集总集数 / 媒体文件数角标
 * 规则：
 * 1. 电视剧 (Series)：
 *    - 优先使用 RecursiveItemCount（递归包含的总集数/媒体文件数）
 *    - 连载中 (Status === 'Continuing') -> "更新至 X 集"
 *    - 已完结 (Status === 'Ended') -> "全 X 集"
 *    - 其它状态 -> "共 X 集"
 *    - 若无 RecursiveItemCount 但有 ChildCount 且 > 0 -> "共 X 季"
 * 2. 剧集单集 (Episode)：
 *    - 若有 IndexNumber -> "第 X 集"
 * 3. 其他非剧集内容 (Movie 等) -> null
 */
export function formatSeriesEpisodeBadge(item: EmbyItem): string | null {
  if (!item) return null;

  if (item.Type === 'Series') {
    const episodeCount =
      typeof item.RecursiveItemCount === 'number' && item.RecursiveItemCount > 0
        ? item.RecursiveItemCount
        : undefined;

    if (episodeCount !== undefined) {
      const status = (item.Status || '').toLowerCase();
      if (status === 'continuing') {
        return `更新至 ${episodeCount} 集`;
      }
      if (status === 'ended') {
        return `全 ${episodeCount} 集`;
      }
      return `共 ${episodeCount} 集`;
    }

    if (typeof item.ChildCount === 'number' && item.ChildCount > 0) {
      return `共 ${item.ChildCount} 季`;
    }

    return null;
  }

  if (item.Type === 'Episode') {
    if (typeof item.IndexNumber === 'number') {
      return `第 ${item.IndexNumber} 集`;
    }
  }

  return null;
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
export async function testServerConnection(
  serverUrl: string,
  options?: { proxy?: ProxyConfig }
): Promise<EmbyServerInfo> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/System/Info/Public`, {
    method: 'GET',
    headers: buildEmbyHeaders(),
    proxy: options?.proxy,
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
  password?: string,
  options?: { proxy?: ProxyConfig }
): Promise<EmbyAuthResponse> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/Users/AuthenticateByName`, {
    method: 'POST',
    headers: buildEmbyHeaders(),
    body: JSON.stringify({
      Username: username.trim(),
      Pw: password || '',
    }),
    proxy: options?.proxy,
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
  'PrimaryImageAspectRatio,BasicSyncInfo,MediaSources,Path,Overview,UserData,SeriesPrimaryImageTag,SeriesThumbImageTag,ParentThumbImageTag,ImageTags,BackdropImageTags,SeriesInfo,ChildCount,RecursiveItemCount,Status';

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
  const url = `${base}/emby/Users/${userId}/Items/Latest?ParentId=${parentId}&Limit=${limit}&Fields=PrimaryImageAspectRatio,BasicSyncInfo,Overview,ChildCount,RecursiveItemCount,Status`;
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
  const rawContainer = (mediaSource.Container || 'mkv').toLowerCase().split(',')[0].trim();
  const normalizedContainer = rawContainer === 'matroska' ? 'mkv' : rawContainer || 'mkv';
  const isChromiumUnsupported = ['mkv', 'avi', 'flv', 'ts', 'm2ts', 'wmv'].includes(normalizedContainer);

  if (forceCompatible || isChromiumUnsupported) {
    return `${base}/emby/Videos/${itemId}/stream.mp4?MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}&X-Emby-Token=${accessToken}&VideoCodec=copy&AudioCodec=aac&TranscodingMaxAudioChannels=2`;
  }

  return `${base}/emby/Videos/${itemId}/stream.${normalizedContainer}?static=true&MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}&X-Emby-Token=${accessToken}`;
}

/**
 * 生成原生硬解播放器 (libmpv) 直连流地址
 * 100% 原始容器直出 (static=true)，无任何服务端重封装与音频转码，保留 DTS/TrueHD/Atmos 多声道与全画质
 */
export function buildNativeDirectStreamUrl(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string
): string {
  const base = normalizeServerUrl(serverUrl);
  if (mediaSource.IsRemote && mediaSource.Path && mediaSource.Path.startsWith('http')) {
    return mediaSource.Path;
  }
  const rawContainer = (mediaSource.Container || 'mkv').toLowerCase().split(',')[0].trim();
  const normalizedContainer = rawContainer === 'matroska' ? 'mkv' : rawContainer || 'mkv';
  return `${base}/emby/Videos/${itemId}/stream.${normalizedContainer}?static=true&MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}&X-Emby-Token=${accessToken}`;
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

export interface ViewCounts {
  movieCount?: number;
  seriesCount?: number;
  episodeCount?: number;
}

/**
 * 获取指定媒体库分类下的电影与剧集统计数量 (Limit=0 仅查询 TotalRecordCount，极低开销)
 */
export async function getViewItemCounts(
  serverUrl: string,
  userId: string,
  parentId: string,
  collectionType: string | undefined,
  accessToken: string
): Promise<ViewCounts> {
  const base = normalizeServerUrl(serverUrl);
  const counts: ViewCounts = {};

  const fetchCount = async (type: string): Promise<number> => {
    try {
      const url = `${base}/emby/Users/${userId}/Items?ParentId=${parentId}&Recursive=true&IncludeItemTypes=${type}&Limit=0`;
      const res = await httpClient(url, {
        method: 'GET',
        headers: buildEmbyHeaders(userId, accessToken),
      });
      if (res.ok) {
        const data = await res.json();
        return typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : 0;
      }
    } catch (e) {
      console.warn(`[getViewItemCounts error for ${type}]`, e);
    }
    return 0;
  };

  if (collectionType === 'movies') {
    counts.movieCount = await fetchCount('Movie');
  } else if (collectionType === 'tvshows') {
    const [series, episodes] = await Promise.all([
      fetchCount('Series'),
      fetchCount('Episode'),
    ]);
    counts.seriesCount = series;
    counts.episodeCount = episodes;
  } else {
    // 混合库或自定义库
    const [movies, series] = await Promise.all([
      fetchCount('Movie'),
      fetchCount('Series'),
    ]);
    if (movies > 0) counts.movieCount = movies;
    if (series > 0) counts.seriesCount = series;
  }

  return counts;
}

export type SearchFilterType = 'All' | 'Movie' | 'Series';

export interface SearchMediaParams {
  keyword: string;
  filterType?: SearchFilterType;
  parentId?: string; // 可选指定单个媒体库 (ParentId)
  views?: EmbyItem[]; // 可选已缓存的用户媒体库列表
  limit?: number;
}

/**
 * 跨媒体库聚合搜索
 * 彻底解决 Emby / Jellyfin 在未指定 ParentId 或多媒体库情况下仅检索首个库/漏检其他媒体库的底层问题：
 * 1. 自动获取该用户可访问的全部媒体库分类（Views，排除音乐/相册/图书等非视频库）；
 * 2. 对每个具体媒体库并发（Promise.allSettled）发起独立带 ParentId 的深度检索（ParentId=${view.Id}&Recursive=true）；
 * 3. 并发发起全局 /emby/Users/{UserId}/Items 深度检索；
 * 4. 并发发起 /emby/Search/Hints 聚合搜索提示；
 * 5. 全量汇总并去重（保留高保真元数据与确切所属媒体库名称 LibraryName），确保 100% 覆盖所有媒体库；
 * 6. 视听过滤 isVideoMedia 与剧集自动折叠去重 mergeMediaBySeries。
 */
export async function searchMediaItems(
  serverUrl: string,
  userId: string,
  accessToken: string,
  params: SearchMediaParams
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const cleanTerm = params.keyword.trim();
  if (!cleanTerm) return [];

  // 视听媒体类型白名单：包含 Movie, Series, Episode, Video, BoxSet
  let includeTypes = 'Movie,Series,Episode,Video,BoxSet';
  if (params.filterType === 'Movie') {
    includeTypes = 'Movie,Video';
  } else if (params.filterType === 'Series') {
    includeTypes = 'Series,Episode';
  }

  const limit = params.limit || 100;
  const encodedTerm = encodeURIComponent(cleanTerm);
  const headers = buildEmbyHeaders(userId, accessToken);

  // 1. 如果显式指定了某一个具体的媒体库 (parentId)，直接精准深度查询该库
  if (params.parentId && params.parentId !== 'All') {
    const url = `${base}/emby/Users/${userId}/Items?ParentId=${params.parentId}&SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${limit}&Fields=PrimaryImageAspectRatio,Overview,ProductionYear,PremiereDate,CommunityRating,UserData,ChildCount,RecursiveItemCount,Status`;
    try {
      const res = await httpClient(url, { method: 'GET', headers });
      if (res.ok) {
        const data = await res.json();
        const rawItems: EmbyItem[] = data.Items || [];
        const valid = rawItems.filter(isVideoMedia);
        return mergeMediaBySeries(valid);
      }
    } catch (e) {
      console.warn('[searchMediaItems single view failed]', e);
    }
    return [];
  }

  // 2. 跨媒体库全局聚合：获取用户的全部分类（若上层未传入则自动请求）
  let views = params.views || [];
  if (!views || views.length === 0) {
    try {
      const viewsRes = await getUserViews(serverUrl, userId, accessToken);
      views = (viewsRes.Items || []).filter(
        (v) => v.CollectionType !== 'music' && v.CollectionType !== 'photos'
      );
    } catch (e) {
      console.warn('[searchMediaItems getUserViews failed]', e);
      views = [];
    }
  }

  const tasks: Promise<{ item: EmbyItem; viewName?: string; viewId?: string }[]>[] = [];

  // Task A: 全局用户目录深度递归查询
  const globalUrl = `${base}/emby/Users/${userId}/Items?SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${limit}&Fields=PrimaryImageAspectRatio,Overview,ProductionYear,PremiereDate,CommunityRating,UserData,ChildCount,RecursiveItemCount,Status`;
  tasks.push(
    httpClient(globalUrl, { method: 'GET', headers })
      .then(async (res) => (res.ok ? (await res.json()).Items || [] : []))
      .then((items: EmbyItem[]) => items.map((it) => ({ item: it })))
      .catch(() => [])
  );

  // Task B: 对每个具体媒体库并发按 ParentId 检索（穿透 Emby 服务器对部分库排除在全局搜索外的限制）
  for (const view of views) {
    const viewUrl = `${base}/emby/Users/${userId}/Items?ParentId=${view.Id}&SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${limit}&Fields=PrimaryImageAspectRatio,Overview,ProductionYear,PremiereDate,CommunityRating,UserData,ChildCount,RecursiveItemCount,Status`;
    tasks.push(
      httpClient(viewUrl, { method: 'GET', headers })
        .then(async (res) => (res.ok ? (await res.json()).Items || [] : []))
        .then((items: EmbyItem[]) =>
          items.map((it) => ({ item: it, viewName: view.Name, viewId: view.Id }))
        )
        .catch(() => [])
    );
  }

  // Task C: 查询 Emby 专门为快速模糊匹配设计的 /Search/Hints
  const hintsUrl = `${base}/emby/Search/Hints?SearchTerm=${encodedTerm}&UserId=${userId}&IncludeItemTypes=${includeTypes}&Limit=${limit}`;
  tasks.push(
    httpClient(hintsUrl, { method: 'GET', headers })
      .then(async (res) => {
        if (!res.ok) return [];
        const data = await res.json();
        const hints = data.SearchHints || [];
        return hints.map((h: any) => ({
          item: {
            Id: h.Id || h.ItemId,
            Name: h.Name,
            Type: h.Type,
            MediaType: h.MediaType,
            ProductionYear: h.ProductionYear,
            RunTimeTicks: h.RunTimeTicks,
            PrimaryImageAspectRatio:
              h.PrimaryImageAspectRatio || (h.Type === 'Episode' ? 1.77 : 0.67),
            ImageTags: h.PrimaryImageTag ? { Primary: h.PrimaryImageTag } : undefined,
            SeriesName: h.Series,
          } as EmbyItem,
        }));
      })
      .catch(() => [])
  );

  // 并发等待全部来源完成
  const settledResults = await Promise.allSettled(tasks);

  // 合并与按 Id 去重
  const itemMap = new Map<string, EmbyItem>();

  for (const r of settledResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const entry of r.value) {
        const it = entry.item;
        if (!it || !it.Id || !isVideoMedia(it)) continue;

        const existing = itemMap.get(it.Id);
        if (!existing) {
          if (entry.viewName) {
            it.LibraryName = entry.viewName;
            it.LibraryId = entry.viewId;
          }
          itemMap.set(it.Id, it);
        } else {
          // 如果已有记录，但当前记录有更准确的媒体库归属名称，进行补全
          if (!existing.LibraryName && entry.viewName) {
            existing.LibraryName = entry.viewName;
            existing.LibraryId = entry.viewId;
          }
          // 如果已有记录是简短的 SearchHint，用完整的 Items 属性补充
          if (!existing.Overview && it.Overview) existing.Overview = it.Overview;
          if (!existing.ImageTags && it.ImageTags) existing.ImageTags = it.ImageTags;
          if (!existing.UserData && it.UserData) existing.UserData = it.UserData;
          if (!existing.PrimaryImageAspectRatio && it.PrimaryImageAspectRatio) {
            existing.PrimaryImageAspectRatio = it.PrimaryImageAspectRatio;
          }
          if (existing.RecursiveItemCount === undefined && it.RecursiveItemCount !== undefined) {
            existing.RecursiveItemCount = it.RecursiveItemCount;
          }
          if (existing.ChildCount === undefined && it.ChildCount !== undefined) {
            existing.ChildCount = it.ChildCount;
          }
          if (!existing.Status && it.Status) {
            existing.Status = it.Status;
          }
        }
      }
    }
  }

  const allItems = Array.from(itemMap.values());
  // 剧集按 SeriesId 或 SeriesName 自动折叠去重
  return mergeMediaBySeries(allItems);
}

export interface FederatedServerTarget {
  id: string;
  name: string;
  url: string;
  userId: string;
  accessToken: string;
  views?: EmbyItem[];
}

export interface FederatedSearchStats {
  serverId: string;
  serverName: string;
  ok: boolean;
  count: number;
  durationMs: number;
  error?: string;
}

export interface FederatedSearchResponse {
  items: EmbyItem[];
  stats: FederatedSearchStats[];
}

/**
 * 跨多个 Emby 服务器联合并发聚合检索
 * 1. 并发请求各台已配置并处于活动状态的 Emby 服务器（通过 searchMediaItems 穿透各服务器全部分类库）；
 * 2. 任何单台服务器超时或网络异常均通过 Promise.allSettled 容错捕获，不阻塞其他健康服务器；
 * 3. 为所有返回影视条目自动注入来源 ServerId、ServerName、ServerUrl；
 * 4. 跨服务器智能合并与相关度排序（精准匹配优先、年份最新优先）；
 * 5. 附带返回各服务器的响应状态与匹配条数统计。
 */
export async function searchFederatedMediaItems(
  targets: FederatedServerTarget[],
  params: {
    keyword: string;
    filterType?: SearchFilterType;
    limitPerServer?: number;
  }
): Promise<FederatedSearchResponse> {
  const cleanTerm = params.keyword.trim();
  if (!cleanTerm || targets.length === 0) {
    return { items: [], stats: [] };
  }

  const stats: FederatedSearchStats[] = [];
  const allResults: EmbyItem[] = [];

  const tasks = targets.map(async (target) => {
    const startTime = performance.now();
    try {
      const items = await searchMediaItems(
        target.url,
        target.userId,
        target.accessToken,
        {
          keyword: cleanTerm,
          filterType: params.filterType,
          views: target.views,
          limit: params.limitPerServer || 60,
        }
      );
      const durationMs = Math.round(performance.now() - startTime);

      const enriched = items.map((it) => ({
        ...it,
        ServerId: target.id,
        ServerName: target.name,
        ServerUrl: target.url,
      }));

      return {
        serverId: target.id,
        serverName: target.name,
        ok: true,
        count: enriched.length,
        durationMs,
        items: enriched,
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      console.warn(`[searchFederatedMediaItems] Server ${target.name} (${target.id}) error:`, err);
      return {
        serverId: target.id,
        serverName: target.name,
        ok: false,
        count: 0,
        durationMs,
        error: err?.message || '连接失败或超时',
        items: [] as EmbyItem[],
      };
    }
  });

  const settled = await Promise.allSettled(tasks);

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { items, ...stat } = s.value;
      stats.push(stat);
      allResults.push(...items);
    }
  }

  // 跨服结果智能排序：
  // 1. 完全匹配片名优先
  // 2. 前缀匹配优先
  // 3. 上映年份较新优先
  const lowerTerm = cleanTerm.toLowerCase();
  allResults.sort((a, b) => {
    const aName = (a.Name || '').toLowerCase();
    const bName = (b.Name || '').toLowerCase();

    const aExact = aName === lowerTerm;
    const bExact = bName === lowerTerm;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aStart = aName.startsWith(lowerTerm);
    const bStart = bName.startsWith(lowerTerm);
    if (aStart && !bStart) return -1;
    if (!aStart && bStart) return 1;

    const aYear = a.ProductionYear || 0;
    const bYear = b.ProductionYear || 0;
    if (aYear !== bYear) return bYear - aYear;

    return 0;
  });

  return {
    items: allResults,
    stats,
  };
}


