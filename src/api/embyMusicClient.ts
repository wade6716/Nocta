import { httpClient } from './http';
import {
  EmbyItem,
  FederatedSearchStats,
  FederatedServerTarget,
  buildEmbyHeaders,
  buildItemImageUrl,
  formatFileSize,
  getUserViews,
  isMusicLibraryView,
  isMusicMedia,
  normalizeServerUrl,
  ticksToSeconds,
} from './embyClient';
import { LyricLine, parseEmbyLyricsResponse } from '../music/lyricsUtils';

export type MusicSearchFilterType = 'All' | 'Audio' | 'MusicAlbum' | 'MusicArtist' | 'Playlist';

export interface FederatedMusicSearchResponse {
  items: EmbyItem[];
  stats: FederatedSearchStats[];
}

export interface AudioQualityBadgeInfo {
  label: string;
  isLossless: boolean;
  isHiRes: boolean;
  detail: string;
}

const MUSIC_ITEM_FIELDS =
  'PrimaryImageAspectRatio,BasicSyncInfo,MediaSources,Path,Overview,UserData,ImageTags,BackdropImageTags,Genres,Artists,ArtistItems,AlbumArtists,AlbumId,Album,AlbumPrimaryImageTag,ChildCount,RecursiveItemCount,ProductionYear,PremiereDate,RunTimeTicks,Container,Bitrate,MediaStreams';

const NATIVE_AUDIO_CONTAINERS = new Set([
  'mp3',
  'aac',
  'm4a',
  'mp4',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'webm',
]);

const MUSIC_VIEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const musicViewsCache = new Map<string, { views: EmbyItem[]; fetchedAt: number }>();

export function isStrictMusicAlbum(item?: EmbyItem | null): boolean {
  return Boolean(item && item.Type === 'MusicAlbum');
}

export function isStrictAudioTrack(item?: EmbyItem | null): boolean {
  return Boolean(item && item.Type === 'Audio' && item.MediaType !== 'Video');
}

export function isStrictMusicArtist(item?: EmbyItem | null): boolean {
  return Boolean(item && (item.Type === 'MusicArtist' || item.Type === 'Artist'));
}

export function isStrictMusicPlaylist(item?: EmbyItem | null): boolean {
  return Boolean(item && item.Type === 'Playlist' && item.MediaType !== 'Video');
}

async function resolveScopedMusicParentIds(
  serverUrl: string,
  userId: string,
  accessToken: string,
  explicitParentId?: string
): Promise<string[]> {
  if (explicitParentId) return [explicitParentId];
  try {
    const libs = await getMusicLibraries(serverUrl, userId, accessToken, true);
    return libs.map((l) => l.Id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 获取用户可用音乐库分类视图（带 5 分钟 TTL 缓存可选）
 */
export async function getMusicLibraries(
  serverUrl: string,
  userId: string,
  accessToken: string,
  useCache = false
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const cacheKey = `${base}::${userId}`;
  if (useCache) {
    const cached = musicViewsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < MUSIC_VIEWS_CACHE_TTL_MS) {
      return cached.views;
    }
  }
  const res = await getUserViews(serverUrl, userId, accessToken);
  const musicViews = (res.Items || []).filter(isMusicLibraryView);
  musicViewsCache.set(cacheKey, { views: musicViews, fetchedAt: Date.now() });
  return musicViews;
}

/**
 * 获取最新音乐专辑（严格限定在音乐库 ParentId 范围内，彻底避免 Emby Latest 接口混入电影/剧集）
 */
export async function getLatestMusicAlbums(
  serverUrl: string,
  userId: string,
  accessToken: string,
  parentId?: string,
  limit = 18
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });
  const parentIds = await resolveScopedMusicParentIds(serverUrl, userId, accessToken, parentId);
  if (parentIds.length === 0) return [];

  const tasks = parentIds.map(async (pid) => {
    const url = `${base}/emby/Users/${userId}/Items?ParentId=${encodeURIComponent(pid)}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
    const res = await httpClient(url, { method: 'GET', headers });
    if (!res.ok) return [] as EmbyItem[];
    const data = await res.json();
    return ((data.Items || []) as EmbyItem[]).filter(isStrictMusicAlbum);
  });

  const settled = await Promise.allSettled(tasks);
  const seen = new Set<string>();
  const merged: EmbyItem[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const it of r.value) {
        if (!seen.has(it.Id)) {
          seen.add(it.Id);
          merged.push(it);
        }
      }
    }
  }
  return merged.slice(0, limit);
}

/**
 * 分页获取音乐专辑列表（严格限定音乐库范围并过滤非专辑类型）
 */
export async function getMusicAlbums(
  serverUrl: string,
  userId: string,
  accessToken: string,
  opts: {
    parentId?: string;
    sortBy?: string;
    sortOrder?: 'Ascending' | 'Descending';
    startIndex?: number;
    limit?: number;
  } = {}
): Promise<{ Items: EmbyItem[]; TotalRecordCount: number }> {
  const base = normalizeServerUrl(serverUrl);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });
  const parentIds = await resolveScopedMusicParentIds(serverUrl, userId, accessToken, opts.parentId);
  if (parentIds.length === 0) return { Items: [], TotalRecordCount: 0 };

  const parentParam = parentIds.length === 1 ? `&ParentId=${encodeURIComponent(parentIds[0])}` : '';
  const sortBy = opts.sortBy || 'DateCreated';
  const sortOrder = opts.sortOrder || 'Descending';
  const startIndex = opts.startIndex || 0;
  const limit = opts.limit || 48;

  const url = `${base}/emby/Users/${userId}/Items?IncludeItemTypes=MusicAlbum${parentParam}&Recursive=true&SortBy=${encodeURIComponent(sortBy)}&SortOrder=${sortOrder}&StartIndex=${startIndex}&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers,
  });
  if (!res.ok) throw new Error(`获取专辑列表失败: ${res.status}`);
  const data = await res.json();
  const filtered = ((data.Items || []) as EmbyItem[]).filter(isStrictMusicAlbum);
  return {
    Items: filtered,
    TotalRecordCount: typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : filtered.length,
  };
}

/**
 * 分页获取音乐艺术家列表（限定音乐库范围，优先 AlbumArtists，失败时降级 Artists）
 */
export async function getMusicArtists(
  serverUrl: string,
  userId: string,
  accessToken: string,
  opts: {
    parentId?: string;
    sortBy?: string;
    sortOrder?: 'Ascending' | 'Descending';
    startIndex?: number;
    limit?: number;
  } = {}
): Promise<{ Items: EmbyItem[]; TotalRecordCount: number }> {
  const base = normalizeServerUrl(serverUrl);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });
  const parentIds = await resolveScopedMusicParentIds(serverUrl, userId, accessToken, opts.parentId);
  if (parentIds.length === 0) return { Items: [], TotalRecordCount: 0 };

  const parentParam = parentIds.length === 1 ? `&ParentId=${encodeURIComponent(parentIds[0])}` : '';
  const sortBy = opts.sortBy || 'SortName';
  const sortOrder = opts.sortOrder || 'Ascending';
  const startIndex = opts.startIndex || 0;
  const limit = opts.limit || 48;

  try {
    const albumArtistsUrl = `${base}/emby/Artists/AlbumArtists?UserId=${userId}${parentParam}&SortBy=${encodeURIComponent(sortBy)}&SortOrder=${sortOrder}&StartIndex=${startIndex}&Limit=${limit}&Fields=PrimaryImageAspectRatio,Overview,ImageTags,BackdropImageTags,Genres,UserData`;
    const res = await httpClient(albumArtistsUrl, { method: 'GET', headers });
    if (res.ok) {
      const data = await res.json();
      const filtered = ((data.Items || []) as EmbyItem[]).filter(isStrictMusicArtist);
      if (filtered.length > 0) {
        return {
          Items: filtered,
          TotalRecordCount: typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : filtered.length,
        };
      }
    }
  } catch (e) {
    console.warn('[getMusicArtists AlbumArtists fallback]', e);
  }

  const artistsUrl = `${base}/emby/Artists?UserId=${userId}${parentParam}&SortBy=${encodeURIComponent(sortBy)}&SortOrder=${sortOrder}&StartIndex=${startIndex}&Limit=${limit}&Fields=PrimaryImageAspectRatio,Overview,ImageTags,BackdropImageTags,Genres,UserData`;
  const res = await httpClient(artistsUrl, { method: 'GET', headers });
  if (!res.ok) throw new Error(`获取艺术家列表失败: ${res.status}`);
  const data = await res.json();
  const filtered = ((data.Items || []) as EmbyItem[]).filter(isStrictMusicArtist);
  return {
    Items: filtered,
    TotalRecordCount: typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : filtered.length,
  };
}

/**
 * 获取用户音频歌单列表
 */
export async function getMusicPlaylists(
  serverUrl: string,
  userId: string,
  accessToken: string,
  opts: { startIndex?: number; limit?: number } = {}
): Promise<{ Items: EmbyItem[]; TotalRecordCount: number }> {
  const base = normalizeServerUrl(serverUrl);
  const startIndex = opts.startIndex || 0;
  const limit = opts.limit || 48;
  const url = `${base}/emby/Users/${userId}/Items?IncludeItemTypes=Playlist&MediaTypes=Audio&Recursive=true&SortBy=DateCreated&SortOrder=Descending&StartIndex=${startIndex}&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取歌单列表失败: ${res.status}`);
  const data = await res.json();
  const filtered = ((data.Items || []) as EmbyItem[]).filter(isStrictMusicPlaylist);
  return {
    Items: filtered,
    TotalRecordCount: typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : filtered.length,
  };
}

/**
 * 获取我喜欢的歌曲
 */
export async function getFavoriteMusicSongs(
  serverUrl: string,
  userId: string,
  accessToken: string,
  opts: { startIndex?: number; limit?: number } = {}
): Promise<{ Items: EmbyItem[]; TotalRecordCount: number }> {
  const base = normalizeServerUrl(serverUrl);
  const startIndex = opts.startIndex || 0;
  const limit = opts.limit || 100;
  const url = `${base}/emby/Users/${userId}/Items?IncludeItemTypes=Audio&MediaTypes=Audio&Filters=IsFavorite&Recursive=true&SortBy=DateCreated&SortOrder=Descending&StartIndex=${startIndex}&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取喜欢歌曲失败: ${res.status}`);
  const data = await res.json();
  const filtered = ((data.Items || []) as EmbyItem[]).filter(isStrictAudioTrack);
  return {
    Items: filtered,
    TotalRecordCount: typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : filtered.length,
  };
}

/**
 * 获取最近播放的音乐曲目
 */
export async function getRecentlyPlayedMusic(
  serverUrl: string,
  userId: string,
  accessToken: string,
  limit = 12
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const parentIds = await resolveScopedMusicParentIds(serverUrl, userId, accessToken);
  if (parentIds.length === 0) return [];
  const parentParam = parentIds.length === 1 ? `&ParentId=${encodeURIComponent(parentIds[0])}` : '';
  const url = `${base}/emby/Users/${userId}/Items?IncludeItemTypes=Audio&MediaTypes=Audio${parentParam}&Recursive=true&SortBy=DatePlayed&SortOrder=Descending&Filters=IsPlayed&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return ((data.Items || []) as EmbyItem[]).filter(isStrictAudioTrack);
}

/**
 * 随机获取一批音乐曲目（用于随心听/随机漫游）
 */
export async function getRandomMusicTracks(
  serverUrl: string,
  userId: string,
  accessToken: string,
  parentId?: string,
  limit = 40
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const parentIds = await resolveScopedMusicParentIds(serverUrl, userId, accessToken, parentId);
  if (parentIds.length === 0) return [];
  const parentParam = parentIds.length === 1 ? `&ParentId=${encodeURIComponent(parentIds[0])}` : '';
  const url = `${base}/emby/Users/${userId}/Items?IncludeItemTypes=Audio&MediaTypes=Audio${parentParam}&Recursive=true&SortBy=Random&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取随机曲目失败: ${res.status}`);
  const data = await res.json();
  return ((data.Items || []) as EmbyItem[]).filter(isStrictAudioTrack);
}

/**
 * 获取音乐条目详情（专辑、歌手、歌单或单曲）
 */
export async function getMusicItemDetail(
  serverUrl: string,
  userId: string,
  itemId: string,
  accessToken: string
): Promise<EmbyItem> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Users/${userId}/Items/${encodeURIComponent(itemId)}?Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取音乐详情失败: ${res.status}`);
  return res.json();
}

/**
 * 获取专辑内全部曲目（按碟片与曲序排列）
 */
export async function getAlbumTracks(
  serverUrl: string,
  userId: string,
  albumId: string,
  accessToken: string
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Users/${userId}/Items?ParentId=${encodeURIComponent(albumId)}&IncludeItemTypes=Audio&Recursive=true&SortBy=ParentIndexNumber,IndexNumber,SortName&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) throw new Error(`获取专辑曲目失败: ${res.status}`);
  const data = await res.json();
  return data.Items || [];
}

/**
 * 获取艺术家下属全部专辑
 */
export async function getArtistAlbums(
  serverUrl: string,
  userId: string,
  artistId: string,
  accessToken: string
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });

  const primaryUrl = `${base}/emby/Users/${userId}/Items?AlbumArtistIds=${encodeURIComponent(artistId)}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=ProductionYear,SortName&SortOrder=Descending&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(primaryUrl, { method: 'GET', headers });
  if (res.ok) {
    const data = await res.json();
    if (Array.isArray(data.Items) && data.Items.length > 0) {
      return data.Items;
    }
  }

  const fallbackUrl = `${base}/emby/Users/${userId}/Items?ArtistIds=${encodeURIComponent(artistId)}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=ProductionYear,SortName&SortOrder=Descending&Fields=${MUSIC_ITEM_FIELDS}`;
  const fallbackRes = await httpClient(fallbackUrl, { method: 'GET', headers });
  if (!fallbackRes.ok) return [];
  const fallbackData = await fallbackRes.json();
  return fallbackData.Items || [];
}

/**
 * 获取艺术家热门歌曲
 */
export async function getArtistTopTracks(
  serverUrl: string,
  userId: string,
  artistId: string,
  accessToken: string,
  limit = 15
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Users/${userId}/Items?ArtistIds=${encodeURIComponent(artistId)}&IncludeItemTypes=Audio&Recursive=true&SortBy=PlayCount,SortName&SortOrder=Descending&Limit=${limit}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, {
    method: 'GET',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.Items || [];
}

/**
 * 获取歌单内的歌曲列表
 */
export async function getPlaylistTracks(
  serverUrl: string,
  userId: string,
  playlistId: string,
  accessToken: string
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });
  const url = `${base}/emby/Playlists/${encodeURIComponent(playlistId)}/Items?UserId=${userId}&Fields=${MUSIC_ITEM_FIELDS}`;
  const res = await httpClient(url, { method: 'GET', headers });
  if (res.ok) {
    const data = await res.json();
    return (data.Items || []).filter((it: EmbyItem) => it.Type === 'Audio' || it.MediaType === 'Audio');
  }

  const fallbackUrl = `${base}/emby/Users/${userId}/Items?ParentId=${encodeURIComponent(playlistId)}&IncludeItemTypes=Audio&Fields=${MUSIC_ITEM_FIELDS}`;
  const fallbackRes = await httpClient(fallbackUrl, { method: 'GET', headers });
  if (!fallbackRes.ok) throw new Error(`获取歌单曲目失败: ${fallbackRes.status}`);
  const fallbackData = await fallbackRes.json();
  return fallbackData.Items || [];
}

/**
 * 同步红心收藏状态到 Emby 服务器
 */
export async function setItemFavorite(
  serverUrl: string,
  userId: string,
  itemId: string,
  isFavorite: boolean,
  accessToken: string
): Promise<boolean> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Users/${userId}/FavoriteItems/${encodeURIComponent(itemId)}`;
  const res = await httpClient(url, {
    method: isFavorite ? 'POST' : 'DELETE',
    headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
  });
  if (!res.ok) {
    throw new Error(`更新收藏状态失败: ${res.status}`);
  }
  return true;
}

/**
 * 构造音频播放候选地址列表（原文件直出 -> Emby Universal -> MP3 转流兜底）
 */
export function buildAudioStreamCandidates(
  serverUrl: string,
  userId: string,
  item: EmbyItem,
  accessToken: string
): string[] {
  const base = normalizeServerUrl(serverUrl);
  const id = encodeURIComponent(item.Id);
  const token = encodeURIComponent(accessToken);
  const ms = item.MediaSources?.[0];
  const rawContainer = (ms?.Container || item.Container || '').toLowerCase().split(',')[0].trim();
  const pathExtMatch = (ms?.Path || '').match(/\.([a-z0-9]{2,5})$/i);
  const container = rawContainer || (pathExtMatch ? pathExtMatch[1].toLowerCase() : '');

  const candidates: string[] = [];

  if (container && NATIVE_AUDIO_CONTAINERS.has(container)) {
    const msParam = ms?.Id ? `&MediaSourceId=${encodeURIComponent(ms.Id)}` : '';
    candidates.push(
      `${base}/emby/Audio/${id}/stream.${container}?static=true${msParam}&api_key=${token}&X-Emby-Token=${token}`
    );
  }

  candidates.push(
    `${base}/emby/Audio/${id}/universal?UserId=${encodeURIComponent(userId)}&Container=opus,mp3,aac,m4a,flac,wav,ogg&AudioCodec=aac&MaxStreamingBitrate=320000&TranscodingContainer=mp3&TranscodingProtocol=http&api_key=${token}&X-Emby-Token=${token}`
  );

  candidates.push(
    `${base}/emby/Audio/${id}/stream.mp3?AudioCodec=mp3&AudioBitRate=320000&api_key=${token}&X-Emby-Token=${token}`
  );

  return Array.from(new Set(candidates));
}

/**
 * 拉取歌曲时间轴歌词（兼容 Emby/Jellyfin JSON 与纯 LRC 文本）
 */
export async function getAudioLyrics(
  serverUrl: string,
  userId: string,
  itemId: string,
  accessToken: string
): Promise<LyricLine[]> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/emby/Audio/${encodeURIComponent(itemId)}/Lyrics`;
  try {
    const res = await httpClient(url, {
      method: 'GET',
      headers: buildEmbyHeaders(userId, accessToken, { serverUrl: base }),
    });
    if (!res.ok) return [];
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      return parseEmbyLyricsResponse(json);
    }
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      return parseEmbyLyricsResponse(parsed);
    } catch {
      return parseEmbyLyricsResponse(text);
    }
  } catch {
    return [];
  }
}

/**
 * 解析音乐封面图片（严格校验 Tag 存在性，歌曲缺图时回退所属专辑封面，杜绝 Emby 500）
 */
export function resolveMusicCoverUrl(
  serverUrl: string,
  item?: EmbyItem | null,
  options: { maxWidth?: number; quality?: number } = {}
): string {
  if (!serverUrl || !item?.Id) return '';
  const maxWidth = options.maxWidth || 400;
  const quality = options.quality || 85;

  if (item.ImageTags?.Primary) {
    return buildItemImageUrl(serverUrl, item.Id, item.ImageTags.Primary, {
      type: 'Primary',
      maxWidth,
      quality,
    });
  }

  if (item.Type === 'Audio' && item.AlbumId && item.AlbumPrimaryImageTag) {
    return buildItemImageUrl(serverUrl, item.AlbumId, item.AlbumPrimaryImageTag, {
      type: 'Primary',
      maxWidth,
      quality,
    });
  }

  if (item.ImageTags?.Thumb) {
    return buildItemImageUrl(serverUrl, item.Id, item.ImageTags.Thumb, {
      type: 'Thumb',
      maxWidth,
      quality,
    });
  }

  const backdropTag = item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop;
  if (backdropTag) {
    return buildItemImageUrl(serverUrl, item.Id, backdropTag, {
      type: 'Backdrop',
      maxWidth: Math.max(maxWidth, 800),
      quality,
    });
  }

  return '';
}

/**
 * 格式化音频音质徽章（Hi-Res / FLAC / ALAC / MP3 / AAC 等）
 */
export function formatAudioQualityBadge(item?: EmbyItem | null): AudioQualityBadgeInfo | null {
  if (!item) return null;
  const ms = item.MediaSources?.[0];
  const audioStream = (ms?.MediaStreams || item.MediaStreams || []).find((s) => s.Type === 'Audio');
  const rawCodec = (audioStream?.Codec || ms?.Container || item.Container || '').toLowerCase();
  const bitrate = audioStream?.BitRate || ms?.Bitrate || item.Bitrate || 0;
  const sampleRate = audioStream?.SampleRate || 0;
  const bitDepth = audioStream?.BitDepth || 0;
  const sizeLabel = formatFileSize(ms?.Size || item.Size);

  const isLosslessCodec = ['flac', 'alac', 'wav', 'ape', 'dsd', 'dsf', 'dff', 'pcm', 'aiff', 'wv'].some(
    (c) => rawCodec.includes(c)
  );
  const isHiRes = isLosslessCodec && (bitDepth >= 24 || sampleRate >= 48000);

  const codecLabel = rawCodec ? rawCodec.toUpperCase() : '';
  const detailParts: string[] = [];
  if (codecLabel) detailParts.push(codecLabel);
  if (bitDepth > 0) detailParts.push(`${bitDepth}-bit`);
  if (sampleRate > 0) detailParts.push(`${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)}kHz`);
  if (bitrate > 0) detailParts.push(`${Math.round(bitrate / 1000)} kbps`);
  if (sizeLabel) detailParts.push(sizeLabel);

  let label = codecLabel;
  if (isHiRes) {
    label = 'Hi-Res';
  } else if (isLosslessCodec) {
    label = codecLabel || 'SQ 无损';
  } else if (bitrate >= 280000 && codecLabel) {
    label = `${codecLabel} ${Math.round(bitrate / 1000)}k`;
  }

  if (!label && detailParts.length === 0) return null;
  return {
    label: label || 'AUDIO',
    isLossless: isLosslessCodec,
    isHiRes,
    detail: detailParts.join(' · '),
  };
}

/**
 * 格式化音乐时长为 mm:ss 或 hh:mm:ss
 */
export function formatMusicDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function getTrackDurationSeconds(item?: EmbyItem | null): number {
  if (!item?.RunTimeTicks) return 0;
  return ticksToSeconds(item.RunTimeTicks);
}

/**
 * 提取歌曲/专辑的艺术家显示名
 */
export function formatTrackArtists(item?: EmbyItem | null): string {
  if (!item) return '未知艺术家';
  if (Array.isArray(item.Artists) && item.Artists.length > 0) {
    return item.Artists.join(' / ');
  }
  if (item.AlbumArtist) return item.AlbumArtist;
  if (Array.isArray(item.AlbumArtists) && item.AlbumArtists.length > 0) {
    return item.AlbumArtists.map((a) => a.Name).join(' / ');
  }
  if (Array.isArray(item.ArtistItems) && item.ArtistItems.length > 0) {
    return item.ArtistItems.map((a) => a.Name).join(' / ');
  }
  return '未知艺术家';
}

/**
 * 单服独立音乐聚合搜索
 */
export async function searchMusicItems(
  serverUrl: string,
  userId: string,
  accessToken: string,
  params: {
    keyword: string;
    filterType?: MusicSearchFilterType;
    parentId?: string;
    views?: EmbyItem[];
    limit?: number;
  }
): Promise<EmbyItem[]> {
  const base = normalizeServerUrl(serverUrl);
  const cleanTerm = params.keyword.trim();
  if (!cleanTerm) return [];

  let includeTypes = 'Audio,MusicAlbum,MusicArtist,Playlist';
  if (params.filterType && params.filterType !== 'All') {
    includeTypes = params.filterType;
  }

  const limit = params.limit || 80;
  const encodedTerm = encodeURIComponent(cleanTerm);
  const headers = buildEmbyHeaders(userId, accessToken, { serverUrl: base });

  let musicViews = params.views;
  if (!musicViews) {
    try {
      musicViews = await getMusicLibraries(serverUrl, userId, accessToken, true);
    } catch {
      musicViews = [];
    }
  }

  const tasks: Promise<EmbyItem[]>[] = [];

  // 1. 仅在音乐库 ParentId 范围内检索音乐条目（防止混入影视库条目）
  const targetViews =
    params.parentId && params.parentId !== 'All'
      ? musicViews.filter((v) => v.Id === params.parentId)
      : musicViews;

  for (const v of targetViews) {
    const viewUrl = `${base}/emby/Users/${userId}/Items?ParentId=${encodeURIComponent(v.Id)}&SearchTerm=${encodedTerm}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=${Math.min(limit, 50)}&Fields=${MUSIC_ITEM_FIELDS}`;
    tasks.push(
      httpClient(viewUrl, { method: 'GET', headers })
        .then(async (res) => (res.ok ? (await res.json()).Items || [] : []))
        .catch(() => [])
    );
  }

  // 2. 音频歌单检索（全局但限定 MediaTypes=Audio）
  if (params.filterType === 'All' || params.filterType === 'Playlist') {
    const playlistUrl = `${base}/emby/Users/${userId}/Items?SearchTerm=${encodedTerm}&IncludeItemTypes=Playlist&MediaTypes=Audio&Recursive=true&Limit=20&Fields=${MUSIC_ITEM_FIELDS}`;
    tasks.push(
      httpClient(playlistUrl, { method: 'GET', headers })
        .then(async (res) => (res.ok ? (await res.json()).Items || [] : []))
        .catch(() => [])
    );
  }

  // 3. 艺术家模糊搜索接口补充（限定音乐库）
  if ((params.filterType === 'All' || params.filterType === 'MusicArtist') && targetViews.length > 0) {
    const parentParam = targetViews.length === 1 ? `&ParentId=${encodeURIComponent(targetViews[0].Id)}` : '';
    const artistUrl = `${base}/emby/Artists?UserId=${userId}${parentParam}&SearchTerm=${encodedTerm}&Limit=20&Fields=PrimaryImageAspectRatio,ImageTags,Overview,UserData`;
    tasks.push(
      httpClient(artistUrl, { method: 'GET', headers })
        .then(async (res) => (res.ok ? (await res.json()).Items || [] : []))
        .catch(() => [])
    );
  }

  const settled = await Promise.allSettled(tasks);
  const itemMap = new Map<string, EmbyItem>();

  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const it of r.value) {
        if (!it || !it.Id || !isMusicMedia(it)) continue;
        const validStrict =
          isStrictAudioTrack(it) ||
          isStrictMusicAlbum(it) ||
          isStrictMusicArtist(it) ||
          isStrictMusicPlaylist(it);
        if (!validStrict) continue;
        const id = String(it.Id);
        if (!itemMap.has(id)) {
          itemMap.set(id, { ...it, Id: id });
        }
      }
    }
  }

  return Array.from(itemMap.values());
}

/**
 * 跨服并行音乐聚合检索
 */
export async function searchFederatedMusicItems(
  targets: FederatedServerTarget[],
  params: {
    keyword: string;
    filterType?: MusicSearchFilterType;
    limitPerServer?: number;
    timeoutMs?: number;
    onServerResult?: (payload: { stat: FederatedSearchStats; items: EmbyItem[] }) => void;
  }
): Promise<FederatedMusicSearchResponse> {
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
        searchMusicItems(target.url, target.userId, target.accessToken, {
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
      if (timer !== undefined) clearTimeout(timer);
    }
  });

  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      stats.push(s.value.stat);
      allResults.push(...s.value.items);
    }
  }

  return { items: allResults, stats };
}
