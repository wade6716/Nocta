import { httpClient } from './http';

export interface DanmuConfig {
  baseUrl: string; // 例如 "http://127.0.0.1:9321/87654321" 或远程地址（Token 直接写在地址中）
  token?: string; // 兼容历史字段
  preferredPlatform?: string; // "bilibili1" | "qiyi" | "qq" | "youku" | "bahamut"
}

export interface RawDanmuComment {
  cid: number;
  p: string; // "出现秒数,模式(1滚动/4底部/5顶部),字号,十进制颜色,时间戳,弹幕池,用户Hash,弹幕ID"
  m: string; // 弹幕正文
}

export interface DanmuCommentResponse {
  count: number;
  comments: RawDanmuComment[];
  videoDuration?: number; // 当请求带 duration=true 时返回源站视频时长（秒）
}

export interface FormattedDanmakuItem {
  text: string;
  time: number;
  mode: 'rtl' | 'ltr' | 'top' | 'bottom';
  style: {
    font: string;
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    textBaseline: CanvasTextBaseline;
  };
}

export interface DanmuAnimeMatch {
  episodeId: number | string;
  animeTitle?: string;
  episodeTitle?: string;
}

export interface DanmuAnimeSearchResult {
  animeId: number | string;
  animeTitle: string;
  type?: string;
  episodes?: Array<{
    episodeId: number | string;
    episodeTitle: string;
  }>;
}

// 规范化拼接 API 路径（Token 直接包含在 baseUrl 地址中）
function buildEndpoint(config: DanmuConfig, path: string): string {
  let base = (config.baseUrl || 'http://127.0.0.1:9321/87654321').replace(/\/+$/, '');
  // 若有历史遗留单独 token 且 base 未包含，则平滑兼容追加
  if (config.token && !base.endsWith(`/${config.token}`)) {
    base = `${base}/${config.token.replace(/^\/+|\/+$/g, '')}`;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * 1. 自动匹配剧集弹幕 ID (POST /api/v2/match)
 * 支持传入剧集名与季集，或原始文件名
 */
export async function autoMatchEpisode(
  config: DanmuConfig,
  params: {
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    fileName?: string;
  }
): Promise<DanmuAnimeMatch | null> {
  let queryName = params.fileName || '';
  if (params.seriesName && params.episodeNumber !== undefined) {
    const s = String(params.seasonNumber ?? 1).padStart(2, '0');
    const e = String(params.episodeNumber).padStart(2, '0');
    queryName = `${params.seriesName} S${s}E${e}`;
  }
  if (config.preferredPlatform) {
    queryName = `${queryName} @${config.preferredPlatform}`;
  }

  const url = buildEndpoint(config, '/api/v2/match');
  try {
    const res = await httpClient(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: queryName.trim() }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data?.isMatched && data?.matches?.length > 0) {
      const best = data.matches[0];
      return {
        episodeId: best.episodeId,
        animeTitle: best.animeTitle,
        episodeTitle: best.episodeTitle,
      };
    }
  } catch (err) {
    console.warn('[Danmu Match Failed]', err);
  }
  return null;
}

/**
 * 2. 手动按关键词搜索影视/番剧 (GET /api/v2/search/anime?keyword=...)
 */
export async function searchDanmuAnime(
  config: DanmuConfig,
  keyword: string
): Promise<{ animes: DanmuAnimeSearchResult[] }> {
  const url = buildEndpoint(
    config,
    `/api/v2/search/anime?keyword=${encodeURIComponent(keyword.trim())}`
  );
  const res = await httpClient(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

/**
 * 3. 获取指定番剧的分集列表 (GET /api/v2/bangumi/:animeId)
 */
export async function getDanmuBangumiEpisodes(
  config: DanmuConfig,
  animeId: string | number
): Promise<{ bangumi: DanmuAnimeSearchResult }> {
  const url = buildEndpoint(config, `/api/v2/bangumi/${animeId}`);
  const res = await httpClient(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Get bangumi failed: ${res.status}`);
  return res.json();
}

/**
 * 4. 根据 commentId 拉取弹幕列表并附带源站视频时长 (GET /api/v2/comment/:id?format=json&duration=true)
 */
export async function fetchCommentsById(
  config: DanmuConfig,
  commentId: string | number
): Promise<DanmuCommentResponse> {
  const url = buildEndpoint(
    config,
    `/api/v2/comment/${commentId}?format=json&duration=true`
  );
  const res = await httpClient(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Fetch comments failed: ${res.status}`);
  return res.json();
}

/**
 * 5. 通过第三方视频网页链接直接获取弹幕 (GET /api/v2/comment?url=...&format=json)
 * 支持多链接合并或尾部附带 @-10 时间偏移
 */
export async function fetchCommentsByVideoUrl(
  config: DanmuConfig,
  videoPageUrl: string
): Promise<DanmuCommentResponse> {
  const url = buildEndpoint(
    config,
    `/api/v2/comment?url=${encodeURIComponent(videoPageUrl.trim())}&format=json`
  );
  const res = await httpClient(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Fetch URL comments failed: ${res.status}`);
  return res.json();
}

/**
 * 6. 将 danmu_api 的返回体转换为 wade6716/Danmaku 的 Canvas 渲染格式
 */
export function transformToDanmakuItems(
  rawComments: RawDanmuComment[],
  options: {
    fontSize?: number;
    fontFamily?: string;
    blockScroll?: boolean;
    blockTop?: boolean;
    blockBottom?: boolean;
    blockColor?: boolean;
    colorMode?: 'vibrant' | 'monochrome' | 'blocked';
    blockedWords?: (string | RegExp)[];
  } = {}
): FormattedDanmakuItem[] {
  const {
    fontSize = 24,
    fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif',
    blockScroll = false,
    blockTop = false,
    blockBottom = false,
    blockColor = false,
    colorMode = 'vibrant',
    blockedWords = [],
  } = options;

  const result: FormattedDanmakuItem[] = [];
  const effectiveColorMode = colorMode || (blockColor ? 'blocked' : 'vibrant');

  for (const item of rawComments) {
    if (!item.m || !item.p) continue;

    // 客户端屏蔽词过滤
    const isBlocked = blockedWords.some((rule) =>
      typeof rule === 'string' ? item.m.includes(rule) : rule.test(item.m)
    );
    if (isBlocked) continue;

    const parts = item.p.split(',');
    const time = parseFloat(parts[0]) || 0;
    const rawType = parseInt(parts[1], 10);
    const decimalColor = parseInt(parts[3], 10) || 16777215;

    const mode: FormattedDanmakuItem['mode'] =
      rawType === 4 ? 'bottom' : rawType === 5 ? 'top' : 'rtl';

    if (mode === 'rtl' && blockScroll) continue;
    if (mode === 'top' && blockTop) continue;
    if (mode === 'bottom' && blockBottom) continue;

    // 彩色模式处理
    if (effectiveColorMode === 'blocked' && decimalColor !== 16777215) {
      continue;
    }

    let hexColor: string;
    if (effectiveColorMode === 'monochrome') {
      hexColor = '#FFFFFF';
    } else {
      hexColor = `#${decimalColor.toString(16).padStart(6, '0')}`;
    }

    result.push({
      text: item.m,
      time,
      mode,
      style: {
        font: `bold ${fontSize}px ${fontFamily}`,
        fillStyle: hexColor,
        strokeStyle: 'rgba(0, 0, 0, 0.9)',
        lineWidth: 2.5,
        textBaseline: 'bottom',
      },
    });
  }

  return result.sort((a, b) => a.time - b.time);
}
