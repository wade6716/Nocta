import { httpClient } from './http';
import {
  buildDanmuSearchKeywords,
  DurationMatchGrade,
  evaluateDurationMatch,
  isHighConfidenceMatch,
  rankMatchingEpisodes,
  scoreMatchedCandidate,
  shouldTriggerStage2Fallback,
  Stage1FallbackReason,
} from './danmuMatchPolicy';
import {
  isRetryableDanmuTransportError,
  normalizeDanmuServerKey,
  orderDanmuServersForAutoMatch,
  recordServerFailure,
  recordServerSuccess,
} from './danmuServerHealth';

export class DanmuHttpError extends Error {
  status?: number;
  isTimeout: boolean;

  constructor(message: string, opts?: { status?: number; isTimeout?: boolean }) {
    super(message);
    this.name = 'DanmuHttpError';
    this.status = opts?.status;
    this.isTimeout = Boolean(opts?.isTimeout);
  }
}

async function fetchDanmuJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ data: T; latencyMs: number }> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const startedAt = Date.now();
  try {
    const res = await httpClient(url, {
      ...init,
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!res.ok) {
      throw new DanmuHttpError(`HTTP ${res.status}`, { status: res.status });
    }
    const data = (await res.json()) as T;
    return { data, latencyMs };
  } catch (err: any) {
    if (timedOut) {
      throw new DanmuHttpError(`Request timeout after ${timeoutMs}ms`, {
        status: 408,
        isTimeout: true,
      });
    }
    if (err instanceof DanmuHttpError) {
      throw err;
    }
    throw new DanmuHttpError(err?.message || 'Network request failed', {
      status: typeof err?.status === 'number' ? err.status : undefined,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

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

export interface DanmuAutoMatchResult extends DanmuAnimeMatch {
  matchedBy: 'match_api' | 'keyword_search';
  animeId?: number | string;
  episodes?: DanmuEpisode[];
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
 * 1. 自动匹配剧集弹幕候选列表 (POST /api/v2/match)
 * 提取前 3 个候选供后续时长校验与回退探测；网络/服务端异常将上抛以便故障转移
 */
export async function autoMatchEpisodeCandidates(
  config: DanmuConfig,
  params: {
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    fileName?: string;
  }
): Promise<DanmuAnimeMatch[]> {
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
  const { data, latencyMs } = await fetchDanmuJson<{
    isMatched?: boolean;
    matches?: Array<{ episodeId: number | string; animeTitle?: string; episodeTitle?: string }>;
  }>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: queryName.trim() }),
    },
    6000
  );

  recordServerSuccess(config.baseUrl, latencyMs);

  if (data?.isMatched && Array.isArray(data.matches) && data.matches.length > 0) {
    return data.matches.slice(0, 3).map((m) => ({
      episodeId: m.episodeId,
      animeTitle: m.animeTitle,
      episodeTitle: m.episodeTitle,
    }));
  }
  return [];
}

/**
 * 1b. 自动匹配剧集弹幕 ID (POST /api/v2/match) - 单结果兼容封装
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
  try {
    const candidates = await autoMatchEpisodeCandidates(config, params);
    return candidates[0] ?? null;
  } catch (err) {
    console.warn('[Danmu Match Failed]', err);
    return null;
  }
}

const SEASON_CHINESE_NUMERALS: Record<number, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
  10: '十',
};

function normalizeCompareText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractEpisodeNumberFromTitle(title?: string): number | undefined {
  const raw = (title || '').trim();
  if (!raw) return undefined;

  const patterns = [
    /S\d+E0*(\d+)/i,
    /第\s*0*(\d+)\s*(?:集|话|話|期|回)/,
    /(?:^|[\s._-])(?:EP|E)0*(\d+)(?![a-zA-Z0-9])/i,
  ];

  for (const re of patterns) {
    const match = raw.match(re);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > 0 && num < 10000) {
        return num;
      }
    }
  }

  return undefined;
}

export function cleanDanmuSearchKeyword(raw: string): string {
  return raw
    .trim()
    .replace(/[(（\[]\s*(?:19|20)\d{2}\s*[)）\]]/g, ' ')
    .replace(/(?<![a-zA-Z0-9])S\d{1,2}E\d{1,4}(?![a-zA-Z0-9])/gi, ' ')
    .replace(/\s*第\s*\d+\s*(?:集|话|話|期|回)\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreAnimeCandidate(
  anime: DanmuAnimeSearchResult,
  opts: {
    keyword: string;
    cleanedKeyword: string;
    seasonNumber?: number;
    year?: number;
    isMovie: boolean;
    preferredPlatform?: string;
  }
): number {
  const rawTitle = anime.animeTitle || '';
  const normTitle = normalizeCompareText(rawTitle);
  const normKeyword = normalizeCompareText(opts.keyword);
  const normCleaned = normalizeCompareText(opts.cleanedKeyword);
  const primaryKey = normCleaned || normKeyword;

  let score = 0;

  if (normTitle && ((normKeyword && normTitle === normKeyword) || (normCleaned && normTitle === normCleaned))) {
    score += 100;
  } else if (primaryKey && normTitle.startsWith(primaryKey)) {
    score += 60;
  } else if (primaryKey && normTitle.includes(primaryKey)) {
    score += 40;
  }

  if (opts.seasonNumber && opts.seasonNumber > 1) {
    const s = opts.seasonNumber;
    const cnNum = SEASON_CHINESE_NUMERALS[s];
    const seasonPatterns = [
      new RegExp(`第\\s*0*${s}\\s*(?:季|部)`, 'i'),
      new RegExp(`Season\\s*0*${s}(?!\\d)`, 'i'),
      new RegExp(`(?<![a-zA-Z])S0*${s}(?!\\d)`, 'i'),
      new RegExp(`\\s+0*${s}$`),
    ];
    if (cnNum) {
      seasonPatterns.push(new RegExp(`第\\s*${cnNum}\\s*(?:季|部)`));
    }
    if (seasonPatterns.some((re) => re.test(rawTitle))) {
      score += 50;
    }
  } else if (
    opts.seasonNumber === 1 &&
    /(?:第\s*(?:[2-9]|\d{2,})\s*季|第\s*[二三四五六七八九十]+\s*季|Season\s*(?:[2-9]|\d{2,})\b)/i.test(rawTitle)
  ) {
    score -= 35;
  }

  if (opts.year && rawTitle.includes(String(opts.year))) {
    score += 20;
  }

  const animeType = anime.type || '';
  if (opts.isMovie) {
    if (/(movie|电影|剧场)/i.test(animeType)) {
      score += 25;
    }
  } else if (/(tv|anime|剧|番|动漫|综艺)/i.test(animeType)) {
    score += 15;
  }

  const pref = (opts.preferredPlatform || '').trim().toLowerCase();
  if (pref && (normTitle.includes(pref) || animeType.toLowerCase().includes(pref))) {
    score += 15;
  }

  score -= Math.min(20, Math.abs(normTitle.length - primaryKey.length)) * 0.5;
  return score;
}

export function pickMatchingEpisode(
  episodes: DanmuEpisode[],
  episodeNumber?: number,
  isMovie?: boolean,
  preferredPlatform?: string
): DanmuEpisode | null {
  if (!episodes || episodes.length === 0) return null;

  const pref = (preferredPlatform || '').trim().toLowerCase();

  if (isMovie && episodeNumber === undefined) {
    if (pref) {
      const platMatch = episodes.find(
        (ep, idx) => parseDanmuEpisodeInfo(ep, idx).platform?.toLowerCase() === pref
      );
      if (platMatch) return platMatch;
    }
    return episodes[0];
  }

  if (episodeNumber !== undefined && episodeNumber > 0) {
    const parsedMatches = episodes
      .map((ep, idx) => ({ ep, parsed: parseDanmuEpisodeInfo(ep, idx) }))
      .filter((entry) => entry.parsed.episodeNumber === episodeNumber);

    if (parsedMatches.length > 0) {
      if (pref) {
        const platMatch = parsedMatches.find(
          (entry) => entry.parsed.platform?.toLowerCase() === pref
        );
        if (platMatch) return platMatch.ep;
      }
      return parsedMatches[0].ep;
    }

    if (episodes[episodeNumber - 1]) {
      return episodes[episodeNumber - 1];
    }

    return null;
  }

  return episodes[0];
}

/**
 * 两阶段弹幕自动匹配：
 * 1) 优先调用 POST /api/v2/match 快速精准匹配
 * 2) 未命中时自动回退关键词检索 (/api/v2/search/anime) + 分集列表 (/api/v2/bangumi/:id) + 智能评分选集
 */
export async function autoSearchAndMatchEpisode(
  config: DanmuConfig,
  params: {
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    fileName?: string;
    itemType?: string;
    productionYear?: number;
  },
  options?: {
    isCancelled?: () => boolean;
  }
): Promise<DanmuAutoMatchResult | null> {
  const isCancelled = options?.isCancelled;
  const isMovie =
    params.itemType === 'Movie' || (!params.seriesName && params.episodeNumber === undefined);
  const resolvedEpisodeNumber =
    typeof params.episodeNumber === 'number' && params.episodeNumber > 0
      ? params.episodeNumber
      : extractEpisodeNumberFromTitle(params.fileName);

  // Stage 1: 标准自动匹配接口
  const directMatch = await autoMatchEpisode(config, {
    seriesName: params.seriesName,
    seasonNumber: params.seasonNumber,
    episodeNumber: resolvedEpisodeNumber,
    fileName: params.fileName,
  });
  if (isCancelled?.()) return null;
  if (directMatch) {
    return {
      ...directMatch,
      matchedBy: 'match_api',
    };
  }

  // Stage 2: 关键词搜索与候选集数回退匹配（不向搜索关键词附加 @preferredPlatform）
  const baseRawKeyword = params.seriesName?.trim() || params.fileName?.trim() || '';
  const cleanedKeyword = baseRawKeyword ? cleanDanmuSearchKeyword(baseRawKeyword) : '';
  const candidateKeywords = Array.from(new Set([baseRawKeyword, cleanedKeyword].filter(Boolean)));
  if (candidateKeywords.length === 0) return null;

  let animes: DanmuAnimeSearchResult[] = [];
  let searchKeywordUsed = baseRawKeyword;

  for (const kw of candidateKeywords) {
    if (isCancelled?.()) return null;
    try {
      const searchRes = await searchDanmuAnime(config, kw);
      if (isCancelled?.()) return null;
      if (searchRes?.animes && searchRes.animes.length > 0) {
        animes = searchRes.animes;
        searchKeywordUsed = kw;
        break;
      }
    } catch (err) {
      console.warn('[Danmu Auto Search Failed]', kw, err);
    }
  }

  if (animes.length === 0) return null;

  const rankedCandidates = [...animes].sort((a, b) => {
    const scoreA = scoreAnimeCandidate(a, {
      keyword: searchKeywordUsed,
      cleanedKeyword: cleanedKeyword || searchKeywordUsed,
      seasonNumber: params.seasonNumber,
      year: params.productionYear,
      isMovie,
      preferredPlatform: config.preferredPlatform,
    });
    const scoreB = scoreAnimeCandidate(b, {
      keyword: searchKeywordUsed,
      cleanedKeyword: cleanedKeyword || searchKeywordUsed,
      seasonNumber: params.seasonNumber,
      year: params.productionYear,
      isMovie,
      preferredPlatform: config.preferredPlatform,
    });
    return scoreB - scoreA;
  });

  for (const candidate of rankedCandidates.slice(0, 3)) {
    if (isCancelled?.()) return null;

    let episodes = candidate.episodes || [];
    if (episodes.length === 0) {
      try {
        const bangumiRes = await getDanmuBangumiEpisodes(config, candidate.animeId);
        if (isCancelled?.()) return null;
        episodes = bangumiRes?.bangumi?.episodes || [];
      } catch (err) {
        console.warn('[Danmu Bangumi Fetch Failed]', candidate.animeId, err);
        continue;
      }
    }

    const matchedEp = pickMatchingEpisode(
      episodes,
      resolvedEpisodeNumber,
      isMovie,
      config.preferredPlatform
    );
    if (matchedEp) {
      return {
        episodeId: matchedEp.episodeId,
        animeTitle: candidate.animeTitle,
        episodeTitle: matchedEp.episodeTitle,
        matchedBy: 'keyword_search',
        animeId: candidate.animeId,
        episodes,
      };
    }
  }

  return null;
}

export interface DanmuAutoMatchFetchResult<TServer extends DanmuConfig & { id: string; name: string }> {
  match: DanmuAutoMatchResult;
  comments: RawDanmuComment[];
  videoDuration?: number;
  server: TServer;
  switchedFromPrimary: boolean;
  fallbackReason?: Stage1FallbackReason;
  durationGrade: DurationMatchGrade;
  score: number;
}

/**
 * 统一自动匹配与弹幕拉取编排：
 * - 两阶段时长校验纠偏：Stage 1 命中若 0 弹幕或时长偏差超阈值，保留保底并自动触发 Stage 2 关键词匹配与有界探测
 * - 多节点有序故障转移：按健康度熔断策略优先尝试主节点，异常/空结果时无缝切换至健康备用节点，高置信即刻短路
 */
export async function autoMatchAndFetchDanmu<
  TServer extends DanmuConfig & { id: string; name: string; latency?: number; status?: string },
>(
  servers: TServer[],
  activeServer: TServer,
  params: {
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    fileName?: string;
    itemType?: string;
    productionYear?: number;
    videoDurationSec?: number;
  },
  options?: {
    isCancelled?: () => boolean;
    maxServers?: number;
    maxStage2ProbesPerServer?: number;
  }
): Promise<DanmuAutoMatchFetchResult<TServer> | null> {
  const isCancelled = options?.isCancelled;
  const maxServers = options?.maxServers ?? 3;
  const maxStage2ProbesPerServer = options?.maxStage2ProbesPerServer ?? 4;
  const isMovie =
    params.itemType === 'Movie' || (!params.seriesName && params.episodeNumber === undefined);
  const resolvedEpisodeNumber =
    typeof params.episodeNumber === 'number' && params.episodeNumber > 0
      ? params.episodeNumber
      : extractEpisodeNumberFromTitle(params.fileName);

  const orderedServers = orderDanmuServersForAutoMatch(servers, activeServer).slice(0, maxServers);
  const primaryKey = normalizeDanmuServerKey(activeServer.baseUrl);
  let bestResult: DanmuAutoMatchFetchResult<TServer> | null = null;

  for (const server of orderedServers) {
    if (isCancelled?.()) return null;

    const switchedFromPrimary = normalizeDanmuServerKey(server.baseUrl) !== primaryKey;
    const probedEpisodeIds = new Set<string>();
    let serverHadTransportFailure = false;
    let stage1FallbackReason: Stage1FallbackReason | undefined;

    // Stage 1: POST /api/v2/match 提取前 2 个候选并拉取真实弹幕与时长校验
    let stage1Matches: DanmuAnimeMatch[] = [];
    try {
      stage1Matches = await autoMatchEpisodeCandidates(server, {
        seriesName: params.seriesName,
        seasonNumber: params.seasonNumber,
        episodeNumber: resolvedEpisodeNumber,
        fileName: params.fileName,
      });
    } catch (err: any) {
      if (isCancelled?.()) return null;
      if (isRetryableDanmuTransportError(err)) {
        recordServerFailure(server.baseUrl, err?.message || 'Match API failed');
        continue;
      }
      console.warn('[Danmu Stage1 Match Failed]', server.name, err);
    }
    if (isCancelled?.()) return null;

    for (const cand of stage1Matches.slice(0, 2)) {
      const epKey = String(cand.episodeId);
      if (probedEpisodeIds.has(epKey)) continue;
      probedEpisodeIds.add(epKey);

      try {
        const commentRes = await fetchCommentsById(server, cand.episodeId);
        if (isCancelled?.()) return null;

        const comments = commentRes.comments || [];
        const fallbackCheck = shouldTriggerStage2Fallback({
          sourceDuration: commentRes.videoDuration,
          videoDuration: params.videoDurationSec,
          commentCount: comments.length,
        });

        const candidateScore = scoreMatchedCandidate({
          sourceDuration: commentRes.videoDuration,
          videoDuration: params.videoDurationSec,
          commentCount: comments.length,
          episodeTitle: cand.episodeTitle,
          itemFileName: params.fileName,
          animeScore: 100,
          isStage1: true,
        });

        const candidateResult: DanmuAutoMatchFetchResult<TServer> = {
          match: {
            ...cand,
            matchedBy: 'match_api',
          },
          comments,
          videoDuration: commentRes.videoDuration,
          server,
          switchedFromPrimary,
          fallbackReason: stage1FallbackReason,
          durationGrade: fallbackCheck.evaluation.grade,
          score: candidateScore,
        };

        if (!bestResult || candidateResult.score > bestResult.score) {
          bestResult = candidateResult;
        }

        if (!fallbackCheck.shouldFallback) {
          return candidateResult;
        }

        if (!stage1FallbackReason && fallbackCheck.reason) {
          stage1FallbackReason = fallbackCheck.reason;
        }
      } catch (err: any) {
        if (isCancelled?.()) return null;
        if (isRetryableDanmuTransportError(err)) {
          recordServerFailure(server.baseUrl, err?.message || 'Fetch comments failed');
          serverHadTransportFailure = true;
          break;
        }
        console.warn('[Danmu Stage1 Probe Failed]', server.name, cand.episodeId, err);
      }
    }

    if (serverHadTransportFailure) {
      continue;
    }

    // Stage 2: 关键词多变体搜索 + 分集候选排序与有界探测
    const keywords = buildDanmuSearchKeywords({
      seriesName: params.seriesName,
      fileName: params.fileName,
      seasonNumber: params.seasonNumber,
      isMovie,
    });

    if (keywords.length > 0) {
      const cleanedBaseKeyword = cleanDanmuSearchKeyword(
        params.seriesName?.trim() || params.fileName?.trim() || ''
      );
      const animeMap = new Map<string, { anime: DanmuAnimeSearchResult; animeScore: number }>();
      let nonEmptySearchHits = 0;

      for (const kw of keywords) {
        if (isCancelled?.()) return null;
        try {
          const searchRes = await searchDanmuAnime(server, kw);
          if (isCancelled?.()) return null;

          const list = searchRes?.animes || [];
          if (list.length > 0) {
            nonEmptySearchHits += 1;
            let hasStrongHit = false;
            for (const anime of list) {
              const key = String(anime.animeId);
              const animeScore = scoreAnimeCandidate(anime, {
                keyword: kw,
                cleanedKeyword: cleanedBaseKeyword || kw,
                seasonNumber: params.seasonNumber,
                year: params.productionYear,
                isMovie,
                preferredPlatform: server.preferredPlatform,
              });
              if (animeScore >= 90) hasStrongHit = true;
              const prev = animeMap.get(key);
              if (!prev || animeScore > prev.animeScore) {
                animeMap.set(key, { anime, animeScore });
              }
            }
            if (hasStrongHit || nonEmptySearchHits >= 2) {
              break;
            }
          }
        } catch (err: any) {
          if (isCancelled?.()) return null;
          if (isRetryableDanmuTransportError(err)) {
            recordServerFailure(server.baseUrl, err?.message || `Search failed: ${kw}`);
            serverHadTransportFailure = true;
            break;
          }
          console.warn('[Danmu Stage2 Search Failed]', server.name, kw, err);
        }
      }

      if (serverHadTransportFailure) {
        continue;
      }

      const rankedAnimes = Array.from(animeMap.values())
        .sort((a, b) => b.animeScore - a.animeScore)
        .slice(0, 3);

      let stage2Probes = 0;
      for (const entry of rankedAnimes) {
        if (isCancelled?.()) return null;
        if (stage2Probes >= maxStage2ProbesPerServer || serverHadTransportFailure) break;

        const candidate = entry.anime;
        let episodes = candidate.episodes || [];
        if (episodes.length === 0) {
          try {
            const bangumiRes = await getDanmuBangumiEpisodes(server, candidate.animeId);
            if (isCancelled?.()) return null;
            episodes = bangumiRes?.bangumi?.episodes || [];
          } catch (err: any) {
            if (isCancelled?.()) return null;
            if (isRetryableDanmuTransportError(err)) {
              recordServerFailure(
                server.baseUrl,
                err?.message || `Bangumi failed: ${candidate.animeId}`
              );
              serverHadTransportFailure = true;
              break;
            }
            console.warn('[Danmu Stage2 Bangumi Failed]', server.name, candidate.animeId, err);
            continue;
          }
        }

        const candidateEpisodes = rankMatchingEpisodes(episodes, parseDanmuEpisodeInfo, {
          episodeNumber: resolvedEpisodeNumber,
          isMovie,
          preferredPlatform: server.preferredPlatform,
          itemFileName: params.fileName,
          limit: 3,
        });

        for (const ep of candidateEpisodes) {
          if (isCancelled?.()) return null;
          if (stage2Probes >= maxStage2ProbesPerServer || serverHadTransportFailure) break;

          const epKey = String(ep.episodeId);
          if (probedEpisodeIds.has(epKey)) continue;
          probedEpisodeIds.add(epKey);
          stage2Probes += 1;

          try {
            const commentRes = await fetchCommentsById(server, ep.episodeId);
            if (isCancelled?.()) return null;

            const comments = commentRes.comments || [];
            const evaluation = evaluateDurationMatch(
              commentRes.videoDuration,
              params.videoDurationSec
            );
            const candidateScore = scoreMatchedCandidate({
              sourceDuration: commentRes.videoDuration,
              videoDuration: params.videoDurationSec,
              commentCount: comments.length,
              episodeTitle: ep.episodeTitle,
              itemFileName: params.fileName,
              animeScore: entry.animeScore,
              isStage1: false,
            });

            const candidateResult: DanmuAutoMatchFetchResult<TServer> = {
              match: {
                episodeId: ep.episodeId,
                animeTitle: candidate.animeTitle,
                episodeTitle: ep.episodeTitle,
                matchedBy: 'keyword_search',
                animeId: candidate.animeId,
                episodes,
              },
              comments,
              videoDuration: commentRes.videoDuration,
              server,
              switchedFromPrimary,
              fallbackReason: stage1FallbackReason,
              durationGrade: evaluation.grade,
              score: candidateScore,
            };

            if (!bestResult || candidateResult.score > bestResult.score) {
              bestResult = candidateResult;
            }

            if (
              isHighConfidenceMatch({
                sourceDuration: commentRes.videoDuration,
                videoDuration: params.videoDurationSec,
                commentCount: comments.length,
              })
            ) {
              return candidateResult;
            }
          } catch (err: any) {
            if (isCancelled?.()) return null;
            if (isRetryableDanmuTransportError(err)) {
              recordServerFailure(
                server.baseUrl,
                err?.message || `Fetch comments failed: ${ep.episodeId}`
              );
              serverHadTransportFailure = true;
              break;
            }
            console.warn('[Danmu Stage2 Probe Failed]', server.name, ep.episodeId, err);
          }
        }
      }
    }

    if (
      bestResult &&
      isHighConfidenceMatch({
        sourceDuration: bestResult.videoDuration,
        videoDuration: params.videoDurationSec,
        commentCount: bestResult.comments.length,
      })
    ) {
      break;
    }
  }

  return bestResult;
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
  const { data, latencyMs } = await fetchDanmuJson<{ animes: DanmuAnimeSearchResult[] }>(
    url,
    { method: 'GET' },
    7000
  );
  recordServerSuccess(config.baseUrl, latencyMs);
  return data;
}

/**
 * 3. 获取指定番剧的分集列表 (GET /api/v2/bangumi/:animeId)
 */
export async function getDanmuBangumiEpisodes(
  config: DanmuConfig,
  animeId: string | number
): Promise<{ bangumi: DanmuAnimeSearchResult }> {
  const url = buildEndpoint(config, `/api/v2/bangumi/${animeId}`);
  const { data, latencyMs } = await fetchDanmuJson<{ bangumi: DanmuAnimeSearchResult }>(
    url,
    { method: 'GET' },
    6000
  );
  recordServerSuccess(config.baseUrl, latencyMs);
  return data;
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
  const { data, latencyMs } = await fetchDanmuJson<DanmuCommentResponse>(
    url,
    { method: 'GET' },
    10000
  );
  recordServerSuccess(config.baseUrl, latencyMs);
  return data;
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
  const { data, latencyMs } = await fetchDanmuJson<DanmuCommentResponse>(
    url,
    { method: 'GET' },
    12000
  );
  recordServerSuccess(config.baseUrl, latencyMs);
  return data;
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
