import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryLruCache,
  buildServerScopedKey,
  clearAllPageCaches,
  detailPageCache,
  libraryPageCache,
  musicBrowseCache,
  musicDetailCache,
  musicHomeCache,
} from '../src/services/pageCache.ts';

test('MemoryLruCache returns fresh hits and marks expired entries as stale (SWR)', async () => {
  const cache = new MemoryLruCache(4, 30);
  cache.set('k1', { title: 'Movie A' });

  const immediate = cache.get('k1');
  assert.ok(immediate);
  assert.equal(immediate.isStale, false);
  assert.deepEqual(immediate.data, { title: 'Movie A' });

  await new Promise((r) => setTimeout(r, 45));
  const expired = cache.get('k1');
  assert.ok(expired);
  assert.equal(expired.isStale, true);
  assert.deepEqual(expired.data, { title: 'Movie A' });
});

test('MemoryLruCache evicts least recently used entry when exceeding maxEntries', () => {
  const cache = new MemoryLruCache(2, 60_000);
  cache.set('a', 1);
  cache.set('b', 2);
  // 命中 'a' 刷新其最近使用顺序，使 'b' 成为最久未访问项
  assert.equal(cache.get('a')?.data, 1);
  cache.set('c', 3);

  assert.equal(cache.size, 2);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a')?.data, 1);
  assert.equal(cache.get('c')?.data, 3);
});

test('buildServerScopedKey isolates cache keys by serverId and non-empty segments', () => {
  assert.equal(
    buildServerScopedKey('srv-1', 'lib-10', 'all', undefined, ''),
    'srv-1::lib-10::all'
  );
  assert.notEqual(
    buildServerScopedKey('srv-1', 'item-9'),
    buildServerScopedKey('srv-2', 'item-9')
  );
});

test('clearAllPageCaches resets every page cache bucket', () => {
  detailPageCache.set('srv-1::item-1', {
    item: { Id: 'item-1', Name: 'Test', Type: 'Movie' },
    seriesItem: null,
    seasons: [],
    selectedSeasonId: null,
    episodes: [],
    similarItems: [],
  });
  libraryPageCache.set('srv-1::lib-1', { items: [], totalCount: 0, genres: [] });
  musicHomeCache.set('srv-1', {
    musicLibs: [],
    recentTracks: [],
    latestAlbums: [],
    artists: [],
    playlists: [],
  });
  musicBrowseCache.set('srv-1::albums', { items: [], total: 0 });
  musicDetailCache.set('srv-1::album::a1', {
    detail: { Id: 'a1', Name: 'Album', Type: 'MusicAlbum' },
  });

  clearAllPageCaches();

  assert.equal(detailPageCache.size, 0);
  assert.equal(libraryPageCache.size, 0);
  assert.equal(musicHomeCache.size, 0);
  assert.equal(musicBrowseCache.size, 0);
  assert.equal(musicDetailCache.size, 0);
});
