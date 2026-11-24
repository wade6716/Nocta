export type DurationMatchGrade = 'exact' | 'acceptable' | 'mismatch' | 'unknown';
export type Stage1FallbackReason = 'empty_comments' | 'duration_mismatch';

export interface DurationEvaluation {
  grade: DurationMatchGrade;
  diffSec?: number;
  thresholdSec?: number;
}

export interface DanmuPolicyEpisode {
  episodeId: number | string;
  episodeTitle: string;
  episodeNumber?: string | number;
}

export interface ParsedEpisodeMeta {
  platform?: string;
  cleanTitle: string;
  episodeNumber?: number;
  subTitle: string;
}

const SEASON_CHINESE_NUMERALS: Record<number, string> = {
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

const EXTRA_OR_PREVIEW_RE =
  /(?:预告|花絮|彩蛋|加更|特辑|番外|抢先看|纯享|先导|幕后|采访|剧透|片花|(?<![a-zA-Z])(?:PV|SP|OVA|OAD|CM|OP|ED|NCOP|NCED)\d*(?![a-zA-Z]))/i;

const TECH_TAG_RE =
  /(?:^|[\s._\-[【(])(?:2160p|1080p|720p|480p|4k|8k|web-?dl|webrip|bluray|bdrip|remux|hdr10?\+?|dv|dolby\.?vision|hevc|h\.?265|h\.?264|x265|x264|av1|aac|flac|ddp[\d.]*)(?=$|[\s._\-\]】)])/gi;

const PART_MARKERS = ['上', '下', '中', '加更', '纯享', '先导', '特辑', '特别篇', '番外', '彩蛋', '回顾'];

/**
 * 基于片源总时长计算可接受的最大弹幕时长偏差（秒）：
 * 短片至少放宽至 90s，电影/长剧集上限 300s，中间档按 12% 线性缩放。
 */
export function getMaxAcceptableDurationDiff(videoDurationSec: number): number {
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return 180;
  }
  return Math.min(300, Math.max(90, Math.round(videoDurationSec * 0.12)));
}

/**
 * 评估弹幕源时长与当前播放片源时长的契合度等级
 */
export function evaluateDurationMatch(
  sourceDuration?: number,
  videoDuration?: number
): DurationEvaluation {
  if (
    typeof sourceDuration !== 'number' ||
    typeof videoDuration !== 'number' ||
    !Number.isFinite(sourceDuration) ||
    !Number.isFinite(videoDuration) ||
    sourceDuration <= 0 ||
    videoDuration <= 0
  ) {
    return { grade: 'unknown' };
  }

  const diffSec = Math.round(Math.abs(sourceDuration - videoDuration));
  const thresholdSec = getMaxAcceptableDurationDiff(videoDuration);

  if (diffSec <= 15) {
    return { grade: 'exact', diffSec, thresholdSec };
  }
  if (diffSec <= thresholdSec) {
    return { grade: 'acceptable', diffSec, thresholdSec };
  }
  return { grade: 'mismatch', diffSec, thresholdSec };
}

/**
 * 判断一阶段结果是否应自动触发二阶段关键词匹配
 */
export function shouldTriggerStage2Fallback(params: {
  sourceDuration?: number;
  videoDuration?: number;
  commentCount: number;
}): {
  shouldFallback: boolean;
  reason?: Stage1FallbackReason;
  evaluation: DurationEvaluation;
} {
  const evaluation = evaluateDurationMatch(params.sourceDuration, params.videoDuration);
  if (params.commentCount <= 0) {
    return {
      shouldFallback: true,
      reason: 'empty_comments',
      evaluation,
    };
  }
  if (evaluation.grade === 'mismatch') {
    return {
      shouldFallback: true,
      reason: 'duration_mismatch',
      evaluation,
    };
  }
  return {
    shouldFallback: false,
    evaluation,
  };
}

/**
 * 是否达到高置信度短路标准（有弹幕且无严重时长错配）
 */
export function isHighConfidenceMatch(params: {
  sourceDuration?: number;
  videoDuration?: number;
  commentCount: number;
}): boolean {
  if (params.commentCount <= 0) return false;
  return evaluateDurationMatch(params.sourceDuration, params.videoDuration).grade !== 'mismatch';
}

export function isLikelyExtraOrPreviewTitle(title?: string): boolean {
  if (!title) return false;
  return EXTRA_OR_PREVIEW_RE.test(title);
}

/**
 * 对完整探测过弹幕数与源时长的候选结果进行综合打分，确保二阶段或备用节点只在严格更优时替换保底结果
 */
export function scoreMatchedCandidate(params: {
  sourceDuration?: number;
  videoDuration?: number;
  commentCount: number;
  episodeTitle?: string;
  itemFileName?: string;
  animeScore?: number;
  isStage1?: boolean;
}): number {
  const evaluation = evaluateDurationMatch(params.sourceDuration, params.videoDuration);

  let durationScore = 20;
  if (evaluation.grade === 'exact') {
    durationScore = 120;
  } else if (evaluation.grade === 'acceptable') {
    durationScore = (evaluation.diffSec ?? 999) <= 60 ? 95 : 65;
  } else if (evaluation.grade === 'mismatch') {
    const threshold = evaluation.thresholdSec ?? 180;
    durationScore = (evaluation.diffSec ?? 0) <= threshold * 2 ? -20 : -80;
  }

  const commentScore =
    params.commentCount > 0
      ? 40 + Math.min(20, Math.log10(params.commentCount) * 6)
      : -30;

  let extraPenalty = 0;
  if (
    isLikelyExtraOrPreviewTitle(params.episodeTitle) &&
    !isLikelyExtraOrPreviewTitle(params.itemFileName)
  ) {
    extraPenalty = -35;
  }

  const boundedAnimeTieBreaker = Math.max(
    -10,
    Math.min(25, Math.round((params.animeScore ?? 0) * 0.15))
  );
  const stageTieBreaker = params.isStage1 ? 5 : 0;

  return durationScore + commentScore + extraPenalty + boundedAnimeTieBreaker + stageTieBreaker;
}

function cleanKeywordCore(raw: string): string {
  return raw
    .trim()
    .replace(/\.[^.]{2,4}$/, '') // 去除常见视频扩展名
    .replace(/[(（\[]\s*(?:19|20)\d{2}\s*[)）\]]/g, ' ')
    .replace(/(?<![a-zA-Z0-9])S\d{1,2}E\d{1,4}(?![a-zA-Z0-9])/gi, ' ')
    .replace(/\s*第\s*\d+\s*(?:集|话|話|期|回)\s*$/g, ' ')
    .replace(TECH_TAG_RE, ' ')
    .replace(/[(（\[]\s*[)）\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 为二阶段搜索生成有序去重的多变体关键词列表（最多 4 个）
 */
export function buildDanmuSearchKeywords(params: {
  seriesName?: string;
  fileName?: string;
  seasonNumber?: number;
  isMovie?: boolean;
}): string[] {
  const rawPrimary = params.seriesName?.trim() || params.fileName?.trim() || '';
  if (!rawPrimary) return [];

  const primaryClean = cleanKeywordCore(rawPrimary);
  const candidates: string[] = [];
  const pushUnique = (kw?: string) => {
    const trimmed = (kw || '').trim();
    if (!trimmed) return;
    if (!candidates.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      candidates.push(trimmed);
    }
  };

  pushUnique(primaryClean);

  if (params.seasonNumber && params.seasonNumber > 1 && primaryClean) {
    const hasSeasonMarker = /(?:第\s*(?:\d+|[一二三四五六七八九十]+)\s*(?:季|部)|Season\s*\d+|(?<![a-zA-Z])S0*\d+(?!\d))/i.test(
      primaryClean
    );
    if (!hasSeasonMarker) {
      const cnNum = SEASON_CHINESE_NUMERALS[params.seasonNumber] || String(params.seasonNumber);
      pushUnique(`${primaryClean} 第${cnNum}季`);
    }
  }

  // 剥离冒号/破折号副标题（如 "鬼灭之刃：柱训练篇" -> "鬼灭之刃"）
  const subtitleParts = primaryClean.split(/\s*(?:：|:|——|—|\s-\s)\s*/);
  if (subtitleParts.length > 1) {
    const head = subtitleParts[0].trim();
    if (head.length >= 2) {
      pushUnique(head);
    }
  }

  // 提取中英混排标题中的中文前缀主标题（如 "三体 Three-Body" -> "三体"）
  const cjkLatinMatch = primaryClean.match(/^([\u4e00-\u9fff0-9·\s]{2,}?)\s+[A-Za-z][A-Za-z0-9\s:'\-!.,]+$/);
  if (cjkLatinMatch?.[1]) {
    const cjkHead = cjkLatinMatch[1].trim();
    if (cjkHead.length >= 2) {
      pushUnique(cjkHead);
    }
  }

  pushUnique(rawPrimary);
  if (params.fileName && params.fileName.trim() !== rawPrimary) {
    pushUnique(cleanKeywordCore(params.fileName));
  }

  return candidates.slice(0, 4);
}

function computeSubTitleOverlapScore(
  epTitle: string,
  subTitle: string,
  itemFileName?: string
): number {
  const itemText = (itemFileName || '').trim().toLowerCase();
  if (!itemText) return 0;

  const epCombined = `${subTitle} ${epTitle}`.trim().toLowerCase();
  let score = 0;

  for (const marker of PART_MARKERS) {
    const itemHas = itemText.includes(marker);
    const epHas = epCombined.includes(marker);
    if (itemHas && epHas) {
      score += 25;
      break;
    }
  }

  // 提取 Emby 单集名中的 2+ 连续中文词/英文词片段校验交集
  const tokens = itemText.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{3,}/gi) || [];
  let matchedTokens = 0;
  for (const tok of tokens) {
    if (/^(?:mp4|mkv|avi|ts|1080p|2160p|720p|第\d+集)$/i.test(tok)) continue;
    if (epCombined.includes(tok.toLowerCase())) {
      matchedTokens += 1;
      if (matchedTokens >= 2) break;
    }
  }
  score += matchedTokens * 12;

  return score;
}

/**
 * 对同一部番剧/剧集下的分集进行多维排序（偏好平台 + 正片优先 + 副标题重合度），返回 Top N 候选
 */
export function rankMatchingEpisodes<T extends DanmuPolicyEpisode>(
  episodes: T[],
  parseFn: (ep: T, idx: number) => ParsedEpisodeMeta,
  opts: {
    episodeNumber?: number;
    isMovie?: boolean;
    preferredPlatform?: string;
    itemFileName?: string;
    limit?: number;
  }
): T[] {
  if (!episodes || episodes.length === 0) return [];
  const limit = opts.limit ?? 3;
  const pref = (opts.preferredPlatform || '').trim().toLowerCase();
  const itemIsExtra = isLikelyExtraOrPreviewTitle(opts.itemFileName);

  const scoreEntry = (ep: T, meta: ParsedEpisodeMeta, index: number) => {
    let score = 0;
    if (pref && meta.platform?.toLowerCase() === pref) {
      score += 30;
    }
    const epIsExtra = isLikelyExtraOrPreviewTitle(ep.episodeTitle);
    if (epIsExtra && !itemIsExtra) {
      score -= 40;
    } else if (!epIsExtra && !itemIsExtra) {
      score += 10;
    }
    score += computeSubTitleOverlapScore(ep.episodeTitle, meta.subTitle, opts.itemFileName);
    return { ep, score, index };
  };

  if (opts.isMovie && opts.episodeNumber === undefined) {
    return episodes
      .map((ep, idx) => scoreEntry(ep, parseFn(ep, idx), idx))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((item) => item.ep);
  }

  if (opts.episodeNumber !== undefined && opts.episodeNumber > 0) {
    const matched = episodes
      .map((ep, idx) => ({ ep, meta: parseFn(ep, idx), idx }))
      .filter((entry) => entry.meta.episodeNumber === opts.episodeNumber);

    if (matched.length > 0) {
      return matched
        .map((entry) => scoreEntry(entry.ep, entry.meta, entry.idx))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map((item) => item.ep);
    }

    const byIndex = episodes[opts.episodeNumber - 1];
    return byIndex ? [byIndex] : [];
  }

  return episodes.slice(0, limit);
}
