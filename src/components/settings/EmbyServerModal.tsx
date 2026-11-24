import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  X,
  Server,
  Plus,
  Trash2,
  Edit2,
  Check,
  LoaderCircle,
  User,
  Lock,
  ShieldAlert,
  ArrowRight,
  Eye,
  EyeOff,
  Activity,
  TriangleAlert,
} from 'lucide-react';
import { useAuthStore, SavedServer } from '../../stores/useAuthStore';
import { useMediaStore } from '../../stores/useMediaStore';
import { ProxyConfig, ProxyType } from '../../api/http';
import {
  testServerConnection,
  authenticateByName,
  normalizeServerUrl,
  EmbyAuthResponse,
  DEFAULT_EMBY_USER_AGENT,
  EMBY_USER_AGENT_PRESETS,
} from '../../api/embyClient';

interface EmbyServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开弹窗时直接进入编辑态的服务器 ID（例如从登录页点击某台服务器的编辑按钮） */
  initialEditId?: string | null;
  onSaved?: () => void;
}

type Tone = 'ok' | 'warn' | 'error' | 'idle';

const TONE_STYLES: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  warn: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
  error: 'bg-red-500/10 border-red-500/20 text-red-400',
  idle: 'bg-white/5 border-white/10 text-gray-400',
};

interface ConnectionTestResult {
  reachable: boolean;
  latency?: number;
  serverName?: string;
  error?: string;
  authChecked: boolean;
  authOk: boolean;
  authError?: string;
  auth?: EmbyAuthResponse;
}

/**
 * 探测服务器：先做连通性检测，凭据可用时顺带验证登录。
 * 任何一步失败都只作为结果返回，绝不抛出，以保证"连接失败也能保存"。
 */
async function probeServer(params: {
  url: string;
  username: string;
  password: string;
  attemptAuth: boolean;
  proxy?: ProxyConfig;
  userAgent?: string;
}): Promise<ConnectionTestResult> {
  const cleanUrl = normalizeServerUrl(params.url);
  const user = params.username.trim();
  const startTime = performance.now();

  let info;
  try {
    info = await testServerConnection(cleanUrl, {
      proxy: params.proxy,
      userAgent: params.userAgent,
    });
  } catch (err: any) {
    return {
      reachable: false,
      authChecked: false,
      authOk: false,
      error: err?.message || '无法连接到服务器（请确认服务已启动或地址可达）',
    };
  }

  const latency = Math.round(performance.now() - startTime);
  if (!params.attemptAuth || !user) {
    return { reachable: true, latency, serverName: info.ServerName, authChecked: false, authOk: false };
  }

  try {
    const auth = await authenticateByName(cleanUrl, user, params.password, {
      proxy: params.proxy,
      userAgent: params.userAgent,
    });
    return {
      reachable: true,
      latency,
      serverName: info.ServerName,
      authChecked: true,
      authOk: true,
      auth,
    };
  } catch (err: any) {
    return {
      reachable: true,
      latency,
      serverName: info.ServerName,
      authChecked: true,
      authOk: false,
      authError: err?.message || '登录验证失败',
    };
  }
}

function describeResult(result: ConnectionTestResult): { tone: Tone; text: string } {
  if (!result.reachable) {
    return { tone: 'error', text: `无法连接：${result.error || '网络不可达'}` };
  }

  const base = `服务器可达${result.serverName ? ` · ${result.serverName}` : ''}${
    result.latency !== undefined ? ` · ${result.latency} ms` : ''
  }`;

  if (result.authChecked && !result.authOk) {
    return { tone: 'warn', text: `${base}，但登录校验未通过：${result.authError}` };
  }
  return { tone: 'ok', text: `${base}${result.authChecked ? '，登录校验通过' : '（未校验登录）'}` };
}

/** 连通且登录校验未失败，即视为连接正常 */
function isResultOk(result: ConnectionTestResult): boolean {
  return result.reachable && (!result.authChecked || result.authOk);
}

export const EmbyServerModal: React.FC<EmbyServerModalProps> = ({
  isOpen,
  onClose,
  initialEditId,
  onSaved,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isHomePage = location.pathname === '/';
  const { servers, currentServerId, addOrUpdateServer, updateServer, removeServer, setCurrentServer } =
    useAuthStore();
  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 表单状态
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ tone: Tone; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // 列表中明文展开查看密码的服务器 ID（同时只展开一个）
  const [revealedId, setRevealedId] = useState<string | null>(null);
  // 列表中正在测速的服务器 ID
  const [testingId, setTestingId] = useState<string | null>(null);
  // 保存后的提示（例如离线保存成功）
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);

  const resetFormFeedback = () => {
    setFormError(null);
    setTestResult(null);
    setNotice(null);
  };

  const handleOpenAdd = () => {
    setName('');
    setUrl('');
    setUsername('');
    setPassword('');
    setUserAgent('');
    setShowPassword(false);
    resetFormFeedback();
    setEditingId(null);
    setIsEditing(true);
  };

  const handleOpenEdit = (server: SavedServer) => {
    setName(server.name);
    setUrl(server.url);
    setUsername(server.username);
    setPassword(server.password ?? '');
    setUserAgent(server.userAgent ?? '');
    setShowPassword(false);
    resetFormFeedback();
    setEditingId(server.id);
    setIsEditing(true);
  };

  // 每次打开弹窗时重置视图；若指定了 initialEditId 则直接进入该服务器的编辑态
  useEffect(() => {
    if (!isOpen) return;

    const target = initialEditId ? servers.find((s) => s.id === initialEditId) : null;
    if (target) {
      handleOpenEdit(target);
    } else {
      setIsEditing(false);
      setEditingId(null);
      setFormError(null);
      setTestResult(null);
      setNotice(null);
      setShowPassword(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialEditId]);

  // 早期版本保存的服务器没有留存密码，用于给出"重新保存一次"的提示
  const originalPasswordMissing =
    !!editingId && servers.find((s) => s.id === editingId)?.password === undefined;

  if (!isOpen) return null;

  /** 表单内的"测试连接"：只探测不落库，结果实时反馈 */
  const handleTestConnection = async () => {
    const rawUrl = url.trim();
    if (!rawUrl) {
      setTestResult({ tone: 'error', text: '请先填写服务器地址' });
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);
      const result = await probeServer({
        url: rawUrl,
        username,
        password,
        attemptAuth: !!username.trim(),
        userAgent: userAgent.trim() || undefined,
      });
      setTestResult(describeResult(result));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = name.trim();
    const rawUrl = url.trim();
    const cleanUser = username.trim();

    if (!rawUrl) {
      setFormError('请填写服务器地址');
      return;
    }
    if (!cleanUser) {
      setFormError('请填写用户名');
      return;
    }

    const cleanUrl = normalizeServerUrl(rawUrl);
    const original = editingId ? servers.find((s) => s.id === editingId) || null : null;
    const urlChanged = !original || normalizeServerUrl(original.url) !== cleanUrl;

    // 只有地址、账号或密码发生变化时才需要重新登录换取新的 AccessToken。
    // 密码框已预填本地记忆值，因此"只改名称"不会误触发重连；
    // 对早期版本未留存密码的记录，仅在用户主动填写密码时才视为变更。
    const passwordChanged =
      original?.password === undefined ? password.length > 0 : password !== original.password;

    const needReauth = !original || passwordChanged || cleanUser !== original.username || urlChanged;

    const cleanUserAgent = userAgent.trim() || undefined;

    try {
      setSaving(true);
      setNotice(null);

      // 仅修改显示名称或自定义 UA：无需重新登录，直接原地落库
      if (original && !needReauth) {
        updateServer(original.id, {
          name: cleanName || original.name,
          userAgent: cleanUserAgent,
        });
        setIsEditing(false);
        setEditingId(null);
        setNotice({ tone: 'ok', text: `已保存「${cleanName || original.name}」配置。` });
        onSaved?.();
        return;
      }

      const result = await probeServer({
        url: cleanUrl,
        username: cleanUser,
        password,
        attemptAuth: true,
        userAgent: cleanUserAgent,
      });
      const ok = isResultOk(result);
      const testMeta = {
        lastTestOk: ok,
        lastLatencyMs: result.reachable ? result.latency : undefined,
        lastTestError: ok
          ? undefined
          : result.error || result.authError || '连接失败',
        lastTestAt: Date.now(),
      };
      const displayName = cleanName || result.serverName || original?.name || 'Emby Server';

      // 情况一：完全验证通过 —— 更新访问令牌
      if (ok && result.auth) {
        const auth = result.auth;
        if (original) {
          updateServer(original.id, {
            name: displayName,
            url: cleanUrl,
            password,
            userAgent: cleanUserAgent,
            userId: auth.User.Id,
            username: auth.User.Name,
            accessToken: auth.AccessToken,
            ...testMeta,
          });
          // 正在使用的服务器换址/换号后，旧媒体库缓存必须作废
          if (currentServerId === original.id) {
            clearMediaCache();
          }
        } else {
          clearMediaCache();
          addOrUpdateServer({
            id: auth.ServerId || result.serverName || cleanUrl,
            name: displayName,
            url: cleanUrl,
            password,
            userAgent: cleanUserAgent,
            userId: auth.User.Id,
            username: auth.User.Name,
            accessToken: auth.AccessToken,
            ...testMeta,
          });
        }

        setIsEditing(false);
        setEditingId(null);
        setNotice({ tone: 'ok', text: `已保存「${displayName}」并验证连接成功。` });
        onSaved?.();
        return;
      }

      // 情况二：连接或登录失败 —— 依然保存用户填写的信息，仅标记为未验证
      const reason = result.error || result.authError || '连接失败';
      if (original) {
        updateServer(original.id, {
          name: displayName,
          url: cleanUrl,
          username: cleanUser,
          password,
          userAgent: cleanUserAgent,
          ...testMeta,
          // 地址变更后旧令牌已不可信，清空以便重新登录
          ...(urlChanged ? { userId: '', accessToken: '' } : {}),
        });
        if (urlChanged && currentServerId === original.id) {
          clearMediaCache();
        }
      } else {
        // 离线新增的服务器不抢占当前选中项，避免首页加载出空媒体库
        addOrUpdateServer(
          {
            id: cleanUrl,
            name: displayName,
            url: cleanUrl,
            username: cleanUser,
            password,
            userAgent: cleanUserAgent,
            userId: '',
            accessToken: '',
            ...testMeta,
          },
          { makeCurrent: false }
        );
      }

      setIsEditing(false);
      setEditingId(null);
      setNotice({
        tone: 'warn',
        text: `已保存「${displayName}」，但当前未能连接：${reason}。配置已记录，服务器恢复后可在列表中点击测试按钮重试。`,
      });
      onSaved?.();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  /** 列表内的"测试连接"：结果写回该服务器记录 */
  const handleRowTest = async (server: SavedServer) => {
    try {
      setTestingId(server.id);
      const result = await probeServer({
        url: server.url,
        username: server.username,
        password: server.password ?? '',
        // 未记住密码时只做连通性探测，避免用空密码误判为登录失败
        attemptAuth: server.password !== undefined,
        userAgent: server.userAgent,
      });
      const ok = isResultOk(result);
      updateServer(server.id, {
        lastTestOk: ok,
        lastLatencyMs: result.reachable ? result.latency : undefined,
        lastTestError: ok ? undefined : result.error || result.authError || '连接失败',
        lastTestAt: Date.now(),
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleSwitch = (id: string) => {
    if (!isHomePage) return;
    if (id === currentServerId) {
      onClose();
      return;
    }
    clearMediaCache();
    setCurrentServer(id);
    onClose();
    document.getElementById('main-scroll-container')?.scrollTo({ top: 0 });
    navigate('/', { replace: true });
  };

  const handleDelete = (server: SavedServer) => {
    if (!confirm(`确定要删除服务器「${server.name}」吗？删除后需要重新登录该服务器。`)) return;
    if (server.id === currentServerId) {
      clearMediaCache();
    }
    removeServer(server.id);
    if (editingId === server.id) {
      setIsEditing(false);
      setEditingId(null);
    }
  };

  const statusOf = (server: SavedServer): { tone: Tone; label: string } => {
    if (server.lastTestOk === true) {
      return {
        tone: 'ok',
        label:
          server.lastLatencyMs !== undefined
            ? `正常 · ${server.lastLatencyMs} ms`
            : '连接正常',
      };
    }
    if (server.lastTestOk === false) return { tone: 'warn', label: '连接失败' };
    return { tone: 'idle', label: '未验证' };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="relative w-full max-w-xl bg-[#161922] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-2.5">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-white">Emby / Jellyfin 服务器管理</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-3.5 flex items-start space-x-3 text-xs text-gray-300">
            <ShieldAlert className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <span>
              可随时修改已保存服务器的名称、地址与登录账号，连接不上也能先保存配置。为便于随时查看，
              登录密码会以明文形式与访问令牌一起保存在本机 localStorage，请勿在共享设备上使用。
            </span>
          </div>

          {notice && !isEditing && (
            <div
              className={`border rounded-xl p-3.5 flex items-start justify-between space-x-3 text-xs leading-relaxed ${TONE_STYLES[notice.tone]}`}
            >
              <span>{notice.text}</span>
              <button
                onClick={() => setNotice(null)}
                className="flex-shrink-0 opacity-70 hover:opacity-100 transition"
                title="关闭提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!isEditing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  已保存服务器 ({servers.length})
                </span>
                <button
                  onClick={handleOpenAdd}
                  className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增服务器</span>
                </button>
              </div>

              {servers.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">
                  暂无已保存的服务器，点击「新增服务器」开始配置。
                </p>
              ) : (
                <div className="space-y-2">
                  {servers.map((s) => {
                    const isActive = s.id === currentServerId;
                    const status = statusOf(s);
                    const isTesting = testingId === s.id;

                    return (
                      <div
                        key={s.id}
                        className={`p-3 rounded-xl border transition ${
                          isActive
                            ? 'bg-primary/10 border-primary/40'
                            : 'bg-black/30 border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0 pr-3">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-semibold text-white truncate">
                                {s.name}
                              </span>
                              {isActive && (
                                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-medium flex-shrink-0">
                                  <Check className="w-3 h-3" />
                                  <span>当前使用</span>
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${
                                  TONE_STYLES[isTesting ? 'idle' : status.tone]
                                }`}
                                title={s.lastTestError || undefined}
                              >
                                {isTesting ? '正在测试' : status.label}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 truncate mt-0.5">
                              {s.username || '（未填写用户名）'} @ {s.url}
                            </div>
                            {revealedId === s.id && (
                              <div className="text-xs text-amber-300/90 font-mono truncate mt-1">
                                密码：{s.password ? s.password : '（该账号为空密码或未记住）'}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center space-x-1 flex-shrink-0">
                            <button
                              onClick={() => handleRowTest(s)}
                              disabled={isTesting}
                              title="测试连接"
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition disabled:opacity-50"
                            >
                              {isTesting ? (
                                <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Activity className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {!isActive && isHomePage && (
                              <button
                                onClick={() => handleSwitch(s.id)}
                                title="切换到该服务器"
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-primary/20 text-gray-300 hover:text-primary transition cursor-pointer"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {s.password !== undefined && (
                              <button
                                onClick={() => setRevealedId((cur) => (cur === s.id ? null : s.id))}
                                title={revealedId === s.id ? '隐藏记住的密码' : '查看记住的密码'}
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                              >
                                {revealedId === s.id ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenEdit(s)}
                              title="编辑服务器信息"
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(s)}
                              title="删除服务器"
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Edit / Add Form */
            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-sm font-semibold text-white">
                  {editingId ? '编辑服务器信息' : '新增服务器'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditingId(null);
                  }}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  返回列表
                </button>
              </div>

              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 leading-relaxed">
                  {formError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">服务器名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如: 客厅 NAS / 远程 VPS"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                />
                <p className="text-[11px] text-gray-500">留空则沿用服务器自报的名称。</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">服务器地址</label>
                <div className="relative flex items-center">
                  <Server className="w-4 h-4 absolute left-3 text-gray-500" />
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://192.168.1.100:8096"
                    className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">用户名</label>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 absolute left-3 text-gray-500" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Emby / Jellyfin 登录用户名"
                    className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">密码</label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 absolute left-3 text-gray-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="留空表示沿用已保存的登录凭据"
                    className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-10 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute right-2.5 p-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  已自动填入本机记住的密码，可点击右侧眼睛按钮查看。仅调整名称时不会重新登录；改动密码后保存会立即重新验证。
                </p>
                {editingId && originalPasswordMissing && (
                  <p className="text-[11px] text-amber-400/80">
                    该服务器保存于早期版本，未记住密码。重新输入并保存一次后即可随时查看。
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">
                  自定义 User-Agent
                  <span className="ml-1.5 text-[11px] text-gray-500 font-normal">
                    （可选，解决公益服 / Cloudflare / 302 直链拦截）
                  </span>
                </label>
                <input
                  type="text"
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  placeholder={`留空默认: ${DEFAULT_EMBY_USER_AGENT}`}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-primary"
                />
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {EMBY_USER_AGENT_PRESETS.map((preset) => {
                    const isSelected = userAgent.trim() === preset.value;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setUserAgent(preset.value)}
                        className={`px-2 py-1 rounded-md text-[11px] border transition cursor-pointer ${
                          isSelected
                            ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                        }`}
                        title={preset.value || DEFAULT_EMBY_USER_AGENT}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3 border rounded-lg text-xs leading-relaxed flex items-start space-x-2 ${TONE_STYLES[testResult.tone]}`}
                >
                  {testResult.tone === 'ok' ? (
                    <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  ) : (
                    <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  )}
                  <span>{testResult.text}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || saving}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-200 rounded-lg text-xs font-medium transition disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {testing ? (
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Activity className="w-3.5 h-3.5" />
                  )}
                  <span>{testing ? '正在测试...' : '测试连接'}</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setEditingId(null);
                    }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={saving || testing}
                    className="px-5 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    {saving && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                    <span>{saving ? '正在保存...' : '保存服务器'}</span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-gray-500 text-right">
                连接失败也会保存配置，仅标记为「连接失败」，可稍后重试。
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmbyServerModal;
