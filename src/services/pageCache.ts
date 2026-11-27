import type { EmbyItem } from '../api/embyClient';

export interface CacheLookupResult<T> {
  data: T;
  isStale: boolean;
}

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

export class MemoryLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 30, defaultTtlMs = 3 * 60 * 1000) {
    this.maxEntries = Math.max(1, maxEntries);
    this.defaultTtlMs = Math.max(1, defaultTtlMs);
  }

  get(key: string, ttlMs = this.defaultTtlMs): CacheLookupResult<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    // 刷新 LRU 访问顺序
    this.entries.delete(key);
    this.entries.set(key, entry);

    return {
      data: entry.data,
      isStale: Date.now() - entry.cachedAt > ttlMs,
    };
  }

  set(key: string, data: T): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { data, cachedAt: Date.now() });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface DetailPageCacheData {
  item: EmbyItem;
  seriesItem: EmbyItem | null;
  seasons: EmbyItem[];
  selectedSeasonId: string | null;
  episodes: EmbyItem[];
  similarItems: EmbyItem[];
}

export interface LibraryPageCacheData {
  items: EmbyItem[];
  totalCount: number;
  genres: string[];
}

export interface MusicHomeCacheData {
  musicLibs: EmbyItem[];
  recentTracks: EmbyItem[];
  latestAlbums: EmbyItem[];
  artists: EmbyItem[];
  playlists: EmbyItem[];
}

export interface MusicBrowseCacheData {
  items: EmbyItem[];
  total: number;
}

export interface MusicDetailCacheData {
  detail: EmbyItem;
  tracks?: EmbyItem[];
  albums?: EmbyItem[];
}

export const detailPageCache = new MemoryLruCache<DetailPageCacheData>(40, 3 * 60 * 1000);
export const libraryPageCache = new MemoryLruCache<LibraryPageCacheData>(24, 3 * 60 * 1000);
export const musicHomeCache = new MemoryLruCache<MusicHomeCacheData>(8, 3 * 60 * 1000);
export const musicBrowseCache = new MemoryLruCache<MusicBrowseCacheData>(24, 3 * 60 * 1000);
export const musicDetailCache = new MemoryLruCache<MusicDetailCacheData>(30, 3 * 60 * 1000);

export function clearAllPageCaches(): void {
  detailPageCache.clear();
  libraryPageCache.clear();
  musicHomeCache.clear();
  musicBrowseCache.clear();
  musicDetailCache.clear();
}

export function buildServerScopedKey(
  serverId: string,
  ...parts: Array<string | number | undefined>
): string {
  const tokens: string[] = [serverId];
  for (const part of parts) {
    if (part === undefined) continue;
    const str = String(part);
    if (str.length > 0) {
      tokens.push(str);
    }
  }
  return tokens.join('::');
}
