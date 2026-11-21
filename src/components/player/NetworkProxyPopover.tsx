import React from 'react';
import {
  X,
  Globe,
  Activity,
  RefreshCw,
  Settings,
  AlertTriangle,
  Wifi,
  ShieldCheck,
} from 'lucide-react';
import {
  PlayerTelemetry,
  ResolvedStreamProxyInfo,
  StreamProxyOverride,
} from '../../player/types';
import { formatNetworkSpeed } from './PlayerOsd';

interface NetworkProxyPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  networkSpeed: number;
  speedHistory: number[];
  telemetry: PlayerTelemetry;
  proxyInfo: ResolvedStreamProxyInfo | null;
  proxyOverride: StreamProxyOverride;
  onChangeProxyOverride: (mode: StreamProxyOverride) => void;
  onReloadStream: () => void;
  onOpenProxySettings: () => void;
}

function formatMb(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getProxyModeBadge(info: ResolvedStreamProxyInfo | null): {
  label: string;
  color: string;
} {
  if (!info) {
    return { label: '连接中 / 待解析', color: 'text-slate-300 bg-white/10 border-white/15' };
  }
  switch (info.mode) {
    case 'system_http':
      return {
        label: '系统 HTTP 代理',
        color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
      };
    case 'manual_http':
      return {
        label: '手动 HTTP 代理',
        color: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
      };
    case 'lan_bypass':
      return {
        label: '局域网直通旁路',
        color: 'text-teal-300 bg-teal-500/15 border-teal-500/30',
      };
    case 'socks5_fallback_direct':
      return {
        label: 'SOCKS5 提示 (流直连)',
        color: 'text-amber-300 bg-amber-500/15 border-amber-500/35',
      };
    case 'direct':
    default:
      return {
        label: '本地直连模式',
        color: 'text-slate-300 bg-white/10 border-white/15',
      };
  }
}

export const NetworkProxyPopover: React.FC<NetworkProxyPopoverProps> = ({
  isOpen,
  onClose,
  networkSpeed,
  speedHistory,
  telemetry,
  proxyInfo,
  proxyOverride,
  onChangeProxyOverride,
  onReloadStream,
  onOpenProxySettings,
}) => {
  if (!isOpen) return null;

  const badge = getProxyModeBadge(proxyInfo);

  // 构建 30s 实时网速折线图 SVG path
  const width = 300;
  const height = 56;
  const maxSpeed = Math.max(1024 * 128, ...speedHistory, networkSpeed);
  const points =
    speedHistory.length >= 2
      ? speedHistory.map((val, idx) => {
          const x = (idx / (speedHistory.length - 1)) * width;
          const y = height - Math.max(2, (val / maxSpeed) * (height - 8));
          return { x, y };
        })
      : [
          { x: 0, y: height - 2 },
          { x: width, y: height - 2 },
        ];

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <>
      <div className="fixed inset-0 z-20 bg-transparent" onClick={onClose} />
      <div className="fixed top-16 right-6 z-[35] w-80 md:w-96 rounded-2xl bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.8)] text-xs text-slate-200 select-none animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">网络缓冲与代理路由</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 当前生效路线 */}
          <div className="p-3 rounded-xl bg-black/35 border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center space-x-1.5">
                <Wifi className="w-3.5 h-3.5 text-sky-400" />
                <span>当前流代理状态</span>
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badge.color}`}>
                {badge.label}
              </span>
            </div>

            {proxyInfo?.effectiveProxy ? (
              <div className="font-mono text-[11px] text-emerald-300 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 truncate">
                出口节点: {proxyInfo.effectiveProxy}
              </div>
            ) : (
              <div className="font-mono text-[11px] text-slate-400 bg-white/[0.04] px-2.5 py-1.5 rounded-lg border border-white/[0.06] flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">
                  {proxyInfo?.mode === 'lan_bypass'
                    ? '命中内网/本地地址规则，已自动旁路直连'
                    : '未使用 HTTP 代理，直接连接媒体服务器'}
                </span>
              </div>
            )}

            {proxyInfo?.notice && (
              <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] leading-relaxed flex items-start space-x-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>{proxyInfo.notice}</span>
              </div>
            )}
          </div>

          {/* 30 秒网速折线图 + 缓冲状态 */}
          <div className="p-3 rounded-xl bg-black/35 border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                <span>实时下载速率 (30s)</span>
              </span>
              <span className="font-mono font-bold text-sky-400 tabular-nums">
                {formatNetworkSpeed(networkSpeed)}
              </span>
            </div>

            <div className="w-full h-14 bg-[#07090F] rounded-lg border border-white/[0.06] overflow-hidden relative">
              <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
                <defs>
                  <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#speedGrad)" />
                <path d={linePath} fill="none" stroke="#38BDF8" strokeWidth="1.75" />
              </svg>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono">
              <div className="bg-white/[0.03] rounded-lg px-2 py-1.5">
                <span className="text-slate-500 block text-[10px]">前向缓冲</span>
                <span className="text-white font-semibold tabular-nums">
                  {telemetry.cacheDuration !== undefined ? `${telemetry.cacheDuration.toFixed(1)}s` : '-'}
                </span>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-2 py-1.5">
                <span className="text-slate-500 block text-[10px]">已缓存大小</span>
                <span className="text-white font-semibold tabular-nums">
                  {formatMb(telemetry.cacheForwardBytes)}
                </span>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-2 py-1.5">
                <span className="text-slate-500 block text-[10px]">帧率 / 丢帧</span>
                <span className="text-white font-semibold tabular-nums">
                  {telemetry.fps ? Math.round(telemetry.fps) : '-'} / {telemetry.droppedFrames ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* 播放流代理三段热切换 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold uppercase tracking-wider">本片网络策略 (原地热切重连)</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'follow', label: '跟随全局配置' },
                  { id: 'direct', label: '强制直连' },
                  { id: 'proxy', label: '强制走代理' },
                ] as { id: StreamProxyOverride; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onChangeProxyOverride(opt.id)}
                  className={`py-2 rounded-xl text-[11px] font-semibold transition cursor-pointer border ${
                    proxyOverride === opt.id
                      ? 'bg-primary text-white border-primary shadow-md'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => {
                onReloadStream();
                onClose();
              }}
              className="py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>重载当前流</span>
            </button>
            <button
              onClick={() => {
                onClose();
                onOpenProxySettings();
              }}
              className="py-2 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-300 font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>代理详细配置</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default NetworkProxyPopover;
