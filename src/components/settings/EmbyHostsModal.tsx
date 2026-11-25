import React, { useMemo, useState } from 'react';
import {
  X,
  Globe,
  Copy,
  Check,
  Trash2,
  Search,
  Download,
  Shield,
  RefreshCw,
} from 'lucide-react';
import type { SavedServer } from '../../stores/useAuthStore';
import { useEmbyHostsStore } from '../../stores/useEmbyHostsStore';
import {
  type EmbyHostCategory,
  type RuleDomainMode,
  type RuleExportFormat,
  generateRoutingRules,
  isLocalOrPrivateHost,
} from '../../services/embyHostCollector';

interface EmbyHostsModalProps {
  isOpen: boolean;
  onClose: () => void;
  server: SavedServer | null;
}

const CATEGORY_META: Record<
  EmbyHostCategory,
  { label: string; badgeClass: string }
> = {
  api: {
    label: 'API',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  stream: {
    label: '播放流',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  redirect: {
    label: '302重定向',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  image: {
    label: '图片',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  subtitle: {
    label: '字幕',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  other: {
    label: '其他',
    badgeClass: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  },
};

function formatSeenTime(ts: number): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${min}`;
  } catch {
    return '-';
  }
}

export const EmbyHostsModal: React.FC<EmbyHostsModalProps> = ({
  isOpen,
  onClose,
  server,
}) => {
  const hostsByServerId = useEmbyHostsStore((s) => s.hostsByServerId);
  const settings = useEmbyHostsStore((s) => s.settings);
  const setEnabled = useEmbyHostsStore((s) => s.setEnabled);
  const setProbePlaybackRedirects = useEmbyHostsStore(
    (s) => s.setProbePlaybackRedirects
  );
  const removeHost = useEmbyHostsStore((s) => s.removeHost);
  const clearServerHosts = useEmbyHostsStore((s) => s.clearServerHosts);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | EmbyHostCategory>('all');
  const [exportFormat, setExportFormat] = useState<RuleExportFormat>('clash');
  const [domainMode, setDomainMode] = useState<RuleDomainMode>('suffix');
  const [policyName, setPolicyName] = useState('PROXY');
  const [includeLocal, setIncludeLocal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = useMemo(() => {
    if (!server) return [];
    return [...(hostsByServerId[server.id] || [])].sort(
      (a, b) => b.lastSeenAt - a.lastSeenAt
    );
  }, [hostsByServerId, server]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (categoryFilter !== 'all' && !entry.categories.includes(categoryFilter)) {
        return false;
      }
      if (q) {
        const hitHost = entry.host.toLowerCase().includes(q);
        const hitRoot = entry.rootDomain.toLowerCase().includes(q);
        const hitSample = (entry.sampleUrl || '').toLowerCase().includes(q);
        if (!hitHost && !hitRoot && !hitSample) return false;
      }
      return true;
    });
  }, [entries, categoryFilter, searchQuery]);

  const generatedRules = useMemo(() => {
    return generateRoutingRules(filteredEntries, exportFormat, domainMode, {
      policyName,
      includeLocal,
    });
  }, [filteredEntries, exportFormat, domainMode, policyName, includeLocal]);

  if (!isOpen || !server) return null;

  const handleCopyRules = async () => {
    if (!generatedRules) return;
    try {
      await navigator.clipboard.writeText(generatedRules);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadRules = () => {
    if (!generatedRules) return;
    const ext =
      exportFormat === 'clash'
        ? 'yaml'
        : exportFormat === 'singbox'
          ? 'json'
          : exportFormat === 'surge'
            ? 'list'
            : 'txt';
    const safeName = (server.name || 'emby')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const fileName = `nocta-${safeName || 'emby'}-${exportFormat}.${ext}`;
    const blob = new Blob([generatedRules], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const redirectCount = entries.filter((e) => e.categories.includes('redirect')).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-[#121622] border border-white/15 shadow-2xl overflow-hidden text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">
                域名与分流规则 · {server.name}
              </h3>
              <p className="text-xs text-gray-400 truncate font-mono mt-0.5">
                {server.url} · 共收集 {entries.length} 个主机
                {redirectCount > 0 ? `（含 ${redirectCount} 个 302 重定向目标）` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings & Filter Bar */}
        <div className="px-6 py-3 border-b border-white/10 bg-black/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-white/20 bg-black/40 text-primary focus:ring-primary"
              />
              <span className="text-gray-200">自动收集访问域名/IP</span>
            </label>
            <label
              className="inline-flex items-center space-x-2 cursor-pointer select-none"
              title="起播后静默探测视频直链的 301/302 重定向链，完整捕获网盘/CDN 真实域名"
            >
              <input
                type="checkbox"
                checked={settings.probePlaybackRedirects}
                onChange={(e) => setProbePlaybackRedirects(e.target.checked)}
                className="rounded border-white/20 bg-black/40 text-primary focus:ring-primary"
              />
              <span className="text-gray-200">静默探测播放 302 重定向</span>
            </label>
          </div>

          <div className="flex items-center space-x-2">
            {entries.length > 0 && (
              confirmClear ? (
                <div className="flex items-center space-x-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      clearServerHosts(server.id);
                      setConfirmClear(false);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition cursor-pointer"
                  >
                    确认清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-2 py-1 rounded-lg bg-white/5 text-gray-400 hover:text-white transition cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/10 hover:border-red-500/30 text-gray-300 hover:text-red-300 text-xs transition flex items-center space-x-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空记录</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          {/* Search & Category Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="筛选域名、根域名、IP 或 URL 片段..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary/50"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'api', 'stream', 'redirect', 'image', 'subtitle'] as const).map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                      categoryFilter === cat
                        ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {cat === 'all' ? '全部' : CATEGORY_META[cat].label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Collected Host List */}
          <div className="rounded-xl border border-white/10 bg-black/25 overflow-hidden">
            {filteredEntries.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-500">
                {entries.length === 0
                  ? '暂无已收集的域名记录，浏览媒体库或播放视频后将自动收集。'
                  : '当前筛选条件下无匹配域名。'}
              </div>
            ) : (
              <div className="divide-y divide-white/5 max-h-60 overflow-y-auto">
                {filteredEntries.map((entry) => {
                  const isLocal = isLocalOrPrivateHost(entry.host);
                  return (
                    <div
                      key={entry.host}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-white">
                            {entry.host}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                            {entry.kind === 'domain'
                              ? '域名'
                              : entry.kind === 'ipv4'
                                ? 'IPv4'
                                : 'IPv6'}
                          </span>
                          {isLocal && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/20 border border-slate-500/30 text-slate-300">
                              局域网
                            </span>
                          )}
                          {entry.kind === 'domain' &&
                            entry.rootDomain &&
                            entry.rootDomain !== entry.host && (
                              <span className="text-[10px] text-gray-400 font-mono">
                                根域: {entry.rootDomain}
                              </span>
                            )}
                          {entry.categories.map((cat) => (
                            <span
                              key={cat}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_META[cat].badgeClass}`}
                            >
                              {CATEGORY_META[cat].label}
                            </span>
                          ))}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-500 font-mono">
                          <span>端口: {entry.ports.join(', ')}</span>
                          <span>命中: {entry.hitCount} 次</span>
                          <span>最近: {formatSeenTime(entry.lastSeenAt)}</span>
                          {entry.sampleUrl && (
                            <span
                              className="truncate max-w-md text-gray-400"
                              title={entry.sampleUrl}
                            >
                              {entry.sampleUrl}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHost(server.id, entry.host)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer shrink-0"
                        title="移除此域名"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Export Routing Rules Section */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-white">
                  一键生成代理分流规则
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as RuleExportFormat)}
                  className="px-2.5 py-1 rounded-lg bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-primary/50"
                >
                  <option value="clash">Clash / Mihomo (YAML)</option>
                  <option value="surge">Surge / Shadowrocket</option>
                  <option value="singbox">Sing-box (JSON)</option>
                  <option value="plain">纯域名 / IP 列表</option>
                </select>

                <select
                  value={domainMode}
                  onChange={(e) => setDomainMode(e.target.value as RuleDomainMode)}
                  className="px-2.5 py-1 rounded-lg bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-primary/50"
                >
                  <option value="suffix">根域名后缀 (DOMAIN-SUFFIX)</option>
                  <option value="exact">精确主机名 (DOMAIN)</option>
                </select>

                {(exportFormat === 'clash' || exportFormat === 'surge') && (
                  <input
                    type="text"
                    value={policyName}
                    onChange={(e) => setPolicyName(e.target.value)}
                    placeholder="策略名 (如 PROXY)"
                    className="w-28 px-2.5 py-1 rounded-lg bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-primary/50"
                    title="分流策略组名称（留空则省略策略名）"
                  />
                )}

                <label className="inline-flex items-center space-x-1.5 text-[11px] text-gray-300 cursor-pointer select-none ml-1">
                  <input
                    type="checkbox"
                    checked={includeLocal}
                    onChange={(e) => setIncludeLocal(e.target.checked)}
                    className="rounded border-white/20 bg-black/40 text-primary focus:ring-primary"
                  />
                  <span>含局域网</span>
                </label>
              </div>
            </div>

            <pre className="w-full max-h-44 overflow-auto rounded-lg bg-black/60 border border-white/10 p-3 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all leading-relaxed">
              {generatedRules || '# 当前无可导出的公网域名或 IP（可尝试勾选“含局域网”或先播放视频以收集重定向地址）'}
            </pre>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-400 flex items-center space-x-1">
                <RefreshCw className="w-3 h-3" />
                <span>已纳入多端同步配置，跨设备自动合并域名记录</span>
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleDownloadRules}
                  disabled={!generatedRules}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-gray-200 transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>导出文件</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyRules}
                  disabled={!generatedRules}
                  className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-semibold text-white transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>已复制规则</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>一键复制规则</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
