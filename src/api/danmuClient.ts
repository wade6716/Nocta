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

export interface DanmuEpisode {
  episodeId: number | string;
  episodeTitle: string;
  episodeNumber?: string | number;
}

export interface DanmuAnimeSearchResult {
  animeId: number | string;
  animeTitle: string;
  type?: string;
  episodes?: DanmuEpisode[];
}

export interface ParsedDanmuEpisodeInfo {
  platform?: string;
  cleanTitle: string;
  episodeNumber?: number;
  shortLabel: string;
  badgeLabel: string;
  subTitle: string;
  isFallbackIndex: boolean;
}

const KNOWN_PLATFORM_TAG_RE =
  /^(?:bilibili\d*|qq|iqiyi|qiyi|youku|mgtv|bahamut|acfun|renren|hanju|dandan|b站|腾讯(?:视频)?|爱奇艺|优酷|芒果(?:tv)?|巴哈姆特?|人人|韩剧|弹弹|[a-z]{2,15}\d+)$/i;
const SPECIAL_TAG_GUARD_RE = /^(?:SP|OVA|OAD|PV|OP|ED|NCOP|NCED|CM|BD)\d*$/i;

function normalizeSubTitleText(raw: string): string {
  return raw
    .replace(/【\s*】|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:：·|｜/]+|[\s\-–—:：·|｜/]+$/g, '')
    .trim();
}

function formatNumericLabel(num: number): string {
  return Number.isInteger(num) ? String(num) : String(num);
}

/**
 * 结构化解析弹幕源分集标题：剥离【bilibili1】等平台来源前缀，提取规范集数与副标题
 */
export function parseDanmuEpisodeInfo(
  ep: DanmuEpisode,
  index: number
): ParsedDanmuEpisodeInfo {
  const rawTitle = (ep.episodeTitle || '').trim();
  let cleanTitle = rawTitle;
  let platform: string | undefined;
  let strippedAnyPrefix = false;

  // 循环剥离标题开头的平台来源前缀，保留 SP/OVA/OP/ED 等番外标记
  while (cleanTitle) {
    const tagMatch = cleanTitle.match(/^(?:【([^】]+)】|\[([^\]]+)\])\s*/);
    if (!tagMatch) break;
    const tagText = (tagMatch[1] ?? tagMatch[2] ?? '').trim();
    if (!tagText || SPECIAL_TAG_GUARD_RE.test(tagText)) break;
    if (!KNOWN_PLATFORM_TAG_RE.test(tagText)) break;

    if (!platform) platform = tagText;
    strippedAnyPrefix = true;
    cleanTitle = cleanTitle.slice(tagMatch[0].length).trim();
  }

  if (strippedAnyPrefix) {
    cleanTitle = cleanTitle.replace(/^[\s\-–—:：·|｜/]+/, '').trim();
  }

  // 1. 开头匹配：第188集 / 第 01 话 / 12.5集 (总集篇)
  const leadingChineseEp = cleanTitle.match(
    /^(?:第\s*)?0*(\d+(?:\.\d+)?)\s*(?:集|话|話|期|回|章|幕)(?:\s*[-–—:：·|｜/]*\s*(.*))?$/
  );
  if (leadingChineseEp) {
    const num = Number(leadingChineseEp[1]);
    if (Number.isFinite(num) && num > 0 && num < 10000) {
      const shortLabel = formatNumericLabel(num);
      return {
        platform,
        cleanTitle,
        episodeNumber: num,
        shortLabel,
        badgeLabel: `第${shortLabel}集`,
        subTitle: normalizeSubTitleText(leadingChineseEp[2] || ''),
        isFallbackIndex: false,
      };
    }
  }

  // 2. 任意位置匹配：第 X 集/话/期/回，保留其余部分为副标题
  const anywhereChineseEp = cleanTitle.match(/第\s*0*(\d+(?:\.\d+)?)\s*(?:集|话|話|期|回)/);
  if (anywhereChineseEp && anywhereChineseEp.index !== undefined) {
    const num = Number(anywhereChineseEp[1]);
    if (Number.isFinite(num) && num > 0 && num < 10000) {
      const shortLabel = formatNumericLabel(num);
      const rest = `${cleanTitle.slice(0, anywhereChineseEp.index)} ${cleanTitle.slice(
        anywhereChineseEp.index + anywhereChineseEp[0].length
      )}`;
      return {
        platform,
        cleanTitle,
        episodeNumber: num,
        shortLabel,
        badgeLabel: `第${shortLabel}集`,
        subTitle: normalizeSubTitleText(rest),
        isFallbackIndex: false,
      };
    }
  }

  // 3. 开头匹配：EP05 / E05 / EP 12
  const leadingEnglishEp = cleanTitle.match(
    /^(?:EP|E)\s*[-._#]*\s*0*(\d+(?:\.\d+)?)(?![a-zA-Z])(?:\s*[-–—:：·|｜/]*\s*(.*))?$/i
  );
  if (leadingEnglishEp) {
    const num = Number(leadingEnglishEp[1]);
    if (Number.isFinite(num) && num > 0 && num < 10000) {
      const shortLabel = formatNumericLabel(num);
      return {
        platform,
        cleanTitle,
        episodeNumber: num,
        shortLabel,
        badgeLabel: `第${shortLabel}集`,
        subTitle: normalizeSubTitleText(leadingEnglishEp[2] || ''),
        isFallbackIndex: false,
      };
    }
  }

  // 4. 开头纯数字：01 / 188 (副标题)，排除日期大数及 1080p 等后缀
  const leadingNumberEp = cleanTitle.match(
    /^0*(\d+(?:\.\d+)?)(?=$|\s|[-–—:：.·|｜/(\[【])(?:\s*[-–—:：.·|｜/]*\s*(.*))?$/
  );
  if (leadingNumberEp) {
    const num = Number(leadingNumberEp[1]);
    if (Number.isFinite(num) && num > 0 && num < 10000) {
      const shortLabel = formatNumericLabel(num);
      return {
        platform,
        cleanTitle,
        episodeNumber: num,
        shortLabel,
        badgeLabel: `第${shortLabel}集`,
        subTitle: normalizeSubTitleText(leadingNumberEp[2] || ''),
        isFallbackIndex: false,
      };
    }
  }

  // 5. 番外/特典开头：SP1 / OVA / PV / 番外 / 特别篇 等
  const specialPrefixEp = cleanTitle.match(
    /^(?:【|\[)?(SP|OVA|OAD|PV|番外|特别篇|特典|彩蛋)\s*0*(\d*)(?![a-zA-Z])(?:】|\])?(?:\s*[-–—:：·|｜/]*\s*(.*))?$/i
  );
  if (specialPrefixEp) {
    const rawKind = specialPrefixEp[1];
    const normKind = /^[a-z]+$/i.test(rawKind) ? rawKind.toUpperCase() : rawKind;
    const rawSpecialNum = specialPrefixEp[2];
    const markerLabel = rawSpecialNum ? `${normKind}${rawSpecialNum}` : normKind;
    return {
      platform,
      cleanTitle,
      episodeNumber: undefined,
      shortLabel: markerLabel,
      badgeLabel: markerLabel,
      subTitle: normalizeSubTitleText(specialPrefixEp[3] || ''),
      isFallbackIndex: false,
    };
  }

  // 6. 回退读取服务端附带的 episodeNumber 字段
  if (ep.episodeNumber !== undefined && String(ep.episodeNumber).trim() !== '') {
    const num = Number(ep.episodeNumber);
    if (Number.isFinite(num) && num > 0 && num < 10000) {
      const shortLabel = formatNumericLabel(num);
      return {
        platform,
        cleanTitle,
        episodeNumber: num,
        shortLabel,
        badgeLabel: `第${shortLabel}集`,
        subTitle: normalizeSubTitleText(cleanTitle),
        isFallbackIndex: false,
      };
    }
  }

  // 7. 最终序数兜底
  const fallbackShort = String(index + 1);
  return {
    platform,
    cleanTitle,
    episodeNumber: undefined,
    shortLabel: fallbackShort,
    badgeLabel: `#${fallbackShort}`,
    subTitle: normalizeSubTitleText(cleanTitle),
    isFallbackIndex: true,
  };
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
 * 4. 根据 commentId 拉取弹幕列表并附带源站视频时长 (GET /api/v2/comment/:id?format=json&duration=true&withRelated=true&chConvert=1)
 * 默认开启 withRelated=true 以聚合 B站、爱奇艺、腾讯等全网关联平台弹幕，开启 chConvert=1 进行简繁规范化
 */
export async function fetchCommentsById(
  config: DanmuConfig,
  commentId: string | number,
  options?: {
    withRelated?: boolean;
    chConvert?: number;
  }
): Promise<DanmuCommentResponse> {
  const withRelated = options?.withRelated ?? true;
  const chConvert = options?.chConvert ?? 1;
  const url = buildEndpoint(
    config,
    `/api/v2/comment/${commentId}?format=json&duration=true&withRelated=${withRelated}&chConvert=${chConvert}`
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
    fontWeight?: 'normal' | 'bold';
    strokeWidth?: number;
    fontFamily?: string;
    blockScroll?: boolean;
    blockTop?: boolean;
    blockBottom?: boolean;
    blockColor?: boolean;
    colorMode?: 'vibrant' | 'monochrome' | 'blocked';
    blockedWords?: (string | RegExp)[];
    mergeDuplicates?: boolean;
  } = {}
): FormattedDanmakuItem[] {
  const {
    fontSize = 24,
    fontWeight = 'bold',
    strokeWidth = 2.5,
    fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif',
    blockScroll = false,
    blockTop = false,
    blockBottom = false,
    blockColor = false,
    colorMode = 'vibrant',
    blockedWords = [],
    mergeDuplicates = true,
  } = options;

  interface ParsedCandidate {
    text: string;
    normText: string;
    time: number;
    mode: FormattedDanmakuItem['mode'];
    hexColor: string;
  }

  const candidates: ParsedCandidate[] = [];
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

    candidates.push({
      text: item.m,
      normText: item.m.trim().toLowerCase(),
      time,
      mode,
      hexColor,
    });
  }

  candidates.sort((a, b) => a.time - b.time);

  const fontPrefix = fontWeight === 'bold' ? 'bold ' : '';
  const result: FormattedDanmakuItem[] = [];

  if (!mergeDuplicates) {
    for (const c of candidates) {
      result.push({
        text: c.text,
        time: c.time,
        mode: c.mode,
        style: {
          font: `${fontPrefix}${fontSize}px ${fontFamily}`,
          fillStyle: c.hexColor,
          strokeStyle: 'rgba(0, 0, 0, 0.9)',
          lineWidth: strokeWidth,
          textBaseline: 'bottom',
        },
      });
    }
    return result;
  }

  // 3 秒滑动窗口重复弹幕智能合并防刷屏
  const windowMap = new Map<string, { resultIdx: number; firstTime: number; baseText: string; count: number }>();

  for (const c of candidates) {
    const existing = windowMap.get(c.normText);
    if (existing && c.time - existing.firstTime <= 3) {
      existing.count += 1;
      if (existing.count >= 3) {
        const target = result[existing.resultIdx];
        target.text = `${existing.baseText} ×${existing.count}`;
        target.style.lineWidth = Math.max(strokeWidth, 3);
      }
      continue;
    }

    const resultIdx = result.length;
    result.push({
      text: c.text,
      time: c.time,
      mode: c.mode,
      style: {
        font: `${fontPrefix}${fontSize}px ${fontFamily}`,
        fillStyle: c.hexColor,
        strokeStyle: 'rgba(0, 0, 0, 0.9)',
        lineWidth: strokeWidth,
        textBaseline: 'bottom',
      },
    });
    windowMap.set(c.normText, {
      resultIdx,
      firstTime: c.time,
      baseText: c.text,
      count: 1,
    });
  }

  return result;
}

/**
 * 7. 计算进度条高能弹幕密度分布曲线 (归一化到 0 ~ 1)
 */
export function computeDanmakuHeatmap(
  rawComments: RawDanmuComment[],
  durationSeconds: number,
  bucketCount = 100
): number[] {
  if (!durationSeconds || durationSeconds <= 0 || rawComments.length === 0 || bucketCount <= 0) {
    return [];
  }

  const buckets = new Array<number>(bucketCount).fill(0);
  for (const item of rawComments) {
    if (!item.p) continue;
    const t = parseFloat(item.p.split(',')[0]);
    if (!Number.isFinite(t) || t < 0) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t / durationSeconds) * bucketCount)));
    buckets[idx] += 1;
  }

  // 3 点移动平均平滑曲线
  const smoothed = new Array<number>(bucketCount).fill(0);
  let maxVal = 0;
  for (let i = 0; i < bucketCount; i++) {
    const prev = i > 0 ? buckets[i - 1] : buckets[i];
    const curr = buckets[i];
    const next = i < bucketCount - 1 ? buckets[i + 1] : buckets[i];
    const val = (prev + curr * 2 + next) / 4;
    smoothed[i] = val;
    if (val > maxVal) maxVal = val;
  }

  if (maxVal <= 0) return [];
  return smoothed.map((v) => v / maxVal);
}
