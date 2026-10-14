import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { useAuthStore, SavedServer } from '../../stores/useAuthStore';
import { useMediaStore } from '../../stores/useMediaStore';
import {
  testServerConnection,
  authenticateByName,
  normalizeServerUrl,
} from '../../api/embyClient';

interface EmbyServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开弹窗时直接进入编辑态的服务器 ID（例如从登录页点击某台服务器的编辑按钮） */
  initialEditId?: string | null;
}

export const EmbyServerModal: React.FC<EmbyServerModalProps> = ({
  isOpen,
  onClose,
  initialEditId,
}) => {
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
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // 列表中明文展开查看密码的服务器 ID（同时只展开一个）
  const [revealedId, setRevealedId] = useState<string | null>(null);

  const handleOpenAdd = () => {
    setName('');
    setUrl('');
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setFormError(null);
    setEditingId(null);
    setIsEditing(true);
  };

  const handleOpenEdit = (server: SavedServer) => {
    setName(server.name);
    setUrl(server.url);
    setUsername(server.username);
    setPassword(server.password ?? '');
    setShowPassword(false);
    setFormError(null);
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
      setShowPassword(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialEditId]);

  // 早期版本保存的服务器没有留存密码，用于给出"重新保存一次"的提示
  const originalPasswordMissing =
    !!editingId && servers.find((s) => s.id === editingId)?.password === undefined;

  if (!isOpen) return null;

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

    // 只有地址、账号或密码发生变化时才需要重新登录换取新的 AccessToken。
    // 密码框已预填本地记忆值，因此"只改名称"不会误触发重连；
    // 对早期版本未留存密码的记录，仅在用户主动填写密码时才视为变更。
    const passwordChanged =
      original?.password === undefined ? password.length > 0 : password !== original.password;

    const needReauth =
      !original ||
      passwordChanged ||
      cleanUser !== original.username ||
      normalizeServerUrl(original.url) !== cleanUrl;

    try {
      setSaving(true);

      // 仅修改显示名称：无需重新认证，直接落库
      if (original && !needReauth) {
        updateServer(original.id, { name: cleanName || original.name });
        setIsEditing(false);
        setEditingId(null);
        return;
      }

      const serverInfo = await testServerConnection(cleanUrl);
      const auth = await authenticateByName(cleanUrl, cleanUser, password);

      if (original) {
        updateServer(original.id, {
          name: cleanName || serverInfo.ServerName || original.name,
          url: cleanUrl,
          password,
          userId: auth.User.Id,
          username: auth.User.Name,
          accessToken: auth.AccessToken,
        });
        // 正在使用的服务器换址/换号后，旧媒体库缓存必须作废
        if (currentServerId === original.id) {
          clearMediaCache();
        }
      } else {
        addOrUpdateServer({
          id: auth.ServerId || serverInfo.Id || cleanUrl,
          name: cleanName || serverInfo.ServerName || 'Emby Server',
          url: cleanUrl,
          password,
          userId: auth.User.Id,
          username: auth.User.Name,
          accessToken: auth.AccessToken,
        });
      }

      setIsEditing(false);
      setEditingId(null);
    } catch (err: any) {
      setFormError(err?.message || '连接失败，请检查服务器地址、账号或网络');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitch = (id: string) => {
    if (id === currentServerId) return;
    setCurrentServer(id);
  };

  const handleDelete = (server: SavedServer) => {
    if (!confirm(`确定要删除服务器「${server.name}」吗？删除后需要重新登录该服务器。`)) return;
    removeServer(server.id);
    if (editingId === server.id) {
      setIsEditing(false);
      setEditingId(null);
    }
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
              可随时修改已保存服务器的名称、地址与登录账号。修改地址、账号或密码后会自动重新验证登录并更新访问令牌，
              仅调整名称则不会触发重连。为便于随时查看，登录密码会以明文形式与访问令牌一起保存在本机
              localStorage，请勿在共享设备上使用。
            </span>
          </div>

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
                            </div>
                            <div className="text-xs text-gray-400 truncate mt-0.5">
                              {s.username} @ {s.url}
                            </div>
                            {revealedId === s.id && (
                              <div className="text-xs text-amber-300/90 font-mono truncate mt-1">
                                密码：{s.password ? s.password : '（该账号为空密码）'}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center space-x-1 flex-shrink-0">
                            {!isActive && (
                              <button
                                onClick={() => handleSwitch(s.id)}
                                title="切换到该服务器"
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-primary/20 text-gray-300 hover:text-primary transition"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {s.password !== undefined && (
                              <button
                                onClick={() =>
                                  setRevealedId((cur) => (cur === s.id ? null : s.id))
                                }
                                title={
                                  revealedId === s.id ? '隐藏记住的密码' : '查看记住的密码'
                                }
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

              <div className="flex justify-end space-x-2 pt-3">
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
                  disabled={saving}
                  className="px-5 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {saving && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                  <span>{saving ? '正在验证连接...' : '保存并验证'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmbyServerModal;
