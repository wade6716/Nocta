import { httpClient, isTauriEnvironment, ProxyConfig } from './http';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

export const DEFAULT_EMBY_USER_AGENT = `Nocta/${APP_VERSION} (Desktop; EmbyClient)`;

export const EMBY_USER_AGENT_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  value: string;
  clientName?: string;
}> = [
  { id: 'default', label: '默认 (Nocta)', value: '', clientName: 'Nocta' },
  {
    id: 'chrome',
    label: 'Chrome 浏览器',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    clientName: 'Emby Web',
  },
  {
    id: 'emby',
    label: 'Emby 官方',
    value: 'Emby/4.8.10 (Windows; Desktop)',
    clientName: 'Emby Theater',
  },
  {
    id: 'infuse',
    label: 'Infuse',
    value: 'Infuse-Direct/7.8.2',
    clientName: 'Infuse',
  },
  {
    id: 'vidhub',
    label: 'VidHub',
    value: 'VidHub/1.7.0',
    clientName: 'VidHub',
  },
  {
    id: 'senplayer',
    label: 'SenPlayer',
    value: 'SenPlayer/5.0',
    clientName: 'SenPlayer',
  },
  {
    id: 'yamby',
    label: 'Yamby',
    value: 'Yamby/1.0.0',
    clientName: 'Yamby',
  },
];

// 自定义 User-Agent 外部注入解耦机制，避免与 useAuthStore 产生循环依赖
let activeUserAgentGetter: ((serverUrl?: string) => string | undefined) | null = null;

export function registerEmbyUserAgentGetter(
  fn: (serverUrl?: string) => string | undefined
): void {
  activeUserAgentGetter = fn;
}

export function resolveEmbyUserAgent(
  explicitUserAgent?: string,
  serverUrl?: string
): string {
  const explicit = explicitUserAgent?.trim();
  if (explicit) return explicit;
  const fromStore = activeUserAgentGetter?.(serverUrl)?.trim();
  if (fromStore) return fromStore;
  return DEFAULT_EMBY_USER_AGENT;
}

export function resolveEmbyClientName(
  explicitUserAgent?: string,
  serverUrl?: string
): string {
  const customUa =
    explicitUserAgent?.trim() || activeUserAgentGetter?.(serverUrl)?.trim() || '';
  if (!customUa) return 'Nocta';

  const preset = EMBY_USER_AGENT_PRESETS.find((p) => p.value && p.value === customUa);
  if (preset?.clientName) return preset.clientName;

  if (/^Mozilla\//i.test(customUa)) return 'Emby Web';

  const token = customUa
    .split(/[\s/]/)[0]
    .replace(/[^A-Za-z0-9._-]/g, '');
  return token || 'Nocta';
}

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
  DirectStreamUrl?: string;
  MediaStreams?: EmbyMediaStream[];
}

export interface EmbyChapter {
  StartPositionTicks: number;
  Name?: string;
  MarkerType?: string; // e.g. 'Chapter' | 'IntroStart' | 'IntroEnd' | 'CreditsStart'
  ImageTag?: string;
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
    Logo?: string;
  };
  BackdropImageTags?: string[];
  CommunityRating?: number;
  OfficialRating?: string;
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
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
  ParentThumbItemId?: string;
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  Size?: number;
  MediaSources?: EmbyMediaSource[];
  LibraryName?: string;
  LibraryId?: string;
  ServerId?: string;
  ServerName?: string;
  ServerUrl?: string;
  ChildCount?: number;
  RecursiveItemCount?: number;
  Status?: string;
  Chapters?: EmbyChapter[];
  // Music-related fields
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  AlbumArtists?: Array<{ Name: string; Id: string }>;
  Artists?: string[];
  ArtistItems?: Array<{ Name: string; Id: string }>;
  AlbumPrimaryImageTag?: string;
  ParentId?: string;
  DiscNumber?: number;
  Genres?: string[];
  Container?: string;
  Bitrate?: number;
  MediaStreams?: EmbyMediaStream[];
}

/**
 * 校验条目是否属于音乐库分类视图
 */
export function isMusicLibraryView(view?: EmbyItem | null): boolean {
  if (!view) return false;
  return (view.CollectionType || '').toLowerCase() === 'music';
}

/**
 * 校验条目是否属于音乐生态媒体（歌曲、专辑、艺术家、歌单）
 */
export function isMusicMedia(item?: EmbyItem | null): boolean {
  if (!item || !item.Type) return false;
  if (
    item.MediaType === 'Video' ||
    ['Movie', 'Series', 'Episode', 'Season', 'BoxSet', 'Video', 'MusicVideo'].includes(item.Type)
  ) {
    return false;
  }
  if (
    item.Type === 'Audio' ||
    item.Type === 'MusicAlbum' ||
    item.Type === 'MusicArtist' ||
    item.Type === 'Artist' ||
    item.Type === 'Playlist'
  ) {
    return true;
  }
  return item.MediaType === 'Audio';
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

function buildEmbyAuthorizationValue(
  userId?: string,
  accessToken?: string,
  options?: { userAgent?: string; serverUrl?: string }
): string {
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

  const clientName = resolveEmbyClientName(options?.userAgent, options?.serverUrl);
  const authParts = [
    `Client="${clientName}"`,
    'Device="Desktop"',
    `DeviceId="${deviceId}"`,
    'Version="0.1.0"',
  ];

  if (userId) authParts.push(`UserId="${userId}"`);
  if (accessToken) authParts.push(`Token="${accessToken}"`);

  return `Emby ${authParts.join(', ')}`;
}

/**
 * 构造标准 Emby 认证请求头
 */
export function buildEmbyHeaders(
  userId?: string,
  accessToken?: string,
  options?: { userAgent?: string; serverUrl?: string }
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Emby-Authorization': buildEmbyAuthorizationValue(userId, accessToken, options),
  };

  // 仅在 Tauri 环境下注入自定义 User-Agent，避免浏览器 fetch 禁止修改 UA 或引发额外预检
  if (isTauriEnvironment()) {
    headers['User-Agent'] = resolveEmbyUserAgent(options?.userAgent, options?.serverUrl);
  }

  return headers;
}

/**
 * 构造供 libmpv 与 Rust 内存预加载器使用的 Emby 媒体流请求头（不附加 Content-Type）
 */
export function buildEmbyStreamHeaders(
  userId?: string,
  accessToken?: string,
  options?: { userAgent?: string; serverUrl?: string }
): Record<string, string> {
  return {
    'X-Emby-Authorization': buildEmbyAuthorizationValue(userId, accessToken, options),
    ...(accessToken ? { 'X-Emby-Token': accessToken } : {}),
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
  options?: { proxy?: ProxyConfig; userAgent?: string }
): Promise<EmbyServerInfo> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/System/Info/Public`, {
    method: 'GET',
    headers: buildEmbyHeaders(undefined, undefined, {
      userAgent: options?.userAgent,
      serverUrl: base,
    }),
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
  options?: { proxy?: ProxyConfig; userAgent?: string }
): Promise<EmbyAuthResponse> {
  const base = normalizeServerUrl(serverUrl);
  const res = await httpClient(`${base}/emby/Users/AuthenticateByName`, {
    method: 'POST',
    headers: buildEmbyHeaders(undefined, undefined, {
      userAgent: options?.userAgent,
      serverUrl: base,
    }),
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
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取媒体库分类失败: ${res.status}`);
  return res.json();
}

/**
 * 获取继续观看列表 (GET /emby/Users/{UserId}/Items/Resume)
 * 支持双重降级兜底，兼容所有 Emby 服务器版本
 */
const PLAYBACK_MEDIA_FIELDS =
  'PrimaryImageAspectRatio,BasicSyncInfo,MediaSources,Path,Overview,UserData,SeriesPrimaryImageTag,SeriesThumbImageTag,ParentThumbImageTag,ParentBackdropImageTags,ImageTags,BackdropImageTags,SeriesInfo,ChildCount,RecursiveItemCount,Status,CommunityRating,ParentLogoItemId,ParentLogoImageTag';

/**
 * 获取继续观看列表 (GET /emby/Users/{UserId}/Items/Resume)
 * 支持双重降级兜底，兼容所有 Emby 服务器版本，限定 MediaTypes=Video 彻底杜绝音乐
 */
export async function getResumeItems(
  serverUrl: string,
  userId: string,
  accessToken: string,
  limit = 24,
  options?: { throwOnError?: boolean }
): Promise<{ Items: EmbyItem[] }> {
  const base = normalizeServerUrl(serverUrl);
  let lastError: unknown = null;
  // 1. 标准 Resume 接口
  try {
    const url = `${base}/emby/Users/${userId}/Items/Resume?MediaTypes=Video&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
    });
    if (res.ok) {
      lastError = null;
      const data = await res.json();
      if (Array.isArray(data.Items) && data.Items.length > 0) {
        return {
          Items: data.Items.filter(isVideoMedia),
        };
      }
    } else {
      lastError = new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    lastError = e;
    console.warn('[getResumeItems endpoint error, falling back]', e);
  }

  // 2. 通用 IsResumable 降级查询
  try {
    const fallbackUrl = `${base}/emby/Users/${userId}/Items?Recursive=true&MediaTypes=Video&IncludeItemTypes=Movie,Episode&IsResumable=true&SortBy=DatePlayed&SortOrder=Descending&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(fallbackUrl, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
    });
    if (res.ok) {
      lastError = null;
      const data = await res.json();
      if (Array.isArray(data.Items)) {
        return {
          Items: data.Items.filter(isVideoMedia),
        };
      }
    } else {
      lastError = new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    lastError = e;
    console.warn('[getResumeItems fallback error]', e);
  }

  if (options?.throwOnError && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  limit = 30,
  options?: { throwOnError?: boolean }
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  try {
    const url = `${base}/emby/Users/${userId}/Items?Recursive=true&MediaTypes=Video&IncludeItemTypes=Movie,Episode&SortBy=DatePlayed&SortOrder=Descending&Limit=${limit}&Fields=${PLAYBACK_MEDIA_FIELDS}`;
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
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
  } catch (e) {
    console.warn('[getRecentlyPlayedItems error]', e);
    if (options?.throwOnError) {
      throw e instanceof Error ? e : new Error(String(e));
    }
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
      headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
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

function normalizeSeriesTitleKey(name?: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 按照相同媒体合并（按 SeriesId 与规范化剧名双键聚合电视剧）：
 * 保证同一部剧集只展示一张卡片，避免同一部剧的多集刷屏。
 * 当 preferSeries=true（如跨库聚合搜索）时，优先保留 Series 剧集主体卡片并丢弃其下属分集。
 */
export function mergeMediaBySeries(
  items: EmbyItem[],
  options?: { preferSeries?: boolean }
): EmbyItem[] {
  const orderedItems = options?.preferSeries
    ? [
        ...items.filter((it) => it.Type !== 'Episode'),
        ...items.filter((it) => it.Type === 'Episode'),
      ]
    : items;

  const seenItemIds = new Set<string>();
  const seenSeriesIds = new Set<string>();
  const seenSeriesNames = new Set<string>();
  const merged: EmbyItem[] = [];

  for (const item of orderedItems) {
    const idKey = item.Id !== undefined && item.Id !== null ? String(item.Id) : '';
    if (idKey && seenItemIds.has(idKey)) continue;

    if (item.Type === 'Series') {
      const nameKey = normalizeSeriesTitleKey(item.Name);
      if ((idKey && seenSeriesIds.has(idKey)) || (nameKey && seenSeriesNames.has(nameKey))) {
        continue;
      }
      if (idKey) seenItemIds.add(idKey);
      if (idKey) seenSeriesIds.add(idKey);
      if (nameKey) seenSeriesNames.add(nameKey);
      merged.push(item);
    } else if (item.Type === 'Episode') {
      const seriesIdKey =
        item.SeriesId !== undefined && item.SeriesId !== null ? String(item.SeriesId) : '';
      const seriesNameKey = normalizeSeriesTitleKey(item.SeriesName);
      if (
        (seriesIdKey && seenSeriesIds.has(seriesIdKey)) ||
        (seriesNameKey && seenSeriesNames.has(seriesNameKey))
      ) {
        continue;
      }
      if (idKey) seenItemIds.add(idKey);
      if (seriesIdKey) seenSeriesIds.add(seriesIdKey);
      if (seriesNameKey) seenSeriesNames.add(seriesNameKey);
      merged.push(item);
    } else {
      if (idKey) seenItemIds.add(idKey);
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
  const url = `${base}/emby/Users/${userId}/Items/Latest?ParentId=${parentId}&Limit=${limit}&Fields=PrimaryImageAspectRatio,BasicSyncInfo,Overview,ChildCount,RecursiveItemCount,Status,CommunityRating,MediaSources,ImageTags,BackdropImageTags,ParentLogoItemId,ParentLogoImageTag`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
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
  const url = `${base}/emby/Users/${userId}/Items/${itemId}?Fields=Overview,MediaSources,Path,People,Genres,Chapters,ParentBackdropImageTags,ImageTags,BackdropImageTags`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取条目详情失败: ${res.status}`);
  return res.json();
}

/**
 * 从 Emby/Jellyfin 章节元数据中提取片头 (Intro/OP) 起止秒数区间
 */
export function extractIntroRange(
  chapters?: EmbyChapter[],
  durationSeconds?: number
): { start: number; end: number } | null {
  if (!chapters || chapters.length === 0) return null;

  const sorted = [...chapters].sort(
    (a, b) => (a.StartPositionTicks || 0) - (b.StartPositionTicks || 0)
  );

  // 1. 优先识别官方 MarkerType
  const introStartIdx = sorted.findIndex((c) => c.MarkerType === 'IntroStart');
  if (introStartIdx >= 0) {
    const start = ticksToSeconds(sorted[introStartIdx].StartPositionTicks || 0);
    const introEnd = sorted.find(
      (c, idx) => idx > introStartIdx && c.MarkerType === 'IntroEnd'
    );
    const nextChapter = sorted[introStartIdx + 1];
    let end = introEnd
      ? ticksToSeconds(introEnd.StartPositionTicks || 0)
      : nextChapter
      ? ticksToSeconds(nextChapter.StartPositionTicks || 0)
      : start + 90;

    if (durationSeconds && durationSeconds > 0) {
      end = Math.min(end, durationSeconds);
    }
    if (end > start + 10) {
      return { start, end };
    }
  }

  // 2. 启发式识别常见 OP / Intro / 片头章节名
  const introRegex = /^(op|opening|intro|片头|主題歌|主题曲)(\b|\s|$|\d)/i;
  const matchIdx = sorted.findIndex((c) => introRegex.test((c.Name || '').trim()));
  if (matchIdx >= 0 && matchIdx + 1 < sorted.length) {
    const start = ticksToSeconds(sorted[matchIdx].StartPositionTicks || 0);
    const end = ticksToSeconds(sorted[matchIdx + 1].StartPositionTicks || 0);
    const span = end - start;
    if (span >= 30 && span <= 180) {
      return { start, end };
    }
  }

  return null;
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
  const url = `${base}/emby/Shows/${seriesId}/Episodes?SeasonId=${seasonId}&UserId=${userId}&Fields=Overview,MediaSources,Path,PrimaryImageAspectRatio,ParentBackdropImageTags,ImageTags,BackdropImageTags`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
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
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
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
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
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
 * 生成直连原始媒体流地址 (100% 原画直传，static=true)
 * 坚决不向 Emby 服务端请求任何实时转码 (VideoCodec/AudioCodec) 或重封装 (MP4 Remux)，保证服务端 0% CPU 额外开销
 */
export function buildDirectStreamUrl(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string
): string {
  return buildNativeDirectStreamUrl(serverUrl, itemId, mediaSource, playSessionId, accessToken);
}

function isLoopbackOrPrivateHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.lan') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^fe80:/i.test(host) ||
      /^f[cd][0-9a-f]{2}:/i.test(host)
    ) {
      return true;
    }
    const match172 = host.match(/^172\.(\d+)\./);
    if (match172) {
      const secondOctet = Number(match172[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 构造标准 Emby 原画直出接口地址 (/emby/Videos/{itemId}/stream.{ext}?static=true)
 */
export function buildStandardEmbyStaticStreamUrl(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string
): string {
  const base = normalizeServerUrl(serverUrl);
  const rawContainer = (mediaSource.Container || 'mkv').toLowerCase().split(',')[0].trim();
  const normalizedContainer = rawContainer === 'matroska' ? 'mkv' : rawContainer || 'mkv';
  return `${base}/emby/Videos/${encodeURIComponent(itemId)}/stream.${normalizedContainer}?static=true&MediaSourceId=${encodeURIComponent(mediaSource.Id)}&PlaySessionId=${encodeURIComponent(playSessionId)}&api_key=${encodeURIComponent(accessToken)}&X-Emby-Token=${encodeURIComponent(accessToken)}`;
}

/**
 * 生成原生硬解播放器 (libmpv) 直连流地址
 * 100% 原始容器直出 (static=true)，无任何服务端重封装与音频转码，保留 DTS/TrueHD/Atmos 多声道与全画质
 *
 * 注意：对于 `.strm` (`IsRemote: true`) 媒体，服务端入库记录的 `mediaSource.Path` 往往包含过期签名或已下线的网盘穿透节点；
 * 必须优先使用服务端返回的 `DirectStreamUrl`（含相对路径 `/videos/...`）或标准 `/emby/Videos/{id}/stream` 接口，
 * 以便经过 Emby 服务端 302/307 中间件动态重写并重签最新直链。
 */
export function buildNativeDirectStreamUrl(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string
): string {
  const directCandidate = resolveEmbyDirectStreamCandidate(serverUrl, mediaSource, accessToken);
  if (directCandidate) {
    return directCandidate;
  }
  return buildStandardEmbyStaticStreamUrl(
    serverUrl,
    itemId,
    mediaSource,
    playSessionId,
    accessToken
  );
}

/**
 * 解析服务端 PlaybackInfo 返回的 DirectStreamUrl 作为无转码直连地址
 * 严格排除含 VideoCodec/AudioCodec/TranscodingProtocol 的转码流，防止触发服务端转码
 */
export function resolveEmbyDirectStreamCandidate(
  serverUrl: string,
  mediaSource: EmbyMediaSource,
  accessToken: string
): string | null {
  const raw = mediaSource.DirectStreamUrl?.trim();
  if (!raw) return null;

  if (/(?:^|[?&])(VideoCodec|AudioCodec|TranscodingProtocol)=/i.test(raw)) {
    return null;
  }

  let joined: string;
  if (/^https?:\/\//i.test(raw)) {
    joined = raw;
  } else if (raw.startsWith('/')) {
    const base = normalizeServerUrl(serverUrl);
    joined =
      base.toLowerCase().endsWith('/emby') && raw.toLowerCase().startsWith('/emby/')
        ? `${base}${raw.slice(5)}`
        : `${base}${raw}`;
  } else {
    return null;
  }

  if (!/[?&]static=/i.test(joined)) {
    joined += `${joined.includes('?') ? '&' : '?'}static=true`;
  }

  if (accessToken && !/[?&](api_key|X-Emby-Token)=/i.test(joined)) {
    joined += `${joined.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(accessToken)}`;
  }

  return joined;
}

/**
 * 按优先级生成不触发转码的备选直连候选列表（已去重并排除当前失败地址）
 */
export function resolveEmbyFallbackStreamCandidates(
  serverUrl: string,
  itemId: string,
  mediaSource: EmbyMediaSource,
  playSessionId: string,
  accessToken: string,
  currentUrl?: string | null
): string[] {
  const base = normalizeServerUrl(serverUrl);
  const rawCandidates: Array<string | null | undefined> = [
    resolveEmbyDirectStreamCandidate(serverUrl, mediaSource, accessToken),
    buildStandardEmbyStaticStreamUrl(serverUrl, itemId, mediaSource, playSessionId, accessToken),
  ];

  if (mediaSource.IsRemote && mediaSource.Path && /^https?:\/\//i.test(mediaSource.Path)) {
    if (!isLoopbackOrPrivateHost(mediaSource.Path) || isLoopbackOrPrivateHost(base)) {
      rawCandidates.push(mediaSource.Path.trim());
    }
  }

  const seen = new Set<string>();
  const currentTrimmed = currentUrl?.trim();
  const result: string[] = [];
  for (const candidate of rawCandidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || trimmed === currentTrimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

let imageProxyRevision = 1;

export function bumpImageProxyRevision(): number {
  imageProxyRevision += 1;
  return imageProxyRevision;
}

export function getImageProxyRevision(): number {
  return imageProxyRevision;
}

export function isWrappedNoctaImageUrl(url?: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\/nocta-img\.localhost\//i.test(url) || /^nocta-img:\/\//i.test(url);
}

export function unwrapEmbyImageUrl(url: string): string {
  if (!isWrappedNoctaImageUrl(url)) return url;
  try {
    const normalized = url.replace(/^nocta-img:\/\//i, 'http://');
    const parsed = new URL(normalized);
    return parsed.searchParams.get('url') || url;
  } catch {
    return url;
  }
}

export function wrapEmbyImageUrl(
  rawUrl: string,
  options?: { isTauri?: boolean; isWindows?: boolean }
): string {
  if (!rawUrl || isWrappedNoctaImageUrl(rawUrl) || !/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  const inTauri = options?.isTauri ?? isTauriEnvironment();
  if (!inTauri) return rawUrl;

  const isWin =
    options?.isWindows ??
    (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent));
  const encoded = encodeURIComponent(rawUrl);
  return isWin
    ? `http://nocta-img.localhost/fetch?url=${encoded}&v=${imageProxyRevision}`
    : `nocta-img://localhost/fetch?url=${encoded}&v=${imageProxyRevision}`;
}

/**
 * 构造海报封面图片 URL (默认自动添加 webp 与尺寸优化；Tauri 下自动走 Rust nocta-img 代理协议)
 */
export function buildItemImageUrl(
  serverUrl: string,
  itemId: string,
  imageTag?: string,
  options: {
    type?: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo';
    maxWidth?: number;
    quality?: number;
    format?: 'webp' | 'jpg' | 'png' | 'original';
  } = {}
): string {
  const base = normalizeServerUrl(serverUrl);
  const type = options.type || 'Primary';
  const maxWidth = options.maxWidth || (type === 'Backdrop' ? 1920 : 400);
  const quality = options.quality || 85;
  const format = options.format ?? 'webp';
  const formatParam = format === 'original' ? '' : `&format=${format}`;
  const tagParam = imageTag ? `&tag=${imageTag}` : '';
  const indexSegment = type === 'Backdrop' ? '/0' : '';

  const rawUrl = `${base}/emby/Items/${itemId}/Images/${type}${indexSegment}?maxWidth=${maxWidth}&quality=${quality}${formatParam}${tagParam}`;
  return wrapEmbyImageUrl(rawUrl);
}

/**
 * 剥离图片 URL 中的 format=webp 参数（保留 tag 与尺寸），用于部分 Emby 服务端 WebP 编码异常时的一次性重试
 */
export function stripImageFormatWebp(url?: string | null): string | null {
  if (!url) return null;
  const wrapped = isWrappedNoctaImageUrl(url);
  const targetUrl = wrapped ? unwrapEmbyImageUrl(url) : url;
  if (!/[?&]format=webp(?:&|$)/i.test(targetUrl)) return null;
  const next = targetUrl
    .replace(/([?&])format=webp(?:&|$)/i, (match, sep: string, offset: number, str: string) => {
      if (sep === '?') {
        return offset + match.length < str.length ? '?' : '';
      }
      return match.endsWith('&') ? '&' : '';
    })
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '');
  if (next === targetUrl) return null;
  return wrapped
    ? wrapEmbyImageUrl(next, {
        isTauri: true,
        isWindows: /^https?:\/\/nocta-img\.localhost\//i.test(url),
      })
    : next;
}

function buildTaggedImageCandidate(
  serverUrl: string,
  targetId: string | undefined,
  type: 'Primary' | 'Backdrop' | 'Thumb',
  tag: string | undefined,
  options: { maxWidth?: number; quality?: number }
): string {
  if (!targetId || !tag) return '';
  return buildItemImageUrl(serverUrl, targetId, tag, {
    type,
    maxWidth: options.maxWidth,
    quality: options.quality,
  });
}

/**
 * 分集横版剧照/缩略图寻址（严格要求存在对应图片 tag 才发请求，避免无图分集触发 Emby 500 NullReferenceException）
 */
export function resolveEpisodeThumbnailUrl(
  serverUrl: string,
  episode: EmbyItem,
  options: {
    maxWidth?: number;
    quality?: number;
    seriesItem?: EmbyItem | null;
  } = {}
): string {
  if (!serverUrl || !episode?.Id) return '';
  const { seriesItem } = options;
  const imgOpts = { maxWidth: options.maxWidth, quality: options.quality };

  return (
    buildTaggedImageCandidate(serverUrl, episode.Id, 'Primary', episode.ImageTags?.Primary, imgOpts) ||
    buildTaggedImageCandidate(serverUrl, episode.Id, 'Thumb', episode.ImageTags?.Thumb, imgOpts) ||
    buildTaggedImageCandidate(
      serverUrl,
      episode.Id,
      'Backdrop',
      episode.BackdropImageTags?.[0] || episode.ImageTags?.Backdrop,
      imgOpts
    ) ||
    buildTaggedImageCandidate(
      serverUrl,
      episode.ParentBackdropItemId || seriesItem?.Id || episode.SeriesId,
      'Backdrop',
      episode.ParentBackdropImageTags?.[0] ||
        seriesItem?.BackdropImageTags?.[0] ||
        seriesItem?.ImageTags?.Backdrop,
      imgOpts
    ) ||
    buildTaggedImageCandidate(
      serverUrl,
      episode.ParentThumbItemId || episode.SeriesId || seriesItem?.Id,
      'Thumb',
      episode.ParentThumbImageTag || episode.SeriesThumbImageTag || seriesItem?.ImageTags?.Thumb,
      imgOpts
    ) ||
    buildTaggedImageCandidate(
      serverUrl,
      episode.SeriesId || seriesItem?.Id,
      'Primary',
      episode.SeriesPrimaryImageTag || seriesItem?.ImageTags?.Primary,
      imgOpts
    ) ||
    ''
  );
}

/**
 * 竖版海报寻址（严格校验 tag 存在性；Episode 优先映射所属剧集 Primary）
 */
export function resolveItemPosterUrl(
  serverUrl: string,
  item: EmbyItem,
  options: {
    maxWidth?: number;
    quality?: number;
    seriesItem?: EmbyItem | null;
  } = {}
): string {
  if (!serverUrl || !item?.Id) return '';
  const { seriesItem } = options;
  const imgOpts = { maxWidth: options.maxWidth, quality: options.quality };

  if (item.Type === 'Episode' && item.SeriesId) {
    return (
      buildTaggedImageCandidate(
        serverUrl,
        seriesItem?.Id || item.SeriesId,
        'Primary',
        seriesItem?.ImageTags?.Primary || item.SeriesPrimaryImageTag,
        imgOpts
      ) ||
      buildTaggedImageCandidate(serverUrl, item.Id, 'Primary', item.ImageTags?.Primary, imgOpts) ||
      buildTaggedImageCandidate(
        serverUrl,
        seriesItem?.Id || item.ParentThumbItemId || item.SeriesId,
        'Thumb',
        seriesItem?.ImageTags?.Thumb || item.SeriesThumbImageTag || item.ParentThumbImageTag,
        imgOpts
      ) ||
      ''
    );
  }

  return (
    buildTaggedImageCandidate(serverUrl, item.Id, 'Primary', item.ImageTags?.Primary, imgOpts) ||
    buildTaggedImageCandidate(serverUrl, item.Id, 'Thumb', item.ImageTags?.Thumb, imgOpts) ||
    buildTaggedImageCandidate(
      serverUrl,
      item.Id,
      'Backdrop',
      item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop,
      imgOpts
    ) ||
    ''
  );
}

/**
 * 横版背景/剧照寻址（严格校验 tag 存在性，区分详情/Hero 的剧集主体优先模式与卡片的单集画面优先模式）
 */
export function resolveItemBackdropUrl(
  serverUrl: string,
  item: EmbyItem,
  options: {
    maxWidth?: number;
    quality?: number;
    seriesItem?: EmbyItem | null;
    mode?: 'hero' | 'card';
    allowPrimaryFallback?: boolean;
  } = {}
): string {
  if (!serverUrl || !item?.Id) return '';
  const { seriesItem, mode = 'hero', allowPrimaryFallback = false } = options;
  const imgOpts = { maxWidth: options.maxWidth, quality: options.quality };

  if (mode === 'card') {
    const isEpisode = item.Type === 'Episode';
    return (
      buildTaggedImageCandidate(
        serverUrl,
        item.Id,
        'Backdrop',
        item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop,
        imgOpts
      ) ||
      buildTaggedImageCandidate(serverUrl, item.Id, 'Thumb', item.ImageTags?.Thumb, imgOpts) ||
      (isEpisode
        ? buildTaggedImageCandidate(serverUrl, item.Id, 'Primary', item.ImageTags?.Primary, imgOpts)
        : '') ||
      (isEpisode
        ? buildTaggedImageCandidate(
            serverUrl,
            item.ParentBackdropItemId || seriesItem?.Id || item.SeriesId,
            'Backdrop',
            item.ParentBackdropImageTags?.[0] ||
              seriesItem?.BackdropImageTags?.[0] ||
              seriesItem?.ImageTags?.Backdrop,
            imgOpts
          )
        : '') ||
      (isEpisode
        ? buildTaggedImageCandidate(
            serverUrl,
            item.ParentThumbItemId || item.SeriesId || seriesItem?.Id,
            'Thumb',
            item.ParentThumbImageTag || item.SeriesThumbImageTag || seriesItem?.ImageTags?.Thumb,
            imgOpts
          )
        : '') ||
      (!isEpisode
        ? buildTaggedImageCandidate(serverUrl, item.Id, 'Primary', item.ImageTags?.Primary, imgOpts)
        : '') ||
      (isEpisode
        ? buildTaggedImageCandidate(
            serverUrl,
            item.SeriesId || seriesItem?.Id,
            'Primary',
            item.SeriesPrimaryImageTag || seriesItem?.ImageTags?.Primary,
            imgOpts
          )
        : '') ||
      ''
    );
  }

  if (item.Type === 'Episode' && item.SeriesId) {
    return (
      buildTaggedImageCandidate(
        serverUrl,
        seriesItem?.Id || item.ParentBackdropItemId || item.SeriesId,
        'Backdrop',
        seriesItem?.BackdropImageTags?.[0] ||
          seriesItem?.ImageTags?.Backdrop ||
          item.ParentBackdropImageTags?.[0],
        imgOpts
      ) ||
      buildTaggedImageCandidate(
        serverUrl,
        item.Id,
        'Backdrop',
        item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop,
        imgOpts
      ) ||
      buildTaggedImageCandidate(
        serverUrl,
        seriesItem?.Id || item.ParentThumbItemId || item.SeriesId,
        'Thumb',
        seriesItem?.ImageTags?.Thumb || item.SeriesThumbImageTag || item.ParentThumbImageTag,
        imgOpts
      ) ||
      buildTaggedImageCandidate(serverUrl, item.Id, 'Thumb', item.ImageTags?.Thumb, imgOpts) ||
      (allowPrimaryFallback
        ? buildTaggedImageCandidate(
            serverUrl,
            seriesItem?.Id || item.SeriesId,
            'Primary',
            seriesItem?.ImageTags?.Primary || item.SeriesPrimaryImageTag,
            imgOpts
          ) ||
          buildTaggedImageCandidate(serverUrl, item.Id, 'Primary', item.ImageTags?.Primary, imgOpts)
        : '') ||
      ''
    );
  }

  return (
    buildTaggedImageCandidate(
      serverUrl,
      item.Id,
      'Backdrop',
      item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop,
      imgOpts
    ) ||
    buildTaggedImageCandidate(serverUrl, item.Id, 'Thumb', item.ImageTags?.Thumb, imgOpts) ||
    (allowPrimaryFallback
      ? buildTaggedImageCandidate(serverUrl, item.Id, 'Primary', item.ImageTags?.Primary, imgOpts)
      : '') ||
    ''
  );
}

/**
 * 解析透明剧名/片名 Logo URL（无可用 Logo 时返回空字符串，供调用方降级为大字排印）
 */
export function resolveItemLogoUrl(
  serverUrl: string,
  item: EmbyItem,
  options: { maxWidth?: number; quality?: number } = {}
): string {
  if (!serverUrl || !item?.Id) return '';
  const maxWidth = options.maxWidth ?? 600;
  const quality = options.quality ?? 90;

  if (item.ImageTags?.Logo) {
    return buildItemImageUrl(serverUrl, item.Id, item.ImageTags.Logo, {
      type: 'Logo',
      maxWidth,
      quality,
      format: 'png',
    });
  }
  if (item.ParentLogoItemId && item.ParentLogoImageTag) {
    return buildItemImageUrl(serverUrl, item.ParentLogoItemId, item.ParentLogoImageTag, {
      type: 'Logo',
      maxWidth,
      quality,
      format: 'png',
    });
  }
  if (item.SeriesId && item.ParentLogoImageTag) {
    return buildItemImageUrl(serverUrl, item.SeriesId, item.ParentLogoImageTag, {
      type: 'Logo',
      maxWidth,
      quality,
      format: 'png',
    });
  }
  return '';
}

/**
 * 从真实 MediaStreams 中提取核心视频画质徽章（无流数据时返回空数组，绝不硬编码）
 */
export function extractVideoQualityBadges(item?: EmbyItem | null): string[] {
  if (!item) return [];
  const streams = item.MediaSources?.[0]?.MediaStreams || item.MediaStreams || [];
  const videoStream = streams.find((s) => s.Type === 'Video');
  if (!videoStream) return [];

  const badges: string[] = [];
  const width = videoStream.Width || 0;
  const height = videoStream.Height || 0;
  if (width >= 3800 || height >= 2000) {
    badges.push('4K');
  } else if (width >= 1900 || height >= 1000) {
    badges.push('1080P');
  } else if (width >= 1260 || height >= 700) {
    badges.push('720P');
  }

  const rangeText = `${videoStream.VideoRange || ''} ${videoStream.DisplayTitle || ''}`.toUpperCase();
  if (rangeText.includes('DOLBY VISION') || rangeText.includes('DOVI') || /\bDV\b/.test(rangeText)) {
    badges.push('Dolby Vision');
  } else if (rangeText.includes('HDR10+')) {
    badges.push('HDR10+');
  } else if (rangeText.includes('HDR')) {
    badges.push('HDR');
  } else if (videoStream.Codec) {
    const codec = videoStream.Codec.toLowerCase();
    if (codec === 'hevc' || codec === 'h265') badges.push('HEVC');
    else if (codec === 'av1') badges.push('AV1');
    else if (codec === 'h264' || codec === 'avc') badges.push('H.264');
  }

  return badges.slice(0, 2);
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
 * 将字节数格式化为人类可读的文件体积字符串（TB / GB / MB / KB）
 */
export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const tb = 1024 ** 4;
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;
  if (bytes >= tb) return `${(bytes / tb).toFixed(2)} TB`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/**
 * 提取媒体条目的主文件体积（字节），优先取首个有效 MediaSource，缺失时回退 item.Size
 */
export function getItemFileSize(item?: EmbyItem | null): number | undefined {
  if (!item) return undefined;
  const sourceSize = item.MediaSources?.find(
    (ms) => typeof ms.Size === 'number' && Number.isFinite(ms.Size) && ms.Size > 0
  )?.Size;
  if (typeof sourceSize === 'number') return sourceSize;
  if (typeof item.Size === 'number' && Number.isFinite(item.Size) && item.Size > 0) {
    return item.Size;
  }
  return undefined;
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
    headers: buildEmbyHeaders(undefined, accessToken, { serverUrl: base }),
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
    headers: buildEmbyHeaders(undefined, accessToken, { serverUrl: base }),
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
    headers: buildEmbyHeaders(undefined, accessToken, { serverUrl: base }),
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
  albumCount?: number;
  songCount?: number;
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
        headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
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
  } else if (collectionType === 'music') {
    const [albums, songs] = await Promise.all([
      fetchCount('MusicAlbum'),
      fetchCount('Audio'),
    ]);
    counts.albumCount = albums;
    counts.songCount = songs;
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

const USER_VIEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const userViewsCache = new Map<string, { views: EmbyItem[]; fetchedAt: number }>();

async function getCachedSearchViews(
  serverUrl: string,
  userId: string,
  accessToken: string
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const cacheKey = `${base}::${userId}`;
  const cached = userViewsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < USER_VIEWS_CACHE_TTL_MS) {
    return cached.views;
  }

  try {
    const viewsRes = await getUserViews(serverUrl, userId, accessToken);
    const valid = (viewsRes.Items || []).filter(
      (v) => v.CollectionType !== 'music' && v.CollectionType !== 'photos'
    );
    userViewsCache.set(cacheKey, { views: valid, fetchedAt: Date.now() });
    return valid;
  } catch (e) {
    console.warn('[searchMediaItems getUserViews failed]', e);
    return [];
  }
}

/**
 * 跨媒体库聚合搜索
 * 彻底解决 Emby / Jellyfin 在未指定 ParentId 或多媒体库情况下仅检索首个库/漏检其他媒体库的底层问题：
 * 1. 自动获取（带 5 分钟 TTL 缓存）该用户可访问的全部媒体库分类（Views，排除音乐/相册/图书等非视频库）；
 * 2. 对每个具体媒体库并发（Promise.allSettled）发起独立带 ParentId 的深度检索（ParentId=${view.Id}&Recursive=true）；
 * 3. 并发发起全局 /emby/Users/{UserId}/Items 深度检索；
 * 4. 并发发起 /emby/Search/Hints 聚合搜索提示；
 * 5. 全量汇总并按字符串 Id 去重（补全剧集关联字段与所属媒体库名称 LibraryName）；
 * 6. 视听过滤 isVideoMedia 与优先保留剧集主体卡片的剧集折叠去重 mergeMediaBySeries(..., { preferSeries: true })。
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
  const perViewLimit = Math.min(limit, 30);
  const searchFields =
    'PrimaryImageAspectRatio,ProductionYear,PremiereDate,CommunityRating,UserData,ChildCount,RecursiveItemCount,Status';
  const encodedTerm = encodeURIComponent(cleanTerm);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });

  // 1. 如果显式指定了某一个具体的媒体库 (parentId)，直接精准深度查询该库
  if (params.parentId && params.parentId !== 'All') {
    const url = `${base}/emby/Users/${userId}/Items?ParentId=${params.parentId}&SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${limit}&Fields=${searchFields}`;
    try {
      const res = await httpClient(url, { method: 'GET', headers });
      if (res.ok) {
        const data = await res.json();
        const rawItems: EmbyItem[] = (data.Items || []).map((it: EmbyItem) => ({
          ...it,
          Id: it.Id !== undefined && it.Id !== null ? String(it.Id) : it.Id,
          SeriesId:
            it.SeriesId !== undefined && it.SeriesId !== null ? String(it.SeriesId) : undefined,
        }));
        const valid = rawItems.filter(isVideoMedia);
        return mergeMediaBySeries(valid, { preferSeries: true });
      }
    } catch (e) {
      console.warn('[searchMediaItems single view failed]', e);
    }
    return [];
  }

  // 2. 跨媒体库全局聚合：获取用户的全部分类（若上层未传入则读取缓存/请求）
  let views = params.views;
  if (!views || views.length === 0) {
    views = await getCachedSearchViews(serverUrl, userId, accessToken);
  }

  const tasks: Promise<{ item: EmbyItem; viewName?: string; viewId?: string }[]>[] = [];

  // Task A: 全局用户目录深度递归查询
  const globalUrl = `${base}/emby/Users/${userId}/Items?SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${limit}&Fields=${searchFields}`;
  tasks.push(
    httpClient(globalUrl, { method: 'GET', headers })
      .then(async (res) => (res.ok ? (await res.json()).Items || [] : []))
      .then((items: EmbyItem[]) => items.map((it) => ({ item: it })))
      .catch(() => [])
  );

  // Task B: 对每个具体媒体库并发按 ParentId 检索（穿透 Emby 服务器对部分库排除在全局搜索外的限制）
  for (const view of views) {
    const viewUrl = `${base}/emby/Users/${userId}/Items?ParentId=${view.Id}&SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${perViewLimit}&Fields=${searchFields}`;
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
        return hints.map((h: any) => {
          const hintImageTags: EmbyItem['ImageTags'] | undefined =
            h.PrimaryImageTag || h.ThumbImageTag
              ? {
                  ...(h.PrimaryImageTag ? { Primary: h.PrimaryImageTag } : {}),
                  ...(h.ThumbImageTag ? { Thumb: h.ThumbImageTag } : {}),
                }
              : undefined;
          const rawHintId = h.Id ?? h.ItemId;
          return {
            item: {
              Id: rawHintId !== undefined && rawHintId !== null ? String(rawHintId) : '',
              Name: h.Name,
              Type: h.Type,
              MediaType: h.MediaType,
              ProductionYear: h.ProductionYear,
              RunTimeTicks: h.RunTimeTicks,
              PrimaryImageAspectRatio:
                h.PrimaryImageAspectRatio || (h.Type === 'Episode' ? 1.77 : 0.67),
              ImageTags: hintImageTags,
              BackdropImageTags: h.BackdropImageTag ? [h.BackdropImageTag] : undefined,
              SeriesId:
                h.SeriesId !== undefined && h.SeriesId !== null ? String(h.SeriesId) : undefined,
              SeriesName: h.Series,
              IndexNumber: h.IndexNumber,
              ParentIndexNumber: h.ParentIndexNumber,
            } as EmbyItem,
          };
        });
      })
      .catch(() => [])
  );

  // 并发等待全部来源完成
  const settledResults = await Promise.allSettled(tasks);

  // 合并与按字符串 Id 去重
  const itemMap = new Map<string, EmbyItem>();

  for (const r of settledResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const entry of r.value) {
        const it = entry.item;
        if (!it || it.Id === undefined || it.Id === null) continue;
        const normalizedId = String(it.Id);
        if (!normalizedId || !isVideoMedia(it)) continue;

        it.Id = normalizedId;
        if (it.SeriesId !== undefined && it.SeriesId !== null) {
          it.SeriesId = String(it.SeriesId);
        }

        const existing = itemMap.get(normalizedId);
        if (!existing) {
          if (entry.viewName) {
            it.LibraryName = entry.viewName;
            it.LibraryId = entry.viewId;
          }
          itemMap.set(normalizedId, it);
        } else {
          // 如果已有记录，但当前记录有更准确的媒体库归属名称，进行补全
          if (!existing.LibraryName && entry.viewName) {
            existing.LibraryName = entry.viewName;
            existing.LibraryId = entry.viewId;
          }
          // 补全剧集关联字段
          if (!existing.SeriesId && it.SeriesId) existing.SeriesId = it.SeriesId;
          if (!existing.SeriesName && it.SeriesName) existing.SeriesName = it.SeriesName;
          if (existing.IndexNumber === undefined && it.IndexNumber !== undefined) {
            existing.IndexNumber = it.IndexNumber;
          }
          if (existing.ParentIndexNumber === undefined && it.ParentIndexNumber !== undefined) {
            existing.ParentIndexNumber = it.ParentIndexNumber;
          }
          // 如果已有记录是简短的 SearchHint，用完整的 Items 属性补充
          if (!existing.Overview && it.Overview) existing.Overview = it.Overview;
          if ((!existing.ImageTags || Object.keys(existing.ImageTags).length === 0) && it.ImageTags) {
            existing.ImageTags = it.ImageTags;
          }
          if (
            (!existing.BackdropImageTags || existing.BackdropImageTags.length === 0) &&
            it.BackdropImageTags?.length
          ) {
            existing.BackdropImageTags = it.BackdropImageTags;
          }
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
  // 优先保留剧集主体卡片，按 SeriesId 与规范化剧名折叠去重
  return mergeMediaBySeries(allItems, { preferSeries: true });
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
 * 跨服搜索结果统一相关度排序：
 * 1. 完全匹配片名优先
 * 2. 前缀匹配优先
 * 3. 非 Episode（剧集主体/电影/合集）优先于单集条目
 * 4. 上映年份较新优先
 */
export function sortFederatedSearchItems(items: EmbyItem[], keyword: string): EmbyItem[] {
  const lowerTerm = keyword.trim().toLowerCase();
  return [...items].sort((a, b) => {
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

    const aIsEpisode = a.Type === 'Episode';
    const bIsEpisode = b.Type === 'Episode';
    if (!aIsEpisode && bIsEpisode) return -1;
    if (aIsEpisode && !bIsEpisode) return 1;

    const aYear = a.ProductionYear || 0;
    const bYear = b.ProductionYear || 0;
    if (aYear !== bYear) return bYear - aYear;

    return 0;
  });
}

/**
 * 跨多个 Emby 服务器联合并发聚合检索
 * 1. 并行请求各台已配置 Emby 服务器（支持渐进式单服回调 onServerResult，快服率先返回展示）；
 * 2. 内置单服超时保护与 Promise.allSettled 容错捕获，单服超时/离线不阻塞其他健康服务器；
 * 3. 为所有返回影视条目自动注入来源 ServerId、ServerName、ServerUrl；
 * 4. 跨服务器智能合并与相关度排序（精准匹配优先、剧集/电影主体优先、年份最新优先）；
 * 5. 附带返回各服务器的响应状态与匹配条数统计。
 */
export async function searchFederatedMediaItems(
  targets: FederatedServerTarget[],
  params: {
    keyword: string;
    filterType?: SearchFilterType;
    limitPerServer?: number;
    timeoutMs?: number;
    onServerResult?: (payload: { stat: FederatedSearchStats; items: EmbyItem[] }) => void;
  }
): Promise<FederatedSearchResponse> {
  const cleanTerm = params.keyword.trim();
  if (!cleanTerm || targets.length === 0) {
    return { items: [], stats: [] };
  }

  const timeoutMs = params.timeoutMs ?? 12000;
  const stats: FederatedSearchStats[] = [];
  const allResults: EmbyItem[] = [];

  const tasks = targets.map(async (target) => {
    const startTime = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const items = await Promise.race([
        searchMediaItems(target.url, target.userId, target.accessToken, {
          keyword: cleanTerm,
          filterType: params.filterType,
          views: target.views,
          limit: params.limitPerServer || 60,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('请求超时')), timeoutMs);
        }),
      ]);
      const durationMs = Math.round(performance.now() - startTime);

      const enriched = items.map((it) => ({
        ...it,
        ServerId: target.id,
        ServerName: target.name,
        ServerUrl: target.url,
      }));

      const stat: FederatedSearchStats = {
        serverId: target.id,
        serverName: target.name,
        ok: true,
        count: enriched.length,
        durationMs,
      };
      params.onServerResult?.({ stat, items: enriched });

      return { stat, items: enriched };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      console.warn(`[searchFederatedMediaItems] Server ${target.name} (${target.id}) error:`, err);
      const stat: FederatedSearchStats = {
        serverId: target.id,
        serverName: target.name,
        ok: false,
        count: 0,
        durationMs,
        error: err?.message || '连接失败或超时',
      };
      params.onServerResult?.({ stat, items: [] as EmbyItem[] });

      return { stat, items: [] as EmbyItem[] };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  });

  const settled = await Promise.allSettled(tasks);

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      stats.push(s.value.stat);
      allResults.push(...s.value.items);
    }
  }

  return {
    items: sortFederatedSearchItems(allResults, cleanTerm),
    stats,
  };
}

export interface FederatedHistoryServerStat {
  serverId: string;
  serverName: string;
  ok: boolean;
  count: number;
  durationMs: number;
  error?: string;
}

export interface FederatedPlaybackHistoryResponse {
  items: EmbyItem[];
  stats: FederatedHistoryServerStat[];
}

function getLastPlayedMs(item: EmbyItem): number {
  const raw = item.UserData?.LastPlayedDate;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function comparePlaybackRecency(a: EmbyItem, b: EmbyItem): number {
  const aMs = getLastPlayedMs(a);
  const bMs = getLastPlayedMs(b);
  const aHasPos = (a.UserData?.PlaybackPositionTicks || 0) > 0;
  const bHasPos = (b.UserData?.PlaybackPositionTicks || 0) > 0;
  const aNoTimeResume = aMs === 0 && aHasPos;
  const bNoTimeResume = bMs === 0 && bHasPos;

  if (aNoTimeResume !== bNoTimeResume) return aNoTimeResume ? -1 : 1;
  if (aMs !== bMs) return bMs - aMs;
  if (aHasPos !== bHasPos) return aHasPos ? -1 : 1;
  return 0;
}

/**
 * 跨多个 Emby 服务器并发聚合「继续观看」与「最近播放记录」
 * - 严格过滤非视频（排除音乐、音频、歌单）
 * - 单服内同剧集按最新进度折叠（mergeMediaBySeries）
 * - 跨服按最近播放时间与未完播断点智能排序，并注入 ServerId / ServerName / ServerUrl
 */
export async function getFederatedPlaybackHistory(
  targets: FederatedServerTarget[],
  limitPerServer = 30
): Promise<FederatedPlaybackHistoryResponse> {
  if (targets.length === 0) {
    return { items: [], stats: [] };
  }

  const tasks = targets.map(async (target) => {
    const startTime = performance.now();
    if (!target.url || !target.userId || !target.accessToken) {
      return {
        serverId: target.id,
        serverName: target.name,
        ok: false,
        count: 0,
        durationMs: 0,
        error: '未完成登录认证',
        items: [] as EmbyItem[],
      };
    }

    try {
      const [resumeRes, recentItems] = await Promise.all([
        getResumeItems(target.url, target.userId, target.accessToken, limitPerServer, {
          throwOnError: true,
        }),
        getRecentlyPlayedItems(target.url, target.userId, target.accessToken, limitPerServer, {
          throwOnError: true,
        }),
      ]);

      const byId = new Map<string, EmbyItem>();
      const rawCombined = [...(resumeRes.Items || []), ...(recentItems || [])];

      for (const it of rawCombined) {
        if (!it || !it.Id || !isVideoMedia(it)) continue;
        const existing = byId.get(it.Id);
        if (!existing) {
          byId.set(it.Id, { ...it });
          continue;
        }

        const existingPos = existing.UserData?.PlaybackPositionTicks || 0;
        const incomingPos = it.UserData?.PlaybackPositionTicks || 0;
        const existingMs = getLastPlayedMs(existing);
        const incomingMs = getLastPlayedMs(it);

        existing.UserData = {
          ...(existing.UserData || {}),
          ...(it.UserData || {}),
          PlaybackPositionTicks: Math.max(existingPos, incomingPos),
          Played:
            existingPos > 0
              ? existing.UserData?.Played
              : incomingPos > 0
              ? it.UserData?.Played
              : existing.UserData?.Played || it.UserData?.Played,
          LastPlayedDate:
            incomingMs >= existingMs
              ? it.UserData?.LastPlayedDate || existing.UserData?.LastPlayedDate
              : existing.UserData?.LastPlayedDate,
        };
        if (!existing.Overview && it.Overview) existing.Overview = it.Overview;
        if (!existing.RunTimeTicks && it.RunTimeTicks) existing.RunTimeTicks = it.RunTimeTicks;
        if (!existing.MediaSources && it.MediaSources) existing.MediaSources = it.MediaSources;
      }

      const sortedSingleServer = Array.from(byId.values()).sort(comparePlaybackRecency);
      const mergedBySeries = mergeMediaBySeries(sortedSingleServer).map((it) => ({
        ...it,
        ServerId: target.id,
        ServerName: target.name,
        ServerUrl: target.url,
      }));

      const durationMs = Math.round(performance.now() - startTime);
      return {
        serverId: target.id,
        serverName: target.name,
        ok: true,
        count: mergedBySeries.length,
        durationMs,
        items: mergedBySeries,
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      console.warn(`[getFederatedPlaybackHistory] Server ${target.name} (${target.id}) error:`, err);
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
  const stats: FederatedHistoryServerStat[] = [];
  const allItems: EmbyItem[] = [];

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { items, ...stat } = s.value;
      stats.push(stat);
      allItems.push(...items);
    }
  }

  allItems.sort(comparePlaybackRecency);

  return {
    items: allItems,
    stats,
  };
}

export interface LibraryItemsQueryOptions {
  startIndex?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'Ascending' | 'Descending';
  genres?: string[];
  years?: number[];
  filters?: string[];
  searchTerm?: string;
  includeItemTypes?: string;
}

/**
 * 分页检索指定媒体库的全部影视条目（支持排序、状态筛选、类型与年份过滤）
 */
export async function getLibraryItems(
  serverUrl: string,
  userId: string,
  parentId: string,
  accessToken: string,
  options: LibraryItemsQueryOptions = {}
): Promise<{ Items: EmbyItem[]; TotalRecordCount: number }> {
  const base = normalizeServerUrl(serverUrl);
  const params = new URLSearchParams();
  params.set('ParentId', parentId);
  params.set('Recursive', 'true');
  params.set('IncludeItemTypes', options.includeItemTypes || 'Movie,Series,Video,BoxSet');
  params.set('StartIndex', String(options.startIndex ?? 0));
  params.set('Limit', String(options.limit ?? 48));
  params.set('SortBy', options.sortBy || 'DateCreated,SortName');
  params.set('SortOrder', options.sortOrder || 'Descending');
  params.set(
    'Fields',
    'PrimaryImageAspectRatio,BasicSyncInfo,Overview,ChildCount,RecursiveItemCount,Status,CommunityRating,Genres,ProductionYear,PremiereDate,ImageTags'
  );

  if (options.genres && options.genres.length > 0) {
    params.set('Genres', options.genres.join('|'));
  }
  if (options.years && options.years.length > 0) {
    params.set('Years', options.years.join(','));
  }
  if (options.filters && options.filters.length > 0) {
    params.set('Filters', options.filters.join(','));
  }
  if (options.searchTerm && options.searchTerm.trim()) {
    params.set('SearchTerm', options.searchTerm.trim());
  }

  const url = `${base}/emby/Users/${userId}/Items?${params.toString()}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) {
    throw new Error(`加载媒体库列表失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  const rawItems: EmbyItem[] = Array.isArray(data?.Items) ? data.Items : [];
  return {
    Items: rawItems.filter(isVideoMedia),
    TotalRecordCount:
      typeof data?.TotalRecordCount === 'number' ? data.TotalRecordCount : rawItems.length,
  };
}

/**
 * 获取指定媒体库内的全部流派/类型标签列表
 */
export async function getLibraryGenres(
  serverUrl: string,
  userId: string,
  parentId: string,
  accessToken: string
): Promise<string[]> {
  try {
    const base = normalizeServerUrl(serverUrl);
    const params = new URLSearchParams({
      UserId: userId,
      ParentId: parentId,
      Recursive: 'true',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
    });
    const url = `${base}/emby/Genres?${params.toString()}`;
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.Items) ? data.Items : [];
    return items
      .map((g: { Name?: string }) => (typeof g?.Name === 'string' ? g.Name.trim() : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}


