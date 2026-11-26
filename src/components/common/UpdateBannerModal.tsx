import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  formatUpdateBytes,
  formatUpdateSpeed,
  useUpdaterStore,
} from '../../stores/useUpdaterStore';

const INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)<>]+)/g;

function sanitizeReleaseNotes(raw?: string): string {
  return (raw || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractToastPreview(raw?: string): string {
  const cleaned = sanitizeReleaseNotes(raw);
  if (!cleaned) return '';
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const meaningful =
    lines.find(
      (line) =>
        !/^#{1,6}\s+/.test(line) &&
        !/^---+$/.test(line) &&
        !/^\*\*Full Changelog\*\*/i.test(line) &&
        !/^\*\*完整变更对比\*\*/.test(line) &&
        !/^https?:\/\/\S+$/i.test(line)
    ) || lines[0];

  if (!meaningful) return '';
  return meaningful
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function renderInlineSegments(text: string): React.ReactNode {
  const parts = text.split(INLINE_TOKEN_RE);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1 py-0.5 rounded bg-white/10 text-sky-300 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 hover:text-sky-300 underline break-all"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const ReleaseNotesContent: React.FC<{ body?: string }> = ({ body }) => {
  const cleaned = sanitizeReleaseNotes(body);
  if (!cleaned) {
    return (
      <p className="text-slate-400">
        暂无详细更新日志，建议点击下方链接查看 GitHub Release 页面。
      </p>
    );
  }

  const lines = cleaned.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) {
          return <div key={idx} className="h-1" />;
        }
        if (/^(?:---|\*\*\*|___)$/.test(line)) {
          return <hr key={idx} className="border-white/10 my-2" />;
        }
        const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
        if (headingMatch) {
          return (
            <h4
              key={idx}
              className="text-white font-semibold text-xs pt-2 first:pt-0 tracking-wide"
            >
              {renderInlineSegments(headingMatch[1].trim())}
            </h4>
          );
        }
        const bulletMatch = line.match(/^[-*]\s+(.+)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-0.5 leading-relaxed">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-sky-400/80 shrink-0" />
              <span className="flex-1 text-slate-300">
                {renderInlineSegments(bulletMatch[1].trim())}
              </span>
            </div>
          );
        }
        return (
          <p key={idx} className="text-slate-300 leading-relaxed">
            {renderInlineSegments(line)}
          </p>
        );
      })}
    </div>
  );
};

export const UpdateBannerModal: React.FC = () => {
  const location = useLocation();
  const isPlayerRoute = location.pathname.startsWith('/player');

  const status = useUpdaterStore((s) => s.status);
  const updateInfo = useUpdaterStore((s) => s.updateInfo);
  const progress = useUpdaterStore((s) => s.progress);
  const error = useUpdaterStore((s) => s.error);
  const ignoredVersion = useUpdaterStore((s) => s.ignoredVersion);
  const bannerDismissed = useUpdaterStore((s) => s.bannerDismissed);
  const detailsModalOpen = useUpdaterStore((s) => s.detailsModalOpen);

  const installUpdate = useUpdaterStore((s) => s.installUpdate);
  const relaunchToApply = useUpdaterStore((s) => s.relaunchToApply);
  const ignoreCurrentUpdate = useUpdaterStore((s) => s.ignoreCurrentUpdate);
  const dismissBanner = useUpdaterStore((s) => s.dismissBanner);
  const setDetailsModalOpen = useUpdaterStore((s) => s.setDetailsModalOpen);

  const isBusy = status === 'downloading' || status === 'installing';
  const isReady = status === 'ready_to_restart';
  const showFloatingToast =
    !isPlayerRoute &&
    !detailsModalOpen &&
    !!updateInfo &&
    ((status === 'available' &&
      !bannerDismissed &&
      ignoredVersion !== updateInfo.version) ||
      isBusy ||
      isReady);

  const percentValue =
    typeof progress?.percent === 'number'
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : undefined;
  const speedText = formatUpdateSpeed(progress?.speedBps);
  const releaseNotesUrl = updateInfo?.version
    ? `https://github.com/wade6716/Nocta/releases/tag/v${updateInfo.version.replace(/^v/i, '')}`
    : 'https://github.com/wade6716/Nocta/releases';
  const toastPreview = extractToastPreview(updateInfo?.body);

  useEffect(() => {
    if (!detailsModalOpen || !updateInfo) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetailsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailsModalOpen, updateInfo, setDetailsModalOpen]);

  if (!showFloatingToast && !(detailsModalOpen && updateInfo)) {
    return null;
  }

  return (
    <>
      {/* 右下角无打扰更新浮窗（观影路由自动隐藏） */}
      {showFloatingToast && updateInfo && (
        <div className="fixed bottom-5 right-5 z-50 w-[370px] max-w-[calc(100vw-2.5rem)] rounded-2xl bg-[#121622]/95 backdrop-blur-2xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.75)] p-4 text-xs text-slate-200 select-none animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 border ${
                  isReady
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                    : 'bg-sky-500/20 border-sky-400/35 text-sky-300'
                }`}
              >
                {isReady ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : isBusy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-white text-[13px]">
                    {isReady
                      ? '更新已安装就绪'
                      : isBusy
                      ? status === 'installing'
                        ? '正在安装更新...'
                        : '正在下载更新...'
                      : `发现新版本 v${updateInfo.version}`}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                      updateInfo.channel === 'prerelease'
                        ? 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                        : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                    }`}
                  >
                    {updateInfo.channel === 'prerelease' ? '预发布' : '正式版'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  v{updateInfo.currentVersion} → v{updateInfo.version}
                </p>
              </div>
            </div>

            {!isBusy && (
              <button
                onClick={dismissBanner}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
                title="稍后提醒"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {!isBusy && !isReady && toastPreview && (
            <p className="mt-2.5 text-[11px] text-slate-300/90 leading-relaxed line-clamp-2 bg-black/25 rounded-lg px-2.5 py-1.5 border border-white/[0.06]">
              {toastPreview}
            </p>
          )}

          {isBusy && (
            <div className="mt-3 space-y-1.5">
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all duration-150"
                  style={{ width: `${percentValue ?? 12}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                <span>
                  {formatUpdateBytes(progress?.downloadedBytes)}
                  {progress?.totalBytes ? ` / ${formatUpdateBytes(progress.totalBytes)}` : ''}
                </span>
                <span>
                  {[percentValue !== undefined ? `${percentValue}%` : null, speedText]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </div>
          )}

          {isReady && (
            <p className="mt-2 text-[11px] text-emerald-200/90 leading-relaxed">
              新版本已校验并通过签名验证，重启 Nocta 后立即生效。
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            {isReady ? (
              <>
                <button
                  onClick={relaunchToApply}
                  className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>立即重启更新</span>
                </button>
                <button
                  onClick={dismissBanner}
                  className="py-1.5 px-2.5 rounded-xl bg-white/[0.06] hover:bg-white/10 text-slate-300 text-xs transition cursor-pointer"
                >
                  稍后重启
                </button>
              </>
            ) : isBusy ? (
              <button
                onClick={() => setDetailsModalOpen(true)}
                className="w-full py-1.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/10 text-slate-300 text-xs transition cursor-pointer"
              >
                查看更新详情
              </button>
            ) : (
              <>
                <button
                  onClick={installUpdate}
                  className="flex-1 py-1.5 px-3 rounded-xl bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-sky-500/20"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>立即更新</span>
                </button>
                <button
                  onClick={() => setDetailsModalOpen(true)}
                  className="py-1.5 px-2.5 rounded-xl bg-white/[0.06] hover:bg-white/10 text-slate-200 text-xs transition cursor-pointer"
                >
                  查看详情
                </button>
                <button
                  onClick={ignoreCurrentUpdate}
                  className="py-1.5 px-2.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-slate-400 hover:text-slate-200 text-xs transition cursor-pointer"
                  title="忽略当前版本，下次有更高版本时再提醒"
                >
                  忽略
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 完整更新日志与安装详情模态框 */}
      {detailsModalOpen && updateInfo && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none"
          onClick={() => setDetailsModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-[#111521]/95 border border-white/15 shadow-2xl overflow-hidden text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">
                      Nocta · 诺塔 v{updateInfo.version}
                    </h3>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        updateInfo.channel === 'prerelease'
                          ? 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                          : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                      }`}
                    >
                      {updateInfo.channel === 'prerelease' ? '预发布' : '正式版'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    当前 v{updateInfo.currentVersion} → 最新 v{updateInfo.version}
                    {updateInfo.date ? ` · ${updateInfo.date.slice(0, 10)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailsModalOpen(false)}
                aria-label={isBusy ? '收起到后台下载' : '关闭更新详情'}
                title={isBusy ? '收起到后台下载' : '关闭'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="max-h-64 overflow-y-auto custom-scrollbar rounded-xl bg-black/35 border border-white/[0.07] p-3.5 text-xs text-slate-300 leading-relaxed">
                <ReleaseNotesContent body={updateInfo.body} />
              </div>

              {isBusy && (
                <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-400/25 space-y-2">
                  <div className="flex items-center justify-between text-xs text-sky-200 font-medium">
                    <span>
                      {status === 'installing' ? '正在校验签名并安装更新...' : '正在下载更新安装包...'}
                    </span>
                    <span className="font-mono tabular-nums">
                      {percentValue !== undefined ? `${percentValue}%` : ''}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all duration-150"
                      style={{ width: `${percentValue ?? 12}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                    <span>
                      {formatUpdateBytes(progress?.downloadedBytes)}
                      {progress?.totalBytes ? ` / ${formatUpdateBytes(progress.totalBytes)}` : ''}
                    </span>
                    {speedText && <span>{speedText}</span>}
                  </div>
                </div>
              )}

              {status === 'error' && error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <a
                  href={releaseNotesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-slate-400 hover:text-sky-300 transition inline-flex items-center gap-1"
                >
                  <span>在 GitHub 查看</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                <div className="flex items-center gap-2">
                  {isBusy && (
                    <button
                      type="button"
                      onClick={() => setDetailsModalOpen(false)}
                      className="px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/10 text-slate-300 text-xs transition cursor-pointer"
                    >
                      后台下载
                    </button>
                  )}

                  {!isBusy && !isReady && (
                    <button
                      onClick={ignoreCurrentUpdate}
                      className="px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/10 text-slate-300 text-xs transition cursor-pointer"
                    >
                      忽略此版本
                    </button>
                  )}

                  {isReady ? (
                    <button
                      onClick={relaunchToApply}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>立即重启更新</span>
                    </button>
                  ) : (
                    <button
                      onClick={installUpdate}
                      disabled={isBusy}
                      className="px-4 py-2 rounded-xl bg-[#38BDF8] hover:bg-[#0ea5e9] text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60"
                    >
                      {isBusy ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isBusy
                          ? status === 'installing'
                            ? '正在安装...'
                            : '正在下载...'
                          : status === 'error'
                          ? '重试下载并安装'
                          : '下载并安装'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UpdateBannerModal;
