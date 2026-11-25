import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHostKind,
  extractHostFromUrl,
  extractRootDomain,
  generateRoutingRules,
  isLocalOrPrivateHost,
  mergeCollectedHostLists,
  normalizeEmbyServerSyncKey,
  redactUrlForSample,
  upsertCollectedHost,
} from '../src/services/embyHostCollector.ts';

test('extractHostFromUrl extracts domain, IPv4, IPv6 and rejects non-http schemes', () => {
  const domain = extractHostFromUrl('https://Media.Example.COM:8920/emby/Items');
  assert.ok(domain);
  assert.equal(domain.host, 'media.example.com');
  assert.equal(domain.kind, 'domain');
  assert.equal(domain.rootDomain, 'example.com');
  assert.equal(domain.port, 8920);

  const ipv4 = extractHostFromUrl('http://192.168.1.50:8096/System/Info');
  assert.ok(ipv4);
  assert.equal(ipv4.host, '192.168.1.50');
  assert.equal(ipv4.kind, 'ipv4');
  assert.equal(ipv4.port, 8096);

  const ipv6 = extractHostFromUrl('https://[2001:db8::1]/emby/videos/1/stream');
  assert.ok(ipv6);
  assert.equal(ipv6.host, '2001:db8::1');
  assert.equal(ipv6.kind, 'ipv6');
  assert.equal(ipv6.port, 443);

  assert.equal(extractHostFromUrl('tauri://localhost/index.html'), null);
  assert.equal(extractHostFromUrl('blob:https://example.com/123'), null);
  assert.equal(extractHostFromUrl('file:///D:/video.mp4'), null);
});

test('extractRootDomain handles multi-part suffixes and Mozilla PSL shared domains', () => {
  assert.equal(extractRootDomain('cdn.115.example.co.uk'), 'example.co.uk');
  assert.equal(extractRootDomain('vod.emby.com.cn'), 'emby.com.cn');
  assert.equal(extractRootDomain('sub.a.b.example.org'), 'example.org');
  // Free domain PSL suffixes (eu.org etc.) must keep the tenant label
  assert.equal(extractRootDomain('vipdc.covh.eu.org'), 'covh.eu.org');
  assert.equal(extractRootDomain('de.ftp2.eu.org'), 'ftp2.eu.org');
  assert.equal(extractRootDomain('nl.ftp2.eu.org'), 'ftp2.eu.org');
  // NAS / DDNS / Cloud PSL suffixes
  assert.equal(extractRootDomain('myemby.synology.me'), 'myemby.synology.me');
  assert.equal(extractRootDomain('nas.duckdns.org'), 'nas.duckdns.org');
  assert.equal(extractRootDomain('stream.app.workers.dev'), 'app.workers.dev');
  assert.equal(classifyHostKind('1.2.3.4'), 'ipv4');
  assert.equal(classifyHostKind('240e::1'), 'ipv6');
});

test('generateRoutingRules heals stale rootDomain on eu.org hosts and deduplicates per tenant', () => {
  const staleEntries = [
    {
      host: 'vipdc.covh.eu.org',
      kind: 'domain',
      rootDomain: 'eu.org', // stale cached rootDomain from older version
      categories: ['api'],
      ports: [443],
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      hitCount: 1,
    },
    {
      host: 'de.ftp2.eu.org',
      kind: 'domain',
      rootDomain: 'eu.org',
      categories: ['redirect'],
      ports: [443],
      firstSeenAt: 1100,
      lastSeenAt: 1100,
      hitCount: 1,
    },
    {
      host: 'nl.ftp2.eu.org',
      kind: 'domain',
      rootDomain: 'eu.org',
      categories: ['redirect'],
      ports: [443],
      firstSeenAt: 1200,
      lastSeenAt: 1200,
      hitCount: 1,
    },
  ];

  const rules = generateRoutingRules(staleEntries, 'clash', 'suffix', { policyName: 'PROXY' });
  assert.equal(
    rules,
    ['rules:', '  - DOMAIN-SUFFIX,covh.eu.org,PROXY', '  - DOMAIN-SUFFIX,ftp2.eu.org,PROXY'].join(
      '\n'
    )
  );
  assert.ok(!rules.includes('DOMAIN-SUFFIX,eu.org'));
});

test('redactUrlForSample strips userinfo and sensitive query params', () => {
  const redacted = redactUrlForSample(
    'https://alice:secret@cdn.example.com/stream.mkv?api_key=abc123&X-Emby-Token=tok999&safe=1'
  );
  assert.ok(!redacted.includes('alice'));
  assert.ok(!redacted.includes('secret'));
  assert.ok(!redacted.includes('abc123'));
  assert.ok(!redacted.includes('tok999'));
  assert.ok(redacted.includes('safe=1'));
});

test('upsertCollectedHost and mergeCollectedHostLists deduplicate and union metadata', () => {
  let list = upsertCollectedHost([], 'https://emby.example.com/emby/Items', 'api', 1000);
  list = upsertCollectedHost(list, 'https://emby.example.com:8920/emby/Videos/1/stream', 'stream', 2000);
  list = upsertCollectedHost(list, 'https://cdn-115.other.net/file.mkv', 'redirect', 2500);

  assert.equal(list.length, 2);
  const emby = list.find((e) => e.host === 'emby.example.com');
  assert.ok(emby);
  assert.deepEqual(emby.categories, ['api', 'stream']);
  assert.deepEqual(emby.ports, [443, 8920]);
  assert.equal(emby.hitCount, 2);
  assert.equal(emby.firstSeenAt, 1000);
  assert.equal(emby.lastSeenAt, 2000);

  const remote = upsertCollectedHost([], 'https://emby.example.com/Images/Primary', 'image', 3000);
  const merged = mergeCollectedHostLists(list, remote);
  assert.equal(merged.length, 2);
  const mergedEmby = merged.find((e) => e.host === 'emby.example.com');
  assert.ok(mergedEmby);
  assert.deepEqual(mergedEmby.categories.sort(), ['api', 'image', 'stream']);
  assert.equal(mergedEmby.lastSeenAt, 3000);
});

test('generateRoutingRules exports Clash, Surge, Sing-box, plain and respects local filter', () => {
  let list = upsertCollectedHost([], 'http://192.168.1.10:8096/emby', 'api', 1000);
  list = upsertCollectedHost(list, 'https://a.example.com/emby', 'api', 1100);
  list = upsertCollectedHost(list, 'https://b.example.com/stream', 'redirect', 1200);
  list = upsertCollectedHost(list, 'https://8.8.8.8/media.mp4', 'redirect', 1300);

  assert.equal(isLocalOrPrivateHost('192.168.1.10'), true);
  assert.equal(isLocalOrPrivateHost('8.8.8.8'), false);

  const clashSuffix = generateRoutingRules(list, 'clash', 'suffix', { policyName: 'EMBY' });
  assert.equal(
    clashSuffix,
    ['rules:', '  - DOMAIN-SUFFIX,example.com,EMBY', '  - IP-CIDR,8.8.8.8/32,EMBY,no-resolve'].join(
      '\n'
    )
  );

  const surgeExact = generateRoutingRules(list, 'surge', 'exact', {
    policyName: 'PROXY',
    includeLocal: true,
  });
  assert.ok(surgeExact.includes('DOMAIN,a.example.com,PROXY'));
  assert.ok(surgeExact.includes('DOMAIN,b.example.com,PROXY'));
  assert.ok(surgeExact.includes('IP-CIDR,192.168.1.10/32,PROXY,no-resolve'));

  const singbox = JSON.parse(generateRoutingRules(list, 'singbox', 'suffix'));
  assert.equal(singbox.version, 2);
  assert.deepEqual(singbox.rules[0].domain_suffix, ['example.com']);
  assert.deepEqual(singbox.rules[0].ip_cidr, ['8.8.8.8/32']);

  assert.equal(
    normalizeEmbyServerSyncKey('HTTPS://Emby.Example.Com/ ', ' Alice '),
    'https://emby.example.com___alice'
  );
});
