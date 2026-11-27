import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  User,
  Lock,
  PlayCircle,
  Trash2,
  ArrowRight,
  Edit2,
  Settings2,
  Eye,
  EyeOff,
  TriangleAlert,
  Globe,
  Settings,
  FolderSync,
  Upload,
} from 'lucide-react';
import {
  testServerConnection,
  authenticateByName,
  normalizeServerUrl,
} from '../api/embyClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useMediaStore } from '../stores/useMediaStore';
import { EmbyServerModal } from '../components/settings/EmbyServerModal';
import { NetworkProxyModal } from '../components/settings/NetworkProxyModal';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { servers, addOrUpdateServer, removeServer, setCurrentServer } = useAuthStore();
  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);

  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!serverUrl.trim() || !username.trim()) {
      setErrorMsg('请填写服务器地址和用户名');
      return;
    }

    try {
      setLoading(true);
      const cleanUrl = normalizeServerUrl(serverUrl);
      const serverInfo = await testServerConnection(cleanUrl);
      const auth = await authenticateByName(cleanUrl, username.trim(), password);

      clearMediaCache();
      addOrUpdateServer({
        id: auth.ServerId || serverInfo.Id || cleanUrl,
        name: serverInfo.ServerName || 'Emby Server',
        url: cleanUrl,
        userId: auth.User.Id,
        username: auth.User.Name,
        accessToken: auth.AccessToken,
        password,
        lastTestOk: true,
        lastTestError: undefined,
        lastTestAt: Date.now(),
      });

      navigate('/');
    } catch (err: any) {
      setErrorMsg(err.message || '连接失败，请检查地址或网络');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (serverId: string) => {
    clearMediaCache();
    setCurrentServer(serverId);
    navigate('/');
  };

  const handleEditServer = (serverId: string) => {
    setEditingServerId(serverId);
    setIsServerModalOpen(true);
  };

  return (
    <div className="min-h-full w-full flex flex-col justify-center items-center py-10 px-6 select-none">
      <div className="w-full max-w-md space-y-8">
        {/* Logo and Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-cyan-400 text-white shadow-xl shadow-primary/20">
            <PlayCircle className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center justify-center space-x-2">
            <span>Nocta</span>
            <span className="text-sm px-2.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium tracking-normal">
              诺塔
            </span>
          </h1>
          <p className="text-xs text-gray-400">沉浸式私人影院 · 银幕与弹幕的双重盛宴</p>
        </div>

        {/* 顶部快捷操作栏：即使未添加任何服务器，也可直接进入设置或导入配置 */}
        <div className="flex items-center justify-center space-x-2.5 text-xs text-gray-400">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] hover:text-white border border-white/[0.06] transition flex items-center space-x-1.5 cursor-pointer"
            title="进入系统设置"
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
            <span>系统设置</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings?tab=sync')}
            className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] hover:text-white border border-white/[0.06] transition flex items-center space-x-1.5 cursor-pointer"
            title="导入现有配置文件或恢复备份"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>导入配置</span>
          </button>
          <button
            type="button"
            onClick={() => setIsProxyModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] hover:text-white border border-white/[0.06] transition flex items-center space-x-1.5 cursor-pointer"
            title="配置网络代理"
          >
            <Globe className="w-3.5 h-3.5 text-primary" />
            <span>网络代理</span>
          </button>
        </div>

        {/* Saved servers quick entry */}
        {servers.length > 0 && (
          <div className="bg-surface/80 border border-white/5 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                已保存的服务器
              </span>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setIsProxyModalOpen(true)}
                  className="text-xs text-gray-400 hover:text-white transition flex items-center space-x-1 cursor-pointer"
                  title="网络与代理设置"
                >
                  <Globe className="w-3.5 h-3.5 text-primary" />
                  <span>网络代理</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingServerId(null);
                    setIsServerModalOpen(true);
                  }}
                  className="text-xs text-primary hover:text-primary-hover transition flex items-center space-x-1 cursor-pointer"
                  title="服务器管理"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>管理</span>
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {servers.map((srv) => (
                <div
                  key={srv.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-card hover:bg-white/10 transition border border-white/5 group"
                >
                  <div
                    onClick={() => handleQuickLogin(srv.id)}
                    className="flex-1 cursor-pointer flex flex-col min-w-0 pr-2"
                  >
                    <span className="flex items-center space-x-1.5 min-w-0">
                      <span className="text-sm font-semibold text-white truncate">{srv.name}</span>
                      {srv.lastTestOk === false && (
                        <span
                          className="flex-shrink-0 text-amber-400"
                          title={srv.lastTestError ? `上次连接未成功：${srv.lastTestError}` : '上次连接未成功'}
                        >
                          <TriangleAlert className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400 truncate">
                      {srv.username} @ {srv.url}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => handleQuickLogin(srv.id)}
                      className="p-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary hover:text-white transition cursor-pointer"
                      title="直接进入"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleEditServer(srv.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
                      title="编辑服务器信息"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeServer(srv.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 transition cursor-pointer"
                      title="删除此服务器"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Login Form */}
        <form
          onSubmit={handleLogin}
          className="bg-surface/80 border border-white/5 rounded-2xl p-6 shadow-xl space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              添加新连接
            </span>
            {servers.length === 0 && (
              <button
                type="button"
                onClick={() => setIsProxyModalOpen(true)}
                className="text-xs text-gray-400 hover:text-white transition flex items-center space-x-1 cursor-pointer"
                title="网络与代理设置"
              >
                <Globe className="w-3.5 h-3.5 text-primary" />
                <span>配置网络代理</span>
              </button>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs leading-relaxed">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">服务器地址</label>
            <div className="relative flex items-center">
              <Server className="w-4 h-4 absolute left-3 text-gray-400" />
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://192.168.1.100:8096"
                className="w-full bg-card border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">账号</label>
            <div className="relative flex items-center">
              <User className="w-4 h-4 absolute left-3 text-gray-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
                className="w-full bg-card border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">密码</label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 absolute left-3 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码（留空代表无密码）"
                className="w-full bg-card border border-white/10 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? '隐藏密码' : '显示密码'}
                className="absolute right-2.5 p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold text-sm shadow-lg shadow-primary/25 transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? '正在验证连接...' : '连接并登录'}
          </button>
        </form>

        {/* 导入配置与备份恢复引导卡片 */}
        <div className="bg-white/[0.03] border border-white/5 hover:border-white/10 rounded-2xl p-4 transition flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0 pr-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0">
              <FolderSync className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white">已有备份或多端配置？</div>
              <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                从本地 .json 备份或 WebDAV / S3 / SMB 云端一键恢复
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings?tab=sync')}
            className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition cursor-pointer flex items-center space-x-1"
          >
            <span>导入配置</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Emby 服务器管理 / 编辑弹窗 */}
      <EmbyServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        initialEditId={editingServerId}
      />

      {/* 网络与代理设置弹窗 */}
      <NetworkProxyModal
        isOpen={isProxyModalOpen}
        onClose={() => setIsProxyModalOpen(false)}
      />
    </div>
  );
};

export default LoginPage;
