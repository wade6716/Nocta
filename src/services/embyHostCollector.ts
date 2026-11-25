export type EmbyHostCategory =
  | 'api'
  | 'stream'
  | 'redirect'
  | 'image'
  | 'subtitle'
  | 'other';

export type EmbyHostKind = 'domain' | 'ipv4' | 'ipv6';

export type RuleExportFormat = 'clash' | 'surge' | 'singbox' | 'plain';

export type RuleDomainMode = 'exact' | 'suffix';

export interface CollectedHostEntry {
  host: string;
  kind: EmbyHostKind;
  rootDomain: string;
  categories: EmbyHostCategory[];
  ports: number[];
  sampleUrl?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  hitCount: number;
}

export interface EmbyHostCollectorSettings {
  enabled: boolean;
  probePlaybackRedirects: boolean;
}

export const DEFAULT_EMBY_HOST_COLLECTOR_SETTINGS: EmbyHostCollectorSettings = {
  enabled: true,
  probePlaybackRedirects: true,
};

export interface ExtractedHostInfo {
  host: string;
  kind: EmbyHostKind;
  rootDomain: string;
  port: number;
  sampleUrl: string;
}

const MAX_HOSTS_PER_SERVER = 200;

const MULTI_PART_SUFFIXES = new Set([
  // 常见国家/地区二级公共后缀
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'sch.uk',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'com.hk',
  'org.hk',
  'edu.hk',
  'com.tw',
  'org.tw',
  'net.tw',
  'edu.tw',
  'gov.tw',
  'idv.tw',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'org.nz',
  'co.kr',
  'or.kr',
  'com.sg',
  'com.br',
  'com.mx',
  'co.in',
  'co.id',
  'com.my',
  'co.th',
  'com.vn',
  'com.tr',
  'com.ru',
  'co.za',
  'co.il',
  'com.ar',
  'com.co',
  'com.pe',
  'com.ph',
  'com.ua',
  'or.at',
  'co.at',
  'com.pl',
  'net.pl',
  'org.pl',
  'com.es',
  'nom.es',
  'org.es',
  'com.pt',
  'com.sa',
  'com.eg',
  'com.pk',
  'com.bd',
  'com.ng',
  'co.ke',
  // 免费二级域名项目 (Mozilla PSL)
  'eu.org',
  'us.kg',
  'dpdns.org',
  'pp.ua',
  'js.org',
  'is-a.dev',
  'uk.to',
  'us.to',
  'ggff.net',
  'qzz.io',
  'co.cc',
  'de.vu',
  'eu.tc',
  // NAS 与动态域名 DDNS 公共后缀 (PSL)
  'synology.me',
  'diskstation.me',
  'myds.me',
  'dsmynas.com',
  'familyds.com',
  'i234.me',
  'quickconnect.to',
  'myqnapcloud.com',
  'asuscomm.com',
  'tplinkdns.com',
  'myfritz.net',
  'duckdns.org',
  'ddns.net',
  'ddnsking.com',
  'dynv6.net',
  'hopto.org',
  'zapto.org',
  'sytes.net',
  'no-ip.org',
  'no-ip.biz',
  'no-ip.info',
  'servehttp.com',
  'servegame.com',
  'mooo.com',
  'nip.io',
  'sslip.io',
  'ts.net',
  // 云服务 / PaaS / Tunnel 公共后缀 (PSL)
  'workers.dev',
  'pages.dev',
  'r2.dev',
  'trycloudflare.com',
  'cfargotunnel.com',
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'fly.dev',
  'onrender.com',
  'herokuapp.com',
  'azurewebsites.net',
  'cloudfront.net',
  'amazonaws.com',
  'ngrok.io',
  'ngrok-free.app',
]);

const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'x-emby-token',
  'token',
  'auth',
  'password',
  'pass',
  'sig',
  'signature',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'ossaccesskeyid',
  'expires',
  'sign',
  'key',
  'secret',
  'st',
  'e',
]);

/**
 * 规范化 Emby 服务器多端同步键（与 configBackupService 的 url+username 联合标识保持一致）。
 */
export function normalizeEmbyServerSyncKey(url: string, username?: string): string {
  const cleanUrl = (url || '').trim().replace(/\/+$/, '').toLowerCase();
  const cleanUser = (username || '').trim().toLowerCase();
  return `${cleanUrl}___${cleanUser}`;
}

export function classifyHostKind(host: string): EmbyHostKind {
  const bare = host.replace(/^\[|\]$/g, '').trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(bare)) {
    const parts = bare.split('.').map(Number);
    if (parts.every((n) => n >= 0 && n <= 255)) {
      return 'ipv4';
    }
  }
  if (bare.includes(':')) {
    return 'ipv6';
  }
  return 'domain';
}

export function isLocalOrPrivateHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').trim().toLowerCase();
  if (!bare) return true;
  if (
    bare === 'localhost' ||
    bare.endsWith('.localhost') ||
    bare.endsWith('.local') ||
    bare === '::1' ||
    bare === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }

  const kind = classifyHostKind(bare);
  if (kind === 'ipv4') {
    const [a, b] = bare.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }

  if (kind === 'ipv6') {
    if (bare.startsWith('fe80:') || bare.startsWith('fc') || bare.startsWith('fd')) {
      return true;
    }
    return false;
  }

  return false;
}

export function extractRootDomain(host: string): string {
  const normalized = host.replace(/^\[|\]$/g, '').trim().toLowerCase();
  if (!normalized) return '';
  if (classifyHostKind(normalized) !== 'domain') {
    return normalized;
  }
  const labels = normalized.split('.').filter(Boolean);
  if (labels.length <= 2) {
    return labels.join('.');
  }
  if (labels.length >= 4) {
    const lastThree = `${labels[labels.length - 3]}.${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (MULTI_PART_SUFFIXES.has(lastThree)) {
      return labels.slice(-4).join('.');
    }
  }
  const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
  if (MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

export function redactUrlForSample(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '***');
      }
    }
    const result = parsed.toString();
    return result.length > 180 ? `${result.slice(0, 177)}...` : result;
  } catch {
    return rawUrl.length > 180 ? `${rawUrl.slice(0, 177)}...` : rawUrl;
  }
}

export function extractHostFromUrl(rawUrl: string): ExtractedHostInfo | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    const bareHost = parsed.hostname.replace(/^\[|\]$/g, '').trim().toLowerCase();
    if (!bareHost) return null;

    const kind = classifyHostKind(bareHost);
    const rootDomain = extractRootDomain(bareHost);
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;

    return {
      host: bareHost,
      kind,
      rootDomain,
      port: Number.isFinite(port) && port > 0 ? port : parsed.protocol === 'https:' ? 443 : 80,
      sampleUrl: redactUrlForSample(trimmed),
    };
  } catch {
    return null;
  }
}

export function upsertCollectedHost(
  list: CollectedHostEntry[],
  rawUrl: string,
  category: EmbyHostCategory,
  now: number = Date.now()
): CollectedHostEntry[] {
  const info = extractHostFromUrl(rawUrl);
  if (!info) return list;

  const idx = list.findIndex((item) => item.host === info.host);
  if (idx >= 0) {
    const existing = list[idx];
    const categories = existing.categories.includes(category)
      ? existing.categories
      : [...existing.categories, category];
    const ports = existing.ports.includes(info.port)
      ? existing.ports
      : [...existing.ports, info.port].sort((a, b) => a - b);

    const updated: CollectedHostEntry = {
      ...existing,
      categories,
      ports,
      sampleUrl: info.sampleUrl || existing.sampleUrl,
      lastSeenAt: Math.max(existing.lastSeenAt, now),
      hitCount: existing.hitCount + 1,
    };
    const next = list.slice();
    next[idx] = updated;
    return next;
  }

  const created: CollectedHostEntry = {
    host: info.host,
    kind: info.kind,
    rootDomain: info.rootDomain,
    categories: [category],
    ports: [info.port],
    sampleUrl: info.sampleUrl,
    firstSeenAt: now,
    lastSeenAt: now,
    hitCount: 1,
  };

  const next = [...list, created];
  if (next.length > MAX_HOSTS_PER_SERVER) {
    next.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return next.slice(0, MAX_HOSTS_PER_SERVER);
  }
  return next;
}

export function mergeCollectedHostLists(
  local: CollectedHostEntry[],
  remote: CollectedHostEntry[]
): CollectedHostEntry[] {
  const byHost = new Map<string, CollectedHostEntry>();

  const insert = (entry: CollectedHostEntry) => {
    if (!entry || !entry.host) return;
    const host = entry.host.replace(/^\[|\]$/g, '').trim().toLowerCase();
    if (!host) return;
    const existing = byHost.get(host);
    if (!existing) {
      byHost.set(host, {
        ...entry,
        host,
        kind: entry.kind || classifyHostKind(host),
        rootDomain: extractRootDomain(host),
        categories: Array.from(new Set(entry.categories || [])),
        ports: Array.from(new Set(entry.ports || [])).sort((a, b) => a - b),
      });
      return;
    }

    const useRemoteSample = (entry.lastSeenAt || 0) >= (existing.lastSeenAt || 0);
    byHost.set(host, {
      host,
      kind: existing.kind,
      rootDomain: extractRootDomain(host),
      categories: Array.from(new Set([...existing.categories, ...(entry.categories || [])])),
      ports: Array.from(new Set([...existing.ports, ...(entry.ports || [])])).sort((a, b) => a - b),
      sampleUrl: useRemoteSample ? entry.sampleUrl || existing.sampleUrl : existing.sampleUrl || entry.sampleUrl,
      firstSeenAt: Math.min(existing.firstSeenAt || Date.now(), entry.firstSeenAt || Date.now()),
      lastSeenAt: Math.max(existing.lastSeenAt || 0, entry.lastSeenAt || 0),
      hitCount: Math.max(existing.hitCount || 1, entry.hitCount || 1),
    });
  };

  for (const item of local || []) insert(item);
  for (const item of remote || []) insert(item);

  return Array.from(byHost.values())
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, MAX_HOSTS_PER_SERVER);
}

export function generateRoutingRules(
  entries: CollectedHostEntry[],
  format: RuleExportFormat,
  mode: RuleDomainMode,
  options?: { policyName?: string; includeLocal?: boolean }
): string {
  const includeLocal = options?.includeLocal ?? false;
  const policy = (options?.policyName ?? 'PROXY').trim();

  const filtered = (entries || []).filter((e) => includeLocal || !isLocalOrPrivateHost(e.host));
  if (filtered.length === 0) return '';

  const exactDomains: string[] = [];
  const suffixDomains: string[] = [];
  const ipv4Cidrs: string[] = [];
  const ipv6Cidrs: string[] = [];
  const plainItems: string[] = [];

  const seenDomains = new Set<string>();
  const seenIps = new Set<string>();

  for (const entry of filtered) {
    if (entry.kind === 'domain') {
      const target = mode === 'suffix' ? extractRootDomain(entry.host) : entry.host;
      if (!target || seenDomains.has(target)) continue;
      seenDomains.add(target);
      if (mode === 'suffix') {
        suffixDomains.push(target);
      } else {
        exactDomains.push(target);
      }
      plainItems.push(target);
    } else if (entry.kind === 'ipv4') {
      if (seenIps.has(entry.host)) continue;
      seenIps.add(entry.host);
      ipv4Cidrs.push(`${entry.host}/32`);
      plainItems.push(entry.host);
    } else {
      if (seenIps.has(entry.host)) continue;
      seenIps.add(entry.host);
      ipv6Cidrs.push(`${entry.host}/128`);
      plainItems.push(entry.host);
    }
  }

  if (format === 'plain') {
    return plainItems.join('\n');
  }

  if (format === 'singbox') {
    const rule: Record<string, string[]> = {};
    if (exactDomains.length > 0) rule.domain = exactDomains;
    if (suffixDomains.length > 0) rule.domain_suffix = suffixDomains;
    const allIps = [...ipv4Cidrs, ...ipv6Cidrs];
    if (allIps.length > 0) rule.ip_cidr = allIps;
    return JSON.stringify({ version: 2, rules: [rule] }, null, 2);
  }

  const suffixSuffix = policy ? `,${policy}` : '';
  const lines: string[] = [];

  for (const d of suffixDomains) {
    lines.push(`DOMAIN-SUFFIX,${d}${suffixSuffix}`);
  }
  for (const d of exactDomains) {
    lines.push(`DOMAIN,${d}${suffixSuffix}`);
  }
  for (const cidr of ipv4Cidrs) {
    lines.push(`IP-CIDR,${cidr}${suffixSuffix},no-resolve`);
  }
  for (const cidr6 of ipv6Cidrs) {
    lines.push(`IP-CIDR6,${cidr6}${suffixSuffix},no-resolve`);
  }

  if (format === 'clash') {
    return ['rules:', ...lines.map((line) => `  - ${line}`)].join('\n');
  }

  return lines.join('\n');
}
