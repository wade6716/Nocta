export interface LyricLine {
  time: number;
  text: string;
}

const LRC_TAG_REGEX = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * 解析标准 LRC 文本为按时间升序排列的歌词数组
 */
export function parseLrcLyrics(raw: string): LyricLine[] {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split(/\r?\n/);
  const result: LyricLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    LRC_TAG_REGEX.lastIndex = 0;

    while ((match = LRC_TAG_REGEX.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fracRaw = match[3] || '0';
      const fracSeconds =
        fracRaw.length === 3
          ? parseInt(fracRaw, 10) / 1000
          : fracRaw.length === 2
          ? parseInt(fracRaw, 10) / 100
          : parseInt(fracRaw, 10) / 10;

      if (Number.isFinite(minutes) && Number.isFinite(seconds) && Number.isFinite(fracSeconds)) {
        timestamps.push(minutes * 60 + seconds + fracSeconds);
      }
    }

    if (timestamps.length === 0) continue;

    const text = trimmed.replace(LRC_TAG_REGEX, '').trim();
    if (!text) continue;

    for (const time of timestamps) {
      result.push({ time, text });
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

/**
 * 解析 Emby / Jellyfin `/emby/Audio/{Id}/Lyrics` 返回内容
 */
export function parseEmbyLyricsResponse(payload: unknown): LyricLine[] {
  if (!payload) return [];
  if (typeof payload === 'string') {
    return parseLrcLyrics(payload);
  }

  if (typeof payload === 'object') {
    const obj = payload as {
      Lyrics?: Array<{ Text?: string; Start?: number }>;
      lyrics?: Array<{ text?: string; start?: number; Text?: string; Start?: number }>;
    };
    const arr = obj.Lyrics || obj.lyrics;
    if (Array.isArray(arr) && arr.length > 0) {
      const parsed: LyricLine[] = [];
      let hasTimestamps = false;

      for (let i = 0; i < arr.length; i++) {
        const entry = arr[i] as { Text?: string; text?: string; Start?: number; start?: number };
        const rawText = (entry.Text ?? entry.text ?? '').trim();
        if (!rawText) continue;

        const rawStart = entry.Start ?? entry.start;
        if (typeof rawStart === 'number' && Number.isFinite(rawStart)) {
          hasTimestamps = true;
          parsed.push({
            time: Math.max(0, rawStart / 10_000_000),
            text: rawText,
          });
        } else {
          parsed.push({ time: i * 4, text: rawText });
        }
      }

      if (parsed.length > 0) {
        if (hasTimestamps) {
          parsed.sort((a, b) => a.time - b.time);
        }
        return parsed;
      }
    }
  }

  return [];
}

/**
 * 二分查找当前播放秒数对应的歌词行索引
 */
export function findActiveLyricIndex(lines: LyricLine[], currentTime: number): number {
  if (!lines || lines.length === 0) return -1;
  if (currentTime < lines[0].time) return -1;

  let low = 0;
  let high = lines.length - 1;
  let ans = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= currentTime + 0.15) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return ans;
}
